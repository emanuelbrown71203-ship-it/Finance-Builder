import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { updateTransaction } from "@/server/mutations";

const Body = z.object({
  category: z.string().max(40).optional(),
  note: z.string().max(500).nullable().optional(),
  /** Also use this category for every other charge from the same merchant, now and in future. */
  remember: z.boolean().optional(),
  /** Sent by Undo: what the remembered change replaced. */
  restore: z
    .object({
      rule: z.string().max(40).nullable(),
      others: z.array(z.object({ id: z.string().max(80), category: z.string().max(40) })).max(5000),
    })
    .optional(),
});

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => {
  return updateTransaction(ctx, id, await readBody(request, Body));
});
