import { isNecessity } from "../categories";
import { addMonthsToMonth, dayOfMonth, monthEnd, monthOf, type ISODate } from "../dates";

/*
 * The budget, worked out from the transactions each time.
 *
 * A category's budget is for everyday spending, Extras (subscriptions) included. Bills (necessities) are
 * planned on their own (they come out of the month first), so rent never eats
 * into a budget; it's shown beside its category instead. Netflix, an Extra,
 * counts in Entertainment like any other spending.
 *
 * For each category: what's been spent, what's left (with anything carried
 * over from earlier months when rollover is on), what that leaves per day,
 * where the month is likely to end at the usual pace, and so whether it's on
 * track, worth watching, or over.
 */

export type BudgetTx = { id: string; date: ISODate; amount: number; category: string };

export type Limit = {
  category: string;
  /** Cents a month. */
  limit: number;
  /** With rollover on: the first month whose leftover (or overspend) carries forward. */
  rolloverSince: string | null;
  /** Carried into `rolloverSince` from before it (kept when the limit changed, so earlier months keep their own limit). */
  rolloverCarry?: number;
};

export type BudgetStatus = "none" | "good" | "watch" | "over";

export type CategoryBudget = {
  category: string;
  /** Everyday spending this month, in cents (refunds take it down). */
  spent: number;
  /** Bills (necessities) paid from this category this month: planned separately, not counted against the budget. */
  bills: number;
  limit: number | null;
  rollover: boolean;
  /** Carried in from earlier months with rollover on: positive is unspent, negative is overspent. */
  carried: number;
  /** limit + carried − spent. Null without a limit. */
  left: number | null;
  /** What's left spread over the days remaining, today included. Null without a limit or once the month is over. */
  perDay: number | null;
  /** Where spending is likely to end up by the month's last day, at the usual pace. */
  forecast: number;
  /** Where spending would be by today if the budget were spent evenly through the month. */
  paceNow: number | null;
  status: BudgetStatus;
  lastMonth: number;
  /** Bills paid from this category last month. */
  lastMonthBills: number;
  /** Everyday spending a month, averaged over the three months before this one. */
  average: number;
  /** Everyday spending for the six months to this one, oldest first. */
  history: { month: string; spent: number }[];
};

/** Categories whose spending is never budgeted: money moving between your own accounts, and money coming in. */
const NOT_SPENDING = new Set(["transfer", "income"]);
/** How far back a rollover can reach. */
const ROLLOVER_MONTHS = 12;

export function monthDays(month: string): number {
  return dayOfMonth(monthEnd(month));
}

/** How far through `month` today is. */
export function monthProgress(month: string, today: ISODate) {
  const days = monthDays(month);
  const now = monthOf(today);
  if (month < now) return { days, elapsed: days, daysLeft: 0, after: 0, isCurrent: false };
  if (month > now) return { days, elapsed: 0, daysLeft: days, after: days, isCurrent: false };
  const day = dayOfMonth(today);
  return { days, elapsed: day, daysLeft: days - day + 1, after: days - day, isCurrent: true };
}

/** Everyday spending by month and category (cents, positive is spent). */
export function everydayByMonth(history: BudgetTx[], billIds: Set<string>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const t of history) {
    if (NOT_SPENDING.has(t.category) || billIds.has(t.id)) continue;
    const m = monthOf(t.date);
    let cats = out.get(m);
    if (!cats) out.set(m, (cats = new Map()));
    cats.set(t.category, (cats.get(t.category) ?? 0) - t.amount);
  }
  return out;
}

