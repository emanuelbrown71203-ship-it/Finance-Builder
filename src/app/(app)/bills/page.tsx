"use client";

import { XpTag } from "@/components/game/level";
import { WINS } from "@/lib/game/progress";
import { ExternalLink, PencilLine, Plus } from "lucide-react";
import { useState } from "react";
import { BillForm, type SavedBill } from "@/components/bill-form";
import { BillRow } from "@/components/bills";
import { CategoryIcon } from "@/components/category-icon";
import { BankSays, RenameForm } from "@/components/names";
import { Button, Dialog, EmptyState, ErrorNote, Fold, PageHeader, Sheet, SheetHeader, Skeleton, Tag, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { nickelReact } from "@/components/nickel/store";
import { diffDays, formatDistance, formatMedium, formatShort } from "@/lib/dates";
import { FREQUENCY_LABEL } from "@/lib/finance/recurring";
import type { CancelHelp } from "@/lib/finance/subscriptions";
import { dollars, dollarsExact } from "@/lib/money";
import type { RecurringPayload, RecurringView } from "@/lib/types";

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className={`edge min-w-0 rounded-sheet px-4 py-3.5 shadow-card sm:px-5 sm:py-4 ${tone}`}>
      <p className="text-small font-bold">{label}</p>
      <p className="figure mt-2 text-[1.75rem] sm:text-[2rem]">{value}</p>
      <p className="mt-1.5 truncate text-small opacity-85">{note}</p>
    </div>
  );
}

const WHO = { you: "you", nickel: "Nickel", claude: "Claude" } as const;

