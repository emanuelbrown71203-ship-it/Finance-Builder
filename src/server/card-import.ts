import { and, eq, inArray } from "drizzle-orm";
import { accounts, balanceSnapshots, transactions } from "@/db/schema";
import { formatShort, type ISODate } from "@/lib/dates";
import { StatementError, parseStatement, rowKeys, sampleStatement, type ParsedStatement } from "@/lib/finance/card-import";
import { merchantKey } from "@/lib/finance/recurring";
import type { AppleCardImport, AppleCardPreview } from "@/lib/types";
import type { Ctx } from "./auth";
import { takeBack, win } from "./game";
import { HttpError } from "./http";
import { loadRules } from "./rules";

/*
 * Apple Card, brought in from its statements (see lib/finance/card-import.ts
 * for why). It's an ordinary card account with no bank connection behind it:
 * `item_id` is null, like the things tracked by hand, and its
 * `plaid_account_id` is "import:apple-card:<person>", so there's one per person
 * and it can be found again. Each imported purchase's `plaid_transaction_id`
 * is "import:<account>:<made>:<cleared>:<amount>:<n>", which is what stops the
 * same purchase being brought in twice. Everything is limited to the person's
 * own rows. In the sample household (one pretend household everyone shares) a
 * made-up statement is used instead of the person's file, so nobody's real
 * purchases are ever shown to visitors.
 */

const appleCardKey = (userId: string) => `import:apple-card:${userId}`;
const txKey = (accountId: string, key: string) => `import:${accountId}:${key}`;

/** An account filled from statements rather than a bank connection. */
export const isImportedAccount = (plaidAccountId: string | null) => Boolean(plaidAccountId?.startsWith("import:"));

async function findCard(ctx: Ctx) {
  const [card] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, ctx.userId), eq(accounts.plaidAccountId, appleCardKey(ctx.userId))))
    .limit(1);
  return card ?? null;
}

function read(ctx: Ctx, text: string): ParsedStatement {
  try {
    return parseStatement(ctx.demo ? sampleStatement(ctx.today) : text);
  } catch (error) {
    if (error instanceof StatementError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** Which of these keys this card already has. */
async function alreadyHere(ctx: Ctx, accountId: string, keys: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  const ids = keys.map((k) => txKey(accountId, k));
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await ctx.db
      .select({ key: transactions.plaidTransactionId })
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, accountId), inArray(transactions.plaidTransactionId, ids.slice(i, i + 500))));
    for (const r of rows) if (r.key) have.add(r.key.slice(`import:${accountId}:`.length));
  }
  return have;
}

const span = (parsed: ParsedStatement) => {
  const dates = parsed.rows.map((r) => r.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
};

const owedBy = (balance: number) => Math.max(0, -balance);

async function setOwed(ctx: Ctx, accountId: string, owed: number) {
  const balance = -Math.abs(owed);
  await ctx.db.update(accounts).set({ balance }).where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId)));
  await ctx.db
    .insert(balanceSnapshots)
    .values({ userId: ctx.userId, accountId, date: ctx.today, balance })
    .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.date], set: { balance } });
}

/** What a statement holds and how much of it is new, before anything is saved. */
export async function previewAppleCard(ctx: Ctx, text: string): Promise<AppleCardPreview> {
  const parsed = read(ctx, text);
  const card = await findCard(ctx);
  const keys = rowKeys(parsed.rows);
  const have = card ? await alreadyHere(ctx, card.id, keys) : new Set<string>();
  const fresh = parsed.rows.filter((_, i) => !have.has(keys[i]));
  const owedNow = card ? owedBy(card.balance) : null;
  // What was owed, plus the new charges, less new payments. The first time there's nothing to start
  // from (a statement doesn't say the balance), so the person types it from Wallet.
  const suggestedOwed = owedNow === null ? null : Math.max(0, owedNow - fresh.reduce((s, r) => s + r.amount, 0));
  return { ...span(parsed), total: parsed.rows.length, fresh: fresh.length, already: parsed.rows.length - fresh.length, pending: parsed.pending, owedNow, suggestedOwed, sample: ctx.demo };
}

