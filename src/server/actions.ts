import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { accounts, activityLog, debtPlans, goalDeposits, goals, nameRules, transactions } from "@/db/schema";
import { formatShort, monthOf, type ISODate } from "@/lib/dates";
import { validName } from "@/lib/finance/names";
import { FREQUENCY_LABEL, type Frequency } from "@/lib/finance/recurring";
import { dollarsExact } from "@/lib/money";
import type { ActivityItem } from "@/lib/types";
import type { Ctx } from "./auth";
import { HttpError } from "./http";
import { createManualBill, deleteManualBill, nextDue, type BillFrequencyChoice } from "./manual-bills";
import { createGoal, deleteDeposit, deleteGoal, setDebtPlan, updateGoal } from "./mutations";
import { takeBack } from "./game";
import { createNameRule, deleteNameRule, loadNamer, renameRule, restoreNameRule, type NameUndo } from "./names";

/*
 * The changes Nickel and Claude can make when the owner asks: add a bill
 * (repeating or one-off), add a savings goal, change a goal or put money
 * toward it, change a loan's rate or payment, and rename charges.
 *
 * Every one is written to the activity list with exactly what it takes to put
 * it back, and shown in Passbook with Undo. None of them deletes anything the
 * owner made, and none touches bank connections, sign-in or keys.
 */

export type Agent = "nickel" | "claude";

/** A field that was changed: what it was, and what it was set to. Undo only puts it back if it's still `to`. */
type Change<T> = { from: T; to: T };
type GoalChanges = Partial<{ name: Change<string>; target: Change<number>; targetDate: Change<string | null>; monthlyContribution: Change<number> }>;
type LoanChanges = Partial<{ aprPercent: Change<number | null>; monthlyPayment: Change<number | null> }>;

type Undo =
  | { type: "bill.remove"; billId: string }
  | { type: "goal.remove"; goalId: string }
  | { type: "goal.restore"; goalId: string; changes: GoalChanges }
  | { type: "deposit.remove"; goalId: string; depositId: string }
  | { type: "loan.restore"; accountId: string; changes: LoanChanges }
  | { type: "name.undo"; undo: NameUndo; name: string };

export type Done = { activityId: string; summary: string; href: string };

const MAX_ACTIVITY = 1000;
/** Changes older than this can't be undone from the list any more (what they touched may have moved on). */
const UNDO_DAYS = 30;

async function record(ctx: Ctx, actor: Agent, summary: string, undo: Undo): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.db.insert(activityLog).values({ id, userId: ctx.userId, actor, summary: summary.slice(0, 300), undo });
  // Keep the list from growing for ever, but never drop a change that can still be undone:
  // only entries past their 30 days, or already undone, go.
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(activityLog).where(eq(activityLog.userId, ctx.userId));
  if (count > MAX_ACTIVITY) {
    const cutoff = new Date(Date.now() - UNDO_DAYS * 86_400_000);
    const old = await ctx.db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(and(eq(activityLog.userId, ctx.userId), or(lt(activityLog.createdAt, cutoff), isNotNull(activityLog.undoneAt))))
      .orderBy(asc(activityLog.createdAt))
      .limit(Math.min(500, count - MAX_ACTIVITY));
    if (old.length > 0) await ctx.db.delete(activityLog).where(and(eq(activityLog.userId, ctx.userId), inArray(activityLog.id, old.map((o) => o.id))));
  }
  return id;
}

const money = (cents: number) => dollarsExact(Math.abs(cents));

/* ---------- finding what the owner means ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** One item whose name matches what was said: exact first, then a clear partial match. Asks when it's ambiguous. */
function pick<T extends { id: string; name: string }>(items: T[], said: string, what: string): T {
  const s = norm(said);
  if (!s) throw new HttpError(400, `Which ${what}?`);
  const byId = items.find((i) => i.id === said);
  if (byId) return byId;
  const exact = items.filter((i) => norm(i.name) === s);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((i) => norm(i.name).includes(s) || s.includes(norm(i.name)) || s.split(" ").some((w) => w.length >= 4 && norm(i.name).split(" ").includes(w)));
  if (partial.length === 1) return partial[0];
  const names = (partial.length > 1 ? partial : items).map((i) => i.name).slice(0, 8);
  throw new HttpError(400, partial.length > 1 ? `More than one ${what} matches “${said.slice(0, 40)}”: ${names.join(", ")}. Which one?` : `No ${what} called “${said.slice(0, 40)}”.${names.length ? ` There’s ${names.join(", ")}.` : ""}`);
}