function SeriesRow({ series, today, onOpen }: { series: RecurringView; today: string; onOpen: () => void }) {
  const change = series.priceChange;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-sunk active:bg-sunk">
        <CategoryIcon category={series.category} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-bold">{series.name}</span>
            {change && <Tag tone="canary">{change.to < change.from ? `Went up ${dollarsExact(change.from - change.to)}` : `Went down ${dollarsExact(change.to - change.from)}`}</Tag>}
            {series.renewsSoon && <Tag tone="canary">Renews {formatDistance(series.nextDate, today)}</Tag>}
            {series.startedRecently && !series.renewsSoon && <Tag tone="sky">New since {formatShort(series.firstDate)}</Tag>}
            {series.cancelled && <Tag>Marked cancelled</Tag>}
            {series.manual && <Tag tone="plain">Added by {WHO[series.manual.addedBy]}</Tag>}
            {series.manual?.seenAtBank && <Tag tone="sky">The bank shows it now</Tag>}
          </span>
          <span className="block truncate text-small text-ink-3">
            {series.manual
              ? series.frequency === "once"
                ? `Just once, ${series.active ? "due" : "was due"} ${formatShort(series.nextDate)}`
                : `${FREQUENCY_LABEL[series.frequency]}${series.active ? `, next ${formatShort(series.nextDate)}` : ""}`
              : `${FREQUENCY_LABEL[series.frequency]}${series.active ? `, next ${series.nextDate.slice(0, 4) === series.lastDate.slice(0, 4) || series.frequency !== "yearly" ? formatShort(series.nextDate) : formatMedium(series.nextDate)}` : `, last charged ${formatShort(series.lastDate)}`}`}
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

/** Where to go to cancel. The link opens the company's own site in a new tab. */
function CancelHelpBox({ name, help }: { name: string; help: CancelHelp }) {
  return (
    <div className="rounded-2xl bg-sunk px-4 py-3">
      <h3 className="font-bold">Want to cancel {name}?</h3>
      <p className="mt-1 text-small text-ink-2">{help.how}</p>
      {help.url && (
        <a href={help.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-bold text-accent-text">
          {help.label} <ExternalLink size={15} />
        </a>
      )}
      <p className="mt-1 text-small text-ink-3">Once it’s done, come back and tap “I cancelled this” so it stops counting.</p>
    </div>
  );
}

function SeriesDialog({ series, today, onClose: close }: { series: RecurringView | null; today: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const onClose = () => {
    setRenaming(false);
    close();
  };
  if (series?.manual) return <ManualBillDialog key={series.key} series={series} today={today} onClose={onClose} />;

  const update = async (patch: { kind?: "bill" | "subscription" | "ignore"; cancelled?: boolean }, done: string) => {
    if (!series) return;
    setBusy(true);
    setError(null);
    // What to put back if the person taps Undo.
    const before = { kind: series.kind === "income" ? undefined : series.kind, cancelled: series.cancelled };
    try {
      await send("PATCH", "/api/recurring", { key: series.key, ...patch });
      if (patch.cancelled) nickelReact({ type: "task", task: "cancelled", name: series.name, amount: series.monthly * 12 });
      onClose();
      toast(done, { action: { label: "Undo", run: () => send("PATCH", "/api/recurring", { key: series.key, ...before }) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={series !== null} onClose={onClose} title={series ? (renaming ? `Rename ${series.name}` : series.name) : ""}>
      {series && renaming && (
        <RenameForm
          key={series.key}
          transactionId={series.sampleId}
          current={series.name}
          amount={series.history[series.history.length - 1]?.amount ?? series.amount}
          bankName={series.bankName}
          allowExact={series.fixedAmount || series.ruleExact}
          defaultExact={series.ruleExact}
          onDone={onClose}
          onCancel={() => setRenaming(false)}
        />
      )}
      {series && !renaming && (
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
          <div className="-mt-2 flex flex-wrap items-center justify-between gap-x-3">
            <BankSays bankName={series.bankName.toLowerCase() !== series.name.toLowerCase() ? series.bankName : null} className="min-w-0 flex-1" />
            {series.sampleId && (
              <button type="button" onClick={() => setRenaming(true)} className="inline-flex min-h-11 items-center gap-1.5 text-small font-bold text-accent-text">
                <PencilLine size={16} aria-hidden />
                Rename
              </button>
            )}
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

          {series.kind === "subscription" && !series.cancelled && <CancelHelpBox name={series.name} help={series.help} />}

          {error && <ErrorNote message={error} />}

          {series.kind !== "income" && (
            <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
              {series.cancelled ? (
                <Button size="sm" disabled={busy} onClick={() => update({ cancelled: false }, `${series.name} is back in your bills`)}>
                  Still paying for this
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => update({ cancelled: true }, `${series.name} marked as cancelled`)}>
                  I cancelled this
                  <XpTag xp={WINS.cancel.xp} />
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={() => update({ kind: series.kind === "bill" ? "subscription" : "bill" }, series.kind === "bill" ? `${series.name} moved to Extras: it comes out of your budget now` : `${series.name} moved to Bills: it’s set aside each month now`)}>
                {series.kind === "bill" ? "Move to Extras" : "I need this: move to Bills"}
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => update({ kind: "ignore" }, `${series.name} hidden from bills`)}>
                This doesn’t repeat
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** A bill added by hand: change it, say it's cancelled, or remove it (with Undo). */
function ManualBillDialog({ series, today, onClose }: { series: RecurringView; today: string; onClose: () => void }) {
  const manual = series.manual!;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const once = series.frequency === "once";

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };
  const cancel = (cancelled: boolean) =>
    run(async () => {
      await send("PATCH", `/api/bills/${manual.id}`, { cancelled });
      if (cancelled) nickelReact({ type: "task", task: "cancelled", name: series.name, amount: series.monthly * 12 });
      toast(cancelled ? `${series.name} marked as cancelled` : `${series.name} is back in your bills`, { action: { label: "Undo", run: () => send("PATCH", `/api/bills/${manual.id}`, { cancelled: !cancelled }) } });
    });
  const remove = () =>
    run(async () => {
      const { bill } = await send<{ bill: SavedBill }>("DELETE", `/api/bills/${manual.id}`);
      toast(`${series.name} removed`, { action: { label: "Undo", run: () => send("POST", "/api/bills/restore", bill) } });
    });

  return (
    <Dialog open onClose={onClose} title={editing ? `Change ${series.name}` : series.name}>
      {editing ? (
        <BillForm
          today={today}
          editing={{ id: manual.id, name: series.name, amount: Math.abs(series.amount), frequency: series.frequency as "monthly", startDate: series.nextDate, kind: series.kind === "subscription" ? "subscription" : "bill" }}
          onDone={onClose}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 text-small">
            <div className="rounded-control bg-sunk px-3 py-2">
              <p className="text-ink-3">{once ? "Amount" : "Each time"}</p>
              <p className="tabular text-lead font-semibold">{dollarsExact(Math.abs(series.amount))}</p>
            </div>
            <div className="rounded-control bg-sunk px-3 py-2">
              <p className="text-ink-3">{once ? "Due" : "Per year"}</p>
              <p className="tabular text-lead font-semibold">{once ? formatShort(series.nextDate) : dollars(series.monthly * 12)}</p>
            </div>
          </div>
          <p className="text-small text-ink-2">
            {once ? "Just once. " : `${FREQUENCY_LABEL[series.frequency]}. `}
            {manual.seenAtBank
              ? `Passbook now finds this in your bank history as “${manual.seenAtBank}”, so that one counts and this copy doesn’t. You can remove this one.`
              : series.cancelled
                ? "You marked this as cancelled, so it no longer counts toward what’s coming up."
                : `${manual.paidOn ? `The bank shows it paid on ${formatMedium(manual.paidOn)}. ` : ""}${series.active ? `${once ? "Due" : "Next due"} ${formatMedium(series.nextDate)}.` : once && manual.paidOn ? "" : `It was due ${formatMedium(series.nextDate)}.`} Added by ${WHO[manual.addedBy]}: it counts as planned until the bank shows it paid.`}
          </p>
          {error && <ErrorNote message={error} />}
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
            <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
              <PencilLine size={16} aria-hidden />
              Change
            </Button>
            {!once &&
              (series.cancelled ? (
                <Button size="sm" disabled={busy} onClick={() => cancel(false)}>
                  Still paying for this
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => cancel(true)}>
                  I cancelled this
                  <XpTag xp={WINS.cancel.xp} />
                </Button>
              ))}
            <Button size="sm" variant="danger" disabled={busy} onClick={remove}>
              Remove
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function BillsPage() {
  const { data, error, mutate } = useApi<RecurringPayload>("/api/recurring", { refreshInterval: 30_000 });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
  const renewing = data.series.filter((s) => s.renewsSoon);
  const raised = data.series.filter((s) => s.active && s.priceChange && s.priceChange.to < s.priceChange.from);

  const list = (title: string, hint: string, rows: RecurringView[], empty: string) => (
    <Sheet>
      <SheetHeader title={title} hint={hint} />
      {rows.length > 0 ? (
        <ul>
          {rows.map((s) => (
            <SeriesRow key={s.key} series={s} today={data.today} onOpen={() => setOpenKey(s.key)} />
          ))}
        </ul>
      ) : (
        <EmptyState title={empty}>Charges are recognized once they repeat on a schedule, usually by the third time.</EmptyState>
      )}
    </Sheet>
  );

  return (
    <>
      <PageHeader
        title="Bills"
        lead="Bills are what you must pay; they’re set aside each month. Extras are subscriptions you could live without; they come out of your budget. Tap one to move it, rename it or say you cancelled it."
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden />
            Add
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <Stat label="Bills a month" value={dollars(data.monthlyBills)} note={`${bills.length} regular bills`} tone="bg-pink text-pink-ink" />
        <Stat label="Extras a month" value={dollars(data.monthlySubscriptions)} note={`${dollars(data.monthlySubscriptions * 12)} a year across ${subscriptions.length}`} tone="bg-sky text-sky-ink" />
        <Stat label="Due in the next 30 days" value={dollars(next30.reduce((s, u) => s - u.amount, 0))} note={next30[0] ? `Next: ${next30[0].name}, ${formatDistance(next30[0].date, data.today)}` : "Nothing scheduled"} tone="bg-sheet" />
      </div>

      {renewing.length > 0 && (
        <div className="mb-4 rounded-sheet bg-canary px-5 py-4 text-canary-ink">
          <p className="font-bold">{renewing.length === 1 ? `${renewing[0].name} renews ${formatDistance(renewing[0].nextDate, data.today)}` : `${renewing.length} yearly charges are coming up`}</p>
          <ul className="mt-1 text-small">
            {renewing.map((s) => (
              <li key={s.key}>
                {s.name}: {dollarsExact(Math.abs(s.amount))} on {formatShort(s.nextDate)}. Cancel before then if you don’t want another {s.frequency === "yearly" ? "year" : "three months"}.
              </li>
            ))}
          </ul>
        </div>
      )}

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
            <>
              <ul className="flex flex-col gap-2">
                {data.upcoming.slice(0, 6).map((bill) => (
                  <BillRow key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} />
                ))}
              </ul>
              {data.upcoming.length > 6 && (
                // Keep the screen short: the later ones are one tap away.
                <Fold title="Later on" summary={`${data.upcoming.length - 6} more`} className="mt-2">
                  <ul className="flex flex-col gap-2 pb-1">
                    {data.upcoming.slice(6).map((bill) => (
                      <BillRow key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} />
                    ))}
                  </ul>
                </Fold>
              )}
            </>
          ) : (
            <EmptyState title="Nothing due soon" />
          )}
        </Sheet>

        <div className="grid grid-cols-1 gap-5">
          {list("Bills", "What you must pay: rent, utilities, insurance, loans, your phone. Set aside each month.", bills, "No bills found yet")}
          {list("Extras", "Subscriptions you could live without. They count against your budget, like Netflix in Entertainment.", subscriptions, "No extras found yet")}
          {data.possible.length > 0 && (
            <Sheet>
              <SheetHeader title="Might be new" hint="A first charge from a service that usually renews. If you started a free trial, this is it turning into a paid plan." />
              <ul className="flex flex-col gap-2">
                {data.possible.map((p) => (
                  <li key={p.name} className="rounded-2xl border border-line-soft p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-bold">{p.name}</span>
                      <span className="tabular font-bold">{dollarsExact(-p.amount)}</span>
                    </div>
                    <p className="text-small text-ink-3">First charged {formatShort(p.date)}</p>
                    {p.help.url && (
                      <a href={p.help.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-small font-bold text-accent-text">
                        Don’t want it? {p.help.label} <ExternalLink size={14} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Sheet>
          )}
          {income.length > 0 && list("Regular income", "Deposits that arrive on a schedule.", income, "")}
          {stopped.length > 0 && list("No longer charging", "These used to repeat and have stopped, or you marked them cancelled.", stopped, "")}
        </div>
      </div>

      <SeriesDialog series={data.series.find((s) => s.key === openKey) ?? null} today={data.today} onClose={() => setOpenKey(null)} />
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a bill">
        {adding && <BillForm today={data.today} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />}
      </Dialog>
    </>
  );
}
