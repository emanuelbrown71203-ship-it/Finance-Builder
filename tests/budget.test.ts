import { describe, expect, it } from "vitest";
import { budgetPlan, categoryBudgets, monthProgress, suggestLimits, type BudgetTx } from "@/lib/finance/budget";
import { BUDGET_CATEGORIES, isReturnedPayment } from "@/lib/categories";
import { buildMonthPlan } from "@/lib/finance/plan";

/** The budget engine: everyday spending against limits, rollover, pace, forecast, and a starting budget. */

let n = 0;
const tx = (date: string, amount: number, category: string, id = `t${++n}`): BudgetTx => ({ id, date, amount, category });
const dollars = (d: number) => Math.round(d * 100);

describe("category budgets", () => {
  // November 2026 has 30 days; the 10th leaves 21 days, today included.
  const today = "2026-11-10";
  const history = [
    // Three earlier months of dining at $300.
    tx("2026-08-05", dollars(-300), "dining"),
    tx("2026-09-05", dollars(-300), "dining"),
    tx("2026-10-05", dollars(-300), "dining"),
    // This month so far.
    tx("2026-11-02", dollars(-120), "dining"),
    tx("2026-11-08", dollars(-30), "dining"),
    // A refund lowers it.
    tx("2026-11-09", dollars(10), "dining"),
    // Netflix is a bill: shown beside entertainment, never counted against it.
    tx("2026-11-04", dollars(-17.99), "entertainment", "netflix-nov"),
    tx("2026-11-06", dollars(-40), "entertainment"),
    // Money moving between your own accounts and money coming in are never budgeted.
    tx("2026-11-03", dollars(-500), "transfer"),
    tx("2026-11-01", dollars(3000), "income"),
  ];
  const billIds = new Set(["netflix-nov"]);

  it("counts everyday spending only, with refunds, and keeps bills beside it", () => {
    const rows = categoryBudgets({ month: "2026-11", today, history, billIds, limits: [{ category: "entertainment", limit: dollars(50), rolloverSince: null }] });
    const ent = rows.find((r) => r.category === "entertainment")!;
    expect(ent.spent).toBe(dollars(40));
    expect(ent.bills).toBe(dollars(17.99));
    expect(ent.left).toBe(dollars(10));
    expect(rows.find((r) => r.category === "dining")!.spent).toBe(dollars(140));
    expect(rows.some((r) => r.category === "transfer" || r.category === "income")).toBe(false);
  });

  it("works out what's left a day, where the month is heading, and whether it's on track", () => {
    const tight = categoryBudgets({ month: "2026-11", today, history, billIds, limits: [{ category: "dining", limit: dollars(300), rolloverSince: null }] }).find((r) => r.category === "dining")!;
    expect(tight.left).toBe(dollars(160));
    expect(tight.perDay).toBe(Math.floor(dollars(160) / 21));
    expect(tight.average).toBe(dollars(300));
    // 20 days to go at a blend of the usual $10 a day and this month's $14 a day: about $380 by the end.
    expect(tight.forecast).toBe(Math.round(dollars(140) + 20 * ((dollars(300) / 30 + dollars(140) / 10) / 2)));
    expect(tight.status).toBe("watch");
    expect(tight.paceNow).toBe(Math.round((dollars(300) * 10) / 30));

    const roomy = categoryBudgets({ month: "2026-11", today, history, billIds, limits: [{ category: "dining", limit: dollars(500), rolloverSince: null }] })[0];
    expect(roomy.status).toBe("good");
    const over = categoryBudgets({ month: "2026-11", today, history, billIds, limits: [{ category: "dining", limit: dollars(100), rolloverSince: null }] })[0];
    expect(over.status).toBe("over");
    expect(over.left).toBe(dollars(-40));
  });

  it("puts the ones that need a look first, then the rest, then spending with no limit", () => {
    const rows = categoryBudgets({
      month: "2026-11",
      today,
      history,
      billIds,
      limits: [
        { category: "entertainment", limit: dollars(500), rolloverSince: null },
        { category: "dining", limit: dollars(100), rolloverSince: null },
        { category: "travel", limit: dollars(200), rolloverSince: null },
      ],
    });
    expect(rows.map((r) => [r.category, r.status])).toEqual([
      ["dining", "over"],
      ["entertainment", "good"],
      ["travel", "good"],
    ]);
  });

  it("rolls over what's left (or overspent) from the month rollover started, month after month", () => {
    const limits = [{ category: "dining", limit: dollars(350), rolloverSince: "2026-09" }];
    const nov = categoryBudgets({ month: "2026-11", today, history, billIds, limits })[0];
    // September and October each left $50.
    expect(nov.carried).toBe(dollars(100));
    expect(nov.left).toBe(dollars(350 + 100 - 140));
    expect(nov.rollover).toBe(true);
    // Overspending carries too: a $250 limit was $50 over each month.
    const tight = categoryBudgets({ month: "2026-11", today, history, billIds, limits: [{ category: "dining", limit: dollars(250), rolloverSince: "2026-09" }] })[0];
    expect(tight.carried).toBe(dollars(-100));
    // Switched on this month: nothing carried yet.
    expect(categoryBudgets({ month: "2026-11", today, history, billIds, limits: [{ category: "dining", limit: dollars(350), rolloverSince: "2026-11" }] })[0].carried).toBe(0);
  });

  it("adds what was carried before the limit last changed, and knows nothing of months before that", () => {
    // Rollover since September at $350, then the limit changed in November with $100 banked.
    const limits = [{ category: "dining", limit: dollars(500), rolloverSince: "2026-11", rolloverCarry: dollars(100) }];
    const nov = categoryBudgets({ month: "2026-11", today, history, billIds, limits })[0];
    expect(nov.carried).toBe(dollars(100));
    expect(nov.left).toBe(dollars(500 + 100 - 140));
    // October is before the change: nothing is guessed for it at today's limit.
    expect(categoryBudgets({ month: "2026-10", today, history, billIds, limits })[0].carried).toBe(0);
  });

  it("keeps a row for a category paid only by bills, so what's spent there is never left out", () => {
    const rows = categoryBudgets({ month: "2026-11", today, history: [...history, tx("2026-11-01", dollars(-1800), "housing", "rent-nov")], billIds: new Set([...billIds, "rent-nov"]), limits: [] });
    expect(rows.find((r) => r.category === "housing")).toMatchObject({ spent: 0, bills: dollars(1800), status: "none" });
  });

  it("treats a finished month as finished", () => {
    const oct = categoryBudgets({ month: "2026-10", today, history, billIds, limits: [{ category: "dining", limit: dollars(350), rolloverSince: null }] })[0];
    expect(oct.forecast).toBe(oct.spent);
    expect(oct.perDay).toBeNull();
    expect(oct.left).toBe(dollars(50));
    expect(monthProgress("2026-10", today)).toMatchObject({ daysLeft: 0, elapsed: 31, isCurrent: false });
    expect(monthProgress("2026-11", today)).toMatchObject({ daysLeft: 21, elapsed: 10, after: 20, isCurrent: true });
  });
});

