import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { nameRules, transactions } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { RULE_KEY_PATTERN, cleanName, looksUnclear, namer, validName, type NameRule, type Namer } from "@/lib/finance/names";
import type { NameRuleView, NamesPayload, UnclearName } from "@/lib/types";
import type { Ctx } from "./auth";
import { win } from "./game";
import { HttpError } from "./http";

/*
 * Name rules: "every charge the bank calls X is Y". Read-time only: the
 * transactions keep the bank's own text, so removing a rule puts every name
 * back, and bills, remembered categories and the Tasks for Two link (which
 * match on the bank's text) are never affected by a rename.
 */

const MAX_NAME_RULES = 500;
const PREVIEW = "__preview__";

export async function loadNameRules(ctx: Ctx): Promise<NameRule[]> {
  return ctx.db
    .select({ id: nameRules.id, key: nameRules.merchantKey, amount: nameRules.amount, name: nameRules.name })
    .from(nameRules)
    .where(eq(nameRules.userId, ctx.userId))
    .orderBy(asc(nameRules.createdAt), asc(nameRules.id));
}

export async function loadNamer(ctx: Ctx): Promise<Namer> {
  return namer(await loadNameRules(ctx));
}

function checkName(input: string): string {
  const name = validName(input);
  if (!name) throw new HttpError(400, "Give it a name of up to 60 letters.");
  return name;
}

async function ownTransaction(ctx: Ctx, id: string) {
  const [tx] = await ctx.db
    .select({ id: transactions.id, name: transactions.name, amount: transactions.amount, customName: transactions.customName })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)))
    .limit(1);
  if (!tx) throw new HttpError(404, "Transaction not found.");
  return tx;
}

/** Every distinct bank text, in each direction it's been seen. Small: one row per place, not per charge. */
export async function bankNames(ctx: Ctx, options: { since?: string; withoutOwnName?: boolean } = {}) {
  const where = and(eq(transactions.userId, ctx.userId), options.since ? gte(transactions.date, options.since) : undefined, options.withoutOwnName ? isNull(transactions.customName) : undefined);
  return ctx.db.selectDistinct({ name: transactions.name, incoming: sql<boolean>`${transactions.amount} > 0` }).from(transactions).where(where);
}

/**
 * How many charges (without a one-off name) end up named by `ruleId` under
 * `rules`, and which bank texts they come from.
 */
async function countNamedBy(ctx: Ctx, rules: NameRule[], key: string, ruleId: string): Promise<{ count: number; bankNames: string[] }> {
  const resolve = namer(rules);
  const incoming = key.startsWith("in:");
  const names = [...new Set((await bankNames(ctx)).filter((r) => r.incoming === incoming && resolve.keyOf(r.name, incoming ? 1 : -1) === key).map((r) => r.name))];
  if (names.length === 0) return { count: 0, bankNames: [] };
  const rows = await ctx.db
    .select({ name: transactions.name, amount: transactions.amount, n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), isNull(transactions.customName), inArray(transactions.name, names.slice(0, 500)), incoming ? sql`${transactions.amount} > 0` : sql`${transactions.amount} <= 0`))
    .groupBy(transactions.name, transactions.amount);
  let count = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (resolve(r).ruleId !== ruleId) continue;
    count += r.n;
    seen.add(r.name);
  }
  return { count, bankNames: [...seen].slice(0, 3) };
}

/** Saves a rule, replacing the name of one already there. Safe when two saves arrive at once. */
async function saveRule(ctx: Ctx, rule: { key: string; amount: number; name: string }) {
  const [existing] = await ctx.db
    .select({ id: nameRules.id, name: nameRules.name })
    .from(nameRules)
    .where(and(eq(nameRules.userId, ctx.userId), eq(nameRules.merchantKey, rule.key), eq(nameRules.amount, rule.amount)))
    .limit(1);
  if (!existing) {
    const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(nameRules).where(eq(nameRules.userId, ctx.userId));
    if (count >= MAX_NAME_RULES) throw new HttpError(400, "You’ve reached the limit of saved names. Remove some under Names first.");
  }
  const [saved] = await ctx.db
    .insert(nameRules)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, merchantKey: rule.key, amount: rule.amount, name: rule.name })
    .onConflictDoUpdate({ target: [nameRules.userId, nameRules.merchantKey, nameRules.amount], set: { name: rule.name } })
    .returning({ id: nameRules.id });
  return { id: saved.id, previousName: existing?.name ?? null };
}

