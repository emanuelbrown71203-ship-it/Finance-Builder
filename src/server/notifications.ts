import { and, asc, eq, isNull, lt } from "drizzle-orm";
import type { DB } from "@/db";
import { notificationsSent, pushSubscriptions, sessions, userSettings, users } from "@/db/schema";
import { DEFAULT_TIMEZONE, isDemoMode } from "@/lib/config";
import { addDays, monthOf, todayIn, weekday } from "@/lib/dates";
import { noSpendWeekOf } from "@/lib/finance/nospend";
import { TEST_NOTE, billPaidNote, lowBalanceNote, noSpendStartNote, reviewNote, type Note } from "@/lib/notifications";
import { IDLE_DAYS, type Ctx } from "./auth";
import { loadUserCategories } from "./categories";
import { withCategories } from "./category-scope";
import { decryptSecret, encryptSecret, sha256 } from "./crypto";
import { describeError, HttpError } from "./errors";
import { getRecap, leftThisMonth, notifyFacts, weekKey } from "./queries";
import { isPushEndpoint, isPushKeys, sendPush, type PushResult, type PushTarget } from "./webpush";

/*
 * Phone notifications. A device turns them on in Settings (the browser hands over a push address and keys,
 * kept here encrypted), then:
 *  - a bill the person follows is paid: after each bank sync (settled payments only);
 *  - checking is short for bills the bank pays in the next three days: after a sync, and each morning;
 *  - Monday morning: the weekly review is ready;
 *  - the first day of the no-spend week.
 * Each note goes out once (`notifications_sent`), only to the person's own devices, and only through the
 * browsers' push services. Nothing here can change anything at a bank.
 */

const owner = (userId: string) => `push:${userId}`;
/** Devices kept per person. Turning on one more drops the oldest. */
const MAX_DEVICES = 10;
/** Refusals in a row (other than "gone") before a device is dropped. */
const MAX_FAILURES = 20;

export type NotifySettings = { lowBalance: boolean; weeklyReview: boolean; noSpend: boolean; amounts: boolean };
export type PushDevice = { id: string; label: string; createdAt: string; lastSentAt: string | null; match: string };

/** A short fingerprint of a push address, so a browser can tell whether it's one of the devices listed. */
const matchOf = (endpointHash: string) => endpointHash.slice(0, 16);

/** The person's devices. The sample household is shared by every visitor, so it never lists anyone's. */
export async function listDevices(ctx: Ctx): Promise<PushDevice[]> {
  if (ctx.demo) return [];
  const rows = await ctx.db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, ctx.userId), isNull(pushSubscriptions.removedAt)))
    .orderBy(asc(pushSubscriptions.createdAt));
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.createdAt.toISOString(), lastSentAt: r.lastSentAt?.toISOString() ?? null, match: matchOf(r.endpointHash) }));
}

/**
 * Keeps a device's push address, tied to the sign-in it came from. A device belongs to whoever turned it
 * on last. `auto` is the app quietly putting back a device the server lost (after signing in again): it
 * never brings back one that was removed from the list.
 */
export async function addDevice(ctx: Ctx, target: PushTarget, label: string, options: { auto?: boolean } = {}): Promise<void> {
  if (!isPushEndpoint(target.endpoint) || !isPushKeys(target.keys)) throw new HttpError(400, "This browser’s notification setup wasn’t recognised.");
  if (!ctx.demo && !ctx.sessionId) throw new HttpError(400, "Notifications are turned on from the app itself.");
  const endpointHash = sha256(target.endpoint);
  if (options.auto) {
    const [row] = await ctx.db.select({ userId: pushSubscriptions.userId, removedAt: pushSubscriptions.removedAt }).from(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, endpointHash)).limit(1);
    if (row?.removedAt && row.userId === ctx.userId) return;
  }
  const subscriptionEnc = encryptSecret(JSON.stringify({ endpoint: target.endpoint, keys: target.keys }), owner(ctx.userId));
  const sessionId = ctx.sessionId ?? null;
  await ctx.db
    .insert(pushSubscriptions)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, endpointHash, subscriptionEnc, label, sessionId })
    .onConflictDoUpdate({ target: pushSubscriptions.endpointHash, set: { userId: ctx.userId, subscriptionEnc, label, sessionId, failures: 0, removedAt: null, lastSentAt: null } });
  const rows = await ctx.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, ctx.userId)).orderBy(asc(pushSubscriptions.createdAt));
  const extra = rows.slice(0, Math.max(0, rows.length - MAX_DEVICES)).map((r) => r.id);
  for (const id of extra) await ctx.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, ctx.userId), eq(pushSubscriptions.id, id)));
}

