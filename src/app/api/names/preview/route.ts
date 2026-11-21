import { HttpError } from "@/server/errors";
import { withUser } from "@/server/http";
import { previewNameRule } from "@/server/names";

/** How many charges a rename would change, shown before it's saved. */
export const GET = withUser(async (ctx, request) => {
  const p = new URL(request.url).searchParams;
  const id = p.get("transactionId") ?? "";
  if (!id || id.length > 200) throw new HttpError(400, "Which transaction?");
  return previewNameRule(ctx, id, p.get("onlyThisAmount") === "1");
});
