import { withUser } from "@/server/http";
import { deleteDeposit } from "@/server/mutations";

/** Takes one deposit back off a goal: what Undo does after "Add money". */
export const DELETE = withUser<{ id: string; depositId: string }>(async (ctx, _request, { id, depositId }) => {
  await deleteDeposit(ctx, id, depositId);
  return { ok: true };
});
