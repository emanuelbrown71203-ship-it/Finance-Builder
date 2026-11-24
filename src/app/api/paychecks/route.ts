import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setPaycheck } from "@/server/mutations";

/** "This paycheck will be lighter": what one coming paycheck is expected to be, or null for the usual. */
const Body = z.object({
  key: z.string().min(4).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().min(0).max(100_000_000).nullable(),
});

export const PUT = withUser(async (ctx, request) => {
  const { key, date, amount } = await readBody(request, Body);
  return setPaycheck(ctx, key, date, amount);
});
