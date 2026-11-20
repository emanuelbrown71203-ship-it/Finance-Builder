import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { accounts, balanceSnapshots, budgets, debtPlans, goals, holdings, items, recurringOverrides, transactions, userSettings, type Account } from "@/db/schema";
import { category } from "@/lib/categories";
import { addDays, addMonths, addMonthsToMonth, diffDays, eachDay, formatDistance, formatShort, monthEnd, monthOf, monthStart, weekday, type ISODate } from "@/lib/dates";
import { dollars, dollarsExact } from "@/lib/money";
import { buildMonthPlan, spendingByCategory } from "@/lib/finance/plan";
import { payoffPlan, payoffOrder, type Debt, type Strategy } from "@/lib/finance/payoff";
import { detectRecurring, monthlyEquivalent, seriesKeyFor, upcomingBetween, type RecurringKind } from "@/lib/finance/recurring";
import { cancelHelp, isKnownSubscription } from "@/lib/finance/subscriptions";
import type {
  AccountView,
  AttentionItem,
  DebtPayload,
  DebtView,
  PossibleSubscription,
  RecapPayload,
  AccountsPayload,
  BudgetPayload,
  BudgetRow,
  GoalView,
  GoalsPayload,
  InvestmentsPayload,
  NetWorthPayload,
  NetWorthPoint,
  Overview,
  RecurringPayload,
  RecurringView,
  SyncStatus,
  TransactionsPayload,
  TxView,
  UpcomingBill,
} from "@/lib/types";
import type { Ctx } from "./auth";

/* ---------- accounts ---------- */

function accountView(a: Account): AccountView {
  return {
    id: a.id,
    itemId: a.itemId,
    name: a.name,
    institutionName: a.institutionName,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    balance: a.balance,
    available: a.available,
    creditLimit: a.creditLimit,
    nextPaymentDueDate: a.nextPaymentDueDate,
    minimumPayment: a.minimumPayment,
    aprPercent: a.aprPercent,
  };
}

async function listAccounts(ctx: Ctx): Promise<AccountView[]> {
  const rows = await ctx.db.select().from(accounts).where(eq(accounts.userId, ctx.userId)).orderBy(asc(accounts.institutionName), asc(accounts.name));
  return rows.map(accountView);
}

export async function getAccounts(ctx: Ctx): Promise<AccountsPayload> {
  const [all, itemRows] = await Promise.all([listAccounts(ctx), ctx.db.select().from(items).where(eq(items.userId, ctx.userId)).orderBy(asc(items.institutionName))]);
  return {
    institutions: itemRows.map((i) => ({
      id: i.id,
      institutionName: i.institutionName,
      status: i.status,
      error: i.error,
      lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
      accounts: all.filter((a) => a.itemId === i.id),
    })),
    manual: all.filter((a) => a.itemId === null),
  };
}

async function getSyncStatus(ctx: Ctx): Promise<SyncStatus> {
  const rows = await ctx.db.select({ status: items.status, lastSyncedAt: items.lastSyncedAt }).from(items).where(eq(items.userId, ctx.userId));
  const latest = rows.reduce<Date | null>((max, r) => (r.lastSyncedAt && (!max || r.lastSyncedAt > max) ? r.lastSyncedAt : max), null);
  return { lastSyncedAt: latest?.toISOString() ?? null, linkedInstitutions: rows.length, needsAttention: rows.filter((r) => r.status !== "ok").length };
}

/* ---------- transactions ---------- */

const txColumns = {
  id: transactions.id,
  date: transactions.date,
  name: transactions.name,
  rawName: transactions.rawName,
  amount: transactions.amount,
  category: transactions.category,
  pending: transactions.pending,
  note: transactions.note,
  accountId: transactions.accountId,
  accountName: accounts.name,
  accountMask: accounts.mask,
  createdAt: transactions.createdAt,
};

type TxRow = Omit<TxView, "createdAt"> & { createdAt: Date };
const txView = (r: TxRow): TxView => ({ ...r, createdAt: r.createdAt.toISOString() });

