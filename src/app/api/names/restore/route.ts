import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { restoreNameRule } from "@/server/names";

/** Undo of removing a saved name. */
const Body = z.object({ key: z.string().min(1).max(200), amount: z.number().int(), name: z.string().max(200) });

export const POST = withUser(async (ctx, request) => restoreNameRule(ctx, await readBody(request, Body)));
