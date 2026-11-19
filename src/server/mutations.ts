import { and, eq, sql } from "drizzle-orm";
import { accounts, balanceSnapshots, budgets, goals, recurringOverrides, transactions } from "@/db/schema";
import { isCategoryKey } from "@/lib/categories";
import type { Ctx } from "./auth";
import { HttpError } from "./http";

export async function updateTransaction(ctx: Ctx, id: string, patch: { category?: string; note?: string | null }) {
  if (patch.category !== undefined && !isCategoryKey(patch.category)) throw new HttpError(400, "Unknown category.");
  const set: Partial<typeof transactions.$inferInsert> = {};
  if (patch.category !== undefined) Object.assign(set, { category: patch.category, categoryLocked: true });
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  if (Object.keys(set).length === 0) return;
  const rows = await ctx.db.update(transactions).set(set).where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId))).returning({ id: transactions.id });
  if (rows.length === 0) throw new HttpError(404, "Transaction not found.");
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
