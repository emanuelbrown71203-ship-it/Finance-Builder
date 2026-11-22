import { addDays, dayOfMonth, diffDays, eachDay, monthEnd, monthStart, type ISODate } from "../dates";
import { upcomingBetween, type RecurringSeries, type TxLike } from "./recurring";

/**
 * The month plan answers "how much can I still spend this month?" and lays
 * the month out day by day: what came in, what went out, and what is still
 * expected before the month ends.
 */

export type DayEvent = {
  name: string;
  amount: number;
  /** income | bill | everyday */
  type: "income" | "bill" | "everyday";
  /** False for projected events that haven’t happened yet. */
  settled: boolean;
};

export type PlanDay = {
  date: ISODate;
  income: number;
  bills: number;
  everyday: number;
  /** True for days after today: values are expectations, not history. */
  projected: boolean;
  events: DayEvent[];
};

export type MonthPlan = {
  month: string;
  today: ISODate;
  /** Income received so far plus paychecks still expected this month. */
  incomeExpected: number;
  incomeReceived: number;
  /** Bills (necessities) paid so far plus those still due this month. Extras are everyday spending. */
  billsExpected: number;
  billsPaid: number;
  /** What goals are set to put aside each month. */
  savingsPlanned: number;
  /** Spending this month that isn’t a bill (Extras like Netflix count here). */
  everydaySpent: number;
  /** incomeExpected − billsExpected − savingsPlanned − everydaySpent */
  leftToSpend: number;
  daysLeft: number;
  /** leftToSpend spread over the days remaining, including today. */
  perDay: number;
  days: PlanDay[];
};

export function buildMonthPlan(args: {
  month: string;
  today: ISODate;
  /** All non-transfer transactions dated inside the month. */
  transactions: TxLike[];
  recurring: RecurringSeries[];
  savingsPlanned: number;
}): MonthPlan {
  const { month, today, transactions, recurring, savingsPlanned } = args;
  const start = monthStart(month);
  const end = monthEnd(month);

  const recurringTxIds = new Map<string, RecurringSeries>();
  for (const s of recurring) for (const h of s.history) recurringTxIds.set(h.id, s);

  const days = new Map<ISODate, PlanDay>(
    eachDay(start, end).map((date) => [date, { date, income: 0, bills: 0, everyday: 0, projected: date > today, events: [] }]),
  );

  let incomeReceived = 0;
  let billsPaid = 0;
  let everydaySpent = 0;

  for (const t of transactions) {
    const day = days.get(t.date);
    if (!day || t.category === "transfer") continue;
    const series = recurringTxIds.get(t.id);
    if (t.category === "income") {
      incomeReceived += t.amount;
      day.income += t.amount;
      day.events.push({ name: t.name, amount: t.amount, type: "income", settled: true });
    } else if (series && series.kind !== "income") {
      billsPaid += -t.amount;
      day.bills += -t.amount;
      day.events.push({ name: t.name, amount: t.amount, type: "bill", settled: true });
    } else {
      // A refund lands here with a positive amount and lowers the total.
      everydaySpent += -t.amount;
      day.everyday += -t.amount;
      day.events.push({ name: t.name, amount: t.amount, type: "everyday", settled: true });
    }
  }

  // Still to come this month. A bill that was due earlier this month but hasn’t
  // shown up yet is treated as due today rather than silently dropped.
  let incomeUpcoming = 0;
  let billsUpcoming = 0;
  const from = today < start ? start : today;
  for (const s of recurring) {
    if (!s.active) continue;
    const lateFrom = addDays(from, -10) < start ? start : addDays(from, -10);
    for (const due of upcomingBetween(s, lateFrom, end)) {
      const date = due < from ? from : due;
      const day = days.get(date);
      if (!day) continue;
      if (s.kind === "income") {
        incomeUpcoming += s.amount;
        day.income += s.amount;
        day.events.push({ name: s.name, amount: s.amount, type: "income", settled: false });
      } else {
        billsUpcoming += -s.amount;
        day.bills += -s.amount;
        day.events.push({ name: s.name, amount: s.amount, type: "bill", settled: false });
      }
    }
  }

  const incomeExpected = incomeReceived + incomeUpcoming;
  const billsExpected = billsPaid + billsUpcoming;
  const leftToSpend = incomeExpected - billsExpected - savingsPlanned - everydaySpent;
  const daysLeft = today > end ? 0 : today < start ? dayOfMonth(end) : diffDays(end, today) + 1;

  return {
    month,
    today,
    incomeExpected,
    incomeReceived,
    billsExpected,
    billsPaid,
    savingsPlanned,
    everydaySpent,
    leftToSpend,
    daysLeft,
    perDay: daysLeft > 0 ? Math.round(leftToSpend / daysLeft) : 0,
    days: [...days.values()],
  };
}

export type CategoryTotal = { category: string; spent: number };

/** Spending per category (positive cents), largest first. Ignores transfers and income. */
export function spendingByCategory(transactions: Pick<TxLike, "amount" | "category">[]): CategoryTotal[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.category === "transfer" || t.category === "income") continue;
    // Refunds reduce the category they came from.
    totals.set(t.category, (totals.get(t.category) ?? 0) - t.amount);
  }
  return [...totals.entries()]
    .map(([category, spent]) => ({ category, spent }))
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent);
}
