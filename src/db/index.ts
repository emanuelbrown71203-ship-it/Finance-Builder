import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { databaseTls, databaseUrl, isDemoMode, liveConfigProblem } from "@/lib/config";
import { MIGRATION_STATEMENTS } from "./embedded-migrations";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * With DATABASE_URL set we talk to real Postgres (Supabase in production).
 * Without it we run PGlite, which is Postgres compiled to WebAssembly, inside
 * the server process. Same SQL either way, so the demo exercises the same
 * queries production does.
 *
 * Demo mode always uses PGlite, even if DATABASE_URL is set, so sample data
 * can never be written into a real database.
 */
async function connect(): Promise<DB> {
  // Real data never falls back to the in-memory database, where it would vanish on the next restart.
  const problem = liveConfigProblem();
  if (problem) throw new Error(problem);
  const url = databaseUrl();
  if (url && !isDemoMode()) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false keeps us compatible with Supabase’s transaction pooler.
    // Encrypted in transit whatever the address says: the driver's own default is plain text.
    const client = postgres(url, { prepare: false, max: 5, ...databaseTls(url) });
    return drizzle(client, { schema }) as unknown as DB;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = process.env.PGLITE_DIR ? new PGlite(process.env.PGLITE_DIR) : new PGlite();
  const exists = await client.query<{ t: string | null }>("select to_regclass('public.users')::text as t");
  if (!exists.rows[0]?.t) {
    for (const statement of MIGRATION_STATEMENTS) await client.exec(statement);
  }
  return drizzle(client, { schema }) as unknown as DB;
}

const globalForDb = globalThis as unknown as { __passbookDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!globalForDb.__passbookDb) {
    globalForDb.__passbookDb = connect().catch((error) => {
      globalForDb.__passbookDb = undefined;
      throw error;
    });
  }
  return globalForDb.__passbookDb;
}

export { schema };
