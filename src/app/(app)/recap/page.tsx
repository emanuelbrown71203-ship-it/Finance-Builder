"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { celebrate } from "@/components/celebrate";
import { XpTag } from "@/components/game/level";
import { WINS } from "@/lib/game/progress";
import { useEffect, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { SpendDelta, markRecapSeen } from "@/components/recap";
import { Blocks, Button, ErrorNote, IconButton, PageHeader, Sheet, SheetHeader, Skeleton, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { category } from "@/lib/categories";
import { formatShort } from "@/lib/dates";
import { dollars, dollarsExact } from "@/lib/money";
import type { Me, RecapPayload } from "@/lib/types";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="edge min-w-0 rounded-sheet bg-sheet p-3.5 shadow-card">
      <p className="text-small font-bold text-ink-2">{label}</p>
      <p className="figure mt-2 truncate text-[1.6rem]">{value}</p>
      {note && <p className="mt-1 truncate text-small text-ink-3">{note}</p>}
    </div>
  );
}

/** The week ahead: bills and paychecks in the next seven days, what's left to spend, budgets to watch. */
function WeekAhead({ ahead }: { ahead: NonNullable<RecapPayload["ahead"]> }) {
  const events = [
    ...ahead.paychecks.map((p) => ({ key: `p-${p.date}-${p.name}`, date: p.date, name: p.name, amount: p.amount, kind: "pay" as const })),
    ...ahead.bills.map((b) => ({ key: `b-${b.date}-${b.name}`, date: b.date, name: b.name, amount: b.amount, kind: "bill" as const })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return (
    <Sheet>
      <SheetHeader title="The week ahead" hint={`${formatShort(ahead.from)} to ${formatShort(ahead.to)}`} />
      <p className="mb-3 text-ink-2">
        {ahead.leftToSpend >= 0 ? (
          <>
            <span className="tabular font-bold text-ink">{dollars(ahead.leftToSpend)}</span> left to spend this month, about {dollars(ahead.perDay)} a day.
          </>
        ) : (
          <>
            This month is <span className="tabular font-bold text-ink">{dollars(-ahead.leftToSpend)}</span> past what’s left after bills and savings.
          </>
        )}
      </p>
      {events.length > 0 ? (
        <ul className="divide-y divide-line-soft">
          {events.map((e) => (
            <li key={e.key} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-bold">{e.name}</span>
                <span className="block text-small text-ink-3">
                  {formatShort(e.date)}, {e.kind === "pay" ? "payday" : "due"}
                </span>
              </span>
              <span className={`tabular shrink-0 font-bold ${e.kind === "pay" ? "text-good" : ""}`}>{e.kind === "pay" ? `+${dollars(e.amount)}` : dollarsExact(-e.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-ink-3">No bills or paychecks in the next seven days.</p>
      )}
      {ahead.noSpend && (
        <p className="mt-3 rounded-2xl bg-mint px-4 py-3 text-small text-mint-ink">
          <span className="font-bold">No-spend week {ahead.noSpend.phase === "on" ? "is on" : `starts ${formatShort(ahead.noSpend.start)}`}.</span> Bills only until {formatShort(ahead.noSpend.end)}; what’s left goes to savings.
        </p>
      )}
      {(ahead.budgetsOver.length > 0 || ahead.budgetsHeading.length > 0) && (
        <p className="mt-3 rounded-2xl bg-canary px-4 py-3 text-small text-canary-ink">
          {ahead.budgetsOver.length > 0 && <>Over budget: {ahead.budgetsOver.join(", ")}. </>}
          {ahead.budgetsHeading.length > 0 && <>Heading over: {ahead.budgetsHeading.join(", ")}.</>}
        </p>
      )}
    </Sheet>
  );
}

/** A few quick things worth a tap this week; finishing the review is a win. */
function CheckIn({ ahead }: { ahead: NonNullable<RecapPayload["ahead"]> }) {
  const [done, setDone] = useState(ahead.reviewed);
  const [busy, setBusy] = useState(false);
  const items = [
    { key: "bills", href: "/bills", title: ahead.bills.length > 0 ? `Check the ${ahead.bills.length} ${ahead.bills.length === 1 ? "bill" : "bills"} due this week` : "No bills due this week", done: ahead.bills.length === 0 },
    { key: "sort", href: "/transactions?category=other", title: ahead.unsorted > 0 ? `Sort ${ahead.unsorted} ${ahead.unsorted === 1 ? "charge" : "charges"} in Everything else` : "Everything’s sorted", done: ahead.unsorted === 0 },
    { key: "budgets", href: "/budget", title: ahead.budgetsOver.length + ahead.budgetsHeading.length > 0 ? "Look at the budgets heading over" : "Budgets are on track", done: ahead.budgetsOver.length + ahead.budgetsHeading.length === 0 },
    { key: "pay", href: "/budget", title: ahead.paychecks.length > 0 ? "Missed any work? Set a lighter paycheck" : "No paycheck this week", done: ahead.paychecks.length === 0 },
    ...(ahead.leftover ? [{ key: "save", href: "/", title: `Put last month’s ${dollars(ahead.leftover)} in savings`, done: false }] : []),
  ];
  const finish = async () => {
    setBusy(true);
    try {
      await send("POST", "/api/recap");
      setDone(true);
      celebrate("Review done!", "That’s the week looked over. See you next week.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save. Try again.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet>
      <SheetHeader title="Your check-in" hint="A few quick things for the week. Tap one to go there." />
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="flex min-h-12 items-center gap-3 rounded-2xl px-2 py-1.5 active:bg-sunk">
              <span aria-hidden className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg border-2 ${i.done ? "border-transparent bg-mint text-mint-ink" : "border-line"}`}>
                {i.done && <Check size={16} />}
              </span>
              <span className={`min-w-0 flex-1 ${i.done ? "text-ink-3" : "font-bold"}`}>{i.title}</span>
              {!i.done && <ChevronRight size={16} className="shrink-0 text-ink-3" />}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-end gap-2">
        {done ? (
          <p className="flex items-center gap-1.5 font-bold text-mint-ink">
            <Check size={18} /> Review done for this week
          </p>
        ) : (
          <Button variant="primary" disabled={busy} onClick={finish}>
            Finish my review <XpTag xp={WINS.review.xp} />
          </Button>
        )}
      </div>
    </Sheet>
  );
}

export default function RecapPage() {
  const [back, setBack] = useState(0);
  const { data: me } = useApi<Me>("/api/me");
  const { data, error, mutate, isValidating } = useApi<RecapPayload>(`/api/recap?back=${back}`);

  // Opening the recap is what "seen" means; the nudge on Home then goes away for the week.
  useEffect(() => {
    if (me) markRecapSeen(me.today);
  }, [me]);

  if (error && !data) {
    return (
      <>
        <PageHeader title="Weekly review" back={{ href: "/you", label: "You" }} />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Weekly review" back={{ href: "/you", label: "You" }} />
        <Skeleton className="h-64 rounded-sheet" />
      </>
    );
  }

  const largest = Math.max(1, ...data.topCategories.map((c) => c.spent));
  const quiet = data.count === 0 && data.income === 0;

  return (
    <>
      <PageHeader
        title="Weekly review"
        back={{ href: "/you", label: "You" }}
        action={
          <div className="flex items-center gap-1 rounded-control border-2 border-line bg-sheet p-0.5">
            <IconButton label="The week before" onClick={() => setBack(back + 1)} disabled={back >= 12} className="size-10">
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton label="The week after" onClick={() => setBack(back - 1)} disabled={back === 0} className="size-10">
              <ChevronRight size={18} />
            </IconButton>
          </div>
        }
      />

      <div className={`grid max-w-3xl grid-cols-1 gap-4 transition-opacity ${isValidating ? "opacity-70" : ""}`}>
        <section className="hero-card rounded-sheet p-5 sm:p-7">
          <p className="text-small font-semibold opacity-90" aria-live="polite">
            {formatShort(data.from)} to {formatShort(data.to)}
          </p>
          <p className="figure hero-figure mt-3 text-[clamp(3.25rem,16vw,4.75rem)]">{dollars(data.spent)}</p>
          <h2 className="display mt-2 text-title">{back === 0 ? "spent last week" : "spent that week"}</h2>
          <p className="mt-2 opacity-95">{quiet ? "A quiet week: nothing came in or went out." : <SpendDelta now={data.spent} before={data.spentBefore} dollars={dollars} />}</p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Money in" value={dollars(data.income)} />
          <Stat label="Bills paid" value={dollars(data.billsPaid.total)} note={data.billsPaid.count === 1 ? "1 payment" : `${data.billsPaid.count} payments`} />
          <Stat label="No-spend days" value={`${data.noSpendDays} of 7`} note={data.noSpendDays >= 3 ? "Nicely done" : "Bills don’t count"} />
          <Stat
            label="Net worth"
            value={data.netWorthChange === null ? "No record" : `${data.netWorthChange >= 0 ? "+" : "−"}${dollars(Math.abs(data.netWorthChange)).replace("−", "")}`}
            note={data.netWorthChange === null ? "Not tracked that week" : data.netWorthChange >= 0 ? "Up over the week" : "Down over the week"}
          />
        </div>

        {data.topCategories.length > 0 && (
          <Sheet>
            <SheetHeader title="Where it went" hint={`${data.count} ${data.count === 1 ? "purchase" : "purchases"} in all.`} />
            <ul className="flex flex-col gap-3.5">
              {data.topCategories.map((c) => (
                <li key={c.category} className="flex items-center gap-3">
                  <CategoryIcon category={c.category} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="truncate font-bold">{category(c.category).label}</span>
                      <span className="tabular shrink-0">{dollars(c.spent)}</span>
                    </div>
                    <Blocks share={c.spent / largest} color="var(--series-1)" label={`${category(c.category).label}, compared with the biggest`} blocks={14} valueNow={c.spent} valueMax={largest} />
                  </div>
                </li>
              ))}
            </ul>
          </Sheet>
        )}

        {data.ahead && <WeekAhead ahead={data.ahead} />}
        {data.ahead && <CheckIn ahead={data.ahead} />}

        {(data.biggest || data.savedToGoals !== 0) && (
          <Sheet>
            <dl className="divide-y divide-line-soft">
              {data.biggest && (
                <div className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <dt>
                    <span className="block text-small text-ink-3">Biggest purchase</span>
                    <span className="font-bold">{data.biggest.name}</span>
                    <span className="text-ink-3">, {formatShort(data.biggest.date)}</span>
                  </dt>
                  <dd className="tabular font-bold">{dollarsExact(-data.biggest.amount)}</dd>
                </div>
              )}
              {data.savedToGoals !== 0 && (
                <div className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <dt>
                    <span className="block text-small text-ink-3">{data.savedToGoals > 0 ? "Added to savings" : "Taken out of savings"}</span>
                    <span className="font-bold">{data.savedToGoals > 0 ? "Keep it going" : "Savings dipped this week"}</span>
                  </dt>
                  <dd className="tabular font-bold">{dollars(Math.abs(data.savedToGoals))}</dd>
                </div>
              )}
            </dl>
          </Sheet>
        )}
      </div>
    </>
  );
}
