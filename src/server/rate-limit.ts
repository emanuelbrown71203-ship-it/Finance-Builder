import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { sha256 } from "./crypto";
import { HttpError } from "./errors";

/**
 * Slows down guessing. Counts attempts per key in the database, so the limit
 * holds across every server instance (an in-memory counter would reset each
 * time the host starts a new one).
 *
 * Keys are hashed, so no IP address or email is stored as readable text.
 */
export async function limitKey(bucket: string, subject: string, max: number, windowMs: number): Promise<void> {
  const db = await getDb();
  const key = `${bucket}:${sha256(subject).slice(0, 32)}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  // One statement, so two requests arriving together can't both slip under the limit.
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < ${cutoff} then ${now} else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  // Now and then, clear out counters nobody has touched for a day.
  if (Math.random() < 0.02) await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
  if (row.count > max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
}

/** The caller's address as the host reports it. */
export function clientAddress(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
}

/** Limits by where the request came from. */
export function limit(request: Request, bucket: string, max: number, windowMs: number): Promise<void> {
  return limitKey(bucket, clientAddress(request), max, windowMs);
}
