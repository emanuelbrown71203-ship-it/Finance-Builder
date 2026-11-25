import { diffDays, formatShort, monthName, weekday, type ISODate } from "./dates";
import { dollars, dollarsExact } from "./money";

/*
 * What each phone notification says. Pure: worked out from numbers the server already has, so the wording
 * can be tested on its own. Every note opens the thing it's about.
 */

export type NoteKind = "bill" | "low" | "review" | "nospend" | "in" | "due" | "budget" | "save" | "test";

export type Note = {
  kind: NoteKind;
  /** What it's about, so the same note never goes out twice: "paid:<transaction>", "review:<Monday>"… */
  ref: string;
  title: string;
  body: string;
  /** The screen it opens: always a path on this site. */
  url: string;
  /** Notes with the same tag replace each other on the phone instead of piling up. */
  tag: string;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "today", "tomorrow" or "on Friday". */
export function whenDue(date: ISODate, today: ISODate): string {
  const days = diffDays(date, today);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `on ${DAYS[weekday(date)]}`;
}

const billHref = (key: string) => (key.startsWith("card:") ? "/debt" : `/bills?open=${encodeURIComponent(key)}`);

export type PaidFact = { txId: string; seriesKey: string; name: string; amount: number; date: ISODate; accountName: string; share: number | null };

/**
 * A bill the person follows ("Tell me when it's paid") showed up paid at the bank. Notes show on the lock
 * screen, so with `amounts` off they say what happened without any dollar figures.
 */
export function billPaidNote(p: PaidFact, amounts = true): Note {
  const part = p.share === null ? "" : p.share === 0.5 ? ", your half" : ", your part";
  const from = p.accountName ? ` from ${p.accountName}` : "";
  return {
    kind: "bill",
    ref: `paid:${p.txId}`,
    title: `${p.name} is paid`,
    body: amounts ? `${dollarsExact(-p.amount)}${part}${from}, ${formatShort(p.date)}.` : `Paid${from}, ${formatShort(p.date)}.`,
    url: billHref(p.seriesKey),
    tag: `paid:${p.seriesKey}`,
  };
}

export type DueFact = { key: string; name: string; date: ISODate; amount: number };

/**
 * Bills paid from the bank in the next few days come to more than checking has. Null when there's enough,
 * or nothing is due. Sent once for the first bill and its date.
 */
export function lowBalanceNote(p: { today: ISODate; cash: number; cashName: string; due: DueFact[] }, amounts = true): Note | null {
  const due = [...p.due].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = due.reduce((s, b) => s - b.amount, 0);
  if (due.length === 0 || total <= 0 || p.cash >= total) return null;
  const first = due[0];
  const last = due[due.length - 1];
  const by = last.date === p.today ? "today" : DAYS[weekday(last.date)];
  const what = due.length === 1 ? `${first.name} (${dollarsExact(-first.amount)}) is due ${whenDue(first.date, p.today)}` : `${due.length} bills come to ${dollarsExact(total)} by ${by}`;
  const quiet = due.length === 1 ? `${first.name}, due ${whenDue(first.date, p.today)}` : `the ${due.length} bills due by ${by}`;
  return {
    kind: "low",
    ref: `low:${first.key}|${first.date}`,
    title: "Not enough for a bill coming up",
    body: amounts ? `${p.cashName} has ${dollarsExact(Math.max(0, p.cash))}, and ${what}. Worth moving money in before then.` : `${p.cashName} may not cover ${quiet}. Worth moving money in before then.`,
    url: due.length === 1 ? billHref(first.key) : "/bills",
    tag: "low",
  };
}

/** Monday morning: last week in a line, and the review that's waiting. */
export function reviewNote(p: { week: ISODate; spent: number; spentBefore: number }, amounts = true): Note {
  const change = p.spentBefore <= 0 || p.spent === p.spentBefore ? "" : p.spent < p.spentBefore ? `, ${dollars(p.spentBefore - p.spent)} less than the week before` : `, ${dollars(p.spent - p.spentBefore)} more than the week before`;
  return {
    kind: "review",
    ref: `review:${p.week}`,
    title: "Your weekly review is ready",
    body: amounts ? `Last week: ${dollars(p.spent)} spent${change}. Take two minutes to look back and plan this week.` : "Take two minutes to look back at last week and plan this one.",
    url: "/recap",
    tag: "review",
  };
}

/** The first day of the no-spend week (the month's last seven days). */
export function noSpendStartNote(p: { month: string; end: ISODate; left: number }, amounts = true): Note {
  const month = monthName(p.month);
  return {
    kind: "nospend",
    ref: `nospend:${p.month}`,
    title: "No-spend week starts today",
    body: `Bills only through ${formatShort(p.end)}.${!amounts ? ` Whatever’s left of ${month} on the 1st can go to savings.` : p.left > 0 ? ` About ${dollars(p.left)} of ${month} is left, and whatever’s still there on the 1st can go to savings.` : " Every day you skip spending helps."}`,
    url: "/",
    tag: "nospend",
  };
}

export type MoneyInFact = { txId: string; kind: "paycheck" | "refund" | "deposit"; name: string; amount: number; accountName: string };

/** A paycheck, a refund, or money someone sent (the partner's half of the rent) arrived. */
export function moneyInNote(p: MoneyInFact, amounts = true): Note {
  const money = amounts ? `${dollarsExact(p.amount)} ` : "";
  const into = p.accountName ? `into ${p.accountName}` : "";
  const title = p.kind === "paycheck" ? "Paycheck arrived" : p.kind === "refund" ? `Refund from ${p.name}` : "Money in";
  const body =
    p.kind === "paycheck"
      ? `${money}${into}`.trim()
      : p.kind === "refund"
        ? `${money}back${p.accountName ? ` on ${p.accountName}` : ""}`
        : `${money}from ${p.name}${into ? ` ${into}` : ""}`;
  return { kind: "in", ref: `in:${p.txId}`, title, body: `${body.charAt(0).toUpperCase()}${body.slice(1)}.`, url: "/transactions", tag: `in:${p.txId}` };
}

export type DueTomorrowFact = { key: string; name: string; amount: number; share: number | null };

/** The day before: the bills, Extras and card minimums due tomorrow, in one note. Null when there are none. */
export function billsDueNote(p: { tomorrow: ISODate; bills: DueTomorrowFact[] }, amounts = true): Note | null {
  const bills = [...p.bills].sort((a, b) => a.amount - b.amount);
  if (bills.length === 0) return null;
  const amount = (b: DueTomorrowFact) => `${dollarsExact(-b.amount)}${b.share === null ? "" : b.share === 0.5 ? " (your half)" : " (your part)"}`;
  const first = bills[0];
  if (bills.length === 1) {
    return { kind: "due", ref: `due:${p.tomorrow}`, title: `${first.name} is due tomorrow`, body: amounts ? `${amount(first)}.` : "Open Passbook to see it.", url: billHref(first.key), tag: "due" };
  }
  const shown = bills.slice(0, 4);
  const more = bills.length > shown.length ? ` and ${bills.length - shown.length} more` : "";
  const total = bills.reduce((s, b) => s - b.amount, 0);
  const body = amounts ? `${shown.map((b) => `${b.name} ${amount(b)}`).join(" · ")}${more}. ${dollarsExact(total)} in all.` : `${shown.map((b) => b.name).join(", ")}${more}.`;
  return { kind: "due", ref: `due:${p.tomorrow}`, title: `${bills.length} bills due tomorrow`, body, url: "/bills", tag: "due" };
}

export type BudgetFact = { category: string; label: string; month: string; budget: number; spent: number };

/**
 * A budget category at 80% of its budget ("close"), and again once it's over. Null below 80%. `budget`
 * is the month's limit plus anything carried in.
 */
export function budgetNote(p: BudgetFact, amounts = true): Note | null {
  const month = monthName(p.month);
  const over = p.budget <= 0 ? p.spent > 0 : p.spent > p.budget;
  const close = !over && p.budget > 0 && p.spent >= p.budget * 0.8;
  if (!over && !close) return null;
  const level = over ? "over" : "close";
  const body = !amounts
    ? over
      ? `Over its budget for ${month}.`
      : `Most of ${month}’s budget is spent.`
    : over
      ? p.budget <= 0
        ? `${dollars(p.spent)} spent, with nothing planned for it in ${month}.`
        : `${dollars(p.spent - p.budget)} over: ${dollars(p.spent)} of ${dollars(p.budget)} in ${month}.`
      : `${dollars(p.spent)} of ${dollars(p.budget)} spent, ${dollars(p.budget - p.spent)} left for ${month}.`;
  return {
    kind: "budget",
    ref: `budget-${level}:${p.month}:${p.category}`,
    title: over ? `${p.label} is over budget` : `${p.label} is close to its budget`,
    body,
    url: `/budget?category=${encodeURIComponent(p.category)}`,
    tag: `budget:${p.category}`,
  };
}

export type SaveFact = { goalId: string; goalName: string; date: ISODate; remaining: number; fromPaycheck: boolean; account: string | null };

/**
 * A paycheck's savings still to put aside: the day after payday ("time to save"), and once more two days
 * later ("still to save"). Opens the to-do itself.
 */
export function saveNote(p: SaveFact, again: boolean, amounts = true): Note {
  const money = amounts ? `${dollarsExact(p.remaining)} ` : "";
  const from = p.fromPaycheck ? ` from your ${formatShort(p.date)} paycheck` : "";
  const how = p.account ? `Move it into ${p.account} and it ticks itself off.` : "Tap to mark it done, save less or skip it.";
  return {
    kind: "save",
    ref: `${again ? "save-again" : "save"}:${p.goalId}:${p.date}`,
    title: again ? `Still to save for ${p.goalName}` : `Time to save for ${p.goalName}`,
    body: `${amounts ? `Put ${money.trim()} toward it${from}.` : `Put this paycheck’s savings toward it.`} ${how}`,
    url: `/budget?save=${encodeURIComponent(`${p.goalId}|${p.date}`)}`,
    tag: `save:${p.goalId}`,
  };
}

/** The test button in Settings. */
export const TEST_NOTE: Note = {
  kind: "test",
  ref: "test",
  title: "Notifications are on",
  body: "This is how Passbook will tell you a bill is paid, or that money is short for one coming up.",
  url: "/settings",
  tag: "test",
};
