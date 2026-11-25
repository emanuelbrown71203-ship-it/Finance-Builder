import { addDays, diffDays, monthOf, monthStart, type ISODate } from "../dates";

/*
 * Savings as something to do, each paycheck. A goal saves either a share of each paycheck (5%) or a set
 * amount a month (split across the month's paychecks). Each paycheck's savings is a to-do that ticks itself
 * off as money goes toward the goal: into the account it follows (a SoFi vault), or recorded by hand. The
 * person can save less this time or skip one; only those choices are kept. Pure: worked out on read.
 */

export type SavingGoal = {
  id: string;
  name: string;
  monthlyContribution: number;
  /** A share of each paycheck (0.05 = 5%), instead of a set amount a month. */
  paycheckShare: number | null;
  reached: boolean;
  account: { id: string; name: string } | null;
};

export type SavingPaycheck = { date: ISODate; amount: number; received: boolean };
/** "Save less this time" (amount) or "skip this one" (0), for one goal and paycheck. */
export type SavingMark = { goalId: string; date: ISODate; amount: number };
/** Money that went toward a goal: into its account, or recorded by hand. */
export type PutIn = { goalId: string; date: ISODate; amount: number };

export type SavingStatus = "done" | "partly" | "todo" | "coming" | "skipped";

export type SavingTodo = {
  goalId: string;
  goalName: string;
  account: { id: string; name: string } | null;
  /** The paycheck it comes from, or the 1st with no paycheck to go by. */
  date: ISODate;
  /** What the plan says. */
  planned: number;
  /** What's to be saved: the plan, or the person's own amount for this one (0 is skipped). */
  amount: number;
  /** The paycheck's amount, and the share of it, when the goal saves a share of each. */
  paycheck: number | null;
  share: number | null;
  /** The person changed this one (saved less, or skipped it). */
  changed: boolean;
  /** Put toward it so far. */
  saved: number;
  status: SavingStatus;
};

export function savingTodos(args: { month: string; today: ISODate; goals: SavingGoal[]; paychecks: SavingPaycheck[]; marks: SavingMark[]; putIn?: PutIn[] }): SavingTodo[] {
  const { month, today, goals, marks, putIn = [] } = args;
  const paychecks = args.paychecks.filter((p) => monthOf(p.date) === month).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const todos: SavingTodo[] = [];
  for (const g of goals) {
    if (g.reached) continue;
    const plan: { date: ISODate; planned: number; paycheck: number | null; share: number | null; due: boolean }[] = [];
    if (g.paycheckShare && g.paycheckShare > 0) {
      for (const p of paychecks) plan.push({ date: p.date, planned: Math.round(p.amount * g.paycheckShare), paycheck: p.amount, share: g.paycheckShare, due: p.received });
    } else if (g.monthlyContribution > 0) {
      if (paychecks.length > 0) {
        const each = Math.floor(g.monthlyContribution / paychecks.length);
        paychecks.forEach((p, i) => plan.push({ date: p.date, planned: each + (i === 0 ? g.monthlyContribution - each * paychecks.length : 0), paycheck: p.amount, share: null, due: p.received }));
      } else {
        plan.push({ date: monthStart(month), planned: g.monthlyContribution, paycheck: null, share: null, due: monthStart(month) <= today });
      }
    }
    // What went toward the goal this month covers its to-dos in order, the earliest first.
    let pool = putIn.filter((d) => d.goalId === g.id && monthOf(d.date) === month && d.amount > 0).reduce((s, d) => s + d.amount, 0);
    for (const x of plan) {
      const mark = marks.find((m) => m.goalId === g.id && m.date === x.date);
      const amount = mark ? Math.max(0, mark.amount) : x.planned;
      const saved = Math.min(amount, pool);
      pool -= saved;
      const status: SavingStatus = amount === 0 ? "skipped" : saved >= amount ? "done" : saved > 0 ? "partly" : x.due ? "todo" : "coming";
      todos.push({ goalId: g.id, goalName: g.name, account: g.account, date: x.date, planned: x.planned, amount, paycheck: x.paycheck, share: x.share, changed: !!mark, saved, status });
    }
  }
  return todos.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.goalName.localeCompare(b.goalName)));
}

export type SavingTotals = { planned: number; saved: number; toDo: number; coming: number };

export function savingTotals(todos: SavingTodo[]): SavingTotals {
  let planned = 0;
  let saved = 0;
  let toDo = 0;
  let coming = 0;
  for (const t of todos) {
    planned += t.amount;
    saved += t.saved;
    if (t.status === "todo" || t.status === "partly") toDo += t.amount - t.saved;
    if (t.status === "coming") coming += t.amount;
  }
  return { planned, saved, toDo, coming };
}

/** A to-do waiting since its paycheck: worth a reminder from the day after (an automatic transfer may take a day to show). */
export function overdueSaving(t: SavingTodo, today: ISODate, days = 1): boolean {
  return (t.status === "todo" || t.status === "partly") && diffDays(today, t.date) >= days;
}

export type SavingHabit = { accountId: string; accountName: string; share: number };

/**
 * A saving habit already in place: the same share of each recent paycheck moving into one savings account
 * on payday (or the day after), like SoFi's "save a percentage of each deposit". Needs the last two
 * paychecks or more, each within a tenth of a percent of the others. The share is rounded to the nearest
 * quarter percent.
 */
export function savingHabit(paychecks: { date: ISODate; amount: number }[], inflows: { accountId: string; accountName: string; date: ISODate; amount: number }[]): SavingHabit | null {
  const recent = [...paychecks].filter((p) => p.amount > 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  if (recent.length < 2) return null;
  const accounts = [...new Set(inflows.map((i) => i.accountId))];
  let best: SavingHabit | null = null;
  const onPayday = (i: { date: ISODate }, p: { date: ISODate }) => i.date === p.date || i.date === addDays(p.date, 1);
  let bestCount = 0;
  for (const accountId of accounts) {
    const into = inflows.filter((i) => i.accountId === accountId && i.amount > 0);
    // Any move on the latest payday could be the habit (there may be others that day): try each one's share
    // against the paychecks before it.
    for (const first of into.filter((i) => onPayday(i, recent[0]))) {
      const share = first.amount / recent[0].amount;
      if (share >= 0.5) continue;
      let count = 1;
      for (const p of recent.slice(1)) {
        if (!into.some((i) => onPayday(i, p) && Math.abs(i.amount / p.amount - share) <= 0.001)) break;
        count++;
      }
      const rounded = Math.round(share * 400) / 400;
      if (count >= 2 && rounded > 0 && count > bestCount) {
        best = { accountId, accountName: first.accountName, share: rounded };
        bestCount = count;
      }
    }
  }
  return best;
}

/** "5%", "2.5%". */
export function sharePercent(share: number): string {
  const pct = Math.round(share * 10_000) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(pct * 10 === Math.round(pct * 10) ? 1 : 2)}%`;
}