export async function getTransactions(
  ctx: Ctx,
  filter: { q?: string; category?: string; accountId?: string; month?: string; flow?: "in" | "out"; limit: number; offset: number },
): Promise<TransactionsPayload> {
  const conditions = [eq(transactions.userId, ctx.userId)];
  if (filter.q) {
    const like = `%${filter.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(transactions.name, like), ilike(transactions.rawName, like), ilike(transactions.note, like))!);
  }
  if (filter.category) conditions.push(eq(transactions.category, filter.category));
  if (filter.accountId) conditions.push(eq(transactions.accountId, filter.accountId));
  if (filter.month) conditions.push(gte(transactions.date, monthStart(filter.month)), lte(transactions.date, monthEnd(filter.month)));
  if (filter.flow === "in") conditions.push(sql`${transactions.amount} > 0`);
  if (filter.flow === "out") conditions.push(sql`${transactions.amount} < 0`);
  const where = and(...conditions);

  const [rows, [{ count }], accountRows] = await Promise.all([
    ctx.db
      .select(txColumns)
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(filter.limit)
      .offset(filter.offset),
    ctx.db.select({ count: sql<number>`count(*)::int` }).from(transactions).where(where),
    ctx.db
      .select({ id: accounts.id, name: accounts.name, mask: accounts.mask })
      .from(accounts)
      .where(and(eq(accounts.userId, ctx.userId), inArray(accounts.type, ["depository", "credit"])))
      .orderBy(asc(accounts.name)),
  ]);

  return { today: ctx.today, transactions: rows.map(txView), total: count, hasMore: filter.offset + rows.length < count, accounts: accountRows };
}

async function recentTransactions(ctx: Ctx, limit: number): Promise<TxView[]> {
  const rows = await ctx.db
    .select(txColumns)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(eq(transactions.userId, ctx.userId))
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
    .limit(limit);
  return rows.map(txView);
}

/** Lightweight rows for analysis: everything except transfers since a date. */
async function analysisRows(ctx: Ctx, from: ISODate) {
  return ctx.db
    .select({ id: transactions.id, date: transactions.date, name: transactions.name, amount: transactions.amount, category: transactions.category, accountId: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, from), ne(transactions.category, "transfer")))
    .orderBy(asc(transactions.date));
}

/* ---------- recurring ---------- */

type RecurringBundle = { series: RecurringView[]; history: Awaited<ReturnType<typeof analysisRows>>; accounts: AccountView[]; possible: PossibleSubscription[] };

async function loadRecurring(ctx: Ctx): Promise<RecurringBundle> {
  const [history, overrides, accountList] = await Promise.all([
    // Two years back, so a charge that only comes once a year is seen twice.
    analysisRows(ctx, addMonths(ctx.today, -26)),
    ctx.db.select().from(recurringOverrides).where(eq(recurringOverrides.userId, ctx.userId)),
    listAccounts(ctx),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.seriesKey, o]));
  const accountName = new Map(accountList.map((a) => [a.id, a.name]));

  const series: RecurringView[] = [];
  const detected = detectRecurring(history, ctx.today);
  for (const s of detected) {
    const o = overrideByKey.get(s.key);
    if (o?.kind === "ignore") continue;
    const kind = s.kind === "income" ? "income" : ((o?.kind as RecurringKind | undefined) ?? s.kind);
    const cancelled = o?.cancelled ?? false;
    const active = s.active && !cancelled;
    const untilNext = diffDays(s.nextDate, ctx.today);
    series.push({
      ...s,
      kind,
      // A cancelled series stops counting toward what’s coming up.
      active,
      cancelled,
      accountName: accountName.get(s.accountId) ?? "",
      monthly: Math.abs(monthlyEquivalent(s)),
      help: cancelHelp(s.name),
      renewsSoon: active && kind !== "income" && (s.frequency === "yearly" || s.frequency === "quarterly") && untilNext >= 0 && untilNext <= 30,
      startedRecently: active && kind === "subscription" && diffDays(ctx.today, s.firstDate) <= 100,
    });
  }

  // A recent charge from a well-known subscription service that hasn't repeated yet.
  const known = new Set(detected.map((s) => s.key));
  const possible = new Map<string, PossibleSubscription>();
  for (const t of history) {
    if (t.amount >= 0 || diffDays(ctx.today, t.date) > 40 || !isKnownSubscription(t.name)) continue;
    const key = seriesKeyFor(t.name, t.amount);
    if (known.has(key) || overrideByKey.get(key)?.kind === "ignore") continue;
    possible.set(key, { name: t.name, amount: t.amount, date: t.date, help: cancelHelp(t.name) });
  }
  return { series, history, accounts: accountList, possible: [...possible.values()] };
}

function upcomingBills(bundle: RecurringBundle, today: ISODate, days: number): UpcomingBill[] {
  const to = addDays(today, days);
  const out: UpcomingBill[] = [];
  for (const s of bundle.series) {
    if (s.kind === "income") continue;
    // Include bills that are a few days late: they are still owed.
    for (const date of upcomingBetween(s, addDays(today, -7), to)) {
      out.push({ key: s.key, date: date < today ? today : date, name: s.name, amount: s.amount, kind: s.kind, estimated: !s.fixedAmount });
    }
  }
  for (const a of bundle.accounts) {
    if (a.type === "credit" && a.nextPaymentDueDate && a.nextPaymentDueDate >= today && a.nextPaymentDueDate <= to && a.balance < 0) {
      out.push({ key: `card:${a.id}`, date: a.nextPaymentDueDate, name: `${a.name} payment`, amount: a.balance, kind: "card", estimated: true });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
}

export async function getRecurring(ctx: Ctx): Promise<RecurringPayload> {
  const bundle = await loadRecurring(ctx);
  const live = bundle.series.filter((s) => s.active);
  return {
    today: ctx.today,
    series: bundle.series,
    upcoming: upcomingBills(bundle, ctx.today, 45),
    monthlyBills: live.filter((s) => s.kind === "bill").reduce((sum, s) => sum + s.monthly, 0),
    monthlySubscriptions: live.filter((s) => s.kind === "subscription").reduce((sum, s) => sum + s.monthly, 0),
    possible: bundle.possible,
  };
}

/* ---------- budget ---------- */

function budgetRows(history: { date: ISODate; amount: number; category: string }[], limits: Map<string, number>, month: string): BudgetRow[] {
  const inMonth = (m: string) => history.filter((t) => monthOf(t.date) === m);
  const current = new Map(spendingByCategory(inMonth(month)).map((c) => [c.category, c.spent]));
  const last = new Map(spendingByCategory(inMonth(addMonthsToMonth(month, -1))).map((c) => [c.category, c.spent]));
  const prior3 = [1, 2, 3].map((n) => new Map(spendingByCategory(inMonth(addMonthsToMonth(month, -n))).map((c) => [c.category, c.spent])));

  const keys = new Set([...current.keys(), ...limits.keys()]);
  return [...keys]
    .map((category) => ({
      category,
      spent: current.get(category) ?? 0,
      limit: limits.get(category) ?? null,
      lastMonth: last.get(category) ?? 0,
      average: Math.round(prior3.reduce((sum, m) => sum + (m.get(category) ?? 0), 0) / 3),
    }))
    .sort((a, b) => b.spent - a.spent);
}

async function loadLimits(ctx: Ctx): Promise<Map<string, number>> {
  const rows = await ctx.db.select().from(budgets).where(eq(budgets.userId, ctx.userId));
  return new Map(rows.map((b) => [b.category, b.monthlyLimit]));
}

export async function getBudget(ctx: Ctx, month: string): Promise<BudgetPayload> {
  const from = monthStart(addMonthsToMonth(month, -5));
  const [history, limits] = await Promise.all([analysisRows(ctx, from), loadLimits(ctx)]);
  const rows = budgetRows(history, limits, month);
  const months = Array.from({ length: 6 }, (_, i) => addMonthsToMonth(month, i - 5)).map((m) => {
    const txs = history.filter((t) => monthOf(t.date) === m);
    return {
      month: m,
      income: txs.filter((t) => t.category === "income").reduce((s, t) => s + t.amount, 0),
      spending: spendingByCategory(txs).reduce((s, c) => s + c.spent, 0),
    };
  });
  return {
    month,
    today: ctx.today,
    rows,
    totalSpent: rows.reduce((s, r) => s + r.spent, 0),
    totalLimit: rows.reduce((s, r) => s + (r.limit ?? 0), 0),
    income: months[months.length - 1].income,
    months,
  };
}

/* ---------- net worth ---------- */

/**
 * Sums account balances per day. Accounts don’t all report on the same days,
 * so each account’s last known balance is carried forward.
 */
async function balanceSeries(ctx: Ctx, from: ISODate, accountFilter?: (a: AccountView) => boolean): Promise<{ series: NetWorthPoint[]; accounts: AccountView[] }> {
  const accountList = (await listAccounts(ctx)).filter(accountFilter ?? (() => true));
  if (accountList.length === 0) return { series: [], accounts: [] };
  const ids = accountList.map((a) => a.id);
  const rows = await ctx.db
    .select({ accountId: balanceSnapshots.accountId, date: balanceSnapshots.date, balance: balanceSnapshots.balance })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.userId, ctx.userId), inArray(balanceSnapshots.accountId, ids), gte(balanceSnapshots.date, addDays(from, -45))))
    .orderBy(asc(balanceSnapshots.date));

  const byDate = new Map<ISODate, { accountId: string; balance: number }[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const firstDate = rows[0]?.date ?? ctx.today;
  const latest = new Map<string, number>();
  const series: NetWorthPoint[] = [];
  for (const date of eachDay(firstDate, ctx.today)) {
    for (const r of byDate.get(date) ?? []) latest.set(r.accountId, r.balance);
    // Today always reflects the live balances, not the last snapshot.
    if (date === ctx.today) for (const a of accountList) latest.set(a.id, a.balance);
    if (date < from) continue;
    let assets = 0;
    let debts = 0;
    for (const balance of latest.values()) {
      if (balance >= 0) assets += balance;
      else debts += -balance;
    }
    series.push({ date, assets, debts, net: assets - debts });
  }
  return { series, accounts: accountList };
}

function changeOver(series: { date: ISODate; net: number }[], days: number): number {
  if (series.length === 0) return 0;
  const end = series[series.length - 1];
  const start = series[Math.max(0, series.length - 1 - days)];
  return end.net - start.net;
}

const RANGE_DAYS: Record<string, number> = { "1m": 30, "3m": 91, "6m": 182, "1y": 365, all: 3650 };

export async function getNetWorth(ctx: Ctx, range: string): Promise<NetWorthPayload> {
  const days = RANGE_DAYS[range] ?? RANGE_DAYS["6m"];
  const { series, accounts: accountList } = await balanceSeries(ctx, addDays(ctx.today, -days));
  const end = series[series.length - 1] ?? { assets: 0, debts: 0, net: 0 };
  return { today: ctx.today, net: end.net, assets: end.assets, debts: end.debts, change: changeOver(series, days), series, accounts: accountList };
}

/* ---------- goals ---------- */

function goalView(g: typeof goals.$inferSelect, today: ISODate): GoalView {
  const remaining = g.target - g.saved;
  let projectedDate: ISODate | null = null;
  if (remaining <= 0) projectedDate = today;
  else if (g.monthlyContribution > 0) projectedDate = addMonths(today, Math.ceil(remaining / g.monthlyContribution));
  return { id: g.id, name: g.name, target: g.target, saved: g.saved, monthlyContribution: g.monthlyContribution, targetDate: g.targetDate, projectedDate };
}

async function listGoals(ctx: Ctx): Promise<GoalView[]> {
  const rows = await ctx.db.select().from(goals).where(eq(goals.userId, ctx.userId)).orderBy(asc(goals.createdAt), asc(goals.id));
  return rows.map((g) => goalView(g, ctx.today));
}

export async function getGoals(ctx: Ctx): Promise<GoalsPayload> {
  const [goalList, accountList] = await Promise.all([listGoals(ctx), listAccounts(ctx)]);
  const savingsAccounts = accountList.filter((a) => a.type === "depository" && a.subtype !== "checking");
  const month = monthOf(ctx.today);
  const months = Array.from({ length: 6 }, (_, i) => addMonthsToMonth(month, i - 5));
  let monthlySaved = months.map((m) => ({ month: m, amount: 0 }));
  if (savingsAccounts.length > 0) {
    const rows = await ctx.db
      .select({ month: sql<string>`substr(${transactions.date}, 1, 7)`, amount: sql<number>`sum(${transactions.amount})::float8` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, ctx.userId),
          inArray(
            transactions.accountId,
            savingsAccounts.map((a) => a.id),
          ),
          gte(transactions.date, monthStart(months[0])),
        ),
      )
      .groupBy(sql`substr(${transactions.date}, 1, 7)`);
    const byMonth = new Map(rows.map((r) => [r.month, Number(r.amount)]));
    monthlySaved = months.map((m) => ({ month: m, amount: byMonth.get(m) ?? 0 }));
  }
  return { today: ctx.today, goals: goalList, savingsBalance: savingsAccounts.reduce((s, a) => s + a.balance, 0), savingsAccounts, monthlySaved };
}

/* ---------- investments ---------- */

export async function getInvestments(ctx: Ctx, range: string): Promise<InvestmentsPayload> {
  const days = RANGE_DAYS[range] ?? RANGE_DAYS["6m"];
  const [{ series, accounts: investmentAccounts }, holdingRows] = await Promise.all([
    balanceSeries(ctx, addDays(ctx.today, -days), (a) => a.type === "investment"),
    ctx.db.select().from(holdings).where(eq(holdings.userId, ctx.userId)).orderBy(desc(holdings.value)),
  ]);
  const accountName = new Map(investmentAccounts.map((a) => [a.id, a.name]));
  const allocation = new Map<string, number>();
  for (const h of holdingRows) allocation.set(h.assetClass, (allocation.get(h.assetClass) ?? 0) + h.value);
  const points = series.map((p) => ({ date: p.date, value: p.net }));
  return {
    today: ctx.today,
    total: investmentAccounts.reduce((s, a) => s + a.balance, 0),
    costBasis: holdingRows.reduce((s, h) => s + (h.costBasis ?? h.value), 0),
    change: changeOver(series, days),
    series: points,
    accounts: investmentAccounts,
    holdings: holdingRows.map((h) => ({
      id: h.id,
      accountId: h.accountId,
      accountName: accountName.get(h.accountId) ?? "",
      symbol: h.symbol,
      name: h.name,
      assetClass: h.assetClass,
      quantity: h.quantity,
      price: h.price,
      value: h.value,
      costBasis: h.costBasis,
    })),
    allocation: [...allocation.entries()].map(([assetClass, value]) => ({ assetClass, value })).sort((a, b) => b.value - a.value),
  };
}

/* ---------- overview ---------- */

export async function getOverview(ctx: Ctx): Promise<Overview> {
  const month = monthOf(ctx.today);
  const [bundle, limits, goalList, recent, sync, worth, invest, [basis]] = await Promise.all([
    loadRecurring(ctx),
    loadLimits(ctx),
    listGoals(ctx),
    recentTransactions(ctx, 7),
    getSyncStatus(ctx),
    balanceSeries(ctx, addDays(ctx.today, -90)),
    balanceSeries(ctx, addDays(ctx.today, -90), (a) => a.type === "investment"),
    ctx.db.select({ total: sql<number>`coalesce(sum(coalesce(${holdings.costBasis}, ${holdings.value})), 0)::float8` }).from(holdings).where(eq(holdings.userId, ctx.userId)),
  ]);

  const plan = buildMonthPlan({
    month,
    today: ctx.today,
    transactions: bundle.history.filter((t) => monthOf(t.date) === month),
    recurring: bundle.series,
    savingsPlanned: goalList.filter((g) => g.saved < g.target).reduce((s, g) => s + g.monthlyContribution, 0),
  });

  const rows = budgetRows(bundle.history, limits, month);
  const due = upcomingBills(bundle, ctx.today, 30);
  const end = worth.series[worth.series.length - 1] ?? { assets: 0, debts: 0, net: 0 };

  // What needs a look, most urgent first.
  const attention: AttentionItem[] = [];
  if (sync.needsAttention > 0) {
    attention.push({ kind: "bank", title: sync.needsAttention === 1 ? "A bank needs you to sign in again" : `${sync.needsAttention} banks need you to sign in again`, detail: "Until then, new transactions from it won’t show up.", href: "/accounts" });
  }
  for (const bill of due.filter((b) => diffDays(b.date, ctx.today) <= 2)) {
    attention.push({ kind: "due", title: `${bill.name} is due ${formatDistance(bill.date, ctx.today)}`, detail: `${dollarsExact(-bill.amount)}${bill.estimated ? ", based on past bills" : ""}`, href: "/bills" });
  }
  for (const s of bundle.series) {
    if (s.active && s.priceChange && s.priceChange.to < s.priceChange.from) {
      attention.push({ kind: "price", title: `${s.name} raised its price`, detail: `${dollarsExact(-s.priceChange.from)} to ${dollarsExact(-s.priceChange.to)}, ${dollars((s.priceChange.from - s.priceChange.to) * 12)} more a year`, href: "/bills" });
    }
  }
  for (const s of bundle.series) {
    if (s.renewsSoon) {
      attention.push({ kind: "renewal", title: `${s.name} renews ${formatDistance(s.nextDate, ctx.today)}`, detail: `${dollarsExact(-s.amount)}, ${s.frequency === "yearly" ? "once a year" : "every 3 months"}. Cancel before then if you don’t want it.`, href: "/bills" });
    }
  }
  for (const p of bundle.possible) {
    attention.push({ kind: "new", title: `${p.name} looks like a new subscription`, detail: `${dollarsExact(-p.amount)} on ${formatShort(p.date)}`, href: "/bills" });
  }
  for (const row of rows) {
    if (row.limit !== null && row.spent > row.limit) {
      attention.push({ kind: "budget", title: `${category(row.category).label} is over its limit`, detail: `${dollars(row.spent)} spent of ${dollars(row.limit)}`, href: "/budget" });
    }
  }

  return {
    today: ctx.today,
    attention,
    firstName: ctx.user.name.split(" ")[0],
    plan,
    netWorth: { net: end.net, assets: end.assets, debts: end.debts, change: changeOver(worth.series, 30), series: worth.series },
    recent,
    upcoming: due.slice(0, 5),
    upcomingTotal: due.reduce((s, b) => s - b.amount, 0),
    budget: {
      rows: rows.filter((r) => r.limit !== null).slice(0, 5),
      totalSpent: rows.filter((r) => r.limit !== null).reduce((s, r) => s + r.spent, 0),
      totalLimit: rows.reduce((s, r) => s + (r.limit ?? 0), 0),
    },
    goals: goalList,
    investments: {
      total: invest.accounts.reduce((s, a) => s + a.balance, 0),
      change: changeOver(invest.series, 30),
      costBasis: Number(basis?.total ?? 0),
      series: invest.series.map((p) => ({ date: p.date, value: p.net })),
    },
    sync,
  };
}

/* ---------- debt payoff ---------- */

export async function getDebt(ctx: Ctx): Promise<DebtPayload> {
  const [bundle, plans, [settings]] = await Promise.all([
    loadRecurring(ctx),
    ctx.db.select().from(debtPlans).where(eq(debtPlans.userId, ctx.userId)),
    ctx.db.select().from(userSettings).where(eq(userSettings.userId, ctx.userId)).limit(1),
  ]);
  const planFor = new Map(plans.map((p) => [p.accountId, p]));
  const owed = bundle.accounts.filter((a) => (a.type === "credit" || a.type === "loan") && a.balance < 0);
  const strategy: Strategy = settings?.debtStrategy === "snowball" ? "snowball" : "avalanche";
  const extra = settings?.debtExtra ?? 0;

  // For cards: have the payments over the last 90 days kept up with the spending?
  const cardIds = owed.filter((a) => a.type === "credit").map((a) => a.id);
  const cardFlow = new Map<string, { paid: number; spent: number }>();
  if (cardIds.length > 0) {
    const rows = await ctx.db
      .select({ accountId: transactions.accountId, paid: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)::float8`, spent: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)::float8` })
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.userId), inArray(transactions.accountId, cardIds), gte(transactions.date, addDays(ctx.today, -90))))
      .groupBy(transactions.accountId);
    for (const r of rows) cardFlow.set(r.accountId, { paid: Number(r.paid), spent: Number(r.spent) });
  }

  const views: DebtView[] = owed.map((a) => {
    const own = planFor.get(a.id);
    // A loan's regular payment usually shows up as a repeating charge named after it.
    const series = bundle.series.find((s) => s.active && s.kind !== "income" && s.category === "loans" && s.name.toLowerCase().includes(a.name.toLowerCase()));
    const payment = own?.monthlyPayment ?? (series ? Math.abs(monthlyEquivalent(series)) : a.minimumPayment);
    const flow = cardFlow.get(a.id);
    return {
      id: a.id,
      name: a.name,
      institutionName: a.institutionName,
      type: a.type,
      balance: -a.balance,
      aprPercent: own?.aprPercent ?? a.aprPercent,
      payment,
      paymentSource: own?.monthlyPayment != null ? "yours" : series ? "history" : a.minimumPayment != null ? "bank" : null,
      paidInFull: a.type === "credit" && own?.monthlyPayment == null && !!flow && flow.spent > 0 && flow.paid >= flow.spent * 0.85,
      paidOffMonth: null,
      interest: 0,
      order: null,
    };
  });

  const inPlan: Debt[] = views.filter((d) => !d.paidInFull && d.aprPercent !== null && d.payment !== null && d.payment > 0).map((d) => ({ id: d.id, name: d.name, balance: d.balance, aprPercent: d.aprPercent!, payment: d.payment! }));
  const month = monthOf(ctx.today);
  const base = payoffPlan(inPlan, 0, strategy, month);
  const plan = payoffPlan(inPlan, extra, strategy, month);
  const order = payoffOrder(inPlan, strategy).map((d) => d.id);
  for (const d of views) {
    const result = plan.perDebt.find((p) => p.id === d.id);
    if (!result) continue;
    d.paidOffMonth = result.paidOffMonth;
    d.interest = result.interest;
    d.order = order.indexOf(d.id) + 1;
  }
  const slim = (p: typeof plan) => ({ months: p.months, debtFreeMonth: p.debtFreeMonth, totalInterest: p.totalInterest, balances: p.balances });
  return {
    today: ctx.today,
    totalOwed: views.reduce((s, d) => s + d.balance, 0),
    extra,
    strategy,
    debts: views.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || b.balance - a.balance),
    base: slim(base),
    plan: slim(plan),
    needsDetails: views.filter((d) => !d.paidInFull && d.order === null).length,
  };
}

/* ---------- weekly recap ---------- */

/** Looks back on the last full week, Monday to Sunday. `weeksBack` 0 is the most recent one. */
export async function getRecap(ctx: Ctx, weeksBack = 0): Promise<RecapPayload> {
  // Monday of the current week, then step back.
  const daysSinceMonday = (weekday(ctx.today) + 6) % 7;
  const from = addDays(ctx.today, -daysSinceMonday - 7 * (weeksBack + 1));
  const to = addDays(from, 6);
  const beforeFrom = addDays(from, -7);

  const [rows, bundle, worth, savings] = await Promise.all([
    ctx.db
      .select({ id: transactions.id, date: transactions.date, name: transactions.name, amount: transactions.amount, category: transactions.category, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, beforeFrom), lte(transactions.date, to))),
    loadRecurring(ctx),
    balanceSeries(ctx, addDays(from, -1)),
    listAccounts(ctx),
  ]);
  const real = rows.filter((t) => t.category !== "transfer");
  const week = real.filter((t) => t.date >= from);
  const before = real.filter((t) => t.date < from);
  const spending = (list: typeof real) => spendingByCategory(list).reduce((s, c) => s + c.spent, 0);
  const out = week.filter((t) => t.amount < 0 && t.category !== "income");
  const biggest = [...out].sort((a, b) => a.amount - b.amount)[0];
  const billIds = new Set(bundle.series.filter((s) => s.kind !== "income").flatMap((s) => s.history.map((h) => h.id)));
  const bills = out.filter((t) => billIds.has(t.id));
  const spendDays = new Set(out.filter((t) => !billIds.has(t.id)).map((t) => t.date));
  const savingsIds = new Set(savings.filter((a) => a.type === "depository" && a.subtype !== "checking").map((a) => a.id));
  const start = worth.series.find((p) => p.date === addDays(from, -1));
  const end = worth.series.find((p) => p.date === to);

  return {
    from,
    to,
    spent: spending(week),
    spentBefore: spending(before),
    income: week.filter((t) => t.category === "income").reduce((s, t) => s + t.amount, 0),
    count: out.length,
    noSpendDays: 7 - spendDays.size,
    topCategories: spendingByCategory(week).slice(0, 3),
    biggest: biggest ? { name: biggest.name, amount: biggest.amount, date: biggest.date } : null,
    billsPaid: { count: bills.length, total: bills.reduce((s, t) => s - t.amount, 0) },
    savedToGoals: rows.filter((t) => t.date >= from && savingsIds.has(t.accountId)).reduce((s, t) => s + t.amount, 0),
    netWorthChange: start && end ? end.net - start.net : null,
  };
}
