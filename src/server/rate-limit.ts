import { HttpError } from "./http";

/**
 * Small in-memory limiter for sign-in attempts. It is per server instance, so
 * on serverless hosting treat it as a speed bump, not a guarantee.
 */
const hits = new Map<string, number[]>();

export function limit(request: Request, bucket: string, max: number, windowMs: number) {
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
}
