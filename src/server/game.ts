import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { playerWins, transactions } from "@/db/schema";
import { category } from "@/lib/categories";
import { addDays, addMonthsToMonth, dayOfMonth, formatShort, monthName, monthOf, type ISODate } from "@/lib/dates";
import { badgesFor, bestStreak, levelFor, streak, WINS, isWinKind, type GamePayload, type WinKind } from "@/lib/game/progress";
import type { Ctx } from "./auth";
import { describeError } from "./errors";
import { lastMonthBudgets, noSpendWeekFor } from "./queries";

/*
 * The game layer on the server: small wins are written down where they happen
 * (sorting a charge, adding a bill, putting money toward a goal…), so XP can't
 * be made up in the browser. Each thing counts once (`ref`), each kind of win
 * has a daily limit, and Undo on the same day takes the XP back.
 *
 * Recording a win never gets in the way of the real change: if it fails, the
 * change still goes through and the failure is only logged.
 */

/** Records a win. False if that thing already counted or today's limit for its kind is reached. */
export async function win(ctx: Ctx, kind: WinKind, ref: string, label?: string | null, day: ISODate = ctx.today): Promise<boolean> {
  try {
    const rule = WINS[kind];
    const [{ count }] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(playerWins)
      .where(and(eq(playerWins.userId, ctx.userId), eq(playerWins.kind, kind), eq(playerWins.day, day)));
    if (count >= rule.perDay) return false;
    const rows = await ctx.db
      .insert(playerWins)
      .values({ id: crypto.randomUUID(), userId: ctx.userId, kind, xp: rule.xp, label: label?.trim().slice(0, 80) || null, ref: ref.slice(0, 200), day })
      .onConflictDoNothing()
      .returning({ id: playerWins.id });
    return rows.length > 0;
  } catch (error) {
    console.error("game: a win wasn't recorded:", describeError(error));
    return false;
  }
}

/** Undo on the same day takes a win back. Something removed on a later day keeps what it earned. */
export async function takeBack(ctx: Ctx, kind: WinKind, refs: string | string[]): Promise<void> {
  const list = ([] as string[]).concat(refs).filter(Boolean);
  if (list.length === 0) return;
  try {
    await ctx.db
      .delete(playerWins)
      .where(and(eq(playerWins.userId, ctx.userId), eq(playerWins.kind, kind), eq(playerWins.day, ctx.today), inArray(playerWins.ref, list)));
  } catch (error) {
    console.error("game: a win wasn't taken back:", describeError(error));
  }
}

/** A goal's milestones: a quarter of the way, half, three quarters, done. */
export const MILESTONES = [25, 50, 75, 100] as const;

/** Milestones passed going from `before` to `after` saved (cents) toward `target`. */
export function milestonesCrossed(before: number, after: number, target: number): number[] {
  if (target <= 0 || after <= before) return [];
  return MILESTONES.filter((pct) => before * 100 < pct * target && after * 100 >= pct * target);
}

/** Records the milestones a goal just passed. */
export async function goalMilestones(ctx: Ctx, goal: { id: string; name: string; target: number }, before: number, after: number) {
  for (const pct of milestonesCrossed(before, after, goal.target)) await win(ctx, "milestone", `${goal.id}:${pct}`, `${goal.name}: ${pct === 100 ? "reached" : `${pct}%`}`);
}

/** Takes back today's milestones a goal is no longer past (an undone deposit). */
export async function undoGoalMilestones(ctx: Ctx, goal: { id: string; target: number }, saved: number) {
  const gone = MILESTONES.filter((pct) => saved * 100 < pct * goal.target).map((pct) => `${goal.id}:${pct}`);
  await takeBack(ctx, "milestone", gone);
}

/** Categories that are bills rather than everyday spending; a no-spend day can still have these. */
const NOT_EVERYDAY = ["housing", "utilities", "insurance", "loans", "fees", "transfer", "income"];
/**
 * Whether yesterday was a no-spend day: nothing spent on everyday things. Only
 * yesterday is judged, at the next day's check-in, while its purchases still
 * show under their own date (a bank later files a settled purchase under the
 * day it settled, which could make an older day look empty). It only counts
 * once the bank has reported something after it, so an account that isn't
 * sending anything can't look like a run of no-spend days.
 */
export async function noSpendDays(ctx: Ctx): Promise<ISODate[]> {
  const from = addDays(ctx.today, -1);
  const rows = await ctx.db
    .select({ date: transactions.date, amount: transactions.amount, category: transactions.category })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), gt(transactions.date, addDays(from, -1))));
  const latest = rows.reduce<ISODate | null>((m, r) => (m === null || r.date > m ? r.date : m), null);
  if (!latest) return [];
  const spent = new Set(rows.filter((r) => r.amount < 0 && !NOT_EVERYDAY.includes(r.category)).map((r) => r.date));
  const days: ISODate[] = [];
  for (let d = from; d < ctx.today; d = addDays(d, 1)) if (d < latest && !spent.has(d)) days.push(d);
  return days;
}

