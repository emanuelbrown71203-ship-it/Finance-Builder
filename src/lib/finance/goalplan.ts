import { addDays, addMonths, diffDays, monthEnd, monthOf, addMonthsToMonth, type ISODate } from "../dates";

/**
 * The track to a savings goal: how much to put away (a month, a week, a
 * payday) to reach it by its date, whether you're ahead or behind, the
 * checkpoints along the way and when each milestone falls. Pure: it only
 * works things out from what it's given.
 */

export type Deposit = { date: ISODate; amount: number };

export type GoalPlanInput = {
  target: number;
  saved: number;
  targetDate: ISODate | null;
  today: ISODate;
  /** The day the goal was made: where the plan line starts. */
  startDate: ISODate;
  /** Every amount put toward the goal (negative when taken back out), any order. */
  deposits: Deposit[];
  /** What the person said they'll set aside a month (0 = not set). */
  monthlyContribution: number;
  /** Upcoming paydays from regular income, earliest first. */
  paydays: ISODate[];
};

export type GoalStatus = "reached" | "ahead" | "on_track" | "behind" | "overdue" | "no_date";

export type Checkpoint = { date: ISODate; amount: number; met: boolean | null };
export type Milestone = { percent: 25 | 50 | 75 | 100; amount: number; reachedOn: ISODate | null; projected: ISODate | null };

export type GoalPlan = {
  status: GoalStatus;
  remaining: number;
  daysLeft: number | null;
  /** To reach the goal by its date, starting now. Null with no date, once reached, or once the date has passed. */
  perMonth: number | null;
  perWeek: number | null;
  perPayday: number | null;
  paydaysLeft: number;
  nextPayday: ISODate | null;
  /** Where the straight-line plan says you'd be today. */
  expectedNow: number | null;
  /** Saved minus expected: positive is ahead, negative behind. */
  gap: number | null;
  /** What actually goes in, per month, lately (or the monthly amount you set, before there's any history). */
  pace: number;
  /** When you'd get there at that pace. */
  projectedDate: ISODate | null;
  checkpoints: Checkpoint[];
  milestones: Milestone[];
  /** What was saved when the goal was made. */
  startSaved: number;
  /** Saved over time: one point per day something went in or out, from the start to today. */
  history: Deposit[];
};

const AVG_MONTH_DAYS = 30.4375;

/** Months between two dates, counting calendar months first: Nov 21 to the next Nov 21 is exactly 12. */
export function monthsBetween(from: ISODate, to: ISODate): number {
  let whole = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  let anchor = addMonths(from, whole);
  if (anchor > to) {
    whole -= 1;
    anchor = addMonths(from, whole);
  }
  return whole + diffDays(to, anchor) / AVG_MONTH_DAYS;
}

/** Rounds up to a whole dollar: a plan says "$84 a week", not "$83.17". */
const upToDollar = (cents: number) => Math.ceil(cents / 100) * 100;

/** The plan line's value on a date: a straight line from what was saved at the start to the target on its date. */
function planned(input: GoalPlanInput, startSaved: number, date: ISODate): number {
  if (!input.targetDate) return startSaved;
  const total = diffDays(input.targetDate, input.startDate);
  if (total <= 0) return input.target;
  const t = Math.min(1, Math.max(0, diffDays(date, input.startDate) / total));
  return Math.round(startSaved + (input.target - startSaved) * t);
}

