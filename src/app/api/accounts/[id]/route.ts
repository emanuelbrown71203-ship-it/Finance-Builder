import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { deleteManualAccount, updateManualAccount } from "@/server/mutations";

const Body = z.object({ name: z.string().trim().min(1).max(80).optional(), value: z.number().int().min(0).max(100_000_000_000).optional() });

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => {
  await updateManualAccount(ctx, id, await readBody(request, Body));
  return { ok: true };
});

export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => {
  await deleteManualAccount(ctx, id);
  return { ok: true };
});
