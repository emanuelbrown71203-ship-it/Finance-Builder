import { connection } from "next/server";
import { sql as q } from "drizzle-orm";
import { getDb } from "@/db";
import { databaseUrl, isDemoMode, liveConfigProblem } from "@/lib/config";
import { describeError } from "@/server/errors";

/*
 * "Is this site ready?" Says whether it is showing sample data or real data,
 * and whether the real database answers. It is how a new set-up is checked
 * before anyone signs in, and it tells a visitor nothing about anyone's
 * money: one of four words about the database (any error code goes only to
 * the server log).
 *
 * Each running copy of the server asks the database at most once a minute,
 * through its own one connection, so this address can't be used to keep the
 * database busy or use up its connections.
 */

type Database = { database: "none" | "ok" | "not-installed" | "unreachable"; code?: string };
type Pool = "ok" | "stuck" | "error";

let last: { at: number; result: Promise<[Database, Pool]> } | null = null;

/**
 * Asks the app's own database connections several questions at once, the way
 * a screen does. A gateway that mishandles that hangs instead of answering, so
 * this is given eight seconds and then reported as "stuck".
 */
async function poolCheck(): Promise<Pool> {
  try {
    const db = await getDb();
    const all = Promise.all(Array.from({ length: 6 }, () => db.execute(q`select 1`))).then(() => "ok" as const);
    const timeout = new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 8_000));
    return await Promise.race([all, timeout]);
  } catch (error) {
    console.error("Health check (app connections):", describeError(error));
    return "error";
  }
}

async function probe(): Promise<Database> {
  if (!databaseUrl()) return { database: "none" };
  try {
    // Through the app's own connection, so a check never takes one more from the database's few.
    // Reading a count proves the address, the login and its permissions in one go.
    const db = await getDb();
    await db.execute(q`select count(*) from users`);
    return { database: "ok" };
  } catch (error) {
    const raw = (error as { cause?: { code?: unknown }; code?: unknown }) ?? {};
    const found = typeof raw.code === "string" ? raw.code : typeof raw.cause?.code === "string" ? raw.cause.code : undefined;
    const code = found?.slice(0, 40);
    if (code === "42P01") return { database: "not-installed", code };
    console.error("Health check:", describeError(error), code ?? "");
    return { database: "unreachable", code };
  }
}

export async function GET() {
  // Answered when asked, never worked out ahead of time at build.
  await connection();
  if (!last || Date.now() - last.at > 60_000) last = { at: Date.now(), result: Promise.all([probe(), poolCheck()]) };
  const [database, pool] = await last.result;
  const sample = isDemoMode();
  const ready = sample ? pool === "ok" : liveConfigProblem() === null && database.database === "ok" && pool === "ok";
  return Response.json({ mode: sample ? "sample" : "live", ready, ...database, pool, build: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, { headers: { "cache-control": "no-store" } });
}
