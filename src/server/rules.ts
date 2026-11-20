import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { categoryRules } from "@/db/schema";

/** merchant → category for one person, for sorting new transactions as they arrive. */
export async function loadRules(db: DB, userId: string): Promise<Map<string, string>> {
  const rows = await db.select({ merchantKey: categoryRules.merchantKey, category: categoryRules.category }).from(categoryRules).where(eq(categoryRules.userId, userId));
  return new Map(rows.map((r) => [r.merchantKey, r.category]));
}
