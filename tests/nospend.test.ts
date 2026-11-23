import { describe, expect, it } from "vitest";
import { noSpendWeek, noSpendWeekOf } from "@/lib/finance/nospend";

/** The no-spend week: the month's last seven days, with nothing spent but bills. */
describe("the no-spend week", () => {
  it("is the last seven days of the month, whatever its length", () => {
    expect(noSpendWeekOf("2026-11")).toEqual({ start: "2026-11-24", end: "2026-11-30" });
    expect(noSpendWeekOf("2027-02")).toEqual({ start: "2027-02-22", end: "2027-02-28" });
    expect(noSpendWeekOf("2028-02")).toEqual({ start: "2028-02-23", end: "2028-02-29" });
    expect(noSpendWeekOf("2026-12")).toEqual({ start: "2026-12-25", end: "2026-12-31" });
  });

  it("shows up three days before, and not earlier", () => {
    expect(noSpendWeek("2026-11", "2026-11-20", [])).toBeNull();
    expect(noSpendWeek("2026-11", "2026-11-21", [])).toMatchObject({ phase: "soon", clear: 0 });
    expect(noSpendWeek("2026-11", "2026-11-21", [])!.days.every((d) => d.state === "ahead")).toBe(true);
  });

  it("marks each day: clear, spent, today, or still to come", () => {
    const days = [
      { date: "2026-11-24", everyday: 0 },
      { date: "2026-11-25", everyday: 1_250 }, // coffee
      { date: "2026-11-26", everyday: -500 }, // only a refund: still a clean day
      { date: "2026-11-27", everyday: 0 },
    ];
    const week = noSpendWeek("2026-11", "2026-11-27", days)!;
    expect(week.phase).toBe("on");
    expect(week.days.map((d) => d.state)).toEqual(["clear", "spent", "clear", "today", "ahead", "ahead", "ahead"]);
    expect(week.clear).toBe(2);
    // Spending today shows straight away.
    expect(noSpendWeek("2026-11", "2026-11-27", [...days.slice(0, 3), { date: "2026-11-27", everyday: 900 }])!.days[3].state).toBe("spent");
  });

  it("is done once the month is over: a clean week has all seven clear", () => {
    const week = noSpendWeek("2026-11", "2026-12-02", [{ date: "2026-11-20", everyday: 5_000 }])!;
    expect(week).toMatchObject({ phase: "done", clear: 7 });
  });
});