export function goalPlan(input: GoalPlanInput): GoalPlan {
  const { target, saved, targetDate, today, startDate } = input;
  const deposits = [...input.deposits].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const deposited = deposits.reduce((s, d) => s + d.amount, 0);
  const startSaved = Math.max(0, saved - deposited);
  const remaining = Math.max(0, target - saved);

  // Saved over time, one point per day with activity.
  const history: Deposit[] = [{ date: startDate, amount: startSaved }];
  let running = startSaved;
  for (const d of deposits) {
    running += d.amount;
    const date = d.date < startDate ? startDate : d.date;
    const last = history[history.length - 1];
    if (last.date === date) last.amount = running;
    else history.push({ date, amount: running });
  }
  const savedOn = (date: ISODate) => {
    let value = startSaved;
    for (const p of history) if (p.date <= date) value = p.amount;
    return value;
  };

  // Lately: the last 90 days, or since the goal began if it's younger than that.
  const windowStart = addDays(today, -90) > startDate ? addDays(today, -90) : startDate;
  const recent = deposits.filter((d) => d.date >= windowStart && d.date <= today);
  const windowMonths = Math.max(1, diffDays(today, windowStart) / AVG_MONTH_DAYS);
  const actualPace = Math.round(recent.reduce((s, d) => s + d.amount, 0) / windowMonths);
  const pace = recent.length >= 2 ? actualPace : input.monthlyContribution > 0 ? input.monthlyContribution : actualPace;

  const projectedDate = remaining === 0 ? today : pace > 0 ? addDays(today, Math.ceil((remaining / pace) * AVG_MONTH_DAYS)) : null;

  const daysLeft = targetDate ? diffDays(targetDate, today) : null;
  const upcomingPaydays = input.paydays.filter((d) => d > today && (!targetDate || d <= targetDate));
  const nextPayday = input.paydays.find((d) => d > today) ?? null;

  // Close enough counts: a few dollars, or 3% of the goal, either side. Status and checkpoints use the same leeway.
  const tolerance = Math.max(500, Math.round(target * 0.03));
  let status: GoalStatus;
  let expectedNow: number | null = null;
  let gap: number | null = null;
  if (saved >= target) status = "reached";
  else if (!targetDate) status = "no_date";
  else if (daysLeft !== null && daysLeft < 0) status = "overdue";
  else {
    expectedNow = planned(input, startSaved, today);
    gap = saved - expectedNow;
    status = gap > tolerance ? "ahead" : gap < -tolerance ? "behind" : "on_track";
  }

  let perMonth: number | null = null;
  let perWeek: number | null = null;
  let perPayday: number | null = null;
  if (targetDate && remaining > 0 && daysLeft !== null && daysLeft >= 0) {
    // At least one period: with three days to go, the whole amount is "this month" and "this week".
    perMonth = upToDollar(remaining / Math.max(1, monthsBetween(today, targetDate)));
    perWeek = upToDollar(remaining / Math.max(1, daysLeft / 7));
    perPayday = upcomingPaydays.length > 0 ? upToDollar(remaining / upcomingPaydays.length) : null;
  }

  // Month-end checkpoints from the start to the target date.
  const checkpoints: Checkpoint[] = [];
  if (targetDate && diffDays(targetDate, startDate) > 0) {
    for (let month = monthOf(startDate); month <= monthOf(targetDate) && checkpoints.length < 120; month = addMonthsToMonth(month, 1)) {
      const date = month === monthOf(targetDate) ? targetDate : monthEnd(month);
      if (date <= startDate) continue;
      const amount = date === targetDate ? target : upToDollar(planned(input, startSaved, date));
      checkpoints.push({ date, amount, met: date < today ? savedOn(date) >= amount - tolerance : null });
    }
  }

  const milestones: Milestone[] = ([25, 50, 75, 100] as const).map((percent) => {
    const amount = Math.round((target * percent) / 100);
    const hit = history.find((p) => p.amount >= amount);
    const reachedOn = saved >= amount ? (hit?.date ?? today) : null;
    const projected = reachedOn ? null : pace > 0 ? addDays(today, Math.ceil(((amount - saved) / pace) * AVG_MONTH_DAYS)) : null;
    return { percent, amount, reachedOn, projected };
  });

  return {
    status,
    remaining,
    daysLeft,
    perMonth,
    perWeek,
    perPayday,
    paydaysLeft: upcomingPaydays.length,
    nextPayday,
    expectedNow,
    gap,
    pace,
    projectedDate,
    checkpoints,
    milestones,
    startSaved,
    history,
  };
}

/** Quick target dates offered when making a goal. */
export function quickDates(today: ISODate): { label: string; date: ISODate }[] {
  return [
    { label: "3 months", date: addMonths(today, 3) },
    { label: "6 months", date: addMonths(today, 6) },
    { label: "1 year", date: addMonths(today, 12) },
    { label: "2 years", date: addMonths(today, 24) },
  ];
}

/** What a goal needs a month to be reached by a date, for previews while a goal is being made. */
export function monthlyFor(target: number, saved: number, today: ISODate, date: ISODate): number | null {
  const days = diffDays(date, today);
  if (days <= 0 || target <= saved) return null;
  return upToDollar((target - saved) / Math.max(1, monthsBetween(today, date)));
}

export type GoalIdea = { title: string; detail: string; href?: string };

/**
 * Where the money for a goal could come from, read off the person's own
 * month: categories running above their usual, and room left in the month.
 * Ideas, not instructions.
 */
/**
 * Spending that bends: where a goal's money can realistically come from.
 * Rent, loans, insurance and utilities are left out: they're fixed, and as
 * they're often paid early in the month they'd always look "above usual".
 */
const FLEXIBLE = new Set(["dining", "groceries", "shopping", "entertainment", "transport", "personal", "travel"]);

export function goalIdeas(args: {
  need: number | null;
  /** This month's spending by category so far, with each one's usual (3-month average). */
  categories: { category: string; label: string; spent: number; average: number }[];
  /** How far through the month we are, 0 to 1. */
  monthProgress: number;
  leftToSpend: number;
}): GoalIdea[] {
  const { need, categories, monthProgress, leftToSpend } = args;
  if (!need || need <= 0) return [];
  const ideas: GoalIdea[] = [];
  // A category on course to end the month well above its usual.
  const over = categories
    .filter((c) => FLEXIBLE.has(c.category) && c.average >= 2000 && monthProgress > 0.15)
    .map((c) => ({ ...c, projectedOver: Math.round(c.spent / monthProgress - c.average) }))
    .filter((c) => c.projectedOver >= Math.max(1500, c.average * 0.15))
    .sort((a, b) => b.projectedOver - a.projectedOver)
    .slice(0, 2);
  for (const c of over) {
    const share = Math.min(1, c.projectedOver / need);
    ideas.push({
      title: `${c.label} is running above usual`,
      detail: `On course for about ${dollarsRough(c.projectedOver)} more than a usual month. Bringing it back to usual would cover ${share >= 1 ? "this month’s amount" : `${Math.round(share * 100)}% of this month’s amount`}.`,
      href: `/transactions?category=${encodeURIComponent(c.category)}`,
    });
  }
  if (leftToSpend > need) {
    ideas.push({ title: "There’s room this month", detail: `After bills and your other goals, ${dollarsRough(leftToSpend)} is left to spend this month, more than this goal needs.`, href: "/" });
  }
  return ideas;
}

function dollarsRough(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
