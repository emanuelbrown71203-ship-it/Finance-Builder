import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { sessions, users } from "@/db/schema";
import { DEFAULT_TIMEZONE, DEMO_USER_ID, SESSION_COOKIE, isDemoMode } from "@/lib/config";
import { isValidTimeZone, todayIn, type ISODate } from "@/lib/dates";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { demoToday, ensureDemo } from "./demo";

/** A session ends 30 days after sign-in at the latest, or after 14 days without being used. */
const SESSION_DAYS = 30;
const IDLE_DAYS = 14;

export type Ctx = {
  db: DB;
  userId: string;
  user: { id: string; name: string; email: string };
  /** Today’s date where the person is. */
  today: ISODate;
  demo: boolean;
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
    .select({ id: users.id, name: users.name, email: users.email, sessionId: sessions.id, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now), gt(sessions.lastSeenAt, new Date(now.getTime() - IDLE_DAYS * 86_400_000))))
    .limit(1);
  if (!row) return null;
  // Note that it's in use, at most once every ten minutes.
  if (now.getTime() - row.lastSeenAt.getTime() > 10 * 60_000) await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));

  const tz = request.headers.get("x-time-zone");
  const today = todayIn(tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);
  return { db, userId: row.id, user: { id: row.id, name: row.name, email: row.email }, today, demo: false };
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

/** Signs this person out on every phone, tablet and computer at once. */
export async function signOutEverywhere(ctx: Ctx): Promise<string> {
  await ctx.db.delete(sessions).where(eq(sessions.userId, ctx.userId));
  return sessionCookie("", 0);
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

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(input.password, user?.passwordHash ?? null);
  if (!user || !valid) return { ok: false, error: "That email and password don’t match." };
  return { ok: true, cookie: await startSession(db, user.id) };
}

export async function signOut(request: Request): Promise<string> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }
  return sessionCookie("", 0);
}
