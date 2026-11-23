import { addDays, addMonths, dayOfMonth, daysInMonth, diffDays, type ISODate } from "../dates";

/**
 * Finds charges and deposits that repeat on a schedule (rent, subscriptions,
 * paychecks) by looking at transaction history. Pure: same input, same output.
 */

/** "semiannual" and "once" only come from bills added by hand; detection finds the others. */
export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "once";
export type RecurringKind = "bill" | "subscription" | "income";

export type TxLike = {
  id: string;
  date: ISODate;
  name: string;
  amount: number;
  category: string;
  accountId: string;
};

export type RecurringSeries = {
  /** Stable id for the series: normalized merchant plus direction. */
  key: string;
  name: string;
  kind: RecurringKind;
  category: string;
  frequency: Frequency;
  /** Typical amount, signed like transactions (negative = money out). */
  amount: number;
  /** True when the amount is the same every time, like a subscription. */
  fixedAmount: boolean;
  lastDate: ISODate;
  nextDate: ISODate;
  accountId: string;
  /** False once it has missed its expected date by a wide margin. */
  active: boolean;
  /** Set when the latest charge differs from a previously steady price. */
  priceChange: { from: number; to: number } | null;
  history: { id: string; date: ISODate; amount: number }[];
  /** The first charge we have on record, and how many there have been. */
  firstDate: ISODate;
  count: number;
  /**
   * For bills added by hand: the date every later one is counted from, so a
   * bill due on the 31st comes back to the 31st after a short month.
   */
  anchor?: ISODate;
};

const FREQUENCIES: { frequency: Frequency; days: number; min: number; max: number; minCount: number }[] = [
  { frequency: "weekly", days: 7, min: 6, max: 8, minCount: 4 },
  { frequency: "biweekly", days: 14, min: 13, max: 16, minCount: 3 },
  { frequency: "monthly", days: 30.44, min: 26, max: 35, minCount: 3 },
  { frequency: "quarterly", days: 91.3, min: 84, max: 98, minCount: 3 },
  { frequency: "yearly", days: 365.25, min: 351, max: 380, minCount: 2 },
];

/** Categories where repeat visits are habits, not subscriptions. */
const HABIT_CATEGORIES = new Set(["groceries", "dining", "shopping", "transport", "travel"]);
const BILL_CATEGORIES = new Set(["housing", "utilities", "insurance", "loans"]);

/**
 * A merchant's name boiled down so "CHIPOTLE #2041" and "Chipotle" count as
 * the same place: lower case, no store numbers or punctuation.
 */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function seriesKeyFor(name: string, amount: number): string {
  return `${amount > 0 ? "in" : "out"}:${merchantKey(name)}`;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function detectRecurring(transactions: TxLike[], today: ISODate): RecurringSeries[] {
  const groups = new Map<string, TxLike[]>();
  for (const t of transactions) {
    // Transfers aren't bills, and neither are interest and fees: they come and go with a balance.
    if (t.category === "transfer" || t.category === "fees" || t.amount === 0) continue;
    const key = seriesKeyFor(t.name, t.amount);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: RecurringSeries[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const txs = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const gaps = txs.slice(1).map((t, i) => diffDays(t.date, txs[i].date));
    const typicalGap = median(gaps);
    const freq = FREQUENCIES.find((f) => typicalGap >= f.min && typicalGap <= f.max);
    if (!freq) continue;
    // Rent, utilities, insurance or a loan paid two months running, about a month apart and about the same,
    // is a bill already: banks often send only a few months of history at first.
    const last2 = txs.slice(-2).map((t) => Math.abs(t.amount));
    const billTwice = freq.frequency === "monthly" && txs.length === 2 && BILL_CATEGORIES.has(txs[1].category) && Math.abs(last2[0] - last2[1]) / Math.max(...last2) <= 0.2;
    if (txs.length < freq.minCount && !billTwice) continue;

    // Most gaps must fit the schedule. One late or skipped payment is fine.
    const fitting = gaps.filter((g) => g >= freq.min - 2 && g <= freq.max + 2).length;
    if (fitting / gaps.length < 0.7) continue;

    const magnitudes = txs.map((t) => Math.abs(t.amount));
    const mid = median(magnitudes);
    const spread = (Math.max(...magnitudes) - Math.min(...magnitudes)) / mid;
    const recent = magnitudes.slice(-4);
    const fixedAmount = (Math.max(...recent) - Math.min(...recent)) / mid <= 0.2;

    const latest = txs[txs.length - 1];
    const isIncome = latest.amount > 0;
    // A café you visit weekly is not a bill: habits only count at a fixed price.
    if (!isIncome && HABIT_CATEGORIES.has(latest.category) && spread > 0.05) continue;
    // Anything swinging wildly isn’t predictable enough to plan around.
    if (spread > 1.2) continue;

    const amount = fixedAmount ? latest.amount : Math.sign(latest.amount) * Math.round(median(magnitudes.slice(-3)));

    let priceChange: RecurringSeries["priceChange"] = null;
    if (!isIncome && txs.length >= 3) {
      const last = Math.abs(latest.amount);
      const priorA = Math.abs(txs[txs.length - 2].amount);
      const priorB = Math.abs(txs[txs.length - 3].amount);
      // Flag the new price for two cycles so it isn’t missed.
      if (priorA === priorB && last !== priorA && Math.abs(last - priorA) / priorA >= 0.02) {
        priceChange = { from: -priorA, to: -last };
      } else if (txs.length >= 4) {
        const priorC = Math.abs(txs[txs.length - 4].amount);
        if (last === priorA && priorB === priorC && priorA !== priorB && Math.abs(priorA - priorB) / priorB >= 0.02) {
          priceChange = { from: -priorB, to: -last };
        }
      }
    }

    const nextDate = nextOccurrence(latest.date, freq.frequency, txs);
    const active = diffDays(today, latest.date) <= freq.days * 1.5 + 5;

    out.push({
      key,
      name: latest.name,
      kind: isIncome ? "income" : BILL_CATEGORIES.has(latest.category) ? "bill" : "subscription",
      category: latest.category,
      frequency: freq.frequency,
      amount,
      fixedAmount,
      lastDate: latest.date,
      nextDate,
      accountId: latest.accountId,
      active,
      priceChange,
      history: txs.slice(-12).map((t) => ({ id: t.id, date: t.date, amount: t.amount })),
      firstDate: txs[0].date,
      count: txs.length,
    });
  }

  return out.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.name.localeCompare(b.name)));
}

