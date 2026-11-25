import { z } from "zod";
import { monthOf } from "@/lib/dates";
import { HttpError, readBody, withUser } from "@/server/http";
import { markSavingDone, setSavingMark } from "@/server/mutations";
import { getBudget } from "@/server/queries";

/*
 * One paycheck's savings toward a goal: mark it done ("I put it aside"), save less this time, skip it, or
 * go back to the plan. Which to-do is meant comes as the goal and the paycheck's date; what's still to go
 * in is always worked out here, never taken from the request.
 */

const Todo = z.object({ goalId: z.string().min(1).max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Save less this time (amount), skip it (0), or back to the plan (null). */
const Mark = Todo.extend({ amount: z.number().int().min(0).max(100_000_000_00).nullable() });

export const PUT = withUser(async (ctx, request) => {
  const { goalId, date, amount } = await readBody(request, Mark);
  return setSavingMark(ctx, goalId, date, amount);
});

/** "I put it aside": what's still to go toward the goal from that paycheck, recorded as money put in. */
export const POST = withUser(async (ctx, request) => {
  const { goalId, date } = await readBody(request, Todo);
  const todo = (await getBudget(ctx, monthOf(date))).savings.todos.find((t) => t.goalId === goalId && t.date === date);
  if (!todo) throw new HttpError(404, "That savings to-do wasn’t found.");
  return markSavingDone(ctx, goalId, date, todo.amount - todo.saved);
});
