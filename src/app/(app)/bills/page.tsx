"use client";

import { useState } from "react";
import { BillStub } from "@/components/bills";
import { CategoryIcon } from "@/components/category-icon";
import { Button, Dialog, EmptyState, ErrorNote, PageHeader, Sheet, SheetHeader, Skeleton, Tag } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { diffDays, formatDistance, formatMedium, formatShort } from "@/lib/dates";
import { FREQUENCY_LABEL } from "@/lib/finance/recurring";
import { dollars, dollarsExact } from "@/lib/money";
import type { RecurringPayload, RecurringView } from "@/lib/types";

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className={`rounded-sheet px-5 py-4 ${tone}`}>
      <p className="text-small">{label}</p>
      <p className="figure mt-2 text-[2rem]">{value}</p>
      <p className="mt-1.5 text-small opacity-85">{note}</p>
    </div>
  );
}

function SeriesRow({ series, onOpen }: { series: RecurringView; onOpen: () => void }) {
  const change = series.priceChange;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left transition-colors hover:bg-sunk">
        <CategoryIcon category={series.category} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{series.name}</span>
            {change && <Tag tone="canary">{change.to < change.from ? `Went up ${dollarsExact(change.from - change.to)}` : `Went down ${dollarsExact(change.to - change.from)}`}</Tag>}
            {series.cancelled && <Tag>Marked cancelled</Tag>}
          </span>
          <span className="block truncate text-small text-ink-3">
            {FREQUENCY_LABEL[series.frequency]}
            {series.active ? `, next ${series.nextDate.slice(0, 4) === series.lastDate.slice(0, 4) || series.frequency !== "yearly" ? formatShort(series.nextDate) : formatMedium(series.nextDate)}` : `, last charged ${formatShort(series.lastDate)}`}
          </span>
        </span>
        <span className="text-right">
          <span className="tabular block whitespace-nowrap font-medium">{dollarsExact(Math.abs(series.amount))}</span>
          {!series.fixedAmount && <span className="block text-micro text-ink-3">about, it varies</span>}
        </span>
      </button>
    </li>
  );
}

