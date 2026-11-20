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
    .returning({ count: rateLimits.count });
  // Now and then, clear out counters nobody has touched for a day.
  if (Math.random() < 0.02) await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
  if (row.count > max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
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
