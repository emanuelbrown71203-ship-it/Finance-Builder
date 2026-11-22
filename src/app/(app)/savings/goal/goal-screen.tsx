"use client";

import { XpTag } from "@/components/game/level";
import { WINS } from "@/lib/game/progress";
import { Check, CircleDashed, Flag, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GoalTrack } from "@/components/charts";
import { GoalDialog, goalSentence, goalStatus, type GoalSheet } from "@/components/goals";
import { Blocks, Button, EmptyState, ErrorNote, Fold, PageHeader, Sheet, SheetHeader, Skeleton, Tag, cx } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { addMonths, formatMedium, formatRelativeDay, formatShort, monthName, type ISODate } from "@/lib/dates";
import { dollars, signedAmount } from "@/lib/money";
import type { GoalDetailPayload } from "@/lib/types";

const monthYear = (date: ISODate) => `${monthName(date.slice(0, 7))} ${date.slice(0, 4)}`;

/** One goal's own screen: how it's going, what to put away, the track, checkpoints, milestones and ideas. */
export function GoalScreen() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { data, error, mutate } = useApi<GoalDetailPayload>(id ? `/api/goals/${encodeURIComponent(id)}` : null, { refreshInterval: 30_000 });
  const [sheet, setSheet] = useState<GoalSheet>({ kind: "closed" });

  if (error && !data) {
    return (
      <>
        <PageHeader title="Goal" back={{ href: "/savings", label: "Savings" }} />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!id) {
    return (
      <>
        <PageHeader title="Goal" back={{ href: "/savings", label: "Savings" }} />
        <EmptyState title="No goal picked">Go back to Savings and tap a goal to see its track.</EmptyState>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Goal" back={{ href: "/savings", label: "Savings" }} />
        <div className="grid grid-cols-1 gap-5">
          <Skeleton className="h-72 rounded-sheet" />
          <Skeleton className="h-64 rounded-sheet" />
        </div>
      </>
    );
  }

  const { goal, today } = data;
  const status = goalStatus(goal);
  const done = goal.saved >= goal.target;
  const ratio = Math.min(1, goal.saved / goal.target);
  const trackEnd = goal.targetDate ? (goal.targetDate > today ? goal.targetDate : today) : goal.projectedDate && goal.projectedDate > today ? goal.projectedDate : addMonths(today, 6);
  const upcoming = data.checkpoints.filter((c) => c.met === null);
  const past = data.checkpoints.filter((c) => c.met !== null);

  return (
    <>
      <PageHeader
        title={goal.name}
        back={{ href: "/savings", label: "Savings" }}
        action={
          <Button size="sm" onClick={() => setSheet({ kind: "edit", goal })}>
            Change
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* How it's going */}
        <Sheet className="lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <p>
              <span className="figure text-[2.75rem]">{dollars(goal.saved)}</span>
              <span className="tabular ml-2 text-ink-2">of {dollars(goal.target)}</span>
            </p>
            <Tag tone={status.tone}>{status.label}</Tag>
          </div>
          <div className="mt-4">
            <Blocks share={ratio} color="var(--accent)" label={`${goal.name} progress`} blocks={14} height={12} valueNow={Math.min(goal.saved, goal.target)} valueMax={goal.target} />
          </div>
          <p className="mt-3 text-ink-2">{goalSentence(goal)}</p>
          {goal.targetDate && goal.daysLeft !== null && goal.daysLeft >= 0 && !done && (
            <p className="mt-1 text-small text-ink-3">
              {goal.daysLeft === 0 ? "Due today" : `${goal.daysLeft} ${goal.daysLeft === 1 ? "day" : "days"} left`} · by {formatMedium(goal.targetDate)}
            </p>
          )}

          {goal.perMonth !== null && (
            <div className="mt-5 grid grid-cols-3 gap-2">
              <PlanTile amount={goal.perMonth} label="a month" />
              <PlanTile amount={goal.perWeek ?? 0} label="a week" />
              {goal.perPayday !== null ? <PlanTile amount={goal.perPayday} label="each payday" note={goal.nextPayday ? `Next: ${formatShort(goal.nextPayday)}` : undefined} /> : <PlanTile amount={null} label="each payday" note="No regular pay found yet" />}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {!done && (
              <Button variant="primary" onClick={() => setSheet({ kind: "add", goal })}>
                Add money
                <XpTag xp={WINS.save.xp} />
              </Button>
            )}
            {goal.saved > 0 && <Button onClick={() => setSheet({ kind: "withdraw", goal })}>Take some out</Button>}
          </div>
        </Sheet>

        {/* The track */}
        <Sheet className="min-w-0 lg:col-span-2">
          <SheetHeader title="Your track" hint={goal.targetDate ? "The dashed line is the plan: a steady climb from where you started to the goal on its date. The solid line is what you’ve saved." : "What you’ve saved so far. Give the goal a date to see a plan to follow."} />
          <GoalTrack start={data.startDate} end={trackEnd} startSaved={data.startSaved} target={goal.target} history={data.history} today={today} plan={Boolean(goal.targetDate)} />
        </Sheet>

        {/* Checkpoints */}
        {data.checkpoints.length > 0 && (
          <Sheet>
            <SheetHeader title="Checkpoints" hint="Where the plan has you at the end of each month." />
            <ul className="divide-y divide-line-soft">
              {[...past.slice(-2), ...upcoming.slice(0, 4)].map((c) => (
                <CheckpointRow key={c.date} date={c.date} amount={c.amount} met={c.met} today={today} final={c.date === goal.targetDate} />
              ))}
            </ul>
            {data.checkpoints.length > 6 && (
              <Fold title="Every checkpoint" summary={`${data.checkpoints.length} in all`} className="mt-2 border-t border-line-soft">
                <ul className="divide-y divide-line-soft pb-2">
                  {data.checkpoints.map((c) => (
                    <CheckpointRow key={c.date} date={c.date} amount={c.amount} met={c.met} today={today} final={c.date === goal.targetDate} />
                  ))}
                </ul>
              </Fold>
            )}
          </Sheet>
        )}

        {/* Milestones */}
        <Sheet>
          <SheetHeader title="Milestones" hint={goal.pace > 0 && !done ? `Dates ahead assume about ${dollars(goal.pace)} a month, your pace lately.` : undefined} />
          <ol className="grid grid-cols-1 gap-2">
            {data.milestones.map((m) => (
              <li key={m.percent} className={cx("flex min-h-12 items-center gap-3 rounded-2xl px-3", m.reachedOn ? "bg-mint text-mint-ink" : "bg-sunk text-ink-2")}>
                <span className="figure w-12 text-[1.25rem]">{m.percent}%</span>
                <span className="tabular flex-1 font-bold">{dollars(m.amount)}</span>
                <span className="text-small">{m.reachedOn ? `Reached ${formatShort(m.reachedOn)}` : m.projected ? `Around ${monthYear(m.projected)}` : "Add money to see when"}</span>
              </li>
            ))}
          </ol>
        </Sheet>

        {/* Ideas */}
        {data.ideas.length > 0 && !done && (
          <Sheet className="lg:col-span-2">
            <SheetHeader title="Where it could come from" hint="Ideas from your own month, not advice. You know your life best." />
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.ideas.map((idea) => (
                <li key={idea.title} className="flex gap-3 rounded-2xl bg-canary px-3.5 py-3 text-canary-ink">
                  <Lightbulb size={18} className="mt-0.5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-bold">{idea.title}</p>
                    <p className="text-small">{idea.detail}</p>
                    {idea.href && (
                      <Link href={idea.href} className="mt-1 inline-flex min-h-9 items-center text-small font-bold underline underline-offset-2">
                        Take a look
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Sheet>
        )}

        {/* Deposits */}
        <Sheet className="lg:col-span-2">
          <SheetHeader title="Money in and out" hint={data.startSaved > 0 ? `Started with ${dollars(data.startSaved)} on ${formatMedium(data.startDate)}.` : `Started ${formatMedium(data.startDate)}.`} />
          {data.deposits.length === 0 ? (
            <EmptyState title="Nothing added yet">Each time you add money, it shows here and moves the solid line on your track.</EmptyState>
          ) : (
            <ul className="divide-y divide-line-soft">
              {data.deposits.slice(0, 12).map((d) => (
                <li key={d.id} className="flex min-h-12 items-center justify-between gap-3">
                  <span className="text-ink-2">{formatRelativeDay(d.date, today)}</span>
                  <span className={cx("tabular font-bold", d.amount < 0 && "text-ink-2")}>{signedAmount(d.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      </div>

      <GoalDialog sheet={sheet} today={today} onClose={() => setSheet({ kind: "closed" })} onDeleted={() => router.push("/savings")} />
    </>
  );
}

function PlanTile({ amount, label, note }: { amount: number | null; label: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-sunk px-3 py-3">
      <p className="figure text-[1.375rem] leading-tight">{amount === null ? "—" : dollars(amount)}</p>
      <p className="text-micro font-bold text-ink-2">{label}</p>
      {note && <p className="mt-0.5 text-micro text-ink-3">{note}</p>}
    </div>
  );
}

function CheckpointRow({ date, amount, met, today, final }: { date: ISODate; amount: number; met: boolean | null; today: ISODate; final: boolean }) {
  const Icon = final ? Flag : met === true ? Check : met === false ? X : CircleDashed;
  return (
    <li className="flex min-h-12 items-center gap-3">
      <span aria-hidden className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-full", met === true ? "bg-mint text-mint-ink" : met === false ? "bg-canary text-canary-ink" : "bg-sunk text-ink-3")}>
        <Icon size={16} />
      </span>
      <span className="flex-1">
        <span className="block font-bold">{final ? `Goal day, ${formatShort(date)}` : `By ${formatShort(date)}`}</span>
        <span className="block text-small text-ink-3">{met === true ? "Made it" : met === false ? "Fell short" : date === today ? "Today" : `${formatRelativeDay(date, today)}`}</span>
      </span>
      <span className="tabular font-bold">{dollars(amount)}</span>
    </li>
  );
}
