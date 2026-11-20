import { HttpError, withUser } from "@/server/http";
import { connectorStatus, createConnectorKey, revokeConnectorKey } from "@/server/connector";

export const GET = withUser((ctx) => connectorStatus(ctx));

/** Makes a new private link. The key is shown this once and never again. */
export const POST = withUser(async (ctx) => {
  if (ctx.demo) throw new HttpError(400, "Sample data has its own try-it link. Your private link comes with your own account.");
  return { key: await createConnectorKey(ctx) };
  // The link reads everything, so making one needs a fresh "confirm it's you".
}, { fresh: true });

export const DELETE = withUser(async (ctx) => {
  await revokeConnectorKey(ctx);
  return { ok: true };
});
