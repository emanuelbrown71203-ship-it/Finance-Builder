import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { isDemoMode } from "@/lib/config";
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
  const url = process.env.DATABASE_URL;
  if (url && !isDemoMode()) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare:false keeps us compatible with Supabase’s transaction pooler.
    const client = postgres(url, { prepare: false, max: 5 });
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
