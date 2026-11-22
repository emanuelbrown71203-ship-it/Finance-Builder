import type { NameSource } from "./finance/names";
import type { ISODate } from "./dates";
import type { MonthPlan } from "./finance/plan";
import type { CategoryBudget } from "./finance/budget";
import type { RecurringSeries } from "./finance/recurring";
import type { CancelHelp } from "./finance/subscriptions";

/** Shapes the API returns. Shared by route handlers and pages. */

export type Me = {
  user: { name: string; email: string };
  demo: boolean;
  today: ISODate;
  bankLinking: { available: boolean; sandbox: boolean };
};

export type TxView = {
  id: string;
  date: ISODate;
  name: string;
  rawName: string | null;
  amount: number;
  category: string;
  pending: boolean;
  note: string | null;
  accountId: string;
  accountName: string;
  accountMask: string | null;
  createdAt: string;
  /** What the bank calls it (the merchant when known). Renames never change this. */
  bankName: string;
  /** A name given to this one transaction only. */
  customName: string | null;
  /** Where `name` came from: a one-off name, a name rule, the automatic tidy-up, or the bank as is. */
  nameSource: NameSource;
  ruleId: string | null;
  /** True when that rule only covers this exact amount. */
  ruleExact: boolean;
};

export type AccountView = {
  id: string;
  itemId: string | null;
  name: string;
  institutionName: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance: number;
  available: number | null;
  creditLimit: number | null;
  nextPaymentDueDate: ISODate | null;
  minimumPayment: number | null;
  aprPercent: number | null;
};

export type GoalView = {
  id: string;
  name: string;
  target: number;
  saved: number;
  monthlyContribution: number;
  targetDate: ISODate | null;
  /** When the goal is reached at the current pace. Null if never. */
  projectedDate: ISODate | null;
  status: "reached" | "ahead" | "on_track" | "behind" | "overdue" | "no_date";
  /** Saved minus where the plan says you'd be today; positive is ahead. */
  gap: number | null;
  daysLeft: number | null;
  /** To reach it by its date from now. */
  perMonth: number | null;
  perWeek: number | null;
  perPayday: number | null;
  nextPayday: ISODate | null;
  /** What actually goes in a month, lately. */
  pace: number;
};

export type GoalDetailPayload = {
  today: ISODate;
  goal: GoalView;
  startDate: ISODate;
  startSaved: number;
  /** Saved over time, from the start to today. */
  history: { date: ISODate; amount: number }[];
  expectedNow: number | null;
  checkpoints: { date: ISODate; amount: number; met: boolean | null }[];
  milestones: { percent: 25 | 50 | 75 | 100; amount: number; reachedOn: ISODate | null; projected: ISODate | null }[];
  deposits: { id: string; date: ISODate; amount: number }[];
  ideas: { title: string; detail: string; href?: string }[];
  /** How often pay arrives, e.g. "Every 2 weeks", when there's regular income. */
  payFrequency: string | null;
};

export type RecurringView = RecurringSeries & {
  accountName: string;
  /** Cost per month, positive cents, whatever the schedule. */
  monthly: number;
  cancelled: boolean;
  /** Where to go to manage or cancel it. */
  help: CancelHelp;
  /** A yearly or quarterly charge coming within 30 days: easy to forget, worth a warning. */
  renewsSoon: boolean;
  /** It first charged within about the last three months. */
  startedRecently: boolean;
  /** What the bank calls it; `name` is what the owner sees. */
  bankName: string;
  /** The saved name rule giving it its name, if any. */
  ruleId: string | null;
  /** True when that rule only covers one exact amount. */
  ruleExact: boolean;
  /** The latest charge without a name of its own, for renaming the bill. */
  sampleId: string;
  /** Set for a bill added by hand (by the owner, Nickel or Claude) rather than found in the history. */
  manual: {
    id: string;
    addedBy: "you" | "nickel" | "claude";
    startDate: ISODate;
    /** The bank's own repeating charge for it, once found: from then on that one counts instead. */
    seenAtBank: string | null;
    /** When the bank showed this one paid ahead of its date. */
    paidOn: ISODate | null;
  } | null;
};

