import { withUser } from "@/server/http";
import { checkBills } from "@/server/tasks-link";

/** "Check now": look for paid bills and tick them off in Tasks for Two. */
export const POST = withUser((ctx) => checkBills(ctx.db, ctx.userId));
