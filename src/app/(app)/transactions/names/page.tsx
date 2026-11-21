"use client";

import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { RenameForm, renameEvery, renamedMessage, undoRename } from "@/components/names";
import { Button, Dialog, ErrorNote, Field, Input, PageHeader, Sheet, SheetHeader, Skeleton, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { formatShort } from "@/lib/dates";
import { validName } from "@/lib/finance/names";
import { dollarsExact } from "@/lib/money";
import type { NameRuleView, NamesPayload, UnclearName } from "@/lib/types";

const charges = (n: number) => `${n} ${n === 1 ? "charge" : "charges"}`;

export default function NamesPage() {
  const { data, error, mutate } = useApi<NamesPayload>("/api/names");
  const [renaming, setRenaming] = useState<UnclearName | null>(null);
  const [editing, setEditing] = useState<NameRuleView | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const keep = async (u: UnclearName) => {
    setBusyKey(u.key);
    try {
      const result = await renameEvery(u.sampleId, u.suggestion, false);
      toast(renamedMessage(u.suggestion, result.count), { action: { label: "Undo", run: () => undoRename(result.undo) } });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save. Try again.", { tone: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Names"
        back={{ href: "/transactions", label: "Transactions" }}
        lead="Banks often send code instead of a name. Give places names you’ll recognise, and every past and future charge follows. What the bank sent stays in each charge’s details."
      />
      {error && !data ? (
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      ) : !data ? (
        <div className="grid max-w-2xl gap-4">
          <Skeleton className="h-64 rounded-sheet" />
          <Skeleton className="h-40 rounded-sheet" />
        </div>
      ) : (
        <div className="grid max-w-2xl grid-cols-1 gap-4">
          <Sheet>
            <SheetHeader
              title="Could be clearer"
              hint={data.unclear.length > 0 ? `${data.unclear.length} ${data.unclear.length === 1 ? "place goes" : "places go"} by bank code. Passbook has guessed a name for each: keep it, or give it your own.` : undefined}
            />
            {data.unclear.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl bg-mint px-3.5 py-3 text-mint-ink">
                <Check size={20} aria-hidden className="shrink-0" />
                <p className="text-small font-bold">Every name is clear. Nice and tidy.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {data.unclear.map((u) => (
                  <li key={u.key} className="flex flex-col gap-2.5 py-3">
                    <div className="min-w-0">
                      <p className="font-bold">{u.suggestion}</p>
                      <p className="break-all text-small text-ink-3">Bank says: {u.bankName}</p>
                      <p className="text-small text-ink-3">
                        {charges(u.count)}, last on {formatShort(u.lastDate)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={busyKey === u.key} onClick={() => keep(u)} aria-label={`Keep the name ${u.suggestion}`}>
                        Keep “{u.suggestion.length > 22 ? `${u.suggestion.slice(0, 21)}…` : u.suggestion}”
                      </Button>
                      <Button size="sm" disabled={busyKey === u.key} onClick={() => setRenaming(u)}>
                        Rename
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>

          <Sheet>
            <SheetHeader title="Your names" hint={data.rules.length > 0 ? "Tap one to change it or stop using it. Charges you named one at a time keep their own names." : undefined} />
            {data.rules.length === 0 ? (
              <p className="text-small text-ink-2">Names you give show up here. You can also rename from any transaction or bill: tap it, then change its name.</p>
            ) : (
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {data.rules.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setEditing(r)} className="-mx-1 flex min-h-[60px] w-[calc(100%+0.5rem)] items-center gap-3 rounded-2xl px-1 py-2 text-left active:bg-sunk">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{r.name}</span>
                        {r.bankNames.length > 0 && <span className="block truncate text-small text-ink-3">Bank says: {r.bankNames.join(", ")}</span>}
                        <span className="block text-small text-ink-3">
                          {r.count > 0 ? charges(r.count) : "No charges in the last year"}
                          {r.amount !== 0 && `, only at ${dollarsExact(Math.abs(r.amount))}`}
                        </span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
        </div>
      )}

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title="Give it a name">
        {renaming && (
          <RenameForm key={renaming.key} transactionId={renaming.sampleId} current={renaming.suggestion} amount={renaming.amount} bankName={renaming.bankName} onDone={() => setRenaming(null)} onCancel={() => setRenaming(null)} />
        )}
      </Dialog>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing ? editing.name : ""}>
        {editing && <RuleForm key={editing.id} rule={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function RuleForm({ rule, onClose }: { rule: NameRuleView; onClose: () => void }) {
  const [name, setName] = useState(rule.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = validName(name);
    if (!clean) return setError("Give it a name of up to 60 letters.");
    if (clean === rule.name) return onClose();
    setBusy(true);
    try {
      await send("PATCH", `/api/names/${rule.id}`, { name: clean });
      toast(`Renamed to ${clean}`, { action: { label: "Undo", run: () => send("PATCH", `/api/names/${rule.id}`, { name: rule.name }) } });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { rule: removed } = await send<{ rule: { key: string; amount: number; name: string } }>("DELETE", `/api/names/${rule.id}`);
      toast(`Stopped calling these “${removed.name}”`, { action: { label: "Undo", run: () => send("POST", "/api/names/restore", removed) } });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t remove. Try again.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label="Name" hint={rule.bankNames.length > 0 ? `For charges the bank calls “${rule.bankNames[0]}”${rule.amount !== 0 ? `, only at ${dollarsExact(Math.abs(rule.amount))}` : ""}.` : undefined}>
        {(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoCapitalize="words" enterKeyHint="done" />}
      </Field>
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="danger" disabled={busy} onClick={remove}>
          Stop using it
        </Button>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
