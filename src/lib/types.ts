import type { ISODate } from "./dates";
import type { MonthPlan } from "./finance/plan";
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
export type AttentionItem = { kind: "bank" | "due" | "price" | "budget" | "renewal" | "new"; title: string; detail: string; href: string };

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
  budget: { rows: BudgetRow[]; totalSpent: number; totalLimit: number };
  goals: GoalView[];
  investments: { total: number; change: number; costBasis: number; series: { date: ISODate; value: number }[] };
  sync: SyncStatus;
};

export type SyncStatus = { lastSyncedAt: string | null; linkedInstitutions: number; needsAttention: number };

export type BudgetRow = { category: string; spent: number; limit: number | null; lastMonth: number; average: number };

export type BudgetPayload = {
  month: string;
  today: ISODate;
  rows: BudgetRow[];
  totalSpent: number;
  totalLimit: number;
  income: number;
  /** Money in vs money out for recent months, oldest first. */
  months: { month: string; income: number; spending: number }[];
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
