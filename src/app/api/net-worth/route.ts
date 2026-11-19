import { withUser } from "@/server/http";
import { getNetWorth } from "@/server/queries";

export const GET = withUser((ctx, request) => getNetWorth(ctx, new URL(request.url).searchParams.get("range") ?? "6m"));
