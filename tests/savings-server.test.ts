import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { goals as goalsTable, savingMarks, transactions } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID } from "@/lib/config";
import type { Ctx } from "@/server/auth";
import { createGoal, deleteDeposit, markSavingDone, setSavingMark, updateGoal } from "@/server/mutations";
import { askNickel } from "@/server/nickel";
import { getBudget, getOverview } from "@/server/queries";

/** Savings as a to-do each paycheck, on the sample household (paid $2,846.32 every two weeks: Nov 13, Nov 27). */
const today = "2026-11-19";
let db: DB;
let ctx: Ctx;
let goalId = "";

beforeAll(async () => {
  db = await getDb();
  await seedDemo(db, today, new Date("2026-11-19T20:00:00Z"));
  ctx = { db, userId: DEMO_USER_ID, user: { id: DEMO_USER_ID, name: "Sam", email: "demo@passbook.local" }, today, demo: true };
});

afterAll(async () => {
  await db.delete(goalsTable).where(and(eq(goalsTable.userId, DEMO_USER_ID), like(goalsTable.name, "Test:%")));
  await db.delete(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), like(transactions.id, "save-test-%")));
});

const todo = async (date: string) => (await getBudget(ctx, "2026-11")).savings.todos.find((t) => t.goalId === goalId && t.date === date)!;

