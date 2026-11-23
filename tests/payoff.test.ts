import { describe, expect, it } from "vitest";
import { payoffOrder, payoffPlan, recentMonthlyPaydown, type Debt } from "@/lib/finance/payoff";
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
  it("averages the last three whole months of payments less new charges, counting a month with neither as $0", () => {
    const rows = [
      { date: "2026-07-20", amount: 99_999, category: "transfer" }, // too long ago
      { date: "2026-09-05", amount: 50_000, category: "transfer" },
      { date: "2026-09-25", amount: 10_000, category: "transfer" },
      { date: "2026-10-12", amount: 30_000, category: "transfer" },
      { date: "2026-11-02", amount: 80_000, category: "transfer" }, // this month: not over yet
      { date: "2026-10-03", amount: -5_000, category: "shopping" }, // a new charge
      { date: "2026-10-09", amount: 2_000, category: "shopping" }, // part of it refunded
      { date: "2026-10-28", amount: -4_000, category: "fees" }, // interest: the plan adds that itself
    ];
    // August $0, September $600, October $300 - $50 + $20 = $270 (November isn't over): (0 + 600 + 270) / 3.
    expect(recentMonthlyPaydown(rows, "2026-11")).toBe(29_000);
    expect(recentMonthlyPaydown(rows, "2026-11", 2)).toBe(43_500);
  });

  it("doesn't count paying back rent put on the card as paying it down", () => {
    const rows = [
      // Rent goes on the card each month and is paid back in pieces through the month.
      ...["2026-08", "2026-09", "2026-10"].flatMap((m) => [
        { date: `${m}-01`, amount: -200_000, category: "housing" },
        { date: `${m}-08`, amount: 80_000, category: "transfer" },
        { date: `${m}-15`, amount: 70_000, category: "transfer" },
        { date: `${m}-27`, amount: 50_000, category: "transfer" },
      ]),
    ];
    // $2,000 paid each month, all of it rent: the balance isn't going down.
    expect(recentMonthlyPaydown(rows, "2026-11")).toBeNull();
    // An extra $300 one month on top of paying the rent back: that's $100 a month toward it.
    expect(recentMonthlyPaydown([...rows, { date: "2026-10-30", amount: 30_000, category: "transfer" }], "2026-11")).toBe(10_000);
  });

  it("doesn't count a payment the bank sent back", () => {
    const rows = [
      // Returned as a "fee" for the same amount, then paid again for real.
      { date: "2026-09-15", amount: 374_106, category: "transfer" },
      { date: "2026-09-18", amount: -374_106, category: "fees" },
      { date: "2026-09-20", amount: 375_020, category: "transfer" },
      // An autopay returned as a negative transfer, plus the late fee: only the fee is a fee.
      { date: "2026-10-07", amount: 7_100, category: "transfer" },
      { date: "2026-10-11", amount: -7_100, category: "transfer" },
      { date: "2026-10-11", amount: -2_900, category: "fees" },
      // Bounced just after the month ended: October's payment never happened.
      { date: "2026-10-30", amount: 50_000, category: "transfer" },
      { date: "2026-11-02", amount: -50_000, category: "fees" },
      // Cash sent to someone with the card adds to what's owed.
      { date: "2026-10-12", amount: -15_020, category: "transfer" },
    ];
    // $3,750.20 - $150.20 = $3,600 over three months.
    expect(recentMonthlyPaydown(rows, "2026-11")).toBe(120_000);
  });

  it("is nothing when nothing was paid, or spending outpaced the payments", () => {
    expect(recentMonthlyPaydown([], "2026-11")).toBeNull();
    expect(recentMonthlyPaydown([{ date: "2026-11-02", amount: 1000, category: "transfer" }], "2026-11")).toBeNull();
    expect(recentMonthlyPaydown([{ date: "2026-10-02", amount: 10_000, category: "transfer" }, { date: "2026-10-05", amount: -30_000, category: "food" }], "2026-11")).toBeNull();
  });
});
