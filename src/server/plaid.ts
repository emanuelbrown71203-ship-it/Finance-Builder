import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products, type AccountBase, type Transaction as PlaidTransaction } from "plaid/legacy";
import type { DB } from "@/db";
import { accounts, balanceSnapshots, holdings, items, transactions } from "@/db/schema";
import { categoryFromPlaid } from "@/lib/categories";
import { APP_NAME, DEFAULT_TIMEZONE, plaidConfig } from "@/lib/config";
import { addDays, todayIn, type ISODate } from "@/lib/dates";
import { merchantKey } from "@/lib/finance/recurring";
import { decryptSecret, encryptSecret, sha256 } from "./crypto";
import { loadRules } from "./rules";

/**
 * Bank connections through Plaid.
 *
 * Flow: the browser opens Plaid Link with a link token → the person signs in
 * to their bank → we exchange the public token for an access token (stored
 * encrypted) → we sync. After that Plaid calls our webhook whenever the bank
 * has something new and we sync again.
 */

export type PlaidLike = Pick<PlaidApi, "accountsGet" | "transactionsSync" | "investmentsHoldingsGet" | "liabilitiesGet">;

let cached: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
  const config = plaidConfig();
  if (!config) throw new Error("Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.");
  cached ??= new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.env],
      baseOptions: { headers: { "PLAID-CLIENT-ID": config.clientId, "PLAID-SECRET": config.secret } },
    }),
  );
  return cached;
}

/** Plaid’s error body, without the request config (which holds our secret). */
function plaidError(error: unknown): { error_code?: string; error_message?: string } {
  const data = (error as { response?: { data?: { error_code?: string; error_message?: string } } })?.response?.data;
  return data ?? { error_message: error instanceof Error ? error.message : String(error) };
}

export async function createLinkToken(db: DB, userId: string, itemId?: string): Promise<string> {
  const config = plaidConfig()!;
  const base = {
    user: { client_user_id: userId },
    client_name: APP_NAME,
    language: "en",
    country_codes: [CountryCode.Us],
    webhook: config.webhookUrl,
    redirect_uri: config.redirectUri,
  };

  if (itemId) {
    // Update mode: the bank needs the person to sign in again.
    const [item] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.userId, userId))).limit(1);
    if (!item?.accessTokenEnc) throw new Error("That connection can’t be repaired. Remove it and link again.");
    const response = await plaidClient().linkTokenCreate({ ...base, access_token: decryptSecret(item.accessTokenEnc) });
    return response.data.link_token;
  }

  const response = await plaidClient().linkTokenCreate({
    ...base,
    products: [Products.Transactions],
    // Pulled in when the bank offers them, without blocking banks that don’t.
    required_if_supported_products: [Products.Investments, Products.Liabilities],
    transactions: { days_requested: 730 },
  });
  return response.data.link_token;
}

export async function exchangePublicToken(db: DB, userId: string, publicToken: string, institution: { id?: string | null; name?: string | null }): Promise<string> {
  const exchange = await plaidClient().itemPublicTokenExchange({ public_token: publicToken });
  const id = crypto.randomUUID();
  await db.insert(items).values({
    id,
    userId,
    plaidItemId: exchange.data.item_id,
    institutionId: institution.id ?? null,
    institutionName: institution.name || "Linked account",
    accessTokenEnc: encryptSecret(exchange.data.access_token),
  });
  return id;
}

export async function removeItem(db: DB, userId: string, itemId: string): Promise<void> {
  const [item] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.userId, userId))).limit(1);
  if (!item) return;
  if (item.accessTokenEnc && plaidConfig()) {
    try {
      await plaidClient().itemRemove({ access_token: decryptSecret(item.accessTokenEnc) });
    } catch (error) {
      console.error("Plaid itemRemove failed", plaidError(error));
    }
  }
  await db.delete(items).where(eq(items.id, item.id));
}

/* ---------- sync ---------- */

