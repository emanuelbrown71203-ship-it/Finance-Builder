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
 * The output is one transaction, and every statement names the schema it
 * acts on. It never relies on a "search path", so it puts the tables in the
 * right place whether it is run as one query or line by line. (An earlier
 * version relied on the search path, and run line by line it would have
 * created the tables in "public", open to browsers.)
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
const fromValue = process.argv.includes("--from") ? (process.argv[process.argv.indexOf("--from") + 1] ?? "") : "0";
if (process.argv.some((a) => a.startsWith("--from=")) || !/^\d+$/.test(fromValue)) throw new Error("Write it as: --from 3 (a space, then the first migration to include)");
if (!Number.isInteger(fromIndex) || fromIndex < 0) throw new Error("--from needs a whole number: the first migration to include, e.g. --from 3");

const dir = join(process.cwd(), "drizzle");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const out: string[] = ["begin;"];

/** Rewrites one generated statement so every table it touches is named with our schema. */
function qualify(statement: string): string {
  const q = `"${SCHEMA}".`;
  return statement
    .replaceAll('"public".', q)
    .replace(/^CREATE TABLE "/, `CREATE TABLE ${q}"`)
    .replace(/^ALTER TABLE "/, `ALTER TABLE ${q}"`)
    .replace(/^(CREATE (?:UNIQUE )?INDEX "[^"]+" ON) "/, `$1 ${q}"`)
    .replace(/^DROP TABLE "/, `DROP TABLE ${q}"`)
    .replace(/^DROP INDEX "/, `DROP INDEX ${q}"`);
}

if (fromIndex === 0) {
  out.push(
    `create schema if not exists ${SCHEMA};`,
    `revoke all on schema ${SCHEMA} from public;`,
    `grant usage on schema ${SCHEMA} to ${ROLE};`,
    `alter role ${ROLE} set search_path = ${SCHEMA};`,
  );
}
const tables = new Set<string>();
for (const file of files) {
  const number = Number(file.slice(0, 4));
  const sql = readFileSync(join(dir, file), "utf8");
  for (const match of sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)) if (number >= fromIndex) tables.add(match[1]);
  if (number < fromIndex) continue;
  out.push(`-- ${file}`);
  for (const raw of sql.split("--> statement-breakpoint")) {
    const statement = raw.trim();
    if (!statement) continue;
    const fixed = qualify(statement);
    // Anything this script doesn't know how to place is refused, not run wherever it happens to land.
    if (!/^(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX "[^"]+" ON|DROP TABLE|DROP INDEX) "passbook"\./.test(fixed)) {
      throw new Error(`${file}: don't know how to place this statement in the ${SCHEMA} schema:\n${statement.slice(0, 200)}`);
    }
    // One statement per chunk, and nothing in it may point at a table outside our schema.
    if (fixed.replace(/;\s*$/, "").includes(";")) throw new Error(`${file}: more than one statement in a chunk:\n${statement.slice(0, 200)}`);
    if (/REFERENCES (?!"passbook"\.)/.test(fixed)) throw new Error(`${file}: a reference to a table outside the ${SCHEMA} schema:\n${statement.slice(0, 200)}`);
    out.push(fixed);
  }
}

out.push(`grant select, insert, update, delete on all tables in schema ${SCHEMA} to ${ROLE};`);
for (const table of tables) {
  out.push(
    `alter table ${SCHEMA}."${table}" enable row level security;`,
    `create policy "${table}_app_only" on ${SCHEMA}."${table}" for all to ${ROLE} using (true) with check (true);`,
  );
}
out.push("commit;");
console.log(out.filter(Boolean).join("\n"));
