import { withUser } from "@/server/http";
import { removePasskey } from "@/server/passkeys";

export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => {
  await removePasskey(ctx, id);
  return { ok: true };
});
