import { listActivity } from "@/server/actions";
import { withUser } from "@/server/http";

/** What Nickel and Claude have changed, newest first. */
export const GET = withUser(async (ctx) => ({ items: await listActivity(ctx) }));