function SeriesDialog({ series, onClose }: { series: RecurringView | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (patch: { kind?: "bill" | "subscription" | "ignore"; cancelled?: boolean }) => {
    if (!series) return;
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", "/api/recurring", { key: series.key, ...patch });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={series !== null} onClose={onClose} title={series?.name ?? ""}>
      {series && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 text-small">
            <div className="rounded-control bg-sunk px-3 py-2">
              <p className="text-ink-3">{series.fixedAmount ? "Each charge" : "Typical charge"}</p>
              <p className="tabular text-lead font-semibold">{dollarsExact(Math.abs(series.amount))}</p>
            </div>
            <div className="rounded-control bg-sunk px-3 py-2">
              <p className="text-ink-3">Per year</p>
              <p className="tabular text-lead font-semibold">{dollars(series.monthly * 12)}</p>
            </div>
          </div>
          <p className="text-small text-ink-2">
            {FREQUENCY_LABEL[series.frequency]} from {series.accountName}.{" "}
            {series.cancelled
              ? "You marked this as cancelled, so it no longer counts toward what’s coming up."
              : series.active
                ? `Next expected ${formatMedium(series.nextDate)}.`
                : `No charge since ${formatMedium(series.lastDate)}, so it looks like this one stopped.`}
          </p>

          <div>
            <h3 className="mb-1 text-small font-medium text-ink-2">Past charges</h3>
            <ul className="max-h-48 divide-y divide-line-soft overflow-y-auto text-small">
              {[...series.history].reverse().map((h) => (
                <li key={h.id} className="flex justify-between gap-4 py-1.5">
                  <span className="text-ink-2">{formatMedium(h.date)}</span>
                  <span className="tabular">{dollarsExact(Math.abs(h.amount))}</span>
                </li>
              ))}
            </ul>
          </div>

          {error && <ErrorNote message={error} />}

          {series.kind !== "income" && (
            <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
              {series.cancelled ? (
                <Button size="sm" disabled={busy} onClick={() => update({ cancelled: false })}>
                  Still paying for this
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => update({ cancelled: true })}>
                  I cancelled this
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={() => update({ kind: series.kind === "bill" ? "subscription" : "bill" })}>
                {series.kind === "bill" ? "Move to subscriptions" : "Move to bills"}
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => update({ kind: "ignore" })}>
                This doesn’t repeat
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function BillsPage() {
  const { data, error, mutate } = useApi<RecurringPayload>("/api/recurring", { refreshInterval: 30_000 });
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-28 rounded-sheet" />
        <Skeleton className="h-96 rounded-sheet" />
      </div>
    );
  }

  const bills = data.series.filter((s) => s.kind === "bill" && s.active);
  const subscriptions = data.series.filter((s) => s.kind === "subscription" && s.active);
  const income = data.series.filter((s) => s.kind === "income" && s.active);
  const stopped = data.series.filter((s) => s.kind !== "income" && !s.active);
  const next30 = data.upcoming.filter((u) => diffDays(u.date, data.today) <= 30);
  const raised = data.series.filter((s) => s.active && s.priceChange && s.priceChange.to < s.priceChange.from);

  const list = (title: string, hint: string, rows: RecurringView[], empty: string) => (
    <Sheet>
      <SheetHeader title={title} hint={hint} />
      {rows.length > 0 ? (
        <ul>
          {rows.map((s) => (
            <SeriesRow key={s.key} series={s} onOpen={() => setOpenKey(s.key)} />
          ))}
        </ul>
      ) : (
        <EmptyState title={empty}>Charges are recognized once they repeat on a schedule, usually by the third time.</EmptyState>
      )}
    </Sheet>
  );

  return (
    <>
      <PageHeader title="Bills and subscriptions" lead="Found automatically from charges that repeat. Select any of them to see past charges or tell Passbook it was cancelled." />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Bills each month" value={dollars(data.monthlyBills)} note={`${bills.length} regular bills`} tone="bg-pink text-pink-ink" />
        <Stat label="Subscriptions each month" value={dollars(data.monthlySubscriptions)} note={`${dollars(data.monthlySubscriptions * 12)} a year across ${subscriptions.length}`} tone="bg-sky text-sky-ink" />
        <Stat label="Due in the next 30 days" value={dollars(next30.reduce((s, u) => s - u.amount, 0))} note={next30[0] ? `Next: ${next30[0].name}, ${formatDistance(next30[0].date, data.today)}` : "Nothing scheduled"} tone="bg-sheet border border-line-soft" />
      </div>

      {raised.length > 0 && (
        <div className="mb-5 rounded-sheet bg-canary px-5 py-4 text-canary-ink">
          <p className="font-medium">
            {raised.length === 1 ? `${raised[0].name} raised its price` : `${raised.length} subscriptions raised their price`}
          </p>
          <ul className="mt-1 text-small">
            {raised.map((s) => (
              <li key={s.key}>
                {s.name}: {dollarsExact(-s.priceChange!.from)} to {dollarsExact(-s.priceChange!.to)}, which is {dollars((s.priceChange!.from - s.priceChange!.to) * 12)} more a year.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_1.15fr]">
        <Sheet>
          <SheetHeader title="Coming up" hint="The next six weeks, in the order they’re due." />
          {data.upcoming.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {data.upcoming.map((bill) => (
                <BillStub key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing due soon" />
          )}
        </Sheet>

        <div className="grid grid-cols-1 gap-5">
          {list("Bills", "Rent, utilities, insurance and loans.", bills, "No bills found yet")}
          {list("Subscriptions", "Memberships and services that renew on their own.", subscriptions, "No subscriptions found yet")}
          {income.length > 0 && list("Regular income", "Deposits that arrive on a schedule.", income, "")}
          {stopped.length > 0 && list("No longer charging", "These used to repeat and have stopped, or you marked them cancelled.", stopped, "")}
        </div>
      </div>

      <SeriesDialog series={data.series.find((s) => s.key === openKey) ?? null} onClose={() => setOpenKey(null)} />
    </>
  );
}
