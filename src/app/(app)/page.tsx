"use client";

import { CalendarCheck, CalendarClock, ChevronRight, CircleCheck, Gauge, Landmark, PieChart, RefreshCcw, Sparkles, Tag as TagIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { BillRow, billHref } from "@/components/bills";
import { BudgetBar, available } from "@/components/budget";
import { CategoryIcon } from "@/components/category-icon";
import { GAME_URL } from "@/components/game/game";
import { LevelBlock } from "@/components/game/level";
import { LinkBankButton } from "@/components/link-bank";
import { LiveStatus } from "@/components/shell";
import { markRecapSeen, weekId } from "@/components/recap";
import { TxList } from "@/components/transactions";
import { NoSpendCard } from "@/components/no-spend";
import { MonthLedger } from "@/components/month-money";
import { Blocks, Button, EmptyState, ErrorNote, Fold, PageHeader, Sheet, SheetHeader, Skeleton, Tag, cx } from "@/components/ui";
import { LIVE_INTERVAL, useApi, useNow } from "@/components/use-api";
import { category } from "@/lib/categories";
import { dayOfMonth, formatShort, monthEnd, monthName } from "@/lib/dates";
import type { GamePayload } from "@/lib/game/progress";
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
    <section className={cx("hero-card order-1 rounded-sheet p-5 sm:p-7", over && "hero-over")}>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-small font-semibold opacity-90">
          {monthName(plan.month)}, day {dayOfMonth(plan.today)} of {plan.days.length}
        </p>
        {/* Wide screens show this in the top bar instead. */}
        <span className="text-ink lg:hidden">
          <LiveStatus compact />
        </span>
      </div>
      <p className="figure hero-figure mt-3 text-[clamp(3rem,15vw,4.75rem)]">{dollars(Math.abs(plan.leftToSpend))}</p>
      <h2 className="display mt-2 text-title">{over ? "over this month’s money" : "free to spend this month"}</h2>
      <p className="mt-1.5 max-w-[46ch] opacity-90">
        {over
          ? `Spending has gone past what came in, after bills and savings. Holding off until ${lastDay} keeps it from growing.`
          : plan.daysLeft > 1
            ? `After every bill and your savings. That’s ${dollars(plan.perDay)} a day through ${lastDay}.`
            : "After every bill and your savings for the month."}
      </p>

      {toSpend > 0 && (
        <div className="mt-5">
          {/* The tick is where spending would be today at an even pace. */}
          <Blocks share={spentShare} color="var(--hero-figure)" label="Spent so far this month" blocks={14} height={12} valueNow={Math.min(plan.everydaySpent, toSpend)} valueMax={toSpend} marker={dayShare} />
          <p className="mt-2 text-small opacity-90">
            <span className="tabular font-bold">{dollars(plan.everydaySpent)}</span> spent of the <span className="tabular font-bold">{dollars(toSpend)}</span> there is for everyday spending. {ahead ? "That’s under" : "That’s over"} the even pace of <span className="tabular">{dollars(evenPace)}</span> by today.
          </p>
        </div>
      )}

      <Fold title="Where this month’s money is" className="hero-rule mt-4 border-t" summary={`${dollars(plan.incomeReceived)} came in`}>
        <div className="pb-1">
          <MonthLedger f={plan} when="now" tone="hero" />
        </div>
        <Link href="/budget" className="mb-2 inline-flex min-h-11 items-center gap-1 font-bold underline underline-offset-4">
          See it all in your budget <ChevronRight size={16} />
        </Link>
      </Fold>
    </section>
  );
}

const ATTENTION: Record<AttentionItem["kind"], { icon: LucideIcon; tone: string }> = {
  bank: { icon: Landmark, tone: "bg-canary text-canary-ink" },
  due: { icon: CalendarClock, tone: "bg-pink text-pink-ink" },
  price: { icon: TagIcon, tone: "bg-canary text-canary-ink" },
  budget: { icon: PieChart, tone: "bg-pink text-pink-ink" },
  pace: { icon: Gauge, tone: "bg-canary text-canary-ink" },
  renewal: { icon: RefreshCcw, tone: "bg-canary text-canary-ink" },
  new: { icon: Sparkles, tone: "bg-sky text-sky-ink" },
};

/** Whether this week's recap is ready and not opened yet (kept on this device). */
function useRecapReady(today: string): boolean {
  const seen = useSyncExternalStore(
    (l) => {
      window.addEventListener("passbook-recap-seen-change", l);
      return () => window.removeEventListener("passbook-recap-seen-change", l);
    },
    () => {
      try {
        return localStorage.getItem("passbook-recap-seen");
      } catch {
        return null;
      }
    },
    () => "unknown",
  );
  return seen !== "unknown" && seen !== weekId(today);
}

