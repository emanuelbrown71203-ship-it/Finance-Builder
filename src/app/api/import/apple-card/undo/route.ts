import { z } from "zod";
import { undoAppleCardImport } from "@/server/card-import";
import { readBody, withUser } from "@/server/http";

/** Undo for one Apple Card import: takes out exactly what it added, and puts back the taps it confirmed or dropped. */
/** A real calendar date, written YYYY-MM-DD. */
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, "Not a real date");
const cents = z.number().int().min(-100_000_000).max(100_000_000);
const Body = z.object({
  batch: z.string().datetime(),
  to: date,
  previousOwed: z.number().int().min(0).max(100_000_000).nullable(),
  owed: z.number().int().min(0).max(100_000_000),
  earned: z.boolean(),
  confirmed: z.array(z.string().min(1).max(64)).max(2000).optional(),
  removed: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        date,
        name: z.string().min(1).max(120),
        amount: cents,
        category: z.string().min(1).max(40),
        categoryLocked: z.boolean(),
        note: z.string().max(500).nullable(),
        customName: z.string().max(120).nullable(),
        createdAt: z.string().datetime(),
      }),
    )
    .max(500)
    .optional(),
});

export const POST = withUser(async (ctx, request) => {
  await undoAppleCardImport(ctx, await readBody(request, Body));
  return { ok: true };
});
