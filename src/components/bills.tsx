"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { dayOfMonth, diffDays, formatDistance, monthName, type ISODate } from "@/lib/dates";
import { dollars, dollarsExact } from "@/lib/money";
import type { UpcomingBill } from "@/lib/types";
import { cx } from "./ui";

/**
 * An upcoming bill: the date on a tile, then the bill. The tile fills in with
 * the bills colour when it is due within three days. Tapping it opens the bill
 * (a link from Home, or `onOpen` on the Bills screen).
 */
export function BillRow({ bill, today, href, onOpen }: { bill: UpcomingBill; today: ISODate; href?: string; onOpen?: () => void }) {
  const soon = diffDays(bill.date, today) <= 3;
  const inner = (
    <>
      <div className={cx("flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5", soon ? "bg-[var(--c-bills)] text-sheet" : "bg-pink text-pink-ink")}>
        <span className="text-[11px] font-bold uppercase leading-none tracking-wide">{monthName(bill.date.slice(0, 7)).slice(0, 3)}</span>
        <span className="figure mt-1 text-[1.25rem]">{dayOfMonth(bill.date)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-bold leading-snug">{bill.name}</p>
        <p className={cx("text-small text-ink-3", bill.kind === "card" ? "line-clamp-2" : "truncate")}>
          Due {formatDistance(bill.date, today)}
          {bill.kind === "card" && bill.owed ? `, ${dollars(bill.owed)} owed` : bill.estimated ? ", estimate" : ""}
          {bill.share ? `, your ${shareLabel(bill.share)}` : ""}
        </p>
      </div>
      <span className="tabular whitespace-nowrap pr-1 font-bold">{dollarsExact(-bill.amount)}</span>
      {(href || onOpen) && <ChevronRight size={16} aria-hidden className="-ml-1 shrink-0 text-ink-3" />}
    </>
  );
  const box = "flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-line-soft bg-sheet p-2.5 text-left";
  return (
    <li>
      {href ? (
        <Link href={href} className={cx(box, "active:bg-sunk")}>
          {inner}
        </Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className={cx(box, "transition-colors hover:bg-sunk active:bg-sunk")}>
          {inner}
        </button>
      ) : (
        <div className={box}>{inner}</div>
      )}
    </li>
  );
}

/** Where tapping a coming-up bill goes: the bill itself, or for a card's minimum, Debt payoff. */
export function billHref(bill: UpcomingBill): string {
  return bill.kind === "card" ? "/debt" : `/bills?open=${encodeURIComponent(bill.key)}`;
}

/** "half", or "60%": the part of a shared bill that's yours. */
export function shareLabel(share: number): string {
  return share === 0.5 ? "half" : `${Math.round(share * 100)}%`;
}
