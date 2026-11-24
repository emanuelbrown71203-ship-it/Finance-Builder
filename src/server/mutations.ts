import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { accounts, balanceSnapshots, budgets, categoryRules, debtPlans, goalDeposits, goals, incomeAdjustments, recurringOverrides, transactions, userSettings } from "@/db/schema";
import { category as categoryOf, isCategoryKey } from "@/lib/categories";
import { addDays, monthOf } from "@/lib/dates";
import { cleanName, validName } from "@/lib/finance/names";
import { merchantKey } from "@/lib/finance/recurring";
import type { Ctx } from "./auth";
import { MILESTONES, goalMilestones, takeBack, undoGoalMilestones, win } from "./game";
import { carriedNow } from "./queries";
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
  patch: { category?: string; note?: string | null; name?: string | null; remember?: boolean; restore?: RememberUndo; undo?: boolean },
): Promise<{ moved: number; undo: RememberUndo | null }> {
  if (patch.category !== undefined && !isCategoryKey(patch.category)) throw new HttpError(400, "Unknown category.");
  const [tx] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId))).limit(1);
  if (!tx) throw new HttpError(404, "Transaction not found.");

  const set: Partial<typeof transactions.$inferInsert> = {};
  if (patch.category !== undefined) Object.assign(set, { category: patch.category, categoryLocked: true });
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  // A name for just this transaction. Empty puts back the usual name.
  if (patch.name !== undefined) {
    const name = patch.name === null || !patch.name.trim() ? null : validName(patch.name);
    if (patch.name !== null && patch.name.trim() && !name) throw new HttpError(400, "Give it a name of up to 60 letters.");
    set.customName = name;
  }
  if (Object.keys(set).length > 0) await ctx.db.update(transactions).set(set).where(eq(transactions.id, tx.id));

  // Small wins, each once per transaction. The screen's Undo says so (`undo`), and takes back what today's change earned.
  if (patch.undo || patch.restore) {
    if (patch.category !== undefined) await takeBack(ctx, "sort", `tx:${tx.id}`);
    if (patch.name !== undefined) await takeBack(ctx, "rename", `tx:${tx.id}`);
    if (patch.note !== undefined) await takeBack(ctx, "note", `tx:${tx.id}`);
  } else {
    const shown = set.customName ?? tx.customName ?? cleanName(tx.name);
    if (set.category !== undefined && set.category !== tx.category) await win(ctx, "sort", `tx:${tx.id}`, shown);
    if (set.customName && set.customName !== tx.customName) await win(ctx, "rename", `tx:${tx.id}`, shown);
    if (set.note && set.note !== tx.note) await win(ctx, "note", `tx:${tx.id}`, shown);
  }

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

/**
 * The person's own choices about a bill: Bills or Extras (or not repeating at all), cancelled, and for a
 * shared bill (rent split with a partner) the part that's theirs, 0.5 for half. A share of 1 or null is all theirs.
 */
export async function setRecurringOverride(ctx: Ctx, key: string, patch: { kind?: "bill" | "subscription" | "ignore" | null; cancelled?: boolean; share?: number | null }) {
  const shareBp = patch.share === undefined ? undefined : patch.share === null || patch.share >= 1 ? null : Math.round(patch.share * 10_000);
  await ctx.db
    .insert(recurringOverrides)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, seriesKey: key, kind: patch.kind ?? null, cancelled: patch.cancelled ?? false, shareBp: shareBp ?? null })
    .onConflictDoUpdate({
      target: [recurringOverrides.userId, recurringOverrides.seriesKey],
      set: { ...(patch.kind !== undefined ? { kind: patch.kind } : {}), ...(patch.cancelled !== undefined ? { cancelled: patch.cancelled } : {}), ...(shareBp !== undefined ? { shareBp } : {}) },
    });
  // Cancelling something you pay for is the biggest small win there is; Undo the same day takes it back.
  // Only for a bill or subscription that's really in the person's charges, never a made-up key.
  if (patch.cancelled === true && key.startsWith("out:") && (await chargedAs(ctx, key))) await win(ctx, "cancel", key, titleCase(key.slice(4)));
  if (patch.cancelled === false) await takeBack(ctx, "cancel", key);
}

