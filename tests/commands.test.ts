import { describe, expect, it } from "vitest";
import { parseCommand, type CommandContext } from "@/lib/nickel/commands";

const ctx: CommandContext = { today: "2026-11-21", goals: ["Emergency fund", "Down payment", "Two weeks in Japan"], loans: ["Auto Loan", "Student Loan", "Cashback Visa"] };
const parse = (s: string) => parseCommand(s, ctx);

describe("telling Nickel to add a bill", () => {
  it.each([
    ["add Netflix $15.99 on the 5th", { kind: "bill", name: "Netflix", amount: 1599, frequency: "monthly", date: "2026-12-05" }],
    ["Add a bill for rent 2,150 every month on the 1st", { kind: "bill", name: "Rent", amount: 215_000, frequency: "monthly", date: "2026-12-01" }],
    ["add gym membership $38 monthly", { kind: "bill", name: "Gym Membership", amount: 3800, frequency: "monthly", date: null }],
    ["add car insurance $640 every 6 months", { kind: "bill", name: "Car Insurance", amount: 64_000, frequency: "semiannual" }],
    ["new subscription iCloud 2.99 a month starting Dec 14", { kind: "bill", name: "iCloud", amount: 299, frequency: "monthly", date: "2026-12-14" }],
    ["add water bill $60 every 2 weeks on friday", { kind: "bill", name: "Water", amount: 6000, frequency: "biweekly", date: "2026-11-27" }],
    ["add Amazon Prime $139 yearly on March 3", { kind: "bill", name: "Amazon Prime", amount: 13_900, frequency: "yearly", date: "2027-03-03" }],
    ["add a bill on the 25th", { kind: "bill", name: null, amount: null, frequency: "monthly", date: "2026-11-25" }],
  ])("%s", (text, expected) => {
    expect(parse(text)).toMatchObject(expected);
  });

  it("knows a one-off from a repeating bill", () => {
    expect(parse("upcoming bill car registration $180 on Dec 12")).toEqual({ kind: "upcoming", name: "Car Registration", amount: 18_000, date: "2026-12-12" });
    expect(parse("I have a $250 vet bill due next friday")).toEqual({ kind: "upcoming", name: "Vet", amount: 25_000, date: "2026-11-27" });
    expect(parse("one-time payment of $95 to the DMV on 12/3")).toEqual({ kind: "upcoming", name: "DMV", amount: 9500, date: "2026-12-03" });
    // A date earlier in the year means next year.
    expect(parse("upcoming taxes $1,200 due April 15")).toMatchObject({ date: "2027-04-15", amount: 120_000 });
  });
});

describe("telling Nickel about goals", () => {
  it("makes a goal with a target and a date", () => {
    expect(parse("new goal New roof $12,000 by June 2028")).toEqual({ kind: "goal", name: "New roof", target: 1_200_000, date: "2028-06-30" });
    expect(parse("save $3000 for a vacation by next year")).toEqual({ kind: "goal", name: "Vacation", target: 300_000, date: "2027-12-31" });
    expect(parse("start saving for a car $8k in 18 months")).toEqual({ kind: "goal", name: "Car", target: 800_000, date: "2028-05-21" });
    // "a new car": "new" is part of the name, not an instruction.
    expect(parse("save for a new car $20,000 by 2029")).toEqual({ kind: "goal", name: "New Car", target: 2_000_000, date: "2029-12-31" });
    expect(parse("goal: wedding")).toEqual({ kind: "goal", name: "Wedding", target: null, date: null });
    // "by June" this late in the year is next June.
    expect(parse("new goal Camping gear $600 by June")).toMatchObject({ date: "2027-06-30" });
  });

  it("puts money into the goal it names", () => {
    expect(parse("add $200 to the emergency fund")).toEqual({ kind: "deposit", goal: "Emergency fund", amount: 20_000 });
    expect(parse("put 150 toward Japan")).toEqual({ kind: "deposit", goal: "Two weeks in Japan", amount: 15_000 });
    expect(parse("I saved $75.50 for the down payment")).toEqual({ kind: "deposit", goal: "Down payment", amount: 7550 });
  });
});