function NeedsALook({ items, today }: { items: AttentionItem[]; today: string }) {
  const recap = useRecapReady(today);
  return (
    <Sheet className="order-3">
      <SheetHeader title="Needs a look" action={items.length > 0 ? <Tag tone="canary">{items.length}</Tag> : undefined} />
      {recap && (
        <Link href="/recap" onClick={() => markRecapSeen(today)} className="mb-2 flex min-h-[60px] items-center gap-3 rounded-2xl border border-line-soft px-2.5 py-2 active:bg-sunk">
          <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky text-sky-ink">
            <CalendarCheck size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold leading-snug">Your weekly review is ready</span>
            <span className="block truncate text-small text-ink-3">What you spent, saved and paid last week</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-ink-3" />
        </Link>
      )}
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

/** The budgets that need a look most, a tap from the whole budget. */
function Budgets({ data }: { data: Overview }) {
  const rows = data.budget.rows.slice(0, 4);
  return (
    <Sheet className="order-4 sec-budget">
      <SheetHeader title="Budgets" hint={rows.length > 0 ? (data.budget.left >= 0 ? `${dollars(data.budget.left)} left across ${data.budget.rows.length} ${data.budget.rows.length === 1 ? "budget" : "budgets"}.` : `${dollars(-data.budget.left)} over across your budgets.`) : undefined} action={rows.length > 0 ? <More href="/budget">All</More> : undefined} />
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.category}>
              <Link href={`/budget?category=${r.category}`} className="-mx-1 flex items-center gap-3 rounded-2xl px-1 py-2 active:bg-sunk">
                <CategoryIcon category={r.category} />
                <span className="min-w-0 flex-1">
                  <span className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words font-bold leading-snug">{category(r.category).label}</span>
                    <span className={cx("tabular shrink-0 text-small", (r.left ?? 0) < 0 ? "font-bold text-bad" : "text-ink-2")}>
                      {(r.left ?? 0) < 0 ? `${dollars(-(r.left ?? 0))} over` : `${dollars(r.left ?? 0)} left of ${dollars(available(r))}`}
                    </span>
                  </span>
                  <BudgetBar row={r} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-control bg-sunk px-4 py-4">
          <p className="text-ink-2">Give your everyday spending a plan. Passbook can suggest one from your last three months in one tap.</p>
          <Link href="/budget">
            <Button variant="primary" tabIndex={-1}>
              Set up my budget
            </Button>
          </Link>
        </div>
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
  const { data: game } = useApi<GamePayload>(GAME_URL);
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
          <Skeleton className="h-80 rounded-sheet" />
          <Skeleton className="h-40 rounded-sheet" />
          <Skeleton className="h-60 rounded-sheet" />
        </div>
      </>
    );
  }
  if (data.sync.linkedInstitutions === 0 && data.recent.length === 0) return <Welcome />;

  const hello = greeting(now);

  return (
    <>
      <PageHeader
        title={hello === "Home" ? "Home" : `${hello}, ${data.firstName}`}
        action={
          game ? (
            <Link href="/you" aria-label={`Level ${game.level}: ${game.needed - game.into} XP to the next. See your progress.`} className="rounded-[12px] transition-transform active:scale-95">
              <LevelBlock level={game.level} size={44} />
            </Link>
          ) : undefined
        }
      />

      {me?.demo && (
        <p className="mb-4 rounded-2xl border-2 border-dashed border-line bg-sheet/60 px-4 py-3 text-small text-ink-2 lg:hidden">
          <span className="font-bold text-ink">Sample data.</span> Nothing here is real. Link a bank in Accounts to see your own.
        </p>
      )}

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[1.3fr_1fr] xl:items-start xl:gap-5">
        <div className="contents xl:flex xl:flex-col xl:gap-5">
          <Hero data={data} />

          {data.noSpend && <NoSpendCard week={data.noSpend} today={data.today} className="order-2" />}

          <Budgets data={data} />

          <Sheet className="order-6">
            <SheetHeader title="Latest activity" hint="New transactions show up here as they happen." action={<More href="/transactions">All</More>} />
            {data.recent.length > 0 ? <TxList transactions={data.recent.filter((t) => !t.roundUp).slice(0, 5)} today={data.today} grouped={false} /> : <EmptyState title="No transactions yet">They show up here as soon as your bank reports them.</EmptyState>}
          </Sheet>
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-5">
          <NeedsALook items={data.attention} today={data.today} />

          <Sheet className="order-5">
            <SheetHeader title="Coming up" hint={data.upcomingTotal > 0 ? `${dollars(data.upcomingTotal)} due in the next 30 days.` : undefined} action={<More href="/bills">All bills</More>} />
            {data.upcoming.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {data.upcoming.slice(0, 3).map((bill) => (
                  <BillRow key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} href={billHref(bill)} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing due soon">Bills are picked up on their own once a charge repeats a few times.</EmptyState>
            )}
          </Sheet>
        </div>
      </div>
    </>
  );
}