/** Whether any of the person's own payments goes by this bill key. */
async function chargedAs(ctx: Ctx, key: string): Promise<boolean> {
  const names = await ctx.db
    .selectDistinct({ name: transactions.name })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), lt(transactions.amount, 0)));
  return names.some((n) => `out:${merchantKey(n.name)}` === key);
}

const titleCase = (words: string) => words.replace(/\b[a-z]/g, (c) => c.toUpperCase());

const isBudgetCategory = (category: string) => isCategoryKey(category) && category !== "transfer" && category !== "income";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type BudgetRestore = { rolloverSince?: string | null; rolloverCarry?: number };

/**
 * Sets or removes one category's monthly limit. Removing keeps the row (marked
 * removed) so Undo puts it back exactly, start date and rollover included.
 * `restore` is only sent by Undo, to put rollover back as it was.
 *
 * With rollover on, changing the limit first banks what's been carried so far
 * at the old limit, so earlier months keep the limit they really had.
 */
export async function setBudget(ctx: Ctx, category: string, monthlyLimit: number | null, restore: BudgetRestore = {}) {
  if (!isBudgetCategory(category)) throw new HttpError(400, "Unknown category.");
  if (restore.rolloverSince != null && (!MONTH.test(restore.rolloverSince) || restore.rolloverSince > monthOf(ctx.today))) throw new HttpError(400, "That rollover month isn’t right.");
  if (restore.rolloverCarry !== undefined && (!Number.isSafeInteger(restore.rolloverCarry) || Math.abs(restore.rolloverCarry) > 100_000_000_00)) throw new HttpError(400, "That carried amount isn’t right.");
  const mine = and(eq(budgets.userId, ctx.userId), eq(budgets.category, category));
  const [row] = await ctx.db.select().from(budgets).where(mine).limit(1);

  if (monthlyLimit === null) {
    if (row && !row.removedAt) await ctx.db.update(budgets).set({ removedAt: new Date() }).where(mine);
    // Taking away a limit set today (its Undo) takes its XP back.
    await takeBack(ctx, "budget", `${category}:${monthOf(ctx.today)}`);
    return;
  }

  const exact = restore.rolloverSince !== undefined ? { rolloverSince: restore.rolloverSince, rolloverCarry: restore.rolloverSince === null ? 0 : (restore.rolloverCarry ?? 0) } : null;
  if (!row) {
    await ctx.db.insert(budgets).values({ id: crypto.randomUUID(), userId: ctx.userId, category, monthlyLimit, ...(exact ?? {}) });
  } else if (row.removedAt) {
    // Put back today (Undo): exactly as it was. Later: a new limit, starting now.
    const sameDay = Date.now() - row.removedAt.getTime() < 24 * 3600_000;
    const fresh = sameDay ? {} : { createdAt: new Date(), rolloverSince: null, rolloverCarry: 0 };
    await ctx.db.update(budgets).set({ monthlyLimit, removedAt: null, ...fresh, ...(exact ?? {}) }).where(mine);
  } else {
    let banked = {};
    if (!exact && row.rolloverSince && row.monthlyLimit !== monthlyLimit && row.rolloverSince < monthOf(ctx.today)) {
      banked = { rolloverCarry: await carriedNow(ctx, category), rolloverSince: monthOf(ctx.today) };
    }
    await ctx.db.update(budgets).set({ monthlyLimit, ...banked, ...(exact ?? {}) }).where(mine);
  }
  // Once per category per month.
  await win(ctx, "budget", `${category}:${monthOf(ctx.today)}`, categoryOf(category).label);
}

export type BudgetState = { monthlyLimit: number | null; rolloverSince: string | null; rolloverCarry: number };

