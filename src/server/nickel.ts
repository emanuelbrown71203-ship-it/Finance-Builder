import { and, eq, gte, lte } from "drizzle-orm";
import { transactions } from "@/db/schema";
import { category } from "@/lib/categories";
import { addDays, weekday } from "@/lib/dates";
import { thinkAbout, type Mood, type Tip } from "@/lib/nickel/brain";
import type { Ctx } from "./auth";
import { countUnclear } from "./names";
import { answerQuestion, type Answer, type LastVerdict, type Snapshot } from "@/lib/nickel/answers";
import { monthOf } from "@/lib/dates";
import { dollarsExact } from "@/lib/money";
import { feesAndInterest, getAccounts, getBudget, getGoals, getOverview, getRecurring, getTransactions } from "./queries";

export type NickelPayload = {
  mood: Mood;
  tips: Tip[];
  /** The newest transaction, so he can perk up when a new one arrives. */
  latest: { id: string; name: string; amount: number; createdAt: string } | null;
  demo: boolean;
  /** For understanding instructions on the phone: today, and the goals and loans he can be told about. */
  today: string;
  goals: { id: string; name: string }[];
  loans: { id: string; name: string }[];
};

/** Gathers what Nickel looks at from the person's own numbers. Read-only. */
export async function getNickel(ctx: Ctx): Promise<NickelPayload> {
  const [overview, goals, accounts, unclearNames] = await Promise.all([getOverview(ctx), getGoals(ctx), getAccounts(ctx), countUnclear(ctx)]);
  const days = overview.plan.days;
  const todayPlan = days.find((d) => d.date === ctx.today);
  const paidToday = (todayPlan?.events ?? []).filter((e) => e.type === "income" && e.settled && e.amount > 0).reduce((s, e) => s + e.amount, 0);

  // Days in a row with no everyday spending, counting back from yesterday, within this month.
  let noSpendStreak = 0;
  for (let date = addDays(ctx.today, -1); ; date = addDays(date, -1)) {
    const day = days.find((d) => d.date === date);
    if (!day || day.everyday > 0) break;
    noSpendStreak++;
  }

  const allAccounts = [...accounts.institutions.flatMap((i) => i.accounts), ...accounts.manual];
  const debts = allAccounts.filter((a) => a.balance < 0 && a.aprPercent !== null).sort((a, b) => (b.aprPercent ?? 0) - (a.aprPercent ?? 0));
  const latest = overview.recent[0] ?? null;

  const { mood, tips } = thinkAbout({
    today: ctx.today,
    demo: ctx.demo,
    linked: accounts.institutions.length > 0 || accounts.manual.length > 0,
    firstName: overview.firstName,
    leftToSpend: overview.plan.leftToSpend,
    perDay: overview.plan.perDay,
    daysLeft: overview.plan.daysLeft,
    paidToday,
    attention: overview.attention,
    budget: overview.budget.rows.map((r) => ({ category: r.category, label: category(r.category).label, spent: r.spent, limit: r.limit === null ? null : Math.max(0, r.limit + r.carried), onPaceOver: r.status === "watch" })),
    goals: goals.goals,
    upcoming: overview.upcoming,
    noSpendStreak,
    netWorthChange: overview.netWorth.change,
    priciestDebt: debts[0] ? { name: debts[0].name, apr: debts[0].aprPercent! } : null,
    latest: latest ? { name: latest.name, amount: latest.amount, date: latest.date } : null,
    unclearNames,
    noSpend: overview.noSpend
      ? {
          phase: overview.noSpend.phase,
          clear: overview.noSpend.clear,
          day: overview.noSpend.days.findIndex((d) => d.date === ctx.today) + 1,
          spentToday: overview.noSpend.days.some((d) => d.date === ctx.today && d.state === "spent"),
          leftover: Math.max(0, overview.noSpend.leftover),
        }
      : null,
  });
  return {
    mood,
    tips,
    latest: latest ? { id: latest.id, name: latest.name, amount: latest.amount, createdAt: latest.createdAt } : null,
    demo: ctx.demo,
    today: ctx.today,
    goals: goals.goals.map((g) => ({ id: g.id, name: g.name })),
    loans: allAccounts.filter((a) => a.balance < 0 && (a.type === "loan" || a.type === "credit")).map((a) => ({ id: a.id, name: a.name })),
  };
}

/**
 * Answers a question said or typed to Nickel from the person's own numbers.
 * Read-only, and nothing leaves Passbook: the words are matched by rules
 * (src/lib/nickel/answers.ts), not sent to any AI service. Null when he
 * didn't understand.
 */
