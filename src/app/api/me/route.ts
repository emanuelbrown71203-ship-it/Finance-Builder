import { customCategories } from "@/lib/categories";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { SESSION_COOKIE, plaidConfig } from "@/lib/config";
import type { Me } from "@/lib/types";
import { HttpError, json, withUser } from "@/server/http";
import { revokeAllForUser } from "@/server/plaid";

export const GET = withUser(async (ctx): Promise<Me> => {
  const plaid = plaidConfig();
  return {
    user: { name: ctx.user.name, email: ctx.user.email },
    demo: ctx.demo,
    today: ctx.today,
    bankLinking: { available: !ctx.demo && plaid !== null, sandbox: plaid?.env === "sandbox" },
    categories: [...customCategories()],
  };
});

/**
 * Deletes the account and everything kept for it: bank connections are
 * revoked at Plaid first, then every row belonging to this person is removed.
 * If any bank connection can't be revoked, nothing is deleted here and the
 * person is told, so no live connection is left behind with no way to switch
 * it off. (Banks already switched off stay switched off; trying again finishes the job.)
 */
export const DELETE = withUser(async (ctx) => {
  if (ctx.demo) throw new HttpError(400, "The sample household can’t be deleted. It starts over each day on its own.");
  // Every bank is switched off at Plaid first. Only when all of them are does anything get deleted.
  await revokeAllForUser(ctx.db, ctx.userId);
  await ctx.db.delete(users).where(eq(users.id, ctx.userId));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return json({ ok: true }, { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } });
}, { fresh: true });
