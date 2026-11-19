import { z } from "zod";
import { plaidConfig } from "@/lib/config";
import { HttpError, readBody, withUser } from "@/server/http";
import { createLinkToken } from "@/server/plaid";

const Body = z.object({ institutionId: z.string().optional() });

export const POST = withUser(async (ctx, request) => {
  if (ctx.demo || !plaidConfig()) throw new HttpError(400, "Bank linking isn’t set up yet.");
  const body = await readBody(request, Body);
  return { linkToken: await createLinkToken(ctx.db, ctx.userId, body.institutionId) };
});
