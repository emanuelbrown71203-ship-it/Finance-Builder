import { describe, expect, it } from "vitest";
import { goalIdeas, goalPlan, monthlyFor, quickDates, type GoalPlanInput } from "@/lib/finance/goalplan";

const base: GoalPlanInput = {
  target: 300_000, // $3,000
  saved: 0,
  targetDate: "2027-06-30",
  today: "2026-12-31",
  startDate: "2026-06-30",
  deposits: [],
  monthlyContribution: 0,
  paydays: [],
};

describe("the track to a goal", () => {
  it("works out what to put away a month, a week and a payday to hit the date", () => {
    const plan = goalPlan({ ...base, saved: 150_000, deposits: [{ date: "2026-09-01", amount: 150_000 }], paydays: ["2027-01-09", "2027-01-23", "2027-02-06", "2027-07-15"] });
    expect(plan.remaining).toBe(150_000);
    expect(plan.daysLeft).toBe(181);
    // $1,500 over exactly six calendar months; about 25.9 weeks, rounded up to whole dollars.
    expect(plan.perMonth).toBe(25_000);
    expect(plan.perWeek).toBe(5_900);
    // Only paydays before the target date count; the one in July is too late.
    expect(plan.paydaysLeft).toBe(3);
    expect(plan.perPayday).toBe(50_000);
    expect(plan.nextPayday).toBe("2027-01-09");
  });

  it("says on track, ahead or behind against a straight line from the start to the target", () => {
    // 184 of 365 days in, the line says $1,512.33.
    expect(goalPlan({ ...base, saved: 150_000, deposits: [{ date: "2026-09-01", amount: 150_000 }] })).toMatchObject({ status: "on_track", expectedNow: 151_233 });
    const ahead = goalPlan({ ...base, saved: 200_000, deposits: [{ date: "2026-09-01", amount: 200_000 }] });
    expect(ahead.status).toBe("ahead");
    expect(ahead.gap).toBeGreaterThan(40_000);
    const behind = goalPlan({ ...base, saved: 60_000, deposits: [{ date: "2026-09-01", amount: 60_000 }] });
    expect(behind.status).toBe("behind");
    expect(behind.gap).toBeLessThan(-80_000);
  });

  it("doesn't call a checkpoint missed for being a few dollars short", () => {
    // By the end of July the line wants about $255; $250 is within the leeway, $200 isn't.
    const near = goalPlan({ ...base, saved: 25_000, deposits: [{ date: "2026-07-15", amount: 25_000 }] });
    expect(near.checkpoints[0]).toMatchObject({ date: "2026-07-31", met: true });
    const short = goalPlan({ ...base, saved: 15_000, deposits: [{ date: "2026-07-15", amount: 15_000 }] });
    expect(short.checkpoints[0].met).toBe(false);
  });

  it("always lists goal day, even for goals more than ten years away", () => {
    const plan = goalPlan({ ...base, targetDate: "2040-06-30" });
    expect(plan.checkpoints.at(-1)).toMatchObject({ date: "2040-06-30", amount: 300_000 });
  });

  it("knows when a goal is reached, has no date, or its date has passed", () => {
    expect(goalPlan({ ...base, saved: 300_000 }).status).toBe("reached");
    expect(goalPlan({ ...base, saved: 300_000 }).perMonth).toBeNull();
    const noDate = goalPlan({ ...base, targetDate: null, saved: 50_000 });
    expect(noDate).toMatchObject({ status: "no_date", perMonth: null, checkpoints: [] });
    const late = goalPlan({ ...base, today: "2027-07-10", saved: 100_000 });
    expect(late).toMatchObject({ status: "overdue", perMonth: null });
  });

  it("asks for the whole amount when the date is only days away", () => {
    const plan = goalPlan({ ...base, today: "2027-06-27", saved: 290_000 });
    expect(plan.perMonth).toBe(10_000);
    expect(plan.perWeek).toBe(10_000);
  });

  it("starts the line at what was already saved when the goal was made", () => {
    const plan = goalPlan({ ...base, saved: 130_000, deposits: [{ date: "2026-08-01", amount: 30_000 }] });
    expect(plan.startSaved).toBe(100_000);
    expect(plan.history).toEqual([
      { date: "2026-06-30", amount: 100_000 },
      { date: "2026-08-01", amount: 130_000 },
    ]);
  });

  it("puts a checkpoint at each month end, marks the past ones met or missed, and ends on the target", () => {
    const plan = goalPlan({ ...base, saved: 100_000, deposits: [{ date: "2026-07-15", amount: 50_000 }, { date: "2026-10-15", amount: 50_000 }] });
    expect(plan.checkpoints).toHaveLength(12);
    expect(plan.checkpoints[0]).toMatchObject({ date: "2026-07-31", met: true });
    // By the end of November the line wanted about $2,500 and only $1,000 was in.
    expect(plan.checkpoints.find((c) => c.date === "2026-11-30")).toMatchObject({ met: false });
    expect(plan.checkpoints.at(-1)).toEqual({ date: "2027-06-30", amount: 300_000, met: null });
  });

  it("dates each milestone: when it was reached, or when it will be at the current pace", () => {
    const plan = goalPlan({
      ...base,
      saved: 120_000,
      deposits: [
        { date: "2026-10-05", amount: 40_000 },
        { date: "2026-11-05", amount: 40_000 },
        { date: "2026-12-05", amount: 40_000 },
      ],
    });
    expect(plan.milestones[0]).toMatchObject({ percent: 25, reachedOn: "2026-11-05" });
    expect(plan.milestones[1].reachedOn).toBeNull();
    expect(plan.milestones[1].projected).not.toBeNull();
    // $1,200 in over the last 90 days is about $400 a month.
    expect(plan.pace).toBeGreaterThan(39_000);
    expect(plan.pace).toBeLessThan(41_000);
    // $1,800 to go at about $406 a month: mid-May.
    expect(plan.projectedDate! >= "2027-05-01" && plan.projectedDate! <= "2027-05-31").toBe(true);
  });

  it("uses the monthly amount you set until there's real history to go on", () => {
    const plan = goalPlan({ ...base, saved: 0, monthlyContribution: 50_000 });
    expect(plan.pace).toBe(50_000);
    expect(plan.projectedDate).not.toBeNull();
    expect(goalPlan({ ...base, saved: 0 }).projectedDate).toBeNull();
  });

  it("counts money taken back out of a goal", () => {
    const plan = goalPlan({ ...base, saved: 50_000, deposits: [{ date: "2026-08-01", amount: 80_000 }, { date: "2026-12-01", amount: -30_000 }] });
    expect(plan.history.at(-1)).toEqual({ date: "2026-12-01", amount: 50_000 });
  });
});

