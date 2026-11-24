import { createDecipheriv, createECDH, createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { accounts, notificationsSent, pushRemoved, pushSubscriptions, recurringOverrides, sessions, transactions, userSettings, users } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID, SESSION_COOKIE } from "@/lib/config";
import { billPaidNote, lowBalanceNote, noSpendStartNote, reviewNote, whenDue } from "@/lib/notifications";
import type { Ctx } from "@/server/auth";
import { endSession, signOutEverywhere } from "@/server/auth";
import { sha256 } from "@/server/crypto";
import { setRecurringOverride } from "@/server/mutations";
import { addDevice, afterSync, getNotifySettings, listDevices, morningNotes, removedDevices, removeDevice, sendTest, setNotifySettings } from "@/server/notifications";
import { getRecurring, notifyFacts } from "@/server/queries";

/* ---------- what each note says ---------- */

describe("notification wording", () => {
  it("says when a followed bill is paid, with only the person's part of a shared one", () => {
    const n = billPaidNote({ txId: "t1", seriesKey: "out:the foundry", name: "Rent", amount: -75000, date: "2026-11-01", accountName: "Quicksilver", share: 0.5 });
    expect(n).toMatchObject({ ref: "paid:t1", title: "Rent is paid", body: "$750.00, your half from Quicksilver, Nov 1.", url: "/bills?open=out%3Athe%20foundry" });
    expect(billPaidNote({ txId: "t2", seriesKey: "out:geico", name: "Geico", amount: -13250, date: "2026-11-23", accountName: "", share: null }).body).toBe("$132.50, Nov 23.");
  });

  it("warns only when checking is short for bills it pays in the next few days", () => {
    const due = [{ key: "out:geico", name: "Geico", date: "2026-11-23", amount: -13250 }];
    expect(lowBalanceNote({ today: "2026-11-20", cash: 20000, cashName: "Checking", due })).toBeNull();
    expect(lowBalanceNote({ today: "2026-11-20", cash: 5000, cashName: "Checking", due: [] })).toBeNull();
    const one = lowBalanceNote({ today: "2026-11-20", cash: 5000, cashName: "Everyday Checking", due })!;
    expect(one).toMatchObject({ ref: "low:out:geico|2026-11-23", url: "/bills?open=out%3Ageico" });
    expect(one.body).toBe("Everyday Checking has $50.00, and Geico ($132.50) is due on Monday. Worth moving money in before then.");
    const two = lowBalanceNote({ today: "2026-11-20", cash: -1200, cashName: "Checking", due: [{ key: "card:a1", name: "Visa minimum payment", date: "2026-11-22", amount: -3500 }, ...due] })!;
    expect(two.ref).toBe("low:card:a1|2026-11-22");
    expect(two.body).toBe("Checking has $0.00, and 2 bills come to $167.50 by Monday. Worth moving money in before then.");
    expect(two.url).toBe("/bills");
  });

  it("leaves every dollar figure out when amounts are switched off (notes show on the lock screen)", () => {
    const paid = billPaidNote({ txId: "t1", seriesKey: "out:the foundry", name: "Rent", amount: -75000, date: "2026-11-01", accountName: "Quicksilver", share: 0.5 }, false);
    const low = lowBalanceNote({ today: "2026-11-20", cash: 5000, cashName: "Everyday Checking", due: [{ key: "out:geico", name: "Geico", date: "2026-11-23", amount: -13250 }] }, false)!;
    const review = reviewNote({ week: "2026-11-23", spent: 41000, spentBefore: 52000 }, false);
    const ns = noSpendStartNote({ month: "2026-11", end: "2026-11-30", left: 31000 }, false);
    expect(paid.body).toBe("Paid from Quicksilver, Nov 1.");
    expect(low.body).toBe("Everyday Checking may not cover Geico, due on Monday. Worth moving money in before then.");
    expect(review.body).toBe("Take two minutes to look back at last week and plan this one.");
    expect(ns.body).toBe("Bills only through Nov 30. Whatever’s left of November on the 1st can go to savings.");
    for (const n of [paid, low, review, ns]) expect(n.title + n.body).not.toMatch(/\$/);
  });

  it("words the weekly review and the no-spend week", () => {
    expect(reviewNote({ week: "2026-11-23", spent: 41000, spentBefore: 52000 }).body).toBe("Last week: $410 spent, $110 less than the week before. Take two minutes to look back and plan this week.");
    expect(reviewNote({ week: "2026-11-23", spent: 41000, spentBefore: 0 }).body).toBe("Last week: $410 spent. Take two minutes to look back and plan this week.");
    expect(reviewNote({ week: "2026-11-23", spent: 1, spentBefore: 0 }).ref).toBe("review:2026-11-23");
    const ns = noSpendStartNote({ month: "2026-11", end: "2026-11-30", left: 31000 });
    expect(ns).toMatchObject({ ref: "nospend:2026-11", title: "No-spend week starts today" });
    expect(ns.body).toBe("Bills only through Nov 30. About $310 of November is left, and whatever’s still there on the 1st can go to savings.");
    expect(noSpendStartNote({ month: "2026-11", end: "2026-11-30", left: -500 }).body).toBe("Bills only through Nov 30. Every day you skip spending helps.");
    expect([whenDue("2026-11-20", "2026-11-20"), whenDue("2026-11-21", "2026-11-20"), whenDue("2026-11-24", "2026-11-20")]).toEqual(["today", "tomorrow", "on Tuesday"]);
  });
});