describe("a starting budget", () => {
  const row = (category: string, average: number) => ({ category, average }) as Parameters<typeof suggestLimits>[0][number];

  it("suggests what's usually spent, rounded up to the next $10, leaving out tiny amounts and fees", () => {
    const { limits, trimmed } = suggestLimits([row("dining", dollars(287.4)), row("groceries", dollars(612)), row("personal", dollars(9)), row("fees", dollars(40))], dollars(5000));
    expect(trimmed).toBe(false);
    expect(limits).toEqual([
      { category: "groceries", limit: dollars(620) },
      { category: "dining", limit: dollars(290) },
    ]);
  });

  it("never suggests a budget for a necessity: rent, utilities, insurance and loans are bills", () => {
    const { limits } = suggestLimits([row("housing", dollars(26)), row("insurance", dollars(55)), row("utilities", dollars(90)), row("loans", dollars(40)), row("dining", dollars(194))], dollars(5000));
    expect(limits.map((l) => l.category)).toEqual(["dining"]);
    expect(BUDGET_CATEGORIES.map((c) => c.key)).not.toContain("housing");
    expect(BUDGET_CATEGORIES.map((c) => c.key)).not.toContain("insurance");
    expect(BUDGET_CATEGORIES.map((c) => c.key)).toContain("shopping");
  });

  it("knows a bounced payment from the fee for it", () => {
    for (const name of ["Returned Mobile ACH Payme nt - CONA", "RETURNED INTERNET PMT", "Returned ACH Card Payment - CONA"]) expect(isReturnedPayment(name)).toBe(true);
    for (const name of ["RETURNED PAYMENT FEE", "RETURNED CHECK CHARGE", "INTERNET PAYMENT - THANKYOU", "Returned item: Nike shoes"]) expect(isReturnedPayment(name)).toBe(false);
  });

  it("trims them all by the same share when they'd add up to more than the month has room for", () => {
    const { limits, trimmed } = suggestLimits([row("dining", dollars(400)), row("groceries", dollars(600))], dollars(800));
    expect(trimmed).toBe(true);
    expect(limits.reduce((s, l) => s + l.limit, 0)).toBeLessThanOrEqual(dollars(800));
    expect(limits).toEqual([
      { category: "groceries", limit: dollars(480) },
      { category: "dining", limit: dollars(320) },
    ]);
  });
});

