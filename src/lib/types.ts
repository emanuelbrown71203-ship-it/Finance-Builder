import type { ISODate } from "./dates";
import type { MonthPlan } from "./finance/plan";
import type { RecurringSeries } from "./finance/recurring";

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
  /** When the goal is reached at the current monthly amount. Null if never. */
  projectedDate: ISODate | null;
};

export type RecurringView = RecurringSeries & {
  accountName: string;
  /** Cost per month, positive cents, whatever the schedule. */
  monthly: number;
  cancelled: boolean;
};

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
export type AttentionItem = { kind: "bank" | "due" | "price" | "budget"; title: string; detail: string; href: string };

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
