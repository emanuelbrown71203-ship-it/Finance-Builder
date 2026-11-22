"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { SpendDelta, markRecapSeen } from "@/components/recap";
import { Blocks, ErrorNote, IconButton, PageHeader, Sheet, SheetHeader, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
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
        <PageHeader title="Weekly recap" back={{ href: "/you", label: "You" }} />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Weekly recap" back={{ href: "/you", label: "You" }} />
        <Skeleton className="h-64 rounded-sheet" />
      </>
    );
  }

  const largest = Math.max(1, ...data.topCategories.map((c) => c.spent));
  const quiet = data.count === 0 && data.income === 0;

  return (
    <>
      <PageHeader
        title="Weekly recap"
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
