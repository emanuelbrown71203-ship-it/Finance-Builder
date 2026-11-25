import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { addDevice, getNotifySettings, listDevices, removedDevices, removeDevice, setNotifySettings } from "@/server/notifications";
import { clientAddress, limitKey } from "@/server/rate-limit";
import { vapidPublicKey } from "@/server/webpush";

/*
 * Phone notifications for the signed-in person: the site's public push key (for a browser to subscribe
 * with), their devices, and which kinds they want. A device's push address only ever goes to the server.
 */

export const GET = withUser(async (ctx) => ({
  key: vapidPublicKey(),
  /** The sample household is shared, so its devices are never listed. */
  demo: ctx.demo,
  devices: await listDevices(ctx),
  /** Devices removed from the list: the app on one of them doesn't put itself back. */
  removed: await removedDevices(ctx),
  settings: await getNotifySettings(ctx.db, ctx.userId),
}));

const Subscription = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(30) }),
  }),
  /** "iPhone", "iPad"… shown in the list of devices. */
  label: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} .,'()-]+$/u),
  /** The app putting back a device the server lost, rather than the person turning it on. */
  auto: z.boolean().optional(),
  /** The push address this one takes over from, when the browser renewed it. */
  replaces: z.string().url().max(1000).optional(),
});

/** Turns notifications on for this device. */
export const POST = withUser(async (ctx, request) => {
  await limitKey("push-add", ctx.demo ? clientAddress(request) : ctx.userId, 20, 60 * 60_000);
  const { subscription, label, auto, replaces } = await readBody(request, Subscription);
  await addDevice(ctx, subscription, label, { auto, replaces });
  return { ok: true };
});

const Remove = z.union([z.object({ endpoint: z.string().url().max(1000) }), z.object({ id: z.string().uuid() })]);

/** Turns notifications off for this device (by its push address) or one in the list (by id). */
export const DELETE = withUser(async (ctx, request) => {
  await removeDevice(ctx, await readBody(request, Remove));
  return { ok: true };
});

const Settings = z.object({
  lowBalance: z.boolean().optional(),
  weeklyReview: z.boolean().optional(),
  noSpend: z.boolean().optional(),
  amounts: z.boolean().optional(),
  moneyIn: z.boolean().optional(),
  billDue: z.boolean().optional(),
  budget: z.boolean().optional(),
});

export const PUT = withUser(async (ctx, request) => ({ settings: await setNotifySettings(ctx, await readBody(request, Settings)) }));
