import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { budgets } from "@/db/schema";
import { monthOf } from "@/lib/dates";
import { HttpError, readBody, withUser } from "@/server/http";
import { setBudget, setRollover } from "@/server/mutations";
import { getBudget } from "@/server/queries";

export const GET = withUser(async (ctx, request) => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return getBudget(ctx, /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthOf(ctx.today));
});

const Body = z.object({
  category: z.string().max(40),
  monthlyLimit: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /** Rollover on or off. */
  rollover: z.boolean().optional(),
  /** Sent by Undo with a limit, to put rollover back exactly as it was. */
  rolloverSince: z.string().max(7).nullable().optional(),
});

/** One category: its limit, or rollover. Answers with what it was before, for Undo. */
export const PUT = withUser(async (ctx, request) => {
  const body = await readBody(request, Body);
  const [before] = await ctx.db.select().from(budgets).where(and(eq(budgets.userId, ctx.userId), eq(budgets.category, body.category))).limit(1);
  const previous = { monthlyLimit: before?.monthlyLimit ?? null, rolloverSince: before?.rolloverSince ?? null };
  if (body.rollover !== undefined) await setRollover(ctx, body.category, body.rollover);
  else if (body.monthlyLimit !== undefined) await setBudget(ctx, body.category, body.monthlyLimit, body.rolloverSince !== undefined ? { rolloverSince: body.rolloverSince } : {});
  else throw new HttpError(400, "Nothing to change.");
  return { ok: true, previous };
});
