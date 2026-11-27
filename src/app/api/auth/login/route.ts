import { z } from "zod";
import { signIn } from "@/server/auth";
import { HttpError, json, publicRoute } from "@/server/http";
import { clientAddress, limit, limitKey } from "@/server/rate-limit";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export const POST = publicRoute(async (request) => {
  await limit(request, "login", 20, 10 * 60_000);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Enter your email and password.");
  const email = parsed.data.email.trim().toLowerCase();
  // The tight limit is per account and per address together, so a stranger hammering
  // someone's email from elsewhere can't lock the real owner out of their own account.
  await limitKey("login-pair", `${email}|${clientAddress(request)}`, 10, 15 * 60_000);
  // A higher ceiling across all addresses slows guesses spread over many of them: 50 an hour is far
  // too few to guess a password, and more than one address can reach alone (40 an hour above), so
  // shutting the owner's password sign-in takes several. (Face ID signs in regardless.)
  await limitKey("login-account", email, 50, 60 * 60_000);
  const result = await signIn(parsed.data, request);
  if (!result.ok) throw new HttpError(401, result.error);
  return json({ ok: true }, { headers: { "set-cookie": result.cookie } });
});
