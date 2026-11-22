"use client";

import { useState } from "react";
import { validName } from "@/lib/finance/names";
import { dollarsExact } from "@/lib/money";
import { Button, ErrorNote, Field, Input, Segmented, cx, toast } from "./ui";
import { send, useApi } from "./use-api";
import { nickelReact } from "./nickel/store";

/*
 * Renaming: the shared pieces used by a transaction's sheet, a bill's sheet
 * and the Names screen. A rename is either "every charge like this" (a saved
 * rule, past and future) or "just this one".
 */

export type NameUndo = {
  ruleId: string;
  key: string;
  previousName: string | null;
  transactionId: string;
  customName: string | null;
  replaced: { amount: number; name: string } | null;
};

export type Scope = "every" | "one";

/**
 * Saves a name for every charge like this transaction. `fromItsSheet` when
 * renaming from the charge itself, so a name it had on its own makes way.
 */
export function renameEvery(transactionId: string, name: string, onlyThisAmount: boolean, fromItsSheet = false) {
  return send<{ ruleId: string; count: number; undo: NameUndo }>("POST", "/api/names", { transactionId, name, onlyThisAmount, fromItsSheet });
}

/** Puts things back exactly as they were before `renameEvery`. */
export async function undoRename(undo: NameUndo) {
  if (undo.previousName === null) await send("DELETE", `/api/names/${undo.ruleId}`);
  else await send("PATCH", `/api/names/${undo.ruleId}`, { name: undo.previousName });
  if (undo.replaced) await send("POST", "/api/names/restore", { key: undo.key, amount: undo.replaced.amount, name: undo.replaced.name });
  if (undo.customName) await send("PATCH", `/api/transactions/${undo.transactionId}`, { name: undo.customName });
}

export function renamedMessage(name: string, count: number): string {
  return count > 1 ? `Renamed ${count} charges to ${name}. New ones will be too.` : `Renamed to ${name}. New ones will be too.`;
}

/** How many charges a rename would change: a quick look before saving. */
export function useRenamePreview(transactionId: string | null, onlyThisAmount: boolean) {
  const { data } = useApi<{ count: number; bankNames: string[] }>(transactionId ? `/api/names/preview?transactionId=${encodeURIComponent(transactionId)}&onlyThisAmount=${onlyThisAmount ? 1 : 0}` : null);
  return data;
}

/**
 * Which charges a new name applies to. "Every charge" can be narrowed to one
 * exact amount, for names like Venmo or Zelle that pay for different things.
 */
export function ScopeChoice({
  transactionId,
  amount,
  scope,
  onScope,
  exact,
  onExact,
  allowOne = true,
}: {
  transactionId: string;
  amount: number;
  scope: Scope;
  onScope: (s: Scope) => void;
  exact: boolean;
  onExact: (v: boolean) => void;
  allowOne?: boolean;
}) {
  const preview = useRenamePreview(scope === "every" ? transactionId : null, exact);
  const count = preview?.count;
  return (
    <div className="flex flex-col gap-2.5">
      {allowOne && (
        <Segmented<Scope>
          full
          label="Which charges get this name"
          value={scope}
          onChange={onScope}
          options={[
            { value: "every", label: "Every charge like this" },
            { value: "one", label: "Just this one" },
          ]}
        />
      )}
      {scope === "every" ? (
        <>
          <p className="rounded-2xl bg-sky px-3.5 py-3 text-small text-sky-ink" aria-live="polite">
            {count === undefined ? "Counting charges…" : count > 1 ? `${count} charges change, and new ones arrive with this name.` : "This charge changes, and new ones like it arrive with this name."}
          </p>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-1 text-small">
            <input type="checkbox" checked={exact} onChange={(e) => onExact(e.target.checked)} className="size-5 shrink-0 accent-[var(--accent)]" />
            <span>
              <span className="block font-bold">Only when it’s {dollarsExact(Math.abs(amount))}</span>
              <span className="block text-ink-3">For names like Venmo or Zelle that pay for different things.</span>
            </span>
          </label>
        </>
      ) : (
        <p className="rounded-2xl bg-sunk px-3.5 py-3 text-small text-ink-2">Only this charge changes. Others keep their names.</p>
      )}
    </div>
  );
}

/**
 * A small form to name every charge like one transaction: used from a bill's
 * sheet and the Names screen.
 */
export function RenameForm({
  transactionId,
  current,
  amount,
  bankName,
  defaultExact = false,
  allowExact = true,
  submitLabel = "Save name",
  onDone,
  onCancel,
}: {
  transactionId: string;
  current: string;
  amount: number;
  bankName: string;
  defaultExact?: boolean;
  allowExact?: boolean;
  submitLabel?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current);
  const [exact, setExact] = useState(defaultExact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = validName(name);
    if (!clean) return setError("Give it a name of up to 60 letters.");
    setBusy(true);
    setError(null);
    try {
      const result = await renameEvery(transactionId, clean, allowExact && exact);
      toast(renamedMessage(clean, result.count), { action: { label: "Undo", run: () => undoRename(result.undo) } });
      nickelReact({ type: "task", task: "rename" });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Name" hint={`The bank calls it “${bankName}”. That stays in each charge’s details.`}>
        {(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} enterKeyHint="done" autoCapitalize="words" />}
      </Field>
      {allowExact ? (
        <ScopeChoice transactionId={transactionId} amount={amount} scope="every" onScope={() => {}} exact={exact} onExact={setExact} allowOne={false} />
      ) : (
        <p className="rounded-2xl bg-sky px-3.5 py-3 text-small text-sky-ink">Every past and future charge like this gets the new name.</p>
      )}
      {error && <ErrorNote message={error} />}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Saving" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A quiet line showing what the bank calls something, when that differs from its name. */
export function BankSays({ bankName, className }: { bankName: string | null; className?: string }) {
  if (!bankName) return null;
  return <p className={cx("break-words text-small text-ink-3", className)}>Bank says: {bankName}</p>;
}
