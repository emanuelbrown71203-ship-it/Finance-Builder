import { z } from "zod";
import { confirmWithPassword } from "@/server/auth";
import { readBody, withUser } from "@/server/http";

const Body = z.object({ password: z.string().min(1).max(200) });

/** "Confirm it's you": re-enter the password before changing how the account is reached. */
export const POST = withUser(async (ctx, request) => {
  const body = await readBody(request, Body);
  await confirmWithPassword(ctx, body.password);
  return { ok: true };
});
