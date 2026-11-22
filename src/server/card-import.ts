import { and, eq, inArray, like } from "drizzle-orm";
import { accounts, balanceSnapshots, transactions } from "@/db/schema";
import { formatShort, type ISODate } from "@/lib/dates";
import { StatementError, parseStatement, rowKeys, sampleStatement, type ParsedStatement } from "@/lib/finance/card-import";
import { merchantKey } from "@/lib/finance/recurring";
import { matchTaps } from "@/lib/finance/card-taps";
import type { AccountsPayload, AppleCardImport, AppleCardPreview, AppleCardUndo } from "@/lib/types";
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

export async function findCard(ctx: Ctx) {
  const [card] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, ctx.userId), eq(accounts.plaidAccountId, appleCardKey(ctx.userId))))
    .limit(1);
  return card ?? null;
}

/** The person's Apple Card account, set up (owing nothing yet) if this is the first statement or tap. */
export async function ensureCard(ctx: Ctx) {
  const found = await findCard(ctx);
  if (found) return found;
  await ctx.db
    .insert(accounts)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, itemId: null, plaidAccountId: appleCardKey(ctx.userId), name: "Apple Card", institutionName: "Apple Card", type: "credit", subtype: "credit card", balance: 0 })
    .onConflictDoNothing();
  const card = await findCard(ctx);
  if (!card) throw new HttpError(500, "Couldn’t set up Apple Card. Try again.");
  return card;
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

/** Taps waiting for their statement (see card-taps.ts). */
async function pendingTaps(ctx: Ctx, accountId: string) {
  return ctx.db
    .select({ id: transactions.id, date: transactions.date, name: transactions.name, amount: transactions.amount, category: transactions.category, categoryLocked: transactions.categoryLocked, note: transactions.note, customName: transactions.customName, createdAt: transactions.createdAt })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, accountId), eq(transactions.pending, true), like(transactions.plaidTransactionId, `tap:${accountId}:%`)));
}

const span = (parsed: ParsedStatement) => {
  const dates = parsed.rows.map((r) => r.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
};

const owedBy = (balance: number) => Math.max(0, -balance);

export async function setOwed(ctx: Ctx, accountId: string, owed: number) {
  const balance = -Math.abs(owed);
  await ctx.db.update(accounts).set({ balance }).where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId)));
  await ctx.db
    .insert(balanceSnapshots)
    .values({ userId: ctx.userId, accountId, date: ctx.today, balance })
    .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.date], set: { balance } });
}

/** Everything a statement means for the card: new lines, which of them are taps already here, and taps it shows never went through. */
async function plan(ctx: Ctx, parsed: ParsedStatement, card: Awaited<ReturnType<typeof findCard>>) {
  const keys = rowKeys(parsed.rows);
  const have = card ? await alreadyHere(ctx, card.id, keys) : new Set<string>();
  const fresh = parsed.rows.map((_, i) => !have.has(keys[i]));
  const taps = card ? await pendingTaps(ctx, card.id) : [];
  const { adopt, stale } = matchTaps(parsed.rows, fresh, taps, span(parsed), parsed.uncleared);
  return { keys, fresh, taps, adopt, stale: taps.filter((t) => stale.includes(t.id)) };
}

/** What a statement holds and how much of it is new, before anything is saved. */
export async function previewAppleCard(ctx: Ctx, text: string): Promise<AppleCardPreview> {
  const parsed = read(ctx, text);
  const card = await findCard(ctx);
  const { fresh, adopt, stale } = await plan(ctx, parsed, card);
  const freshCount = fresh.filter(Boolean).length;
  const owedNow = card ? owedBy(card.balance) : null;
  // Only taps so far (no statement yet): what's owed is just those taps, so ask for Wallet's balance.
  const hasStatement = card ? (await ctx.db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), like(transactions.plaidTransactionId, `import:${card.id}:%`))).limit(1)).length > 0 : false;
  // What was owed, plus new charges and less new payments (taps already counted theirs), less taps that
  // never went through. The first time there's nothing to start from (a statement doesn't say the
  // balance), so the person types it from Wallet.
  const change = parsed.rows.reduce((s, r, i) => (fresh[i] && !adopt.has(i) ? s - r.amount : s), 0) + stale.reduce((s, t) => s + t.amount, 0);
  const suggestedOwed = owedNow === null || !hasStatement ? null : Math.max(0, owedNow + change);
  return { ...span(parsed), total: parsed.rows.length, fresh: freshCount, already: parsed.rows.length - freshCount, pending: parsed.pending, confirmedTaps: adopt.size, droppedTaps: stale.length, owedNow, suggestedOwed, sample: ctx.demo };
}

/**
 * Brings a statement in: taps it shows become its lines (keeping a category the person picked), new
 * lines are added sorted the way the person sorts that merchant, taps it shows never went through are
 * dropped, and what's owed is set.
 */
