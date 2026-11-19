"use client";

import { dayOfMonth, formatDistance, monthName, type ISODate } from "@/lib/dates";
import { dollarsExact } from "@/lib/money";
import type { UpcomingBill } from "@/lib/types";
import { Tag } from "./ui";

/**
 * An upcoming bill as a tear-off stub: the date on the tab, the bill on the
 * body. The tab turns canary when the bill is due within three days.
 */
export function BillStub({ bill, today }: { bill: UpcomingBill; today: ISODate }) {
  const soon = bill.date <= today || formatDistance(bill.date, today) === "tomorrow" || ["in 2 days", "in 3 days"].includes(formatDistance(bill.date, today));
  return (
    <li className="stub">
      <div className={`stub-tab flex flex-col items-center justify-center py-2 ${soon ? "bg-canary text-canary-ink" : "bg-pink text-pink-ink"}`}>
        <span className="text-[11px] font-medium leading-none">{monthName(bill.date.slice(0, 7)).slice(0, 3)}</span>
        <span className="figure mt-0.5 text-title">{dayOfMonth(bill.date)}</span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium">{bill.name}</p>
          <p className="text-small text-ink-3">
            Due {formatDistance(bill.date, today)}
            {bill.kind === "card" && ", current balance"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="tabular whitespace-nowrap font-medium">{dollarsExact(-bill.amount)}</span>
          {bill.estimated && bill.kind !== "card" && <Tag>Estimate</Tag>}
        </div>
      </div>
    </li>
  );
}
