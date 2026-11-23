"use client";

import { useState } from "react";
import { GoalDialog, type GoalSheet } from "@/components/goals";
import { Button, Select, Sheet, SheetHeader, Tag, cx } from "@/components/ui";
import { dayOfMonth, formatShort, monthName, weekday, type ISODate } from "@/lib/dates";
import { dollars, dollarsExact } from "@/lib/money";
import type { Overview } from "@/lib/types";

type Week = NonNullable<Overview["noSpend"]>;

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Hidden on this device once last month's leftover has gone to savings, or "Not now" was tapped. */
const hiddenKey = (month: string) => `passbook-leftover-${month}`;
function readHidden(month: string): boolean {
  try {
    return localStorage.getItem(hiddenKey(month)) === "1";
  } catch {
    return false;
  }
}
function hideFor(month: string) {
  try {
    localStorage.setItem(hiddenKey(month), "1");
  } catch {
    // Private browsing: it just shows again next time.
  }
}

/**
 * The no-spend week: the month's last seven days, when the goal is to spend nothing but bills, so what's
 * left of the month can go to savings. A day block turns green for every day with nothing spent. Once
 * the month is over, what was left over is one tap from a savings goal.
 */
export function NoSpendCard({ week, today, className }: { week: Week; today: ISODate; className?: string }) {
  const [hidden, setHidden] = useState(() => readHidden(week.month));
  const [sheet, setSheet] = useState<GoalSheet>({ kind: "closed" });
  const [goalId, setGoalId] = useState(week.goals[0]?.id ?? "");
  if (week.phase === "done" && hidden) return null;

  const month = monthName(week.month);
  const left = Math.max(0, week.leftover);
  const todayState = week.days.find((d) => d.date === today)?.state;
  const dayNumber = week.days.findIndex((d) => d.date === today) + 1;
  const goal = week.goals.find((g) => g.id === goalId) ?? week.goals[0];
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

  const title = week.phase === "soon" ? "No-spend week is coming" : week.phase === "on" ? "No-spend week" : `${month}’s no-spend week`;
  const text =
    week.phase === "soon"
      ? `It starts ${DAY_NAMES[weekday(week.start)]}, ${formatShort(week.start)}: the last 7 days of ${month}. Bills still get paid; try to skip everything else. Whatever’s left over can go to savings.`
      : week.phase === "on"
        ? `${week.clear > 0 ? `${days(week.clear)} with nothing spent so far.` : "Every day you skip spending counts."}${todayState === "spent" ? " Today had some spending; tomorrow’s a fresh start." : ""} ${left > 0 ? `Keep it up and about ${dollars(left)} will be left over for savings.` : "The month is already past what’s left, so every day you skip helps."}`
        : `${week.clear} of 7 days with nothing spent but bills. ${left > 0 ? `${dollarsExact(left)} was left over from ${month}.` : `${month} didn’t leave anything over this time.`}`;

  return (
    <Sheet className={className}>
      <SheetHeader title={title} action={week.phase === "on" ? <Tag tone="mint">Day {dayNumber} of 7</Tag> : week.phase === "done" && week.clear === 7 ? <Tag tone="mint">Clean week!</Tag> : undefined} />
      <ol className="grid grid-cols-7 gap-1.5" aria-label="The last seven days of the month">
        {week.days.map((d) => (
          <li
            key={d.date}
            aria-label={`${formatShort(d.date)}: ${d.state === "clear" ? "nothing spent" : d.state === "spent" ? "spent" : d.state === "today" ? "today, nothing spent yet" : "coming up"}`}
            className={cx(
              "flex flex-col items-center rounded-xl py-1.5 text-center",
              d.state === "clear" && "block-on bg-mint text-mint-ink",
              d.state === "spent" && "bg-pink text-pink-ink",
              d.state === "today" && "border-2 border-accent text-accent-text",
              d.state === "ahead" && "border border-line-soft bg-sunk text-ink-3",
            )}
          >
            <span className="text-[11px] font-bold leading-none">{LETTERS[weekday(d.date)]}</span>
            <span className="figure mt-1 text-[1.05rem]">{dayOfMonth(d.date)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-ink-2">{text}</p>

      {week.phase === "done" && (
        <div className="mt-3 flex flex-col gap-2">
          {left > 0 && week.goals.length > 1 && (
            <Select aria-label="Which goal" value={goal?.id ?? ""} onChange={(e) => setGoalId(e.target.value)}>
              {week.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                hideFor(week.month);
                setHidden(true);
              }}
            >
              {left > 0 ? "Not now" : "Got it"}
            </Button>
            {left > 0 && (
              <Button variant="primary" onClick={() => setSheet(goal ? { kind: "add", goal, amount: left } : { kind: "new" })}>
                {goal ? `Put ${dollarsExact(left)} in savings` : "Start a savings goal"}
              </Button>
            )}
          </div>
        </div>
      )}

      <GoalDialog
        sheet={sheet}
        today={today}
        onClose={() => setSheet({ kind: "closed" })}
        onSaved={() => {
          // Only money that went in hides it: closing the sheet without saving leaves it here.
          if (sheet.kind === "add") {
            hideFor(week.month);
            setHidden(true);
          }
        }}
      />
    </Sheet>
  );
}