describe("telling Nickel about loans", () => {
  it("changes a loan's rate or monthly payment", () => {
    expect(parse("my student loan rate is 4.5%")).toEqual({ kind: "loan", loan: "Student Loan", aprPercent: 4.5, payment: null });
    expect(parse("set the auto loan payment to $350")).toEqual({ kind: "loan", loan: "Auto Loan", aprPercent: null, payment: 35_000 });
    expect(parse("I pay $400 a month on my student loan at 5.25 percent")).toEqual({ kind: "loan", loan: "Student Loan", aprPercent: 5.25, payment: 40_000 });
    expect(parse("loan interest 6%")).toEqual({ kind: "loan", loan: null, aprPercent: 6, payment: null });
  });
});

describe("telling Nickel to rename", () => {
  it("takes the old and new names", () => {
    expect(parse("rename SQ *TARTINE to Tartine")).toEqual({ kind: "rename", from: "SQ *TARTINE", to: "Tartine", onlyAmount: null });
    expect(parse("rename Clipper Service as Muni")).toEqual({ kind: "rename", from: "Clipper Service", to: "Muni", onlyAmount: null });
    expect(parse("rename patreon")).toEqual({ kind: "rename", from: "patreon", to: null, onlyAmount: null });
    expect(parse("rename Venmo to Rent only at $1,200")).toEqual({ kind: "rename", from: "Venmo", to: "Rent", onlyAmount: 120_000 });
  });
});

describe("instructions that are easy to misread", () => {
  it("never sends a bill or a loan payment into a savings goal", () => {
    const withGoals = (s: string, goals: string[]) => parseCommand(s, { ...ctx, goals: [...ctx.goals, ...goals] });
    expect(parse("add student loan payment $300 on the 15th")).toEqual({ kind: "bill", name: "Student Loan", amount: 30_000, frequency: "monthly", date: "2026-12-15" });
    expect(withGoals("add car insurance $600 every 6 months", ["Car"])).toMatchObject({ kind: "bill", name: "Car Insurance", amount: 60_000, frequency: "semiannual" });
    expect(parse("add emergency vet bill $400 due friday")).toEqual({ kind: "upcoming", name: "Emergency Vet", amount: 40_000, date: "2026-11-27" });
    expect(withGoals("add house insurance $1,200 yearly", ["House"])).toMatchObject({ kind: "bill", name: "House Insurance", amount: 120_000, frequency: "yearly" });
    // Money aimed at the goal still goes there.
    expect(withGoals("put $500 into the house fund", ["House fund"])).toEqual({ kind: "deposit", goal: "House fund", amount: 50_000 });
  });

  it("reads the date before the amount, so a year or a day is never the amount", () => {
    expect(parse("new goal Japan trip by June 2027 $4,500")).toEqual({ kind: "goal", name: "Japan trip", target: 450_000, date: "2027-06-30" });
    expect(parse("car registration due December 15 $120")).toEqual({ kind: "upcoming", name: "Car Registration", amount: 12_000, date: "2026-12-15" });
    expect(parse("add phone 80 on the 3rd")).toMatchObject({ kind: "bill", amount: 8000, date: "2026-12-03" });
  });

  it("keeps the 31st as the 31st", () => {
    // November has no 31st, so the first one is December's.
    expect(parse("add phone bill $80 on the 31st")).toMatchObject({ date: "2026-12-31" });
  });
});

describe("what Nickel doesn't take as an instruction", () => {
  it("leaves chit-chat and questions alone", () => {
    for (const s of ["", "hi nickel", "how am I doing this month?", "good boy", "what's left to spend"]) expect(parse(s), s).toBeNull();
  });
});
