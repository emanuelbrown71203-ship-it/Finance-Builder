/**
 * Prints the SQL that sets Passbook up inside a database it shares with other
 * apps (the owner's Supabase project), walled off from them:
 *
 *   - every table lives in its own schema ("passbook"), never in "public",
 *     which Supabase serves to browsers;
 *   - the app signs in as its own role, which can read and write Passbook's
 *     tables and nothing else, and cannot change the database's structure;
 *   - row level security is on for every table, with access for that role
 *     only, so nothing opens up even if the schema were ever exposed.
 *
 * The role itself (and its password) is created separately, so no password
 * is ever written to a file:
 *
 *   create role passbook_app login password '<generated>';
 *
 * Usage: npx tsx scripts/install-sql.ts [--from <n>] > install.sql
 *   --from <n>  only migrations from number n on (to update an existing install)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = "passbook";
const ROLE = "passbook_app";
const fromIndex = process.argv.includes("--from") ? Number(process.argv[process.argv.indexOf("--from") + 1]) : 0;

const dir = join(process.cwd(), "drizzle");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const out: string[] = [];

if (fromIndex === 0) {
  out.push(
    `create schema if not exists ${SCHEMA};`,
    `revoke all on schema ${SCHEMA} from public;`,
    `grant usage on schema ${SCHEMA} to ${ROLE};`,
    `alter role ${ROLE} set search_path = ${SCHEMA};`,
  );
}
out.push(`set local search_path = ${SCHEMA};`);

const tables = new Set<string>();
for (const file of files) {
  const number = Number(file.slice(0, 4));
  const sql = readFileSync(join(dir, file), "utf8");
  for (const match of sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)) if (number >= fromIndex) tables.add(match[1]);
  if (number < fromIndex) continue;
  out.push(`-- ${file}`);
  // The generated migrations name the "public" schema in their foreign keys. Here every table is in ours.
  for (const statement of sql.split("--> statement-breakpoint")) out.push(statement.trim().replaceAll('"public".', `"${SCHEMA}".`));
}

out.push(`grant select, insert, update, delete on all tables in schema ${SCHEMA} to ${ROLE};`);
for (const table of tables) {
  out.push(
    `alter table ${SCHEMA}."${table}" enable row level security;`,
    `create policy "${table}_app_only" on ${SCHEMA}."${table}" for all to ${ROLE} using (true) with check (true);`,
  );
}
console.log(out.filter(Boolean).join("\n"));
