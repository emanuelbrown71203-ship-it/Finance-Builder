import { and, desc, eq, gt, like, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, balanceSnapshots, tapKeys, transactions, users } from "@/db/schema";
import { DEFAULT_TIMEZONE, isDemoMode } from "@/lib/config";
import { todayIn } from "@/lib/dates";
import { cleanMerchant, guessCategory, tapAmount } from "@/lib/finance/card-taps";
import { merchantKey } from "@/lib/finance/recurring";
import type { Ctx } from "./auth";
import { ensureCard } from "./card-import";
import { randomToken, sha256 } from "./crypto";
import { loadRules } from "./rules";

/*
 * The private tap link (see lib/finance/card-taps.ts for the idea). The link
 * carries a 240-bit random key; only its hash is kept, in tap_keys, one per
 * person. Whoever holds it can do exactly one thing: add a pending Apple Card
 * purchase to that person's Passbook. It reads nothing and changes nothing
 * else. It switches itself off after half a year unused, and making one asks
 * the person to confirm it's them. The sample household has no link (anyone
 * could write to it); it has a test button instead.
 */

const IDLE_DAYS = 180;
/** The same tap sent twice within this long (Shortcuts sometimes repeats) is one purchase. */
const REPEAT_MS = 120_000;

export const tapTxPrefix = (accountId: string) => `tap:${accountId}:`;

/** Who a tap key belongs to. Null when it's unknown, switched off, or this is the sample household. */
export async function contextForTapKey(key: string): Promise<Ctx | null> {
  if (isDemoMode() || key.length < 30) return null;
  const db = await getDb();
  const tokenHash = sha256(key);
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, lastUsedAt: tapKeys.lastUsedAt, createdAt: tapKeys.createdAt })
    .from(tapKeys)
    .innerJoin(users, eq(users.id, tapKeys.userId))
    .where(eq(tapKeys.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (Date.now() - (row.lastUsedAt ?? row.createdAt).getTime() > IDLE_DAYS * 86_400_000) {
    await db.delete(tapKeys).where(and(eq(tapKeys.userId, row.id), eq(tapKeys.tokenHash, tokenHash)));
    return null;
  }
  await db.update(tapKeys).set({ lastUsedAt: new Date() }).where(eq(tapKeys.userId, row.id));
  return { db, userId: row.id, user: { id: row.id, name: row.name, email: row.email }, today: todayIn(DEFAULT_TIMEZONE), demo: false };
}

export async function tapStatus(ctx: Ctx): Promise<{ on: boolean; createdAt: string | null; lastUsedAt: string | null; demo: boolean }> {
  if (ctx.demo) return { on: false, createdAt: null, lastUsedAt: null, demo: true };
  const [row] = await ctx.db.select().from(tapKeys).where(eq(tapKeys.userId, ctx.userId)).limit(1);
  return { on: Boolean(row), createdAt: row?.createdAt.toISOString() ?? null, lastUsedAt: row?.lastUsedAt?.toISOString() ?? null, demo: false };
}

/** Makes a new tap key (switching any old one off) and returns it once. Only its hash is kept. */
export async function createTapKey(ctx: Ctx): Promise<string> {
  const key = randomToken(30);
  const tokenHash = sha256(key);
  await ctx.db.insert(tapKeys).values({ userId: ctx.userId, tokenHash }).onConflictDoUpdate({ target: tapKeys.userId, set: { tokenHash, createdAt: new Date(), lastUsedAt: null } });
  return key;
}

export async function revokeTapKey(ctx: Ctx): Promise<void> {
  await ctx.db.delete(tapKeys).where(eq(tapKeys.userId, ctx.userId));
}

/** The category this merchant usually gets: the person's own rule, then what they last put it under, then a guess from the name. */
async function categoryFor(ctx: Ctx, merchant: string) {
  const key = merchantKey(merchant);
  const rule = (await loadRules(ctx.db, ctx.userId)).get(key);
  if (rule) return rule;
  const recent = await ctx.db
    .select({ name: transactions.name, category: transactions.category })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.pending, false)))
    .orderBy(desc(transactions.date))
    .limit(400);
  return recent.find((t) => merchantKey(t.name) === key && t.category !== "transfer")?.category ?? guessCategory(merchant);
}

export type TapResult = { recorded: boolean; reason?: string };

/** One Apple Card tap: a pending purchase today, and what the card owes goes up by it. */
export async function recordTap(ctx: Ctx, input: { amount: unknown; merchant: unknown }): Promise<TapResult> {
  const cents = tapAmount(input.amount);
  // iPhone sometimes sends a tap with no amount; the statement brings that purchase in later.
  if (cents === null) return { recorded: false, reason: "No amount came with that tap. It will come in with your statement." };
  const merchant = cleanMerchant(input.merchant);
  const card = await ensureCard(ctx);
  const [repeat] = await ctx.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.accountId, card.id), eq(transactions.amount, -cents), eq(transactions.name, merchant), like(transactions.plaidTransactionId, `${tapTxPrefix(card.id)}%`), gt(transactions.createdAt, new Date(Date.now() - REPEAT_MS))))
    .limit(1);
  if (repeat) return { recorded: false, reason: "Already have that one." };

  const id = crypto.randomUUID();
  await ctx.db.insert(transactions).values({ id, userId: ctx.userId, accountId: card.id, plaidTransactionId: `${tapTxPrefix(card.id)}${id}`, date: ctx.today, name: merchant, rawName: merchant, amount: -cents, category: await categoryFor(ctx, merchant), pending: true, createdAt: new Date() });
  // In one statement, so two taps arriving together both count.
  const [after] = await ctx.db
    .update(accounts)
    .set({ balance: sql`${accounts.balance} - ${cents}` })
    .where(and(eq(accounts.id, card.id), eq(accounts.userId, ctx.userId)))
    .returning({ balance: accounts.balance });
  if (after) {
    await ctx.db
      .insert(balanceSnapshots)
      .values({ userId: ctx.userId, accountId: card.id, date: ctx.today, balance: after.balance })
      .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.date], set: { balance: after.balance } });
  }
  return { recorded: true };
}
