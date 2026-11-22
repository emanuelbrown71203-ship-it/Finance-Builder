import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setBudgets } from "@/server/mutations";

const Body = z.object({
  limits: z
    .array(
      z.object({
        category: z.string().max(40),
        monthlyLimit: z.number().int().min(0).max(100_000_000).nullable(),
        rolloverSince: z.string().max(7).nullable().optional(),
        rolloverCarry: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(20),
});

/** Several limits at once: a starting budget, or the Undo of one. Answers with what each was before. */
export const POST = withUser(async (ctx, request) => {
  const { limits } = await readBody(request, Body);
  return setBudgets(ctx, limits);
});
