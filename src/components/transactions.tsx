"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BUDGET_CATEGORIES, CATEGORIES, category, isNecessity } from "@/lib/categories";
import { formatMedium, formatRelativeDay, type ISODate } from "@/lib/dates";
import { dollarsExact, signedAmount } from "@/lib/money";
import type { TxView } from "@/lib/types";
import { validName } from "@/lib/finance/names";
import { CategoryIcon } from "./category-icon";
import { ScopeChoice, renameEvery, renamedMessage, undoRename, type Scope } from "./names";
import { Button, Dialog, ErrorNote, Field, Input, Select, Tag, cx, toast } from "./ui";
import { send } from "./use-api";
import { nickelReact } from "./nickel/store";

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

type UndoInfo = { rule: string | null; others: { id: string; category: string }[] };

/**
 * Saves a category (and note) for one transaction and shows the Undo message.
 * With `remember`, every charge from the same merchant moves too, now and in future.
 */
export async function changeCategory(tx: TxView, next: { category: string; note?: string; remember: boolean }) {
  const before = { category: tx.category, note: tx.note ?? "" };
  const result = await send<{ moved: number; undo: UndoInfo | null }>("PATCH", `/api/transactions/${tx.id}`, { category: next.category, note: next.note ?? before.note, remember: next.remember });
  const changed = next.category !== before.category;
  const label = category(next.category).label;
  const message = !changed ? "Note saved" : result.undo ? `Moved to ${label}. Every ${tx.name} charge goes there now.` : `Moved to ${label}`;
  toast(message, {
    action: {
      label: "Undo",
      run: () => send("PATCH", `/api/transactions/${tx.id}`, { ...before, undo: true, ...(result.undo ? { restore: result.undo } : {}) }),
    },
  });
}

/** Categories as the owner thinks of them: bills, everyday spending, and money coming in or moving. */
const CATEGORY_GROUPS = [
  { title: "Bills", hint: "Must-pays, set aside first each month. Never counted in a budget.", categories: CATEGORIES.filter((c) => isNecessity(c.key)) },
  { title: "Everyday spending", hint: "Counts in its category’s budget.", categories: BUDGET_CATEGORIES },
  { title: "Money in and moving", hint: "Not spending.", categories: CATEGORIES.filter((c) => c.group !== "spending") },
];

/* ---------- slide a row left ---------- */

const ACTION_WIDTH = 92;
/** Only one row is open at a time, like in Roux. This is the one that is. */
let openRow: { close: () => void } | null = null;

/**
 * Slide a row left to reveal one action; slide it most of the way and the
 * action runs. Tapping the row itself still opens it, so the gesture is a
 * shortcut and never the only way.
 */
