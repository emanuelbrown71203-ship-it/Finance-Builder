import { connection } from "next/server";
import { databaseUrl, isDemoMode, liveConfigProblem } from "@/lib/config";
import { describeError } from "@/server/errors";

/*
 * "Is this site ready?" Says whether it is showing sample data or real data,
 * and whether the real database answers. It is how a new set-up is checked
 * before anyone signs in, and it tells a visitor nothing about anyone's
 * money: one of four words about the database, and at most an error code.
 *
 * The database is asked at most once a minute, so this address can't be
 * used to keep it busy.
 */

type Database = { database: "none" | "ok" | "not-installed" | "unreachable"; code?: string };

let last: { at: number; result: Promise<Database> } | null = null;

async function probe(): Promise<Database> {
  const url = databaseUrl();
  if (!url) return { database: "none" };
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 8, idle_timeout: 1, onnotice: () => {} });
  try {
    // Reading a count proves the address, the login and its permissions in one go.
    await sql`select count(*) from users`;
    return { database: "ok" };
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code.slice(0, 40) : undefined;
    if (code === "42P01") return { database: "not-installed", code };
    console.error("Health check:", describeError(error));
    return { database: "unreachable", code };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

export async function GET() {
  // Answered when asked, never worked out ahead of time at build.
  await connection();
  if (!last || Date.now() - last.at > 60_000) last = { at: Date.now(), result: probe() };
  const database = await last.result;
  const sample = isDemoMode();
  const ready = sample || (liveConfigProblem() === null && database.database === "ok");
  return Response.json({ mode: sample ? "sample" : "live", ready, ...database, build: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, { headers: { "cache-control": "no-store" } });
}