/** A charge from a known subscription service that hasn't repeated yet: probably a new sign-up or a trial that converted. */
export type PossibleSubscription = { name: string; amount: number; date: ISODate; help: CancelHelp };

export type UpcomingBill = {
  key: string;
  date: ISODate;
  name: string;
  amount: number;
  kind: "bill" | "subscription" | "card";
  /** True when the amount is an estimate from past charges. */
  estimated: boolean;
};

export type NetWorthPoint = { date: ISODate; assets: number; debts: number; net: number };

/** Something on Home that wants the person's attention, with where to go to deal with it. */
export type AttentionItem = { kind: "bank" | "due" | "price" | "budget" | "pace" | "renewal" | "new"; title: string; detail: string; href: string };

export type Overview = {
  today: ISODate;
  attention: AttentionItem[];
  firstName: string;
  plan: MonthPlan;
  netWorth: { net: number; assets: number; debts: number; change: number; series: NetWorthPoint[] };
  recent: TxView[];
  upcoming: UpcomingBill[];
  /** Everything due in the next 30 days, not just the few listed. */
  upcomingTotal: number;
  /** Categories with a limit (ones needing a look first); everyday spent in them; what's available in them; what's left; money with no job yet. */
  budget: { rows: BudgetRow[]; totalSpent: number; totalLimit: number; left: number; unplanned: number };
  goals: GoalView[];
  investments: { total: number; change: number; costBasis: number; series: { date: ISODate; value: number }[] };
  sync: SyncStatus;
};

export type SyncStatus = { lastSyncedAt: string | null; linkedInstitutions: number; needsAttention: number };

export type BudgetRow = CategoryBudget;

export type BudgetPlanView = {
  income: number;
  bills: number;
  saving: number;
  /** This month's everyday budgets. */
  budgeted: number;
  /** Carried into them from earlier months with rollover (negative when overspent). */
  carried: number;
  /** Positive: money with no job yet. Negative: the plan asks for more than comes in. */
  unplanned: number;
  budgetedSpent: number;
  unbudgetedSpent: number;
  everydaySpent: number;
  /** The same number as Home's "left to spend". */
  leftToSpend: number;
};

export type BudgetPayload = {
  month: string;
  today: ISODate;
  isCurrent: boolean;
  /** Days left in the month, today included, and days in it. */
  daysLeft: number;
  days: number;
  /** Over and on-pace-to-go-over first, then the rest with limits, then spending with no limit. */
  rows: BudgetRow[];
  plan: BudgetPlanView;
  /** Everyday spending this month, and the limits added up. */
  totalSpent: number;
  totalLimit: number;
  income: number;
  /** Money in vs money out (bills included) for recent months, oldest first. */
  months: { month: string; income: number; spending: number }[];
  /** This month only: day by day, for the pace chart. */
  monthPlan: MonthPlan | null;
  /** This month only, while some everyday spending has no limit: a starting budget from what's usually spent. */
  suggestion: { limits: { category: string; limit: number }[]; trimmed: boolean; room: number } | null;
};

export type TransactionsPayload = {
  today: ISODate;
  transactions: TxView[];
  total: number;
  hasMore: boolean;
  accounts: { id: string; name: string; mask: string | null }[];
};

export type RecurringPayload = {
  today: ISODate;
  series: RecurringView[];
  upcoming: UpcomingBill[];
  monthlyBills: number;
  monthlySubscriptions: number;
  possible: PossibleSubscription[];
};

export type DebtView = {
  id: string;
  name: string;
  institutionName: string;
  type: string;
  balance: number;
  aprPercent: number | null;
  payment: number | null;
  /** Where the payment figure came from, so the screen can say so. */
  paymentSource: "yours" | "bank" | "history" | null;
  /** A card that is paid off as it goes isn't costing interest, so it is left out of the plan. */
  paidInFull: boolean;
  paidOffMonth: string | null;
  interest: number;
  /** Position in the order extra money is aimed (1 = first). Null when not in the plan. */
  order: number | null;
};

export type DebtPayload = {
  today: ISODate;
  totalOwed: number;
  extra: number;
  strategy: "avalanche" | "snowball";
  debts: DebtView[];
  /** At the regular payments only. */
  base: { months: number | null; debtFreeMonth: string | null; totalInterest: number; balances: number[] };
  /** With the extra each month. */
  plan: { months: number | null; debtFreeMonth: string | null; totalInterest: number; balances: number[] };
  /** Debts left out because the interest rate or payment isn't known yet. */
  needsDetails: number;
};

