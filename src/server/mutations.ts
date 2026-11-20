import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { accounts, balanceSnapshots, budgets, categoryRules, goals, recurringOverrides, transactions } from "@/db/schema";
import { isCategoryKey } from "@/lib/categories";
import { merchantKey } from "@/lib/finance/recurring";
import type { Ctx } from "./auth";
import { HttpError } from "./http";

/** What a remembered change replaced, so Undo can put everything back exactly. */
export type RememberUndo = { rule: string | null; others: { id: string; category: string }[] };

const MAX_RULES = 500;

/**
 * Changes one transaction. With `remember`, the new category also becomes the
 * rule for that merchant: every other charge from them moves too, and future
 * ones land there on their own.
 */
export async function updateTransaction(
  ctx: Ctx,
  id: string,
  patch: { category?: string; note?: string | null; remember?: boolean; restore?: RememberUndo },
): Promise<{ moved: number; undo: RememberUndo | null }> {
  if (patch.category !== undefined && !isCategoryKey(patch.category)) throw new HttpError(400, "Unknown category.");
  const [tx] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId))).limit(1);
  if (!tx) throw new HttpError(404, "Transaction not found.");

  const set: Partial<typeof transactions.$inferInsert> = {};
  if (patch.category !== undefined) Object.assign(set, { category: patch.category, categoryLocked: true });
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  if (Object.keys(set).length > 0) await ctx.db.update(transactions).set(set).where(eq(transactions.id, tx.id));

  const key = merchantKey(tx.name);

  // Undo of a remembered change: put the rule and the other charges back as they were.
  if (patch.restore) {
    if (patch.restore.rule === null) await ctx.db.delete(categoryRules).where(and(eq(categoryRules.userId, ctx.userId), eq(categoryRules.merchantKey, key)));
    else if (isCategoryKey(patch.restore.rule)) await saveRule(ctx, key, patch.restore.rule);
    for (const other of patch.restore.others.slice(0, 5000)) {
      if (!isCategoryKey(other.category)) continue;
      await ctx.db.update(transactions).set({ category: other.category }).where(and(eq(transactions.id, other.id), eq(transactions.userId, ctx.userId)));
    }
    return { moved: 0, undo: null };
  }

  if (!patch.remember || patch.category === undefined || !key) return { moved: 0, undo: null };

  const [existing] = await ctx.db.select().from(categoryRules).where(and(eq(categoryRules.userId, ctx.userId), eq(categoryRules.merchantKey, key))).limit(1);
  await saveRule(ctx, key, patch.category);

  // Move every other charge from the same merchant, remembering where each one was.
  const candidates = await ctx.db
    .select({ id: transactions.id, name: transactions.name, category: transactions.category })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), ne(transactions.id, tx.id), ne(transactions.category, patch.category)));
  const others = candidates.filter((t) => merchantKey(t.name) === key).map((t) => ({ id: t.id, category: t.category }));
  for (let i = 0; i < others.length; i += 500) {
    await ctx.db
      .update(transactions)
      .set({ category: patch.category })
      .where(
        and(
          eq(transactions.userId, ctx.userId),
          inArray(
            transactions.id,
            others.slice(i, i + 500).map((o) => o.id),
          ),
        ),
      );
  }
  return { moved: others.length, undo: { rule: existing?.category ?? null, others } };
}

async function saveRule(ctx: Ctx, key: string, categoryKey: string) {
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(categoryRules).where(eq(categoryRules.userId, ctx.userId));
  if (count >= MAX_RULES) throw new HttpError(400, "You’ve reached the limit of remembered categories. Remove some in Settings first.");
  await ctx.db
    .insert(categoryRules)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, merchantKey: key, category: categoryKey })
    .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.merchantKey], set: { category: categoryKey } });
}

export async function deleteRule(ctx: Ctx, id: string) {
  await ctx.db.delete(categoryRules).where(and(eq(categoryRules.id, id), eq(categoryRules.userId, ctx.userId)));
}