const toCents = (amount: number | null | undefined): number | null => (amount === null || amount === undefined ? null : Math.round(amount * 100));

function ourAccountType(a: AccountBase): string {
  const t = String(a.type);
  if (t === "credit" || t === "loan" || t === "depository") return t;
  if (t === "investment" || t === "brokerage") return "investment";
  return "depository";
}

function assetClassFor(securityType: string | null | undefined): string {
  switch (securityType) {
    case "equity":
      return "stocks";
    case "etf":
    case "mutual fund":
      return "funds";
    case "fixed income":
      return "bonds";
    case "cash":
      return "cash";
    case "cryptocurrency":
      return "crypto";
    default:
      return "other";
  }
}

export async function syncItem(db: DB, itemId: string, client: PlaidLike = plaidClient(), now: Date = new Date()): Promise<void> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item?.accessTokenEnc) return;
  const accessToken = decryptSecret(item.accessTokenEnc);
  const today = todayIn(DEFAULT_TIMEZONE, now);
  const firstSync = item.cursor === null;

  try {
    const accountMap = await syncAccounts(db, item, accessToken, client);
    const cursor = await syncTransactions(db, item, accessToken, accountMap, client, now);
    const accountRows = await db.select().from(accounts).where(eq(accounts.itemId, item.id));
    if (accountRows.some((a) => a.type === "investment")) await syncHoldings(db, item.userId, accessToken, accountMap, client);
    if (accountRows.some((a) => a.type === "credit" || a.type === "loan")) await syncLiabilities(db, accessToken, client);
    await snapshotBalances(db, item.userId, today);
    if (firstSync) await backfillSnapshots(db, item.userId, accountRows, today);
    await db.update(items).set({ cursor, status: "ok", error: null, lastSyncedAt: now }).where(eq(items.id, item.id));
  } catch (error) {
    const e = plaidError(error);
    const needsReauth = e.error_code === "ITEM_LOGIN_REQUIRED" || e.error_code === "PENDING_EXPIRATION";
    await db
      .update(items)
      .set({ status: needsReauth ? "needs_reauth" : "error", error: e.error_message ?? "Sync failed." })
      .where(eq(items.id, item.id));
    if (!e.error_code) throw error;
    console.error("Plaid sync failed", e);
  }
}

export async function syncAllForUser(db: DB, userId: string): Promise<void> {
  const rows = await db.select({ id: items.id }).from(items).where(eq(items.userId, userId));
  for (const row of rows) await syncItem(db, row.id);
}

/** Upserts the item’s accounts and returns plaid_account_id → our account id. */
async function syncAccounts(db: DB, item: typeof items.$inferSelect, accessToken: string, client: PlaidLike): Promise<Map<string, string>> {
  const response = await client.accountsGet({ access_token: accessToken });
  const existing = await db.select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId }).from(accounts).where(eq(accounts.itemId, item.id));
  const map = new Map(existing.map((a) => [a.plaidAccountId!, a.id]));

  for (const a of response.data.accounts) {
    const type = ourAccountType(a);
    const owed = type === "credit" || type === "loan";
    const current = toCents(a.balances.current) ?? 0;
    const values = {
      name: a.name,
      institutionName: item.institutionName,
      mask: a.mask ?? null,
      type,
      subtype: a.subtype ? String(a.subtype) : null,
      // Debts count against net worth, so they’re stored negative.
      balance: owed ? -current : current,
      available: toCents(a.balances.available),
      creditLimit: toCents(a.balances.limit),
      currency: a.balances.iso_currency_code ?? "USD",
    };
    const id = map.get(a.account_id);
    if (id) {
      await db.update(accounts).set(values).where(eq(accounts.id, id));
    } else {
      const newId = crypto.randomUUID();
      await db.insert(accounts).values({ id: newId, userId: item.userId, itemId: item.id, plaidAccountId: a.account_id, ...values });
      map.set(a.account_id, newId);
    }
  }
  return map;
}