/* ---------- sending, on the sample household ---------- */

const today = "2026-11-19";
let db: DB;
let ctx: Ctx;
/** The sample person, signed in on a device (notifications are tied to the sign-in they were turned on from). */
let me: Ctx;
const SESSION = "notify-test-session";
const signIn = () => db.insert(sessions).values({ id: SESSION, userId: DEMO_USER_ID, expiresAt: new Date(Date.now() + 30 * 86_400_000) }).onConflictDoNothing();

/** A pretend phone: its keys, and reading what it's sent the way a real one would. */
function phone(n = 1) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.alloc(16, n);
  return {
    endpoint: `https://web.push.apple.com/device-${n}-${ecdh.getPublicKey().toString("hex").slice(0, 12)}`,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    read(body: Uint8Array): { title: string; body: string; url: string; tag: string } {
      const b = Buffer.from(body);
      const salt = b.subarray(0, 16);
      const asPublic = b.subarray(21, 21 + b[20]);
      const shared = ecdh.computeSecret(asPublic);
      const h = (s: Buffer, ikm: Buffer, info: Buffer, len: number) => createHmac("sha256", createHmac("sha256", s).update(ikm).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
      const ikm = h(auth, shared, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32);
      const d = createDecipheriv("aes-128-gcm", h(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16), h(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12));
      const data = b.subarray(21 + b[20]);
      d.setAuthTag(data.subarray(data.length - 16));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.length - 1).toString());
    },
  };
}

/** A push service that answers with `status`, and remembers what it was sent. */
function service(status = 201) {
  const sent: { url: string; body: Uint8Array }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: init!.body as Uint8Array });
    return new Response(null, { status });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

async function clear() {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, DEMO_USER_ID));
  await db.delete(pushRemoved).where(eq(pushRemoved.userId, DEMO_USER_ID));
  await db.delete(notificationsSent).where(eq(notificationsSent.userId, DEMO_USER_ID));
  await db.update(recurringOverrides).set({ notifyPaid: false }).where(eq(recurringOverrides.userId, DEMO_USER_ID));
  await db.delete(userSettings).where(eq(userSettings.userId, DEMO_USER_ID));
}

beforeAll(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
  db = await getDb();
  await seedDemo(db, today, new Date("2026-11-19T20:00:00Z"));
  ctx = { db, userId: DEMO_USER_ID, user: { id: DEMO_USER_ID, name: "Sam", email: "demo@passbook.local" }, today, demo: true };
  me = { ...ctx, demo: false, sessionId: SESSION };
  await clear();
  await signIn();
});

afterAll(async () => {
  await clear();
  await db.delete(sessions).where(eq(sessions.id, SESSION));
  await db.delete(users).where(eq(users.id, "notify-other"));
});

