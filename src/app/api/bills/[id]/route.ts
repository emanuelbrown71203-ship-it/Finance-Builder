import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { BILL_FREQUENCIES, deleteManualBill, updateManualBill } from "@/server/manual-bills";

const Body = z.object({
  name: z.string().max(200).optional(),
  amount: z.number().int().optional(),
  frequency: z.enum(BILL_FREQUENCIES).optional(),
  startDate: z.string().max(10).optional(),
  kind: z.enum(["bill", "subscription"]).optional(),
  category: z.string().max(40).optional(),
  cancelled: z.boolean().optional(),
});

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => {
  const { before } = await updateManualBill(ctx, id, await readBody(request, Body));
  return { before };
});

/** Removes a bill added by hand; the answer is what Undo needs to put it back. */
export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => ({ bill: await deleteManualBill(ctx, id) }));
