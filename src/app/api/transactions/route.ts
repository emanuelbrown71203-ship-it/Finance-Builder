import { isCategoryKey } from "@/lib/categories";
import { withUser } from "@/server/http";
import { getTransactions } from "@/server/queries";

export const GET = withUser(async (ctx, request) => {
  const p = new URL(request.url).searchParams;
  const category = p.get("category") ?? "";
  const month = p.get("month") ?? "";
  const flow = p.get("flow");
  return getTransactions(ctx, {
    q: p.get("q")?.trim().slice(0, 80) || undefined,
    category: isCategoryKey(category) ? category : undefined,
    accountId: p.get("account") || undefined,
    month: /^\d{4}-\d{2}$/.test(month) ? month : undefined,
    flow: flow === "in" || flow === "out" ? flow : undefined,
    limit: Math.min(200, Math.max(1, Number(p.get("limit")) || 60)),
    offset: Math.max(0, Number(p.get("offset")) || 0),
  });
});