function txValues(t: PlaidTransaction) {
  return {
    date: t.date,
    name: t.merchant_name || t.name,
    rawName: t.name,
    // Plaid reports money out as positive; we store money out as negative.
    amount: -Math.round(t.amount * 100),
    pending: t.pending,
  };
}

async function syncTransactions(db: DB, item: typeof items.$inferSelect, accessToken: string, accountMap: Map<string, string>, client: PlaidLike, now: Date): Promise<string | null> {
  const startCursor = item.cursor ?? undefined;
  let added: PlaidTransaction[] = [];
  let modified: PlaidTransaction[] = [];
  let removed: string[] = [];
  let cursor = startCursor;

  // Collect every page before writing: if the data changes mid-pagination
  // Plaid asks us to restart from the cursor we began with.
  for (let attempt = 0; ; attempt++) {
    try {
      added = [];
      modified = [];
      removed = [];
      cursor = startCursor;
      for (let hasMore = true; hasMore; ) {
        const page = await client.transactionsSync({ access_token: accessToken, cursor, count: 500 });
        added.push(...page.data.added);
        modified.push(...page.data.modified);
        removed.push(...page.data.removed.map((r) => r.transaction_id));
        cursor = page.data.next_cursor;
        hasMore = page.data.has_more;
      }
      break;
    } catch (error) {
      if (plaidError(error).error_code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 3) continue;
      throw error;
    }
  }

  const incoming = [...added, ...modified];
  const lookupIds = [...new Set(incoming.flatMap((t) => [t.transaction_id, ...(t.pending_transaction_id ? [t.pending_transaction_id] : [])]))];
  const existing = new Map<string, { id: string; categoryLocked: boolean }>();
  for (let i = 0; i < lookupIds.length; i += 500) {
    const rows = await db
      .select({ id: transactions.id, plaidId: transactions.plaidTransactionId, categoryLocked: transactions.categoryLocked })
      .from(transactions)
      .where(inArray(transactions.plaidTransactionId, lookupIds.slice(i, i + 500)));
    for (const r of rows) existing.set(r.plaidId!, { id: r.id, categoryLocked: r.categoryLocked });
  }

  // Merchants the owner has given a fixed category beat the bank's guess.
  const rules = await loadRules(db, item.userId);
  const inserts: (typeof transactions.$inferInsert)[] = [];
  // Rows whose Plaid id we’ve taken over, so the matching "removed" entry doesn’t delete them.
  const adopted = new Set<string>();
  for (const t of incoming) {
    const accountId = accountMap.get(t.account_id);
    if (!accountId) continue;
    const category = rules.get(merchantKey(t.merchant_name || t.name)) ?? categoryFromPlaid(t.personal_finance_category?.primary, t.personal_finance_category?.detailed);
    // When a pending charge posts, Plaid sends a new transaction that points at
    // the pending one. Updating that row keeps the person’s category and note.
    const match = existing.get(t.transaction_id) ?? (t.pending_transaction_id ? existing.get(t.pending_transaction_id) : undefined);
    if (match) {
      if (t.pending_transaction_id) adopted.add(t.pending_transaction_id);
      await db
        .update(transactions)
        .set({ ...txValues(t), accountId, plaidTransactionId: t.transaction_id, ...(match.categoryLocked ? {} : { category }) })
        .where(eq(transactions.id, match.id));
    } else {
      inserts.push({ id: crypto.randomUUID(), userId: item.userId, accountId, plaidTransactionId: t.transaction_id, category, createdAt: now, ...txValues(t) });
      existing.set(t.transaction_id, { id: inserts[inserts.length - 1].id, categoryLocked: false });
    }
  }
  for (let i = 0; i < inserts.length; i += 400) await db.insert(transactions).values(inserts.slice(i, i + 400)).onConflictDoNothing();

  const toRemove = removed.filter((id) => !adopted.has(id));
  for (let i = 0; i < toRemove.length; i += 500) {
    await db.delete(transactions).where(and(eq(transactions.userId, item.userId), inArray(transactions.plaidTransactionId, toRemove.slice(i, i + 500))));
  }
  return cursor ?? null;
}

