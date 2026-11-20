import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { connectTasks, disconnectTasks, getTasksLink } from "@/server/tasks-link";

export const GET = withUser((ctx) => getTasksLink(ctx));

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
