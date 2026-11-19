/** Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; no time zones inside. */

export type ISODate = string;

const DAY_MS = 86_400_000;

export function toUTC(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUTC(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Today’s calendar date in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return parts;
  } catch {
    return fromUTC(now);
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromUTC(new Date(toUTC(date).getTime() + n * DAY_MS));
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: ISODate, n: number): ISODate {
  const d = toUTC(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(day, last));
  return fromUTC(target);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / DAY_MS);
}

/** 'YYYY-MM' */
export function monthOf(date: ISODate): string {
  return date.slice(0, 7);
}

export function monthStart(month: string): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: string): ISODate {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function addMonthsToMonth(month: string, n: number): string {
  return addMonths(monthStart(month), n).slice(0, 7);
}

export function dayOfMonth(date: ISODate): number {
  return Number(date.slice(8, 10));
}

/** 0 = Sunday */
export function weekday(date: ISODate): number {
  return toUTC(date).getUTCDay();
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1];
}

/** "Nov 19" */
export function formatShort(date: ISODate): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${dayOfMonth(date)}`;
}

/** "Nov 19, 2026" */
export function formatMedium(date: ISODate): string {
  return `${formatShort(date)}, ${date.slice(0, 4)}`;
}

/** "Today", "Yesterday", "Tuesday", then "Nov 12". */
export function formatRelativeDay(date: ISODate, today: ISODate): string {
  const diff = diffDays(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  if (diff > 1 && diff < 7) return WEEKDAYS[weekday(date)];
  return date.slice(0, 4) === today.slice(0, 4) ? formatShort(date) : formatMedium(date);
}

/** "in 3 days", "tomorrow", "today", "2 days ago" */
export function formatDistance(date: ISODate, today: ISODate): string {
  const diff = diffDays(date, today);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 0) return `in ${diff} days`;
  return `${-diff} days ago`;
}