describe("savings as a to-do each paycheck", () => {
  it("gives each paycheck a to-do for a goal's share of it, and counts it as spoken for", async () => {
    const before = await getBudget(ctx, "2026-11");
    goalId = await createGoal(ctx, { name: "Test: New car", target: 5_000_000, saved: 0, monthlyContribution: 0, targetDate: null, accountId: null, paycheckShare: 0.1 });
    const after = await getBudget(ctx, "2026-11");
    const mine = after.savings.todos.filter((t) => t.goalId === goalId);
    expect(mine.map((t) => [t.date, t.amount, t.status])).toEqual([
      ["2026-11-13", 28_463, "todo"],
      ["2026-11-27", 28_463, "coming"],
    ]);
    expect(after.plan.saving - before.plan.saving).toBe(56_926);
    expect(before.plan.leftToSpend - after.plan.leftToSpend).toBe(56_926);
    expect(after.savings.goals.find((g) => g.id === goalId)!.paycheckShare).toBe(0.1);
  });

  it("can save less this time, skip one, and go back to the plan", async () => {
    expect(await setSavingMark(ctx, goalId, "2026-11-13", 10_000)).toEqual({ previous: null });
    expect(await todo("2026-11-13")).toMatchObject({ amount: 10_000, planned: 28_463, changed: true, status: "todo" });
    await setSavingMark(ctx, goalId, "2026-11-27", 0);
    expect((await todo("2026-11-27")).status).toBe("skipped");
    expect((await getBudget(ctx, "2026-11")).savings.todos.filter((t) => t.goalId === goalId).reduce((s, t) => s + t.amount, 0)).toBe(10_000);
    expect(await setSavingMark(ctx, goalId, "2026-11-27", null)).toEqual({ previous: 0 });
    await setSavingMark(ctx, goalId, "2026-11-13", null);
    expect(await todo("2026-11-13")).toMatchObject({ amount: 28_463, changed: false });
    // Only the person's own goals, and paychecks near now.
    await expect(setSavingMark(ctx, "not-a-goal", "2026-11-13", 0)).rejects.toThrow(/not found/i);
    await expect(setSavingMark(ctx, goalId, "2025-01-03", 0)).rejects.toThrow(/isn’t one Passbook can change/);
    await expect(setSavingMark(ctx, goalId, "2026-11-13", -5)).rejects.toThrow(/amount/);
  });

  it("says so on Home once the paycheck is in, and opens the to-do itself", async () => {
    const o = await getOverview(ctx);
    const item = o.attention.find((a) => a.kind === "save" && a.title.includes("Test: New car"))!;
    expect(item).toMatchObject({ title: "Put $284.63 toward Test: New car", href: `/budget?save=${encodeURIComponent(`${goalId}|2026-11-13`)}` });
    expect(item.detail).toMatch(/^From your Nov 13 paycheck\. Tap to mark it done, save less or skip it\.$/);
  });

  it("marks it done with money put toward the goal (with Undo), and Nickel knows", async () => {
    const { depositId } = await markSavingDone(ctx, goalId, "2026-11-13", 28_463);
    expect(await todo("2026-11-13")).toMatchObject({ status: "done", saved: 28_463 });
    expect((await getOverview(ctx)).attention.some((a) => a.kind === "save" && a.title.includes("Test: New car"))).toBe(false);
    const nickel = await askNickel(ctx, "how am I doing on savings?");
    expect(nickel?.text).toMatch(/put aside this month/);
    await deleteDeposit(ctx, goalId, depositId!);
    expect((await todo("2026-11-13")).status).toBe("todo");
    await expect(markSavingDone(ctx, goalId, "2026-11-13", 0)).rejects.toThrow(/already done/);
  });

  it("ticks itself off for a goal that follows an account, when the money shows there", async () => {
    await updateGoal(ctx, goalId, { accountId: "demo-savings" });
    const before = await todo("2026-11-13");
    expect(before.account).toEqual({ id: "demo-savings", name: "High-Yield Savings" });
    // A transfer in today covers what's still to do.
    await db.insert(transactions).values({ id: "save-test-1", userId: DEMO_USER_ID, accountId: "demo-savings", plaidTransactionId: "save-test-1", date: "2026-11-14", name: "TRANSFER FROM CHECKING", rawName: "TRANSFER FROM CHECKING", amount: 28_463, category: "transfer", pending: false });
    expect((await todo("2026-11-13")).status).toBe("done");
    expect((await todo("2026-11-13")).saved).toBeGreaterThanOrEqual(before.saved);
    await expect(markSavingDone(ctx, goalId, "2026-11-27", 28_463)).rejects.toThrow(/ticks itself off/);
    await db.delete(transactions).where(eq(transactions.id, "save-test-1"));
    await updateGoal(ctx, goalId, { accountId: null });
  });

  it("spots a share of each paycheck already going into a savings account, and offers it", async () => {
    // 5% of the last three paychecks went into High-Yield Savings on payday.
    const paid = (await db.select({ date: transactions.date, amount: transactions.amount }).from(transactions).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.name, "Halden Studio Payroll")))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
    await db.insert(transactions).values(
      paid.map((p, i) => ({ id: `save-test-habit-${i}`, userId: DEMO_USER_ID, accountId: "demo-savings", plaidTransactionId: `save-test-habit-${i}`, date: p.date, name: "AUTO SAVE", rawName: "AUTO SAVE", amount: Math.round(p.amount * 0.05), category: "transfer", pending: false })),
    );
    const habit = (await getBudget(ctx, "2026-11")).savings.habit;
    expect(habit).toMatchObject({ accountId: "demo-savings", accountName: "High-Yield Savings", share: 0.05 });
    // Once a goal follows it at that share, it's no longer offered.
    await updateGoal(ctx, goalId, { accountId: "demo-savings", paycheckShare: 0.05 });
    expect((await getBudget(ctx, "2026-11")).savings.habit).toBeNull();
    await db.delete(transactions).where(like(transactions.id, "save-test-habit-%"));
    await updateGoal(ctx, goalId, { accountId: null, paycheckShare: 0.1 });
    await db.delete(savingMarks).where(eq(savingMarks.goalId, goalId));
  });

  it("says whether checking can cover it before payday", async () => {
    const cash = (await getBudget(ctx, "2026-11")).savings.cash!;
    expect(cash.nextPayday).toBe("2026-11-27");
    expect(cash.checking).toBeGreaterThan(0);
    expect(cash.billsBeforePayday).toBeGreaterThan(0);
  });
});
