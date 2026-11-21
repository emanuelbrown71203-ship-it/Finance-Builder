import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { restoreManualBill } from "@/server/manual-bills";

/** Undo of removing a bill added by hand. */
const Body = z.object({
  id: z.string().max(40),
  name: z.string().max(200),
  amount: z.number().int(),
  frequency: z.string().max(20),
  startDate: z.string().max(10),
  kind: z.string().max(20),
  category: z.string().max(40),
  cancelled: z.boolean(),
  addedBy: z.string().max(10),
});

export const POST = withUser(async (ctx, request) => {
  await restoreManualBill(ctx, await readBody(request, Body));
  return { ok: true };
});
