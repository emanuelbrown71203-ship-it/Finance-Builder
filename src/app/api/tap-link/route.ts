import { createTapKey, revokeTapKey, tapStatus } from "@/server/card-taps";
import { HttpError, withUser } from "@/server/http";

export const GET = withUser((ctx) => tapStatus(ctx));

/** Makes a new tap link. The key is shown this once and never again. */
export const POST = withUser(
  async (ctx) => {
    if (ctx.demo) throw new HttpError(400, "The sample household has a test button instead. Your private tap link comes with your own account.");
    return { key: await createTapKey(ctx) };
  },
  // It adds purchases to the account, so making one needs a fresh "confirm it's you".
  { fresh: true },
);

export const DELETE = withUser(async (ctx) => {
  await revokeTapKey(ctx);
  return { ok: true };
});
