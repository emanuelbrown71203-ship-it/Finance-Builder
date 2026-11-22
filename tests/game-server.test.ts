import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { playerWins, transactions } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID } from "@/lib/config";
import { WINS } from "@/lib/game/progress";
import { addBill, addGoal, addToGoal, changeLoan, undoActivity } from "@/server/actions";
import type { Ctx } from "@/server/auth";
import { budgetWins, checkIn, getGame, milestonesCrossed, noSpendDays, win } from "@/server/game";
import { lastMonthBudgets } from "@/server/queries";
import { createManualBill, deleteManualBill, restoreManualBill, updateManualBill } from "@/server/manual-bills";
import { createGoal, deleteDeposit, deleteGoal, setBudget, setRecurringOverride, updateGoal, updateTransaction } from "@/server/mutations";
import { createNameRule, deleteNameRule } from "@/server/names";

/** The game layer over the real SQL: wins are recorded where things happen, once each, within daily limits. */
const today = "2026-11-19";
let db: DB;
let ctx: Ctx;

beforeAll(async () => {
  db = await getDb();
  await seedDemo(db, today, new Date("2026-11-19T20:00:00Z"));
  ctx = { db, userId: DEMO_USER_ID, user: { id: DEMO_USER_ID, name: "Sam", email: "demo@passbook.local" }, today, demo: true };
});

const xp = async () => (await getGame(ctx)).xp;

