import { z } from "zod";
import { signIn } from "@/server/auth";
import { HttpError, json, publicRoute } from "@/server/http";
import { limit, limitKey } from "@/server/rate-limit";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export const POST = publicRoute(async (request) => {
  await limit(request, "login", 20, 10 * 60_000);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Enter your email and password.");
  // Also per account, so guesses spread across many addresses are slowed just the same.
  await limitKey("login-account", parsed.data.email.trim().toLowerCase(), 10, 15 * 60_000);
  const result = await signIn(parsed.data);
  if (!result.ok) throw new HttpError(401, result.error);
  return json({ ok: true }, { headers: { "set-cookie": result.cookie } });
});
