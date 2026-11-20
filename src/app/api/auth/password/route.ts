import { z } from "zod";
import { changePassword } from "@/server/auth";
import { readBody, withUser } from "@/server/http";

const Body = z.object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) });

/** Changes the password. Every other device is signed out. */
export const POST = withUser(async (ctx, request) => {
  const body = await readBody(request, Body);
  await changePassword(ctx, body.current, body.next);
  return { ok: true };
});
