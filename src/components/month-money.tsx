"use client";

import { ChevronRight } from "lucide-react";
import type { PlanDay } from "@/lib/finance/plan";
import { dollars } from "@/lib/money";
import { cx } from "./ui";

/*
 * The month's money in the owner's own words, the same on Home and Budget:
 *
 *   Came in        (so far, and paychecks still coming this month)
 * − Already spent  (bills paid, everyday spending)
 * − Spoken for     (bills still to pay, savings for goals: promised, not spent yet)
 * = Free to spend  (or "Over by", when spending is past what the month's money covers)
 */

export type MonthFigures = {
  month: string;
  incomeExpected: number;
  incomeReceived: number;
  billsExpected: number;
  billsPaid: number;
  savingsPlanned: number;
  everydaySpent: number;
  leftToSpend: number;
  /** Day by day (this month only), to name the bills and paychecks still to come. */
  days?: PlanDay[];
  /** Of the savings, what's already been put aside. */
  savingsDone?: number;
};

export function monthMoney(f: MonthFigures) {
  const billsDue = Math.max(0, f.billsExpected - f.billsPaid);
  return {
    cameIn: f.incomeExpected,
    inSoFar: f.incomeReceived,
    stillComing: Math.max(0, f.incomeExpected - f.incomeReceived),
    spent: f.billsPaid + f.everydaySpent,
    billsPaid: f.billsPaid,
    everyday: f.everydaySpent,
    spokenFor: billsDue + f.savingsPlanned,
    billsDue,
    saving: f.savingsPlanned,
    /** The same number as "left to spend": came in − already spent − spoken for. Negative is over. */
    free: f.leftToSpend,
  };
}

/** Names of what's still to come (bills or paychecks), soonest first: "Rent and Geico", "Rent, Geico and 2 more". */
function stillToCome(days: PlanDay[] | undefined, type: "bill" | "income"): string {
  const names: string[] = [];
  for (const d of days ?? []) for (const e of d.events) if (e.type === type && !e.settled && !names.includes(e.name)) names.push(e.name);
  if (names.length === 0) return "";
  return names.length <= 2 ? names.join(" and ") : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

// Spoken for is amber (promised, not spent), never the red that means over.
export const MONEY_COLORS = { spent: "var(--accent)", spokenFor: "var(--meter-warn)", free: "var(--line)", over: "var(--bad)" };

/**
 * One bar for the month: already spent, then spoken for, then what's free. When spending is past what the
 * month's money covers, the part past it shows red.
 */
export function MonthBar({ f, className }: { f: MonthFigures; className?: string }) {
  const m = monthMoney(f);
  const used = m.spent + m.spokenFor;
  const whole = Math.max(1, used + Math.max(0, m.free));
  const cut = Math.max(0, m.cameIn);
  const parts: { key: string; amount: number; color: string }[] = [];
  let at = 0;
  for (const [key, amount, color] of [
    ["spent", m.spent, MONEY_COLORS.spent],
    ["spoken", m.spokenFor, MONEY_COLORS.spokenFor],
  ] as const) {
    if (amount <= 0) continue;
    const covered = Math.max(0, Math.min(amount, cut - at));
    if (covered > 0) parts.push({ key, amount: covered, color });
    if (amount - covered > 0) parts.push({ key: `${key}-over`, amount: amount - covered, color: MONEY_COLORS.over });
    at += amount;
  }
  if (m.free > 0) parts.push({ key: "free", amount: m.free, color: MONEY_COLORS.free });
  return (
    <div className={cx("flex h-4 w-full gap-[3px] overflow-hidden rounded-[3px]", className)} aria-hidden>
      {parts.map((x) => (
        <span key={x.key} className="block-on h-full rounded-[2px]" style={{ width: `${(x.amount / whole) * 100}%`, background: x.color }} />
      ))}
    </div>
  );
}

function Line({ sign, label, amount, note, dot, tone, strong, bad, children }: { sign: string; label: string; amount: number; note?: string; dot?: string; tone: "sheet" | "hero"; strong?: boolean; bad?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cx("flex items-baseline gap-3 py-2.5", strong && "font-bold")}>
      <span aria-hidden className={cx("tabular w-3 shrink-0 text-center", tone === "hero" ? "opacity-70" : "text-ink-3")}>
        {sign}
      </span>
      <dt className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {dot && <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: dot }} />}
          <span className={cx(strong ? "" : "font-bold", bad && tone === "sheet" && "text-bad")}>{label}</span>
        </span>
        {note && <span className={cx("mt-0.5 block text-small font-normal", tone === "hero" ? "opacity-80" : "text-ink-3")}>{note}</span>}
        {children}
      </dt>
      <dd className={cx("tabular whitespace-nowrap font-bold", bad && tone === "sheet" && "text-bad")}>{dollars(amount)}</dd>
    </div>
  );
}

