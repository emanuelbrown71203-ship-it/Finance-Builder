import { addDays, monthEnd, type ISODate } from "../dates";

/*
 * The no-spend week: the last seven days of every month, when the owner aims to spend nothing beyond bills,
 * so what's left of the month can go to savings. Pure: worked out from the month plan's days.
 */

export type NoSpendDayState = "clear" | "spent" | "today" | "ahead";
export type NoSpendWeek = {
  /** soon: starts within three days; on: it's this week; done: it's over (shown for a week after). */
  phase: "soon" | "on" | "done";
  month: string;
  start: ISODate;
  end: ISODate;
  days: { date: ISODate; state: NoSpendDayState }[];
  /** Days gone by with nothing spent beyond bills. */
  clear: number;
};

/** The last seven days of a month. */
export function noSpendWeekOf(month: string): { start: ISODate; end: ISODate } {
  const end = monthEnd(month);
  return { start: addDays(end, -6), end };
}

/**
 * Where a month's no-spend week stands on `today`, from each day's everyday spending (bills aren't
 * counted; Extras like Netflix are). Null when it's more than three days off.
 */
export function noSpendWeek(month: string, today: ISODate, days: { date: ISODate; everyday: number }[]): NoSpendWeek | null {
  const { start, end } = noSpendWeekOf(month);
  if (today < addDays(start, -3)) return null;
  const spentOn = new Map(days.map((d) => [d.date, d.everyday]));
  const week: NoSpendWeek["days"] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const spent = (spentOn.get(d) ?? 0) > 0;
    week.push({ date: d, state: d > today ? "ahead" : spent ? "spent" : d === today ? "today" : "clear" });
  }
  return { phase: today < start ? "soon" : today <= end ? "on" : "done", month, start, end, days: week, clear: week.filter((d) => d.state === "clear").length };
}
