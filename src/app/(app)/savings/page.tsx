"use client";

import { XpTag } from "@/components/game/level";
import { WINS } from "@/lib/game/progress";
import { SectionTabs } from "@/components/nav";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Columns } from "@/components/charts";
import { GoalDialog, goalSentence, goalStatus, type GoalSheet } from "@/components/goals";
import { Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, Tag } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { monthName } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { GoalView, GoalsPayload } from "@/lib/types";

function GoalCard({ goal, onAdd }: { goal: GoalView; onAdd: () => void }) {
  const ratio = Math.min(1, goal.saved / goal.target);
  const done = goal.saved >= goal.target;
  const status = goalStatus(goal);
  return (
    <Sheet as="article" className="flex flex-col">
      <Link href={`/savings/goal?id=${encodeURIComponent(goal.id)}`} className="-m-2 block rounded-2xl p-2 active:bg-sunk">
        <div className="flex items-start justify-between gap-3">
          <h3 className="display text-lead">{goal.name}</h3>
          <Tag tone={status.tone}>{status.label}</Tag>
        </div>
        <p className="mt-4">
          <span className="figure text-[2.25rem]">{dollars(goal.saved)}</span>
          <span className="tabular ml-2 text-ink-2">of {dollars(goal.target)}</span>
        </p>
        <div role="meter" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={Math.min(goal.saved, goal.target)} className="mt-4 h-3 overflow-hidden rounded-full bg-sky">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(ratio > 0 ? 2 : 0, ratio * 100)}%` }} />
        </div>
        <p className="mt-3 text-small text-ink-2">{goalSentence(goal)}</p>
      </Link>
      <div className="mt-4 flex flex-1 items-end gap-2">
        {!done && (
          <Button size="sm" variant="primary" onClick={onAdd}>
            Add money
            <XpTag xp={WINS.save.xp} />
          </Button>
        )}
        <Link href={`/savings/goal?id=${encodeURIComponent(goal.id)}`} className="inline-flex min-h-11 items-center gap-1 rounded-control px-3 text-small font-bold text-accent-text active:scale-[0.98]">
          See the track <ChevronRight size={16} />
        </Link>
      </div>
    </Sheet>
  );
}

export default function SavingsPage() {
  const { data, error, mutate } = useApi<GoalsPayload>("/api/goals", { refreshInterval: 30_000 });
  const [sheet, setSheet] = useState<GoalSheet>({ kind: "closed" });

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-64 rounded-sheet" />
        <Skeleton className="h-72 rounded-sheet" />
      </div>
    );
  }

  const earmarked = data.goals.reduce((s, g) => s + g.saved, 0);
  const monthlyPlan = data.goals.filter((g) => g.saved < g.target).reduce((s, g) => s + g.monthlyContribution, 0);
  const savedSixMonths = data.monthlySaved.reduce((s, m) => s + m.amount, 0);

  return (
    <>
      <PageHeader
        title="Wealth"
        lead="What you’ve put away, and what it’s for."
        action={
          <Button variant="primary" onClick={() => setSheet({ kind: "new" })}>
            <Plus size={16} /> New goal
          </Button>
        }
      />
      <SectionTabs />

      <div className="grid grid-cols-1 gap-5">
        <Sheet className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(15rem,20rem)_1fr]">
          <div>
            <p className="text-small text-ink-3">In savings accounts</p>
            <p className="figure mt-3 text-[3.25rem]">{dollars(data.savingsBalance)}</p>
            <dl className="mt-5 divide-y divide-line-soft border-y border-line-soft text-small">
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">Earmarked for goals</dt>
                <dd className="tabular font-medium">{dollars(earmarked)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">Not earmarked</dt>
                <dd className="tabular font-medium">{dollars(Math.max(0, data.savingsBalance - earmarked))}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">Planned each month</dt>
                <dd className="tabular font-medium">{dollars(monthlyPlan)}</dd>
              </div>
            </dl>
            <ul className="mt-4 text-small text-ink-2">
              {data.savingsAccounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-4 py-1">
                  <span>
                    {a.name}
                    <span className="block text-micro text-ink-3">{a.institutionName}</span>
                  </span>
                  <span className="tabular">{dollars(a.balance)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <h2 className="display text-lead">Added to savings each month</h2>
            <p className="mb-3 mt-1 text-small text-ink-3">
              Deposits and interest minus withdrawals. {savedSixMonths >= 0 ? `${dollars(savedSixMonths)} added` : `${dollars(-savedSixMonths)} taken out`} over six months.
            </p>
            {data.savingsAccounts.length > 0 ? (
              <Columns label="Net added to savings accounts in each of the last six months" series={[{ name: "Added to savings", color: "var(--series-1)" }]} groups={data.monthlySaved.map((m) => ({ key: m.month, label: monthName(m.month).slice(0, 3), values: [Math.max(0, m.amount)] }))} />
            ) : (
              <EmptyState title="No savings account linked">Link one on the Accounts screen to track deposits here.</EmptyState>
            )}
          </div>
        </Sheet>

        <section aria-labelledby="goals-heading">
          <h2 id="goals-heading" className="display mb-3 text-title">
            Goals
          </h2>
          {data.goals.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onAdd={() => setSheet({ kind: "add", goal })} />
              ))}
            </div>
          ) : (
            <Sheet>
              <EmptyState title="No goals yet" action={<Button variant="primary" onClick={() => setSheet({ kind: "new" })}>Create a goal</Button>}>
                Name something you’re saving for, how much and by when, and Passbook lays out the track: what to put away each month, each week and each payday.
              </EmptyState>
            </Sheet>
          )}
        </section>
      </div>

      <GoalDialog sheet={sheet} today={data.today} onClose={() => setSheet({ kind: "closed" })} />
    </>
  );
}