describe("phone notifications", () => {
  it("keeps a device sealed, lists it by a fingerprint only, and refuses addresses that aren't push services", async () => {
    const p = phone(1);
    await addDevice(me, p, "iPhone");
    await addDevice(me, p, "iPhone");
    const list = await listDevices(me);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "iPhone", match: sha256(p.endpoint).slice(0, 16), lastSentAt: null });
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, DEMO_USER_ID));
    expect(row.subscriptionEnc).not.toContain("push.apple.com");
    expect(row.subscriptionEnc).not.toContain(p.keys.auth);
    await expect(addDevice(me, { ...phone(2), endpoint: "https://evil.example/collect" }, "iPhone")).rejects.toThrow(/wasn’t recognised/);
    await expect(addDevice(me, { ...phone(2), endpoint: "http://169.254.169.254/latest" }, "iPhone")).rejects.toThrow();
    await expect(addDevice(me, { ...phone(2), keys: { p256dh: phone(3).keys.p256dh, auth: "c2hvcnQ" } }, "iPhone")).rejects.toThrow();
    await clear();
  });

  it("keeps ten devices at most, and one person can't remove another's", async () => {
    for (let i = 1; i <= 11; i++) await addDevice(me, phone(i), `Device ${i}`);
    expect(await listDevices(me)).toHaveLength(10);
    await db.insert(users).values({ id: "notify-other", email: "other@passbook.local", name: "Other" }).onConflictDoNothing();
    await db.insert(sessions).values({ id: "notify-other-session", userId: "notify-other", expiresAt: new Date(Date.now() + 30 * 86_400_000) }).onConflictDoNothing();
    const other: Ctx = { ...me, userId: "notify-other", user: { id: "notify-other", name: "Other", email: "other@passbook.local" }, sessionId: "notify-other-session" };
    const theirs = phone(20);
    await addDevice(other, theirs, "iPad");
    const [theirDevice] = await listDevices(other);
    await removeDevice(me, { id: theirDevice.id });
    await removeDevice(me, { endpoint: theirs.endpoint });
    expect(await listDevices(other)).toHaveLength(1);
    // A device belongs to whoever turned it on last.
    const mine = phone(1);
    await addDevice(me, mine, "iPhone");
    await addDevice(other, mine, "iPhone");
    expect((await listDevices(me)).some((d) => d.match === sha256(mine.endpoint).slice(0, 16))).toBe(false);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, "notify-other"));
    await clear();
  });

  it("tells you once when a bill you follow is paid, and only once it's settled", async () => {
    const p = phone(1);
    await addDevice(me, p, "iPhone");
    const loan = (await getRecurring(ctx)).series.find((s) => s.name === "Cedar Lending Student Loan")!;
    expect(loan.notifyPaid).toBe(false);
    await setRecurringOverride(ctx, loan.key, { notifyPaid: true });
    expect((await getRecurring(ctx)).series.find((s) => s.key === loan.key)!.notifyPaid).toBe(true);

    const push = service();
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T20:00:00Z"), push.fetchImpl);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0].url).toBe(p.endpoint);
    expect(p.read(push.sent[0].body)).toEqual({ title: "Cedar Lending Student Loan is paid", body: "$240.00 from Everyday Checking, Nov 18.", url: `/bills?open=${encodeURIComponent(loan.key)}`, tag: `paid:${loan.key}` });
    expect((await listDevices(me))[0].lastSentAt).not.toBeNull();

    // Never twice.
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T21:00:00Z"), push.fetchImpl);
    expect(push.sent).toHaveLength(1);

    // A payment still pending isn't "paid" yet.
    await db.delete(notificationsSent).where(eq(notificationsSent.userId, DEMO_USER_ID));
    const payment = loan.history[loan.history.length - 1];
    await db.update(transactions).set({ pending: true }).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.id, payment.id)));
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T20:00:00Z"), push.fetchImpl);
    expect(push.sent).toHaveLength(1);
    await db.update(transactions).set({ pending: false }).where(and(eq(transactions.userId, DEMO_USER_ID), eq(transactions.id, payment.id)));
    await clear();
  });

  it("sends nothing to nobody: without a device, nothing is worked out or recorded", async () => {
    const loan = (await getRecurring(ctx)).series.find((s) => s.name === "Cedar Lending Student Loan")!;
    await setRecurringOverride(ctx, loan.key, { notifyPaid: true });
    const push = service();
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T20:00:00Z"), push.fetchImpl);
    expect(push.sent).toHaveLength(0);
    expect(await db.select().from(notificationsSent).where(eq(notificationsSent.userId, DEMO_USER_ID))).toHaveLength(0);
    await clear();
  });

  it("forgets a device that's gone, and tries a note again when the push service failed", async () => {
    const loan = (await getRecurring(ctx)).series.find((s) => s.name === "Cedar Lending Student Loan")!;
    await setRecurringOverride(ctx, loan.key, { notifyPaid: true });
    await addDevice(me, phone(1), "iPhone");
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T20:00:00Z"), service(500).fetchImpl);
    expect(await db.select().from(notificationsSent).where(eq(notificationsSent.userId, DEMO_USER_ID))).toHaveLength(0);
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, DEMO_USER_ID));
    expect(row.failures).toBe(1);
    const later = service();
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T20:30:00Z"), later.fetchImpl);
    expect(later.sent).toHaveLength(1);

    await db.delete(notificationsSent).where(eq(notificationsSent.userId, DEMO_USER_ID));
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-19T20:00:00Z"), service(410).fetchImpl);
    expect(await listDevices(me)).toHaveLength(0);
    await clear();
  });

  it("only counts bills the bank account pays when checking is short, and says so once", async () => {
    // On the 20th: Geico (from checking) is due on the 23rd; Adobe goes on the card on the 21st, so its money isn't needed yet.
    const ctx20 = { ...ctx, today: "2026-11-20" };
    const facts = await notifyFacts(ctx20);
    expect(facts.due.map((d) => d.name)).toEqual(["Geico"]);
    const [checking] = await db.select().from(accounts).where(and(eq(accounts.userId, DEMO_USER_ID), eq(accounts.subtype, "checking")));
    await db.update(accounts).set({ balance: 5000, available: 5000 }).where(eq(accounts.id, checking.id));
    const p = phone(1);
    await addDevice(me, p, "iPhone");
    const push = service();
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-20T15:00:00Z"), push.fetchImpl);
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-20T18:00:00Z"), push.fetchImpl);
    expect(push.sent).toHaveLength(1);
    expect(p.read(push.sent[0].body).title).toBe("Not enough for a bill coming up");
    // Switched off: nothing.
    await db.delete(notificationsSent).where(eq(notificationsSent.userId, DEMO_USER_ID));
    await setNotifySettings(me, { lowBalance: false });
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-20T15:00:00Z"), push.fetchImpl);
    expect(push.sent).toHaveLength(1);
    await db.update(accounts).set({ balance: checking.balance, available: checking.available }).where(eq(accounts.id, checking.id));
    await clear();
  });

  it("sends Monday's weekly review and the no-spend week's first morning, as chosen", async () => {
    const p = phone(1);
    await addDevice(me, p, "iPhone");
    expect(await getNotifySettings(db, DEMO_USER_ID)).toEqual({ lowBalance: true, weeklyReview: true, noSpend: true, amounts: true });
    const push = service();
    // Monday the 23rd.
    await morningNotes(db, new Date("2026-11-23T13:05:00Z"), push.fetchImpl);
    await morningNotes(db, new Date("2026-11-23T13:30:00Z"), push.fetchImpl);
    const titles = push.sent.map((s) => p.read(s.body).title);
    expect(titles.filter((t) => t === "Your weekly review is ready")).toHaveLength(1);
    // Tuesday the 24th: November's last seven days start.
    await morningNotes(db, new Date("2026-11-24T13:05:00Z"), push.fetchImpl);
    const last = p.read(push.sent[push.sent.length - 1].body);
    expect(last).toMatchObject({ title: "No-spend week starts today", url: "/" });
    expect(last.body).toMatch(/^Bills only through Nov 30\./);
    // Not sent again on Tuesday: once a week.
    const monday = push.sent.length;
    await morningNotes(db, new Date("2026-11-24T13:30:00Z"), push.fetchImpl);
    expect(push.sent.slice(monday).map((s) => p.read(s.body).title)).not.toContain("Your weekly review is ready");
    // Switched off: no review the next Monday.
    await setNotifySettings(me, { weeklyReview: false });
    const before = push.sent.length;
    await morningNotes(db, new Date("2026-11-30T13:05:00Z"), push.fetchImpl);
    expect(push.sent.slice(before).map((s) => p.read(s.body).title)).not.toContain("Your weekly review is ready");
    await clear();
  });

  it("a device's notes end with its sign-in: signing out, a sign-in ended elsewhere, or two weeks unused", async () => {
    // Signing out on the device: it's forgotten at once.
    const token = "notify-test-token";
    await db.insert(sessions).values({ id: sha256(token), userId: DEMO_USER_ID, expiresAt: new Date(Date.now() + 86_400_000) });
    await addDevice({ ...me, sessionId: sha256(token) }, phone(1), "iPhone");
    await endSession(db, new Request("http://localhost/api/auth/logout", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, DEMO_USER_ID))).toHaveLength(0);

    // A sign-in ended some other way (a new password on another device, the old ones cleared away).
    await addDevice(me, phone(2), "iPhone");
    await db.delete(sessions).where(eq(sessions.id, SESSION));
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, DEMO_USER_ID))).toHaveLength(0);
    await signIn();

    // Unused for over two weeks: one last note with nothing about money in it, then it's forgotten.
    const p = phone(3);
    await addDevice(me, p, "iPhone");
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(sessions.id, SESSION));
    const push = service();
    expect(await sendTest(me, undefined, push.fetchImpl)).toEqual({ sent: 0, devices: 0 });
    expect(push.sent.map((x) => p.read(x.body))).toEqual([{ title: "Notifications are paused", body: "Your sign-in on this device has ended. Open Passbook and sign in to get notes again.", url: "/", tag: "paused" }]);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, DEMO_USER_ID))).toHaveLength(0);
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, SESSION));

    // Turning them on needs a sign-in (outside the sample household).
    await expect(addDevice({ ...me, sessionId: undefined }, phone(4), "iPhone")).rejects.toThrow(/from the app itself/);
    await clear();
  });

  it("a device removed from the list stays off until it's switched on from the device itself", async () => {
    const p = phone(1);
    await addDevice(me, p, "iPad");
    const [d] = await listDevices(me);
    await removeDevice(me, { id: d.id });
    expect(await listDevices(me)).toHaveLength(0);
    const push = service();
    expect(await sendTest(me, undefined, push.fetchImpl)).toEqual({ sent: 0, devices: 0 });
    // The app quietly putting it back is refused…
    await addDevice(me, p, "iPad", { auto: true });
    expect(await listDevices(me)).toHaveLength(0);
    // It stays removed after that sign-in ends and a new one starts, and the app is told to leave it be.
    await db.delete(sessions).where(eq(sessions.id, SESSION));
    await signIn();
    await addDevice(me, p, "iPad", { auto: true });
    expect(await listDevices(me)).toHaveLength(0);
    expect(await removedDevices(me)).toEqual([sha256(p.endpoint).slice(0, 16)]);
    // A renewed push address for it is the same device: still off, under the new address too.
    const renewed = phone(5);
    await addDevice(me, renewed, "iPad", { auto: true, replaces: p.endpoint });
    await addDevice(me, renewed, "iPad", { auto: true });
    expect(await listDevices(me)).toHaveLength(0);
    expect((await removedDevices(me)).sort()).toEqual([sha256(p.endpoint).slice(0, 16), sha256(renewed.endpoint).slice(0, 16)].sort());
    // …switching it on there works.
    await addDevice(me, p, "iPad");
    expect(await listDevices(me)).toHaveLength(1);
    expect(await removedDevices(me)).toEqual([sha256(renewed.endpoint).slice(0, 16)]);
    // And a renewed address takes over from the old one, rather than adding a second device.
    await addDevice(me, renewed, "iPad", { replaces: p.endpoint });
    const list = await listDevices(me);
    expect(list.map((d) => d.match)).toEqual([sha256(renewed.endpoint).slice(0, 16)]);
    await clear();
  });

  it("on the sample household, which every visitor shares, nobody's devices are listed and a test reaches only the asker", async () => {
    const mine = phone(1);
    const theirs = phone(2);
    await addDevice(ctx, mine, "iPhone");
    await addDevice(ctx, theirs, "iPhone");
    expect(await listDevices(ctx)).toEqual([]);
    const push = service();
    expect(await sendTest(ctx, undefined, push.fetchImpl)).toEqual({ sent: 0, devices: 0 });
    expect(await sendTest(ctx, mine.endpoint, push.fetchImpl)).toEqual({ sent: 1, devices: 1 });
    expect(push.sent.map((x) => x.url)).toEqual([mine.endpoint]);
    // And one visitor can't remove another's from a list.
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, sha256(theirs.endpoint)));
    await removeDevice(ctx, { id: row.id });
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, row.id))).toHaveLength(1);
    await clear();
  });

  it("the day's notes also come with the first bank update after 8 a.m., never at night", async () => {
    const p = phone(1);
    await addDevice(me, p, "iPhone");
    const push = service();
    // Monday the 23rd, 3 a.m. in New York: bills only.
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-23T08:00:00Z"), push.fetchImpl);
    expect(push.sent.map((x) => p.read(x.body).title)).not.toContain("Your weekly review is ready");
    // 9 a.m.: the review comes with it, once.
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-23T14:00:00Z"), push.fetchImpl);
    await afterSync(db, DEMO_USER_ID, new Date("2026-11-23T16:00:00Z"), push.fetchImpl);
    expect(push.sent.map((x) => p.read(x.body).title).filter((t) => t === "Your weekly review is ready")).toHaveLength(1);
    await clear();
  });

  it("the test button reaches every device, and signing out everywhere stops them all", async () => {
    const a = phone(1);
    const b = phone(2);
    await addDevice(me, a, "iPhone");
    await addDevice(me, b, "iPad");
    const push = service();
    expect(await sendTest(me, undefined, push.fetchImpl)).toEqual({ sent: 2, devices: 2 });
    expect(a.read(push.sent[0].body).title).toBe("Notifications are on");
    // Not recorded: it can be sent again.
    expect(await sendTest(me, undefined, push.fetchImpl)).toEqual({ sent: 2, devices: 2 });
    await signOutEverywhere(me);
    expect(await listDevices(me)).toHaveLength(0);
    await clear();
  });
});