export type RecapPayload = {
  /** Monday to Sunday of the week being looked back on. */
  from: ISODate;
  to: ISODate;
  spent: number;
  spentBefore: number;
  income: number;
  count: number;
  noSpendDays: number;
  topCategories: { category: string; spent: number }[];
  biggest: { name: string; amount: number; date: ISODate } | null;
  billsPaid: { count: number; total: number };
  savedToGoals: number;
  netWorthChange: number | null;
};

export type NetWorthPayload = {
  today: ISODate;
  net: number;
  assets: number;
  debts: number;
  change: number;
  series: NetWorthPoint[];
  accounts: AccountView[];
};

export type LinkedInstitution = {
  id: string;
  institutionName: string;
  status: string;
  error: string | null;
  lastSyncedAt: string | null;
  accounts: AccountView[];
};

export type AccountsPayload = {
  institutions: LinkedInstitution[];
  manual: AccountView[];
  /** Apple Card, brought in from its statements (Apple doesn't let websites link it). Null until the first one. */
  appleCard: { accountId: string; owed: number; transactions: number; lastDate: ISODate | null } | null;
};

/** What an Apple Card statement holds, before it's brought in. */
export type AppleCardPreview = {
  from: ISODate;
  to: ISODate;
  total: number;
  /** Not brought in before. */
  fresh: number;
  already: number;
  /** In the file but not cleared yet: they come in with a later statement. */
  pending: number;
  /** What Passbook has the card owing now (null before the first statement). */
  owedNow: number | null;
  /** A starting point for "what it owes now": the last balance plus new charges, less new payments. Null for the first statement. */
  suggestedOwed: number | null;
  /** Sample household: a made-up statement is used, never the person's file. */
  sample: boolean;
};

export type AppleCardImport = {
  added: number;
  skipped: number;
  from: ISODate;
  to: ISODate;
  /** When it was brought in: Undo finds exactly these rows by it. */
  batch: string;
  previousOwed: number | null;
  /** What this import set the card owing, so a stale Undo leaves a newer balance alone. */
  owed: number;
  /** Whether this import earned XP (only then does Undo take it back). */
  earned: boolean;
  accountId: string;
};

export type HoldingView = {
  id: string;
  accountId: string;
  accountName: string;
  symbol: string | null;
  name: string;
  assetClass: string;
  quantity: number;
  price: number;
  value: number;
  costBasis: number | null;
};

export type InvestmentsPayload = {
  today: ISODate;
  total: number;
  costBasis: number;
  change: number;
  series: { date: ISODate; value: number }[];
  accounts: AccountView[];
  holdings: HoldingView[];
  allocation: { assetClass: string; value: number }[];
};

export type GoalsPayload = {
  today: ISODate;
  goals: GoalView[];
  savingsBalance: number;
  savingsAccounts: AccountView[];
  /** Total moved into savings accounts each month, oldest first. */
  monthlySaved: { month: string; amount: number }[];
};

export const ASSET_CLASS_LABEL: Record<string, string> = {
  us_stocks: "US stocks",
  intl_stocks: "International stocks",
  bonds: "Bonds",
  cash: "Cash",
  crypto: "Crypto",
  other: "Other",
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  depository: "Cash",
  investment: "Investments",
  property: "Things you own",
  credit: "Credit cards",
  loan: "Loans",
};

/** A saved name: every charge the bank calls something (optionally at one amount) goes by this name. */
export type NameRuleView = { id: string; name: string; key: string; amount: number; bankNames: string[]; count: number; lastDate: ISODate | null };

/** Bank text that still looks like code, with a tidier name to offer. */
export type UnclearName = { key: string; bankName: string; suggestion: string; count: number; lastDate: ISODate; sampleId: string; amount: number; category: string };

export type NamesPayload = { rules: NameRuleView[]; unclear: UnclearName[] };

/** Something Nickel or Claude changed for the owner, with Undo. */
export type ActivityItem = { id: string; actor: "nickel" | "claude"; summary: string; createdAt: string; undone: boolean; canUndo: boolean };
