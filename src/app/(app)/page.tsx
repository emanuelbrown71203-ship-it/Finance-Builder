"use client";

import { ArrowDownRight, ArrowUpRight, CalendarClock, ChevronRight, CircleCheck, Landmark, PieChart, PiggyBank, RefreshCcw, Scale, Sparkles, Tag as TagIcon, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BillRow } from "@/components/bills";
import { Runway } from "@/components/charts";
import { LinkBankButton } from "@/components/link-bank";
import { LiveStatus } from "@/components/shell";
import { RecapCard } from "@/components/recap";
import { TxList } from "@/components/transactions";
import { EmptyState, ErrorNote, Fold, PageHeader, Sheet, SheetHeader, Skeleton, Tag, cx } from "@/components/ui";
import { LIVE_INTERVAL, useApi, useNow } from "@/components/use-api";
import { dayOfMonth, formatShort, monthEnd, monthName } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { AttentionItem, Me, Overview } from "@/lib/types";

/*
  Home is for what the person acts on: how much is left, what needs a look,
  what's due, what just happened. Each block shows a few things and links to
  the rest. On a phone it is one column in that order; on a wide screen the
  same blocks sit in two columns.
*/

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 text-small font-bold text-accent-text">
      {children}
      <ChevronRight size={15} />
    </Link>
  );
}

/** Up or down: always an arrow and a number, never colour alone. */
function Change({ cents, period }: { cents: number; period: string }) {
  if (cents === 0) return <span className="text-small text-ink-3">No change {period}</span>;
  const up = cents > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-small text-ink-2">
      <Icon size={15} className={up ? "text-good" : "text-bad"} />
      <span className="tabular font-bold text-ink">{dollars(Math.abs(cents))}</span>&nbsp;{period}
    </span>
  );
}

function PlanLine({ label, amount, note, sign }: { label: string; amount: number; note?: string; sign: "+" | "−" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt>
        {label}
        {note && <span className="block text-small opacity-75">{note}</span>}
      </dt>
      <dd className="tabular whitespace-nowrap font-bold">
        {sign === "−" && "−"}
        {dollars(amount)}
      </dd>
    </div>
  );
}

/** The band at the top: the one number, how fast it's going, and how it's worked out. */
function Hero({ data }: { data: Overview }) {
  const { plan } = data;
  const over = plan.leftToSpend < 0;
  const lastDay = formatShort(monthEnd(plan.month));
  const toSpend = plan.incomeExpected - plan.billsExpected - plan.savingsPlanned;
  const spentShare = toSpend > 0 ? Math.min(1, plan.everydaySpent / toSpend) : 1;
  const dayShare = dayOfMonth(plan.today) / plan.days.length;
  const evenPace = Math.round(Math.max(0, toSpend) * dayShare);
  const ahead = plan.everydaySpent <= evenPace;

  return (
    <section className="order-1 rounded-[26px] p-5 text-white shadow-card sm:p-7" style={{ background: over ? "linear-gradient(135deg, var(--hero-over-a), var(--hero-over-b))" : "linear-gradient(135deg, var(--hero-a), var(--hero-b))" }}>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-small font-semibold opacity-90">
          {monthName(plan.month)}, day {dayOfMonth(plan.today)} of {plan.days.length}
        </p>
        {/* Wide screens show this in the top bar instead. */}
        <span className="text-ink lg:hidden">
          <LiveStatus compact />
        </span>
      </div>
      <p className="figure mt-2 text-[clamp(3.5rem,17vw,5.25rem)]">{dollars(Math.abs(plan.leftToSpend))}</p>
      <h2 className="display mt-2 text-title">{over ? "over what this month can cover" : "left to spend this month"}</h2>
      <p className="mt-1.5 max-w-[46ch] opacity-90">
        {over
          ? `Spending is ahead of what came in after bills and savings. Holding back until ${lastDay} closes the gap.`
          : plan.daysLeft > 1
            ? `That’s ${dollars(plan.perDay)} a day through ${lastDay}. Every bill and savings goal is already covered.`
            : "Every bill and savings goal for the month is already covered."}
      </p>

      {toSpend > 0 && (
        <div className="mt-5">
          <div className="relative h-3 rounded-full bg-white/25" role="meter" aria-label="Spent so far this month" aria-valuemin={0} aria-valuemax={toSpend} aria-valuenow={Math.min(plan.everydaySpent, toSpend)}>
            <div className="h-full rounded-full bg-white" style={{ width: `${Math.max(2, spentShare * 100)}%` }} />
            {/* Where spending would be today at an even pace. */}
            <span aria-hidden className="absolute -top-1 h-5 w-0.5 rounded-full bg-[#ffd84d]" style={{ left: `${dayShare * 100}%` }} />
          </div>
          <p className="mt-2 text-small opacity-90">
            <span className="tabular font-bold">{dollars(plan.everydaySpent)}</span> spent of <span className="tabular font-bold">{dollars(toSpend)}</span>. {ahead ? "That’s under" : "That’s over"} the even pace of <span className="tabular">{dollars(evenPace)}</span> by today.
          </p>
        </div>
      )}

      <Fold title="How this is worked out" className="mt-4 border-t border-white/25" summary={`${dollars(plan.incomeExpected)} in`}>
        <dl className="divide-y divide-white/20 pb-1">
          <PlanLine label="Money in this month" amount={plan.incomeExpected} sign="+" note={plan.incomeExpected > plan.incomeReceived ? `${dollars(plan.incomeReceived)} in, ${dollars(plan.incomeExpected - plan.incomeReceived)} still expected` : undefined} />
          <PlanLine label="Bills and subscriptions" amount={plan.billsExpected} sign="−" note={plan.billsExpected > plan.billsPaid ? `${dollars(plan.billsPaid)} paid, ${dollars(plan.billsExpected - plan.billsPaid)} still due` : undefined} />
          <PlanLine label="Set aside for goals" amount={plan.savingsPlanned} sign="−" />
          <PlanLine label="Spent so far" amount={plan.everydaySpent} sign="−" />
        </dl>
      </Fold>
    </section>
  );
}

