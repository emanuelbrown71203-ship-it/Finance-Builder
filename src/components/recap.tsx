"use client";

import { ArrowDownRight, ArrowUpRight, CalendarCheck, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
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

function useSeenWeek(): string | null {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener(EVENT, l);
      return () => window.removeEventListener(EVENT, l);
    },
    () => {
      try {
        return localStorage.getItem(KEY);
      } catch {
        return null;
      }
    },
    // Until the page is live in the browser, assume it has been seen so nothing flashes.
    () => "unknown",
  );
}

/** On Home, once a week: a nudge that last week's recap is ready. It goes away once opened or closed. */
export function RecapCard({ today }: { today: ISODate }) {
  const seen = useSeenWeek();
  if (seen === "unknown" || seen === weekId(today)) return null;
  return (
    <div className="mb-4 flex items-center gap-1 rounded-sheet border border-line-soft bg-sheet p-1.5 shadow-card">
      <Link href="/recap" className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 active:bg-sunk">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky text-sky-ink">
          <CalendarCheck size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">Your week in money is ready</span>
          <span className="block truncate text-small text-ink-3">What you spent, saved and paid last week</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-3" />
      </Link>
      <button type="button" aria-label="Not now" onClick={() => markRecapSeen(today)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3 active:bg-sunk">
        <X size={18} />
      </button>
    </div>
  );
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
