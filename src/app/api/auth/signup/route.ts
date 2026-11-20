import { z } from "zod";
import { isDemoMode, signupCode } from "@/lib/config";
import { signUp } from "@/server/auth";
import { sameSecret } from "@/server/crypto";
import { HttpError, json, publicRoute } from "@/server/http";
import { limit } from "@/server/rate-limit";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  code: z.string().trim().max(100).default(""),
});

/**
 * New accounts are by invitation. This is one household's app, on its owner's
 * bank-data account: a stranger who finds the address must not be able to
 * sign up. With no invite code set at all, sign-up is closed.
 */
export const POST = publicRoute(async (request) => {
  if (isDemoMode()) throw new HttpError(400, "Accounts are off while the app is showing sample data.");
  await limit(request, "signup", 8, 10 * 60_000);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const expected = signupCode();
  if (!expected) throw new HttpError(403, "New accounts are closed.");
  // Checked before anything else, so nothing about existing accounts is revealed without it.
  if (!sameSecret(parsed.data.code, expected)) throw new HttpError(403, "That invite code isn’t right.");
  const result = await signUp(parsed.data);
  if (!result.ok) throw new HttpError(result.error.includes("already exists") ? 409 : 400, result.error);
  return json({ ok: true }, { headers: { "set-cookie": result.cookie } });
});
