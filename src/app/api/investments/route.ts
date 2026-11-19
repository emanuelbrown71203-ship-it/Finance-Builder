import { withUser } from "@/server/http";
import { getInvestments } from "@/server/queries";

export const GET = withUser((ctx, request) => getInvestments(ctx, new URL(request.url).searchParams.get("range") ?? "6m"));
