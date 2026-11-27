import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { sha256 } from "./crypto";
import { HttpError } from "./errors";

const keyFor = (bucket: string, subject: string) => `${bucket}:${sha256(subject).slice(0, 32)}`;

/**
 * Slows down guessing. Counts attempts per key in the database, so the limit
 * holds across every server instance (an in-memory counter would reset each
 * time the host starts a new one).
 *
 * Keys are hashed, so no IP address or email is stored as readable text.
 */
export async function limitKey(bucket: string, subject: string, max: number, windowMs: number): Promise<void> {
  const db = await getDb();
  const key = keyFor(bucket, subject);
  const now = new Date();
  // Already refused in this window: refused again here, without asking the database, so a flood of
  // refused requests can't keep it busy.
  // (For a minute at a time, then the database is asked again, in case its counters were cleared.)
  const known = refusedIn(db);
  const hit = known.get(key);
  if (hit) {
    if (hit.since + windowMs > now.getTime() && hit.until > now.getTime()) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
    known.delete(key);
  }
  // Dates inside hand-written SQL are bound through the column, so they are sent the way the column expects.
  const cutoff = sql.param(new Date(now.getTime() - windowMs), rateLimits.windowStart);
  const start = sql.param(now, rateLimits.windowStart);
  // One statement, so two requests arriving together can't both slip under the limit.
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < ${cutoff} then ${start} else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
  // Now and then, clear out counters nobody has touched for a day.
  if (Math.random() < 0.02) await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
  if (row.count > max) {
    remember(known, key, new Date(row.windowStart).getTime());
    throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  }
}

/*
 * In memory, for this running copy of the server only (each copy keeps its own). Cheap enough to check
 * before the database is asked anything. Kept per database, so a fresh one (in tests) starts clean.
 */
const refused = new WeakMap<object, Map<string, { since: number; until: number }>>();
const strikes = new WeakMap<object, Map<string, { count: number; since: number }>>();
const MEMORY = 10_000;

function refusedIn(db: object): Map<string, { since: number; until: number }> {
  let map = refused.get(db);
  if (!map) refused.set(db, (map = new Map()));
  return map;
}

/** When a key's window started, once the database has refused it. */
function remember(map: Map<string, { since: number; until: number }>, key: string, since: number) {
  const now = Date.now();
  if (map.size >= MEMORY) {
    for (const [k, hit] of map) if (hit.until <= now) map.delete(k);
    if (map.size >= MEMORY) map.clear();
  }
  map.set(key, { since, until: now + 60_000 });
}

function strikesIn(db: object) {
  let map = strikes.get(db);
  if (!map) strikes.set(db, (map = new Map()));
  return map;
}

/**
 * Something that needs no limit of its own, but costs a look in the database each time (a sign-in cookie
 * that turns out to be no good). Counted here in memory: `struckOut` says a subject has had `max` in the
 * window, and `strike` counts one more.
 */
export function struckOut(db: object, bucket: string, subject: string, max: number, windowMs: number): boolean {
  const hit = strikesIn(db).get(keyFor(bucket, subject));
  return !!hit && hit.since + windowMs > Date.now() && hit.count >= max;
}

export function strike(db: object, bucket: string, subject: string, windowMs: number): void {
  const map = strikesIn(db);
  const key = keyFor(bucket, subject);
  const now = Date.now();
  const hit = map.get(key);
  if (hit && hit.since + windowMs > now) hit.count++;
  else {
    if (map.size >= MEMORY) map.clear();
    map.set(key, { count: 1, since: now });
  }
}

/** Refuses when a limit has already been reached, without counting this request towards it. */
export async function assertUnderLimit(bucket: string, subject: string, max: number, windowMs: number): Promise<void> {
  const db = await getDb();
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, keyFor(bucket, subject)), gt(rateLimits.windowStart, new Date(Date.now() - windowMs))))
    .limit(1);
  if (row && row.count >= max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
}

/**
 * The caller's address, taken from the header the host itself sets.
 *
 * On Vercel that is `x-vercel-forwarded-for`, which a visitor cannot set.
 * Elsewhere it is the last hop of `x-forwarded-for` (the one added by the
 * nearest proxy; earlier entries are whatever the visitor sent), or `x-real-ip`.
 */
export function clientAddress(request: Request): string {
  const h = request.headers;
  const fromHost = process.env.VERCEL ? h.get("x-vercel-forwarded-for") : null;
  const forwarded = (h.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const address = fromHost?.split(",")[0].trim() || forwarded[forwarded.length - 1] || h.get("x-real-ip")?.trim();
  return address || "local";
}

/** Limits by where the request came from. */
export function limit(request: Request, bucket: string, max: number, windowMs: number): Promise<void> {
  return limitKey(bucket, clientAddress(request), max, windowMs);
}