export async function importAppleCard(ctx: Ctx, text: string, owed: number): Promise<AppleCardImport> {
  const parsed = read(ctx, text);
  const existing = await findCard(ctx);
  const previousOwed = existing ? owedBy(existing.balance) : null;
  const card = existing ?? (await ensureCard(ctx));
  const { keys, fresh, taps, adopt, stale } = await plan(ctx, parsed, card);
  const rules = await loadRules(ctx.db, ctx.userId);
  // A merchant the person has given a fixed category wins, except that paying the card off stays a transfer.
  const categoryOf = (r: ParsedStatement["rows"][number]) => (r.category === "transfer" ? r.category : (rules.get(merchantKey(r.name)) ?? r.category));
  // Every row added by one import shares this moment, which is how Undo finds exactly them.
  const batch = new Date();

  const confirmed: string[] = [];
  for (const [i, tapId] of adopt) {
    const r = parsed.rows[i];
    const tap = taps.find((t) => t.id === tapId)!;
    await ctx.db
      .update(transactions)
      .set({ pending: false, date: r.date, name: r.name, rawName: r.rawName, plaidTransactionId: txKey(card.id, keys[i]), ...(tap.categoryLocked ? {} : { category: categoryOf(r) }) })
      .where(and(eq(transactions.id, tapId), eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), eq(transactions.pending, true)));
    confirmed.push(tapId);
  }
  const inserts = parsed.rows.flatMap((r, i) =>
    fresh[i] && !adopt.has(i) ? [{ id: crypto.randomUUID(), userId: ctx.userId, accountId: card.id, plaidTransactionId: txKey(card.id, keys[i]), date: r.date, name: r.name, rawName: r.rawName, amount: r.amount, category: categoryOf(r), pending: false, createdAt: batch }] : [],
  );
  let added = 0;
  for (let i = 0; i < inserts.length; i += 400) {
    const done = await ctx.db.insert(transactions).values(inserts.slice(i, i + 400)).onConflictDoNothing().returning({ id: transactions.id });
    added += done.length;
  }
  if (stale.length) await ctx.db.delete(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), eq(transactions.pending, true), inArray(transactions.id, stale.map((t) => t.id))));
  await setOwed(ctx, card.id, owed);

  const { from, to } = span(parsed);
  const earned = added + confirmed.length > 0 && (await win(ctx, "import", `${card.id}:${to}`, `Apple Card to ${formatShort(to)}`));
  const removed = stale.map((t) => ({ id: t.id, date: t.date, name: t.name, amount: t.amount, category: t.category, categoryLocked: t.categoryLocked, note: t.note, customName: t.customName, createdAt: t.createdAt.toISOString() }));
  return { added, confirmed, removed, skipped: parsed.rows.length - added - confirmed.length, from, to, batch: batch.toISOString(), previousOwed, owed, earned, accountId: card.id };
}

/**
 * Undo: takes out exactly what one import added, turns the taps it confirmed back into taps, puts back
 * taps it dropped, takes back the XP only if that import earned it, and puts back what was owed, unless
 * that has changed since (a later import, a tap, or an update by hand).
 */
export async function undoAppleCardImport(ctx: Ctx, input: AppleCardUndo): Promise<void> {
  const card = await findCard(ctx);
  const at = new Date(input.batch);
  if (!card || Number.isNaN(at.getTime())) return;
  await ctx.db.delete(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), eq(transactions.createdAt, at)));
  const confirmed = input.confirmed ?? [];
  for (const id of confirmed) {
    await ctx.db
      .update(transactions)
      .set({ pending: true, plaidTransactionId: `tap:${card.id}:${id}` })
      .where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), like(transactions.plaidTransactionId, `import:${card.id}:%`)));
  }
  const removed = input.removed ?? [];
  if (removed.length) {
    await ctx.db
      .insert(transactions)
      .values(removed.map((t) => ({ id: t.id, userId: ctx.userId, accountId: card.id, plaidTransactionId: `tap:${card.id}:${t.id}`, date: t.date, name: t.name, rawName: t.name, amount: t.amount, category: t.category, categoryLocked: t.categoryLocked, note: t.note, customName: t.customName, pending: true, createdAt: new Date(t.createdAt) })))
      .onConflictDoNothing();
  }
  if (input.earned) await takeBack(ctx, "import", `${card.id}:${input.to}`);
  if (input.previousOwed !== null) {
    if (owedBy(card.balance) === input.owed) await setOwed(ctx, card.id, input.previousOwed);
    return;
  }
  // That import set Apple Card up: with nothing left on it, it goes too.
  const [left] = await ctx.db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id))).limit(1);
  if (!left) await ctx.db.delete(accounts).where(and(eq(accounts.id, card.id), eq(accounts.userId, ctx.userId)));
}

/** For the Accounts screen: Apple Card, if there is one, with how far its statements reach and taps waiting for one. */
export async function appleCardSummary(ctx: Ctx): Promise<AccountsPayload["appleCard"]> {
  const card = await findCard(ctx);
  if (!card) return null;
  const rows = await ctx.db.select({ date: transactions.date, pending: transactions.pending }).from(transactions).where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id)));
  const lastDate = rows.reduce<ISODate | null>((max, r) => (!r.pending && (max === null || r.date > max) ? r.date : max), null);
  return { accountId: card.id, owed: owedBy(card.balance), transactions: rows.filter((r) => !r.pending).length, pendingTaps: rows.filter((r) => r.pending).length, lastDate };
}
