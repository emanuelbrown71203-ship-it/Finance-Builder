"use client";

import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TrendChart } from "@/components/charts";
import { Button, Dialog, EmptyState, ErrorNote, Field, IconButton, Input, MoneyInput, PageHeader, Segmented, Sheet, SheetHeader, Skeleton, Tag, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { addMonthsToMonth, monthName, monthOf } from "@/lib/dates";
import { dollars, parseDollarsToCents } from "@/lib/money";
import type { DebtPayload, DebtView } from "@/lib/types";

const STEP = 2500; // $25 at a time
const monthLabel = (month: string) => `${monthName(month).slice(0, 3)} ${month.slice(0, 4)}`;

/** "2 years and 3 months", "8 months" */
function span(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y > 0 ? `${y} ${y === 1 ? "year" : "years"}` : "", m > 0 ? `${m} ${m === 1 ? "month" : "months"}` : ""].filter(Boolean);
  return parts.join(" and ") || "less than a month";
}

function EditDebt({ debt, onClose }: { debt: DebtView; onClose: () => void }) {
  const [apr, setApr] = useState(debt.aprPercent !== null ? String(debt.aprPercent) : "");
  const [payment, setPayment] = useState(debt.payment !== null ? String(debt.payment / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = Number(apr);
    const cents = parseDollarsToCents(payment);
    if (apr.trim() === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) return setError("Enter the interest rate as a number, like 6.5.");
    if (cents === null || cents <= 0) return setError("Enter what you pay each month, like 250.");
    setBusy(true);
    try {
      await send("PATCH", `/api/debt/${debt.id}`, { aprPercent: rate, monthlyPayment: cents });
      onClose();
      toast(`${debt.name} updated`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-small text-ink-2">
        You owe <span className="tabular font-bold text-ink">{dollars(debt.balance)}</span>. Both numbers are on your statement.
      </p>
      <Field label="Interest rate (APR), in percent">{(id) => <Input id={id} inputMode="decimal" enterKeyHint="next" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="6.5" />}</Field>
      <Field label="What you pay each month" error={error}>
        {(id) => <MoneyInput id={id} value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="0" />}
      </Field>
      <div className="mt-2 flex gap-2">
        <Button className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" variant="primary" type="submit" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

export default function DebtPage() {
  const { data, error, mutate, isValidating } = useApi<DebtPayload>("/api/debt", { refreshInterval: 60_000 });
  const [editing, setEditing] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);

  if (error && !data) {
    return (
      <>
        <PageHeader title="Debt payoff" />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Debt payoff" />
        <div className="grid grid-cols-1 gap-4">
          <Skeleton className="h-64 rounded-[26px]" />
          <Skeleton className="h-64 rounded-sheet" />
        </div>
      </>
    );
  }

  if (data.debts.length === 0) {
    return (
      <>
        <PageHeader title="Debt payoff" />
        <Sheet>
          <p className="rounded-2xl bg-mint px-4 py-3 font-bold text-mint-ink">Nothing owed. Every linked card and loan is at zero.</p>
          <p className="mt-3 text-ink-2">
            If you have a loan that isn’t linked, add it on the <Link href="/net-worth" className="font-bold text-accent-text">Net worth</Link> screen and it shows up here.
          </p>
        </Sheet>
      </>
    );
  }

  const setExtra = (cents: number) => send("PUT", "/api/debt", { extra: Math.max(0, cents) }).catch((e) => toast(e instanceof Error ? e.message : "Couldn’t save. Try again.", { tone: "error" }));
  const inPlan = data.debts.filter((d) => d.order !== null);
  const month = monthOf(data.today);
  const saved = data.base.months !== null && data.plan.months !== null ? data.base.months - data.plan.months : null;
  const interestSaved = data.base.totalInterest - data.plan.totalInterest;
  const editingDebt = data.debts.find((d) => d.id === editing) ?? null;
  const points = data.plan.balances.map((value, i) => ({ date: `${addMonthsToMonth(month, i)}-01`, value }));

  return (
    <>
      <PageHeader title="Debt payoff" lead="When you’ll be debt-free at today’s payments, and what a little extra each month would change." />

      <div className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.25fr_1fr] lg:gap-5 ${isValidating ? "opacity-80" : ""}`}>
        <div className="grid grid-cols-1 gap-4 lg:gap-5">
          <section className="rounded-[26px] p-5 text-white shadow-card sm:p-7" style={{ background: "linear-gradient(135deg, var(--hero-over-a), var(--hero-over-b))" }}>
            {inPlan.length === 0 ? (
              <>
                <h2 className="display text-title">{data.needsDetails > 0 ? "Add a couple of numbers to see your date" : "Nothing here is costing you interest"}</h2>
                <p className="mt-2 opacity-90">{data.needsDetails > 0 ? "Tap a debt below and fill in its interest rate and monthly payment." : "Your cards are being paid off as you go."}</p>
              </>
            ) : data.plan.debtFreeMonth ? (
              <>
                <p className="text-small font-semibold opacity-90">Debt-free by</p>
                <p className="figure mt-3 text-[clamp(3rem,15vw,4.5rem)]">{monthLabel(data.plan.debtFreeMonth)}</p>
                <h2 className="display mt-2 text-title">{span(data.plan.months!)} from now</h2>
                <p className="mt-2 opacity-90">
                  You owe <span className="tabular font-bold">{dollars(inPlan.reduce((s, d) => s + d.balance, 0))}</span> across {inPlan.length === 1 ? "one debt" : `${inPlan.length} debts`}, and will pay about <span className="tabular font-bold">{dollars(data.plan.totalInterest)}</span> in interest on the way.
                </p>
              </>
            ) : (
              <>
                <h2 className="display text-title">At these payments it never gets paid off</h2>
                <p className="mt-2 opacity-90">A payment is smaller than the interest added each month. Add extra below, or raise that payment, to see a date.</p>
              </>
            )}
          </section>

          {inPlan.length > 0 && data.plan.balances.length > 1 && (
            <Sheet>
              <SheetHeader title="How it comes down" hint="What you still owe, month by month." />
              <div className="pb-7">
                <TrendChart label="What you still owe" height={220} points={points} formatDate={(d) => monthLabel(d.slice(0, 7))} compare={data.extra > 0 ? { values: data.base.balances, label: "Without the extra", mainLabel: "With the extra" } : undefined} />
              </div>
            </Sheet>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:gap-5">
          {inPlan.length > 0 && (
            <Sheet>
              <SheetHeader title="Put a little extra toward it" hint="On top of your regular payments, each month." />
              <div className="flex items-center gap-2">
                <IconButton label="$25 less" onClick={() => setExtra(data.extra - STEP)} disabled={data.extra <= 0} className="size-12">
                  <Minus size={20} />
                </IconButton>
                <div className="min-w-0 flex-1">
                  <MoneyInput
                    aria-label="Extra each month"
                    className="text-center text-lead font-bold"
                    value={typed ?? String(data.extra / 100)}
                    onChange={(e) => setTyped(e.target.value)}
                    onBlur={() => {
                      const cents = typed === null ? null : parseDollarsToCents(typed.trim() === "" ? "0" : typed);
                      setTyped(null);
                      if (cents !== null && cents !== data.extra) void setExtra(cents);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </div>
                <IconButton label="$25 more" onClick={() => setExtra(data.extra + STEP)} className="size-12">
                  <Plus size={20} />
                </IconButton>
              </div>
              <p className="mt-3 rounded-2xl bg-mint px-4 py-3 text-mint-ink" aria-live="polite">
                {data.extra === 0 ? (
                  "Tap + to see how much sooner you’d be done."
                ) : saved !== null && saved > 0 ? (
                  <>
                    <span className="font-bold">{span(saved)} sooner</span>, and about <span className="tabular font-bold">{dollars(interestSaved)}</span> less in interest.
                  </>
                ) : data.plan.months !== null && data.base.months === null ? (
                  <>That’s enough to get it paid off: {span(data.plan.months)} from now.</>
                ) : (
                  <>About {dollars(Math.max(0, interestSaved))} less in interest.</>
                )}
              </p>

              {inPlan.length > 1 && (
                <div className="mt-5">
                  <p className="mb-2 text-small font-bold text-ink-2">Where the extra goes first</p>
                  <Segmented
                    full
                    label="Where the extra goes first"
                    value={data.strategy}
                    onChange={(strategy) => void send("PUT", "/api/debt", { strategy })}
                    options={[
                      { value: "avalanche", label: "Highest interest" },
                      { value: "snowball", label: "Smallest balance" },
                    ]}
                  />
                  <p className="mt-2 text-small text-ink-3">{data.strategy === "avalanche" ? "Costs the least overall." : "Clears a whole debt soonest, which keeps you going."}</p>
                </div>
              )}
            </Sheet>
          )}

          <Sheet>
            <SheetHeader title="What you owe" hint="Tap one to set its interest rate or payment." action={<Tag tone="pink">{dollars(data.totalOwed)}</Tag>} />
            <ul className="flex flex-col gap-2">
              {data.debts.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setEditing(d.id)} className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-line-soft px-3 py-2.5 text-left active:bg-sunk">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-bold">{d.name}</span>
                        {d.paidInFull ? <Tag tone="mint">Paid as you go</Tag> : d.order === null ? <Tag tone="canary">Add details</Tag> : d.order === 1 && data.extra > 0 && inPlan.length > 1 ? <Tag tone="sky">Extra goes here first</Tag> : null}
                      </span>
                      <span className="block text-small text-ink-3">
                        {d.paidInFull
                          ? "Not costing interest, so it’s left out of the plan"
                          : d.order === null
                            ? "Needs its interest rate and monthly payment"
                            : `${d.aprPercent}% interest, ${dollars(d.payment!)} a month${d.paidOffMonth ? `, done ${monthLabel(d.paidOffMonth)}` : ""}`}
                      </span>
                    </span>
                    <span className="tabular whitespace-nowrap font-bold">{dollars(d.balance)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-small text-ink-3">These are estimates from today’s balances and rates. Your lender’s payoff figure is the exact one.</p>
          </Sheet>
        </div>
      </div>

      <Dialog open={editingDebt !== null} onClose={() => setEditing(null)} title={editingDebt?.name ?? ""}>
        {editingDebt && <EditDebt key={editingDebt.id} debt={editingDebt} onClose={() => setEditing(null)} />}
      </Dialog>
      {data.debts.length === 0 && <EmptyState title="Nothing owed" />}
    </>
  );
}