function SwipeRow({ children, label, onAction }: { children: ReactNode; label: string; onAction: () => void }) {
  const inner = useRef<HTMLDivElement>(null);
  const state = useRef<{ x: number; y: number; start: number; locked: "x" | "y" | null; pos: number; t: number } | null>(null);
  const [open, setOpen] = useState(false);
  // A slide must not also count as a tap on the row.
  const dragged = useRef(false);

  const move = (x: number, animate: boolean) => {
    const el = inner.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.22s cubic-bezier(0.23, 1, 0.32, 1)" : "none";
    el.style.transform = x === 0 ? "" : `translateX(${x}px)`;
  };
  // One lasting handle per row, so "is the open row this one?" survives re-renders.
  const self = useRef({ close: () => {} });
  const close = () => {
    move(0, true);
    setOpen(false);
    if (openRow === self.current) openRow = null;
  };
  useEffect(() => {
    self.current.close = close;
  });

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    if (openRow && openRow !== self.current) openRow.close();
    dragged.current = false;
    state.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, start: open ? -ACTION_WIDTH : 0, locked: null, pos: open ? -ACTION_WIDTH : 0, t: Date.now() };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = state.current;
    if (!s) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Mostly up-and-down is a scroll: leave it alone.
      s.locked = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
    }
    if (s.locked !== "x") return;
    dragged.current = true;
    // Follows the finger to the left; barely gives to the right.
    s.pos = Math.min(s.start + dx, 0) + (s.start + dx > 0 ? (s.start + dx) * 0.05 : 0);
    move(s.pos, false);
  };
  const onTouchEnd = () => {
    const s = state.current;
    state.current = null;
    if (!s || s.locked !== "x") return;
    const width = inner.current?.offsetWidth ?? 320;
    const speed = (s.pos - s.start) / Math.max(1, Date.now() - s.t); // px per ms, negative = leftward
    if (s.pos < -Math.min(width * 0.5, 210) || (speed < -0.9 && s.pos < -ACTION_WIDTH)) {
      close();
      onAction();
    } else if (s.pos < -ACTION_WIDTH / 2 || (speed < -0.3 && s.pos < -12)) {
      move(-ACTION_WIDTH, true);
      setOpen(true);
      openRow = self.current;
    } else close();
  };

  return (
    <div className="relative overflow-hidden rounded-2xl" data-no-pull>
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        onClick={() => {
          close();
          onAction();
        }}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-[var(--c-activity)] text-small font-extrabold text-sheet"
        style={{ width: ACTION_WIDTH }}
      >
        {label}
      </button>
      <div
        ref={inner}
        className="relative bg-sheet"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => {
          // Swallow the click that ends a slide, and a tap on an open row just closes it.
          if (dragged.current || open) {
            e.stopPropagation();
            e.preventDefault();
            dragged.current = false;
            if (open) close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TxRow({ tx, fresh, onOpen, onCategory }: { tx: TxView; fresh: boolean; onOpen: () => void; onCategory: () => void }) {
  return (
    <li className={cx("rounded-2xl", fresh && "arrived")}>
      <SwipeRow label="Category" onAction={onCategory}>
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
      </SwipeRow>
    </li>
  );
}

export function TxList({ transactions, today, grouped = true }: { transactions: TxView[]; today: ISODate; grouped?: boolean }) {
  const fresh = useArrivals(transactions);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pickId, setPickId] = useState<string | null>(null);
  const open = transactions.find((t) => t.id === openId) ?? null;
  const picking = transactions.find((t) => t.id === pickId) ?? null;

  const days: { date: ISODate; rows: TxView[] }[] = [];
  for (const t of transactions) {
    const last = days[days.length - 1];
    if (last && last.date === t.date) last.rows.push(t);
    else days.push({ date: t.date, rows: [t] });
  }
  const row = (t: TxView) => <TxRow key={t.id} tx={t} fresh={fresh.has(t.id)} onOpen={() => setOpenId(t.id)} onCategory={() => setPickId(t.id)} />;

  return (
    <>
      {grouped ? (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day.date} aria-label={formatMedium(day.date)}>
              <div className="flex items-baseline justify-between px-2 pb-1 text-small text-ink-3">
                <h3 className="font-bold text-ink-2">{formatRelativeDay(day.date, today)}</h3>
                <span className="tabular">{dollarsExact(day.rows.reduce((s, t) => s + (t.category === "transfer" ? 0 : t.amount), 0))}</span>
              </div>
              <ul>{day.rows.map(row)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <ul>{transactions.map(row)}</ul>
      )}
      <TxDialog tx={open} onClose={() => setOpenId(null)} />
      <CategoryPicker tx={picking} onClose={() => setPickId(null)} />
    </>
  );
}

/** The quick way, after sliding a row: one tap on a category and it's done (and remembered). */
function CategoryPicker({ tx, onClose }: { tx: TxView | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const pick = async (key: string) => {
    if (!tx || busy) return;
    if (key === tx.category) return onClose();
    setBusy(true);
    try {
      await changeCategory(tx, { category: key, remember: true });
      nickelReact({ type: "task", task: "category" });
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save. Try again.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={tx !== null} onClose={onClose} title={tx ? `Where does ${tx.name} go?` : ""}>
      {tx && (
        <>
          <p className="mb-3 text-small text-ink-3">Every {tx.name} charge will go there from now on. You can Undo straight after.</p>
          {CATEGORY_GROUPS.map((group) => (
            <div key={group.title} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-small font-bold text-ink-2">{group.title}</p>
              <p className="mb-2 text-micro text-ink-3">{group.hint}</p>
              <ul className="grid grid-cols-2 gap-2">
                {group.categories.map((c) => (
                  <li key={c.key}>
                    <button type="button" disabled={busy} onClick={() => pick(c.key)} aria-pressed={c.key === tx.category} className={cx("flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl border px-2.5 text-left text-small font-bold leading-tight active:scale-[0.98]", c.key === tx.category ? "border-transparent bg-accent-soft text-accent-text" : "border-line-soft bg-sheet")}>
                      <CategoryIcon category={c.key} size="sm" />
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </Dialog>
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
  const [name, setName] = useState(tx.name);
  const [scope, setScope] = useState<Scope>(tx.nameSource === "custom" ? "one" : "every");
  const [exact, setExact] = useState(tx.ruleExact);
  const [categoryKey, setCategoryKey] = useState(tx.category);
  const [note, setNote] = useState(tx.note ?? "");
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = categoryKey !== tx.category;
  // Only a name that was actually changed is checked: a long bank name left as it is still saves.
  const touched = name !== tx.name;
  const typed = touched ? validName(name) : tx.name;
  const nameChanged = touched && typed !== null && typed !== tx.name;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed) return setError("Give it a name of up to 60 letters.");
    setSaving(true);
    setError(null);
    try {
      const renamed = nameChanged && scope === "every" ? await renameEvery(tx.id, typed, exact, true) : null;
      const body: { category?: string; remember?: boolean; note?: string; name?: string } = {};
      if (changed) Object.assign(body, { category: categoryKey, remember });
      if (note.trim() !== (tx.note ?? "")) body.note = note;
      if (nameChanged && scope === "one") body.name = typed;
      const result = Object.keys(body).length > 0 ? await send<{ moved: number; undo: UndoInfo | null }>("PATCH", `/api/transactions/${tx.id}`, body) : null;

      const label = category(categoryKey).label;
      const shown = nameChanged ? typed : tx.name;
      const parts = [
        renamed ? renamedMessage(typed, renamed.count) : body.name ? `Renamed this one to ${typed}.` : "",
        changed ? (result?.undo ? `Every ${shown} charge goes to ${label} now.` : `Moved to ${label}.`) : "",
        !renamed && !body.name && !changed && body.note !== undefined ? "Note saved" : "",
      ].filter(Boolean);
      if (parts.length > 0) {
        nickelReact({ type: "task", task: renamed || body.name ? "rename" : changed ? "category" : "note" });
        toast(parts.join(" "), {
          action: {
            label: "Undo",
            run: async () => {
              if (result) {
                await send("PATCH", `/api/transactions/${tx.id}`, {
                  undo: true,
                  ...(body.category !== undefined ? { category: tx.category } : {}),
                  ...(body.note !== undefined ? { note: tx.note ?? "" } : {}),
                  ...(body.name !== undefined ? { name: tx.customName } : {}),
                  ...(result.undo ? { restore: result.undo } : {}),
                });
              }
              if (renamed) await undoRename(renamed.undo);
            },
          },
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setSaving(false);
    }
  };

  /** Back to what the bank calls it: drops a one-off name, or stops a saved one. */
  const backToBankName = async () => {
    setSaving(true);
    try {
      if (tx.nameSource === "custom") {
        await send("PATCH", `/api/transactions/${tx.id}`, { name: null });
        toast("Name removed", { action: { label: "Undo", run: () => send("PATCH", `/api/transactions/${tx.id}`, { name: tx.customName }) } });
      } else if (tx.ruleId) {
        const { rule } = await send<{ rule: { key: string; amount: number; name: string } }>("DELETE", `/api/names/${tx.ruleId}`);
        toast(`Stopped calling these “${rule.name}”`, { action: { label: "Undo", run: () => send("POST", "/api/names/restore", rule) } });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setSaving(false);
    }
  };

  const nameHint =
    tx.nameSource === "custom"
      ? "You named just this one."
      : tx.nameSource === "rule"
        ? tx.ruleExact
          ? `You named every ${dollarsExact(Math.abs(tx.amount))} charge like this.`
          : "You named every charge like this."
        : tx.nameSource === "clean"
          ? "Tidied up from the bank’s code. Change it if it’s not right."
          : undefined;

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 rounded-control bg-sunk px-4 py-3">
        <div className="min-w-0 text-small text-ink-2">
          <p>{formatMedium(tx.date)}</p>
          <p>
            {tx.accountName}
            {tx.accountMask && <span className="tabular"> ending {tx.accountMask}</span>}
          </p>
          {(() => {
            const statement = tx.rawName || tx.bankName;
            return statement && statement.toLowerCase() !== tx.name.toLowerCase() ? <p className="break-words text-ink-3">Bank says: {statement}</p> : null;
          })()}
        </div>
        <Amount cents={tx.amount} neutral={tx.category === "transfer"} className="figure text-title" />
      </div>
      {tx.pending && <p className="text-small text-ink-3">This charge is still pending. The amount can change before it posts.</p>}
      <div>
        <Field label="Name" hint={nameChanged ? undefined : nameHint}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoCapitalize="words" enterKeyHint="done" />}
        </Field>
        {!nameChanged && (tx.nameSource === "custom" || tx.nameSource === "rule") && (
          <button type="button" disabled={saving} onClick={backToBankName} className="mt-1 inline-flex min-h-11 items-center text-small font-bold text-accent-text">
            {tx.nameSource === "custom" ? "Remove this name" : "Stop using this name"}
          </button>
        )}
        {nameChanged && (
          <div className="mt-3">
            <ScopeChoice transactionId={tx.id} amount={tx.amount} scope={scope} onScope={setScope} exact={exact} onExact={setExact} />
          </div>
        )}
      </div>
      <Field label="Category" hint={categoryKey === "transfer" ? "Transfers between your own accounts don’t count as income or spending." : isNecessity(categoryKey) ? "A bill: set aside first each month, not counted in a budget." : CATEGORIES.find((c) => c.key === categoryKey)?.group === "spending" ? "Everyday spending: counts in this category’s budget." : undefined}>
        {(id) => (
          <Select id={id} value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
            {CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      {changed && (
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control bg-accent-soft px-3.5 py-2 text-small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-5 shrink-0 accent-[var(--accent)]" />
          <span>
            <span className="block font-bold">Do this for every {tx.name} charge</span>
            <span className="block text-ink-2">Past ones move too, and new ones land in {category(categoryKey).label} on their own.</span>
          </span>
        </label>
      )}
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
