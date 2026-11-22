import { z } from "zod";
import { recordTap } from "@/server/card-taps";
import { HttpError, readBody, withUser } from "@/server/http";

/** The sample household's stand-in for a real tap: shows what a tap does without a link anyone could write to. */
const Body = z.object({ amount: z.number().positive().max(10_000), merchant: z.string().trim().min(1).max(80) });

export const POST = withUser(async (ctx, request) => {
  if (!ctx.demo) throw new HttpError(400, "Real taps come from your iPhone's Shortcuts automation.");
  return recordTap(ctx, await readBody(request, Body));
});
