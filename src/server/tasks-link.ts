import { and, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { billLinks, billTicks, taskLinks, transactions } from "@/db/schema";
import { DEFAULT_TIMEZONE, isDemoMode, plaidConfig, tasksHost } from "@/lib/config";
import { addDays, todayIn } from "@/lib/dates";
import { isTasksLink, matchPayments, suggestLinks, unpaidDueDates, type TasksBill } from "@/lib/finance/billmatch";
import { merchantKey } from "@/lib/finance/recurring";
import type { Ctx } from "./auth";
import { decryptSecret, encryptSecret } from "./crypto";
import { loadNamer } from "./names";
import { HttpError } from "./http";

/*
 * The link to Tasks for Two. When the bank shows a bill was paid, the same
 * bill is ticked off there, through the connector Tasks for Two already has.
 *
 * It only runs on real bank data. With sample data, or Plaid's practice
 * banks, it is off completely: made-up transactions must never tick a real
 * bill. And it only ever talks to the one Tasks for Two server this site was
 * set up with.
 */

type Fetch = typeof fetch;

/** The most Tasks for Two could reasonably answer with. Anything bigger is not read. */
const MAX_REPLY = 200_000;

const Bills = z.object({
  bills: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().max(200),
        amount: z.number().finite(),
        next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        this_month: z.array(z.string().max(80)).max(62).nullish(),
        archived: z.boolean().nullish(),
      }),
    )
    .max(300),
});

/** How long a sent tick is given to finish before it may be sent again. */
const RETRY_AFTER_MS = 2 * 60_000;

/** Whose secret the stored link is, for the encryption. */
const linkOwner = (userId: string) => `tasks:${userId}`;

/** Thrown when it is unclear whether Tasks for Two acted: no answer, a timeout, a server error. */
class Unsure extends HttpError {}

/** Reads a reply up to a size limit, then stops. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPLY) {
      await reader.cancel().catch(() => {});
      throw new Unsure(502, "Tasks for Two sent back more than expected. Try again in a minute.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Calls one of Tasks for Two's connector tools and returns the text it answered with. */