/** A category's limit and rollover as they stand (a removed one counts as none), for Undo. */
export async function budgetState(ctx: Ctx, category: string): Promise<BudgetState> {
  const [row] = await ctx.db.select().from(budgets).where(and(eq(budgets.userId, ctx.userId), eq(budgets.category, category))).limit(1);
  if (!row || row.removedAt) return { monthlyLimit: null, rolloverSince: null, rolloverCarry: 0 };
  return { monthlyLimit: row.monthlyLimit, rolloverSince: row.rolloverSince, rolloverCarry: row.rolloverCarry };
}

/**
 * Rollover on or off for one category. On, what's left at the end of this
 * month (or overspent) carries into next month's budget, and so on. Off
 * forgets what was carried; the answer says what it was, so it can be put back.
 */
export async function setRollover(ctx: Ctx, category: string, on: boolean): Promise<{ previous: BudgetState }> {
  if (!isBudgetCategory(category)) throw new HttpError(400, "Unknown category.");
  const previous = await budgetState(ctx, category);
  if (previous.monthlyLimit === null) throw new HttpError(400, "Set a limit for this category first.");
  const mine = and(eq(budgets.userId, ctx.userId), eq(budgets.category, category));
  if (on && !previous.rolloverSince) await ctx.db.update(budgets).set({ rolloverSince: monthOf(ctx.today), rolloverCarry: 0 }).where(mine);
  if (!on) await ctx.db.update(budgets).set({ rolloverSince: null, rolloverCarry: 0 }).where(mine);
  return { previous };
}

export type BudgetChange = { category: string; monthlyLimit: number | null; rolloverSince?: string | null; rolloverCarry?: number };

/** Several limits at once (a starting budget, or its Undo). Returns what each was before, for Undo. */
export async function setBudgets(ctx: Ctx, changes: BudgetChange[]): Promise<{ previous: BudgetChange[] }> {
  if (changes.some((c) => !isBudgetCategory(c.category)) || new Set(changes.map((c) => c.category)).size !== changes.length) throw new HttpError(400, "Unknown category.");
  const previous: BudgetChange[] = [];
  for (const c of changes) previous.push({ category: c.category, ...(await budgetState(ctx, c.category)) });
  for (const c of changes) await setBudget(ctx, c.category, c.monthlyLimit, c.rolloverSince !== undefined ? { rolloverSince: c.rolloverSince, rolloverCarry: c.rolloverCarry } : {});
  return { previous };
}

type GoalInput = { name: string; target: number; saved: number; monthlyContribution: number; targetDate: string | null; accountId?: string | null };

/** A goal can follow only the person's own savings-type account (a vault, savings, cash management). */
async function checkFollowed(ctx: Ctx, accountId: string | null | undefined): Promise<void> {
  if (!accountId) return;
  const [a] = await ctx.db.select({ type: accounts.type, subtype: accounts.subtype }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId))).limit(1);
  if (!a || a.type !== "depository" || a.subtype === "checking") throw new HttpError(400, "A goal can follow one of your savings accounts.");
}

export async function createGoal(ctx: Ctx, input: GoalInput): Promise<string> {
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(goals).where(eq(goals.userId, ctx.userId));
  if (count >= 50) throw new HttpError(400, "That’s the most goals Passbook keeps. Delete one you’ve finished first.");
  await checkFollowed(ctx, input.accountId);
  const id = crypto.randomUUID();
  // Following an account, its balance is what's saved: nothing typed in counts.
  await ctx.db.insert(goals).values({ id, userId: ctx.userId, ...input, saved: input.accountId ? 0 : input.saved, accountId: input.accountId ?? null });
  await win(ctx, "goal", id, input.name);
  if (input.saved > 0 && !input.accountId) await goalMilestones(ctx, { id, name: input.name, target: input.target }, 0, input.saved);
  return id;
}

const MAX_DEPOSITS = 2000;

