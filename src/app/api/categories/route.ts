import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { createCategory, loadUserCategories } from "@/server/categories";

export const GET = withUser(async (ctx) => ({ categories: await loadUserCategories(ctx) }));

const Body = z.object({ label: z.string().min(1).max(60), icon: z.string().max(30).optional() });

/** Makes a category of the person's own ("Car", "Tools"). */
export const POST = withUser(async (ctx, request) => ({ category: await createCategory(ctx, await readBody(request, Body)) }));