/**
 * Stops notifications to one device: this one, by its push address (forgotten), or another from the list,
 * by id (kept as removed, so that device doesn't quietly put itself back).
 */
export async function removeDevice(ctx: Ctx, by: { endpoint?: string; id?: string }): Promise<void> {
  const mine = eq(pushSubscriptions.userId, ctx.userId);
  if (by.endpoint) await ctx.db.delete(pushSubscriptions).where(and(mine, eq(pushSubscriptions.endpointHash, sha256(by.endpoint))));
  else if (by.id && !ctx.demo) await ctx.db.update(pushSubscriptions).set({ removedAt: new Date() }).where(and(mine, eq(pushSubscriptions.id, by.id)));
}

export async function getNotifySettings(db: DB, userId: string): Promise<NotifySettings> {
  const [row] = await db
    .select({ lowBalance: userSettings.notifyLowBalance, weeklyReview: userSettings.notifyWeeklyReview, noSpend: userSettings.notifyNoSpend, amounts: userSettings.notifyAmounts })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return row ?? { lowBalance: true, weeklyReview: true, noSpend: true, amounts: true };
}

export async function setNotifySettings(ctx: Ctx, patch: Partial<NotifySettings>): Promise<NotifySettings> {
  const set = {
    ...(patch.lowBalance !== undefined ? { notifyLowBalance: patch.lowBalance } : {}),
    ...(patch.weeklyReview !== undefined ? { notifyWeeklyReview: patch.weeklyReview } : {}),
    ...(patch.noSpend !== undefined ? { notifyNoSpend: patch.noSpend } : {}),
    ...(patch.amounts !== undefined ? { notifyAmounts: patch.amounts } : {}),
  };
  if (Object.keys(set).length) await ctx.db.insert(userSettings).values({ userId: ctx.userId, ...set }).onConflictDoUpdate({ target: userSettings.userId, set });
  return getNotifySettings(ctx.db, ctx.userId);
}

/** How long a push service gets for all of one note's devices together. */
const SEND_DEADLINE_MS = 12_000;

/**
 * Sends a note to the person's devices: every one still signed in (a device whose sign-in has ended is
 * forgotten), or just one (`onlyEndpoint`, the sample household's test button). With `once` (everything
 * but the test), a note already sent is skipped; one that reached no device because the push services
 * failed is tried again next time.
 */
export async function deliver(
  db: DB,
  userId: string,
  note: Note,
  options: { once?: boolean; ttl?: number; urgency?: "normal" | "high"; onlyEndpoint?: string; now?: Date } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: number; devices: number }> {
  const once = options.once ?? true;
  const now = options.now ?? new Date();
  const mine = eq(pushSubscriptions.userId, userId);
  const rows = await db
    .select({ device: pushSubscriptions, sessionExpires: sessions.expiresAt, sessionSeen: sessions.lastSeenAt })
    .from(pushSubscriptions)
    .leftJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
    .where(and(mine, isNull(pushSubscriptions.removedAt), options.onlyEndpoint ? eq(pushSubscriptions.endpointHash, sha256(options.onlyEndpoint)) : undefined));
  // A sign-in that has run out or sat unused too long can't be used again, so its device is done too.
  const ended = rows.filter((r) => r.device.sessionId !== null && (!r.sessionExpires || r.sessionExpires <= now || !r.sessionSeen || now.getTime() - r.sessionSeen.getTime() > IDLE_DAYS * 86_400_000));
  for (const r of ended) await db.delete(pushSubscriptions).where(and(mine, eq(pushSubscriptions.id, r.device.id)));
  const devices = rows.filter((r) => !ended.includes(r)).map((r) => r.device);
  if (devices.length === 0) return { sent: 0, devices: 0 };

  let sentId: string | null = null;
  if (once) {
    const [row] = await db.insert(notificationsSent).values({ id: crypto.randomUUID(), userId, ref: note.ref }).onConflictDoNothing().returning({ id: notificationsSent.id });
    if (!row) return { sent: 0, devices: devices.length };
    sentId = row.id;
  }

  // All devices at once, within one deadline, so a slow push service never holds anything up for long.
  const results = await Promise.all(
    devices.map(async (d): Promise<PushResult | "unreadable"> => {
      let target: PushTarget;
      try {
        target = JSON.parse(decryptSecret(d.subscriptionEnc, owner(userId)));
      } catch {
        return "unreadable";
      }
      const timeout = new Promise<PushResult>((resolve) => setTimeout(() => resolve("failed"), SEND_DEADLINE_MS).unref?.());
      return Promise.race([sendPush(target, { title: note.title, body: note.body, url: note.url, tag: note.tag }, { ttl: options.ttl, urgency: options.urgency }, fetchImpl), timeout]);
    }),
  );
  let sent = 0;
  let failed = 0;
  for (const [i, result] of results.entries()) {
    const d = devices[i];
    const thisOne = and(mine, eq(pushSubscriptions.id, d.id));
    if (result === "sent") {
      sent++;
      await db.update(pushSubscriptions).set({ lastSentAt: now, failures: 0 }).where(thisOne);
    } else if (result === "unreadable" || result === "gone" || d.failures + 1 >= MAX_FAILURES) {
      // Gone from the push service, or sealed for someone else / with another key: it can never be used.
      await db.delete(pushSubscriptions).where(thisOne);
    } else {
      failed++;
      await db.update(pushSubscriptions).set({ failures: d.failures + 1 }).where(thisOne);
    }
  }
  if (sentId && sent === 0 && failed > 0) await db.delete(notificationsSent).where(eq(notificationsSent.id, sentId));
  return { sent, devices: devices.length };
}

