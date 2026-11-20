import { asc, eq } from "drizzle-orm";
import { categoryRules } from "@/db/schema";
import { withUser } from "@/server/http";

/** The merchants this person has given a fixed category. */
export const GET = withUser(async (ctx) => {
  const rules = await ctx.db
    .select({ id: categoryRules.id, merchant: categoryRules.merchantKey, category: categoryRules.category })
    .from(categoryRules)
    .where(eq(categoryRules.userId, ctx.userId))
    .orderBy(asc(categoryRules.merchantKey));
  return { rules };
});
