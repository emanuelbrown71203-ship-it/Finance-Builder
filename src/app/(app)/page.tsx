"use client";

import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BillStub } from "@/components/bills";
import { Runway, Sparkline } from "@/components/charts";
import { LinkBankButton } from "@/components/link-bank";
import { TxList } from "@/components/transactions";
import { EmptyState, ErrorNote, Meter, Sheet, SheetHeader, Skeleton, Tag, cx } from "@/components/ui";
import { LIVE_INTERVAL, useApi } from "@/components/use-api";
import { category } from "@/lib/categories";
import { dayOfMonth, formatShort, monthEnd, monthName } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { Overview } from "@/lib/types";

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 rounded-control text-small font-medium text-accent-text hover:underline">
      {children}
      <ChevronRight size={14} />
    </Link>
  );
}

function Change({ cents, period }: { cents: number; period: string }) {
  if (cents === 0) return <span className="text-small text-ink-3">No change {period}</span>;
  const up = cents > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-small text-ink-2">
      <Icon size={15} className={up ? "text-good" : "text-bad"} />
      <span className="tabular font-medium text-ink">{dollars(Math.abs(cents))}</span> {up ? "up" : "down"} {period}
    </span>
  );
}

function PlanLine({ label, amount, note, sign }: { label: string; amount: number; note?: string; sign: "+" | "−" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt>
        <span className="text-ink-2">{label}</span>
        {note && <span className="block text-micro text-ink-3">{note}</span>}
      </dt>
      <dd className="tabular whitespace-nowrap font-medium">
        {sign === "−" && "−"}
        {dollars(amount)}
      </dd>
    </div>
  );
}

function Hero({ data }: { data: Overview }) {
  const { plan } = data;
  const over = plan.leftToSpend < 0;
  const lastDay = formatShort(monthEnd(plan.month));
  return (
    <Sheet className="grid grid-cols-1 gap-x-10 gap-y-6 xl:grid-cols-[minmax(17rem,22rem)_1fr]">
      <div>
        <p className="text-small text-ink-3">
          {monthName(plan.month)}, day {dayOfMonth(plan.today)} of {plan.days.length}
        </p>
        <h1 className="mt-3">
          <span className={cx("figure block text-[clamp(3.25rem,9vw,4.75rem)]", over && "text-bad")}>{dollars(Math.abs(plan.leftToSpend))}</span>
          <span className="display mt-2 block text-title">{over ? "over what this month can cover" : "left to spend this month"}</span>
        </h1>
        <p className="mt-2 text-ink-2">
          {over
            ? `Spending is ahead of income after bills and savings. Holding back until ${lastDay} closes the gap.`
            : plan.daysLeft > 1
              ? `That’s ${dollars(plan.perDay)} a day through ${lastDay}, with every bill and savings goal already covered.`
              : "Every bill and savings goal for the month is already covered."}
        </p>

        <dl className="mt-5 divide-y divide-line-soft border-y border-line-soft text-small">
          <PlanLine label="Income this month" amount={plan.incomeExpected} sign="+" note={plan.incomeExpected > plan.incomeReceived ? `${dollars(plan.incomeReceived)} in, ${dollars(plan.incomeExpected - plan.incomeReceived)} expected` : undefined} />
          <PlanLine label="Bills and subscriptions" amount={plan.billsExpected} sign="−" note={plan.billsExpected > plan.billsPaid ? `${dollars(plan.billsPaid)} paid, ${dollars(plan.billsExpected - plan.billsPaid)} still due` : undefined} />
          <PlanLine label="Set aside for goals" amount={plan.savingsPlanned} sign="−" />
          <PlanLine label="Spent so far" amount={plan.everydaySpent} sign="−" />
        </dl>
      </div>
      <div className="min-w-0 self-end">
        <Runway plan={plan} height={300} />
      </div>
    </Sheet>
  );
}

function Welcome() {
  return (
    <Sheet className="mx-auto mt-8 max-w-xl">
      <h1 className="display text-headline">Link your first account</h1>
      <p className="mt-3 text-ink-2">Sign in to your bank through Plaid and your balances, transactions, bills and investments show up here within a minute. Passbook can read your accounts. It can never move money.</p>
      <div className="mt-6">
        <LinkBankButton />
      </div>
    </Sheet>
  );
}

