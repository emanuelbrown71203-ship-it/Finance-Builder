import { describe, expect, it } from "vitest";
import { overdueSaving, savingHabit, savingTodos, savingTotals, sharePercent, type SavingGoal } from "@/lib/finance/savings";

const emergency: SavingGoal = { id: "e", name: "Emergency Savings", monthlyContribution: 0, paycheckShare: 0.05, reached: false, account: { id: "vault", name: "Emergency Fund" } };
const trip: SavingGoal = { id: "t", name: "DreamCon", monthlyContribution: 29_500, paycheckShare: null, reached: false, account: null };
const paychecks = [
  { date: "2026-11-10", amount: 105_384, received: true },
  { date: "2026-11-25", amount: 106_835, received: true },
];

describe("savings to-dos, each paycheck", () => {
  it("saves a share of each paycheck, or a set amount split across the month's paychecks", () => {
    const todos = savingTodos({ month: "2026-11", today: "2026-11-25", goals: [emergency, trip], paychecks, marks: [] });
    expect(todos.map((t) => [t.goalName, t.date, t.amount, t.status])).toEqual([
      ["DreamCon", "2026-11-10", 14_750, "todo"],
      ["Emergency Savings", "2026-11-10", 5_269, "todo"],
      ["DreamCon", "2026-11-25", 14_750, "todo"],
      ["Emergency Savings", "2026-11-25", 5_342, "todo"],
    ]);
    expect(todos.find((t) => t.goalName === "Emergency Savings")).toMatchObject({ paycheck: 105_384, share: 0.05 });
    // An odd amount: the cent left over goes with the first paycheck.
    const odd = savingTodos({ month: "2026-11", today: "2026-11-25", goals: [{ ...trip, monthlyContribution: 10_001 }], paychecks, marks: [] });
    expect(odd.map((t) => t.amount)).toEqual([5_001, 5_000]);
  });

  it("ticks itself off as money goes toward the goal, earliest first, and says what's still coming", () => {
    const putIn = [
      { goalId: "e", date: "2026-11-10", amount: 5_269 },
      { goalId: "e", date: "2026-11-25", amount: 5_342 },
      { goalId: "t", date: "2026-11-12", amount: 10_000 },
      // Last month's money doesn't count for this month.
      { goalId: "t", date: "2026-10-30", amount: 50_000 },
    ];
    const coming = [{ date: "2026-11-24", amount: 100_000, received: false }, ...paychecks.slice(0, 1)];
    const todos = savingTodos({ month: "2026-11", today: "2026-11-20", goals: [emergency, trip], paychecks: coming, marks: [], putIn });
    const by = (g: string, d: string) => todos.find((t) => t.goalId === g && t.date === d)!;
    expect(by("e", "2026-11-10").status).toBe("done");
    expect(by("t", "2026-11-10")).toMatchObject({ status: "partly", saved: 10_000 });
    expect(by("t", "2026-11-24")).toMatchObject({ status: "coming", saved: 0 });
    expect(savingTotals(todos)).toEqual({ planned: 5_269 + 5_000 + 14_750 + 14_750, saved: 5_269 + 5_000 + 10_000, toDo: 4_750, coming: 14_750 });
  });

  it("keeps the person's own choices: save less this time, or skip one", () => {
    const marks = [
      { goalId: "t", date: "2026-11-10", amount: 5_000 },
      { goalId: "t", date: "2026-11-25", amount: 0 },
    ];
    const todos = savingTodos({ month: "2026-11", today: "2026-11-25", goals: [trip], paychecks, marks, putIn: [{ goalId: "t", date: "2026-11-11", amount: 5_000 }] });
    expect(todos.map((t) => [t.amount, t.planned, t.changed, t.status])).toEqual([
      [5_000, 14_750, true, "done"],
      [0, 14_750, true, "skipped"],
    ]);
  });

  it("with no paycheck to go by, a set amount is one to-do on the 1st; reached goals ask for nothing", () => {
    const todos = savingTodos({ month: "2026-12", today: "2026-12-02", goals: [trip, { ...emergency, reached: true }], paychecks: [], marks: [] });
    expect(todos).toMatchObject([{ goalId: "t", date: "2026-12-01", amount: 29_500, status: "todo" }]);
  });

  it("reminds only from the day after the paycheck, when an automatic transfer has had time to show", () => {
    const [todo] = savingTodos({ month: "2026-11", today: "2026-11-25", goals: [trip], paychecks: paychecks.slice(1), marks: [] });
    expect(overdueSaving(todo, "2026-11-25")).toBe(false);
    expect(overdueSaving(todo, "2026-11-26")).toBe(true);
  });
});

describe("spotting a saving habit already in place", () => {
  const pays = [
    { date: "2026-10-28", amount: 98_763 },
    { date: "2026-11-10", amount: 105_384 },
    { date: "2026-11-25", amount: 106_835 },
  ];
  const inflows = [
    { accountId: "vault", accountName: "Emergency Fund", date: "2026-10-28", amount: 4_938 },
    { accountId: "vault", accountName: "Emergency Fund", date: "2026-11-10", amount: 5_269 },
    { accountId: "vault", accountName: "Emergency Fund", date: "2026-11-25", amount: 5_342 },
    { accountId: "sav", accountName: "SoFi Savings", date: "2026-11-12", amount: 4_835 },
  ];

  it("finds 5% of every paycheck going into the vault on payday", () => {
    expect(savingHabit(pays, inflows)).toEqual({ accountId: "vault", accountName: "Emergency Fund", share: 0.05 });
    expect(sharePercent(0.05)).toBe("5%");
    expect(sharePercent(0.025)).toBe("2.5%");
  });

  it("needs the same share from the last two paychecks or more, not one-off moves", () => {
    expect(savingHabit(pays, inflows.slice(2))).toBeNull();
    expect(savingHabit(pays, [...inflows.slice(0, 2), { accountId: "vault", accountName: "Emergency Fund", date: "2026-11-25", amount: 9_000 }])).toBeNull();
    expect(savingHabit(pays.slice(0, 1), inflows)).toBeNull();
  });
});
