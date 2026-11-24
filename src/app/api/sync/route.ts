import { after } from "next/server";
import { plaidConfig } from "@/lib/config";
import { describeError } from "@/server/errors";
import { withUser } from "@/server/http";
import { afterSync } from "@/server/notifications";
import { syncAllForUser } from "@/server/plaid";

/** "Refresh now": pulls the latest from every linked bank. */
export const POST = withUser(async (ctx) => {
  if (!ctx.demo && plaidConfig()) {
    await syncAllForUser(ctx.db, ctx.userId);
    // Notes about what just came in go out once the screen has its answer.
    after(() => afterSync(ctx.db, ctx.userId).catch((error) => console.error("Notifications failed:", describeError(error))));
  }
  return { ok: true };
});
