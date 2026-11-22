"use client";

import { category } from "@/lib/categories";
import type { BudgetRow } from "@/lib/types";
import { Blocks } from "./ui";

/* Pieces of the budget shown on more than one screen (Budget and Home). */

export const STATUS: Record<BudgetRow["status"], { label: string; tone: "mint" | "canary" | "pink" | "plain"; color: string }> = {
  good: { label: "On track", tone: "mint", color: "var(--accent)" },
  watch: { label: "Heads up", tone: "canary", color: "var(--meter-warn)" },
  over: { label: "Over", tone: "pink", color: "var(--bad)" },
  none: { label: "No limit", tone: "plain", color: "var(--series-muted)" },
};

export const available = (r: BudgetRow) => (r.limit ?? 0) + r.carried;

/** Spent against what's available, in blocks, with a tick where spending would be today at an even pace. */
export function BudgetBar({ row }: { row: BudgetRow }) {
  const max = Math.max(1, available(row));
  return <Blocks share={Math.max(0, row.spent) / max} color={STATUS[row.status].color} label={`${category(row.category).label} budget used`} blocks={12} height={9} valueNow={Math.min(Math.max(0, row.spent), max)} valueMax={max} marker={row.paceNow !== null && row.paceNow > 0 ? row.paceNow / max : null} />;
}