async function syncHoldings(db: DB, userId: string, accessToken: string, accountMap: Map<string, string>, client: PlaidLike): Promise<void> {
  let data;
  try {
    data = (await client.investmentsHoldingsGet({ access_token: accessToken })).data;
  } catch (error) {
    // Not every institution or Plaid plan supports investments; cash data still syncs.
    const code = plaidError(error).error_code;
    if (code && code !== "ITEM_LOGIN_REQUIRED") return;
    throw error;
  }
  const securities = new Map(data.securities.map((s) => [s.security_id, s]));
  const rows: (typeof holdings.$inferInsert)[] = [];
  for (const h of data.holdings) {
    const accountId = accountMap.get(h.account_id);
    if (!accountId) continue;
    const security = securities.get(h.security_id);
    rows.push({
      id: crypto.randomUUID(),
      userId,
      accountId,
      symbol: security?.ticker_symbol ?? null,
      name: security?.name ?? "Unnamed holding",
      assetClass: assetClassFor(security?.type),
      quantity: h.quantity,
      price: toCents(h.institution_price) ?? 0,
      value: toCents(h.institution_value) ?? 0,
      costBasis: toCents(h.cost_basis),
    });
  }
  const accountIds = [...new Set(data.accounts.map((a) => accountMap.get(a.account_id)).filter((id): id is string => Boolean(id)))];
  if (accountIds.length === 0) return;
  await db.delete(holdings).where(inArray(holdings.accountId, accountIds));
  for (let i = 0; i < rows.length; i += 400) await db.insert(holdings).values(rows.slice(i, i + 400));
}

async function syncLiabilities(db: DB, accessToken: string, client: PlaidLike): Promise<void> {
  let liabilities;
  try {
    liabilities = (await client.liabilitiesGet({ access_token: accessToken })).data.liabilities;
  } catch (error) {
    const code = plaidError(error).error_code;
    if (code && code !== "ITEM_LOGIN_REQUIRED") return;
    throw error;
  }
  const updates: { plaidAccountId: string | null; due: string | null; minimum: number | null; apr: number | null }[] = [
    ...(liabilities.credit ?? []).map((c) => ({
      plaidAccountId: c.account_id,
      due: c.next_payment_due_date,
      minimum: toCents(c.minimum_payment_amount),
      apr: c.aprs.find((a) => String(a.apr_type) === "purchase_apr")?.apr_percentage ?? c.aprs[0]?.apr_percentage ?? null,
    })),
    ...(liabilities.student ?? []).map((s) => ({ plaidAccountId: s.account_id, due: s.next_payment_due_date, minimum: toCents(s.minimum_payment_amount), apr: s.interest_rate_percentage })),
    ...(liabilities.mortgage ?? []).map((m) => ({ plaidAccountId: m.account_id, due: m.next_payment_due_date, minimum: toCents(m.next_monthly_payment), apr: m.interest_rate.percentage })),
  ];
  for (const u of updates) {
    if (!u.plaidAccountId) continue;
    await db.update(accounts).set({ nextPaymentDueDate: u.due, minimumPayment: u.minimum, aprPercent: u.apr }).where(eq(accounts.plaidAccountId, u.plaidAccountId));
  }
}

/** Records today’s balance for every account the person has. */
export async function snapshotBalances(db: DB, userId: string, today: ISODate): Promise<void> {
  const rows = await db.select({ id: accounts.id, balance: accounts.balance }).from(accounts).where(eq(accounts.userId, userId));
  if (rows.length === 0) return;
  await db
    .insert(balanceSnapshots)
    .values(rows.map((a) => ({ userId, accountId: a.id, date: today, balance: a.balance })))
    .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.date], set: { balance: sql`excluded.balance` } });
}

