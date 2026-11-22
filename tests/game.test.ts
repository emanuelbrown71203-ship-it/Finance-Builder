import { describe, expect, it } from "vitest";
import { badgesFor, bestStreak, levelFor, streak, xpForLevel } from "@/lib/game/progress";

describe("levels", () => {
  it("each level takes 100 XP more than the last", () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000]);
    expect(levelFor(0)).toEqual({ level: 1, into: 0, needed: 100 });
    expect(levelFor(99)).toEqual({ level: 1, into: 99, needed: 100 });
    expect(levelFor(100)).toEqual({ level: 2, into: 0, needed: 200 });
    expect(levelFor(640)).toEqual({ level: 4, into: 40, needed: 400 });
  });
});

describe("streaks", () => {
  it("counts days in a row ending today or yesterday", () => {
    expect(streak(["2026-11-20", "2026-11-21", "2026-11-22"], "2026-11-22")).toBe(3);
    expect(streak(["2026-11-20", "2026-11-21"], "2026-11-22")).toBe(2);
    expect(streak(["2026-11-19"], "2026-11-22")).toBe(0);
    expect(bestStreak(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-10", "2026-11-11"])).toBe(3);
  });
});

describe("badges", () => {
  it("are earned from wins, streaks and levels", () => {
    const none = badgesFor({}, [], 1);
    expect(none.every((b) => !b.earned)).toBe(true);
    const some = badgesFor({ sort: 25, cancel: 1, goal: 1 }, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"], 5);
    const earned = some.filter((b) => b.earned).map((b) => b.id);
    expect(earned).toEqual(["first-win", "sorter", "slayer", "goal-getter", "streak-7", "level-5"]);
  });
});
