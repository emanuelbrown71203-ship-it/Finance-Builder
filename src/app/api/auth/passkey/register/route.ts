import { HttpError, json, withUser } from "@/server/http";
import { finishRegistration } from "@/server/passkeys";

export const POST = withUser(async (ctx, request) => {
  if (ctx.demo) throw new HttpError(400, "There’s nothing to sign in to while the app is showing sample data.");
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string") throw new HttpError(400, "That didn’t work. Try again.");
  const { cookie } = await finishRegistration(ctx, request, body);
  return json({ ok: true }, { headers: { "set-cookie": cookie } });
  // Both steps of adding a device need a fresh "confirm it's you", not only the first.
}, { fresh: true });
