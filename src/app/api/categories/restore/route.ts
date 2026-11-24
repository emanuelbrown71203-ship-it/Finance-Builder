import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { restoreCategory } from "@/server/categories";

const Body = z.object({
  category: z.object({ key: z.string().max(40), label: z.string().min(1).max(60), icon: z.string().max(30) }),
  transactionIds: z.array(z.string().max(100)).max(5_000),
  rules: z.array(z.string().max(200)).max(2_000),
  budget: z.object({ monthlyLimit: z.number().int().min(0).max(100_000_000), rolloverSince: z.string().regex(/^\d{4}-\d{2}$/).nullable(), rolloverCarry: z.number().int().min(-100_000_000).max(100_000_000) }).nullable(),
});

/** Undo of removing a category. */
export const POST = withUser(async (ctx, request) => {
  await restoreCategory(ctx, await readBody(request, Body));
  return { ok: true };
});