export async function findGoal(ctx: Ctx, said: string) {
  const rows = await ctx.db.select().from(goals).where(eq(goals.userId, ctx.userId));
  return pick(rows, said, "goal");
}

/** Loans and cards: anything owed. */
export async function findDebt(ctx: Ctx, said: string) {
  const rows = await ctx.db
    .select({ id: accounts.id, name: accounts.name, balance: accounts.balance, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, ctx.userId), lt(accounts.balance, 0)));
  return pick(rows.filter((r) => r.type === "loan" || r.type === "credit"), said, "loan or card");
}

/** The newest charge whose shown name or bank text matches, for renaming everything like it. */
export async function findCharge(ctx: Ctx, said: string, amount?: number) {
  const s = norm(said);
  if (!s) throw new HttpError(400, "Which charge?");
  const [nameFor, rows] = await Promise.all([
    loadNamer(ctx),
    ctx.db
      .select({ id: transactions.id, name: transactions.name, rawName: transactions.rawName, amount: transactions.amount, customName: transactions.customName })
      .from(transactions)
      .where(eq(transactions.userId, ctx.userId))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(5000),
  ]);
  // "Only at $1,200": the charge must be exactly that much (money out or in).
  const pool = rows.filter((t) => !t.customName && (amount === undefined || Math.abs(t.amount) === amount)).map((t) => ({ t, named: nameFor(t) }));
  // By the name it shows: a name kept for one amount ("Rent" for Venmo payments of $1,200) is renamed at that amount only.
  const shown = pool.find((c) => norm(c.named.name) === s) ?? pool.find((c) => norm(c.named.name).includes(s));
  if (shown) return { ...shown.t, shown: shown.named.name, exact: shown.named.exact };
  // By the bank's text ("Venmo"): every charge like it, so start from one that isn't under a one-amount name.
  const bank = pool.filter((c) => [c.t.name, c.t.rawName ?? ""].map(norm).some((n) => n === s || n.includes(s)));
  const pick = bank.find((c) => !c.named.exact) ?? bank[0];
  if (!pick) throw new HttpError(400, `No charge called “${said.slice(0, 40)}”${amount !== undefined ? ` for ${money(amount)}` : ""} turned up.`);
  return { ...pick.t, shown: pick.named.name, exact: false };
}

/* ---------- the changes ---------- */

export async function addBill(
  ctx: Ctx,
  actor: Agent,
  input: { name: string; amount: number; frequency: BillFrequencyChoice; date: ISODate; kind?: "bill" | "subscription" },
): Promise<Done> {
  const bill = await createManualBill(ctx, { name: input.name, amount: input.amount, frequency: input.frequency, startDate: input.date, kind: input.kind }, actor);
  const next = nextDue({ frequency: input.frequency, startDate: input.date }, ctx.today);
  const when = input.frequency === "once" ? `due ${formatShort(input.date)}` : `${FREQUENCY_LABEL[input.frequency as Frequency].toLowerCase()}, next on ${formatShort(next)}`;
  const summary = `Added ${input.frequency === "once" ? "an upcoming bill" : input.kind === "subscription" ? "a subscription" : "a bill"}: ${bill.name}, ${money(bill.amount)} ${when}.`;
  const activityId = await record(ctx, actor, summary, { type: "bill.remove", billId: bill.id });
  return { activityId, summary, href: "/bills" };
}

