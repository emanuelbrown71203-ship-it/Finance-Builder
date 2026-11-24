import { addDays, dayOfMonth, daysInMonth, monthEnd, type ISODate } from "../dates";
import type { MonthPlan } from "./plan";

/*
 * The month ahead: the whole month split at each payday, with what comes in, the bills due and everyday
 * spending (what's been spent, then a forecast for the days still to come). The forecast follows the
 * person's own pattern (how much of a month's spending usually lands in its first, middle and last third),
 * and plans nothing for the no-spend week. Pure: worked out from the month plan.
 */

export type MonthAheadPeriod = {
  start: ISODate;
  end: ISODate;
  /** The paycheck that starts it, if one does. */
  paycheck: { date: ISODate; amount: number; expected: boolean } | null;
  income: number;
  bills: number;
  /** Everyday spending: spent so far plus the forecast for days still to come. */
  everyday: number;
  /** The forecast part of `everyday`. */
  forecast: number;
  /** It has days in the no-spend week (planned at nothing). */
  noSpend: boolean;
};

export type MonthAhead = {
  periods: MonthAheadPeriod[];
  /** What's left if nothing more is spent (Home's "left to spend"). */
  leftNow: number;
  /** Everyday spending still expected this month, at the usual pace. */
  forecast: number;
  /** What's likely left at the month's end: left now, less the forecast. */
  forecastLeft: number;
};

/** How a month's everyday spending usually falls across its first, middle and last third (shares add to 1). */
export function spendingShape(history: { date: ISODate; everyday: number }[]): [number, number, number] {
  const thirds: [number, number, number] = [0, 0, 0];
  for (const d of history) if (d.everyday > 0) thirds[third(d.date)] += d.everyday;
  const total = thirds[0] + thirds[1] + thirds[2];
  return total > 0 ? [thirds[0] / total, thirds[1] / total, thirds[2] / total] : [1 / 3, 1 / 3, 1 / 3];
}

/** 0: days 1–10, 1: 11–20, 2: 21 to the end. */
function third(date: ISODate): 0 | 1 | 2 {
  const d = dayOfMonth(date);
  return d <= 10 ? 0 : d <= 20 ? 1 : 2;
}

export function monthAhead(args: {
  plan: MonthPlan;
  /** Paychecks in the month (in and still expected), by date. */
  paychecks: { date: ISODate; amount: number; received: boolean }[];
  /** Everyday spending in a usual month. */
  usualEveryday: number;
  shape: [number, number, number];
  /** Days planned at nothing (the no-spend week). */
  noSpendDays?: ReadonlySet<ISODate>;
}): MonthAhead {
  const { plan, paychecks, usualEveryday, shape, noSpendDays = new Set() } = args;
  const [y, m] = plan.month.split("-").map(Number);
  const last = daysInMonth(y, m);
  const daysIn = [10, 10, last - 20];
  // Each future day gets its third's share of a usual month, spread over that third's days.
  const perDay = (date: ISODate) => (noSpendDays.has(date) ? 0 : Math.round((usualEveryday * shape[third(date)]) / daysIn[third(date)]));

  const starts = [...new Set(paychecks.map((p) => p.date))].sort();
  const first = plan.days[0]?.date ?? `${plan.month}-01`;
  const end = monthEnd(plan.month);
  const cuts = [first, ...starts.filter((d) => d > first && d <= end)];
  const periods: MonthAheadPeriod[] = cuts.map((start, i) => {
    const stop = i + 1 < cuts.length ? addDays(cuts[i + 1], -1) : end;
    const days = plan.days.filter((d) => d.date >= start && d.date <= stop);
    const forecast = days.filter((d) => d.projected || d.date > plan.today).reduce((s, d) => s + perDay(d.date), 0);
    const pay = paychecks.filter((p) => p.date === start);
    return {
      start,
      end: stop,
      paycheck: pay.length ? { date: start, amount: pay.reduce((s, p) => s + p.amount, 0), expected: pay.some((p) => !p.received) } : null,
      income: days.reduce((s, d) => s + d.income, 0),
      bills: days.reduce((s, d) => s + d.bills, 0),
      everyday: days.reduce((s, d) => s + d.everyday, 0) + forecast,
      forecast,
      noSpend: days.some((d) => noSpendDays.has(d.date)),
    };
  });
  const forecast = periods.reduce((s, p) => s + p.forecast, 0);
  return { periods, leftNow: plan.leftToSpend, forecast, forecastLeft: plan.leftToSpend - forecast };
}
