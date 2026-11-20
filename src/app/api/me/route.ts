import { eq } from "drizzle-orm";
import { items, users } from "@/db/schema";
import { SESSION_COOKIE, plaidConfig } from "@/lib/config";
import type { Me } from "@/lib/types";
import { HttpError, json, withUser } from "@/server/http";
import { removeItem } from "@/server/plaid";

export const GET = withUser(async (ctx): Promise<Me> => {
  const plaid = plaidConfig();
  return {
    user: { name: ctx.user.name, email: ctx.user.email },
    demo: ctx.demo,
    today: ctx.today,
    bankLinking: { available: !ctx.demo && plaid !== null, sandbox: plaid?.env === "sandbox" },
  };
});

/**
 * Deletes the account and everything kept for it: bank connections are
 * revoked at Plaid first, then every row belonging to this person is removed.
 * If a bank connection can't be revoked, nothing is deleted and the person is
 * told, so no live connection is ever left behind with no way to switch it off.
 */
export const DELETE = withUser(async (ctx) => {
  if (ctx.demo) throw new HttpError(400, "The sample household can’t be deleted. It starts over each day on its own.");
  const linked = await ctx.db.select({ id: items.id }).from(items).where(eq(items.userId, ctx.userId));
  for (const item of linked) await removeItem(ctx.db, ctx.userId, item.id);
  await ctx.db.delete(users).where(eq(users.id, ctx.userId));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return json({ ok: true }, { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } });
}, { fresh: true });
