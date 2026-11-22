import { z } from "zod";
import { HttpError } from "@/server/errors";
import { withUser } from "@/server/http";
import { askNickel } from "@/server/nickel";

/** What Nickel last decided about a purchase in this conversation, sent back so he can hold to it. */
const Last = z.object({ amount: z.number().int().positive().max(1_000_000_000), item: z.string().max(60), verdict: z.enum(["yes", "wait", "no"]) });

/** A question for Nickel, answered from the person's own numbers by rules. Read-only. */
export const GET = withUser(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q || q.length > 300) throw new HttpError(400, "Ask me something!");
  let last = null;
  try {
    last = params.get("last") ? Last.parse(JSON.parse(params.get("last")!)) : null;
  } catch {
    last = null;
  }
  return { answer: await askNickel(ctx, q, last) };
});
