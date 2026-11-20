"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, category } from "@/lib/categories";
import { formatMedium, formatRelativeDay, type ISODate } from "@/lib/dates";
import { dollarsExact, signedAmount } from "@/lib/money";
import type { TxView } from "@/lib/types";
import { CategoryIcon } from "./category-icon";
import { Button, Dialog, ErrorNote, Field, Input, Select, Tag, cx, toast } from "./ui";
import { send } from "./use-api";

/** Remembers which rows have been shown, so only genuinely new ones animate in. */
function useArrivals(transactions: TxView[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(transactions.map((t) => t.id));
      return;
    }
    const arrived = transactions.filter((t) => !seen.current!.has(t.id)).map((t) => t.id);
    if (arrived.length === 0) return;
    for (const id of arrived) seen.current.add(id);
    // Only treat a handful as "just arrived"; a filter change brings many rows at once.
    if (arrived.length <= 3) setFresh(new Set(arrived));
  }, [transactions]);
  return fresh;
}

/** Money in is green with a plus sign. Transfers stay in ink: moving your own money isn’t income. */
export function Amount({ cents, className, neutral }: { cents: number; className?: string; neutral?: boolean }) {
  return <span className={cx("tabular whitespace-nowrap font-medium", cents > 0 && !neutral && "text-good", className)}>{signedAmount(cents)}</span>;
}

function TxRow({ tx, fresh, onOpen }: { tx: TxView; fresh: boolean; onOpen: () => void }) {
  return (
    <li className={cx("rounded-control", fresh && "arrived")}>
      <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-sunk active:bg-sunk">
        <CategoryIcon category={tx.category} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-bold">{tx.name}</span>
            {tx.pending && <Tag>Pending</Tag>}
          </span>
          <span className="block truncate text-small text-ink-3">
            {category(tx.category).label}, {tx.accountName}
          </span>
        </span>
        <Amount cents={tx.amount} neutral={tx.category === "transfer"} />
      </button>
    </li>
  );
}

export function TxList({ transactions, today, grouped = true }: { transactions: TxView[]; today: ISODate; grouped?: boolean }) {
  const fresh = useArrivals(transactions);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = transactions.find((t) => t.id === openId) ?? null;

  const days: { date: ISODate; rows: TxView[] }[] = [];
  for (const t of transactions) {
    const last = days[days.length - 1];
    if (last && last.date === t.date) last.rows.push(t);
    else days.push({ date: t.date, rows: [t] });
  }

  return (
    <>
      {grouped ? (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day.date} aria-label={formatMedium(day.date)}>
              <div className="flex items-baseline justify-between px-2 pb-1 text-small text-ink-3">
                <h3 className="font-medium text-ink-2">{formatRelativeDay(day.date, today)}</h3>
                <span className="tabular">{dollarsExact(day.rows.reduce((s, t) => s + (t.category === "transfer" ? 0 : t.amount), 0))}</span>
              </div>
              <ul>
                {day.rows.map((t) => (
                  <TxRow key={t.id} tx={t} fresh={fresh.has(t.id)} onOpen={() => setOpenId(t.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul>
          {transactions.map((t) => (
            <TxRow key={t.id} tx={t} fresh={fresh.has(t.id)} onOpen={() => setOpenId(t.id)} />
          ))}
        </ul>
      )}
      <TxDialog tx={open} onClose={() => setOpenId(null)} />
    </>
  );
}

function TxDialog({ tx, onClose }: { tx: TxView | null; onClose: () => void }) {
  return (
    <Dialog open={tx !== null} onClose={onClose} title={tx?.name ?? ""}>
      {tx && <TxForm key={tx.id} tx={tx} onClose={onClose} />}
    </Dialog>
  );
}

function TxForm({ tx, onClose }: { tx: TxView; onClose: () => void }) {
  const [categoryKey, setCategoryKey] = useState(tx.category);
  const [note, setNote] = useState(tx.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await send("PATCH", `/api/transactions/${tx.id}`, { category: categoryKey, note });
      onClose();
      const before = { category: tx.category, note: tx.note ?? "" };
      const changed = categoryKey !== before.category;
      // Everyday changes get an Undo instead of an "are you sure?".
      toast(changed ? `Moved to ${category(categoryKey).label}` : "Note saved", {
        action: { label: "Undo", run: () => send("PATCH", `/api/transactions/${tx.id}`, before) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 rounded-control bg-sunk px-4 py-3">
        <div className="text-small text-ink-2">
          <p>{formatMedium(tx.date)}</p>
          <p>
            {tx.accountName}
            {tx.accountMask && <span className="tabular"> ending {tx.accountMask}</span>}
          </p>
          {tx.rawName && tx.rawName.toLowerCase() !== tx.name.toLowerCase() && <p className="text-ink-3">Statement: {tx.rawName}</p>}
        </div>
        <Amount cents={tx.amount} neutral={tx.category === "transfer"} className="figure text-title" />
      </div>
      {tx.pending && <p className="text-small text-ink-3">This charge is still pending. The amount can change before it posts.</p>}
      <Field label="Category" hint={categoryKey === "transfer" ? "Transfers between your own accounts don’t count as income or spending." : undefined}>
        {(id) => (
          <Select id={id} value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Add a note for yourself" />}</Field>
      {error && <ErrorNote message={error} />}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
