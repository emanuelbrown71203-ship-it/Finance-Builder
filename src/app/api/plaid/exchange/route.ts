import { z } from "zod";
import { plaidConfig } from "@/lib/config";
import { HttpError, readBody, withUser } from "@/server/http";
import { exchangePublicToken, syncItem } from "@/server/plaid";

const Body = z.object({
  publicToken: z.string().min(1),
  institution: z.object({ id: z.string().nullish(), name: z.string().nullish() }).default({}),
  /** Set when the person repaired an existing connection instead of adding one. */
  repairedInstitutionId: z.string().optional(),
});

export const POST = withUser(async (ctx, request) => {
  if (ctx.demo || !plaidConfig()) throw new HttpError(400, "Bank linking isn’t set up yet.");
  const body = await readBody(request, Body);
  // After a repair the existing access token keeps working; just sync again.
  const itemId = body.repairedInstitutionId ?? (await exchangePublicToken(ctx.db, ctx.userId, body.publicToken, body.institution));
  await syncItem(ctx.db, itemId);
  return { ok: true };
});