export type NameUndo = {
  ruleId: string;
  key: string;
  previousName: string | null;
  transactionId: string;
  /** The one-off name this rename cleared, to put back. */
  customName: string | null;
  /** A name for just this amount that "every charge" replaced, to put back. */
  replaced: { amount: number; name: string } | null;
};

/**
 * Names every charge like this one, past and future. With `onlyThisAmount`,
 * only charges of exactly the same amount (for Venmo and the like).
 * `fromItsSheet` is true when the person is renaming this very charge, so a
 * name they gave it alone makes way; from a bill or the Names screen it stays.
 */
export async function createNameRule(
  ctx: Ctx,
  input: { transactionId: string; name: string; onlyThisAmount?: boolean; fromItsSheet?: boolean; keepOneAmountNames?: boolean },
): Promise<{ ruleId: string; count: number; undo: NameUndo }> {
  const name = checkName(input.name);
  const tx = await ownTransaction(ctx, input.transactionId);
  const key = namer([]).keyOf(tx.name, tx.amount);
  if (!RULE_KEY_PATTERN.test(key)) throw new HttpError(400, "This one can only be renamed on its own.");
  const amount = input.onlyThisAmount ? tx.amount : 0;
  const saved = await saveRule(ctx, { key, amount, name });

  // "Every charge like this" includes this one: a name kept for just its amount would hide the new name.
  let replaced: NameUndo["replaced"] = null;
  // Nickel and Claude never take away a name the owner kept for one amount (`keepOneAmountNames`).
  if (amount === 0 && tx.amount !== 0 && !input.keepOneAmountNames) {
    const [exact] = await ctx.db
      .delete(nameRules)
      .where(and(eq(nameRules.userId, ctx.userId), eq(nameRules.merchantKey, key), eq(nameRules.amount, tx.amount)))
      .returning({ name: nameRules.name });
    if (exact) replaced = { amount: tx.amount, name: exact.name };
  }
  let customName: string | null = null;
  if (input.fromItsSheet && tx.customName) {
    customName = tx.customName;
    await ctx.db.update(transactions).set({ customName: null }).where(and(eq(transactions.id, tx.id), eq(transactions.userId, ctx.userId)));
  }
  const { count } = await countNamedBy(ctx, await loadNameRules(ctx), key, saved.id);
  await win(ctx, "rename", `rule:${key}`, name);
  return { ruleId: saved.id, count, undo: { ruleId: saved.id, key, previousName: saved.previousName, transactionId: tx.id, customName, replaced } };
}

/** How many charges a rename would change, before it's saved. Works it out exactly as saving would. */
export async function previewNameRule(ctx: Ctx, transactionId: string, onlyThisAmount: boolean): Promise<{ count: number; bankNames: string[] }> {
  const tx = await ownTransaction(ctx, transactionId);
  const key = namer([]).keyOf(tx.name, tx.amount);
  if (!RULE_KEY_PATTERN.test(key)) return { count: 1, bankNames: [tx.name] };
  const amount = onlyThisAmount ? tx.amount : 0;
  const rules = (await loadNameRules(ctx)).filter((r) => !(r.key === key && (r.amount === amount || (amount === 0 && r.amount === tx.amount))));
  return countNamedBy(ctx, [...rules, { id: PREVIEW, key, amount, name: "" }], key, PREVIEW);
}

export async function renameRule(ctx: Ctx, id: string, input: string): Promise<{ previousName: string }> {
  const name = checkName(input);
  const [rule] = await ctx.db.select({ name: nameRules.name }).from(nameRules).where(and(eq(nameRules.id, id), eq(nameRules.userId, ctx.userId))).limit(1);
  if (!rule) throw new HttpError(404, "That name isn’t saved any more.");
  await ctx.db.update(nameRules).set({ name }).where(and(eq(nameRules.id, id), eq(nameRules.userId, ctx.userId)));
  return { previousName: rule.name };
}