/**
 * Rebuilds past daily balances for newly linked accounts so charts don’t
 * start from nothing. Cash and card balances are walked backwards through
 * their transactions (accurate). Investments and loans have no transaction
 * trail here, so they’re held at today’s value (an estimate).
 */
async function backfillSnapshots(db: DB, userId: string, accountRows: (typeof accounts.$inferSelect)[], today: ISODate): Promise<void> {
  const rows: (typeof balanceSnapshots.$inferInsert)[] = [];
  let earliest = today;
  for (const account of accountRows) {
    if (account.type !== "depository" && account.type !== "credit") continue;
    const daily = await db
      .select({ date: transactions.date, total: sql<number>`sum(${transactions.amount})::float8` })
      .from(transactions)
      .where(and(eq(transactions.accountId, account.id), eq(transactions.pending, false)))
      .groupBy(transactions.date);
    const byDate = new Map(daily.map((d) => [d.date, Number(d.total)]));
    const first = daily.reduce((min, d) => (d.date < min ? d.date : min), today);
    if (first < earliest) earliest = first;
    let balance = account.balance;
    for (let date = today; date > first; ) {
      // Yesterday’s closing balance is today’s minus everything that happened today.
      balance -= byDate.get(date) ?? 0;
      date = addDays(date, -1);
      rows.push({ userId, accountId: account.id, date, balance });
    }
  }
  for (const account of accountRows) {
    if (account.type === "depository" || account.type === "credit" || earliest === today) continue;
    rows.push({ userId, accountId: account.id, date: earliest, balance: account.balance });
  }
  for (let i = 0; i < rows.length; i += 800) await db.insert(balanceSnapshots).values(rows.slice(i, i + 800)).onConflictDoNothing();
}

/* ---------- webhooks ---------- */

const keyCache = new Map<string, JWK>();

/**
 * Confirms a webhook really came from Plaid.
 * https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export async function verifyWebhook(rawBody: string, signedJwt: string | null): Promise<boolean> {
  if (!signedJwt) return false;
  try {
    const header = decodeProtectedHeader(signedJwt);
    if (header.alg !== "ES256" || !header.kid) return false;
    let jwk = keyCache.get(header.kid);
    if (!jwk) {
      const response = await plaidClient().webhookVerificationKeyGet({ key_id: header.kid });
      jwk = response.data.key as unknown as JWK;
      keyCache.set(header.kid, jwk);
    }
    const { payload } = await jwtVerify(signedJwt, await importJWK(jwk, "ES256"), { algorithms: ["ES256"], maxTokenAge: "5 min" });
    const claimed = Buffer.from(String(payload.request_body_sha256 ?? ""), "hex");
    const actual = Buffer.from(sha256(rawBody), "hex");
    return claimed.length === actual.length && timingSafeEqual(claimed, actual);
  } catch {
    return false;
  }
}

export async function handleWebhook(db: DB, body: { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_message?: string } | null }): Promise<void> {
  if (!body.item_id) return;
  const [item] = await db.select({ id: items.id }).from(items).where(eq(items.plaidItemId, body.item_id)).limit(1);
  if (!item) return;

  const code = body.webhook_code ?? "";
  if (body.webhook_type === "ITEM") {
    if (code === "ERROR" || code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT") {
      await db.update(items).set({ status: "needs_reauth", error: body.error?.error_message ?? "Your bank needs you to sign in again." }).where(eq(items.id, item.id));
    } else if (code === "LOGIN_REPAIRED") {
      await syncItem(db, item.id);
    }
    return;
  }
  // TRANSACTIONS: SYNC_UPDATES_AVAILABLE, HOLDINGS / LIABILITIES: DEFAULT_UPDATE.
  if (["TRANSACTIONS", "HOLDINGS", "INVESTMENTS_TRANSACTIONS", "LIABILITIES"].includes(body.webhook_type ?? "")) {
    await syncItem(db, item.id);
  }
}
