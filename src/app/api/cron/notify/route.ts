import { connection } from "next/server";
import { getDb } from "@/db";
import { isDemoMode, liveConfigProblem } from "@/lib/config";
import { sameSecret } from "@/server/crypto";
import { describeError } from "@/server/errors";
import { HttpError, json } from "@/server/http";
import { morningNotes } from "@/server/notifications";
import { limit } from "@/server/rate-limit";

/**
 * The morning run of phone notifications (Monday's weekly review, the no-spend week's first day, money
 * short for a bill), started once a day by Vercel's scheduler (vercel.json).
 *
 * The scheduler can only call with GET. That is safe here because nothing a browser sends can start it:
 * it needs the CRON_SECRET bearer token, which only the scheduler has, and what it does (send each due
 * note once) is the same however often it runs.
 */
/** Room for a few people's notes, each sent within its own deadline. */
export const maxDuration = 60;

export async function GET(request: Request) {
  // Every call runs fresh: never answered from a copy made when the site was built.
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || isDemoMode() || liveConfigProblem()) return json({ error: "Not found." }, { status: 404 });
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    // Only wrong guesses are counted, so the scheduler's own call never touches the limit.
    try {
      await limit(request, "cron", 10, 60 * 60_000);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
      console.error(describeError(error));
    }
    return json({ error: "Not allowed." }, { status: 401 });
  }
  try {
    return json(await morningNotes(await getDb()));
  } catch (error) {
    console.error("Morning notifications failed:", describeError(error));
    return json({ error: "Something went wrong." }, { status: 500 });
  }
}
