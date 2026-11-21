import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { deleteGoal, updateGoal } from "@/server/mutations";
import { getGoal } from "@/server/queries";

/** One goal's own screen: its plan, track, checkpoints, milestones and ideas. */
export const GET = withUser<{ id: string }>(async (ctx, _request, { id }) => getGoal(ctx, id));

const money = z.number().int().min(0).max(100_000_000_000);
const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  target: money.min(100).optional(),
  monthlyContribution: money.optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Cents to add to (or, when negative, take out of) what’s saved. */
  add: z.number().int().min(-100_000_000_000).max(100_000_000_000).optional(),
});

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => {
  const { depositId } = await updateGoal(ctx, id, await readBody(request, Body));
  return { ok: true, depositId };
});

export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => {
  await deleteGoal(ctx, id);
  return { ok: true };
});
