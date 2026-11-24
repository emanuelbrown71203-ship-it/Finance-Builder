import { and, eq, gt, lt, ne } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { connectorTokens, pushSubscriptions, sessions, tapKeys, users } from "@/db/schema";
import { DEFAULT_TIMEZONE, DEMO_USER_ID, SESSION_COOKIE, isDemoMode } from "@/lib/config";
import { isValidTimeZone, todayIn, type ISODate } from "@/lib/dates";
import { hashPassword, passwordNeedsUpgrade, randomToken, sha256, verifyPassword } from "./crypto";
import { demoToday, ensureDemo } from "./demo";
import { HttpError } from "./errors";
import { limitKey } from "./rate-limit";

/** A session ends 30 days after sign-in at the latest, or after 14 days without being used. */
const SESSION_DAYS = 30;
export const IDLE_DAYS = 14;

export type Ctx = {
  db: DB;
  userId: string;
  user: { id: string; name: string; email: string };
  /** Today’s date where the person is. */
  today: ISODate;
  demo: boolean;
  /** The session this request came in on. Absent for sample data and for the Claude connector. */
  sessionId?: string;
  /** When this person last proved who they are on this session. */
  authAt?: Date;
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null; // not something we set
    }
  }
  return null;
}

/** Resolves who is asking. Null means not signed in. */
export async function getContext(request: Request): Promise<Ctx | null> {
  const db = await getDb();

  if (isDemoMode()) {
    await ensureDemo(db);
    return { db, userId: DEMO_USER_ID, user: { id: DEMO_USER_ID, name: "Sam", email: "demo@passbook.local" }, today: demoToday(), demo: true };
  }

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt, authAt: sessions.authAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now), gt(sessions.lastSeenAt, new Date(now.getTime() - IDLE_DAYS * 86_400_000))))
    .limit(1);
  if (!row) return null;
  // Note that it's in use, at most once every ten minutes.
  if (now.getTime() - row.lastSeenAt.getTime() > 10 * 60_000) await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));

  const tz = request.headers.get("x-time-zone");
  const today = todayIn(tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);
  return { db, userId: row.id, user: { id: row.id, name: row.name, email: row.email }, today, demo: false, sessionId: row.sessionId, authAt: row.authAt };
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function startSession(db: DB, userId: string): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  // Opportunistic cleanup of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return sessionCookie(token, SESSION_DAYS * 86_400);
}

/**
 * Signs this person out on every phone, tablet and computer at once, and
 * switches off the Claude connector link, which would otherwise keep working.
 */
export async function signOutEverywhere(ctx: Ctx): Promise<string> {
  await ctx.db.delete(sessions).where(eq(sessions.userId, ctx.userId));
  await ctx.db.delete(connectorTokens).where(eq(connectorTokens.userId, ctx.userId));
  await ctx.db.delete(tapKeys).where(eq(tapKeys.userId, ctx.userId));
  // A lost phone stops showing notifications too. Devices still signed in turn theirs back on by themselves.
  await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, ctx.userId));
  return sessionCookie("", 0);
}

/** Checks the password of the person already signed in. Limited, so a borrowed phone can't be used to guess it. */
async function checkOwnPassword(ctx: Ctx, password: string): Promise<void> {
  await limitKey("confirm", ctx.userId, 8, 15 * 60_000);
  const [user] = await ctx.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!(await verifyPassword(password, user?.passwordHash ?? null))) throw new HttpError(401, "That password isn’t right.");
}

/** "Confirm it's you": marks this session as freshly checked, which sensitive changes require. */
export async function confirmWithPassword(ctx: Ctx, password: string): Promise<void> {
  if (ctx.demo || !ctx.sessionId) return;
  await checkOwnPassword(ctx, password);
  await ctx.db.update(sessions).set({ authAt: new Date() }).where(eq(sessions.id, ctx.sessionId));
}

/** Changes the password, signs every other device out and switches off the Claude link. */
export async function changePassword(ctx: Ctx, current: string, next: string): Promise<void> {
  if (ctx.demo || !ctx.sessionId) throw new HttpError(400, "The sample household has no password.");
  await checkOwnPassword(ctx, current);
  const problem = passwordProblem(next, ctx.user.email, ctx.user.name);
  if (problem) throw new HttpError(400, problem);
  if (next === current) throw new HttpError(400, "Pick a password you haven’t been using.");
  await ctx.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, ctx.userId));
  await ctx.db.delete(sessions).where(and(eq(sessions.userId, ctx.userId), ne(sessions.id, ctx.sessionId)));
  // A password is changed when someone else may have had it. Whatever they set up while they did goes too.
  await ctx.db.delete(connectorTokens).where(eq(connectorTokens.userId, ctx.userId));
  await ctx.db.delete(tapKeys).where(eq(tapKeys.userId, ctx.userId));
  // The other devices' notifications ended with their sign-ins; this one keeps its own.
  await ctx.db.update(sessions).set({ authAt: new Date() }).where(eq(sessions.id, ctx.sessionId));
}

/** Marks this session as freshly checked. Used once a passkey has confirmed it's the same person. */
export async function markFresh(ctx: Ctx): Promise<void> {
  if (ctx.sessionId) await ctx.db.update(sessions).set({ authAt: new Date() }).where(eq(sessions.id, ctx.sessionId));
}

/** Passwords everyone tries first. A new password can't be one of them, or be built from the person's own name or email. */
const COMMON = new Set(["password", "password1", "password12", "password123", "password1234", "1234567890", "12345678910", "123456789a", "qwertyuiop", "qwerty12345", "iloveyou12", "letmein123", "welcome123", "admin12345", "passw0rd123", "changeme123", "abc1234567", "1q2w3e4r5t", "0987654321", "1111111111", "0000000000", "football123", "baseball123", "sunshine123", "princess123", "monkey12345", "dragon12345", "master12345", "superman123", "trustno1234"]);

export function passwordProblem(password: string, email: string, name: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return "That password is one of the first anyone would guess. Pick something less common.";
  const local = email.split("@")[0].toLowerCase();
  if ((local.length >= 4 && lower.includes(local)) || (name.trim().length >= 4 && lower.includes(name.trim().toLowerCase()))) return "Don’t build your password from your name or email.";
  return null;
}

export type AuthResult = { ok: true; cookie: string } | { ok: false; error: string };

export async function signUp(input: { email: string; name: string; password: string }): Promise<AuthResult> {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, error: "An account with that email already exists. Sign in instead." };
  const problem = passwordProblem(input.password, email, input.name);
  if (problem) return { ok: false, error: problem };
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email, name: input.name.trim(), passwordHash: await hashPassword(input.password) });
  return { ok: true, cookie: await startSession(db, id) };
}

export async function signIn(input: { email: string; password: string }, request?: Request): Promise<AuthResult> {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (!user || !valid) return { ok: false, error: "That email and password don’t match." };
  // Passwords stored with older, weaker settings are re-stored at today's strength.
  if (user.passwordHash && passwordNeedsUpgrade(user.passwordHash)) await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user.id));
  await endSession(db, request);
  return { ok: true, cookie: await startSession(db, user.id) };
}

/** Ends the session this request came in on, if it has one. */
export async function endSession(db: DB, request: Request | undefined): Promise<void> {
  const token = request ? readCookie(request, SESSION_COOKIE) : null;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function signOut(request: Request): Promise<string> {
  await endSession(await getDb(), request);
  return sessionCookie("", 0);
}
