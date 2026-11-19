import { plaidConfig } from "@/lib/config";
import { withUser } from "@/server/http";
import { syncAllForUser } from "@/server/plaid";

/** "Refresh now": pulls the latest from every linked bank. */
export const POST = withUser(async (ctx) => {
  if (!ctx.demo && plaidConfig()) await syncAllForUser(ctx.db, ctx.userId);
  return { ok: true };
});