describe("making a goal", () => {
  it("offers quick dates and previews the monthly amount", () => {
    expect(quickDates("2026-11-21").map((q) => q.date)).toEqual(["2027-02-21", "2027-05-21", "2027-11-21", "2028-11-21"]);
    expect(monthlyFor(120_000, 0, "2026-11-21", "2027-11-21")).toBe(10_000);
    expect(monthlyFor(120_000, 0, "2026-11-21", "2027-05-21")).toBe(20_000);
    expect(monthlyFor(120_000, 130_000, "2026-11-21", "2027-11-21")).toBeNull();
    expect(monthlyFor(120_000, 0, "2026-11-21", "2026-11-01")).toBeNull();
  });
});

describe("where the money could come from", () => {
  it("points at categories running well above usual, and at room left in the month", () => {
    const ideas = goalIdeas({
      need: 25_000,
      monthProgress: 0.5,
      leftToSpend: 60_000,
      categories: [
        { category: "dining", label: "Dining", spent: 30_000, average: 40_000 }, // on course for $600 vs usual $400
        { category: "groceries", label: "Groceries", spent: 30_000, average: 60_000 }, // exactly usual
        { category: "fees", label: "Fees", spent: 1_000, average: 500 }, // too small to mention
        // Rent is paid on the 1st, so mid-month it always looks like double. Fixed bills are never suggested.
        { category: "housing", label: "Home & rent", spent: 215_000, average: 215_000 },
      ],
    });
    expect(ideas.map((i) => i.title)).toEqual(["Dining is running above usual", "There’s room this month"]);
    expect(ideas[0].href).toBe("/transactions?category=dining");
  });

  it("stays quiet when there's nothing to say or nothing needed", () => {
    expect(goalIdeas({ need: null, monthProgress: 0.5, leftToSpend: 100_000, categories: [] })).toEqual([]);
    expect(goalIdeas({ need: 25_000, monthProgress: 0.05, leftToSpend: 0, categories: [{ category: "dining", label: "Dining", spent: 30_000, average: 10_000 }] })).toEqual([]);
  });
});
