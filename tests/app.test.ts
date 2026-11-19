import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID } from "@/lib/config";
import type { Ctx } from "@/server/auth";
import { setBudget, setRecurringOverride, updateGoal, updateTransaction } from "@/server/mutations";
import { getAccounts, getBudget, getGoals, getInvestments, getNetWorth, getOverview, getRecurring, getTransactions } from "@/server/queries";

/** End-to-end over the real SQL: seed the sample household into PGlite, then read it back. */
const today = "2026-11-19";
let db: DB;
let ctx: Ctx;

beforeAll(async () => {
  db = await getDb();
  await seedDemo(db, today, new Date("2026-11-19T20:00:00Z"));
  ctx = { db, userId: DEMO_USER_ID, user: { id: DEMO_USER_ID, name: "Sam", email: "demo@passbook.local" }, today, demo: true };
});

describe("sample household", () => {
  it("has linked institutions, accounts and a hand-tracked asset", async () => {
    const a = await getAccounts(ctx);
    expect(a.institutions.map((i) => i.institutionName)).toEqual(["Cedar Lending", "Fernway Invest", "Larch Retirement", "Meridian Card", "Northwind Bank"]);
    expect(a.manual).toHaveLength(1);
    const checking = a.institutions.flatMap((i) => i.accounts).find((x) => x.subtype === "checking")!;
    expect(checking.balance).toBeGreaterThan(0);
  });

  it("detects the recurring charges that were seeded", async () => {
    const r = await getRecurring(ctx);
    const names = r.series.map((s) => s.name);
    for (const expected of ["Parkview Apartments", "Netflix", "Spotify", "Geico", "Halden Studio Payroll", "City Light & Power", "Anytime Fitness", "Amazon Prime"]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("Blue Bottle Coffee");
    expect(names).not.toContain("Trader Joe’s");
    expect(r.series.find((s) => s.name === "Netflix")?.priceChange).toEqual({ from: -1549, to: -1799 });
    expect(r.series.find((s) => s.name === "Hulu")?.active).toBe(false);
    expect(r.upcoming[0].date >= today).toBe(true);
    expect(r.upcoming.some((u) => u.kind === "card")).toBe(true);
    expect(r.monthlyBills).toBeGreaterThan(280000);
  });

  it("builds a month plan whose parts add up", async () => {
    const { plan } = await getOverview(ctx);
    expect(plan.days).toHaveLength(30);
    expect(plan.leftToSpend).toBe(plan.incomeExpected - plan.billsExpected - plan.savingsPlanned - plan.everydaySpent);
    expect(plan.incomeExpected).toBeGreaterThan(plan.incomeReceived);
    expect(plan.billsExpected).toBeGreaterThan(plan.billsPaid);
    expect(plan.daysLeft).toBe(12);
    const sum = (k: "income" | "bills" | "everyday") => plan.days.reduce((s, d) => s + d[k], 0);
    expect(sum("income")).toBe(plan.incomeExpected);
    expect(sum("bills")).toBe(plan.billsExpected);
    expect(sum("everyday")).toBe(plan.everydaySpent);
  });

  it("net worth equals assets minus debts and matches the accounts", async () => {
    const w = await getNetWorth(ctx, "1y");
    expect(w.net).toBe(w.assets - w.debts);
    expect(w.net).toBe(w.accounts.reduce((s, a) => s + a.balance, 0));
    expect(w.series.length).toBeGreaterThan(360);
    expect(w.series.at(-1)?.date).toBe(today);
  });

  it("investments total matches holdings", async () => {
    const inv = await getInvestments(ctx, "6m");
    expect(inv.holdings.reduce((s, h) => s + h.value, 0)).toBe(inv.total);
    expect(inv.allocation.reduce((s, a) => s + a.value, 0)).toBe(inv.total);
  });

  it("filters and searches transactions", async () => {
    const all = await getTransactions(ctx, { limit: 50, offset: 0 });
    expect(all.total).toBeGreaterThan(900);
    expect(all.transactions).toHaveLength(50);
    expect(all.hasMore).toBe(true);
    const search = await getTransactions(ctx, { q: "netflix", limit: 50, offset: 0 });
    expect(search.total).toBeGreaterThan(10);
    expect(search.transactions.every((t) => t.name === "Netflix")).toBe(true);
    const groceries = await getTransactions(ctx, { category: "groceries", month: "2026-10", limit: 200, offset: 0 });
    expect(groceries.transactions.every((t) => t.category === "groceries" && t.date.startsWith("2026-10"))).toBe(true);
  });

  it("recategorizing a transaction moves it between budget rows", async () => {
    const { transactions } = await getTransactions(ctx, { category: "dining", month: "2026-11", limit: 1, offset: 0 });
    const before = await getBudget(ctx, "2026-11");
    await updateTransaction(ctx, transactions[0].id, { category: "groceries", note: "Team lunch" });
    const after = await getBudget(ctx, "2026-11");
    const spent = (b: typeof before, c: string) => b.rows.find((r) => r.category === c)!.spent;
    expect(spent(after, "dining")).toBe(spent(before, "dining") + transactions[0].amount);
    expect(spent(after, "groceries")).toBe(spent(before, "groceries") - transactions[0].amount);
    expect(after.totalSpent).toBe(before.totalSpent);
  });

  it("saves budget limits, goal deposits and cancelled subscriptions", async () => {
    await setBudget(ctx, "travel", 30000);
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "travel")?.limit).toBe(30000);
    await setBudget(ctx, "travel", null);
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "travel")).toBeUndefined();

    const goals = await getGoals(ctx);
    await updateGoal(ctx, goals.goals[0].id, { add: 5000 });
    expect((await getGoals(ctx)).goals[0].saved).toBe(goals.goals[0].saved + 5000);

    const before = await getRecurring(ctx);
    const spotify = before.series.find((s) => s.name === "Spotify")!;
    await setRecurringOverride(ctx, spotify.key, { cancelled: true });
    const after = await getRecurring(ctx);
    expect(after.series.find((s) => s.name === "Spotify")).toMatchObject({ cancelled: true, active: false });
    expect(after.monthlySubscriptions).toBe(before.monthlySubscriptions - 1199);
    expect(after.upcoming.some((u) => u.name === "Spotify")).toBe(false);
  });
});
