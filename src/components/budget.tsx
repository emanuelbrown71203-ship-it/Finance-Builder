"use client";

import { category } from "@/lib/categories";
import type { BudgetRow } from "@/lib/types";

/* Pieces of the budget shown on more than one screen (Budget and Home). */

export const STATUS: Record<BudgetRow["status"], { label: string; tone: "mint" | "canary" | "pink" | "plain"; color: string }> = {
  good: { label: "On track", tone: "mint", color: "var(--accent)" },
  watch: { label: "Heads up", tone: "canary", color: "var(--warn)" },
  over: { label: "Over", tone: "pink", color: "var(--bad)" },
  none: { label: "No limit", tone: "plain", color: "var(--series-muted)" },
};

export const available = (r: BudgetRow) => (r.limit ?? 0) + r.carried;

/** Spent against what's available, with a tick where spending would be today at an even pace. */
export function BudgetBar({ row }: { row: BudgetRow }) {
  const max = Math.max(1, available(row));
  const share = Math.min(1, Math.max(0, row.spent) / max);
  const color = STATUS[row.status].color;
  return (
    <div className="relative" role="meter" aria-label={`${category(row.category).label} budget used`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(Math.max(0, row.spent), max)}>
      <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, var(--sheet))` }}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(row.spent > 0 ? 2 : 0, share * 100)}%`, background: color }} />
      </div>
      {row.paceNow !== null && row.paceNow > 0 && row.paceNow < max && <span aria-hidden className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-ink-3" style={{ left: `${(row.paceNow / max) * 100}%` }} />}
    </div>
  );
}

