import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { nameRules, transactions } from "@/db/schema";
import { addDays, addMonths } from "@/lib/dates";
import { cleanName, looksUnclear, nameKey, namer, ruleMatches, validName, type NameRule, type Namer } from "@/lib/finance/names";
import type { NameRuleView, NamesPayload, UnclearName } from "@/lib/types";
import type { Ctx } from "./auth";
import { HttpError } from "./http";

/*
 * Name rules: "every charge the bank calls X is Y". Read-time only: the
 * transactions keep the bank's own text, so removing a rule puts every name
 * back, and bills, remembered categories and the Tasks for Two link (which
 * match on the bank's text) are never affected by a rename.
 */

const MAX_NAME_RULES = 500;
const KEY_PATTERN = /^[a-z& ]{1,200}$/;

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

/** Every charge a rule would name, as long as it hasn't been given a name of its own. */
async function matching(ctx: Ctx, rule: { key: string; amount: number }) {
  const rows = await ctx.db
    .select({ id: transactions.id, name: transactions.name, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.userId, ctx.userId), isNull(transactions.customName)))
    .orderBy(desc(transactions.date));
  return rows.filter((t) => ruleMatches(rule, t));
}

async function saveRule(ctx: Ctx, rule: { key: string; amount: number; name: string }) {
  const [existing] = await ctx.db
    .select({ id: nameRules.id, name: nameRules.name })
    .from(nameRules)
    .where(and(eq(nameRules.userId, ctx.userId), eq(nameRules.merchantKey, rule.key), eq(nameRules.amount, rule.amount)))
    .limit(1);
  if (existing) {
    await ctx.db.update(nameRules).set({ name: rule.name }).where(and(eq(nameRules.id, existing.id), eq(nameRules.userId, ctx.userId)));
    return { id: existing.id, previousName: existing.name };
  }
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(nameRules).where(eq(nameRules.userId, ctx.userId));
  if (count >= MAX_NAME_RULES) throw new HttpError(400, "You’ve reached the limit of saved names. Remove some under Names first.");
  const id = crypto.randomUUID();
  await ctx.db.insert(nameRules).values({ id, userId: ctx.userId, merchantKey: rule.key, amount: rule.amount, name: rule.name });
  return { id, previousName: null };
}

export type NameUndo = { ruleId: string; previousName: string | null; transactionId: string; customName: string | null };

/**
 * Names every charge like this one, past and future. With `onlyThisAmount`,
 * only charges of exactly the same amount (for Venmo and the like).
 */
export async function createNameRule(ctx: Ctx, input: { transactionId: string; name: string; onlyThisAmount?: boolean }): Promise<{ ruleId: string; count: number; undo: NameUndo }> {
  const name = checkName(input.name);
  const tx = await ownTransaction(ctx, input.transactionId);
  const key = nameKey(tx.name);
  if (!KEY_PATTERN.test(key)) throw new HttpError(400, "This one can only be renamed on its own.");
  const amount = input.onlyThisAmount ? tx.amount : 0;
  const saved = await saveRule(ctx, { key, amount, name });
  // A name given to just this one would hide the new name, so it makes way.
  if (tx.customName) await ctx.db.update(transactions).set({ customName: null }).where(and(eq(transactions.id, tx.id), eq(transactions.userId, ctx.userId)));
  const count = (await matching(ctx, { key, amount })).length;
  return { ruleId: saved.id, count, undo: { ruleId: saved.id, previousName: saved.previousName, transactionId: tx.id, customName: tx.customName } };
}

/** How many charges a rename would change, before it's saved. */
export async function previewNameRule(ctx: Ctx, transactionId: string, onlyThisAmount: boolean): Promise<{ count: number; bankNames: string[] }> {
  const tx = await ownTransaction(ctx, transactionId);
  const key = nameKey(tx.name);
  if (!KEY_PATTERN.test(key)) return { count: 1, bankNames: [tx.name] };
  const rows = await matching(ctx, { key, amount: onlyThisAmount ? tx.amount : 0 });
  return { count: rows.length, bankNames: [...new Set(rows.map((r) => r.name))].slice(0, 3) };
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
  if (!KEY_PATTERN.test(input.key) || !Number.isSafeInteger(input.amount)) throw new HttpError(400, "That name can’t be put back.");
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
      .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, addMonths(ctx.today, -13))))
      .orderBy(desc(transactions.date), desc(transactions.createdAt)),
  ]);

  type Group = { key: string; bankName: string; rawName: string | null; count: number; lastDate: string; sampleId: string; amount: number; category: string; named: number };
  const groups = new Map<string, Group>();
  const byKey = new Map<string, typeof rows>();
  const keyOf = new Map<string, string>();
  for (const t of rows) {
    let key = keyOf.get(t.name);
    if (key === undefined) keyOf.set(t.name, (key = nameKey(t.name)));
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (t.customName) g.named++;
    } else groups.set(key, { key, bankName: t.name, rawName: t.rawName, count: 1, lastDate: t.date, sampleId: t.id, amount: t.amount, category: t.category, named: t.customName ? 1 : 0 });
  }

  const ruleViews: NameRuleView[] = rules.map((r) => {
    const hits = (byKey.get(r.key) ?? []).filter((t) => !t.customName && (r.amount === 0 || r.amount === t.amount));
    return { id: r.id, name: r.name, amount: r.amount, key: r.key, bankNames: [...new Set(hits.map((t) => t.rawName || t.name))].slice(0, 3), count: hits.length, lastDate: hits[0]?.date ?? null };
  });
  ruleViews.sort((a, b) => a.name.localeCompare(b.name));

  const covered = new Set(rules.filter((r) => r.amount === 0).map((r) => r.key));
  const unclear: UnclearName[] = [...groups.values()]
    .filter((g) => !covered.has(g.key) && g.named < g.count && looksUnclear(g.bankName))
    .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1))
    .slice(0, 60)
    .map((g) => ({ key: g.key, bankName: g.rawName || g.bankName, suggestion: cleanName(g.bankName), count: g.count, lastDate: g.lastDate, sampleId: g.sampleId, amount: g.amount, category: g.category }));

  return { rules: ruleViews, unclear };
}

/** For Nickel: how many places in the last three months still go by bank code. */
export async function countUnclear(ctx: Ctx): Promise<{ count: number; example: string | null }> {
  const [rules, rows] = await Promise.all([
    loadNameRules(ctx),
    ctx.db
      .selectDistinct({ name: transactions.name })
      .from(transactions)
      .where(and(eq(transactions.userId, ctx.userId), gte(transactions.date, addDays(ctx.today, -90)), isNull(transactions.customName))),
  ]);
  const covered = new Set(rules.filter((r) => r.amount === 0).map((r) => r.key));
  const keys = new Map<string, string>();
  for (const r of rows) {
    if (!looksUnclear(r.name)) continue;
    const key = nameKey(r.name);
    if (key && !covered.has(key) && !keys.has(key)) keys.set(key, r.name);
  }
  return { count: keys.size, example: keys.values().next().value ?? null };
}