export async function addGoal(ctx: Ctx, actor: Agent, input: { name: string; target: number; targetDate: ISODate | null; saved?: number }): Promise<Done> {
  const name = validName(input.name);
  if (!name) throw new HttpError(400, "Give the goal a name of up to 60 letters.");
  if (!Number.isSafeInteger(input.target) || input.target < 100 || input.target > 100_000_000_00) throw new HttpError(400, "Enter how much the goal needs, like 3000.");
  const saved = input.saved ?? 0;
  if (!Number.isSafeInteger(saved) || saved < 0 || saved > input.target * 10) throw new HttpError(400, "Enter what’s already saved, like 500.");
  if (input.targetDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate) || input.targetDate <= ctx.today)) throw new HttpError(400, "Pick a date after today for the goal.");
  const created = { id: await createGoal(ctx, { name, target: input.target, saved, monthlyContribution: 0, targetDate: input.targetDate }) };
  const summary = `Added a savings goal: ${name}, ${money(input.target)}${input.targetDate ? ` by ${formatShort(input.targetDate)}` : ""}.`;
  const activityId = await record(ctx, actor, summary, { type: "goal.remove", goalId: created.id });
  return { activityId, summary, href: `/savings/goal?id=${encodeURIComponent(created.id)}` };
}

export async function changeGoal(
  ctx: Ctx,
  actor: Agent,
  goalId: string,
  patch: { name?: string; target?: number; targetDate?: ISODate | null; monthlyContribution?: number },
): Promise<Done> {
  const [goal] = await ctx.db.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.userId, ctx.userId))).limit(1);
  if (!goal) throw new HttpError(404, "Goal not found.");
  const fields: Partial<{ name: string; target: number; targetDate: string | null; monthlyContribution: number }> = {};
  const said: string[] = [];
  if (patch.name !== undefined) {
    const name = validName(patch.name);
    if (!name) throw new HttpError(400, "Give the goal a name of up to 60 letters.");
    fields.name = name;
    said.push(`renamed it ${name}`);
  }
  if (patch.target !== undefined) {
    if (!Number.isSafeInteger(patch.target) || patch.target < 100 || patch.target > 100_000_000_00) throw new HttpError(400, "Enter how much the goal needs, like 3000.");
    fields.target = patch.target;
    said.push(`target ${money(patch.target)}`);
  }
  if (patch.targetDate !== undefined) {
    if (patch.targetDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(patch.targetDate) || patch.targetDate <= ctx.today)) throw new HttpError(400, "Pick a date after today for the goal.");
    fields.targetDate = patch.targetDate;
    said.push(patch.targetDate ? `date ${formatShort(patch.targetDate)}` : "no date");
  }
  if (patch.monthlyContribution !== undefined) {
    if (!Number.isSafeInteger(patch.monthlyContribution) || patch.monthlyContribution < 0 || patch.monthlyContribution > 10_000_000_00) throw new HttpError(400, "Enter a monthly amount, like 250.");
    fields.monthlyContribution = patch.monthlyContribution;
    said.push(`${money(patch.monthlyContribution)} a month`);
  }
  if (said.length === 0) throw new HttpError(400, "What should change about the goal?");
  await updateGoal(ctx, goal.id, fields);
  const summary = `Changed the goal ${goal.name}: ${said.join(", ")}.`;
  const changes: GoalChanges = {};
  if (fields.name !== undefined) changes.name = { from: goal.name, to: fields.name };
  if (fields.target !== undefined) changes.target = { from: goal.target, to: fields.target };
  if (fields.targetDate !== undefined) changes.targetDate = { from: goal.targetDate, to: fields.targetDate };
  if (fields.monthlyContribution !== undefined) changes.monthlyContribution = { from: goal.monthlyContribution, to: fields.monthlyContribution };
  const activityId = await record(ctx, actor, summary, { type: "goal.restore", goalId: goal.id, changes });
  return { activityId, summary, href: `/savings/goal?id=${encodeURIComponent(goal.id)}` };
}

export async function addToGoal(ctx: Ctx, actor: Agent, goalId: string, amount: number): Promise<Done> {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10_000_000_00) throw new HttpError(400, "Enter an amount to put toward the goal, like 100.");
  const [goal] = await ctx.db.select({ id: goals.id, name: goals.name }).from(goals).where(and(eq(goals.id, goalId), eq(goals.userId, ctx.userId))).limit(1);
  if (!goal) throw new HttpError(404, "Goal not found.");
  const { depositId } = await updateGoal(ctx, goal.id, { add: amount });
  const summary = `Put ${money(amount)} toward ${goal.name}. No money moved at the bank.`;
  const activityId = await record(ctx, actor, summary, { type: "deposit.remove", goalId: goal.id, depositId: depositId! });
  return { activityId, summary, href: `/savings/goal?id=${encodeURIComponent(goal.id)}` };
}

