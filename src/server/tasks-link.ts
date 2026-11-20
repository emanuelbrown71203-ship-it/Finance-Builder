import { and, eq, gte, lt, ne } from "drizzle-orm";
import type { DB } from "@/db";
import { billLinks, billTicks, taskLinks, transactions } from "@/db/schema";
import { DEFAULT_TIMEZONE, isDemoMode } from "@/lib/config";
import { addDays, todayIn } from "@/lib/dates";
import { isTasksLink, matchPayments, suggestLinks, type TasksBill } from "@/lib/finance/billmatch";
import { merchantKey } from "@/lib/finance/recurring";
import type { Ctx } from "./auth";
import { decryptSecret, encryptSecret } from "./crypto";
import { HttpError } from "./http";

/*
 * The link to Tasks for Two. When the bank shows a bill was paid, the same
 * bill is ticked off there, through the connector Tasks for Two already has.
 *
 * It only runs on real bank data. In sample-data mode it is off completely:
 * made-up transactions must never tick a real bill.
 */

type Fetch = typeof fetch;

/** Calls one of Tasks for Two's connector tools and returns what it answered. */
async function callTasks<T>(url: string, tool: string, args: object, fetchImpl: Fetch = fetch): Promise<T> {
  if (!isTasksLink(url)) throw new HttpError(400, "That doesn’t look like a Tasks for Two connector link.");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (response.status === 404) throw new HttpError(400, "Tasks for Two says that link was switched off. Make a new one there and paste it here.");
  if (!response.ok) throw new HttpError(502, "Tasks for Two didn’t answer. Try again in a minute.");
  const body = (await response.json()) as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } };
  const text = body.result?.content?.[0]?.text ?? "";
  if (body.error || body.result?.isError) throw new HttpError(502, `Tasks for Two said: ${(body.error?.message ?? text).slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function assertLive() {
  if (isDemoMode()) throw new HttpError(400, "This switches on once your real bank is linked. Sample data never touches your real bills.");
}

async function linkUrl(db: DB, userId: string): Promise<string | null> {
  const [row] = await db.select().from(taskLinks).where(eq(taskLinks.userId, userId)).limit(1);
  return row ? decryptSecret(row.urlEnc) : null;
}

export async function connectTasks(ctx: Ctx, url: string, fetchImpl: Fetch = fetch) {
  assertLive();
  const clean = url.trim();
  // Proves the link works before saving it.
  await callTasks<{ bills: TasksBill[] }>(clean, "list_bills", {}, fetchImpl);
  const urlEnc = encryptSecret(clean);
  await ctx.db.insert(taskLinks).values({ userId: ctx.userId, urlEnc }).onConflictDoUpdate({ target: taskLinks.userId, set: { urlEnc, lastMessage: null } });
}

export async function disconnectTasks(ctx: Ctx) {
  await ctx.db.delete(taskLinks).where(eq(taskLinks.userId, ctx.userId));
  await ctx.db.delete(billLinks).where(eq(billLinks.userId, ctx.userId));
}

export type TasksLinkStatus = {
  available: boolean;
  connected: boolean;
  lastCheckedAt: string | null;
  lastMessage: string | null;
  bills: { id: string; name: string; amount: number; nextDue: string | null; merchant: string | null; suggested: string | null }[];
  /** Places money goes out to, to choose from. */
  merchants: { key: string; name: string }[];
  recent: { billName: string; dueDate: string; amount: number; at: string }[];
};

async function merchantsFor(db: DB, userId: string, today: string) {
  const rows = await db
    .select({ name: transactions.name, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), lt(transactions.amount, 0), ne(transactions.category, "transfer"), gte(transactions.date, addDays(today, -120))));
  const byKey = new Map<string, { key: string; name: string; amount: number; count: number }>();
  for (const r of rows) {
    const key = merchantKey(r.name);
    const m = byKey.get(key);
    if (m) m.count++;
    else if (key) byKey.set(key, { key, name: r.name, amount: r.amount, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTasksLink(ctx: Ctx, fetchImpl: Fetch = fetch): Promise<TasksLinkStatus> {
  const empty: TasksLinkStatus = { available: !ctx.demo, connected: false, lastCheckedAt: null, lastMessage: null, bills: [], merchants: [], recent: [] };
  if (ctx.demo) return empty;
  const [row] = await ctx.db.select().from(taskLinks).where(eq(taskLinks.userId, ctx.userId)).limit(1);
  if (!row) return empty;
  const [links, ticks, merchants] = await Promise.all([
    ctx.db.select().from(billLinks).where(eq(billLinks.userId, ctx.userId)),
    ctx.db.select().from(billTicks).where(eq(billTicks.userId, ctx.userId)),
    merchantsFor(ctx.db, ctx.userId, ctx.today),
  ]);
  const linkMap = new Map(links.map((l) => [l.tasksBillId, l.merchantKey]));
  let bills: TasksBill[] = [];
  let message = row.lastMessage;
  try {
    bills = (await callTasks<{ bills: TasksBill[] }>(decryptSecret(row.urlEnc), "list_bills", {}, fetchImpl)).bills.filter((b) => !b.archived);
  } catch (e) {
    message = e instanceof Error ? e.message : "Couldn’t reach Tasks for Two.";
  }
  const suggested = suggestLinks(bills, merchants, linkMap);
  return {
    available: true,
    connected: true,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastMessage: message,
    bills: bills.map((b) => ({ id: b.id, name: b.name, amount: Math.round(b.amount * 100), nextDue: b.next_due ?? null, merchant: linkMap.get(b.id) ?? null, suggested: suggested.get(b.id) ?? null })),
    merchants: merchants.map((m) => ({ key: m.key, name: m.name })),
    recent: ticks
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5)
      .map((t) => ({ billName: t.tasksBillName, dueDate: t.dueDate, amount: t.amount, at: t.createdAt.toISOString() })),
  };
}

export async function setBillLink(ctx: Ctx, bill: { id: string; name: string }, merchant: string | null) {
  assertLive();
  if (merchant === null) {
    await ctx.db.delete(billLinks).where(and(eq(billLinks.userId, ctx.userId), eq(billLinks.tasksBillId, bill.id)));
    return;
  }
  await ctx.db
    .insert(billLinks)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, tasksBillId: bill.id, tasksBillName: bill.name, merchantKey: merchant })
    .onConflictDoUpdate({ target: [billLinks.userId, billLinks.tasksBillId], set: { merchantKey: merchant, tasksBillName: bill.name } });
}

/**
 * Looks for linked bills the bank shows as paid and ticks them off in Tasks
 * for Two. Safe to run as often as you like: every tick is written down
 * first, so the same payment can never tick a bill twice.
 */
export async function checkBills(db: DB, userId: string, fetchImpl: Fetch = fetch, now: Date = new Date()): Promise<{ ticked: number; message: string }> {
  if (isDemoMode()) return { ticked: 0, message: "Off while showing sample data." };
  const url = await linkUrl(db, userId);
  if (!url) return { ticked: 0, message: "Not connected." };
  const today = todayIn(DEFAULT_TIMEZONE, now);
  const finish = async (ticked: number, message: string) => {
    await db.update(taskLinks).set({ lastCheckedAt: now, lastMessage: message }).where(eq(taskLinks.userId, userId));
    return { ticked, message };
  };

  let bills: TasksBill[];
  try {
    bills = (await callTasks<{ bills: TasksBill[] }>(url, "list_bills", {}, fetchImpl)).bills;
  } catch (e) {
    return finish(0, e instanceof Error ? e.message : "Couldn’t reach Tasks for Two.");
  }
  const [links, ticks, payments] = await Promise.all([
    db.select().from(billLinks).where(eq(billLinks.userId, userId)),
    db.select().from(billTicks).where(eq(billTicks.userId, userId)),
    db
      .select({ id: transactions.id, date: transactions.date, name: transactions.name, amount: transactions.amount })
      .from(transactions)
      // Pending charges can still change or vanish, so only settled ones count.
      .where(and(eq(transactions.userId, userId), lt(transactions.amount, 0), eq(transactions.pending, false), gte(transactions.date, addDays(today, -45)))),
  ]);
  const matches = matchPayments({
    bills,
    links: new Map(links.map((l) => [l.tasksBillId, l.merchantKey])),
    payments,
    usedTransactions: new Set(ticks.map((t) => t.transactionId)),
    ticked: new Set(ticks.map((t) => `${t.tasksBillId}|${t.dueDate}`)),
    today,
  });

  let ticked = 0;
  const problems: string[] = [];
  for (const m of matches) {
    // Written down before the tick is sent, so a crash in between can't lead to a second tick later.
    const id = crypto.randomUUID();
    const inserted = await db.insert(billTicks).values({ id, userId, tasksBillId: m.billId, tasksBillName: m.billName, dueDate: m.dueDate, transactionId: m.transactionId, amount: m.amount }).onConflictDoNothing().returning({ id: billTicks.id });
    if (inserted.length === 0) continue;
    try {
      await callTasks(url, "pay_bills", { payments: [{ id: m.billId, due_date: m.dueDate, amount: m.amount / 100 }] }, fetchImpl);
      ticked++;
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      // Someone ticked it by hand already: that's fine, and our note stops us trying again.
      if (text.includes("already paid")) continue;
      await db.delete(billTicks).where(eq(billTicks.id, id));
      problems.push(m.billName);
    }
  }
  const message = problems.length > 0 ? `Couldn’t tick ${problems.join(", ")}. It will try again next time.` : ticked > 0 ? `Ticked off ${ticked} ${ticked === 1 ? "bill" : "bills"}.` : "Nothing new to tick off.";
  return finish(ticked, message);
}
