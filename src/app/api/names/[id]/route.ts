import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { deleteNameRule, renameRule } from "@/server/names";

const Body = z.object({ name: z.string().max(200) });

export const PATCH = withUser<{ id: string }>(async (ctx, request, { id }) => renameRule(ctx, id, (await readBody(request, Body)).name));

/** Removes a saved name; the result lets Undo put it back. */
export const DELETE = withUser<{ id: string }>(async (ctx, _request, { id }) => deleteNameRule(ctx, id));
