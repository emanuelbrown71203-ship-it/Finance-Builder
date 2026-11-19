import { withUser } from "@/server/http";
import { removeItem } from "@/server/plaid";

/** Disconnects a bank: revokes access at Plaid and deletes its accounts and history here. */
export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => {
  await removeItem(ctx.db, ctx.userId, id);
  return { ok: true };
});
