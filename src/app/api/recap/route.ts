import { withUser } from "@/server/http";
import { win } from "@/server/game";
import { getRecap, weekKey } from "@/server/queries";
import { formatShort } from "@/lib/dates";

export const GET = withUser((ctx, request) => {
  const back = Number(new URL(request.url).searchParams.get("back")) || 0;
  return getRecap(ctx, Math.min(12, Math.max(0, Math.floor(back))));
});

/** Finishing this week's review: a win, once a week. */
export const POST = withUser(async (ctx) => {
  const week = weekKey(ctx.today);
  await win(ctx, "review", week, `Week of ${formatShort(week)}`);
  return { ok: true };
});
