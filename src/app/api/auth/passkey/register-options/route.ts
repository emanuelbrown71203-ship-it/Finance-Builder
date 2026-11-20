import { HttpError, json, withUser } from "@/server/http";
import { registrationOptions } from "@/server/passkeys";

export const POST = withUser(async (ctx, request) => {
  if (ctx.demo) throw new HttpError(400, "There’s nothing to sign in to while the app is showing sample data.");
  const { options, cookie } = await registrationOptions(ctx, request);
  return json(options, { headers: { "set-cookie": cookie } });
});
