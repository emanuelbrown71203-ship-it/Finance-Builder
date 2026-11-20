"use client";

import { dayOfMonth, diffDays, formatDistance, monthName, type ISODate } from "@/lib/dates";
import { dollarsExact } from "@/lib/money";
import type { UpcomingBill } from "@/lib/types";
import { cx } from "./ui";

/**
 * An upcoming bill: the date on a tile, then the bill. The tile fills in with
 * the bills colour when it is due within three days.
 */
export function BillRow({ bill, today }: { bill: UpcomingBill; today: ISODate }) {
  const soon = diffDays(bill.date, today) <= 3;
  return (
    <li className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-line-soft bg-sheet p-2.5">
      <div className={cx("flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5", soon ? "bg-[var(--c-bills)] text-sheet" : "bg-pink text-pink-ink")}>
        <span className="text-[11px] font-bold uppercase leading-none tracking-wide">{monthName(bill.date.slice(0, 7)).slice(0, 3)}</span>
        <span className="figure mt-1 text-[1.25rem]">{dayOfMonth(bill.date)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-bold leading-snug">{bill.name}</p>
        <p className="truncate text-small text-ink-3">
          Due {formatDistance(bill.date, today)}
          {bill.estimated && bill.kind !== "card" ? ", estimate" : ""}
        </p>
      </div>
      <span className="tabular whitespace-nowrap pr-1 font-bold">{dollarsExact(-bill.amount)}</span>
    </li>
  );
}
