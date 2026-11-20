import { HttpError, json, withUser } from "@/server/http";
import { confirmOptions } from "@/server/passkeys";
import { limitKey } from "@/server/rate-limit";

/** "Confirm it's you" with Face ID: only the signed-in person's own devices are offered. */
export const POST = withUser(async (ctx, request) => {
  if (ctx.demo) throw new HttpError(400, "There’s nothing to confirm while the app is showing sample data.");
  await limitKey("passkey-confirm", ctx.userId, 20, 10 * 60_000);
  const { options, cookie } = await confirmOptions(ctx, request);
  return json(options, { headers: { "set-cookie": cookie } });
});
