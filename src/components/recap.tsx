"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { addDays, weekday, type ISODate } from "@/lib/dates";

const KEY = "passbook-recap-seen";
const EVENT = "passbook-recap-seen-change";

/** The Monday of the week `today` falls in: one recap per week. */
export function weekId(today: ISODate): ISODate {
  return addDays(today, -((weekday(today) + 6) % 7));
}

export function markRecapSeen(today: ISODate) {
  try {
    localStorage.setItem(KEY, weekId(today));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** More or less than before: always an arrow and words, never colour alone. Spending less is the good direction. */
export function SpendDelta({ now, before, dollars }: { now: number; before: number; dollars: (cents: number) => string }) {
  if (before === 0 && now === 0) return null;
  if (before === 0) return <span>Nothing was spent the week before.</span>;
  const diff = now - before;
  if (Math.abs(diff) < 100) return <span>About the same as the week before.</span>;
  const less = diff < 0;
  const Icon = less ? ArrowDownRight : ArrowUpRight;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={17} aria-hidden />
      <span>
        <span className="tabular font-bold">{dollars(Math.abs(diff))}</span> {less ? "less" : "more"} than the week before
      </span>
    </span>
  );
}