/** The usual day of the month a monthly series lands on. */
function usualDay(txs: TxLike[]): number {
  return Math.round(median(txs.slice(-6).map((t) => dayOfMonth(t.date))));
}

function nextOccurrence(last: ISODate, frequency: Frequency, txs: TxLike[]): ISODate {
  if (frequency !== "monthly") return stepFrom(last, frequency);
  // Some "monthly" charges really bill every 4 weeks, so the day of the month
  // drifts. When it does, step by the usual gap instead of the calendar.
  const days = txs.slice(-4).map((t) => dayOfMonth(t.date));
  const drifting = Math.max(...days) - Math.min(...days) > 4 && Math.max(...days) - Math.min(...days) < 24;
  if (drifting) {
    const gaps = txs.slice(-5).slice(1).map((t, i) => diffDays(t.date, txs.slice(-5)[i].date));
    return addDays(last, Math.round(median(gaps)));
  }
  return stepFrom(last, frequency, usualDay(txs));
}

export function stepFrom(date: ISODate, frequency: Frequency, monthlyDay?: number): ISODate {
  switch (frequency) {
    case "once":
      return "9999-12-31";
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "monthly": {
      const next = addMonths(`${date.slice(0, 7)}-01`, 1);
      const [y, m] = next.split("-").map(Number);
      const day = Math.min(monthlyDay ?? dayOfMonth(date), daysInMonth(y, m));
      return `${next.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    }
    case "quarterly":
      return addMonths(date, 3);
    case "semiannual":
      return addMonths(date, 6);
    case "yearly":
      return addMonths(date, 12);
  }
}

/**
 * Projected dates for a series inside [from, to], counting only occurrences
 * that haven’t happened yet (after the last one we saw).
 */
/** The k-th date of a schedule counted from its first date (0 is the first date itself). */
export function nthDate(anchor: ISODate, frequency: Frequency, k: number): ISODate {
  switch (frequency) {
    case "once":
      return k === 0 ? anchor : "9999-12-31";
    case "weekly":
      return addDays(anchor, 7 * k);
    case "biweekly":
      return addDays(anchor, 14 * k);
    case "monthly":
      return addMonths(anchor, k);
    case "quarterly":
      return addMonths(anchor, 3 * k);
    case "semiannual":
      return addMonths(anchor, 6 * k);
    case "yearly":
      return addMonths(anchor, 12 * k);
  }
}

/** The first date of a schedule on or after `date`, and which one it is. */
export function firstOnOrAfter(anchor: ISODate, frequency: Frequency, date: ISODate): { k: number; date: ISODate } {
  if (anchor >= date || frequency === "once") return { k: 0, date: anchor };
  const approx = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.3, semiannual: 182.6, yearly: 365.25 }[frequency];
  let k = Math.max(0, Math.floor(diffDays(date, anchor) / approx) - 1);
  for (let i = 0; i < 400; i++, k++) {
    const d = nthDate(anchor, frequency, k);
    if (d >= date) return { k, date: d };
  }
  return { k, date: nthDate(anchor, frequency, k) };
}

export function upcomingBetween(series: RecurringSeries, from: ISODate, to: ISODate): ISODate[] {
  if (!series.active) return [];
  if (series.anchor) {
    const out: ISODate[] = [];
    let { k } = firstOnOrAfter(series.anchor, series.frequency, series.nextDate);
    for (let i = 0; i < 60; i++, k++) {
      const d = nthDate(series.anchor, series.frequency, k);
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }
  const out: ISODate[] = [];
  const monthlyDay = series.frequency === "monthly" ? dayOfMonth(series.nextDate) : undefined;
  let d = series.nextDate;
  for (let i = 0; i < 60 && d <= to; i++) {
    if (d >= from) out.push(d);
    d = stepFrom(d, series.frequency, monthlyDay);
  }
  return out;
}

/** What the series costs (or pays) per month, for comparing across schedules. */
export function monthlyEquivalent(series: RecurringSeries): number {
  const perYear = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, semiannual: 2, yearly: 1, once: 0 }[series.frequency];
  return Math.round((series.amount * perYear) / 12);
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every 3 months",
  semiannual: "Every 6 months",
  yearly: "Every year",
  once: "Just once",
};
