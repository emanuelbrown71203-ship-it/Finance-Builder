import { z } from "zod";
import { HttpError, readBody, withUser } from "@/server/http";
import { sendTest } from "@/server/notifications";
import { clientAddress, limitKey } from "@/server/rate-limit";

const Body = z.object({ endpoint: z.string().url().max(1000).optional() });

/**
 * "Send a test": a notification to the person's devices right now. The sample household is shared by
 * every visitor, so there it only goes to the device that asked (and the limit is per visitor).
 */
export const POST = withUser(async (ctx, request) => {
  await limitKey("push-test", ctx.demo ? clientAddress(request) : ctx.userId, 6, 10 * 60_000);
  const { endpoint } = await readBody(request, Body);
  const { sent, devices } = await sendTest(ctx, endpoint);
  if (devices === 0) throw new HttpError(400, "Turn notifications on for this device first.");
  if (sent === 0) throw new HttpError(502, "The notification service didn’t take it. Try again in a minute.");
  return { sent };
});
