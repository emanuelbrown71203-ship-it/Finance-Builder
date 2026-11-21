import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID } from "@/lib/config";
import type { Ctx } from "@/server/auth";
import { deleteDeposit, setBudget, setDebtPlan, setDebtSettings, setRecurringOverride, updateGoal, updateTransaction } from "@/server/mutations";
import { loadRules } from "@/server/rules";
import { getAccounts, getBudget, getDebt, getGoal, getGoals, getInvestments, getNetWorth, getOverview, getRecap, getRecurring, getTransactions } from "@/server/queries";

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

  it("lists what needs a look on Home, each with somewhere to go", async () => {
    // A limit that is certainly passed, so the test doesn't depend on how the sample month happens to go.
    await setBudget(ctx, "groceries", 100);
    const { attention } = await getOverview(ctx);
    await setBudget(ctx, "groceries", 65000);
    expect(attention.map((a) => a.kind)).toEqual(expect.arrayContaining(["due", "price", "budget"]));
    expect(attention.find((a) => a.kind === "price")).toMatchObject({ title: "Netflix raised its price", href: "/bills" });
    expect(attention.find((a) => a.kind === "due")?.title).toMatch(/is due (today|tomorrow|in 2 days)$/);
    expect(attention.find((a) => a.kind === "budget")).toMatchObject({ title: "Groceries is over its limit", href: "/budget" });
    expect(attention.every((a) => a.href.startsWith("/") && a.detail.length > 0)).toBe(true);
    // Most urgent first: what's due comes before budget warnings.
    expect(attention.findIndex((a) => a.kind === "due")).toBeLessThan(attention.findIndex((a) => a.kind === "budget"));
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

  it("remembers a category for a merchant, applies it everywhere, and Undo puts it all back", async () => {
    const all = await getTransactions(ctx, { q: "chipotle", limit: 200, offset: 0 });
    expect(all.total).toBeGreaterThan(5);
    expect(all.transactions.every((t) => t.category === "dining")).toBe(true);
    const one = all.transactions[0];

    // Without "remember", only the one transaction moves.
    let result = await updateTransaction(ctx, one.id, { category: "groceries" });
    expect(result).toEqual({ moved: 0, undo: null });
    await updateTransaction(ctx, one.id, { category: "dining" });

    // With it, every Chipotle charge moves and a rule is saved for the future.
    result = await updateTransaction(ctx, one.id, { category: "entertainment", remember: true });
    expect(result.moved).toBe(all.total - 1);
    expect(result.undo?.rule).toBeNull();
    const after = await getTransactions(ctx, { q: "chipotle", limit: 200, offset: 0 });
    expect(after.transactions.every((t) => t.category === "entertainment")).toBe(true);
    expect((await loadRules(db, DEMO_USER_ID)).get("chipotle")).toBe("entertainment");
    // Other merchants are untouched.
    const others = await getTransactions(ctx, { q: "sweetgreen", limit: 5, offset: 0 });
    expect(others.transactions.every((t) => t.category === "dining")).toBe(true);

    // Undo: the rule goes away and every charge is back where it was.
    await updateTransaction(ctx, one.id, { category: "dining", restore: result.undo! });
    const restored = await getTransactions(ctx, { q: "chipotle", limit: 200, offset: 0 });
    expect(restored.transactions.every((t) => t.category === "dining")).toBe(true);
    expect((await loadRules(db, DEMO_USER_ID)).has("chipotle")).toBe(false);
  });

  it("warns about a yearly renewal and spots a brand-new subscription", async () => {
    const r = await getRecurring(ctx);
    const dropbox = r.series.find((s) => s.name === "Dropbox")!;
    expect(dropbox).toMatchObject({ frequency: "yearly", renewsSoon: true, nextDate: "2026-12-07" });
    expect(dropbox.help.label).toBe("Open Dropbox");
    // Amazon Prime is yearly too, but months away: no warning.
    expect(r.series.find((s) => s.name === "Amazon Prime")?.renewsSoon).toBe(false);
    expect(r.possible.map((p) => p.name)).toEqual(["Disney+"]);
    const { attention } = await getOverview(ctx);
    expect(attention.find((a) => a.kind === "renewal")?.title).toBe("Dropbox renews in 18 days");
    expect(attention.find((a) => a.kind === "new")?.title).toBe("Disney+ looks like a new subscription");
  });

  it("builds a debt payoff plan from the loans, leaving out a card that is paid as it goes", async () => {
    const d = await getDebt(ctx);
    const byName = Object.fromEntries(d.debts.map((x) => [x.name, x]));
    expect(byName["Cashback Visa"]).toMatchObject({ paidInFull: true, order: null });
    // The loan payments were found in the transaction history.
    expect(byName["Auto Loan"]).toMatchObject({ payment: 31840, paymentSource: "history", aprPercent: 5.9, order: 1 });
    expect(byName["Student Loan"]).toMatchObject({ payment: 24000, aprPercent: 4.5, order: 2 });
    expect(d.plan.debtFreeMonth).toBe(d.base.debtFreeMonth);
    expect(d.plan.months).toBeGreaterThan(48);

    await setDebtSettings(ctx, { extra: 20000 });
    const faster = await getDebt(ctx);
    expect(faster.extra).toBe(20000);
    expect(faster.plan.months!).toBeLessThan(faster.base.months!);
    expect(faster.plan.totalInterest).toBeLessThan(faster.base.totalInterest);

    // The owner can correct a payment; it then counts as theirs.
    await setDebtPlan(ctx, byName["Student Loan"].id, { monthlyPayment: 40000 });
    expect((await getDebt(ctx)).debts.find((x) => x.name === "Student Loan")).toMatchObject({ payment: 40000, paymentSource: "yours" });
    await setDebtSettings(ctx, { extra: 0 });
  });

  it("recaps last week, Monday to Sunday", async () => {
    const r = await getRecap(ctx, 0);
    // Today is Thursday Nov 19, so last week ran Nov 9 to Nov 15.
    expect(r).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
    expect(r.spent).toBeGreaterThan(0);
    expect(r.income).toBe(284632);
    expect(r.topCategories.length).toBeLessThanOrEqual(3);
    expect(r.topCategories.reduce((s, c) => s + c.spent, 0)).toBeLessThanOrEqual(r.spent);
    expect(r.noSpendDays).toBeGreaterThanOrEqual(0);
    expect(r.noSpendDays).toBeLessThanOrEqual(7);
    expect(r.biggest!.amount).toBeLessThan(0);
    expect(r.netWorthChange).not.toBeNull();
    expect((await getRecap(ctx, 1)).to).toBe("2026-11-08");
  });

  it("gives each goal a plan: open-ended, behind, on track", async () => {
    const { goals } = await getGoals(ctx);
    expect(goals.map((g) => [g.name, g.status])).toEqual([
      ["Emergency fund", "no_date"],
      ["Down payment", "behind"],
      ["Two weeks in Japan", "on_track"],
    ]);
    const japan = goals[2];
    // $2,350 to go by the end of August: about 9.4 months, so $251 a month.
    expect(japan.perMonth).toBe(25_100);
    // Paychecks every two weeks: the plan also says how much from each one.
    expect(japan.perPayday).not.toBeNull();
    expect(japan.nextPayday! > today).toBe(true);
    const home = goals[1];
    expect(home.gap).toBeLessThan(-500_000);
  });

  it("draws a goal's track: history, checkpoints, milestones and ideas", async () => {
    const japan = (await getGoals(ctx)).goals.find((g) => g.name === "Two weeks in Japan")!;
    const detail = await getGoal(ctx, japan.id);
    expect(detail.startSaved).toBe(65_000);
    expect(detail.history[0]).toEqual({ date: detail.startDate, amount: 65_000 });
    expect(detail.history.at(-1)!.amount).toBe(215_000);
    expect(detail.deposits.length).toBe(6);
    expect(detail.checkpoints.at(-1)).toMatchObject({ date: japan.targetDate, amount: 450_000 });
    expect(detail.milestones.map((m) => m.percent)).toEqual([25, 50, 75, 100]);
    expect(detail.milestones[0].reachedOn).not.toBeNull();
    expect(detail.payFrequency).toBe("Every 2 weeks");
    await expect(getGoal({ ...ctx, userId: "someone-else" }, japan.id)).rejects.toThrow("wasn’t found");
  });

  it("writes each deposit down, and Undo takes exactly that deposit back off", async () => {
    const goal = (await getGoals(ctx)).goals[0];
    const { depositId } = await updateGoal(ctx, goal.id, { add: 12_345 });
    expect(depositId).toBeTruthy();
    expect((await getGoal(ctx, goal.id)).deposits[0]).toMatchObject({ id: depositId, amount: 12_345, date: today });
    // Someone else can't remove it.
    await expect(deleteDeposit({ ...ctx, userId: "someone-else" }, goal.id, depositId!)).rejects.toThrow("wasn’t found");
    await deleteDeposit(ctx, goal.id, depositId!);
    expect((await getGoals(ctx)).goals[0].saved).toBe(goal.saved);
    // Taking out more than is there takes out what is there, and records that.
    const out = await updateGoal(ctx, goal.id, { add: -999_999_999 });
    expect((await getGoals(ctx)).goals[0].saved).toBe(0);
    expect((await getGoal(ctx, goal.id)).deposits[0].amount).toBe(-goal.saved);
    await deleteDeposit(ctx, goal.id, out.depositId!);
    expect((await getGoals(ctx)).goals[0].saved).toBe(goal.saved);
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