export async function changeLoan(ctx: Ctx, actor: Agent, accountId: string, patch: { aprPercent?: number | null; monthlyPayment?: number | null }): Promise<Done> {
  const [account] = await ctx.db.select({ id: accounts.id, name: accounts.name, balance: accounts.balance, type: accounts.type }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, ctx.userId))).limit(1);
  if (!account || account.balance >= 0) throw new HttpError(404, "That loan wasn’t found.");
  if (patch.aprPercent !== undefined && patch.aprPercent !== null && !(patch.aprPercent >= 0 && patch.aprPercent <= 99)) throw new HttpError(400, "Enter an interest rate between 0 and 99%.");
  if (patch.monthlyPayment !== undefined && patch.monthlyPayment !== null && !(Number.isSafeInteger(patch.monthlyPayment) && patch.monthlyPayment > 0 && patch.monthlyPayment <= 10_000_000_00)) throw new HttpError(400, "Enter a monthly payment, like 350.");
  if (patch.aprPercent === undefined && patch.monthlyPayment === undefined) throw new HttpError(400, "What should change about the loan?");
  const [plan] = await ctx.db.select().from(debtPlans).where(and(eq(debtPlans.accountId, account.id), eq(debtPlans.userId, ctx.userId))).limit(1);
  await setDebtPlan(ctx, account.id, patch);
  const said = [patch.aprPercent !== undefined && patch.aprPercent !== null ? `interest ${patch.aprPercent}%` : "", patch.monthlyPayment ? `payment ${money(patch.monthlyPayment)} a month` : ""].filter(Boolean);
  const summary = `Changed ${account.name}: ${said.join(", ")}.`;
  const changes: LoanChanges = {};
  if (patch.aprPercent !== undefined) changes.aprPercent = { from: plan?.aprPercent ?? null, to: patch.aprPercent };
  if (patch.monthlyPayment !== undefined) changes.monthlyPayment = { from: plan?.monthlyPayment ?? null, to: patch.monthlyPayment };
  const activityId = await record(ctx, actor, summary, { type: "loan.restore", accountId: account.id, changes });
  return { activityId, summary, href: "/debt" };
}

export async function renameCharges(ctx: Ctx, actor: Agent, transactionId: string, name: string, onlyThisAmount = false): Promise<Done> {
  const result = await createNameRule(ctx, { transactionId, name, onlyThisAmount, keepOneAmountNames: true });
  const clean = validName(name)!;
  const summary = `Renamed ${result.count === 1 ? "a charge" : `${result.count} charges`} to ${clean}${onlyThisAmount ? " (only at that amount)" : ""}. New ones will be too.`;
  const activityId = await record(ctx, actor, summary, { type: "name.undo", undo: result.undo, name: clean });
  return { activityId, summary, href: "/transactions/names" };
}

/* ---------- the list, and Undo ---------- */

export async function listActivity(ctx: Ctx, limit = 50): Promise<ActivityItem[]> {
  const rows = await ctx.db.select().from(activityLog).where(eq(activityLog.userId, ctx.userId)).orderBy(desc(activityLog.createdAt)).limit(Math.min(200, limit));
  const cutoff = Date.now() - UNDO_DAYS * 86_400_000;
  return rows.map((r) => ({ id: r.id, actor: r.actor === "claude" ? "claude" : "nickel", summary: r.summary, createdAt: r.createdAt.toISOString(), undone: r.undoneAt !== null, canUndo: r.undoneAt === null && r.createdAt.getTime() > cutoff }));
}

export async function undoActivity(ctx: Ctx, id: string): Promise<{ summary: string }> {
  const [row] = await ctx.db.select().from(activityLog).where(and(eq(activityLog.id, id), eq(activityLog.userId, ctx.userId))).limit(1);
  if (!row) throw new HttpError(404, "That change isn’t in the list.");
  if (row.undoneAt) throw new HttpError(409, "That change was already undone.");
  if (row.createdAt.getTime() < Date.now() - UNDO_DAYS * 86_400_000) throw new HttpError(409, "That change is too old to undo from here. Change it on its own screen instead.");
  // Claim it first, so two taps can't undo it twice.
  const claimed = await ctx.db
    .update(activityLog)
    .set({ undoneAt: new Date() })
    .where(and(eq(activityLog.id, id), eq(activityLog.userId, ctx.userId), isNull(activityLog.undoneAt)))
    .returning({ id: activityLog.id });
  if (claimed.length === 0) throw new HttpError(409, "That change was already undone.");
  try {
    await reverse(ctx, row.undo as Undo);
  } catch (e) {
    await ctx.db.update(activityLog).set({ undoneAt: null }).where(and(eq(activityLog.id, id), eq(activityLog.userId, ctx.userId)));
    throw e;
  }
  return { summary: row.summary };
}