export default function HomePage() {
  const { data, error, mutate } = useApi<Overview>("/api/overview", { refreshInterval: LIVE_INTERVAL });

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-[26rem] rounded-sheet" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-sheet" />
          <Skeleton className="h-80 rounded-sheet" />
        </div>
      </div>
    );
  }
  if (data.sync.linkedInstitutions === 0 && data.recent.length === 0) return <Welcome />;

  const budgetLeft = data.budget.totalLimit - data.budget.totalSpent;

  return (
    <div className="grid grid-cols-1 gap-5">
      <Hero data={data} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Sheet>
          <SheetHeader title="Latest activity" hint="New transactions appear here as they happen." action={<More href="/transactions">All transactions</More>} />
          {data.recent.length > 0 ? <TxList transactions={data.recent} today={data.today} grouped={false} /> : <EmptyState title="No transactions yet">They show up here as soon as your bank reports them.</EmptyState>}
        </Sheet>

        <Sheet>
          <SheetHeader title="Coming up" hint="Bills due in the next 30 days." action={<More href="/bills">All bills</More>} />
          {data.upcoming.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {data.upcoming.map((bill) => (
                <BillStub key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} />
              ))}
              <li className="mt-1 flex items-baseline justify-between gap-3 border-t border-line-soft pt-3 text-small">
                <span className="text-ink-2">Total due in the next 30 days</span>
                <span className="tabular font-medium">{dollars(data.upcomingTotal)}</span>
              </li>
            </ul>
          ) : (
            <EmptyState title="Nothing due soon">Bills are picked up automatically once a charge repeats a few times.</EmptyState>
          )}
        </Sheet>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Sheet>
          <SheetHeader title="Net worth" action={<More href="/net-worth">Details</More>} />
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="figure text-[2.5rem]">{dollars(data.netWorth.net)}</p>
              <p className="mt-2">
                <Change cents={data.netWorth.change} period="in 30 days" />
              </p>
            </div>
            <Sparkline values={data.netWorth.series.map((p) => p.net)} width={150} height={48} label="Net worth over the last 90 days" />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-small">
            <div className="rounded-control bg-mint px-3 py-2 text-mint-ink">
              <dt>You own</dt>
              <dd className="tabular text-lead font-semibold">{dollars(data.netWorth.assets)}</dd>
            </div>
            <div className="rounded-control bg-pink px-3 py-2 text-pink-ink">
              <dt>You owe</dt>
              <dd className="tabular text-lead font-semibold">{dollars(data.netWorth.debts)}</dd>
            </div>
          </dl>
        </Sheet>

        <Sheet>
          <SheetHeader
            title="Budget"
            hint={
              data.budget.totalLimit > 0
                ? budgetLeft >= 0
                  ? `${dollars(budgetLeft)} left of ${dollars(data.budget.totalLimit)} across your limits.`
                  : `${dollars(-budgetLeft)} over your ${dollars(data.budget.totalLimit)} in limits.`
                : undefined
            }
            action={<More href="/budget">Budget</More>}
          />
          {data.budget.rows.length > 0 ? (
            <ul className="flex flex-col gap-3.5">
              {data.budget.rows.slice(0, 4).map((row) => {
                const overBy = row.spent - (row.limit ?? 0);
                return (
                  <li key={row.category}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-small">
                      <span className="font-medium">{category(row.category).label}</span>
                      <span className="tabular text-ink-2">
                        {dollars(row.spent)} of {dollars(row.limit ?? 0)}
                        {overBy > 0 && (
                          <Tag tone="pink" className="ml-2">
                            {dollars(overBy)} over
                          </Tag>
                        )}
                      </span>
                    </div>
                    <Meter value={row.spent} max={row.limit ?? 0} label={`${category(row.category).label} budget used`} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No limits set">Set a monthly limit for a category and track it here.</EmptyState>
          )}
        </Sheet>

        <Sheet>
          <SheetHeader title="Savings goals" action={<More href="/savings">Savings</More>} />
          {data.goals.length > 0 ? (
            <ul className="flex flex-col gap-3.5">
              {data.goals.slice(0, 3).map((goal) => (
                <li key={goal.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-small">
                    <span className="font-medium">{goal.name}</span>
                    <span className="tabular text-ink-2">
                      {dollars(goal.saved)} of {dollars(goal.target)}
                    </span>
                  </div>
                  <div role="meter" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={Math.min(goal.saved, goal.target)} className="h-2 overflow-hidden rounded-full bg-sky">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (goal.saved / goal.target) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No goals yet">Name something you’re saving for and watch it fill up.</EmptyState>
          )}
        </Sheet>

        <Sheet>
          <SheetHeader title="Investing" action={<More href="/investing">Holdings</More>} />
          {data.investments.total > 0 ? (
            <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="figure text-[2.5rem]">{dollars(data.investments.total)}</p>
                <p className="mt-2">
                  <Change cents={data.investments.change} period="in 30 days" />
                </p>
              </div>
              <Sparkline values={data.investments.series.map((p) => p.value)} width={150} height={48} label="Investments over the last 90 days" />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-small">
              <div className="rounded-control bg-sunk px-3 py-2 text-ink-2">
                <dt>You put in</dt>
                <dd className="tabular text-lead font-semibold text-ink">{dollars(data.investments.costBasis)}</dd>
              </div>
              <div className="rounded-control bg-sky px-3 py-2 text-sky-ink">
                <dt>{data.investments.total >= data.investments.costBasis ? "Growth so far" : "Down so far"}</dt>
                <dd className="tabular text-lead font-semibold">{dollars(Math.abs(data.investments.total - data.investments.costBasis))}</dd>
              </div>
            </dl>
            </>
          ) : (
            <EmptyState title="No investment accounts linked">Link a brokerage or retirement account to see holdings and performance.</EmptyState>
          )}
        </Sheet>
      </div>
    </div>
  );
}
