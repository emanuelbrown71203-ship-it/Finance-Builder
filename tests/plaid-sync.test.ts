import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { accounts, balanceSnapshots, holdings, items, transactions, users } from "@/db/schema";
import type { Ctx } from "@/server/auth";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { updateTransaction } from "@/server/mutations";
import { refreshItem, syncAllForUser, syncItem, type PlaidLike } from "@/server/plaid";
import { getNetWorth, getOverview } from "@/server/queries";

/**
 * Drives the bank sync with a stand-in for Plaid that returns responses in
 * Plaid's documented shapes, so the mapping into our tables is covered
 * without network access or credentials.
 */

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const USER = "sync-user";
const ITEM = "sync-item";
const now = new Date("2026-11-19T15:00:00Z");

type Page = { added?: object[]; modified?: object[]; removed?: { transaction_id: string }[]; next_cursor: string; has_more?: boolean };

function fakePlaid(script: { pages: Page[]; cardBalance: number; failWith?: string; refreshFails?: string }) {
  const calls = { cursors: [] as (string | undefined)[], refreshes: [] as string[] };
  const reply = <T,>(data: T) => Promise.resolve({ data }) as never;
  const client: PlaidLike = {
    accountsGet: () =>
      script.failWith
        ? (Promise.reject({ response: { data: { error_code: script.failWith, error_message: "the login details of this item have changed" } } }) as never)
        : reply({
            accounts: [
              { account_id: "p-checking", name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", balances: { current: 1500.25, available: 1400, limit: null, iso_currency_code: "USD" } },
              { account_id: "p-card", name: "Plaid Credit Card", mask: "3333", type: "credit", subtype: "credit card", balances: { current: script.cardBalance, available: null, limit: 5000, iso_currency_code: "USD" } },
              { account_id: "p-ira", name: "Plaid IRA", mask: "5555", type: "investment", subtype: "ira", balances: { current: 12000, available: null, limit: null, iso_currency_code: "USD" } },
            ],
          }),
    transactionsSync: (request: { cursor?: string }) => {
      calls.cursors.push(request.cursor);
      const page = script.pages.shift()!;
      return reply({ added: page.added ?? [], modified: page.modified ?? [], removed: page.removed ?? [], next_cursor: page.next_cursor, has_more: page.has_more ?? false });
    },
    investmentsHoldingsGet: () =>
      reply({
        accounts: [{ account_id: "p-ira" }],
        holdings: [{ account_id: "p-ira", security_id: "sec-1", quantity: 40, institution_price: 300, institution_value: 12000, cost_basis: 9000 }],
        securities: [{ security_id: "sec-1", ticker_symbol: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf" }],
      }),
    transactionsRefresh: (request: { access_token: string }) => {
      calls.refreshes.push(request.access_token);
      return script.refreshFails ? (Promise.reject({ response: { data: { error_code: script.refreshFails, error_message: "not enabled" } } }) as never) : reply({ request_id: "r1" });
    },
    liabilitiesGet: () =>
      reply({ liabilities: { credit: [{ account_id: "p-card", next_payment_due_date: "2026-12-05", minimum_payment_amount: 25, aprs: [{ apr_type: "purchase_apr", apr_percentage: 19.99 }] }], student: null, mortgage: null } }),
  } as unknown as PlaidLike;
  return { client, calls };
}

const tx = (id: string, account: string, date: string, name: string, amount: number, primary: string, detailed: string, extra: object = {}) => ({
  transaction_id: id,
  account_id: account,
  date,
  name: name.toUpperCase(),
  merchant_name: name,
  amount,
  pending: false,
  pending_transaction_id: null,
  personal_finance_category: { primary, detailed },
  ...extra,
});

let db: DB;
let ctx: Ctx;

beforeAll(async () => {
  db = await getDb();
  await db.delete(users).where(eq(users.id, USER));
  await db.insert(users).values({ id: USER, email: "sync@example.com", name: "Riley" });
  await db.insert(items).values({ id: ITEM, userId: USER, plaidItemId: "plaid-item-1", institutionName: "First Platypus Bank", accessTokenEnc: encryptSecret("access-sandbox-123", `bank:${USER}`) });
  ctx = { db, userId: USER, user: { id: USER, name: "Riley", email: "sync@example.com" }, today: "2026-11-19", demo: false };
});

describe("bank sync", () => {
  it("stores the access token encrypted", async () => {
    const [item] = await db.select().from(items).where(eq(items.id, ITEM));
    expect(item.accessTokenEnc).not.toContain("access-sandbox-123");
    expect(decryptSecret(item.accessTokenEnc!, `bank:${USER}`)).toBe("access-sandbox-123");
  });

  it("first sync imports accounts, transactions, holdings and liabilities", async () => {
    const { client, calls } = fakePlaid({
      cardBalance: 410.5,
      pages: [
        {
          has_more: true,
          next_cursor: "c1",
          added: [
            tx("t-pay", "p-checking", "2026-11-13", "Acme Payroll", -2500, "INCOME", "INCOME_WAGES"),
            tx("t-rent", "p-checking", "2026-11-01", "Oak Street Apartments", 1800, "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"),
          ],
        },
        {
          next_cursor: "c2",
          added: [
            tx("t-groc", "p-card", "2026-11-17", "Safeway", 82.4, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
            tx("t-coffee-pending", "p-card", "2026-11-18", "Blue Bottle Coffee", 6.5, "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", { pending: true }),
            tx("t-cardpay", "p-checking", "2026-11-10", "Credit Card Payment", 300, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
            // A card payment that bounced, which the bank files as a loan payment, and the fee for it.
            tx("t-returned", "p-card", "2026-11-12", "Returned Mobile ACH Payment - CONA", 300, "LOAN_PAYMENTS", "LOAN_PAYMENTS_OTHER_PAYMENT"),
            tx("t-returned-fee", "p-card", "2026-11-12", "Returned Payment Fee", 30, "BANK_FEES", "BANK_FEES_OTHER_BANK_FEES"),
          ],
        },
      ],
    });
    await syncItem(db, ITEM, client, now);

    expect(calls.cursors).toEqual([undefined, "c1"]);
    const [item] = await db.select().from(items).where(eq(items.id, ITEM));
    expect(item).toMatchObject({ cursor: "c2", status: "ok", error: null });

    const accts = await db.select().from(accounts).where(eq(accounts.itemId, ITEM));
    const byName = Object.fromEntries(accts.map((a) => [a.name, a]));
    expect(byName["Plaid Checking"]).toMatchObject({ type: "depository", balance: 150025, available: 140000, institutionName: "First Platypus Bank" });
    // Debt is stored negative, with the due date and APR from Liabilities.
    expect(byName["Plaid Credit Card"]).toMatchObject({ type: "credit", balance: -41050, creditLimit: 500000, nextPaymentDueDate: "2026-12-05", minimumPayment: 2500, aprPercent: 19.99 });
    expect(byName["Plaid IRA"]).toMatchObject({ type: "investment", balance: 1200000 });

    const txs = await db.select().from(transactions).where(eq(transactions.userId, USER));
    const byId = Object.fromEntries(txs.map((t) => [t.plaidTransactionId, t]));
    // Plaid's sign is flipped: money out arrives positive and is stored negative.
    expect(byId["t-pay"]).toMatchObject({ amount: 250000, category: "income", name: "Acme Payroll", rawName: "ACME PAYROLL" });
    expect(byId["t-rent"]).toMatchObject({ amount: -180000, category: "housing" });
    expect(byId["t-groc"]).toMatchObject({ amount: -8240, category: "groceries" });
    expect(byId["t-coffee-pending"]).toMatchObject({ amount: -650, category: "dining", pending: true });
    expect(byId["t-cardpay"]).toMatchObject({ category: "transfer" });
    expect(byId["t-returned"]).toMatchObject({ amount: -30000, category: "transfer" });
    expect(byId["t-returned-fee"]).toMatchObject({ amount: -3000, category: "fees" });

    const held = await db.select().from(holdings).where(eq(holdings.userId, USER));
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ symbol: "VTI", assetClass: "funds", quantity: 40, price: 30000, value: 1200000, costBasis: 900000 });
  });

  it("rebuilds past cash balances from transactions so charts have history", async () => {
    const checking = (await db.select().from(accounts).where(eq(accounts.plaidAccountId, "p-checking")))[0];
    const snaps = await db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, checking.id));
    const on = (date: string) => snaps.find((s) => s.date === date)?.balance;
    expect(on("2026-11-19")).toBe(150025);
    // Before the Nov 13 paycheck the balance was $2,500 lower; before the Nov 10 card payment, $300 higher than that.
    expect(on("2026-11-12")).toBe(150025 - 250000);
    expect(on("2026-11-09")).toBe(150025 - 250000 + 30000);
    expect(on("2026-11-01")).toBe(150025 - 250000 + 30000);

    const worth = await getNetWorth(ctx, "1m");
    expect(worth.net).toBe(150025 - 41050 + 1200000);
    expect(worth.series.at(-1)).toMatchObject({ date: "2026-11-19", net: worth.net });
    expect((await getOverview(ctx)).sync).toMatchObject({ linkedInstitutions: 1, needsAttention: 0 });
  });

  it("a later sync applies posted, modified and removed transactions without losing the owner's edits", async () => {
    const pending = (await db.select().from(transactions).where(eq(transactions.plaidTransactionId, "t-coffee-pending")))[0];
    await updateTransaction(ctx, pending.id, { category: "entertainment", note: "Client meeting", name: "Coffee with Dana" });

    const { client, calls } = fakePlaid({
      cardBalance: 325.0,
      pages: [
        {
          next_cursor: "c3",
          // The pending coffee posts under a new id at a slightly different amount…
          added: [tx("t-coffee-posted", "p-card", "2026-11-18", "Blue Bottle Coffee", 7.25, "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", { pending_transaction_id: "t-coffee-pending" })],
          // …the grocery charge is corrected, and the rent entry is withdrawn by the bank.
          modified: [tx("t-groc", "p-card", "2026-11-17", "Safeway", 80.0, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")],
          removed: [{ transaction_id: "t-coffee-pending" }, { transaction_id: "t-rent" }],
        },
      ],
    });
    await syncItem(db, ITEM, client, new Date("2026-11-19T18:00:00Z"));
    expect(calls.cursors).toEqual(["c2"]);

    const txs = await db.select().from(transactions).where(eq(transactions.userId, USER));
    const byId = Object.fromEntries(txs.map((t) => [t.plaidTransactionId, t]));
    expect(txs).toHaveLength(6);
    expect(byId["t-rent"]).toBeUndefined();
    expect(byId["t-coffee-pending"]).toBeUndefined();
    // Same row as the pending charge: the owner's category and note survive.
    expect(byId["t-coffee-posted"]).toMatchObject({ id: pending.id, amount: -725, pending: false, category: "entertainment", note: "Client meeting", customName: "Coffee with Dana" });
    expect(byId["t-groc"]).toMatchObject({ amount: -8000 });
    const card = (await db.select().from(accounts).where(eq(accounts.plaidAccountId, "p-card")))[0];
    expect(card.balance).toBe(-32500);
  });

  it("pull to refresh asks the bank to check now, at most every five minutes, and never fails the refresh", async () => {
    await db.update(items).set({ refreshedAt: null }).where(eq(items.id, ITEM));
    const t0 = new Date("2026-11-19T19:00:00Z");
    const { client, calls } = fakePlaid({ cardBalance: 325, pages: [{ next_cursor: "c3" }, { next_cursor: "c3" }, { next_cursor: "c3" }] });
    expect(await refreshItem(db, ITEM, client, t0)).toBe(true);
    expect(calls.refreshes).toEqual(["access-sandbox-123"]);
    // Again a minute later: not asked again.
    expect(await refreshItem(db, ITEM, client, new Date(t0.getTime() + 60_000))).toBe(false);
    expect(calls.refreshes).toHaveLength(1);
    // Five minutes on, it can be.
    expect(await refreshItem(db, ITEM, client, new Date(t0.getTime() + 5 * 60_000))).toBe(true);
    // A bank or plan without on-demand checks: the refresh carries on with what Plaid has.
    await db.update(items).set({ refreshedAt: null }).where(eq(items.id, ITEM));
    const off = fakePlaid({ cardBalance: 325, pages: [{ next_cursor: "c3" }], refreshFails: "PRODUCTS_NOT_SUPPORTED" });
    expect(await syncAllForUser(db, USER, { refresh: true, client: off.client })).toEqual({ refreshing: false });
    expect(off.calls.refreshes).toHaveLength(1);
    expect(off.calls.cursors).toEqual(["c3"]);
    // The follow-up look a little later doesn't ask the bank again.
    await db.update(items).set({ refreshedAt: null }).where(eq(items.id, ITEM));
    const later = fakePlaid({ cardBalance: 325, pages: [{ next_cursor: "c3" }] });
    expect(await syncAllForUser(db, USER, { refresh: false, client: later.client })).toEqual({ refreshing: false });
    expect(later.calls.refreshes).toHaveLength(0);
  });

  it("flags the connection when the bank asks for a new sign-in", async () => {
    const { client } = fakePlaid({ cardBalance: 0, pages: [], failWith: "ITEM_LOGIN_REQUIRED" });
    await syncItem(db, ITEM, client, now);
    const [item] = await db.select().from(items).where(eq(items.id, ITEM));
    expect(item.status).toBe("needs_reauth");
    expect(item.cursor).toBe("c3");
    expect((await getOverview(ctx)).sync.needsAttention).toBe(1);
  });
});

describe("on-demand checks", () => {
  it("never asks a bank that needs a new sign-in", async () => {
    const { client, calls } = fakePlaid({ cardBalance: 0, pages: [] });
    await db.update(items).set({ refreshedAt: null }).where(eq(items.id, ITEM));
    expect(await refreshItem(db, ITEM, client, new Date("2026-11-19T20:00:00Z"))).toBe(false);
    expect(calls.refreshes).toHaveLength(0);
  });
});
