import { withUser } from "@/server/http";
import { checkIn, getGame } from "@/server/game";

/** XP, level, streak, badges and recent wins. */
export const GET = withUser((ctx) => getGame(ctx));

/** Opening the app: today's check-in (once a day, however often it's sent), then the same as GET. */
export const POST = withUser(async (ctx) => {
  await checkIn(ctx);
  return getGame(ctx);
});
