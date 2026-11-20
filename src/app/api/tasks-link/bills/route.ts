import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { setBillLink } from "@/server/tasks-link";

const Body = z.object({ billId: z.string().min(1).max(80), billName: z.string().max(200), merchant: z.string().max(200).nullable() });

/** Says which merchant at the bank pays a Tasks for Two bill (or unlinks it with null). */
export const PUT = withUser(async (ctx, request) => {
  const body = await readBody(request, Body);
  await setBillLink(ctx, { id: body.billId, name: body.billName }, body.merchant);
  return { ok: true };
});