/**
 * Changes a goal. `add` puts money toward it (or, negative, takes some back
 * out) and writes the deposit down, so the goal's track can be drawn. Returns
 * the deposit's id, which is what Undo removes.
 */
export async function updateGoal(ctx: Ctx, id: string, patch: Partial<GoalInput> & { add?: number }): Promise<{ depositId: string | null }> {
  const { add, ...fields } = patch;
  await checkFollowed(ctx, fields.accountId);
  type Moved = { goal: { id: string; name: string; target: number }; before: number; after: number };
  let moved: Moved | null = null;
  // One transaction with the goal locked, so two changes at once (two phones, a double tap) can't
  // both read the same amount: what's saved and the list of deposits always agree.
  const result = await ctx.db.transaction(async (tx) => {
    const [goal] = await tx
      .select({ id: goals.id, saved: goals.saved, name: goals.name, target: goals.target, accountId: goals.accountId })
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, ctx.userId)))
      .for("update")
      .limit(1);
    if (!goal) throw new HttpError(404, "Goal not found.");
    if (add && (fields.accountId ?? goal.accountId)) throw new HttpError(400, "This goal follows an account, so it updates on its own as that account’s balance changes.");
    // Never below zero: taking out more than is there takes out what is there.
    const change = add ? Math.max(-goal.saved, add) : 0;
    if (change) {
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(goalDeposits).where(eq(goalDeposits.userId, ctx.userId));
      if (count >= MAX_DEPOSITS * 10) throw new HttpError(400, "That’s more deposits than Passbook keeps. Delete an old goal first.");
    }
    const set: Record<string, unknown> = { ...fields };
    if (change) set.saved = goal.saved + change;
    // Stopping following an account keeps what it had as what's saved, so the goal doesn't drop to zero.
    if (fields.accountId === null && goal.accountId) {
      const [a] = await tx.select({ balance: accounts.balance }).from(accounts).where(and(eq(accounts.id, goal.accountId), eq(accounts.userId, ctx.userId))).limit(1);
      if (a) set.saved = Math.max(0, a.balance);
    }
    if (Object.keys(set).length > 0) await tx.update(goals).set(set).where(and(eq(goals.id, goal.id), eq(goals.userId, ctx.userId)));
    if (!change) return { depositId: null };
    const depositId = crypto.randomUUID();
    await tx.insert(goalDeposits).values({ id: depositId, userId: ctx.userId, goalId: goal.id, amount: change, date: ctx.today });
    moved = { goal: { id: goal.id, name: fields.name ?? goal.name, target: fields.target ?? goal.target }, before: goal.saved, after: goal.saved + change };
    return { depositId };
  });
  // Wins are written after the change is saved, never inside it, so they can't hold it up.
  const done = moved as Moved | null;
  if (done && result.depositId && done.after > done.before) {
    await win(ctx, "save", result.depositId, done.goal.name);
    await goalMilestones(ctx, done.goal, done.before, done.after);
  }
  return result;
}

/**
 * Removes one deposit (what Undo does) and takes its amount back off the goal.
 * Refused if that money has since been taken out, so Undo can never make
 * money appear on paper.
 */
export async function deleteDeposit(ctx: Ctx, goalId: string, depositId: string) {
  const after = await ctx.db.transaction(async (tx) => {
    const [goal] = await tx.select({ saved: goals.saved, target: goals.target }).from(goals).where(and(eq(goals.id, goalId), eq(goals.userId, ctx.userId))).for("update").limit(1);
    const [deposit] = goal
      ? await tx.select({ amount: goalDeposits.amount }).from(goalDeposits).where(and(eq(goalDeposits.id, depositId), eq(goalDeposits.goalId, goalId), eq(goalDeposits.userId, ctx.userId))).limit(1)
      : [];
    if (!goal || !deposit) throw new HttpError(404, "That deposit wasn’t found.");
    if (goal.saved - deposit.amount < 0) throw new HttpError(409, "That money has already been taken out of the goal, so there’s nothing to undo.");
    await tx.delete(goalDeposits).where(and(eq(goalDeposits.id, depositId), eq(goalDeposits.userId, ctx.userId)));
    await tx.update(goals).set({ saved: goal.saved - deposit.amount }).where(and(eq(goals.id, goalId), eq(goals.userId, ctx.userId)));
    return { saved: goal.saved - deposit.amount, target: goal.target };
  });
  await takeBack(ctx, "save", depositId);
  await undoGoalMilestones(ctx, { id: goalId, target: after.target }, after.saved);
}

