import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { accounts, balanceSnapshots, budgets, debtPlans, goalDeposits, goals, holdings, incomeAdjustments, items, recurringOverrides, transactions, userSettings, type Account } from "@/db/schema";
import { category, isNecessity } from "@/lib/categories";
import { DEFAULT_TIMEZONE } from "@/lib/config";
import { addDays, addMonths, addMonthsToMonth, dayOfMonth, daysInMonth, diffDays, eachDay, formatDistance, formatShort, monthEnd, monthOf, monthStart, todayIn, weekday, type ISODate } from "@/lib/dates";
import { goalIdeas, goalPlan } from "@/lib/finance/goalplan";
import { dollars, dollarsExact } from "@/lib/money";
import { buildMonthPlan, spendingByCategory } from "@/lib/finance/plan";
import { budgetPlan, categoryBudgets, monthProgress, suggestLimits, type Limit } from "@/lib/finance/budget";
import { payoffPlan, payoffOrder, recentMonthlyPaydown, type Debt, type Strategy } from "@/lib/finance/payoff";
import { noSpendWeek } from "@/lib/finance/nospend";
import { FREQUENCY_LABEL, detectRecurring, monthlyEquivalent, seriesKeyFor, upcomingBetween, type RecurringKind } from "@/lib/finance/recurring";
import { cancelHelp, isKnownSubscription } from "@/lib/finance/subscriptions";
import { isRoundUp, roundUpName, type Namer } from "@/lib/finance/names";
import { HttpError } from "./errors";
import { appleCardSummary } from "./card-import";
import { bankMatch, listManualBills, manualSeries } from "./manual-bills";
import { bankNames, loadNamer } from "./names";
import type {
  AccountView,
  CostsView,
  AttentionItem,
  DebtPayload,
  DebtView,
  PossibleSubscription,
  RecapPayload,
  AccountsPayload,
  BudgetPayload,
  GoalDetailPayload,
  GoalView,
  GoalsPayload,
  InvestmentsPayload,
  NetWorthPayload,
  NetWorthPoint,
  Overview,
  PaidBill,
  Paycheck,
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
  const [all, itemRows, appleCard] = await Promise.all([listAccounts(ctx), ctx.db.select().from(items).where(eq(items.userId, ctx.userId)).orderBy(asc(items.institutionName)), appleCardSummary(ctx)]);
  return {
    institutions: itemRows.map((i) => ({
      id: i.id,
      institutionName: i.institutionName,
      status: i.status,
      error: i.error,
      lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
      accounts: all.filter((a) => a.itemId === i.id),
    })),
    manual: all.filter((a) => a.itemId === null && a.id !== appleCard?.accountId),
    appleCard,
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
  customName: transactions.customName,
  accountId: transactions.accountId,
  accountName: accounts.name,
  accountMask: accounts.mask,
  accountType: accounts.type,
  createdAt: transactions.createdAt,
};

type TxRow = Omit<TxView, "createdAt" | "bankName" | "nameSource" | "ruleId" | "ruleExact" | "roundUp"> & { createdAt: Date; accountType: string };
const txView = ({ accountType, ...r }: TxRow, nameFor: Namer): TxView => {
  const named = nameFor(r);
  // A round-up reads as one ("Round-up from Ingles Markets"), unless the person named it themselves.
  const roundUp = isRoundUp({ ...r, accountType });
  const name = roundUp && named.source !== "custom" && named.source !== "rule" ? roundUpName(r.amount, named.name, r.rawName ?? r.name) : named.name;
  return { ...r, name, bankName: r.name, nameSource: named.source, ruleId: named.ruleId, ruleExact: named.exact, createdAt: r.createdAt.toISOString(), ...(roundUp ? { roundUp: true } : {}) };
};

export async function getTransactions(
  ctx: Ctx,
  filter: { q?: string; category?: string; accountId?: string; month?: string; flow?: "in" | "out"; limit: number; offset: number },
): Promise<TransactionsPayload> {
  const conditions = [eq(transactions.userId, ctx.userId)];
  const nameFor = await loadNamer(ctx);
  if (filter.q) {
    const like = `%${filter.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const matches = [ilike(transactions.name, like), ilike(transactions.rawName, like), ilike(transactions.note, like), ilike(transactions.customName, like)];
    // Names given by rules or the tidy-up aren't stored, so search what people actually see too:
    // work out the shown name once per bank text (not per charge) and match on the bank text.
    const q = filter.q.toLowerCase();
    const places = await bankNames(ctx, { withoutOwnName: true });
    for (const incoming of [true, false]) {
      const hits = [...new Set(places.filter((p) => p.incoming === incoming && nameFor.base(p.name, incoming).name.toLowerCase().includes(q)).map((p) => p.name))].slice(0, 1_000);
      if (hits.length > 0) matches.push(and(isNull(transactions.customName), inArray(transactions.name, hits), incoming ? sql`${transactions.amount} > 0` : sql`${transactions.amount} <= 0`)!);
    }
    // Names kept for one exact amount.
    for (const rule of nameFor.exactRules.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 50)) {
      const hits = [...new Set(places.filter((p) => nameFor.keyOf(p.name, rule.amount) === rule.key).map((p) => p.name))].slice(0, 200);
      if (hits.length > 0) matches.push(and(isNull(transactions.customName), inArray(transactions.name, hits), eq(transactions.amount, rule.amount))!);
    }
    conditions.push(or(...matches)!);
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

  return { today: ctx.today, transactions: rows.map((r) => txView(r, nameFor)), total: count, hasMore: filter.offset + rows.length < count, accounts: accountRows };
}

async function recentTransactions(ctx: Ctx, limit: number): Promise<TxView[]> {
  const [rows, nameFor] = await Promise.all([
    ctx.db
      .select(txColumns)
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(eq(transactions.userId, ctx.userId))
      .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
      .limit(limit),
    loadNamer(ctx),
  ]);
  return rows.map((r) => txView(r, nameFor));
}

/** Lightweight rows for analysis: everything except transfers since a date. */
async function analysisRows(ctx: Ctx, from: ISODate) {
  return ctx.db
    .select({ id: transactions.id, date: transactions.date, name: transactions.name, amount: transactions.amount, category: transactions.category, accountId: transactions.accountId, customName: transactions.customName })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, from), ne(transactions.category, "transfer")))
    .orderBy(asc(transactions.date));
}

/* ---------- recurring ---------- */

type RecurringBundle = {
  series: RecurringView[];
  history: Awaited<ReturnType<typeof analysisRows>>;
  accounts: AccountView[];
  possible: PossibleSubscription[];
  /** What the owner expects particular coming paychecks to be ("this one's lighter"), keyed "seriesKey|date". */
  incomeAdjust: Map<string, number>;
};

/** Where to cancel: the bank's text finds well-known services best; otherwise search by the name the owner sees. */
function helpFor(bankName: string, shown: string) {
  const known = cancelHelp(bankName);
  return known.label?.startsWith("Search how to cancel") ? cancelHelp(shown) : known;
}

async function loadRecurring(ctx: Ctx): Promise<RecurringBundle> {
  const [raw, overrides, accountList, nameFor, added, adjustments] = await Promise.all([
    // Two years back, so a charge that only comes once a year is seen twice.
    analysisRows(ctx, addMonths(ctx.today, -26)),
    ctx.db.select().from(recurringOverrides).where(eq(recurringOverrides.userId, ctx.userId)),
    listAccounts(ctx),
    loadNamer(ctx),
    listManualBills(ctx),
    ctx.db.select({ seriesKey: incomeAdjustments.seriesKey, date: incomeAdjustments.date, amount: incomeAdjustments.amount }).from(incomeAdjustments).where(and(eq(incomeAdjustments.userId, ctx.userId), gte(incomeAdjustments.date, addDays(ctx.today, -45)))),
  ]);
  const overrideByKey = new Map(overrides.map((o) => [o.seriesKey, o]));
  const ownName = new Map(raw.map((t) => [t.id, t.customName]));
  const accountName = new Map(accountList.map((a) => [a.id, a.name]));

  const series: RecurringView[] = [];
  // Series are found and keyed by the bank's text, so renaming never splits or loses a bill.
  const detected = detectRecurring(raw, ctx.today);
  for (const s of detected) {
    const o = overrideByKey.get(s.key);
    if (o?.kind === "ignore") continue;
    const kind = s.kind === "income" ? "income" : ((o?.kind as RecurringKind | undefined) ?? s.kind);
    const cancelled = o?.cancelled ?? false;
    const active = s.active && !cancelled;
    const untilNext = diffDays(s.nextDate, ctx.today);
    const latest = s.history[s.history.length - 1];
    const named = nameFor({ name: s.name, amount: latest?.amount ?? s.amount });
    // Renaming the bill starts from its newest charge that has no name of its own.
    const sample = [...s.history].reverse().find((h) => !ownName.get(h.id)) ?? latest;
    // A shared bill (rent split with a partner) counts only the person's part, everywhere.
    const share = kind !== "income" && o?.shareBp ? o.shareBp / 10_000 : null;
    const part = (cents: number) => (share === null ? cents : Math.round(cents * share));
    const mine = { ...s, amount: part(s.amount) };
    series.push({
      ...s,
      amount: mine.amount,
      history: share === null ? s.history : s.history.map((h) => ({ ...h, amount: part(h.amount) })),
      priceChange: s.priceChange && share !== null ? { from: part(s.priceChange.from), to: part(s.priceChange.to) } : s.priceChange,
      share,
      name: named.name,
      bankName: s.name,
      ruleId: named.ruleId,
      ruleExact: named.exact,
      sampleId: sample?.id ?? "",
      manual: null,
      kind,
      // A cancelled series stops counting toward what’s coming up.
      active,
      cancelled,
      accountName: accountName.get(s.accountId) ?? "",
      monthly: Math.abs(monthlyEquivalent(mine)),
      help: helpFor(s.name, named.name),
      renewsSoon: active && kind !== "income" && (s.frequency === "yearly" || s.frequency === "quarterly") && untilNext >= 0 && untilNext <= 30,
      startedRecently: active && kind === "subscription" && diffDays(ctx.today, s.firstDate) <= 100,
    });
  }

  // Bills added by hand sit alongside the ones found in the history.
  const found = series.map((s) => ({ name: s.name, bankName: s.bankName, active: s.active, kind: s.kind, amount: s.amount, frequency: s.frequency }));
  const charges = raw.filter((t) => t.amount < 0 && t.date >= addDays(ctx.today, -60)).map((t) => ({ id: t.id, date: t.date, amount: t.amount, names: [t.name, nameFor(t).name] }));
  for (const bill of added) series.push(manualSeries(bill, ctx.today, bankMatch(bill, ctx.today, charges, found)));
  series.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.name.localeCompare(b.name)));

  // A recent charge from a well-known subscription service that hasn't repeated yet.
  const known = new Set(detected.map((s) => s.key));
  const possible = new Map<string, PossibleSubscription>();
  for (const t of raw) {
    if (t.amount >= 0 || diffDays(ctx.today, t.date) > 40) continue;
    const shown = nameFor(t).name;
    if (!isKnownSubscription(t.name) && !isKnownSubscription(shown)) continue;
    const key = seriesKeyFor(t.name, t.amount);
    if (known.has(key) || overrideByKey.get(key)?.kind === "ignore") continue;
    possible.set(key, { key, name: shown, amount: t.amount, date: t.date, help: helpFor(t.name, shown) });
  }
  // Everything after this point shows names, so give each transaction the name the owner sees, and each
  // payment of a shared bill only the person's part (so the month plan, budget and recap count just that).
  const shareFor = new Map(series.filter((s) => s.share !== null && !s.manual).map((s) => [s.key, s.share!]));
  const history = raw.map((t) => {
    const share = t.amount < 0 ? shareFor.get(seriesKeyFor(t.name, t.amount)) : undefined;
    return { ...t, name: nameFor(t).name, ...(share !== undefined ? { amount: Math.round(t.amount * share) } : {}) };
  });
  return { series, history, accounts: accountList, possible: [...possible.values()], incomeAdjust: new Map(adjustments.map((a) => [`${a.seriesKey}|${a.date}`, a.amount])) };
}

/**
 * What bills and Extras charged this month and last, newest first. Paying a card is a transfer, so it never
 * shows here: rent put on a card shows once, as rent.
 */
function paidLately(bundle: RecurringBundle, today: ISODate): PaidBill[] {
  const from = `${addMonthsToMonth(monthOf(today), -1)}-01`;
  const seen = new Set<string>();
  const out: PaidBill[] = [];
  for (const s of bundle.series) {
    if (s.kind === "income") continue;
    for (const h of s.history) {
      // A bill added by hand can share its payment with the bank's own series: count it once.
      if (h.amount >= 0 || h.date < from || h.date > today || seen.has(h.id)) continue;
      seen.add(h.id);
      out.push({ id: h.id, seriesKey: s.key, date: h.date, name: s.name, amount: h.amount, kind: s.kind, category: s.category, accountName: s.accountName, ...(s.share !== null ? { share: s.share } : {}) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.amount - b.amount));
}

function upcomingBills(bundle: RecurringBundle, today: ISODate, days: number): UpcomingBill[] {
  const to = addDays(today, days);
  const out: UpcomingBill[] = [];
  for (const s of bundle.series) {
    if (s.kind === "income") continue;
    // Include bills that are a few days late: they are still owed.
    for (const date of upcomingBetween(s, addDays(today, -7), to)) {
      out.push({ key: s.key, date: date < today ? today : date, name: s.name, amount: s.amount, kind: s.kind, estimated: !s.fixedAmount, ...(s.share !== null ? { share: s.share } : {}) });
    }
  }
  // A card's payment is only what's required, the minimum: people pay a big balance down over time, and
  // rarely the same amount each month. Without a known minimum there's no amount to set aside.
  for (const a of bundle.accounts) {
    if (a.type === "credit" && a.nextPaymentDueDate && a.nextPaymentDueDate >= today && a.nextPaymentDueDate <= to && a.balance < 0 && a.minimumPayment && a.minimumPayment > 0) {
      out.push({ key: `card:${a.id}`, date: a.nextPaymentDueDate, name: `${a.name} minimum payment`, amount: -Math.min(a.minimumPayment, -a.balance), kind: "card", estimated: false, owed: -a.balance });
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
    paid: paidLately(bundle, ctx.today),
    monthlyBills: live.filter((s) => s.kind === "bill").reduce((sum, s) => sum + s.monthly, 0),
    monthlySubscriptions: live.filter((s) => s.kind === "subscription").reduce((sum, s) => sum + s.monthly, 0),
    possible: bundle.possible,
  };
}

/* ---------- budget ---------- */

/**
 * The ids of every bill payment. Bills are necessities (rent, power, insurance, loans, and anything the
 * person moves to Bills): planned on their own, never counted against a budget. Everything spent on a
 * necessity is a bill, repeating or not, unless the person moved that charge to Extras. Subscriptions are
 * "Extras" (Netflix): they come out of their category's budget like any other spending.
 */
function billIdsOf(bundle: RecurringBundle): Set<string> {
  const ids = new Set(bundle.series.filter((s) => s.kind === "bill").flatMap((s) => s.history.map((h) => h.id)));
  const extras = new Set(bundle.series.filter((s) => s.kind === "subscription").flatMap((s) => s.history.map((h) => h.id)));
  for (const t of bundle.history) if (isNecessity(t.category) && t.amount !== 0 && !extras.has(t.id)) ids.add(t.id);
  return ids;
}

/** What the month plan reserves ahead of time: bills and income, not Extras. */
const plannedSeries = (bundle: RecurringBundle) => bundle.series.filter((s) => s.kind !== "subscription");

/** The person's limits (removed ones are kept a while for Undo, but don't count). */
export async function loadLimits(ctx: Ctx): Promise<(Limit & { createdAt: Date })[]> {
  const rows = await ctx.db.select().from(budgets).where(and(eq(budgets.userId, ctx.userId), isNull(budgets.removedAt)));
  return rows.map((b) => ({ category: b.category, limit: b.monthlyLimit, rolloverSince: b.rolloverSince, rolloverCarry: b.rolloverCarry, createdAt: b.createdAt }));
}

/** What a category with rollover on has carried into this month, at the limits as they stand. */
export async function carriedNow(ctx: Ctx, categoryKey: string): Promise<number> {
  const [bundle, limits] = await Promise.all([loadRecurring(ctx), loadLimits(ctx)]);
  const rows = categoryBudgets({ month: monthOf(ctx.today), today: ctx.today, history: bundle.history, billIds: billIdsOf(bundle), limits: limits.filter((l) => l.category === categoryKey) });
  return rows.find((r) => r.category === categoryKey)?.carried ?? 0;
}

/** What goals are set to put aside this month. */
const savingPlanned = (goalList: GoalView[]) => goalList.filter((g) => g.saved < g.target).reduce((s, g) => s + g.monthlyContribution, 0);

/** Everything the budget screen and Home need for one month, from one load. */
/**
 * The month's paychecks: those that came in, and those still expected (at what the owner said a lighter
 * one will be, or the usual), in date order. Late ones not yet in still count as expected.
 */
function paychecksFor(bundle: RecurringBundle, month: string, today: ISODate): Paycheck[] {
  const start = monthStart(month);
  const end = monthEnd(month);
  const from = today < start ? start : today;
  const lateFrom = addDays(from, -10) < start ? start : addDays(from, -10);
  const out: Paycheck[] = [];
  for (const s of bundle.series) {
    // Interest and dividends come on their own; they're money in, but not a paycheck to set lighter.
    if (s.kind !== "income" || /\b(interest|dividends?)\b/i.test(`${s.name} ${s.bankName}`)) continue;
    const workdays = s.frequency === "weekly" ? 5 : s.frequency === "monthly" ? 22 : 10;
    for (const h of s.history) if (h.amount > 0 && monthOf(h.date) === month) out.push({ key: s.key, name: s.name, date: h.date, amount: h.amount, usual: s.amount, received: true, adjusted: false, workdays });
    if (!s.active || today > end) continue;
    for (const date of upcomingBetween(s, lateFrom, end)) {
      const set = bundle.incomeAdjust.get(`${s.key}|${date}`);
      out.push({ key: s.key, name: s.name, date, amount: set ?? s.amount, usual: s.amount, received: false, adjusted: set !== undefined, workdays });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** What usually comes in a month: the middle of the last three months' income (months with any). */
function usualIncome(history: { date: string; amount: number; category: string }[], month: string): number {
  const totals = [1, 2, 3]
    .map((n) => addMonthsToMonth(month, -n))
    .map((m) => history.filter((t) => t.category === "income" && t.amount > 0 && monthOf(t.date) === m).reduce((s, t) => s + t.amount, 0))
    .filter((t) => t > 0)
    .sort((a, b) => a - b);
  return totals.length === 0 ? 0 : totals[Math.floor((totals.length - 1) / 2)];
}

function budgetFor(ctx: Ctx, bundle: RecurringBundle, limits: Limit[], goalList: GoalView[], month: string) {
  const billIds = billIdsOf(bundle);
  const rows = categoryBudgets({ month, today: ctx.today, history: bundle.history, billIds, limits });
  const monthPlan = buildMonthPlan({ month, today: ctx.today, transactions: bundle.history.filter((t) => monthOf(t.date) === month), recurring: plannedSeries(bundle), savingsPlanned: savingPlanned(goalList), billIds, usualIncome: usualIncome(bundle.history, month), incomeAdjust: bundle.incomeAdjust });
  const plan = { ...budgetPlan({ income: monthPlan.incomeExpected, bills: monthPlan.billsExpected, saving: monthPlan.savingsPlanned, rows }), everydaySpent: monthPlan.everydaySpent, leftToSpend: monthPlan.leftToSpend };
  return { rows, monthPlan, plan };
}

export async function getBudget(ctx: Ctx, month: string): Promise<BudgetPayload> {
  const [bundle, limits, goalList, deposits] = await Promise.all([
    loadRecurring(ctx),
    loadLimits(ctx),
    listGoals(ctx),
    ctx.db.select({ amount: goalDeposits.amount, date: goalDeposits.date }).from(goalDeposits).where(and(eq(goalDeposits.userId, ctx.userId), gte(goalDeposits.date, `${month}-01`))),
  ]);
  const { rows, monthPlan, plan } = budgetFor(ctx, bundle, limits, goalList, month);
  const months = Array.from({ length: 6 }, (_, i) => addMonthsToMonth(month, i - 5)).map((m) => {
    const txs = bundle.history.filter((t) => monthOf(t.date) === m);
    return {
      month: m,
      income: txs.filter((t) => t.category === "income").reduce((s, t) => s + t.amount, 0),
      spending: spendingByCategory(txs).reduce((s, c) => s + c.spent, 0),
    };
  });
  const progress = monthProgress(month, ctx.today);
  // A starting budget is offered for this month while some everyday spending has no limit yet.
  const room = plan.income - plan.bills - plan.saving;
  const suggested = progress.isCurrent ? suggestLimits(rows, room > 0 ? room : null) : null;
  const missing = suggested ? suggested.limits.filter((l) => !rows.some((r) => r.category === l.category && r.limit !== null)) : [];
  return {
    month,
    today: ctx.today,
    isCurrent: progress.isCurrent,
    daysLeft: progress.daysLeft,
    days: progress.days,
    rows,
    plan,
    totalSpent: rows.reduce((s, r) => s + Math.max(0, r.spent), 0),
    totalLimit: rows.reduce((s, r) => s + (r.limit ?? 0), 0),
    income: months[months.length - 1].income,
    months,
    monthPlan: progress.isCurrent ? monthPlan : null,
    suggestion: suggested && missing.length > 0 ? { limits: suggested.limits, trimmed: suggested.trimmed, room } : null,
    // Saving is part of the budget: the goals' monthly amounts are set aside first, and what's gone in this month.
    savings: { goals: goalList, putAside: deposits.filter((d) => monthOf(d.date) === month).reduce((s, d) => s + d.amount, 0) },
    paychecks: paychecksFor(bundle, month, ctx.today),
  };
}

/** A month's no-spend week as it stands today (for last month's, once it's over: how many days were clear). */
export async function noSpendWeekFor(ctx: Ctx, month: string) {
  const [bundle, limits, goalList] = await Promise.all([loadRecurring(ctx), loadLimits(ctx), listGoals(ctx)]);
  return noSpendWeek(month, ctx.today, budgetFor(ctx, bundle, limits, goalList, month).monthPlan.days);
}

/**
 * Last month's budgets, judged once it's over: which limits held. Only limits
 * that were set by the 8th of that month count, and only when the bank
 * reported enough of that month to judge it.
 */
export async function lastMonthBudgets(ctx: Ctx): Promise<{ month: string; kept: string[]; judged: number } | null> {
  const month = addMonthsToMonth(monthOf(ctx.today), -1);
  const cutoff = new Date(`${month}-08T00:00:00Z`);
  const eligible = (await loadLimits(ctx)).filter((l) => l.createdAt < cutoff);
  if (eligible.length === 0) return null;
  const bundle = await loadRecurring(ctx);
  const days = new Set(bundle.history.filter((t) => monthOf(t.date) === month).map((t) => t.date));
  if (days.size < 10) return null;
  const rows = categoryBudgets({ month, today: ctx.today, history: bundle.history, billIds: billIdsOf(bundle), limits: eligible });
  const judged = rows.filter((r) => r.limit !== null);
  return { month, kept: judged.filter((r) => (r.left ?? -1) >= 0).map((r) => r.category), judged: judged.length };
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

type GoalRow = typeof goals.$inferSelect;
type DepositRow = typeof goalDeposits.$inferSelect;

/** Deposits have been written down since this day. Goals older than that have no history to draw. */
const DEPOSITS_RECORDED_SINCE = "2026-11-22";

/**
 * Where a goal's plan line starts: the day it was made, in the person's time
 * zone. A goal made before deposits were recorded, with none since, starts
 * today instead: its saved amount built up with no record of when, and
 * drawing it all on the first day would wrongly show it as behind.
 */
const goalStart = (g: GoalRow, today: ISODate, deposits: DepositRow[] = []): ISODate => {
  const d = todayIn(DEFAULT_TIMEZONE, g.createdAt);
  if (d < DEPOSITS_RECORDED_SINCE && deposits.length === 0 && g.saved > 0) return today;
  return d > today ? today : d;
};

function planFor(g: GoalRow, deposits: DepositRow[], today: ISODate, paydays: ISODate[]) {
  return goalPlan({
    target: g.target,
    saved: g.saved,
    targetDate: g.targetDate,
    today,
    startDate: goalStart(g, today, deposits),
    deposits: deposits.map((d) => ({ date: d.date, amount: d.amount })),
    monthlyContribution: g.monthlyContribution,
    paydays,
  });
}

function goalView(g: GoalRow, plan: ReturnType<typeof goalPlan>, accountNames: Map<string, string> = new Map()): GoalView {
  const accountName = g.accountId ? accountNames.get(g.accountId) : undefined;
  return {
    id: g.id,
    account: g.accountId && accountName ? { id: g.accountId, name: accountName } : null,
    name: g.name,
    target: g.target,
    saved: g.saved,
    monthlyContribution: g.monthlyContribution,
    targetDate: g.targetDate,
    projectedDate: plan.projectedDate,
    status: plan.status,
    gap: plan.gap,
    daysLeft: plan.daysLeft,
    perMonth: plan.perMonth,
    perWeek: plan.perWeek,
    perPayday: plan.perPayday,
    nextPayday: plan.nextPayday,
    pace: plan.pace,
  };
}

/** Upcoming paydays from every regular income, merged, up to a horizon. */
function paydaysFrom(bundle: RecurringBundle, today: ISODate, until: ISODate): { dates: ISODate[]; frequency: string | null } {
  const incomes = bundle.series.filter((s) => s.kind === "income" && s.active);
  const dates = [...new Set(incomes.flatMap((s) => upcomingBetween(s, addDays(today, 1), until)))].sort();
  const main = [...incomes].sort((a, b) => b.monthly - a.monthly)[0];
  return { dates, frequency: main ? FREQUENCY_LABEL[main.frequency] : null };
}

async function listGoals(ctx: Ctx, paydays: ISODate[] = []): Promise<GoalView[]> {
  const [found, saved] = await Promise.all([
    ctx.db.select().from(goals).where(eq(goals.userId, ctx.userId)).orderBy(asc(goals.createdAt), asc(goals.id)),
    ctx.db.select().from(goalDeposits).where(eq(goalDeposits.userId, ctx.userId)),
  ]);
  const { rows, deposits, names } = await followAccounts(ctx, found, saved);
  return rows.map((g) => goalView(g, planFor(g, deposits.filter((d) => d.goalId === g.id), ctx.today, paydays), names));
}

/**
 * A goal that follows a real account (a SoFi vault) has that account's balance as what's saved, and the
 * money that moved in and out of the account since the goal began (round-ups, transfers) as its deposits,
 * so its track draws itself. Nothing has to be recorded by hand.
 */
async function followAccounts(ctx: Ctx, rows: GoalRow[], deposits: DepositRow[]): Promise<{ rows: GoalRow[]; deposits: DepositRow[]; names: Map<string, string> }> {
  const ids = [...new Set(rows.map((r) => r.accountId).filter((id): id is string => !!id))];
  if (ids.length === 0) return { rows, deposits, names: new Map() };
  const [found, moves] = await Promise.all([
    ctx.db.select({ id: accounts.id, name: accounts.name, balance: accounts.balance }).from(accounts).where(and(eq(accounts.userId, ctx.userId), inArray(accounts.id, ids))),
    ctx.db
      .select({ id: transactions.id, accountId: transactions.accountId, amount: transactions.amount, date: transactions.date, createdAt: transactions.createdAt })
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.userId), inArray(transactions.accountId, ids))),
  ]);
  const byId = new Map(found.map((a) => [a.id, a]));
  const following = new Set(rows.filter((r) => r.accountId && byId.has(r.accountId)).map((r) => r.id));
  const linked = rows.map((r) => (following.has(r.id) ? { ...r, saved: Math.max(0, byId.get(r.accountId!)!.balance) } : r));
  const moved = rows
    .filter((r) => following.has(r.id))
    .flatMap((r) => {
      const since = r.createdAt.toISOString().slice(0, 10);
      return moves.filter((m) => m.accountId === r.accountId && m.date >= since).map((m) => ({ id: m.id, userId: ctx.userId, goalId: r.id, amount: m.amount, date: m.date, createdAt: m.createdAt }));
    });
  return { rows: linked, deposits: [...deposits.filter((d) => !following.has(d.goalId)), ...moved], names: new Map(found.map((a) => [a.id, a.name])) };
}

/** Everything for one goal's own screen: the plan, the track so far, checkpoints, milestones, and ideas. */
export async function getGoal(ctx: Ctx, id: string): Promise<GoalDetailPayload> {
  const [found] = await ctx.db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, ctx.userId))).limit(1);
  if (!found) throw new HttpError(404, "That goal wasn’t found.");
  const [recorded, bundle, budget, overview] = await Promise.all([
    ctx.db.select().from(goalDeposits).where(and(eq(goalDeposits.userId, ctx.userId), eq(goalDeposits.goalId, found.id))),
    loadRecurring(ctx),
    getBudget(ctx, monthOf(ctx.today)),
    getOverview(ctx),
  ]);
  const followed = await followAccounts(ctx, [found], recorded);
  const g = followed.rows[0];
  const deposits = followed.deposits;
  // The same horizon as the goals list, so "each payday" matches on both screens.
  const pay = paydaysFrom(bundle, ctx.today, addMonths(ctx.today, 60));
  const plan = planFor(g, deposits, ctx.today, pay.dates);
  const need = plan.perMonth ?? (plan.status === "no_date" ? g.monthlyContribution : null);
  return {
    today: ctx.today,
    goal: goalView(g, plan, followed.names),
    startDate: goalStart(g, ctx.today, deposits),
    startSaved: plan.startSaved,
    history: plan.history,
    expectedNow: plan.expectedNow,
    checkpoints: plan.checkpoints,
    milestones: plan.milestones,
    deposits: deposits
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))
      .slice(0, 60)
      .map((d) => ({ id: d.id, date: d.date, amount: d.amount })),
    ideas: goalIdeas({
      need,
      categories: budget.rows.map((r) => ({ category: r.category, label: category(r.category).label, spent: r.spent, average: r.average })),
      monthProgress: dayOfMonth(ctx.today) / daysInMonth(Number(ctx.today.slice(0, 4)), Number(ctx.today.slice(5, 7))),
      leftToSpend: overview.plan.leftToSpend,
    }),
    payFrequency: pay.frequency,
  };
}

export async function getGoals(ctx: Ctx): Promise<GoalsPayload> {
  const bundle = await loadRecurring(ctx);
  const [goalList, accountList] = await Promise.all([listGoals(ctx, paydaysFrom(bundle, ctx.today, addMonths(ctx.today, 60)).dates), listAccounts(ctx)]);
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
    // Extra, since round-ups (spare change moved to savings) are left out of what Home lists.
    recentTransactions(ctx, 30),
    getSyncStatus(ctx),
    balanceSeries(ctx, addDays(ctx.today, -90)),
    balanceSeries(ctx, addDays(ctx.today, -90), (a) => a.type === "investment"),
    ctx.db.select({ total: sql<number>`coalesce(sum(coalesce(${holdings.costBasis}, ${holdings.value})), 0)::float8` }).from(holdings).where(eq(holdings.userId, ctx.userId)),
  ]);

  const { rows, monthPlan: plan, plan: budget } = budgetFor(ctx, bundle, limits, goalList, month);
  const due = upcomingBills(bundle, ctx.today, 30);
  // The no-spend week (the month's last seven days): this month's from a few days before, or last month's
  // for a week after it, with what was left over to put in savings.
  let noSpend: Overview["noSpend"] = null;
  const thisWeek = noSpendWeek(month, ctx.today, plan.days);
  if (thisWeek) noSpend = { ...thisWeek, leftover: plan.leftToSpend, goals: goalList };
  else if (dayOfMonth(ctx.today) <= 7) {
    const before = addMonthsToMonth(month, -1);
    const lastPlan = budgetFor(ctx, bundle, limits, goalList, before).monthPlan;
    const lastWeek = noSpendWeek(before, ctx.today, lastPlan.days);
    if (lastWeek) noSpend = { ...lastWeek, leftover: lastPlan.leftToSpend, goals: goalList };
  }
  const end = worth.series[worth.series.length - 1] ?? { assets: 0, debts: 0, net: 0 };

  // What needs a look, most urgent first.
  const attention: AttentionItem[] = [];
  if (sync.needsAttention > 0) {
    attention.push({ kind: "bank", title: sync.needsAttention === 1 ? "A bank needs you to sign in again" : `${sync.needsAttention} banks need you to sign in again`, detail: "Until then, new transactions from it won’t show up.", href: "/accounts" });
  }
  for (const bill of due.filter((b) => diffDays(b.date, ctx.today) <= 2)) {
    attention.push({ kind: "due", title: `${bill.name} is due ${formatDistance(bill.date, ctx.today)}`, detail: `${dollarsExact(-bill.amount)}${bill.share ? ", your part" : bill.estimated ? ", based on past bills" : ""}`, href: bill.kind === "card" ? "/debt" : `/bills?open=${encodeURIComponent(bill.key)}` });
  }
  for (const s of bundle.series) {
    if (s.active && s.priceChange && s.priceChange.to < s.priceChange.from) {
      attention.push({ kind: "price", title: `${s.name} raised its price`, detail: `${dollarsExact(-s.priceChange.from)} to ${dollarsExact(-s.priceChange.to)}, ${dollars((s.priceChange.from - s.priceChange.to) * 12)} more a year`, href: `/bills?open=${encodeURIComponent(s.key)}` });
    }
  }
  for (const s of bundle.series) {
    if (s.renewsSoon) {
      attention.push({ kind: "renewal", title: `${s.name} renews ${formatDistance(s.nextDate, ctx.today)}`, detail: `${dollarsExact(-s.amount)}, ${s.frequency === "yearly" ? "once a year" : s.frequency === "semiannual" ? "every 6 months" : "every 3 months"}. Cancel before then if you don’t want it.`, href: `/bills?open=${encodeURIComponent(s.key)}` });
    }
  }
  for (const p of bundle.possible) {
    attention.push({ kind: "new", title: `${p.name} looks like a new subscription`, detail: `${dollarsExact(-p.amount)} on ${formatShort(p.date)}`, href: `/bills?possible=${encodeURIComponent(p.key)}` });
  }
  for (const row of rows) {
    const name = category(row.category).label;
    if (row.status === "over" && row.left !== null) {
      attention.push({ kind: "budget", title: `${name} is over budget`, detail: `${dollars(-row.left)} over, with ${dollars(row.spent)} spent`, href: `/budget?category=${row.category}` });
    } else if (row.status === "watch" && row.limit !== null) {
      attention.push({ kind: "pace", title: `${name} is on pace to go over`, detail: `${dollars(row.left ?? 0)} left, heading for about ${dollars(row.forecast)} of ${dollars(row.limit + row.carried)}`, href: `/budget?category=${row.category}` });
    }
  }

  return {
    today: ctx.today,
    attention,
    noSpend,
    firstName: ctx.user.name.split(" ")[0],
    plan,
    netWorth: { net: end.net, assets: end.assets, debts: end.debts, change: changeOver(worth.series, 30), series: worth.series },
    recent: recent.filter((t) => !t.roundUp).slice(0, 7),
    upcoming: due.slice(0, 5),
    upcomingTotal: due.reduce((s, b) => s - b.amount, 0),
    budget: {
      rows: rows.filter((r) => r.limit !== null),
      totalSpent: budget.budgetedSpent,
      totalLimit: budget.budgeted + budget.carried,
      // The same "left in your budgets" as the budget screen.
      left: rows.reduce((s, r) => s + (r.left ?? 0), 0),
      unplanned: budget.unplanned,
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

  // For cards: have the payments over the last 90 days kept up with the spending, with no interest
  // charged? And how fast is the balance actually going down? Paying back rent or the month's spending
  // isn't paying down debt, so only what's paid beyond new charges counts (`recentMonthlyPaydown`).
  const cardIds = owed.filter((a) => a.type === "credit").map((a) => a.id);
  const cardFlow = new Map<string, { paid: number; spent: number; interest: boolean }>();
  const cardPaid = new Map<string, number>();
  if (cardIds.length > 0) {
    const rows = await ctx.db
      .select({ accountId: transactions.accountId, date: transactions.date, amount: transactions.amount, category: transactions.category })
      .from(transactions)
      // From the 1st of the month three months back, so each whole month has its charges and its payments.
      .where(and(eq(transactions.userId, ctx.userId), inArray(transactions.accountId, cardIds), gte(transactions.date, `${addMonthsToMonth(monthOf(ctx.today), -3)}-01`)));
    const since = addDays(ctx.today, -90);
    for (const r of rows) {
      if (r.date < since) continue;
      const f = cardFlow.get(r.accountId) ?? { paid: 0, spent: 0, interest: false };
      if (r.amount > 0) f.paid += r.amount;
      else f.spent -= r.amount;
      if (r.amount < 0 && r.category === "fees") f.interest = true;
      cardFlow.set(r.accountId, f);
    }
    for (const id of cardIds) {
      const paid = recentMonthlyPaydown(rows.filter((r) => r.accountId === id), monthOf(ctx.today));
      if (paid) cardPaid.set(id, paid);
    }
  }

  const views: DebtView[] = owed.map((a) => {
    const own = planFor.get(a.id);
    // A loan's regular payment usually shows up as a repeating charge named after it.
    const series = bundle.series.find((s) => s.active && s.kind !== "income" && s.category === "loans" && `${s.bankName} ${s.name}`.toLowerCase().includes(a.name.toLowerCase()));
    const paidLately = cardPaid.get(a.id) ?? null;
    const payment = own?.monthlyPayment ?? (series ? Math.abs(monthlyEquivalent(series)) : (paidLately ?? a.minimumPayment));
    const flow = cardFlow.get(a.id);
    const paidInFull = a.type === "credit" && own?.monthlyPayment == null && !!flow && flow.spent > 0 && !flow.interest && flow.paid >= flow.spent * 0.85;
    // Bills put on a card this month (rent, say) are part of its balance until they're paid back.
    // (The whole charge went on the card, even when only part of a shared bill is the person's.)
    const billsOnCard = a.type === "credit" ? bundle.series.filter((s) => s.kind === "bill" && s.accountId === a.id).map((s) => ({ name: s.name, amount: Math.round(s.history.filter((h) => h.amount < 0 && monthOf(h.date) === monthOf(ctx.today)).reduce((t, h) => t - h.amount, 0) / (s.share ?? 1)) })).filter((b) => b.amount > 0) : [];
    return {
      id: a.id,
      name: a.name,
      institutionName: a.institutionName,
      type: a.type,
      balance: -a.balance,
      aprPercent: own?.aprPercent ?? a.aprPercent,
      payment,
      paymentSource: own?.monthlyPayment != null ? "yours" : series || paidLately ? "history" : a.minimumPayment != null ? "bank" : null,
      paidInFull,
      notShrinking: a.type === "credit" && !paidInFull && own?.monthlyPayment == null && !paidLately && !!flow && flow.paid > 0,
      billsThisMonth: billsOnCard.length > 0 ? { total: billsOnCard.reduce((t, b) => t + b.amount, 0), names: billsOnCard.map((b) => b.name) } : null,
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
    costs: await feesAndInterest(ctx),
    totalOwed: views.reduce((s, d) => s + d.balance, 0),
    extra,
    strategy,
    debts: views.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || b.balance - a.balance),
    base: slim(base),
    plan: slim(plan),
    needsDetails: views.filter((d) => !d.paidInFull && d.order === null).length,
  };
}

/**
 * What interest and fees have cost: this month, the last 90 days and this year, by account, with the
 * latest few. Interest is told apart from fees by its name; a fee or interest refunded takes it down.
 */
export async function feesAndInterest(ctx: Ctx): Promise<CostsView> {
  const yearStart = `${ctx.today.slice(0, 4)}-01-01`;
  const rows = await ctx.db
    .select({ name: transactions.name, rawName: transactions.rawName, date: transactions.date, amount: transactions.amount, account: accounts.name })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.userId, ctx.userId), eq(transactions.category, "fees"), gte(transactions.date, yearStart)))
    .orderBy(desc(transactions.date));
  const isInterest = (r: (typeof rows)[number]) => /interest/i.test(`${r.name} ${r.rawName ?? ""}`);
  const sum = (list: typeof rows) => list.reduce((s, r) => s - r.amount, 0);
  const month = monthOf(ctx.today);
  const since90 = addDays(ctx.today, -90);
  const byAccount = new Map<string, { name: string; interest: number; fees: number }>();
  for (const r of rows) {
    const a = byAccount.get(r.account) ?? { name: r.account, interest: 0, fees: 0 };
    if (isInterest(r)) a.interest -= r.amount;
    else a.fees -= r.amount;
    byAccount.set(r.account, a);
  }
  return {
    thisMonth: sum(rows.filter((r) => monthOf(r.date) === month)),
    last90: sum(rows.filter((r) => r.date >= since90)),
    thisYear: sum(rows),
    interestYear: sum(rows.filter(isInterest)),
    feesYear: sum(rows.filter((r) => !isInterest(r))),
    byAccount: [...byAccount.values()].filter((a) => a.interest + a.fees > 0).sort((a, b) => b.interest + b.fees - (a.interest + a.fees)),
    latest: rows.filter((r) => r.amount < 0).slice(0, 6).map((r) => ({ name: r.name, account: r.account, date: r.date, amount: -r.amount, kind: isInterest(r) ? "interest" : "fee" })),
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

  const [rows, bundle, worth, savings, nameFor] = await Promise.all([
    ctx.db
      .select({ id: transactions.id, date: transactions.date, name: transactions.name, amount: transactions.amount, category: transactions.category, accountId: transactions.accountId, customName: transactions.customName })
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, beforeFrom), lte(transactions.date, to))),
    loadRecurring(ctx),
    balanceSeries(ctx, addDays(from, -1)),
    listAccounts(ctx),
    loadNamer(ctx),
  ]);
  const real = rows.filter((t) => t.category !== "transfer");
  const week = real.filter((t) => t.date >= from);
  const before = real.filter((t) => t.date < from);
  const spending = (list: typeof real) => spendingByCategory(list).reduce((s, c) => s + c.spent, 0);
  const out = week.filter((t) => t.amount < 0 && t.category !== "income");
  const biggest = [...out].sort((a, b) => a.amount - b.amount)[0];
  // Bills are necessities; Extras (Netflix) are everyday spending, so they count against a no-spend day.
  const billIds = billIdsOf(bundle);
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
    biggest: biggest ? { name: nameFor(biggest).name, amount: biggest.amount, date: biggest.date } : null,
    billsPaid: { count: bills.length, total: bills.reduce((s, t) => s - t.amount, 0) },
    savedToGoals: rows.filter((t) => t.date >= from && savingsIds.has(t.accountId)).reduce((s, t) => s + t.amount, 0),
    netWorthChange: start && end ? end.net - start.net : null,
  };
}
