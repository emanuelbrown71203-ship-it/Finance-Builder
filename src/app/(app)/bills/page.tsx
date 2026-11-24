"use client";

import { XpTag } from "@/components/game/level";
import { NotifyPaidRow } from "@/components/push";
import { WINS } from "@/lib/game/progress";
import { ExternalLink, PencilLine, Plus } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BillForm, type SavedBill } from "@/components/bill-form";
import { BillRow, shareLabel } from "@/components/bills";
import { CategoryIcon } from "@/components/category-icon";
import { BankSays, RenameForm } from "@/components/names";
import { Button, Dialog, EmptyState, ErrorNote, Fold, Input, PageHeader, Segmented, Sheet, SheetHeader, Skeleton, Tag, cx, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { nickelReact } from "@/components/nickel/store";
import { addMonthsToMonth, diffDays, formatDistance, formatMedium, formatShort, monthName, monthOf } from "@/lib/dates";
import { FREQUENCY_LABEL } from "@/lib/finance/recurring";
import type { CancelHelp } from "@/lib/finance/subscriptions";
import { dollars, dollarsExact } from "@/lib/money";
import type { PaidBill, RecurringPayload, RecurringView } from "@/lib/types";

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

/**
 * What bills and Extras charged this month and last: a total for each month, and each payment one tap
 * away. Tapping a payment opens its bill, to move it between Bills and Extras or rename it.
 */
function PaidLately({ paid, today, onOpen }: { paid: PaidBill[]; today: string; onOpen: (key: string) => void }) {
  const thisMonth = monthOf(today);
  const months = [thisMonth, addMonthsToMonth(thisMonth, -1)].map((month) => {
    const rows = paid.filter((p) => monthOf(p.date) === month);
    return { month, rows, total: rows.reduce((s, p) => s - p.amount, 0), bills: rows.filter((p) => p.kind === "bill").reduce((s, p) => s - p.amount, 0) };
  });
  return (
    <Sheet>
      <SheetHeader title="Paid lately" hint="What your bills and extras charged this month and last. Card payments aren’t counted, so rent you put on a card shows once, as rent." />
      <div className="grid grid-cols-2 gap-3">
        {months.map((m, i) => (
          <div key={m.month} className="min-w-0 rounded-2xl border border-line-soft px-3.5 py-3">
            <p className="truncate text-small font-bold">{i === 0 ? `${monthName(m.month)} so far` : monthName(m.month)}</p>
            <p className="figure mt-1.5 text-[1.5rem]">{dollars(m.total)}</p>
            <p className="mt-1 truncate text-small text-ink-3">{m.rows.length === 0 ? "Nothing yet" : `${dollars(m.bills)} of it bills`}</p>
          </div>
        ))}
      </div>
      {paid.length > 0 ? (
        <Fold title="Each payment" summary={`${paid.length} ${paid.length === 1 ? "payment" : "payments"}`} className="mt-2">
          {months
            .filter((m) => m.rows.length > 0)
            .map((m) => (
              <div key={m.month} className="pb-2">
                <p className="px-2 pb-1 pt-2 text-small font-bold text-ink-2">{monthName(m.month)}</p>
                <ul>
                  {m.rows.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => onOpen(p.seriesKey)} className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-sunk active:bg-sunk">
                        <CategoryIcon category={p.category} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{p.name}</span>
                          <span className="block truncate text-small text-ink-3">
                            {formatShort(p.date)}, {p.kind === "bill" ? "bill" : "extra"}
                            {p.share ? `, your ${shareLabel(p.share)}` : ""}
                            {p.accountName ? `, ${p.accountName}` : ""}
                          </span>
                        </span>
                        <span className="tabular whitespace-nowrap font-medium">{dollarsExact(-p.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </Fold>
      ) : (
        <p className="mt-3 text-small text-ink-3">Nothing from your bills or extras has gone out this month or last.</p>
      )}
    </Sheet>
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

/**
 * A bill shared with someone (rent split with a partner): how much of it is yours. Only your part counts
 * in Home, the budget, Coming up and Nickel; what your partner sends you is a transfer, not income.
 */
function ShareControl({ series }: { series: RecurringView }) {
  const share = series.share ?? 1;
  const choice = share === 1 ? "all" : share === 0.5 ? "half" : "other";
  const [other, setOther] = useState(choice === "other");
  const [percent, setPercent] = useState(choice === "other" ? String(Math.round(share * 100)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whole = Math.abs(series.amount) / share;

  const save = async (next: number) => {
    if (next === share) return;
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", "/api/recurring", { key: series.key, share: next >= 1 ? null : next });
      toast(next >= 1 ? `${series.name}: all of it counts as yours again` : `${series.name}: only your ${shareLabel(next)} counts now`, {
        action: { label: "Undo", run: () => send("PATCH", "/api/recurring", { key: series.key, share: share >= 1 ? null : share }) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-control border border-line-soft px-3.5 py-3">
      <p className="font-bold">Do you split this with someone?</p>
      <p className="mb-2.5 text-small text-ink-3">Only your part counts in your plan. What they send you is a transfer, not income.</p>
      <Segmented
        full
        label="How much of it is yours"
        value={other ? "other" : choice}
        onChange={(v) => {
          if (busy) return;
          if (v === "other") return setOther(true);
          setOther(false);
          void save(v === "half" ? 0.5 : 1);
        }}
        options={[
          { value: "all", label: "All mine" },
          { value: "half", label: "I pay half" },
          { value: "other", label: "Other" },
        ]}
      />
      {other && (
        <form
          className="mt-2.5 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(percent);
            if (!Number.isFinite(n) || n < 5 || n > 100) return setError("Put a percent from 5 to 100.");
            void save(Math.round(n) / 100);
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 text-small">
            <span className="shrink-0">I pay</span>
            <Input inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} aria-label="Your percent" placeholder="60" className="w-20" />
            <span className="shrink-0">%</span>
          </label>
          <Button size="sm" type="submit" disabled={busy}>
            Save
          </Button>
        </form>
      )}
      {share < 1 && (
        <p className="mt-2.5 text-small text-ink-2">
          Your {shareLabel(share)}: <span className="tabular font-bold">{dollarsExact(Math.abs(series.amount))}</span> of about <span className="tabular">{dollarsExact(Math.round(whole))}</span>.
        </p>
      )}
      {error && <p className="mt-2 text-small text-bad">{error}</p>}
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
              <p className="text-ink-3">{series.share ? `Your ${shareLabel(series.share)}` : series.fixedAmount ? "Each charge" : "Typical charge"}</p>
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
            <h3 className="mb-1 text-small font-medium text-ink-2">Past charges{series.share ? ` (your ${shareLabel(series.share)})` : ""}</h3>
            <ul className="max-h-48 divide-y divide-line-soft overflow-y-auto text-small">
              {[...series.history].reverse().map((h) => (
                <li key={h.id} className="flex justify-between gap-4 py-1.5">
                  <span className="text-ink-2">{formatMedium(h.date)}</span>
                  <span className="tabular">{dollarsExact(Math.abs(h.amount))}</span>
                </li>
              ))}
            </ul>
          </div>

          {series.kind === "bill" && <ShareControl key={`${series.key}:${series.share}`} series={series} />}

          {series.kind !== "income" && series.active && !series.cancelled && <NotifyPaidRow key={`${series.key}:${series.notifyPaid}`} series={series} />}

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
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-sheet" />}>
      <Bills />
    </Suspense>
  );
}

function Bills() {
  const { data, error, mutate } = useApi<RecurringPayload>("/api/recurring", { refreshInterval: 30_000 });
  // The open bill lives in the address, so "Needs a look" and Home can link straight to one.
  const params = useSearchParams();
  const router = useRouter();
  const openKey = params.get("open");
  const setOpenKey = (key: string | null) => router.replace(key ? `/bills?open=${encodeURIComponent(key)}` : "/bills", { scroll: false });
  // Arriving from "Needs a look" about a possible new subscription: bring it into view once it's loaded.
  const loaded = data !== undefined;
  const flagged = params.get("possible");
  useEffect(() => {
    if (loaded && flagged) document.getElementById("might-be-new")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [loaded, flagged]);
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

  // "Needs a look" can point at a first charge that might be a new subscription.
  const possibleKey = params.get("possible");
  const notASubscription = async (key: string, name: string) => {
    try {
      await send("PATCH", "/api/recurring", { key, kind: "ignore" });
      toast(`${name} won’t be flagged again`, { action: { label: "Undo", run: () => send("PATCH", "/api/recurring", { key, kind: null }) } });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save. Try again.", { tone: "error" });
    }
  };
  // A card's minimum is changed on Debt payoff; anything else opens its bill here.
  const openUpcoming = (key: string, kind: string) => (kind === "card" ? router.push("/debt") : setOpenKey(key));
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
        <EmptyState title={empty}>Charges are recognized once they repeat on a schedule: a bill like rent by its second month, others usually by the third time.</EmptyState>
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
        <div className="grid grid-cols-1 gap-5">
          <Sheet>
            <SheetHeader title="Coming up" hint="The next six weeks, in the order they’re due." />
            {data.upcoming.length > 0 ? (
              <>
                <ul className="flex flex-col gap-2">
                  {data.upcoming.slice(0, 6).map((bill) => (
                    <BillRow key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} onOpen={() => openUpcoming(bill.key, bill.kind)} />
                  ))}
                </ul>
                {data.upcoming.length > 6 && (
                  // Keep the screen short: the later ones are one tap away.
                  <Fold title="Later on" summary={`${data.upcoming.length - 6} more`} className="mt-2">
                    <ul className="flex flex-col gap-2 pb-1">
                      {data.upcoming.slice(6).map((bill) => (
                        <BillRow key={`${bill.key}-${bill.date}`} bill={bill} today={data.today} onOpen={() => openUpcoming(bill.key, bill.kind)} />
                      ))}
                    </ul>
                  </Fold>
                )}
              </>
            ) : (
              <EmptyState title="Nothing due soon" />
            )}
          </Sheet>

          <PaidLately paid={data.paid} today={data.today} onOpen={setOpenKey} />
        </div>

        <div className="grid grid-cols-1 gap-5">
          {list("Bills", "What you must pay: rent, utilities, insurance, loans, your phone. Set aside each month.", bills, "No bills found yet")}
          {list("Extras", "Subscriptions you could live without. They count against your budget, like Netflix in Entertainment.", subscriptions, "No extras found yet")}
          {data.possible.length > 0 && (
            <Sheet id="might-be-new">
              <SheetHeader title="Might be new" hint="A first charge from a service that usually renews. If you started a free trial, this is it turning into a paid plan." />
              <ul className="flex flex-col gap-2">
                {data.possible.map((p) => (
                  <li key={p.key} className={cx("rounded-2xl border p-3", p.key === possibleKey ? "border-accent" : "border-line-soft")}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-bold">{p.name}</span>
                      <span className="tabular font-bold">{dollarsExact(-p.amount)}</span>
                    </div>
                    <p className="text-small text-ink-3">First charged {formatShort(p.date)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4">
                      {p.help.url && (
                        <a href={p.help.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-small font-bold text-accent-text">
                          Don’t want it? {p.help.label} <ExternalLink size={14} />
                        </a>
                      )}
                      <button type="button" onClick={() => notASubscription(p.key, p.name)} className="inline-flex min-h-11 items-center text-small font-bold text-ink-2">
                        It’s not a subscription
                      </button>
                    </div>
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
