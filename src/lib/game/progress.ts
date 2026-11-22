import { addDays, type ISODate } from "../dates";

/*
 * The game layer: small wins in every part of money (sorting, naming, bills,
 * saving, goals, budgets, debt) earn XP; XP makes levels; streaks and badges
 * come from what's been won. Pure, so it's tested and works on sample data.
 */

export type WinKind = "sort" | "rename" | "note" | "bill" | "cancel" | "goal" | "save" | "milestone" | "budget" | "under" | "allunder" | "plan" | "checkin" | "nospend";

/** XP for each kind of win, and how many of that kind count in a day (so busywork doesn't farm XP). */
export const WINS: Record<WinKind, { xp: number; perDay: number; label: string }> = {
  sort: { xp: 5, perDay: 10, label: "Sorted a charge" },
  rename: { xp: 10, perDay: 10, label: "Gave something a clear name" },
  note: { xp: 3, perDay: 5, label: "Added a note" },
  bill: { xp: 15, perDay: 5, label: "Added a bill" },
  cancel: { xp: 50, perDay: 5, label: "Cancelled a subscription" },
  goal: { xp: 25, perDay: 3, label: "Made a savings goal" },
  save: { xp: 20, perDay: 5, label: "Put money toward a goal" },
  milestone: { xp: 40, perDay: 5, label: "Hit a goal milestone" },
  budget: { xp: 15, perDay: 5, label: "Set a budget limit" },
  under: { xp: 20, perDay: 16, label: "Stayed under budget" },
  allunder: { xp: 50, perDay: 1, label: "Kept every budget" },
  plan: { xp: 15, perDay: 3, label: "Tuned the debt plan" },
  checkin: { xp: 5, perDay: 1, label: "Checked in" },
  nospend: { xp: 15, perDay: 1, label: "A no-spend day" },
};

export const isWinKind = (k: string): k is WinKind => k in WINS;

/** XP needed to reach a level: 0, 100, 300, 600, 1000… (each level takes 100 more than the last). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelFor(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, into: xp - xpForLevel(level), needed: xpForLevel(level + 1) - xpForLevel(level) };
}

/** Days in a row, ending today or yesterday, that appear in `days`. */
export function streak(days: Iterable<ISODate>, today: ISODate): number {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export type BadgeId =
  | "first-win"
  | "sorter"
  | "name-tamer"
  | "slayer"
  | "goal-getter"
  | "saver"
  | "milestone"
  | "budget-boss"
  | "on-budget"
  | "clean-sweep"
  | "planner"
  | "streak-7"
  | "streak-30"
  | "no-spend-ninja"
  | "level-5"
  | "level-10";

export type Badge = { id: BadgeId; name: string; how: string; earned: boolean };

type Counts = Partial<Record<WinKind, number>>;

const BADGES: { id: BadgeId; name: string; how: string; test: (c: Counts, best: number, level: number) => boolean }[] = [
  { id: "first-win", name: "First Steps", how: "Get your first win", test: (c) => Object.values(c).some((n) => (n ?? 0) > 0) },
  { id: "sorter", name: "Sorter", how: "Sort 25 charges", test: (c) => (c.sort ?? 0) >= 25 },
  { id: "name-tamer", name: "Name Tamer", how: "Give 10 things clear names", test: (c) => (c.rename ?? 0) >= 10 },
  { id: "slayer", name: "Subscription Slayer", how: "Cancel a subscription", test: (c) => (c.cancel ?? 0) >= 1 },
  { id: "goal-getter", name: "Goal Getter", how: "Make a savings goal", test: (c) => (c.goal ?? 0) >= 1 },
  { id: "saver", name: "Saver", how: "Put money toward goals 10 times", test: (c) => (c.save ?? 0) >= 10 },
  { id: "milestone", name: "Milestone", how: "Get a goal to 25%", test: (c) => (c.milestone ?? 0) >= 1 },
  { id: "budget-boss", name: "Budget Boss", how: "Set 3 budget limits", test: (c) => (c.budget ?? 0) >= 3 },
  { id: "on-budget", name: "On Budget", how: "Finish a month under budget in a category", test: (c) => (c.under ?? 0) >= 1 },
  { id: "clean-sweep", name: "Clean Sweep", how: "Keep every budget for a whole month", test: (c) => (c.allunder ?? 0) >= 1 },
  { id: "planner", name: "Planner", how: "Tune the debt plan", test: (c) => (c.plan ?? 0) >= 1 },
  { id: "streak-7", name: "7-Day Streak", how: "Check in 7 days in a row", test: (_c, best) => best >= 7 },
  { id: "streak-30", name: "30-Day Streak", how: "Check in 30 days in a row", test: (_c, best) => best >= 30 },
  { id: "no-spend-ninja", name: "No-Spend Ninja", how: "Have 5 no-spend days", test: (c) => (c.nospend ?? 0) >= 5 },
  { id: "level-5", name: "Level 5", how: "Reach level 5", test: (_c, _b, level) => level >= 5 },
  { id: "level-10", name: "Level 10", how: "Reach level 10", test: (_c, _b, level) => level >= 10 },
];

/** The longest run of days in a row in `days`. */
export function bestStreak(days: Iterable<ISODate>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export function badgesFor(counts: Counts, checkinDays: ISODate[], level: number): Badge[] {
  const best = bestStreak(checkinDays);
  return BADGES.map((b) => ({ id: b.id, name: b.name, how: b.how, earned: b.test(counts, best, level) }));
}

/** What the app shows: worked out on the server from the wins written down. */
export type GameWin = { id: string; kind: WinKind; xp: number; label: string | null; title: string; day: ISODate };

export type GamePayload = {
  xp: number;
  level: number;
  /** XP into this level, and XP this level takes in all. */
  into: number;
  needed: number;
  todayXp: number;
  streak: number;
  bestStreak: number;
  checkedInToday: boolean;
  badges: Badge[];
  counts: Partial<Record<WinKind, number>>;
  recent: GameWin[];
};
