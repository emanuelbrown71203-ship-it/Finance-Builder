import { describe, expect, it } from "vitest";
import { payoffOrder, payoffPlan, recentMonthlyPayment, type Debt } from "@/lib/finance/payoff";
import { cancelHelp, isKnownSubscription } from "@/lib/finance/subscriptions";

const debt = (id: string, dollars: number, aprPercent: number, payment: number): Debt => ({ id, name: id, balance: dollars * 100, aprPercent, payment: payment * 100 });

describe("payoffPlan", () => {
  it("with no interest, it is just the balance divided by the payment", () => {
    const plan = payoffPlan([debt("loan", 1000, 0, 250)], 0, "avalanche", "2026-11");
    expect(plan).toMatchObject({ months: 4, debtFreeMonth: "2027-03", totalInterest: 0, stuck: [] });
    expect(plan.balances).toEqual([100000, 75000, 50000, 25000, 0]);
  });

  it("adds a month of interest before each payment", () => {
    // $10,000 at 12% a year with $500 a month: 23 payments and a little under $1,200 of interest.
    const plan = payoffPlan([debt("loan", 10000, 12, 500)], 0, "avalanche", "2026-11");
    expect(plan.months).toBe(23);
    expect(plan.totalInterest).toBeGreaterThan(115000);
    expect(plan.totalInterest).toBeLessThan(125000);
    // Everything paid equals what was owed plus the interest.
    expect(plan.balances.at(-1)).toBe(0);
  });

  it("extra money shortens the plan and saves interest", () => {
    const debts = [debt("car", 14500, 5.9, 318), debt("student", 20000, 4.5, 240)];
    const base = payoffPlan(debts, 0, "avalanche", "2026-11");
    const faster = payoffPlan(debts, 20000, "avalanche", "2026-11");
    expect(faster.months!).toBeLessThan(base.months!);
    expect(faster.totalInterest).toBeLessThan(base.totalInterest);
  });

  it("a cleared debt's payment rolls on to the next one", () => {
    // Alone, the big loan would take 40 months at $250. After two months the small one is gone
    // and its $500 joins in: $9,500 left at $750 a month is 13 more months.
    const plan = payoffPlan([debt("small", 1000, 0, 500), debt("big", 10000, 0, 250)], 0, "snowball", "2026-11");
    expect(plan.perDebt.find((d) => d.id === "small")?.months).toBe(2);
    expect(plan.months).toBe(15);
  });

  it("avalanche aims at the highest rate, snowball at the smallest balance", () => {
    const debts = [debt("card", 6000, 24, 150), debt("store", 800, 10, 40)];
    expect(payoffOrder(debts, "avalanche").map((d) => d.id)).toEqual(["card", "store"]);
    expect(payoffOrder(debts, "snowball").map((d) => d.id)).toEqual(["store", "card"]);
    const avalanche = payoffPlan(debts, 10000, "avalanche", "2026-11");
    const snowball = payoffPlan(debts, 10000, "snowball", "2026-11");
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
    expect(snowball.perDebt.find((d) => d.id === "store")!.months!).toBeLessThan(avalanche.perDebt.find((d) => d.id === "store")!.months!);
  });

  it("says so when a payment doesn't even cover the interest", () => {
    const plan = payoffPlan([debt("card", 10000, 30, 100)], 0, "avalanche", "2026-11");
    expect(plan).toMatchObject({ months: null, debtFreeMonth: null, stuck: ["card"] });
    // Enough extra fixes it.
    expect(payoffPlan([debt("card", 10000, 30, 100)], 40000, "avalanche", "2026-11").months).not.toBeNull();
  });

  it("ignores debts already at zero", () => {
    expect(payoffPlan([debt("done", 0, 5, 100)], 0, "avalanche", "2026-11")).toMatchObject({ months: 0, totalInterest: 0 });
  });
});

describe("subscription help", () => {
  it("points well-known services at their own account page", () => {
    expect(cancelHelp("Netflix").url).toBe("https://www.netflix.com/cancelplan");
    expect(cancelHelp("SPOTIFY USA 8884").label).toBe("Open Spotify");
    expect(cancelHelp("Apple iCloud+").how).toContain("Subscriptions");
  });
  it("gyms get honest advice instead of a link", () => {
    const gym = cancelHelp("Anytime Fitness");
    expect(gym.url).toBeUndefined();
    expect(gym.how).toContain("in person");
  });
  it("anything else gets a search link, safely encoded", () => {
    const help = cancelHelp("Bob's Sauce & Co");
    expect(help.url).toBe("https://www.google.com/search?q=how%20to%20cancel%20Bob's%20Sauce%20%26%20Co");
  });
  it("knows which merchants are subscriptions after one charge", () => {
    expect(isKnownSubscription("Disney+")).toBe(true);
    expect(isKnownSubscription("Trader Joe’s")).toBe(false);
    expect(isKnownSubscription("Anytime Fitness")).toBe(false);
  });
});

describe("what's actually been paid toward a card lately", () => {
  it("averages the last three whole months, counting a month with no payment as $0, whatever the amounts", () => {
    const payments = [
      { date: "2026-07-20", amount: 99_999 }, // too long ago
      { date: "2026-09-05", amount: 50_000 },
      { date: "2026-09-25", amount: 10_000 },
      { date: "2026-10-12", amount: 30_000 },
      { date: "2026-11-02", amount: 80_000 }, // this month: not over yet
      { date: "2026-10-03", amount: -5_000 }, // a charge, not a payment
    ];
    // August $0, September $600, October $300 (November isnt over): (0 + 600 + 300) / 3.
    expect(recentMonthlyPayment(payments, "2026-11")).toBe(30_000);
    expect(recentMonthlyPayment(payments, "2026-11", 2)).toBe(45_000);
  });

  it("is nothing when nothing was paid", () => {
    expect(recentMonthlyPayment([], "2026-11")).toBeNull();
    expect(recentMonthlyPayment([{ date: "2026-11-02", amount: 1000 }], "2026-11")).toBeNull();
  });
});
