import { category } from "@/lib/categories";
import { addDays } from "@/lib/dates";
import { thinkAbout, type Mood, type Tip } from "@/lib/nickel/brain";
import type { Ctx } from "./auth";
import { countUnclear } from "./names";
import { getAccounts, getGoals, getOverview } from "./queries";

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
    budget: overview.budget.rows.map((r) => ({ category: r.category, label: category(r.category).label, spent: r.spent, limit: r.limit })),
    goals: goals.goals,
    upcoming: overview.upcoming,
    noSpendStreak,
    netWorthChange: overview.netWorth.change,
    priciestDebt: debts[0] ? { name: debts[0].name, apr: debts[0].aprPercent! } : null,
    latest: latest ? { name: latest.name, amount: latest.amount, date: latest.date } : null,
    unclearNames,
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
