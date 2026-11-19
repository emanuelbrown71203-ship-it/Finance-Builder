import { describe, expect, it } from "vitest";
import { addDays, addMonths } from "@/lib/dates";
import { detectRecurring, monthlyEquivalent, upcomingBetween, type TxLike } from "@/lib/finance/recurring";

let n = 0;
const tx = (date: string, name: string, dollars: number, category = "entertainment"): TxLike => ({ id: `t${++n}`, date, name, amount: Math.round(dollars * 100), category, accountId: "a" });
const monthly = (name: string, firstDate: string, amounts: number[], category?: string) => amounts.map((a, i) => tx(addMonths(firstDate, i), name, a, category));

describe("detectRecurring", () => {
  const today = "2026-11-19";

  it("finds a monthly subscription and predicts the next charge", () => {
    const [s] = detectRecurring(monthly("Spotify", "2026-05-27", [-11.99, -11.99, -11.99, -11.99, -11.99, -11.99]), today);
    expect(s).toMatchObject({ name: "Spotify", frequency: "monthly", kind: "subscription", amount: -1199, lastDate: "2026-10-27", nextDate: "2026-11-27", active: true, fixedAmount: true });
    expect(s.priceChange).toBeNull();
  });

  it("flags a price increase", () => {
    const [s] = detectRecurring(monthly("Netflix", "2026-06-09", [-15.49, -15.49, -15.49, -15.49, -17.99, -17.99]), today);
    expect(s.priceChange).toEqual({ from: -1549, to: -1799 });
    expect(s.amount).toBe(-1799);
  });

  it("treats rent as a bill and a paycheck as income", () => {
    const rent = monthly("Parkview Apartments", "2026-06-01", [-2150, -2150, -2150, -2150, -2150, -2150], "housing");
    const pay = Array.from({ length: 8 }, (_, i) => tx(addDays("2026-08-07", i * 14), "Halden Studio Payroll", 2846.32, "income"));
    const series = detectRecurring([...rent, ...pay], today);
    expect(series.find((s) => s.name === "Parkview Apartments")?.kind).toBe("bill");
    const income = series.find((s) => s.kind === "income")!;
    expect(income.frequency).toBe("biweekly");
    expect(income.nextDate).toBe("2026-11-27");
    expect(monthlyEquivalent(income)).toBe(Math.round((284632 * 26) / 12));
  });

  it("allows variable amounts for utilities but estimates from recent bills", () => {
    const [s] = detectRecurring(monthly("City Light & Power", "2026-05-12", [-71.2, -84.1, -96.4, -88, -74.3, -69.9], "utilities"), today);
    expect(s.kind).toBe("bill");
    expect(s.fixedAmount).toBe(false);
    expect(s.amount).toBe(-7430);
  });

  it("ignores habits, one-offs and transfers", () => {
    const coffee = Array.from({ length: 12 }, (_, i) => tx(addDays("2026-08-03", i * 7), "Blue Bottle Coffee", -(5 + (i % 4)), "dining"));
    const transfers = monthly("Transfer to Savings", "2026-05-02", [-400, -400, -400, -400, -400, -400], "transfer");
    const once = [tx("2026-09-07", "Apple Store", -1299, "shopping")];
    expect(detectRecurring([...coffee, ...transfers, ...once], today)).toEqual([]);
  });

  it("marks a subscription that stopped charging as inactive", () => {
    const [s] = detectRecurring(monthly("Hulu", "2026-02-06", [-9.99, -9.99, -9.99, -9.99, -9.99]), today);
    expect(s.active).toBe(false);
    expect(upcomingBetween(s, today, "2026-12-31")).toEqual([]);
  });

  it("projects future dates inside a window", () => {
    const [s] = detectRecurring(monthly("Spotify", "2026-05-27", [-11.99, -11.99, -11.99, -11.99, -11.99, -11.99]), today);
    expect(upcomingBetween(s, today, "2027-01-31")).toEqual(["2026-11-27", "2026-12-27", "2027-01-27"]);
  });

  it("detects a yearly charge from two occurrences", () => {
    const [s] = detectRecurring([tx("2025-10-10", "Amazon Prime", -139, "shopping"), tx("2026-10-10", "Amazon Prime", -139, "shopping")], today);
    expect(s).toMatchObject({ frequency: "yearly", nextDate: "2027-10-10", active: true });
  });
});
