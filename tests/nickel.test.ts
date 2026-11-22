import { describe, expect, it } from "vitest";
import { cheerFor, pick, thinkAbout, type NickelInput, type TaskKind } from "@/lib/nickel/brain";

const quiet: NickelInput = {
  today: "2026-11-21",
  demo: false,
  linked: true,
  firstName: "Robin",
  leftToSpend: 50_000,
  perDay: 5_000,
  daysLeft: 10,
  paidToday: 0,
  attention: [],
  budget: [],
  goals: [],
  upcoming: [],
  noSpendStreak: 0,
  netWorthChange: 0,
  priciestDebt: null,
  latest: null,
  unclearNames: { count: 0, example: null },
};

describe("what Nickel notices", () => {
  it("asks for a bank when there's nothing to look at", () => {
    const { mood, tips } = thinkAbout({ ...quiet, linked: false });
    expect(mood).toBe("curious");
    expect(tips).toHaveLength(1);
    expect(tips[0]).toMatchObject({ priority: 1, href: "/accounts" });
  });

  it("gets excited on payday, and says what a behind goal would need from this paycheck", () => {
    const { mood, tips } = thinkAbout({
      ...quiet,
      paidToday: 284_632,
      goals: [{ id: "g1", name: "Japan", saved: 100_000, target: 450_000, status: "behind", gap: -20_000, perMonth: 30_000, perPayday: 14_000, targetDate: "2027-08-31" }],
    });
    expect(mood).toBe("excited");
    expect(tips[0].text).toContain("$2,846.32 just came in");
    expect(tips[0].text).toContain("Putting $140 toward “Japan”");
    expect(tips[0].href).toBe("/savings/goal?id=g1");
  });

  it("is worried when the month is over, and puts that first", () => {
    const { mood, tips } = thinkAbout({ ...quiet, leftToSpend: -12_000, netWorthChange: 500_000 });
    expect(mood).toBe("worried");
    expect(tips[0].text).toContain("$120");
    expect(tips[0].priority).toBe(1);
  });

  it("turns bills, price rises, renewals and new subscriptions into plain notes", () => {
    const { tips } = thinkAbout({
      ...quiet,
      attention: [
        { kind: "due", title: "Adobe Creative Cloud is due tomorrow", detail: "$22.99" },
        { kind: "price", title: "Netflix raised its price", detail: "$15.49 to $17.99, $30 more a year" },
        { kind: "new", title: "Disney+ looks like a new subscription", detail: "$13.99 on Nov 11" },
      ],
    });
    const texts = tips.map((t) => t.text).join(" | ");
    expect(texts).toContain("Adobe Creative Cloud is due tomorrow ($22.99)");
    expect(texts).toContain("Netflix raised its price: $15.49 to $17.99");
    expect(texts).toContain("New smell! Disney+");
  });

  it("notices budgets over or nearly at their limit, and goals ahead, behind or reached", () => {
    const { tips } = thinkAbout({
      ...quiet,
      budget: [
        { category: "dining", label: "Dining", spent: 32_000, limit: 28_000 },
        { category: "shopping", label: "Shopping", spent: 23_000, limit: 25_000 },
        { category: "travel", label: "Travel", spent: 1_000, limit: 30_000 },
      ],
      goals: [
        { id: "a", name: "Roof", saved: 500_000, target: 500_000, status: "reached", gap: null, perMonth: null, perPayday: null, targetDate: null },
        { id: "b", name: "Car", saved: 200_000, target: 900_000, status: "ahead", gap: 30_000, perMonth: 50_000, perPayday: null, targetDate: "2027-12-31" },
        { id: "c", name: "Trip", saved: 10_000, target: 300_000, status: "behind", gap: -40_000, perMonth: 35_000, perPayday: null, targetDate: "2027-06-30" },
      ],
    });
    const texts = tips.map((t) => t.text).join(" | ");
    expect(texts).toContain("Dining is $40 over its $280 limit");
    expect(texts).toContain("Shopping is at 92% of its limit");
    expect(texts).not.toContain("Travel");
    expect(texts).toMatch(/“Roof”/);
    expect(texts).toContain("“Car” is $300 ahead");
    expect(texts).toContain("“Trip” is $400 behind its track. About $350 a month");
  });

  it("cheers streaks, and says all clear when nothing needs a look", () => {
    const { mood, tips } = thinkAbout({ ...quiet, noSpendStreak: 3 });
    expect(mood).toBe("proud");
    expect(tips.map((t) => t.text).join(" ")).toMatch(/3 (no-spend days|days in a row)/);
    expect(tips.some((t) => t.text.includes("All clear") || t.text.includes("all clear"))).toBe(true);
  });

  it("offers to tidy bank-code names once there are a few, and links to the Names screen", () => {
    expect(thinkAbout({ ...quiet, unclearNames: { count: 2, example: "TST* LA TAQUERIA" } }).tips.some((t) => t.href === "/transactions/names")).toBe(false);
    const tip = thinkAbout({ ...quiet, unclearNames: { count: 4, example: "TST* LA TAQUERIA 0188" } }).tips.find((t) => t.href === "/transactions/names");
    expect(tip?.text).toContain("4");
    expect(tip?.text).toContain("TST* LA TAQUERIA 0188");
  });

  it("never tells anyone what they should do", () => {
    const { tips } = thinkAbout({
      ...quiet,
      leftToSpend: -5_000,
      paidToday: 100_000,
      attention: [{ kind: "renewal", title: "Dropbox renews in 18 days", detail: "$119.88, once a year. Cancel before then if you don’t want it." }],
      budget: [{ category: "dining", label: "Dining", spent: 40_000, limit: 28_000 }],
      priciestDebt: { name: "Cashback Visa", apr: 24.99 },
      latest: { name: "Tartine Bakery", amount: -1_660, date: "2026-11-21" },
      noSpendStreak: 2,
      netWorthChange: 100_000,
      unclearNames: { count: 5, example: "SQ *TARTINE BAKERY 0423" },
    });
    for (const t of tips) expect(t.text.toLowerCase()).not.toMatch(/\byou should\b|\byou must\b|\bi recommend\b|\binvest in\b/);
  });

  it("gives each tip an id that holds all day, and words things the same way all day", () => {
    const a = thinkAbout({ ...quiet, noSpendStreak: 2 });
    const b = thinkAbout({ ...quiet, noSpendStreak: 2 });
    expect(a.tips.map((t) => [t.id, t.text])).toEqual(b.tips.map((t) => [t.id, t.text]));
    expect(a.tips.every((t) => t.id.endsWith(":2026-11-21"))).toBe(true);
    expect(pick(["x", "y", "z"], "seed")).toBe(pick(["x", "y", "z"], "seed"));
  });
});