export async function setRecurringOverride(ctx: Ctx, key: string, patch: { kind?: "bill" | "subscription" | "ignore"; cancelled?: boolean }) {
  await ctx.db
    .insert(recurringOverrides)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, seriesKey: key, kind: patch.kind ?? null, cancelled: patch.cancelled ?? false })
    .onConflictDoUpdate({
      target: [recurringOverrides.userId, recurringOverrides.seriesKey],
      set: { ...(patch.kind !== undefined ? { kind: patch.kind } : {}), ...(patch.cancelled !== undefined ? { cancelled: patch.cancelled } : {}) },
    });
}

export async function setBudget(ctx: Ctx, category: string, monthlyLimit: number | null) {
  if (!isCategoryKey(category) || category === "transfer" || category === "income") throw new HttpError(400, "Unknown category.");
  if (monthlyLimit === null) {
    await ctx.db.delete(budgets).where(and(eq(budgets.userId, ctx.userId), eq(budgets.category, category)));
    return;
  }
  await ctx.db
    .insert(budgets)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, category, monthlyLimit })
    .onConflictDoUpdate({ target: [budgets.userId, budgets.category], set: { monthlyLimit } });
}

type GoalInput = { name: string; target: number; saved: number; monthlyContribution: number; targetDate: string | null };

export async function createGoal(ctx: Ctx, input: GoalInput) {
  await ctx.db.insert(goals).values({ id: crypto.randomUUID(), userId: ctx.userId, ...input });
}

export async function updateGoal(ctx: Ctx, id: string, patch: Partial<GoalInput> & { add?: number }) {
  const { add, ...fields } = patch;
  const set: Record<string, unknown> = { ...fields };
  if (add) set.saved = sql`greatest(0, ${goals.saved} + ${add})`;
  if (Object.keys(set).length === 0) return;
  const rows = await ctx.db.update(goals).set(set).where(and(eq(goals.id, id), eq(goals.userId, ctx.userId))).returning({ id: goals.id });
  if (rows.length === 0) throw new HttpError(404, "Goal not found.");
}

export async function deleteGoal(ctx: Ctx, id: string) {
  await ctx.db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, ctx.userId)));
}

/** Things tracked by hand: a car, a house, a loan from a relative. */
export async function createManualAccount(ctx: Ctx, input: { name: string; kind: "asset" | "debt"; value: number }) {
  const id = crypto.randomUUID();
  const balance = input.kind === "debt" ? -Math.abs(input.value) : Math.abs(input.value);
  await ctx.db.insert(accounts).values({ id, userId: ctx.userId, itemId: null, name: input.name, institutionName: "Tracked by hand", type: input.kind === "debt" ? "loan" : "property", subtype: "manual", balance });
  await ctx.db.insert(balanceSnapshots).values({ userId: ctx.userId, accountId: id, date: ctx.today, balance });
}

async function manualAccount(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, ctx.userId))).limit(1);
  if (!row) throw new HttpError(404, "Account not found.");
  if (row.itemId !== null) throw new HttpError(400, "Linked accounts update from the bank. Remove the connection instead.");
  return row;
}

export async function updateManualAccount(ctx: Ctx, id: string, patch: { name?: string; value?: number }) {
  const row = await manualAccount(ctx, id);
  const balance = patch.value === undefined ? row.balance : row.balance < 0 ? -Math.abs(patch.value) : Math.abs(patch.value);
  await ctx.db.update(accounts).set({ name: patch.name ?? row.name, balance }).where(eq(accounts.id, id));
  await ctx.db
    .insert(balanceSnapshots)
    .values({ userId: ctx.userId, accountId: id, date: ctx.today, balance })
    .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.date], set: { balance } });
}

export async function deleteManualAccount(ctx: Ctx, id: string) {
  await manualAccount(ctx, id);
  await ctx.db.delete(accounts).where(eq(accounts.id, id));
}