export async function askNickel(ctx: Ctx, question: string, last: LastVerdict | null = null): Promise<Answer | null> {
  const q = question.slice(0, 300);
  const month = monthOf(ctx.today);
  const [overview, recurring, budget, goals, accounts, costs] = await Promise.all([getOverview(ctx), getRecurring(ctx), getBudget(ctx, month), getGoals(ctx), getAccounts(ctx), feesAndInterest(ctx)]);
  const latest = overview.recent[0] ?? null;
  const all = [...accounts.institutions.flatMap((i) => i.accounts), ...accounts.manual];
  const debts = all.filter((a) => a.balance < 0 && a.aprPercent !== null).sort((a, b) => (b.aprPercent ?? 0) - (a.aprPercent ?? 0));
  const paydays = recurring.series.filter((s) => s.kind === "income" && s.active && s.nextDate >= ctx.today).map((s) => s.nextDate).sort();
  // Spending this week (from Monday) and last week, bills included and transfers not.
  const monday = addDays(ctx.today, -((weekday(ctx.today) + 6) % 7));
  const lastMonday = addDays(monday, -7);
  const recent = await ctx.db
    .select({ date: transactions.date, amount: transactions.amount, category: transactions.category })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, lastMonday), lte(transactions.date, ctx.today)));
  const spentFrom = (from: string, to: string) => recent.filter((t) => t.date >= from && t.date <= to && t.category !== "transfer" && t.category !== "income").reduce((sum, t) => sum - t.amount, 0);
  const kindOf = (a: (typeof all)[number]): "checking" | "savings" | "card" | "loan" | null =>
    a.type === "credit" ? "card" : a.type === "loan" ? "loan" : a.type === "depository" ? (a.subtype === "savings" ? "savings" : "checking") : null;
  const snapshot: Snapshot = {
    today: ctx.today,
    firstName: overview.firstName,
    leftToSpend: overview.plan.leftToSpend,
    perDay: overview.plan.perDay,
    daysLeft: overview.plan.daysLeft,
    incomeReceived: overview.plan.incomeReceived,
    incomeExpected: overview.plan.incomeExpected,
    month: {
      billsPaid: overview.plan.billsPaid,
      everyday: overview.plan.everydaySpent,
      billsDue: Math.max(0, overview.plan.billsExpected - overview.plan.billsPaid),
      saving: overview.plan.savingsPlanned,
    },
    // Repeating bills, plus card payments that are coming due.
    bills: [
      ...recurring.series.filter((s) => s.kind !== "income").map((s) => ({ name: s.name, nextDate: s.nextDate, amount: s.amount, active: s.active, category: s.category })),
      ...recurring.upcoming.filter((u) => u.kind === "card").map((u) => ({ name: u.name, nextDate: u.date, amount: u.amount, active: true, category: "card" })),
    ],
    spending: budget.rows.map((r) => ({ category: r.category, label: category(r.category).label, spent: r.spent, limit: r.limit === null ? null : Math.max(0, r.limit + r.carried), lastMonth: r.lastMonth + r.lastMonthBills, bills: r.bills, status: r.status })),
    goals: goals.goals.map((g) => ({ id: g.id, name: g.name, saved: g.saved, target: g.target, status: g.status, perMonth: g.perMonth, targetDate: g.targetDate, projectedDate: g.projectedDate })),
    netWorth: overview.netWorth.net,
    netWorthChange: overview.netWorth.change,
    latest: latest ? { name: latest.name, amount: latest.amount, date: latest.date } : null,
    // Only checking counts as what bills come out of (not savings, CDs or HSAs). None linked: no cash test.
    cash: all.some((a) => a.type === "depository" && a.subtype === "checking") ? all.filter((a) => a.type === "depository" && a.subtype === "checking").reduce((sum, a) => sum + a.balance, 0) : null,
    savings: all.filter((a) => a.type === "depository" && a.subtype === "savings").reduce((sum, a) => sum + a.balance, 0),
    nextPayday: paydays[0] ?? null,
    priciestDebt: debts[0] ? { name: debts[0].name, apr: debts[0].aprPercent! } : null,
    accounts: all.flatMap((a) => {
      const kind = kindOf(a);
      if (!kind) return [];
      return [{ name: a.name, kind, balance: kind === "card" || kind === "loan" ? -a.balance : a.balance }];
    }),
    weeks: { today: spentFrom(ctx.today, ctx.today), thisWeek: spentFrom(monday, ctx.today), lastWeek: spentFrom(lastMonday, addDays(monday, -1)) },
    extras: recurring.series.filter((s) => s.kind === "subscription" && s.active).map((s) => ({ name: s.name, monthly: s.monthly })),
    costs,
  };
  const answer = answerQuestion(q, snapshot, last);
  if (!answer || !("merchant" in answer)) return answer;
  // Spending at a place: add up this month's charges there.
  // Searched up to any apostrophe, since banks write "Joe’s", "Joe's" or "Joes".
  const found = await getTransactions(ctx, { q: answer.merchant.split(/['’]/)[0].trim().slice(0, 60), month, flow: "out", limit: 200, offset: 0 });
  // Whole words only: "ross" is Ross, not Crossfit.
  const word = new RegExp(`\\b${answer.merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]?")}\\b`, "i");
  const charges = found.transactions.filter((t) => t.category !== "transfer" && (word.test(t.name) || word.test(t.bankName) || word.test(t.rawName ?? "")));
  if (charges.length === 0) return { text: `Nothing at “${answer.merchant.slice(0, 40)}” this month.`, href: "/transactions", link: "See transactions" };
  const spent = charges.reduce((sum, t) => sum - t.amount, 0);
  return {
    text: `You’ve spent ${dollarsExact(spent)} at ${charges[0].name} this month, across ${charges.length} ${charges.length === 1 ? "charge" : "charges"}.`,
    href: `/transactions?q=${encodeURIComponent(answer.merchant.slice(0, 60))}`,
    link: "See them",
  };
}

