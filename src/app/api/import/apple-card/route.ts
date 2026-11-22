import { z } from "zod";
import { importAppleCard, previewAppleCard } from "@/server/card-import";
import { HttpError, readBody, withUser } from "@/server/http";

/*
 * An Apple Card statement the person picked: `preview` says what's in it and
 * what's new; without it, the new purchases are brought in and what's owed is
 * set. The file's text arrives as text and is read here, never trusted as rows.
 * (In the sample household a made-up statement is used instead.)
 */
const Body = z.object({
  text: z.string().min(1).max(240_000),
  preview: z.boolean().optional(),
  /** What the card owes now, in cents. Required to bring a statement in. */
  owed: z.number().int().min(0).max(100_000_000).optional(),
});

export const POST = withUser(async (ctx, request) => {
  const body = await readBody(request, Body);
  if (body.preview) return previewAppleCard(ctx, body.text);
  if (body.owed === undefined) throw new HttpError(400, "Say what the card owes now.");
  return importAppleCard(ctx, body.text, body.owed);
});