/** Brings a statement in: new purchases only, sorted the way the person sorts that merchant, and what's owed now. */
export async function importAppleCard(ctx: Ctx, text: string, owed: number): Promise<AppleCardImport> {
  const parsed = read(ctx, text);
  let card = await findCard(ctx);
  const previousOwed = card ? owedBy(card.balance) : null;
  if (!card) {
    const id = crypto.randomUUID();
    await ctx.db
      .insert(accounts)
      .values({ id, userId: ctx.userId, itemId: null, plaidAccountId: appleCardKey(ctx.userId), name: "Apple Card", institutionName: "Apple Card", type: "credit", subtype: "credit card", balance: 0 })
      .onConflictDoNothing();
    card = await findCard(ctx);
    if (!card) throw new HttpError(500, "Couldn’t set up Apple Card. Try again.");
  }

  const keys = rowKeys(parsed.rows);
  const have = await alreadyHere(ctx, card.id, keys);
  const rules = await loadRules(ctx.db, ctx.userId);
  // Every row of one import shares this moment, which is how Undo finds exactly them.
  const batch = new Date();
  const inserts = parsed.rows.flatMap((r, i) => {
    if (have.has(keys[i])) return [];
    // A merchant the person has given a fixed category wins, except that paying the card off stays a transfer.
    const category = r.category === "transfer" ? r.category : (rules.get(merchantKey(r.name)) ?? r.category);
    return [{ id: crypto.randomUUID(), userId: ctx.userId, accountId: card.id, plaidTransactionId: txKey(card.id, keys[i]), date: r.date, name: r.name, rawName: r.rawName, amount: r.amount, category, pending: false, createdAt: batch }];
  });
  let added = 0;
  for (let i = 0; i < inserts.length; i += 400) {
    const done = await ctx.db.insert(transactions).values(inserts.slice(i, i + 400)).onConflictDoNothing().returning({ id: transactions.id });
    added += done.length;
  }
  await setOwed(ctx, card.id, owed);

  const { from, to } = span(parsed);
  const earned = added > 0 && (await win(ctx, "import", `${card.id}:${to}`, `Apple Card to ${formatShort(to)}`));
  return { added, skipped: parsed.rows.length - added, from, to, batch: batch.toISOString(), previousOwed, owed, earned, accountId: card.id };
}

/**
 * Undo: takes out exactly what one import added, takes back the XP only if that import earned it, and
 * puts back what was owed, unless it has changed since (a later import, or an update by hand).
 */
export async function undoAppleCardImport(ctx: Ctx, input: { batch: string; to: ISODate; previousOwed: number | null; owed: number; earned: boolean }): Promise<void> {
  const card = await findCard(ctx);
  const at = new Date(input.batch);
  if (!card || Number.isNaN(at.getTime())) return;
  await ctx.db.delete(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), eq(transactions.createdAt, at)));
  if (input.earned) await takeBack(ctx, "import", `${card.id}:${input.to}`);
  if (input.previousOwed !== null) {
    if (owedBy(card.balance) === input.owed) await setOwed(ctx, card.id, input.previousOwed);
    return;
  }
  // That import set Apple Card up: with nothing left on it, it goes too.
  const [left] = await ctx.db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id))).limit(1);
  if (!left) await ctx.db.delete(accounts).where(and(eq(accounts.id, card.id), eq(accounts.userId, ctx.userId)));
}

/** For the Accounts screen: Apple Card, if there is one, with how far its statements reach. */
export async function appleCardSummary(ctx: Ctx): Promise<{ accountId: string; owed: number; transactions: number; lastDate: ISODate | null } | null> {
  const card = await findCard(ctx);
  if (!card) return null;
  const rows = await ctx.db.select({ date: transactions.date }).from(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id)));
  const lastDate = rows.reduce<ISODate | null>((max, r) => (max === null || r.date > max ? r.date : max), null);
  return { accountId: card.id, owed: owedBy(card.balance), transactions: rows.length, lastDate };
}