/**
 * Puts back what one change did, and only that: a field the owner has changed
 * again since is left as they set it.
 */
async function reverse(ctx: Ctx, undo: Undo) {
  switch (undo.type) {
    case "bill.remove":
      await deleteManualBill(ctx, undo.billId).catch((e) => {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      });
      return;
    case "goal.remove": {
      // Only take a goal away if nothing has been put into it since: that money would vanish from view.
      const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(goalDeposits).where(and(eq(goalDeposits.goalId, undo.goalId), eq(goalDeposits.userId, ctx.userId)));
      if (count > 0) throw new HttpError(409, "Money has been put into that goal since, so it wasn’t removed. Delete it from the goal itself if you’re sure.");
      await deleteGoal(ctx, undo.goalId);
      return;
    }
    case "goal.restore": {
      const [goal] = await ctx.db.select().from(goals).where(and(eq(goals.id, undo.goalId), eq(goals.userId, ctx.userId))).limit(1);
      if (!goal) throw new HttpError(404, "That goal isn’t there any more.");
      const back: Record<string, unknown> = {};
      for (const [field, change] of Object.entries(undo.changes) as [keyof GoalChanges, Change<unknown>][]) {
        if (change && goal[field] === change.to) back[field] = change.from;
      }
      if (Object.keys(back).length === 0) throw new HttpError(409, "That goal has been changed again since, so there’s nothing to put back.");
      await updateGoal(ctx, goal.id, back);
      return;
    }
    case "deposit.remove":
      await deleteDeposit(ctx, undo.goalId, undo.depositId);
      return;
    case "loan.restore": {
      const [plan] = await ctx.db.select().from(debtPlans).where(and(eq(debtPlans.accountId, undo.accountId), eq(debtPlans.userId, ctx.userId))).limit(1);
      const back: { aprPercent?: number | null; monthlyPayment?: number | null } = {};
      if (undo.changes.aprPercent && (plan?.aprPercent ?? null) === undo.changes.aprPercent.to) back.aprPercent = undo.changes.aprPercent.from;
      if (undo.changes.monthlyPayment && (plan?.monthlyPayment ?? null) === undo.changes.monthlyPayment.to) back.monthlyPayment = undo.changes.monthlyPayment.from;
      if (Object.keys(back).length === 0) throw new HttpError(409, "That loan has been changed again since, so there’s nothing to put back.");
      await setDebtPlan(ctx, undo.accountId, back);
      await takeBack(ctx, "plan", `${monthOf(ctx.today)}:${undo.accountId}`);
      return;
    }
    case "name.undo": {
      const u = undo.undo;
      const [rule] = await ctx.db.select({ name: nameRules.name }).from(nameRules).where(and(eq(nameRules.id, u.ruleId), eq(nameRules.userId, ctx.userId))).limit(1);
      // A name the owner has changed again since stays as they set it.
      if (rule && rule.name === undo.name) {
        if (u.previousName === null) await deleteNameRule(ctx, u.ruleId);
        else await renameRule(ctx, u.ruleId, u.previousName);
      }
      if (u.replaced) {
        const [taken] = await ctx.db.select({ id: nameRules.id }).from(nameRules).where(and(eq(nameRules.userId, ctx.userId), eq(nameRules.merchantKey, u.key), eq(nameRules.amount, u.replaced.amount))).limit(1);
        if (!taken) await restoreNameRule(ctx, { key: u.key, amount: u.replaced.amount, name: u.replaced.name });
      }
      if (u.customName) await ctx.db.update(transactions).set({ customName: u.customName }).where(and(eq(transactions.id, u.transactionId), eq(transactions.userId, ctx.userId), isNull(transactions.customName)));
      return;
    }
  }
}