describe("the month's plan", () => {
  it("adds up: money in less bills, saving and this month's budgets leaves what has no job yet", () => {
    const rows = [
      { category: "dining", limit: dollars(300), carried: dollars(50), spent: dollars(120) },
      { category: "shopping", limit: null, carried: 0, spent: dollars(80) },
    ] as Parameters<typeof budgetPlan>[0]["rows"];
    const plan = budgetPlan({ income: dollars(4000), bills: dollars(2000), saving: dollars(500), rows });
    // This month's limits only: what rollover carried came from earlier months' money.
    expect(plan.budgeted).toBe(dollars(300));
    expect(plan.carried).toBe(dollars(50));
    expect(plan.unplanned).toBe(dollars(4000 - 2000 - 500 - 300));
    expect(plan.budgetedSpent).toBe(dollars(120));
    expect(plan.unbudgetedSpent).toBe(dollars(80));
  });
});

describe("money expected this month", () => {
  const tx = (id: string, date: string, amount: number, category: string) => ({ id, date, name: id, amount, category, accountId: "a" });
  const base = { month: "2026-11", today: "2026-11-23", recurring: [], savingsPlanned: 0 };

  it("expects the usual income when no regular paycheck is recognised, not only what's arrived", () => {
    const plan = buildMonthPlan({ ...base, transactions: [tx("pay", "2026-11-10", 105_384, "income"), tx("food", "2026-11-12", -5_000, "groceries")], usualIncome: 210_000 });
    expect(plan.incomeReceived).toBe(105_384);
    expect(plan.incomeExpected).toBe(210_000);
    expect(plan.leftToSpend).toBe(210_000 - 5_000);
    // The days still add up to what's expected.
    expect(plan.days.reduce((s, d) => s + d.income, 0)).toBe(210_000);
  });

  it("never expects less than what's arrived, and a finished month is just what happened", () => {
    expect(buildMonthPlan({ ...base, transactions: [tx("pay", "2026-11-10", 300_000, "income")], usualIncome: 210_000 }).incomeExpected).toBe(300_000);
    expect(buildMonthPlan({ ...base, today: "2026-12-05", transactions: [tx("pay", "2026-11-10", 105_384, "income")], usualIncome: 210_000 }).incomeExpected).toBe(105_384);
  });
});
