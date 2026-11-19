import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { createGoal } from "@/server/mutations";
import { getGoals } from "@/server/queries";

export const GET = withUser((ctx) => getGoals(ctx));

const money = z.number().int().min(0).max(100_000_000_000);
const Body = z.object({
  name: z.string().trim().min(1).max(80),
  target: money.min(100),
  saved: money.default(0),
  monthlyContribution: money.default(0),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});

export const POST = withUser(async (ctx, request) => {
  await createGoal(ctx, await readBody(request, Body));
  return { ok: true };
});
