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

export type User = typeof users.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type RecurringOverride = typeof recurringOverrides.$inferSelect;
