import { z } from "zod";
import { isDemoMode } from "@/lib/config";
import { signUp } from "@/server/auth";
import { HttpError, json, publicRoute } from "@/server/http";
import { limit } from "@/server/rate-limit";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

export const POST = publicRoute(async (request) => {
  if (isDemoMode()) throw new HttpError(400, "Accounts are off while the app is showing sample data.");
  await limit(request, "signup", 8, 10 * 60_000);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const result = await signUp(parsed.data);
  if (!result.ok) throw new HttpError(409, result.error);
  return json({ ok: true }, { headers: { "set-cookie": result.cookie } });
});

