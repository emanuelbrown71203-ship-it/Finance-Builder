import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { sessions, users } from "@/db/schema";
import { DEFAULT_TIMEZONE, DEMO_USER_ID, SESSION_COOKIE, isDemoMode } from "@/lib/config";
import { isValidTimeZone, todayIn, type ISODate } from "@/lib/dates";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { demoToday, ensureDemo } from "./demo";

const SESSION_DAYS = 30;

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
    if (k === name) return decodeURIComponent(rest.join("="));
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
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  const tz = request.headers.get("x-time-zone");
  const today = todayIn(tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);
  return { db, userId: row.id, user: row, today, demo: false };
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

async function startSession(db: DB, userId: string): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  // Opportunistic cleanup of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return sessionCookie(token, SESSION_DAYS * 86_400);
}

export type AuthResult = { ok: true; cookie: string } | { ok: false; error: string };

export async function signUp(input: { email: string; name: string; password: string }): Promise<AuthResult> {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, error: "An account with that email already exists. Sign in instead." };
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
