import { describe, expect, it } from "vitest";
import { cleanMerchant, guessCategory, matchTaps, tapAmount } from "@/lib/finance/card-taps";

describe("what the iPhone sends when Apple Card is tapped", () => {
  it("reads the amount however Shortcuts writes it", () => {
    expect(tapAmount(12.34)).toBe(1234);
    expect(tapAmount("$12.34")).toBe(1234);
    expect(tapAmount("USD 1,204.10")).toBe(120410);
    expect(tapAmount(" 7 ")).toBe(700);
  });

  it("ignores taps with no real amount (iPhone sometimes sends $0), refunds and nonsense", () => {
    for (const bad of [0, "0.00", "", "  ", null, undefined, -5, "-5.00", "abc", Number.NaN, 1e12, {}, []]) expect(tapAmount(bad)).toBeNull();
  });

  it("tidies the merchant's name, with a fallback when there isn't one", () => {
    expect(cleanMerchant("  Blue   Bottle\nCoffee ")).toBe("Blue Bottle Coffee");
    expect(cleanMerchant("x".repeat(200))).toHaveLength(80);
    expect(cleanMerchant(" ")).toBe("Apple Card purchase");
    expect(cleanMerchant(42)).toBe("Apple Card purchase");
  });

  it("guesses a category from the name until the statement says", () => {
    expect(guessCategory("Blue Bottle Coffee")).toBe("dining");
    expect(guessCategory("Trader Joe's #123")).toBe("groceries");
    expect(guessCategory("Shell Oil 5524")).toBe("transport");
    expect(guessCategory("Walgreens")).toBe("health");
    expect(guessCategory("Mystery Shop")).toBe("other");
  });
});

describe("matching taps to the statement", () => {
  const span = { from: "2026-11-01", to: "2026-11-30" };
  const taps = [
    { id: "t1", date: "2026-11-03", amount: -650 },
    { id: "t2", date: "2026-11-03", amount: -650 },
    { id: "t3", date: "2026-11-10", amount: -2000 }, // a restaurant: the tip was added later
    { id: "t4", date: "2026-11-29", amount: -900 }, // too recent to know yet
  ];

  it("confirms each tap with the statement's line for the same amount within a few days, each used once", () => {
    const rows = [
      { date: "2026-11-03", amount: -650 },
      { date: "2026-11-04", amount: -650 },
      { date: "2026-11-10", amount: -2400 },
      { date: "2026-11-12", amount: 50000 },
    ];
    const { adopt } = matchTaps(rows, [true, true, true, true], taps, span);
    expect([...adopt.entries()]).toEqual([
      [0, "t1"],
      [1, "t2"],
    ]);
  });

  it("drops taps the statement never shows once it reaches well past them, and keeps recent ones", () => {
    const { stale } = matchTaps([{ date: "2026-11-10", amount: -2400 }], [true], taps, span);
    // t1/t2/t3 are covered and unmatched (declined, or the amount changed); t4 is too close to the end to tell.
    expect(stale).toEqual(["t1", "t2", "t3"]);
  });

  it("leaves lines already brought in alone, and never matches money coming in", () => {
    const { adopt } = matchTaps([{ date: "2026-11-03", amount: -650 }, { date: "2026-11-03", amount: 650 }], [false, true], taps, span);
    expect(adopt.size).toBe(0);
  });

  it("keeps a tap the file lists as not cleared yet: it's on its way", () => {
    const { stale } = matchTaps([{ date: "2026-11-13", amount: -100 }], [true], [{ id: "gas", date: "2026-11-10", amount: -4_500 }], { from: "2026-11-01", to: "2026-11-13" }, [{ date: "2026-11-10", amount: -4_500 }]);
    expect(stale).toEqual([]);
  });

  it("picks the closest tap when more than one could be it", () => {
    const { adopt } = matchTaps([{ date: "2026-11-05", amount: -650 }], [true], [{ id: "far", date: "2026-11-02", amount: -650 }, { id: "near", date: "2026-11-05", amount: -650 }], span);
    expect(adopt.get(0)).toBe("near");
  });
});
