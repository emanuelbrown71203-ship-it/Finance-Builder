import { and, eq, inArray } from "drizzle-orm";
import { budgets, categoryRules, transactions, userCategories } from "@/db/schema";
import { CATEGORIES, CATEGORY_ICONS, isCustomKey, type UserCategory } from "@/lib/categories";
import type { Ctx } from "./auth";
import { HttpError } from "./http";

/** The most categories of their own one person keeps. */
const MAX = 40;

export async function loadUserCategories(ctx: Pick<Ctx, "db" | "userId">): Promise<UserCategory[]> {
  const rows = await ctx.db.select({ key: userCategories.key, label: userCategories.label, icon: userCategories.icon }).from(userCategories).where(eq(userCategories.userId, ctx.userId));
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a category key is one this person may use: built in, or one of their own. */
export async function isUsableCategory(ctx: Ctx, key: string, opts: { budget?: boolean } = {}): Promise<boolean> {
  if (CATEGORIES.some((c) => c.key === key)) return !opts.budget || (key !== "transfer" && key !== "income");
  if (!isCustomKey(key)) return false;
  const [row] = await ctx.db.select({ key: userCategories.key }).from(userCategories).where(and(eq(userCategories.key, key), eq(userCategories.userId, ctx.userId))).limit(1);
  return !!row;
}

function checked(ctx: Ctx, input: { label?: string; icon?: string }, existing: UserCategory[], key?: string) {
  const label = input.label?.replace(/\s+/g, " ").trim();
  if (input.label !== undefined) {
    if (!label || label.length > 30) throw new HttpError(400, "Give it a name of up to 30 letters.");
    const taken = [...CATEGORIES.map((c) => c.label), ...existing.filter((c) => c.key !== key).map((c) => c.label)].some((l) => l.toLowerCase() === label.toLowerCase());
    if (taken) throw new HttpError(400, `There’s already a category called ${label}.`);
  }
  if (input.icon !== undefined && !(CATEGORY_ICONS as readonly string[]).includes(input.icon)) throw new HttpError(400, "Pick one of the icons.");
  return { label, icon: input.icon };
}

/** Makes a category of the person's own. Returns it, with the key transactions will store. */
export async function createCategory(ctx: Ctx, input: { label: string; icon?: string }): Promise<UserCategory> {
  const existing = await loadUserCategories(ctx);
  if (existing.length >= MAX) throw new HttpError(400, `That’s the most categories Passbook keeps (${MAX}). Remove one first.`);
  const { label, icon } = checked(ctx, input, existing);
  const key = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const made = { key, label: label!, icon: icon ?? "other" };
  await ctx.db.insert(userCategories).values({ ...made, userId: ctx.userId });
  return made;
}

export async function updateCategory(ctx: Ctx, key: string, input: { label?: string; icon?: string }): Promise<{ previous: UserCategory }> {
  const existing = await loadUserCategories(ctx);
  const was = existing.find((c) => c.key === key);
  if (!was) throw new HttpError(404, "That category wasn’t found.");
  const { label, icon } = checked(ctx, input, existing, key);
  await ctx.db
    .update(userCategories)
    .set({ ...(label ? { label } : {}), ...(icon ? { icon } : {}) })
    .where(and(eq(userCategories.key, key), eq(userCategories.userId, ctx.userId)));
  return { previous: was };
}

/** What removing a category changed, so Undo can put it all back. */
export type CategoryUndo = { category: UserCategory; transactionIds: string[]; rules: string[]; budget: { monthlyLimit: number; rolloverSince: string | null; rolloverCarry: number } | null };

/**
 * Removes a category of the person's own: its charges go back to Everything else, merchants remembered for
 * it are forgotten, and its budget is set aside. Returns what Undo needs to put it all back.
 */
export async function removeCategory(ctx: Ctx, key: string): Promise<CategoryUndo> {
  const [was] = await ctx.db.select({ key: userCategories.key, label: userCategories.label, icon: userCategories.icon }).from(userCategories).where(and(eq(userCategories.key, key), eq(userCategories.userId, ctx.userId))).limit(1);
  if (!was) throw new HttpError(404, "That category wasn’t found.");
  return ctx.db.transaction(async (tx) => {
    const moved = await tx.update(transactions).set({ category: "other" }).where(and(eq(transactions.userId, ctx.userId), eq(transactions.category, key))).returning({ id: transactions.id });
    const rules = await tx.delete(categoryRules).where(and(eq(categoryRules.userId, ctx.userId), eq(categoryRules.category, key))).returning({ merchantKey: categoryRules.merchantKey });
    const [budget] = await tx.delete(budgets).where(and(eq(budgets.userId, ctx.userId), eq(budgets.category, key))).returning({ monthlyLimit: budgets.monthlyLimit, rolloverSince: budgets.rolloverSince, rolloverCarry: budgets.rolloverCarry, removedAt: budgets.removedAt });
    await tx.delete(userCategories).where(and(eq(userCategories.key, key), eq(userCategories.userId, ctx.userId)));
    return {
      category: was,
      transactionIds: moved.map((m) => m.id),
      rules: rules.map((r) => r.merchantKey),
      budget: budget && !budget.removedAt ? { monthlyLimit: budget.monthlyLimit, rolloverSince: budget.rolloverSince, rolloverCarry: budget.rolloverCarry } : null,
    };
  });
}

/** Undo of removing a category: it, its charges, its remembered merchants and its budget come back. */
export async function restoreCategory(ctx: Ctx, undo: CategoryUndo): Promise<void> {
  const { category: c } = undo;
  if (!isCustomKey(c.key)) throw new HttpError(400, "That isn’t one of your categories.");
  const existing = await loadUserCategories(ctx);
  checked(ctx, { label: c.label, icon: c.icon }, existing, c.key);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(userCategories).values({ key: c.key, userId: ctx.userId, label: c.label, icon: c.icon }).onConflictDoNothing();
    // Only rows that are still this person's, and still where removing put them.
    for (let i = 0; i < undo.transactionIds.length; i += 500) {
      await tx.update(transactions).set({ category: c.key }).where(and(eq(transactions.userId, ctx.userId), eq(transactions.category, "other"), inArray(transactions.id, undo.transactionIds.slice(i, i + 500))));
    }
    if (undo.rules.length > 0) {
      await tx
        .insert(categoryRules)
        .values(undo.rules.slice(0, 2000).map((merchantKey) => ({ id: crypto.randomUUID(), userId: ctx.userId, merchantKey, category: c.key })))
        .onConflictDoNothing();
    }
    if (undo.budget) await tx.insert(budgets).values({ id: crypto.randomUUID(), userId: ctx.userId, category: c.key, ...undo.budget }).onConflictDoNothing();
  });
}
