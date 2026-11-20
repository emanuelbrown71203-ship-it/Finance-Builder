import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setDebtPlan } from "@/server/mutations";

const Body = z.object({ aprPercent: z.number().min(0).max(100).nullable().optional(), monthlyPayment: z.number().int().min(0).max(100_000_000).nullable().optional() });

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => {
  await setDebtPlan(ctx, id, await readBody(request, Body));
  return { ok: true };
});
