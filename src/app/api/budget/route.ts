import { z } from "zod";
import { monthOf } from "@/lib/dates";
import { readBody, withUser } from "@/server/http";
import { setBudget } from "@/server/mutations";
import { getBudget } from "@/server/queries";

export const GET = withUser(async (ctx, request) => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return getBudget(ctx, /^\d{4}-\d{2}$/.test(month) ? month : monthOf(ctx.today));
});

const Body = z.object({ category: z.string(), monthlyLimit: z.number().int().min(0).max(100_000_000).nullable() });

export const PUT = withUser(async (ctx, request) => {
  const body = await readBody(request, Body);
  await setBudget(ctx, body.category, body.monthlyLimit);
  return { ok: true };
});
