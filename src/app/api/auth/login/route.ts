import { z } from "zod";
import { signIn } from "@/server/auth";
import { HttpError, json, publicRoute } from "@/server/http";
import { limit } from "@/server/rate-limit";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export const POST = publicRoute(async (request) => {
  limit(request, "login", 10, 10 * 60_000);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Enter your email and password.");
  const result = await signIn(parsed.data);
  if (!result.ok) throw new HttpError(401, result.error);
  return json({ ok: true }, { headers: { "set-cookie": result.cookie } });
});
