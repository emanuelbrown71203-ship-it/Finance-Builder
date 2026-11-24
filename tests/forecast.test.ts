import { describe, expect, it } from "vitest";
import { monthAhead, spendingShape } from "@/lib/finance/forecast";
import { buildMonthPlan } from "@/lib/finance/plan";

/** The month ahead: split at each payday, with spending forecast from the usual pattern. */
describe("the month ahead", () => {
  const tx = (id: string, date: string, amount: number, category: string) => ({ id, date, name: id, amount, category, accountId: "a" });

  it("learns when in the month the spending usually lands", () => {
    // Most of it early: $600 in the first third, $300 in the middle, $100 at the end.
    const shape = spendingShape([
      { date: "2026-10-02", everyday: 40_000 },
      { date: "2026-10-08", everyday: 20_000 },
      { date: "2026-10-15", everyday: 30_000 },
      { date: "2026-10-28", everyday: 10_000 },
    ]);
    expect(shape.map((s) => Math.round(s * 100))).toEqual([60, 30, 10]);
    expect(spendingShape([])).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("splits the month at each payday and forecasts what's still to come, nothing in the no-spend week", () => {
    const plan = buildMonthPlan({
      month: "2026-11",
      today: "2026-11-15",
      transactions: [tx("pay1", "2026-11-10", 100_000, "income"), tx("food", "2026-11-03", -20_000, "groceries"), tx("coffee", "2026-11-12", -1_000, "dining")],
      recurring: [],
      savingsPlanned: 0,
    });
    const noSpend = new Set(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"]);
    const ahead = monthAhead({
      plan,
      paychecks: [
        { date: "2026-11-10", amount: 100_000, received: true },
        { date: "2026-11-24", amount: 98_000, received: false },
      ],
      usualEveryday: 90_000,
      shape: [0.5, 0.3, 0.2],
      noSpendDays: noSpend,
    });
    expect(ahead.periods.map((p) => [p.start, p.end])).toEqual([
      ["2026-11-01", "2026-11-09"],
      ["2026-11-10", "2026-11-23"],
      ["2026-11-24", "2026-11-30"],
    ]);
    // Before payday: all spent already, no forecast.
    expect(ahead.periods[0]).toMatchObject({ paycheck: null, everyday: 20_000, forecast: 0 });
    // Nov 16–20 at the middle third's pace ($270 over 10 days), Nov 21–23 at the last third's ($180 over 10 days).
    expect(ahead.periods[1].forecast).toBe(5 * 2_700 + 3 * 1_800);
    expect(ahead.periods[1].paycheck).toMatchObject({ amount: 100_000, expected: false });
    // The no-spend week: nothing planned.
    expect(ahead.periods[2]).toMatchObject({ noSpend: true, forecast: 0 });
    expect(ahead.forecast).toBe(5 * 2_700 + 3 * 1_800);
    expect(ahead.forecastLeft).toBe(plan.leftToSpend - ahead.forecast);
  });
});