describe("the game on the server", () => {
  it("starts the sample household at level 3 with a six-day streak, and today's visit makes it seven", async () => {
    const before = await getGame(ctx);
    expect(before.level).toBe(3);
    expect(before.streak).toBe(6);
    expect(before.checkedInToday).toBe(false);
    expect(before.badges.find((b) => b.id === "streak-7")?.earned).toBe(false);
    expect(before.badges.filter((b) => b.earned).map((b) => b.id)).toEqual(expect.arrayContaining(["first-win", "goal-getter", "milestone", "budget-boss"]));

    await checkIn(ctx);
    await checkIn(ctx); // twice in a day counts once
    const after = await getGame(ctx);
    expect(after.xp - before.xp).toBeGreaterThanOrEqual(WINS.checkin.xp);
    expect(after.streak).toBe(7);
    expect(after.checkedInToday).toBe(true);
    expect(after.badges.find((b) => b.id === "streak-7")?.earned).toBe(true);
    expect(after.recent.some((w) => w.kind === "checkin")).toBe(true);
  });

  it("judges last month's budgets at the check-in: a win for each limit kept, once", async () => {
    const result = await lastMonthBudgets(ctx);
    expect(result).not.toBeNull();
    // The sample household set its seven limits months ago, so all of last month is judged.
    expect(result!.judged).toBe(7);
    const wins = await db.select().from(playerWins).where(and(eq(playerWins.userId, DEMO_USER_ID), eq(playerWins.kind, "under")));
    expect(wins.map((w) => w.ref).sort()).toEqual(result!.kept.map((c) => `${result!.month}:${c}`).sort());
    const all = await db.select().from(playerWins).where(and(eq(playerWins.userId, DEMO_USER_ID), eq(playerWins.kind, "allunder")));
    expect(all).toHaveLength(result!.kept.length === result!.judged ? 1 : 0);
    // Checking in again (another day this month) doesn't judge it twice, even with limits changed since.
    await setBudget(ctx, "dining", 100_000_00);
    await budgetWins(ctx);
    expect(await db.select().from(playerWins).where(and(eq(playerWins.userId, DEMO_USER_ID), eq(playerWins.kind, "under")))).toHaveLength(wins.length);
    await setBudget(ctx, "dining", 28000);
  });

  it("waits until the 3rd to judge last month, so its last charges can arrive", async () => {
    const early: Ctx = { ...ctx, userId: "nobody-yet", today: "2026-12-02" };
    await budgetWins(early);
    expect(await db.select().from(playerWins).where(eq(playerWins.userId, "nobody-yet"))).toHaveLength(0);
  });

  it("only judges limits set by the 8th of last month", async () => {
    const fresh: Ctx = { ...ctx, today: "2026-12-03" };
    // A limit set today can't win November.
    await setBudget(fresh, "travel", 100_000);
    const result = await lastMonthBudgets(fresh);
    expect(result?.kept ?? []).not.toContain("travel");
    await setBudget(fresh, "travel", null);
  });

  it("gives XP for sorting a charge once, however often it's changed", async () => {
    const [tx] = await db.select().from(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.category, "dining"))).limit(1);
    const start = await xp();
    await updateTransaction(ctx, tx.id, { category: "shopping" });
    expect(await xp()).toBe(start + WINS.sort.xp);
    await updateTransaction(ctx, tx.id, { category: "dining" });
    await updateTransaction(ctx, tx.id, { category: "dining" });
    expect(await xp()).toBe(start + WINS.sort.xp);
    // A name and a note are wins of their own.
    await updateTransaction(ctx, tx.id, { name: "Lunch with Ana", note: "Birthday" });
    expect(await xp()).toBe(start + WINS.sort.xp + WINS.rename.xp + WINS.note.xp);
    // Putting the old name back, or clearing the note, earns nothing.
    await updateTransaction(ctx, tx.id, { name: null, note: null });
    expect(await xp()).toBe(start + WINS.sort.xp + WINS.rename.xp + WINS.note.xp);
  });

  it("stops counting a kind of win after its daily limit", async () => {
    const rows = await db.select().from(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.category, "groceries"))).limit(15);
    for (const t of rows) await updateTransaction(ctx, t.id, { category: "shopping" });
    const sorts = await db.select().from(playerWins).where(and(eq(playerWins.userId, DEMO_USER_ID), eq(playerWins.kind, "sort"), eq(playerWins.day, today)));
    expect(sorts).toHaveLength(WINS.sort.perDay);
  });

  it("cancelling a subscription is a big win; Undo the same day takes it back, and doing it again can't double it", async () => {
    const start = await xp();
    await setRecurringOverride(ctx, "out:spotify", { cancelled: true });
    expect(await xp()).toBe(start + WINS.cancel.xp);
    await setRecurringOverride(ctx, "out:spotify", { cancelled: true });
    expect(await xp()).toBe(start + WINS.cancel.xp);
    const game = await getGame(ctx);
    expect(game.recent[0]).toMatchObject({ kind: "cancel", label: "Spotify", title: "Cancelled a subscription" });
    expect(game.badges.find((b) => b.id === "slayer")?.earned).toBe(true);
    await setRecurringOverride(ctx, "out:spotify", { cancelled: false });
    expect(await xp()).toBe(start);
    // Money coming in isn't something you cancel.
    await setRecurringOverride(ctx, "in:halden studio payroll", { cancelled: true });
    expect(await xp()).toBe(start);
    await setRecurringOverride(ctx, "in:halden studio payroll", { cancelled: false });
  });

  it("adding a bill wins once; removing it today takes it back and Undo returns it", async () => {
    const start = await xp();
    const bill = await createManualBill(ctx, { name: "Window cleaner", amount: 4000, frequency: "monthly", startDate: "2026-11-28" }, "you");
    expect(await xp()).toBe(start + WINS.bill.xp);
    const removed = await deleteManualBill(ctx, bill.id);
    expect(await xp()).toBe(start);
    await restoreManualBill(ctx, removed);
    expect(await xp()).toBe(start + WINS.bill.xp);
    await updateManualBill(ctx, bill.id, { cancelled: true });
    expect(await xp()).toBe(start + WINS.bill.xp + WINS.cancel.xp);
    await updateManualBill(ctx, bill.id, { cancelled: false });
    expect(await xp()).toBe(start + WINS.bill.xp);
  });

  it("saving toward a goal wins, passes milestones, and Undo takes both back", async () => {
    const goalId = await createGoal(ctx, { name: "New bike", target: 100_000, saved: 0, monthlyContribution: 0, targetDate: null });
    const start = await xp();
    const { depositId } = await updateGoal(ctx, goalId, { add: 60_000 });
    // 60% passes the 25% and 50% marks.
    expect(await xp()).toBe(start + WINS.save.xp + 2 * WINS.milestone.xp);
    expect((await getGame(ctx)).recent.map((r) => r.label)).toEqual(expect.arrayContaining(["New bike: 25%", "New bike: 50%"]));
    await deleteDeposit(ctx, goalId, depositId!);
    expect(await xp()).toBe(start);
    // Taking money out isn't a win.
    await updateGoal(ctx, goalId, { add: 10_000 });
    const mid = await xp();
    await updateGoal(ctx, goalId, { add: -5_000 });
    expect(await xp()).toBe(mid);
  });

  it("counts a budget limit once per category per month", async () => {
    const start = await xp();
    await setBudget(ctx, "travel", 50_000);
    await setBudget(ctx, "travel", 60_000);
    expect(await xp()).toBe(start + WINS.budget.xp);
    // Taking away a limit set today (its Undo) takes the XP back; setting it again can earn it once more.
    await setBudget(ctx, "travel", null);
    expect(await xp()).toBe(start);
    await setBudget(ctx, "travel", 50_000);
    expect(await xp()).toBe(start + WINS.budget.xp);
  });

  it("the screen's Undo takes back what a change to a charge earned today", async () => {
    const [tx] = await db.select().from(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.category, "entertainment"))).limit(1);
    const start = await xp();
    // (Today's sorting limit was used up above, so this earns from the name and the note.)
    await updateTransaction(ctx, tx.id, { name: "Concert tickets", note: "Concert" });
    expect(await xp()).toBe(start + WINS.rename.xp + WINS.note.xp);
    await updateTransaction(ctx, tx.id, { name: null, note: "", undo: true });
    expect(await xp()).toBe(start);
  });

  it("removing a goal the day it was made takes back everything it earned, including when Nickel's Undo does it", async () => {
    const start = await xp();
    const id = await createGoal(ctx, { name: "Laptop", target: 100_000, saved: 100_000, monthlyContribution: 0, targetDate: null });
    expect(await xp()).toBeGreaterThan(start);
    await deleteGoal(ctx, id);
    expect(await xp()).toBe(start);
    const done = await addGoal(ctx, "nickel", { name: "Camera", target: 80_000, targetDate: null, saved: 40_000 });
    expect(await xp()).toBeGreaterThan(start);
    await undoActivity(ctx, done.activityId);
    expect(await xp()).toBe(start);
  });

  it("deleting a cancelled bill takes back its cancel XP too, and Undo returns both", async () => {
    const start = await xp();
    const bill = await createManualBill(ctx, { name: "Magazine", amount: 900, frequency: "monthly", startDate: "2026-11-27", kind: "subscription" }, "you");
    await updateManualBill(ctx, bill.id, { cancelled: true });
    expect(await xp()).toBe(start + WINS.bill.xp + WINS.cancel.xp);
    const removed = await deleteManualBill(ctx, bill.id);
    expect(await xp()).toBe(start);
    await restoreManualBill(ctx, removed);
    expect(await xp()).toBe(start + WINS.bill.xp + WINS.cancel.xp);
  });

  it("never gives cancel XP for a bill that isn't in the person's charges", async () => {
    const start = await xp();
    await setRecurringOverride(ctx, "out:made up thing", { cancelled: true });
    expect(await xp()).toBe(start);
  });

  it("stopping a name saved today, or Undo of a loan change, takes its XP back", async () => {
    const [tx] = await db.select().from(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.name, "Trader Joe’s"))).limit(1);
    const start = await xp();
    const { ruleId } = await createNameRule(ctx, { transactionId: tx.id, name: "Groceries run" });
    expect(await xp()).toBe(start + WINS.rename.xp);
    await deleteNameRule(ctx, ruleId);
    expect(await xp()).toBe(start);
    const done = await changeLoan(ctx, "claude", "demo-auto-loan", { aprPercent: 5.9 });
    expect(await xp()).toBe(start + WINS.plan.xp);
    await undoActivity(ctx, done.activityId);
    expect(await xp()).toBe(start);
  });

  it("counts names and things Nickel or Claude did when asked, and their Undo takes saves back", async () => {
    const [tx] = await db.select().from(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.name, "Blue Bottle Coffee"))).limit(1);
    const start = await xp();
    await createNameRule(ctx, { transactionId: tx.id, name: "Coffee" });
    expect(await xp()).toBe(start + WINS.rename.xp);
    const done = await addBill(ctx, "nickel", { name: "Dog walker", amount: 6000, frequency: "monthly", date: "2026-11-30", kind: "bill" });
    expect(await xp()).toBe(start + WINS.rename.xp + WINS.bill.xp);
    await undoActivity(ctx, done.activityId);
    expect(await xp()).toBe(start + WINS.rename.xp);
    const goals = (await getGame(ctx)).counts;
    expect(goals.rename).toBeGreaterThan(0);
    const saved = await addToGoal(ctx, "claude", "demo-goal-home", 1000);
    expect(await xp()).toBe(start + WINS.rename.xp + WINS.save.xp);
    await undoActivity(ctx, saved.activityId);
    expect(await xp()).toBe(start + WINS.rename.xp);
  });

  it("finds no-spend days only once the bank has reported something after them", async () => {
    const quiet: Ctx = { ...ctx, userId: "nobody-here", today };
    expect(await noSpendDays(quiet)).toEqual([]);
    // In the sample household every day has everyday spending.
    expect(await noSpendDays(ctx)).toEqual([]);
  });

  it("works out which goal milestones a deposit passes", () => {
    expect(milestonesCrossed(0, 2_500, 10_000)).toEqual([25]);
    expect(milestonesCrossed(2_400, 10_000, 10_000)).toEqual([25, 50, 75, 100]);
    expect(milestonesCrossed(2_500, 4_999, 10_000)).toEqual([]);
    expect(milestonesCrossed(5_000, 4_000, 10_000)).toEqual([]);
    expect(milestonesCrossed(0, 100, 0)).toEqual([]);
  });

  it("keeps each person's wins to themselves", async () => {
    const other: Ctx = { ...ctx, userId: "someone-else" };
    expect((await getGame(other)).xp).toBe(0);
    // A win for someone who doesn't exist fails quietly, never throws into the real change.
    expect(await win(other, "checkin", today)).toBe(false);
  });
});
