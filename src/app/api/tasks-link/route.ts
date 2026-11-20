import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { limitKey } from "@/server/rate-limit";
import { connectTasks, disconnectTasks, getTasksLink } from "@/server/tasks-link";

export const GET = withUser(async (ctx) => {
  // Each look asks Tasks for Two for its bills, so it has a ceiling of its own.
  if (!ctx.demo) await limitKey("tasks-read", ctx.userId, 40, 60_000);
  return getTasksLink(ctx);
});

const Body = z.object({ url: z.string().trim().min(20).max(400) });

export const POST = withUser(async (ctx, request) => {
  const { url } = await readBody(request, Body);
  await connectTasks(ctx, url);
  return { ok: true };
});

export const DELETE = withUser(async (ctx) => {
  await disconnectTasks(ctx);
  return { ok: true };
});