function Tile({ href, section, icon: Icon, label, value, children }: { href: string; section: string; icon: LucideIcon; label: string; value: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx(section, "flex min-w-0 flex-col rounded-sheet border border-line-soft bg-sheet p-3.5 shadow-card transition-transform active:scale-[0.98] sm:p-4")}>
      <span className="flex items-center gap-2 text-small font-bold text-ink-2">
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px]" style={{ background: "color-mix(in srgb, var(--sec) 14%, transparent)", color: "var(--sec)" }}>
          <Icon size={17} strokeWidth={2.2} />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="figure mt-3 truncate text-[1.75rem] sm:text-[2rem]">{value}</span>
      <span className="mt-1.5 truncate">{children}</span>
    </Link>
  );
}

const ATTENTION: Record<AttentionItem["kind"], { icon: LucideIcon; tone: string }> = {
  bank: { icon: Landmark, tone: "bg-canary text-canary-ink" },
  due: { icon: CalendarClock, tone: "bg-pink text-pink-ink" },
  price: { icon: TagIcon, tone: "bg-canary text-canary-ink" },
  budget: { icon: PieChart, tone: "bg-pink text-pink-ink" },
  renewal: { icon: RefreshCcw, tone: "bg-canary text-canary-ink" },
  new: { icon: Sparkles, tone: "bg-sky text-sky-ink" },
};

function NeedsALook({ items }: { items: AttentionItem[] }) {
  return (
    <Sheet className="order-3">
      <SheetHeader title="Needs a look" action={items.length > 0 ? <Tag tone="canary">{items.length}</Tag> : undefined} />
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl bg-mint px-4 py-3 font-bold text-mint-ink">
          <CircleCheck size={19} /> All clear. Nothing needs you right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.slice(0, 4).map((item) => {
            const { icon: Icon, tone } = ATTENTION[item.kind];
            return (
              <li key={item.title}>
                <Link href={item.href} className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line-soft px-2.5 py-2 active:bg-sunk">
                  <span aria-hidden className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}>
                    <Icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-bold leading-snug">{item.title}</span>
                    <span className="tabular block truncate text-small text-ink-3">{item.detail}</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-ink-3" />
                </Link>
              </li>
            );
          })}
          {items.length > 4 && <li className="px-1 text-small text-ink-3">and {items.length - 4} more</li>}
        </ul>
      )}
    </Sheet>
  );
}

function Welcome() {
  return (
    <>
      <PageHeader title="Welcome" />
      <Sheet className="mx-auto max-w-xl">
        <h2 className="display text-title">Link your first account</h2>
        <p className="mt-3 text-ink-2">Sign in to your bank through Plaid and your balances, transactions, bills and investments show up here within a minute. Passbook can read your accounts. It can never move money.</p>
        <div className="mt-6">
          <LinkBankButton />
        </div>
      </Sheet>
    </>
  );
}

