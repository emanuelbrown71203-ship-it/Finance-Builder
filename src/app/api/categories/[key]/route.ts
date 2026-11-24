import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { removeCategory, updateCategory } from "@/server/categories";

const Body = z.object({ label: z.string().min(1).max(60).optional(), icon: z.string().max(30).optional() });

/** Renames a category of the person's own, or changes its icon. */
export const PATCH = withUser<{ key: string }>(async (ctx, request, { key }) => updateCategory(ctx, key, await readBody(request, Body)));

/** Removes one: its charges go back to Everything else. Returns what Undo needs. */
export const DELETE = withUser<{ key: string }>(async (ctx, _request, { key }) => ({ undo: await removeCategory(ctx, key) }));
