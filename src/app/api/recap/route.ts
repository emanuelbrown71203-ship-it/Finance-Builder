import { withUser } from "@/server/http";
import { getRecap } from "@/server/queries";

export const GET = withUser((ctx, request) => {
  const back = Number(new URL(request.url).searchParams.get("back")) || 0;
  return getRecap(ctx, Math.min(12, Math.max(0, Math.floor(back))));
});
