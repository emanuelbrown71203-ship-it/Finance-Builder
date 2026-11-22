import { z } from "zod";
import { undoAppleCardImport } from "@/server/card-import";
import { readBody, withUser } from "@/server/http";

/** Undo for one Apple Card import: takes out exactly what it added. */
const Body = z.object({
  batch: z.string().datetime(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  previousOwed: z.number().int().min(0).max(100_000_000).nullable(),
  owed: z.number().int().min(0).max(100_000_000),
  earned: z.boolean(),
});

export const POST = withUser(async (ctx, request) => {
  await undoAppleCardImport(ctx, await readBody(request, Body));
  return { ok: true };
});
