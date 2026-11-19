import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setRecurringOverride } from "@/server/mutations";
import { getRecurring } from "@/server/queries";

export const GET = withUser((ctx) => getRecurring(ctx));

const Body = z.object({ key: z.string().min(1).max(200), kind: z.enum(["bill", "subscription", "ignore"]).optional(), cancelled: z.boolean().optional() });

export const PATCH = withUser(async (ctx, request) => {
  const { key, ...patch } = await readBody(request, Body);
  await setRecurringOverride(ctx, key, patch);
  return { ok: true };
});