/**
 * The test button: straight to the person's devices, not counted as sent. On the sample household, which
 * every visitor shares, only to the device that pressed it.
 */
export function sendTest(ctx: Ctx, endpoint: string | undefined, fetchImpl: typeof fetch = fetch) {
  if (ctx.demo && !endpoint) return Promise.resolve({ sent: 0, devices: 0 });
  return deliver(ctx.db, ctx.userId, TEST_NOTE, { once: false, ttl: 600, onlyEndpoint: ctx.demo ? endpoint : undefined }, fetchImpl);
}

/** Runs `work` as the person, with their own categories known, outside a request (a bank sync, the morning run). */
async function asUser<T>(db: DB, userId: string, now: Date, work: (ctx: Ctx) => Promise<T>): Promise<T | null> {
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const ctx: Ctx = { db, userId, user, today: todayIn(DEFAULT_TIMEZONE, now), demo: isDemoMode() };
  return withCategories(await loadUserCategories(ctx), () => work(ctx));
}

/** Bills paid, and money short for bills coming up. */
async function billNotes(ctx: Ctx, settings: NotifySettings, fetchImpl: typeof fetch) {
  const facts = await notifyFacts(ctx);
  for (const p of facts.paid) await deliver(ctx.db, ctx.userId, billPaidNote(p, settings.amounts), { ttl: 2 * 86_400 }, fetchImpl);
  if (settings.lowBalance && facts.cash !== null) {
    const note = lowBalanceNote({ today: facts.today, cash: facts.cash, cashName: facts.cashName, due: facts.due }, settings.amounts);
    if (note) await deliver(ctx.db, ctx.userId, note, { ttl: 86_400, urgency: "high" }, fetchImpl);
  }
}

const hasDevices = async (db: DB, userId: string) => (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).limit(1)).length > 0;

/** After the bank sends new data: bills that were just paid, and whether checking covers what's coming. */
export async function afterSync(db: DB, userId: string, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!(await hasDevices(db, userId))) return;
  const settings = await getNotifySettings(db, userId);
  await asUser(db, userId, now, (ctx) => billNotes(ctx, settings, fetchImpl));
}

/**
 * Each morning (the scheduled run): the same checks as after a sync, in case the bank was quiet, then
 * Monday's weekly review and the no-spend week's first day. Old "sent" records are tidied away.
 */
export async function morningNotes(db: DB, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<{ people: number }> {
  const people = [...new Set((await db.select({ userId: pushSubscriptions.userId }).from(pushSubscriptions)).map((r) => r.userId))];
  for (const userId of people) {
    try {
      const settings = await getNotifySettings(db, userId);
      await asUser(db, userId, now, async (ctx) => {
        await billNotes(ctx, settings, fetchImpl);
        if (settings.weeklyReview && weekday(ctx.today) === 1) {
          const recap = await getRecap(ctx);
          await deliver(db, userId, reviewNote({ week: weekKey(ctx.today), spent: recap.spent, spentBefore: recap.spentBefore }, settings.amounts), { ttl: 12 * 3600 }, fetchImpl);
        }
        const week = noSpendWeekOf(monthOf(ctx.today));
        if (settings.noSpend && ctx.today === week.start) {
          await deliver(db, userId, noSpendStartNote({ month: monthOf(ctx.today), end: week.end, left: await leftThisMonth(ctx) }, settings.amounts), { ttl: 12 * 3600 }, fetchImpl);
        }
      });
    } catch (error) {
      // One person's trouble never stops the others' notes.
      console.error("Morning notifications failed:", describeError(error));
    }
  }
  const cutoff = new Date(`${addDays(todayIn(DEFAULT_TIMEZONE, now), -120)}T00:00:00Z`);
  await db.delete(notificationsSent).where(lt(notificationsSent.sentAt, cutoff));
  return { people: people.length };
}
