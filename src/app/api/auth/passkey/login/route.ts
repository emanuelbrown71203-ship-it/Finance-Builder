import { isDemoMode } from "@/lib/config";
import { HttpError, json, publicRoute } from "@/server/http";
import { finishLogin } from "@/server/passkeys";
import { limit } from "@/server/rate-limit";

export const POST = publicRoute(async (request) => {
  if (isDemoMode()) throw new HttpError(400, "There’s nothing to sign in to while the app is showing sample data.");
  await limit(request, "passkey", 30, 10 * 60_000);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") throw new HttpError(400, "That didn’t work. Try again.");
  const { cookies } = await finishLogin(request, body);
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return json({ ok: true }, { headers });
});
