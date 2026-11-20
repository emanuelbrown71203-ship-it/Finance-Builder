import { bigint, boolean, doublePrecision, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Conventions
 *  - Money is stored as integer cents.
 *  - Transaction amounts are signed from the owner’s point of view:
 *    positive = money in, negative = money out.
 *  - Calendar dates are 'YYYY-MM-DD' strings in the owner’s time zone.
 */

const cents = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Updated as the session is used. A session left idle too long stops working. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    /** When this person last proved who they are (password or passkey). Sensitive changes need it to be recent. */
    authAt: timestamp("auth_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** One linked institution login (a Plaid Item). */
export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    plaidItemId: text("plaid_item_id").unique(),
    institutionId: text("institution_id"),
    institutionName: text("institution_name").notNull(),
    /** AES-256-GCM encrypted Plaid access token. Null for sample data. */
    accessTokenEnc: text("access_token_enc"),
    cursor: text("cursor"),
    /** ok | needs_reauth | error */
    status: text("status").notNull().default("ok"),
    error: text("error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("items_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Null for accounts the owner tracks by hand (a car, a house). */
    itemId: text("item_id").references(() => items.id, { onDelete: "cascade" }),
    plaidAccountId: text("plaid_account_id").unique(),
    name: text("name").notNull(),
    institutionName: text("institution_name").notNull(),
    mask: text("mask"),
    /** depository | credit | loan | investment | property */
    type: text("type").notNull(),
    subtype: text("subtype"),
    /**
     * Signed contribution to net worth: positive for assets, negative for
     * debts (a $500 card balance is stored as -50000).
     */
    balance: cents("balance").notNull().default(0),
    available: cents("available"),
    creditLimit: cents("credit_limit"),
    /** From Plaid Liabilities, when the institution reports them. */
    nextPaymentDueDate: text("next_payment_due_date"),
    minimumPayment: cents("minimum_payment"),
    aprPercent: doublePrecision("apr_percent"),
    currency: text("currency").notNull().default("USD"),
    createdAt: createdAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    plaidTransactionId: text("plaid_transaction_id").unique(),
    date: text("date").notNull(),
    /** Display name: the merchant when known, else the bank’s description. */
    name: text("name").notNull(),
    /** The raw description from the bank statement. */
    rawName: text("raw_name"),
    amount: cents("amount").notNull(),
    category: text("category").notNull(),
    /** True once the owner picks a category, so syncs stop overwriting it. */
    categoryLocked: boolean("category_locked").notNull().default(false),
    pending: boolean("pending").notNull().default(false),
    note: text("note"),
    /** When this row first reached us. Drives the live feed ordering. */
    createdAt: createdAt(),
  },
  (t) => [
    index("tx_user_date_idx").on(t.userId, t.date),
    index("tx_user_created_idx").on(t.userId, t.createdAt),
    index("tx_account_idx").on(t.accountId),
  ],
);

/** Monthly spending limit for one category. */
export const budgets = pgTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    monthlyLimit: cents("monthly_limit").notNull(),
  },
  (t) => [uniqueIndex("budgets_user_category_idx").on(t.userId, t.category)],
);

export const goals = pgTable(
  "goals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    target: cents("target").notNull(),
    saved: cents("saved").notNull().default(0),
    monthlyContribution: cents("monthly_contribution").notNull().default(0),
    targetDate: text("target_date"),
    createdAt: createdAt(),
  },
  (t) => [index("goals_user_idx").on(t.userId)],
);

/**
 * What the owner has decided about a recurring charge. The charges themselves
 * are detected from transactions on every read; this table only stores
 * overrides, keyed by the detected series key.
 */
export const recurringOverrides = pgTable(
  "recurring_overrides",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    seriesKey: text("series_key").notNull(),
    /** bill | subscription | ignore */
    kind: text("kind"),
    /** True when the owner says they cancelled it. */
    cancelled: boolean("cancelled").notNull().default(false),
  },
  (t) => [uniqueIndex("recurring_user_series_idx").on(t.userId, t.seriesKey)],
);

