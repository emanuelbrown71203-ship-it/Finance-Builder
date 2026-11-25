import { after } from "next/server";
import { z } from "zod";
import { plaidConfig } from "@/lib/config";
import { describeError } from "@/server/errors";
import { withUser } from "@/server/http";
import { afterSync } from "@/server/notifications";
import { syncAllForUser } from "@/server/plaid";

/** Sent by the app's follow-up look a little after a pull, which shouldn't ask the banks again. */
const Body = z.object({ refresh: z.boolean().optional() });

/**
 * "Refresh now": asks every linked bank to check for anything new (at most every few minutes each), then
 * pulls the latest Plaid has. `refreshing` says a bank is still checking, so the app looks again shortly.
 */
export const POST = withUser(async (ctx, request) => {
  if (ctx.demo || !plaidConfig()) return { ok: true, refreshing: false };
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  const { refreshing } = await syncAllForUser(ctx.db, ctx.userId, { refresh: parsed.success ? parsed.data.refresh !== false : true });
  // Notes about what just came in go out once the screen has its answer.
  after(() => afterSync(ctx.db, ctx.userId).catch((error) => console.error("Notifications failed:", describeError(error))));
  return { ok: true, refreshing };
});
