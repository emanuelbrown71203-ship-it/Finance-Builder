import { HttpError, json, withUser } from "@/server/http";
import { finishConfirm } from "@/server/passkeys";
import { limitKey } from "@/server/rate-limit";

/** Checks the Face ID answer against the signed-in person's own devices, then marks the session freshly checked. */
export const POST = withUser(async (ctx, request) => {
  if (ctx.demo) throw new HttpError(400, "There’s nothing to confirm while the app is showing sample data.");
  await limitKey("passkey-confirm", ctx.userId, 20, 10 * 60_000);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") throw new HttpError(400, "That didn’t work. Try again.");
  const { cookie } = await finishConfirm(ctx, request, body);
  return json({ ok: true }, { headers: { "set-cookie": cookie } });
});
