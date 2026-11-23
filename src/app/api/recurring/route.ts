import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setRecurringOverride } from "@/server/mutations";
import { getRecurring } from "@/server/queries";

export const GET = withUser((ctx) => getRecurring(ctx));

const Body = z.object({
  key: z.string().min(1).max(200),
  // Null puts it back to what Passbook worked out (Undo of "not a subscription").
  kind: z.enum(["bill", "subscription", "ignore"]).nullable().optional(),
  cancelled: z.boolean().optional(),
  /** A shared bill: the part that's yours, from 5% to all of it. Null is all of it. */
  share: z.number().min(0.05).max(1).nullable().optional(),
});

export const PATCH = withUser(async (ctx, request) => {
  const { key, ...patch } = await readBody(request, Body);
  await setRecurringOverride(ctx, key, patch);
  return { ok: true };
});
