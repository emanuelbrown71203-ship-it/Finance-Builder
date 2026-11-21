import { undoActivity } from "@/server/actions";
import { withUser } from "@/server/http";

export const POST = withUser<{ id: string }>(async (ctx, _request, { id }) => undoActivity(ctx, id));
