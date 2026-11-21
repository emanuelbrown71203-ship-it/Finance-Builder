import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { BILL_FREQUENCIES, createManualBill } from "@/server/manual-bills";

const Body = z.object({
  name: z.string().max(200),
  /** What the bill costs, in cents (positive). */
  amount: z.number().int(),
  frequency: z.enum(BILL_FREQUENCIES),
  startDate: z.string().max(10),
  kind: z.enum(["bill", "subscription"]).optional(),
  category: z.string().max(40).optional(),
});

/** Adds a bill by hand: one the bank can't show yet, or a one-off coming up. */
export const POST = withUser(async (ctx, request) => {
  const bill = await createManualBill(ctx, await readBody(request, Body), "you");
  return { id: bill.id };
});