/**
 * The month as a sum: came in, minus already spent, minus spoken for, is what's free to spend (or how much
 * it's over). `onPaychecks` makes "Came in" open the month's paychecks (to set a lighter one).
 */
export function MonthLedger({ f, when, onPaychecks, tone = "sheet" }: { f: MonthFigures; when: "past" | "now" | "future"; onPaychecks?: () => void; tone?: "sheet" | "hero" }) {
  const m = monthMoney(f);
  const over = m.free < 0;
  const paychecks = stillToCome(f.days, "income");
  const bills = stillToCome(f.days, "bill");
  const cameInNote =
    when === "future"
      ? "Expected this month"
      : m.stillComing > 0
        ? `${dollars(m.inSoFar)} so far, ${dollars(m.stillComing)} still coming${paychecks ? ` (${paychecks})` : ""}`
        : when === "now"
          ? "All of this month’s money is in"
          : undefined;
  const spokenNote =
    m.spokenFor === 0
      ? "Nothing: every bill is paid, and nothing is set aside for goals"
      : [m.billsDue > 0 ? `${dollars(m.billsDue)} for bills still to pay${bills ? ` (${bills})` : ""}` : "", m.saving > 0 ? `${dollars(m.saving)} for your savings goals${f.savingsDone ? ` (${dollars(Math.min(f.savingsDone, m.saving))} put aside)` : ""}` : ""].filter(Boolean).join(", ");
  const cameIn = (
    <Line sign="+" label="Came in" amount={m.cameIn} note={cameInNote} tone={tone}>
      {onPaychecks && (
        <span className={cx("mt-0.5 flex items-center gap-0.5 text-small font-bold", tone === "sheet" ? "text-accent-text" : "underline underline-offset-4")}>
          {when === "past" ? "See paychecks" : "Paychecks: change a lighter one"}
          <ChevronRight size={14} aria-hidden />
        </span>
      )}
    </Line>
  );
  return (
    <dl className={tone === "hero" ? "hero-rules" : "divide-y divide-line-soft"}>
      {onPaychecks ? (
        // The divider line belongs to this wrapper, so it stays straight under the rounded tap area.
        <div>
          <button type="button" onClick={onPaychecks} className={cx("-mx-1 block w-[calc(100%+0.5rem)] rounded-2xl px-1 text-left", tone === "sheet" && "active:bg-sunk")}>
            {cameIn}
          </button>
        </div>
      ) : (
        cameIn
      )}
      <Line sign="−" label="Already spent" amount={m.spent} note={`${dollars(m.billsPaid)} on bills, ${dollars(m.everyday)} on everyday spending`} dot={tone === "sheet" ? MONEY_COLORS.spent : undefined} tone={tone} />
      <Line sign="−" label="Spoken for" amount={m.spokenFor} note={m.spokenFor === 0 ? `${spokenNote}.` : `${spokenNote}. Promised, not spent yet.`} dot={tone === "sheet" ? MONEY_COLORS.spokenFor : undefined} tone={tone} />
      <Line sign="=" label={over ? "Over by" : when === "past" ? "Left over" : "Free to spend"} amount={Math.abs(m.free)} dot={tone === "sheet" ? (over ? MONEY_COLORS.over : MONEY_COLORS.free) : undefined} tone={tone} strong bad={over} />
    </dl>
  );
}