/**
 * Last month's budgets, once it's over: each limit that held is a win, and
 * keeping every one (two or more) is a bigger one. Judged until it has been.
 */
export async function budgetWins(ctx: Ctx): Promise<void> {
  // From the 3rd, once the month's last charges have had time to arrive.
  if (dayOfMonth(ctx.today) < 3) return;
  const month = addMonthsToMonth(monthOf(ctx.today), -1);
  const ref = `${month}:budgets`;
  const [done] = await ctx.db.select({ id: playerWins.id }).from(playerWins).where(and(eq(playerWins.userId, ctx.userId), eq(playerWins.kind, JUDGED), eq(playerWins.ref, ref))).limit(1);
  if (done) return;
  const result = await lastMonthBudgets(ctx);
  if (!result) return;
  // Written down first (worth nothing), so the month is judged once, however its limits change later.
  const marked = await ctx.db.insert(playerWins).values({ id: crypto.randomUUID(), userId: ctx.userId, kind: JUDGED, xp: 0, label: null, ref, day: ctx.today }).onConflictDoNothing().returning({ id: playerWins.id });
  if (marked.length === 0) return;
  for (const c of result.kept) await win(ctx, "under", `${month}:${c}`, `${category(c).label}, ${monthName(month)}`);
  if (result.judged >= 2 && result.kept.length === result.judged) await win(ctx, "allunder", `${month}:all`, monthName(month));
}

/**
 * Last month's no-spend week (its last seven days), once it's over: nothing spent but bills on every one
 * of them is a big win. Looked at in the first ten days of the month; the win counts once.
 */
async function noSpendWeekWin(ctx: Ctx): Promise<void> {
  if (dayOfMonth(ctx.today) > 10) return;
  const month = addMonthsToMonth(monthOf(ctx.today), -1);
  const week = await noSpendWeekFor(ctx, month);
  if (week && week.phase === "done" && week.clear === week.days.length) await win(ctx, "nospendweek", month, monthName(month));
}

/** The note that a month's budgets have been judged. Not a win: it's never shown or counted. */
const JUDGED = "budgets-judged";

/** Opening the app once a day: a check-in (for the streak), plus yesterday if it was a no-spend day. */
export async function checkIn(ctx: Ctx): Promise<void> {
  await win(ctx, "checkin", ctx.today, null);
  try {
    await budgetWins(ctx);
  } catch (error) {
    console.error("game: last month's budgets weren't checked:", describeError(error));
  }
  try {
    await noSpendWeekWin(ctx);
  } catch (error) {
    console.error("game: last month's no-spend week wasn't checked:", describeError(error));
  }
  try {
    // Counted today (so it shows in today's XP), and once for that day however late it's noticed.
    for (const day of await noSpendDays(ctx)) await win(ctx, "nospend", day, formatShort(day));
  } catch (error) {
    console.error("game: no-spend days weren't checked:", describeError(error));
  }
}

export type { GamePayload };

export async function getGame(ctx: Ctx): Promise<GamePayload> {
  const mine = eq(playerWins.userId, ctx.userId);
  const [byKind, checkins, recentRows, [today]] = await Promise.all([
    ctx.db.select({ kind: playerWins.kind, count: sql<number>`count(*)::int`, xp: sql<number>`coalesce(sum(${playerWins.xp}), 0)::int` }).from(playerWins).where(mine).groupBy(playerWins.kind),
    ctx.db.select({ day: playerWins.day }).from(playerWins).where(and(mine, eq(playerWins.kind, "checkin"))),
    ctx.db
      .select({ id: playerWins.id, kind: playerWins.kind, xp: playerWins.xp, label: playerWins.label, day: playerWins.day })
      .from(playerWins)
      .where(mine)
      .orderBy(desc(playerWins.createdAt), desc(playerWins.id))
      .limit(20),
    ctx.db.select({ xp: sql<number>`coalesce(sum(${playerWins.xp}), 0)::int` }).from(playerWins).where(and(mine, eq(playerWins.day, ctx.today))),
  ]);
  const counts: Partial<Record<WinKind, number>> = {};
  let xp = 0;
  for (const row of byKind) {
    if (!isWinKind(row.kind)) continue;
    counts[row.kind] = row.count;
    xp += row.xp;
  }
  const days = checkins.map((c) => c.day);
  const { level, into, needed } = levelFor(xp);
  return {
    xp,
    level,
    into,
    needed,
    todayXp: today?.xp ?? 0,
    streak: streak(days, ctx.today),
    bestStreak: bestStreak(days),
    checkedInToday: days.includes(ctx.today),
    badges: badgesFor(counts, days, level),
    counts,
    recent: recentRows.filter((r): r is typeof r & { kind: WinKind } => isWinKind(r.kind)).map((r) => ({ ...r, title: WINS[r.kind].label })),
  };
}