export function categoryBudgets(args: { month: string; today: ISODate; history: BudgetTx[]; billIds: Set<string>; limits: Limit[] }): CategoryBudget[] {
  const { month, today, history, billIds, limits } = args;
  const byMonth = everydayByMonth(history, billIds);
  const spentIn = (m: string, c: string) => byMonth.get(m)?.get(c) ?? 0;
  const last = addMonthsToMonth(month, -1);
  const bills = new Map<string, number>();
  const lastBills = new Map<string, number>();
  for (const t of history) {
    if (!billIds.has(t.id) || NOT_SPENDING.has(t.category)) continue;
    const m = monthOf(t.date);
    if (m === month) bills.set(t.category, (bills.get(t.category) ?? 0) - t.amount);
    else if (m === last) lastBills.set(t.category, (lastBills.get(t.category) ?? 0) - t.amount);
  }
  const limitFor = new Map(limits.map((l) => [l.category, l]));
  const p = monthProgress(month, today);

  // Every category with a limit, with spending this month or in the three before (so a new month can still be
  // planned), or with bills this month or last (so what's spent on rent or power is never left out).
  const spentIn3 = [0, 1, 2, 3].flatMap((n) => [...(byMonth.get(addMonthsToMonth(month, -n))?.entries() ?? [])].filter(([, v]) => v > 0).map(([k]) => k));
  const categories = new Set<string>([...limitFor.keys(), ...spentIn3, ...bills.keys(), ...lastBills.keys()]);
  const rows: CategoryBudget[] = [];
  for (const category of categories) {
    if (NOT_SPENDING.has(category)) continue;
    const own = limitFor.get(category);
    const spent = spentIn(month, category);
    const average = Math.round([1, 2, 3].reduce((s, n) => s + Math.max(0, spentIn(addMonthsToMonth(month, -n), category)), 0) / 3);
    const history6 = Array.from({ length: 6 }, (_, i) => addMonthsToMonth(month, i - 5)).map((m) => ({ month: m, spent: Math.max(0, spentIn(m, category)) }));

    // Rollover: what was carried into the month it (last) started, plus what each month since left
    // (or less what it overspent). Months before then aren't known at today's limit, so carry nothing.
    let carried = 0;
    if (own?.rolloverSince && own.rolloverSince <= month) {
      carried = own.rolloverCarry ?? 0;
      const earliest = addMonthsToMonth(month, -ROLLOVER_MONTHS);
      for (let m = own.rolloverSince < earliest ? earliest : own.rolloverSince; m < month; m = addMonthsToMonth(m, 1)) carried += own.limit - spentIn(m, category);
    }

    // The likely end of the month: what's spent, plus the rest of the month at a blend of the usual pace and this month's.
    let forecast = spent;
    if (p.isCurrent && p.after > 0) {
      const thisMonth = p.elapsed > 0 ? Math.max(0, spent) / p.elapsed : 0;
      const usual = average / p.days;
      forecast = Math.round(spent + p.after * (average > 0 ? (usual + thisMonth) / 2 : thisMonth));
    } else if (!p.isCurrent && p.elapsed === 0) {
      forecast = average;
    }

    const limit = own?.limit ?? null;
    const available = limit === null ? null : limit + carried;
    const left = available === null ? null : available - spent;
    const status: BudgetStatus = available === null || left === null ? "none" : left < 0 ? "over" : forecast > available + 100 ? "watch" : "good";
    rows.push({
      category,
      spent,
      bills: bills.get(category) ?? 0,
      limit,
      rollover: Boolean(own?.rolloverSince),
      carried,
      left,
      perDay: left === null || p.daysLeft === 0 ? null : Math.max(0, Math.floor(left / p.daysLeft)),
      forecast,
      paceNow: available === null ? null : Math.round((Math.max(0, available) * p.elapsed) / p.days),
      status,
      lastMonth: Math.max(0, spentIn(last, category)),
      lastMonthBills: lastBills.get(category) ?? 0,
      average,
      history: history6,
    });
  }
  // Ones that need a look first, then the rest with limits, then spending without a limit, biggest first.
  const rank: Record<BudgetStatus, number> = { over: 0, watch: 1, good: 2, none: 3 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || b.spent - a.spent);
}

/**
 * A starting budget from what's usually spent: each everyday category's
 * average over the last three months, rounded up to the next $10. If those
 * add up to more than the month has room for (money in, less bills and
 * saving), they're all trimmed by the same share so the plan fits.
 */
export function suggestLimits(rows: CategoryBudget[], room: number | null): { limits: { category: string; limit: number }[]; trimmed: boolean } {
  const picks = rows.filter((r) => r.average >= 1500 && r.category !== "fees" && !isNecessity(r.category)).map((r) => ({ category: r.category, limit: Math.ceil(r.average / 1000) * 1000 }));
  const total = picks.reduce((s, p) => s + p.limit, 0);
  if (room === null || room <= 0 || total <= room) return { limits: picks.sort((a, b) => b.limit - a.limit), trimmed: false };
  const share = room / total;
  return {
    limits: picks.map((p) => ({ category: p.category, limit: Math.max(500, Math.floor((p.limit * share) / 500) * 500) })).sort((a, b) => b.limit - a.limit),
    trimmed: true,
  };
}

/** Where the month's money goes: what comes in, bills, saving, everyday budgets, and what isn't planned yet. */
export function budgetPlan(args: { income: number; bills: number; saving: number; rows: CategoryBudget[] }) {
  // This month's money only: what's carried over came from earlier months.
  const budgeted = args.rows.reduce((s, r) => s + (r.limit === null ? 0 : Math.max(0, r.limit)), 0);
  return {
    income: args.income,
    bills: args.bills,
    saving: args.saving,
    budgeted,
    /** Positive: money with no job yet. Negative: the plan asks for more than comes in. */
    unplanned: args.income - args.bills - args.saving - budgeted,
    /** Carried over into this month's budgets from earlier ones (positive unspent, negative overspent). */
    carried: args.rows.reduce((s, r) => s + (r.limit === null ? 0 : r.carried), 0),
    /** Everyday spending in categories with a limit, and in ones without. */
    budgetedSpent: args.rows.reduce((s, r) => s + (r.limit === null ? 0 : r.spent), 0),
    unbudgetedSpent: args.rows.reduce((s, r) => s + (r.limit === null ? Math.max(0, r.spent) : 0), 0),
  };
}