describe("cheering small money tasks", () => {
  const kinds: TaskKind[] = ["rename", "category", "note", "bill", "cancelled", "goal", "deposit", "milestone", "budget", "plan", "done"];

  it("has a cheer for every kind of task, with the details filled in", () => {
    for (const k of kinds) expect(cheerFor(k, { name: "Netflix", amount: 21_588, percent: 50 }, 1, "2026-11-22").text.length).toBeGreaterThan(5);
    expect(cheerFor("cancelled", { name: "Hulu", amount: 11_988 }, 1, "a").text).toMatch(/Hulu/);
    expect(cheerFor("milestone", { name: "Japan", percent: 50 }, 1, "a").text).toContain("50%");
  });

  it("throws a party for a cancelled subscription, a milestone, and every few chores in a day", () => {
    expect(cheerFor("rename", {}, 1, "a").party).toBe(false);
    expect(cheerFor("cancelled", { name: "Hulu" }, 1, "a").party).toBe(true);
    expect(cheerFor("milestone", { name: "Japan", percent: 75 }, 2, "a").party).toBe(true);
    expect(cheerFor("category", {}, 3, "a")).toEqual({ text: "That’s 3 money chores today! *crunches a celebration bone*", party: true });
    expect(cheerFor("category", {}, 4, "a").party).toBe(false);
  });

  it("never tells anyone what they should do", () => {
    for (const k of kinds) {
      for (const seed of ["a", "b", "c", "d"]) {
        expect(cheerFor(k, { name: "X", amount: 100, percent: 25 }, 1, seed).text.toLowerCase()).not.toMatch(/\byou should\b|\byou must\b|\bi recommend\b|\binvest in\b/);
      }
    }
  });
});

