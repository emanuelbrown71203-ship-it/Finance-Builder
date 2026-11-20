import { withUser } from "@/server/http";
import { deleteRule } from "@/server/mutations";

export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => {
  await deleteRule(ctx, id);
  return { ok: true };
});
