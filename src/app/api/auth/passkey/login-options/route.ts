import { isDemoMode } from "@/lib/config";
import { HttpError, json, publicRoute } from "@/server/http";
import { loginOptions } from "@/server/passkeys";
import { limit } from "@/server/rate-limit";

export const POST = publicRoute(async (request) => {
  if (isDemoMode()) throw new HttpError(400, "There’s nothing to sign in to while the app is showing sample data.");
  await limit(request, "passkey", 30, 10 * 60_000);
  const { options, cookie } = await loginOptions(request);
  return json(options, { headers: { "set-cookie": cookie } });
});