function greeting(now: number): string {
  if (!now) return "Home";
  const hour = new Date(now).getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { data, error, mutate } = useApi<Overview>("/api/overview", { refreshInterval: LIVE_INTERVAL });
  const { data: me } = useApi<Me>("/api/me");
  const now = useNow(60_000);

  if (error && !data) {
    return (
      <>
        <PageHeader title="Home" />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Home" />
        <div className="grid grid-cols-1 gap-4">
          <Skeleton className="h-80 rounded-[26px]" />
          <Skeleton className="h-40 rounded-sheet" />
          <Skeleton className="h-60 rounded-sheet" />
        </div>
      </>
    );
  }
  if (data.sync.linkedInstitutions === 0 && data.recent.length === 0) return <Welcome />;

  const budgetLeft = data.budget.totalLimit - data.budget.totalSpent;
  const goalsSaved = data.goals.reduce((s, g) => s + g.saved, 0);
  const goalsTarget = data.goals.reduce((s, g) => s + g.target, 0);
  const hello = greeting(now);

  return (
    <>
      <PageHeader title={hello === "Home" ? "Home" : `${hello}, ${data.firstName}`} />

      {me?.demo && (
        <p className="mb-4 rounded-2xl border-2 border-dashed border-line bg-sheet/60 px-4 py-3 text-small text-ink-2 lg:hidden">
          <span className="font-bold text-ink">Sample data.</span> Nothing here is real. Link a bank in Accounts to see your own.
        </p>
      )}

      <RecapCard today={data.today} />

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[1.3fr_1fr] xl:items-start xl:gap-5">
        <div className="contents xl:flex xl:flex-col xl:gap-5">
          <Hero data={data} />

          <Sheet className="order-6">
            <SheetHeader title="Spending pace" hint="What’s left as the month goes on, against spending it evenly." />
            <Runway plan={data.plan} height={240} />
          </Sheet>

          <Sheet className="order-5">
            <SheetHeader title="Latest activity" hint="New transactions show up here as they happen." action={<More href="/transactions">All</More>} />
            {data.recent.length > 0 ? <TxList transactions={data.recent.slice(0, 6)} today={data.today} grouped={false} /> : <EmptyState title="No transactions yet">They show up here as soon as your bank reports them.</EmptyState>}
          </Sheet>
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-5">
          <div className="order-2 grid grid-cols-2 gap-3 sm:gap-4">
            <Tile href="/net-worth" section="sec-worth" icon={Scale} label="Net worth" value={dollars(data.netWorth.net)}>
              <Change cents={data.netWorth.change} period="in 30 days" />
            </Tile>
            <Tile href="/investing" section="sec-investing" icon={TrendingUp} label="Investing" value={data.investments.total > 0 ? dollars(data.investments.total) : "None yet"}>
              {data.investments.total > 0 ? <Change cents={data.investments.change} period="in 30 days" /> : <span className="text-small text-ink-3">Link an account</span>}
            </Tile>
            <Tile href="/savings" section="sec-savings" icon={PiggyBank} label="Saved for goals" value={goalsTarget > 0 ? dollars(goalsSaved) : "No goals"}>
              <span className="tabular text-small text-ink-2">{goalsTarget > 0 ? `of ${dollars(goalsTarget)}` : "Add one to start"}</span>
            </Tile>
            <Tile href="/budget" section="sec-budget" icon={PieChart} label="Budget" value={data.budget.totalLimit > 0 ? dollars(Math.abs(budgetLeft)) : "No limits"}>
              <span className={cx("tabular text-small", budgetLeft < 0 ? "font-bold text-bad" : "text-ink-2")}>{data.budget.totalLimit > 0 ? (budgetLeft >= 0 ? `left of ${dollars(data.budget.totalLimit)}` : "over your limits") : "Set one to track it"}</span>
            </Tile>
          </div>

          <NeedsALook items={data.attention} />

          <Sheet className="order-4">
            <SheetHeader title="Coming up" hint={data.upcomingTotal > 0 ? `${dollars(data.upcomingTotal)} due in the next 30 days.` : undefined} action={<More href="/bills">All bills</More>} />
            {data.upcoming.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {data.upcoming.slice(0, 3).map((bill) => (
                  <BillRow key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing due soon">Bills are picked up on their own once a charge repeats a few times.</EmptyState>
            )}
          </Sheet>

          {data.goals.length > 0 && (
            <Sheet className="order-7">
              <SheetHeader title="Savings goals" action={<More href="/savings">All</More>} />
              <ul className="flex flex-col gap-4">
                {data.goals.slice(0, 3).map((goal) => (
                  <li key={goal.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="truncate font-bold">{goal.name}</span>
                      <span className="tabular shrink-0 text-small text-ink-2">
                        {dollars(goal.saved)} of {dollars(goal.target)}
                      </span>
                    </div>
                    <div role="meter" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={Math.min(goal.saved, goal.target)} className="h-2.5 overflow-hidden rounded-full bg-sky">
                      <div className="h-full rounded-full bg-[var(--c-savings)]" style={{ width: `${Math.min(100, (goal.saved / goal.target) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Sheet>
          )}
        </div>
      </div>
    </>
  );
}
