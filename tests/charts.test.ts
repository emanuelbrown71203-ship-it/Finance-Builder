import { describe, expect, it } from "vitest";
import { niceTicks } from "@/components/charts";
import { PULL_THRESHOLD, pullDistance } from "@/components/pull-to-refresh";

describe("niceTicks", () => {
  it("always gives at least three round reference lines", () => {
    expect(niceTicks(8_934_118, 11_962_469)).toEqual([9_000_000, 10_000_000, 11_000_000]);
    expect(niceTicks(0, 180_000)).toEqual([0, 50_000, 100_000, 150_000]);
    expect(niceTicks(0, 91_200)).toEqual([0, 25_000, 50_000, 75_000]);
    expect(niceTicks(0, 650_000)).toEqual([0, 250_000, 500_000]);
    expect(niceTicks(-40_000, 190_000)).toContain(0);
  });
  it("copes with a flat series", () => {
    expect(niceTicks(500, 500)).toEqual([500]);
  });
});

describe("pull to refresh", () => {
  it("the pill lags behind the finger, never goes negative, and stops", () => {
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(60)).toBe(30);
    expect(pullDistance(1000)).toBe(110);
  });
  it("takes a deliberate pull to refresh", () => {
    // A finger has to travel about 128px before letting go refreshes.
    expect(pullDistance(100)).toBeLessThan(PULL_THRESHOLD);
    expect(pullDistance(130)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
  });
});