export const holdings = pgTable(
  "holdings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    symbol: text("symbol"),
    name: text("name").notNull(),
    /** us_stocks | intl_stocks | bonds | cash | crypto | other */
    assetClass: text("asset_class").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    price: cents("price").notNull(),
    value: cents("value").notNull(),
    costBasis: cents("cost_basis"),
  },
  (t) => [index("holdings_user_idx").on(t.userId), index("holdings_account_idx").on(t.accountId)],
);

/** End-of-day balance per account. Net worth history is the sum by date. */
export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    balance: cents("balance").notNull(),
  },
  (t) => [uniqueIndex("snapshots_account_date_idx").on(t.accountId, t.date), index("snapshots_user_date_idx").on(t.userId, t.date)],
);

/** "Always put this merchant in this category": set when the owner recategorizes with "remember" on. */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The merchant, normalized the same way recurring charges are (see merchantKey). */
    merchantKey: text("merchant_key").notNull(),
    category: text("category").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_rules_user_merchant_idx").on(t.userId, t.merchantKey)],
);

/** Per-debt choices for the payoff plan, when the bank doesn't report them or the owner knows better. */
export const debtPlans = pgTable("debt_plans", {
  accountId: text("account_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  aprPercent: doublePrecision("apr_percent"),
  monthlyPayment: cents("monthly_payment"),
});

/** One row of personal choices per person. */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** Extra put toward debt each month, on top of the regular payments. */
  debtExtra: cents("debt_extra").notNull().default(0),
  /** avalanche (highest interest first) | snowball (smallest balance first) */
  debtStrategy: text("debt_strategy").notNull().default("avalanche"),
});

/** A passkey: Face ID, Touch ID or a security key registered for sign-in. Only the public half is stored. */
export const passkeys = pgTable(
  "passkeys",
  {
    /** The credential id, base64url. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports"),
    name: text("name").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

/** Short-lived one-time values for passkey sign-in and registration. */
export const authChallenges = pgTable("auth_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** The private link that lets Claude read this person's money. Only a hash of the key is stored. */
export const connectorTokens = pgTable("connector_tokens", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** The connection to Tasks for Two, so bills there can be ticked off when the bank shows them paid. */
export const taskLinks = pgTable("task_links", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** The Tasks for Two connector link, encrypted like a bank token. */
  urlEnc: text("url_enc").notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastMessage: text("last_message"),
  createdAt: createdAt(),
});

/** "This bill in Tasks for Two is this merchant at the bank", confirmed by the owner. */
export const billLinks = pgTable(
  "bill_links",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tasksBillId: text("tasks_bill_id").notNull(),
    tasksBillName: text("tasks_bill_name").notNull(),
    merchantKey: text("merchant_key").notNull(),
  },
  (t) => [uniqueIndex("bill_links_user_bill_idx").on(t.userId, t.tasksBillId)],
);

/** Every payment Passbook has ticked off in Tasks for Two, so none is ever ticked twice. */
export const billTicks = pgTable(
  "bill_ticks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tasksBillId: text("tasks_bill_id").notNull(),
    tasksBillName: text("tasks_bill_name").notNull(),
    dueDate: text("due_date").notNull(),
    transactionId: text("transaction_id").notNull(),
    amount: cents("amount").notNull(),
    /** The day the bank says the payment went out, so the same payment is recognised even if the bank is linked again. */
    paidOn: text("paid_on"),
    /** False from the moment the tick is written down until Tasks for Two confirms it. */
    confirmed: boolean("confirmed").notNull().default(true),
    /** When the tick was last sent. Stops two checks running at once from both sending the same one. */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bill_ticks_bill_due_idx").on(t.userId, t.tasksBillId, t.dueDate), uniqueIndex("bill_ticks_tx_idx").on(t.userId, t.transactionId)],
);

/** Counts attempts (sign-in, connector calls) in a time window. Shared by every server instance. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: bigint("count", { mode: "number" }).notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type RecurringOverride = typeof recurringOverrides.$inferSelect;
