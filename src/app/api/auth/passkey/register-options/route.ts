import { HttpError, json, withUser } from "@/server/http";
import { registrationOptions } from "@/server/passkeys";

export const POST = withUser(async (ctx, request) => {
  if (ctx.demo) throw new HttpError(400, "There’s nothing to sign in to while the app is showing sample data.");
  const { options, cookie } = await registrationOptions(ctx, request);
  return json(options, { headers: { "set-cookie": cookie } });
  // A new device is a new way into the account, so the person must have just proved who they are.
}, { fresh: true });
