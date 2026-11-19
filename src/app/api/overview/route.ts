import { withUser } from "@/server/http";
import { getOverview } from "@/server/queries";

export const GET = withUser((ctx) => getOverview(ctx));