async function callTasks(url: string, tool: string, args: object, fetchImpl: Fetch = fetch): Promise<string> {
  const host = tasksHost();
  if (!host) throw new HttpError(400, "The Tasks for Two link isn’t set up on this site yet.");
  if (!isTasksLink(url, host)) throw new HttpError(400, "That doesn’t look like your Tasks for Two connector link.");
  let response: Response;
  try {
    response = await fetchImpl(new URL(url.trim()).href, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new Unsure(502, "Tasks for Two didn’t answer. Try again in a minute.");
  }
  if (response.status === 404) throw new HttpError(400, "Tasks for Two says that link was switched off. Make a new one there and paste it here.");
  if (!response.ok) throw new Unsure(502, "Tasks for Two didn’t answer. Try again in a minute.");
  let body: { result?: { content?: { text?: unknown }[]; isError?: boolean }; error?: { message?: unknown } };
  try {
    body = JSON.parse(await readCapped(response));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new Unsure(502, "Tasks for Two sent back something unexpected. Try again in a minute.");
  }
  const text = typeof body?.result?.content?.[0]?.text === "string" ? (body.result.content[0].text as string) : "";
  if (body?.error || body?.result?.isError) {
    const said = (typeof body.error?.message === "string" ? body.error.message : text).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
    throw new HttpError(502, `Tasks for Two said: ${said}`);
  }
  return text;
}

async function listBills(url: string, fetchImpl: Fetch): Promise<TasksBill[]> {
  const text = await callTasks(url, "list_bills", {}, fetchImpl);
  let parsed: z.infer<typeof Bills>;
  try {
    parsed = Bills.parse(JSON.parse(text));
  } catch {
    throw new HttpError(502, "Tasks for Two sent back something unexpected. Try again in a minute.");
  }
  return parsed.bills.map((b) => ({ id: b.id, name: b.name, amount: b.amount, next_due: b.next_due ?? undefined, this_month: b.this_month ?? undefined, archived: b.archived ?? undefined }));
}

/** Real banks only: not sample data, and not Plaid's practice banks either. */
export function tasksLinkAllowed(): boolean {
  return !isDemoMode() && plaidConfig()?.env === "production";
}

function assertLive() {
  if (!tasksLinkAllowed()) throw new HttpError(400, "This switches on once your real bank is linked. Sample and practice data never touch your real bills.");
}

async function linkUrl(db: DB, userId: string): Promise<string | null> {
  const [row] = await db.select().from(taskLinks).where(eq(taskLinks.userId, userId)).limit(1);
  return row ? decryptSecret(row.urlEnc, linkOwner(userId)) : null;
}

export async function connectTasks(ctx: Ctx, url: string, fetchImpl: Fetch = fetch) {
  assertLive();
  if (!isTasksLink(url, tasksHost())) throw new HttpError(400, "That doesn’t look like your Tasks for Two connector link.");
  const clean = new URL(url.trim()).href;
  // Proves the link works before saving it.
  await listBills(clean, fetchImpl);
  const urlEnc = encryptSecret(clean, linkOwner(ctx.userId));
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
  const empty: TasksLinkStatus = { available: tasksLinkAllowed(), connected: false, lastCheckedAt: null, lastMessage: null, bills: [], merchants: [], recent: [] };
  if (ctx.demo || !empty.available) return empty;
  const [row] = await ctx.db.select().from(taskLinks).where(eq(taskLinks.userId, ctx.userId)).limit(1);
  if (!row) return empty;
  const [links, ticks, found, nameFor] = await Promise.all([
    ctx.db.select().from(billLinks).where(eq(billLinks.userId, ctx.userId)),
    ctx.db.select().from(billTicks).where(eq(billTicks.userId, ctx.userId)),
    merchantsFor(ctx.db, ctx.userId, ctx.today),
    loadNamer(ctx),
  ]);
  // Shown by the names the owner gave them; still keyed by the bank's text.
  const merchants = found.map((m) => ({ ...m, name: nameFor(m).name })).sort((a, b) => a.name.localeCompare(b.name));
  const linkMap = new Map(links.map((l) => [l.tasksBillId, l.merchantKey]));
  let bills: TasksBill[] = [];
  let message = row.lastMessage;
  try {
    bills = (await listBills(decryptSecret(row.urlEnc, linkOwner(ctx.userId)), fetchImpl)).filter((b) => !b.archived);
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
      .filter((t) => t.confirmed)
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
    .values({ id: crypto.randomUUID(), userId: ctx.userId, tasksBillId: bill.id, tasksBillName: bill.name.slice(0, 200), merchantKey: merchant })
    .onConflictDoUpdate({ target: [billLinks.userId, billLinks.tasksBillId], set: { merchantKey: merchant, tasksBillName: bill.name } });
}

/**
 * Looks for linked bills the bank shows as paid and ticks them off in Tasks
 * for Two. Safe to run as often as you like: every tick is written down
 * first, so the same payment can never tick a bill twice.
 */
export async function checkBills(db: DB, userId: string, fetchImpl: Fetch = fetch, now: Date = new Date()): Promise<{ ticked: number; message: string }> {
  if (!tasksLinkAllowed()) return { ticked: 0, message: "Off until a real bank is linked." };
  const url = await linkUrl(db, userId);
  if (!url) return { ticked: 0, message: "Not connected." };
  const today = todayIn(DEFAULT_TIMEZONE, now);
  const finish = async (ticked: number, message: string) => {
    await db.update(taskLinks).set({ lastCheckedAt: now, lastMessage: message.slice(0, 300) }).where(eq(taskLinks.userId, userId));
    return { ticked, message };
  };

  let bills: TasksBill[];
  try {
    bills = await listBills(url, fetchImpl);
  } catch (e) {
    return finish(0, e instanceof HttpError ? e.message : "Couldn’t reach Tasks for Two.");
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

  let ticked = 0;
  const problems: string[] = [];

  /**
   * Sends one tick. The note of it is already in the database. Afterwards:
   * confirmed if Tasks for Two took it (or says it was paid already), removed
   * if Tasks for Two clearly refused it, and left "unconfirmed" if we can't
   * tell (no answer, a timeout). An unconfirmed tick still holds its payment,
   * so that payment can never slide onto the next due date, and it is checked
   * again on the next run.
   */
  const sendTick = async (tick: { id: string; billId: string; billName: string; dueDate: string; amount: number }) => {
    const confirm = () => db.update(billTicks).set({ confirmed: true }).where(and(eq(billTicks.id, tick.id), eq(billTicks.userId, userId)));
    try {
      await callTasks(url, "pay_bills", { payments: [{ id: tick.billId, due_date: tick.dueDate, amount: tick.amount / 100 }] }, fetchImpl);
      await confirm();
      ticked++;
    } catch (e) {
      // Someone ticked it by hand already: that's fine, and our note stops us trying again.
      if (e instanceof HttpError && !(e instanceof Unsure) && e.message.includes("already paid")) return void (await confirm());
      if (!(e instanceof Unsure)) await db.delete(billTicks).where(and(eq(billTicks.id, tick.id), eq(billTicks.userId, userId)));
      problems.push(tick.billName);
    }
  };

  // First, ticks from an earlier run that were never confirmed.
  const waiting: string[] = [];
  for (const t of ticks.filter((row) => !row.confirmed)) {
    const bill = bills.find((b) => b.id === t.tasksBillId);
    if (bill && !bill.archived && unpaidDueDates(bill).includes(t.dueDate)) {
      // Claimed in one statement, so two checks running at once (a bank sync and "Check now")
      // can't both send it. A tick sent in the last two minutes is left to finish.
      const claimed = await db
        .update(billTicks)
        .set({ attemptedAt: new Date() })
        .where(and(eq(billTicks.id, t.id), eq(billTicks.userId, userId), eq(billTicks.confirmed, false), or(isNull(billTicks.attemptedAt), lt(billTicks.attemptedAt, new Date(Date.now() - RETRY_AFTER_MS)))))
        .returning({ id: billTicks.id });
      if (claimed.length === 0) {
        // Another check has it. If that one has finished meanwhile, there is nothing left to wait for.
        const [now2] = await db.select({ confirmed: billTicks.confirmed }).from(billTicks).where(and(eq(billTicks.id, t.id), eq(billTicks.userId, userId))).limit(1);
        if (now2 && !now2.confirmed) waiting.push(t.tasksBillName);
        continue;
      }
      await sendTick({ id: t.id, billId: t.tasksBillId, billName: t.tasksBillName, dueDate: t.dueDate, amount: t.amount });
    } else {
      // Tasks for Two no longer shows it waiting, so it went through (or the bill is gone).
      await db.update(billTicks).set({ confirmed: true }).where(and(eq(billTicks.id, t.id), eq(billTicks.userId, userId)));
    }
  }

  const matches = matchPayments({
    bills,
    links: new Map(links.map((l) => [l.tasksBillId, l.merchantKey])),
    payments,
    usedTransactions: new Set(ticks.map((t) => t.transactionId)),
    ticked: new Set(ticks.map((t) => `${t.tasksBillId}|${t.dueDate}`)),
    history: ticks.map((t) => ({ billId: t.tasksBillId, dueDate: t.dueDate, paidOn: t.paidOn, amount: t.amount })),
    today,
  });

  for (const m of matches) {
    // Written down before the tick is sent, so a crash in between can't lead to a second tick later.
    const id = crypto.randomUUID();
    const inserted = await db
      .insert(billTicks)
      .values({ id, userId, tasksBillId: m.billId, tasksBillName: m.billName.slice(0, 200), dueDate: m.dueDate, transactionId: m.transactionId, amount: m.amount, paidOn: m.paidOn, confirmed: false, attemptedAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: billTicks.id });
    if (inserted.length === 0) continue;
    await sendTick({ id, billId: m.billId, billName: m.billName, dueDate: m.dueDate, amount: m.amount });
  }
  const message = problems.length > 0 ? `Couldn’t tick ${problems.join(", ").slice(0, 200)}. It will try again next time.` : waiting.length > 0 && ticked === 0 ? `Still waiting to hear back about ${waiting.join(", ").slice(0, 200)}. Check again in a couple of minutes.` : ticked > 0 ? `Ticked off ${ticked} ${ticked === 1 ? "bill" : "bills"}.` : "Nothing new to tick off.";
  return finish(ticked, message);
}
