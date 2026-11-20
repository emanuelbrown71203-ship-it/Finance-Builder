import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setDebtSettings } from "@/server/mutations";
import { getDebt } from "@/server/queries";

export const GET = withUser((ctx) => getDebt(ctx));

const Body = z.object({ extra: z.number().int().min(0).max(10_000_000).optional(), strategy: z.enum(["avalanche", "snowball"]).optional() });

export const PUT = withUser(async (ctx, request) => {
  await setDebtSettings(ctx, await readBody(request, Body));
  return { ok: true };
});