export async function deleteGoal(ctx: Ctx, id: string) {
  const deposits = await ctx.db.select({ id: goalDeposits.id }).from(goalDeposits).where(and(eq(goalDeposits.goalId, id), eq(goalDeposits.userId, ctx.userId)));
  await ctx.db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, ctx.userId)));
  // A goal removed the day it was made (or its Undo) takes back everything it earned today.
  await takeBack(ctx, "goal", id);
  await takeBack(ctx, "milestone", MILESTONES.map((pct) => `${id}:${pct}`));
  await takeBack(ctx, "save", deposits.map((d) => d.id));
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
  const debt = row.type === "credit" || row.type === "loan" || row.balance < 0;
  const balance = patch.value === undefined ? row.balance : debt ? -Math.abs(patch.value) : Math.abs(patch.value);
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
  await win(ctx, "plan", `${monthOf(ctx.today)}:settings`, "Payoff plan");
}

/** The interest rate and monthly payment for one debt, when the bank doesn't say or the owner knows better. */
export async function setDebtPlan(ctx: Ctx, accountId: string, patch: { aprPercent?: number | null; monthlyPayment?: number | null }) {
  const [account] = await ctx.db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId))).limit(1);
  if (!account) throw new HttpError(404, "Account not found.");
  await ctx.db
    .insert(debtPlans)
    .values({ accountId, userId: ctx.userId, aprPercent: patch.aprPercent ?? null, monthlyPayment: patch.monthlyPayment ?? null })
    .onConflictDoUpdate({ target: debtPlans.accountId, set: { ...(patch.aprPercent !== undefined ? { aprPercent: patch.aprPercent } : {}), ...(patch.monthlyPayment !== undefined ? { monthlyPayment: patch.monthlyPayment } : {}) } });
  await win(ctx, "plan", `${monthOf(ctx.today)}:${account.id}`, account.name);
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * "This paycheck will be lighter": what one coming paycheck is expected to be (missed days, say), so the
 * month re-plans around it; null goes back to the usual. Returns what it was, for Undo.
 */
export async function setPaycheck(ctx: Ctx, key: string, date: string, amount: number | null): Promise<{ previous: number | null }> {
  if (!key.startsWith("in:")) throw new HttpError(400, "That isn’t a paycheck.");
  if (!DAY.test(date) || date < addDays(ctx.today, -10) || date > addDays(ctx.today, 400)) throw new HttpError(400, "Pick a paycheck that hasn’t come in yet.");
  if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000)) throw new HttpError(400, "Enter an amount, like 750.");
  const mine = and(eq(incomeAdjustments.userId, ctx.userId), eq(incomeAdjustments.seriesKey, key), eq(incomeAdjustments.date, date));
  const [row] = await ctx.db.select({ amount: incomeAdjustments.amount }).from(incomeAdjustments).where(mine).limit(1);
  if (amount === null) await ctx.db.delete(incomeAdjustments).where(mine);
  else {
    await ctx.db
      .insert(incomeAdjustments)
      .values({ id: crypto.randomUUID(), userId: ctx.userId, seriesKey: key, date, amount })
      .onConflictDoUpdate({ target: [incomeAdjustments.userId, incomeAdjustments.seriesKey, incomeAdjustments.date], set: { amount } });
  }
  return { previous: row?.amount ?? null };
}