export async function deleteNameRule(ctx: Ctx, id: string): Promise<{ rule: { key: string; amount: number; name: string } }> {
  const [rule] = await ctx.db
    .delete(nameRules)
    .where(and(eq(nameRules.id, id), eq(nameRules.userId, ctx.userId)))
    .returning({ key: nameRules.merchantKey, amount: nameRules.amount, name: nameRules.name });
  if (!rule) throw new HttpError(404, "That name isn’t saved any more.");
  return { rule };
}

/** Undo of a removal: puts the rule back as it was. */
export async function restoreNameRule(ctx: Ctx, input: { key: string; amount: number; name: string }): Promise<{ ruleId: string }> {
  if (!RULE_KEY_PATTERN.test(input.key) || !Number.isSafeInteger(input.amount) || (input.amount !== 0 && input.amount > 0 !== input.key.startsWith("in:"))) {
    throw new HttpError(400, "That name can’t be put back.");
  }
  const saved = await saveRule(ctx, { key: input.key, amount: input.amount, name: checkName(input.name) });
  return { ruleId: saved.id };
}

/** The Names screen: the person's saved names, and bank text that could be clearer. */
export async function getNames(ctx: Ctx): Promise<NamesPayload> {
  const [rules, rows] = await Promise.all([
    loadNameRules(ctx),
    ctx.db
      .select({ id: transactions.id, date: transactions.date, name: transactions.name, rawName: transactions.rawName, amount: transactions.amount, category: transactions.category, customName: transactions.customName })
      .from(transactions)
      .where(eq(transactions.userId, ctx.userId))
      .orderBy(desc(transactions.date), desc(transactions.createdAt)),
  ]);
  const resolve = namer(rules);

  type Group = { key: string; bankName: string; rawName: string | null; count: number; open: number; lastDate: string; sampleId: string | null; amount: number; category: string };
  const groups = new Map<string, Group>();
  const byRule = new Map<string, { count: number; bankNames: Set<string>; lastDate: string | null }>();
  for (const t of rows) {
    const key = resolve.keyOf(t.name, t.amount);
    if (!key) continue;
    const named = resolve(t);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, bankName: t.name, rawName: t.rawName, count: 0, open: 0, lastDate: t.date, sampleId: null, amount: t.amount, category: t.category }));
    g.count++;
    // Charges still going by bank code: no name of their own and no rule. The newest one is what "Keep" renames from.
    if (named.source !== "custom" && named.source !== "rule") {
      g.open++;
      g.sampleId ??= t.id;
    }
    if (named.ruleId) {
      const r = byRule.get(named.ruleId) ?? { count: 0, bankNames: new Set<string>(), lastDate: null };
      r.count++;
      r.bankNames.add(t.rawName || t.name);
      r.lastDate ??= t.date;
      byRule.set(named.ruleId, r);
    }
  }

  const ruleViews: NameRuleView[] = rules
    .map((r) => {
      const hit = byRule.get(r.id);
      return { id: r.id, name: r.name, amount: r.amount, key: r.key, bankNames: [...(hit?.bankNames ?? [])].slice(0, 3), count: hit?.count ?? 0, lastDate: hit?.lastDate ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const unclear: UnclearName[] = [...groups.values()]
    .filter((g) => g.open > 0 && g.sampleId && looksUnclear(g.bankName))
    .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1))
    .slice(0, 60)
    .map((g) => ({ key: g.key, bankName: g.rawName || g.bankName, suggestion: cleanName(g.bankName), count: g.open, lastDate: g.lastDate, sampleId: g.sampleId!, amount: g.amount, category: g.category }));

  return { rules: ruleViews, unclear };
}

/** For Nickel: how many places in the last three months still go by bank code. */
export async function countUnclear(ctx: Ctx): Promise<{ count: number; example: string | null }> {
  const [rules, rows] = await Promise.all([loadNameRules(ctx), bankNames(ctx, { since: addDays(ctx.today, -90), withoutOwnName: true })]);
  const resolve = namer(rules);
  const keys = new Map<string, string>();
  for (const r of rows) {
    if (!looksUnclear(r.name) || resolve.base(r.name, r.incoming).source === "rule") continue;
    const key = resolve.keyOf(r.name, r.incoming ? 1 : -1);
    if (key && !keys.has(key)) keys.set(key, r.name);
  }
  return { count: keys.size, example: keys.values().next().value ?? null };
}
