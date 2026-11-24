import { diffDays, formatShort, monthName, weekday, type ISODate } from "./dates";
import { dollars, dollarsExact } from "./money";

/*
 * What each phone notification says. Pure: worked out from numbers the server already has, so the wording
 * can be tested on its own. Every note opens the thing it's about.
 */

export type NoteKind = "bill" | "low" | "review" | "nospend" | "test";

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

/** The test button in Settings. */
export const TEST_NOTE: Note = {
  kind: "test",
  ref: "test",
  title: "Notifications are on",
  body: "This is how Passbook will tell you a bill is paid, or that money is short for one coming up.",
  url: "/settings",
  tag: "test",
};
