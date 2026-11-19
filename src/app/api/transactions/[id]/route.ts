import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { updateTransaction } from "@/server/mutations";

const Body = z.object({ category: z.string().optional(), note: z.string().max(500).nullable().optional() });

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => {
  await updateTransaction(ctx, id, await readBody(request, Body));
  return { ok: true };
});
