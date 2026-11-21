import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { accounts, balanceSnapshots, budgets, categoryRules, debtPlans, goalDeposits, goals, recurringOverrides, transactions, userSettings } from "@/db/schema";
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
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(goals).where(eq(goals.userId, ctx.userId));
  if (count >= 50) throw new HttpError(400, "That’s the most goals Passbook keeps. Delete one you’ve finished first.");
  await ctx.db.insert(goals).values({ id: crypto.randomUUID(), userId: ctx.userId, ...input });
}

const MAX_DEPOSITS = 2000;

/**
 * Changes a goal. `add` puts money toward it (or, negative, takes some back
 * out) and writes the deposit down, so the goal's track can be drawn. Returns
 * the deposit's id, which is what Undo removes.
 */
export async function updateGoal(ctx: Ctx, id: string, patch: Partial<GoalInput> & { add?: number }): Promise<{ depositId: string | null }> {
  const { add, ...fields } = patch;
  // One transaction with the goal locked, so two changes at once (two phones, a double tap) can't
  // both read the same amount: what's saved and the list of deposits always agree.
  return ctx.db.transaction(async (tx) => {
    const [goal] = await tx.select({ id: goals.id, saved: goals.saved }).from(goals).where(and(eq(goals.id, id), eq(goals.userId, ctx.userId))).for("update").limit(1);
    if (!goal) throw new HttpError(404, "Goal not found.");
    // Never below zero: taking out more than is there takes out what is there.
    const change = add ? Math.max(-goal.saved, add) : 0;
    if (change) {
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(goalDeposits).where(eq(goalDeposits.userId, ctx.userId));
      if (count >= MAX_DEPOSITS * 10) throw new HttpError(400, "That’s more deposits than Passbook keeps. Delete an old goal first.");
    }
    const set: Record<string, unknown> = { ...fields };
    if (change) set.saved = goal.saved + change;
    if (Object.keys(set).length > 0) await tx.update(goals).set(set).where(and(eq(goals.id, goal.id), eq(goals.userId, ctx.userId)));
    if (!change) return { depositId: null };
    const depositId = crypto.randomUUID();
    await tx.insert(goalDeposits).values({ id: depositId, userId: ctx.userId, goalId: goal.id, amount: change, date: ctx.today });
    return { depositId };
  });
}

/**
 * Removes one deposit (what Undo does) and takes its amount back off the goal.
 * Refused if that money has since been taken out, so Undo can never make
 * money appear on paper.
 */
export async function deleteDeposit(ctx: Ctx, goalId: string, depositId: string) {
  await ctx.db.transaction(async (tx) => {
    const [goal] = await tx.select({ saved: goals.saved }).from(goals).where(and(eq(goals.id, goalId), eq(goals.userId, ctx.userId))).for("update").limit(1);
    const [deposit] = goal
      ? await tx.select({ amount: goalDeposits.amount }).from(goalDeposits).where(and(eq(goalDeposits.id, depositId), eq(goalDeposits.goalId, goalId), eq(goalDeposits.userId, ctx.userId))).limit(1)
      : [];
    if (!goal || !deposit) throw new HttpError(404, "That deposit wasn’t found.");
    if (goal.saved - deposit.amount < 0) throw new HttpError(409, "That money has already been taken out of the goal, so there’s nothing to undo.");
    await tx.delete(goalDeposits).where(and(eq(goalDeposits.id, depositId), eq(goalDeposits.userId, ctx.userId)));
    await tx.update(goals).set({ saved: goal.saved - deposit.amount }).where(and(eq(goals.id, goalId), eq(goals.userId, ctx.userId)));
  });
}

export async function deleteGoal(ctx: Ctx, id: string) {
  await ctx.db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, ctx.userId)));
}

/** Things tracked by hand: a car, a house, a loan from a relative. */
export async function createManualAccount(ctx: Ctx, input: { name: string; kind: "asset" | "debt"; value: number }) {
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(accounts).where(and(eq(accounts.userId, ctx.userId), isNull(accounts.itemId)));
  if (count >= 50) throw new HttpError(400, "That’s the most hand-tracked items Passbook keeps. Remove one first.");
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

/** How much extra goes toward debt each month, and which debt gets it first. */
export async function setDebtSettings(ctx: Ctx, patch: { extra?: number; strategy?: "avalanche" | "snowball" }) {
  const set = { ...(patch.extra !== undefined ? { debtExtra: patch.extra } : {}), ...(patch.strategy ? { debtStrategy: patch.strategy } : {}) };
  if (Object.keys(set).length === 0) return;
  await ctx.db.insert(userSettings).values({ userId: ctx.userId, ...set }).onConflictDoUpdate({ target: userSettings.userId, set });
}

/** The interest rate and monthly payment for one debt, when the bank doesn't say or the owner knows better. */
export async function setDebtPlan(ctx: Ctx, accountId: string, patch: { aprPercent?: number | null; monthlyPayment?: number | null }) {
  const [account] = await ctx.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId))).limit(1);
  if (!account) throw new HttpError(404, "Account not found.");
  await ctx.db
    .insert(debtPlans)
    .values({ accountId, userId: ctx.userId, aprPercent: patch.aprPercent ?? null, monthlyPayment: patch.monthlyPayment ?? null })
    .onConflictDoUpdate({ target: debtPlans.accountId, set: { ...(patch.aprPercent !== undefined ? { aprPercent: patch.aprPercent } : {}), ...(patch.monthlyPayment !== undefined ? { monthlyPayment: patch.monthlyPayment } : {}) } });
}
