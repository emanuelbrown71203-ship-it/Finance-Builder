"use client";

import { useState } from "react";
import { addDays, type ISODate } from "@/lib/dates";
import { FREQUENCY_LABEL } from "@/lib/finance/recurring";
import { dollars, parseDollarsToCents } from "@/lib/money";
import { Button, ErrorNote, Field, Input, MoneyInput, Segmented, Select, toast } from "./ui";
import { send } from "./use-api";
import { nickelReact } from "./nickel/store";

/*
 * Adding (or changing) a bill by hand: a new subscription, a bill paid by
 * check, or a one-off coming up. Used from Bills and by Nickel when he's been
 * asked to add one but needs a detail filled in.
 */

export type BillFrequencyChoice = "once" | "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly";
const ORDER: BillFrequencyChoice[] = ["monthly", "once", "weekly", "biweekly", "quarterly", "semiannual", "yearly"];

export type BillDraft = { name: string; amount: number | null; frequency: BillFrequencyChoice; startDate: ISODate | null; kind: "bill" | "subscription" };

export type SavedBill = { id: string; name: string; amount: number; frequency: string; startDate: string; kind: string; category: string; cancelled: boolean; addedBy: string };

/**
 * `via: "nickel"` saves it as Nickel's doing (so it shows in the activity
 * list); otherwise it's the owner's own. `editing` changes an existing one.
 */
export function BillForm({ today, draft, editing, via = "you", onDone, onCancel }: { today: ISODate; draft?: Partial<BillDraft>; editing?: { id: string } & BillDraft; via?: "you" | "nickel"; onDone: () => void; onCancel: () => void }) {
  const start = editing ?? draft;
  const [name, setName] = useState(start?.name ?? "");
  const [amount, setAmount] = useState(start?.amount ? String(start.amount / 100) : "");
  const [frequency, setFrequency] = useState<BillFrequencyChoice>(start?.frequency ?? "monthly");
  const [date, setDate] = useState<string>(start?.startDate ?? addDays(today, 7));
  const [kind, setKind] = useState<"bill" | "subscription">(start?.kind ?? "bill");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseDollarsToCents(amount);
    if (!name.trim()) return setError("Name the bill, like “Netflix”.");
    if (cents === null || cents <= 0) return setError("Enter what it costs, like 15.99.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Pick the date it’s due.");
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        // The date shown is the next one due; sending it only when it was changed keeps the day the bill was
        // first set for (a bill on the 31st stays on the 31st).
        const { before } = await send<{ before: SavedBill }>("PATCH", `/api/bills/${editing.id}`, { name, amount: cents, frequency, kind: frequency === "once" ? "bill" : kind, ...(date !== editing.startDate || frequency !== editing.frequency ? { startDate: date } : {}) });
        toast("Bill saved", { action: { label: "Undo", run: () => send("PATCH", `/api/bills/${editing.id}`, { name: before.name, amount: Math.abs(before.amount), frequency: before.frequency, startDate: before.startDate, kind: before.kind }) } });
      } else if (via === "nickel") {
        const done = await send<{ activityId: string; summary: string }>("POST", "/api/nickel/do", frequency === "once" ? { kind: "upcoming", name, amount: cents, date } : { kind: "bill", name, amount: cents, frequency, date, billKind: kind });
        toast(done.summary, { action: { label: "Undo", run: () => send("POST", `/api/activity/${done.activityId}/undo`) } });
        nickelReact({ type: "task", task: "bill", name: name.trim() });
      } else {
        const { id } = await send<{ id: string }>("POST", "/api/bills", { name, amount: cents, frequency, startDate: date, kind: frequency === "once" ? "bill" : kind });
        toast(`${name.trim()} added to your bills`, { action: { label: "Undo", run: () => send("DELETE", `/api/bills/${id}`) } });
        nickelReact({ type: "task", task: "bill", name: name.trim() });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  const cents = parseDollarsToCents(amount);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="What is it?">{(id) => <Input id={id} autoFocus={!start?.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Netflix" autoCapitalize="words" />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">{(id) => <MoneyInput id={id} autoFocus={Boolean(start?.name) && !start?.amount} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />}</Field>
        <Field label="How often">
          {(id) => (
            <Select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as BillFrequencyChoice)}>
              {ORDER.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={frequency === "once" ? "Due on" : "Next due"}>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      {frequency !== "once" && <Segmented<"bill" | "subscription"> full label="A bill you need, or an extra" value={kind} onChange={setKind} options={[{ value: "bill", label: "Bill (a need)" }, { value: "subscription", label: "Extra (a want)" }]} />}
      <p className="rounded-2xl bg-sky px-3.5 py-3 text-small text-sky-ink">
        {frequency === "once"
          ? `It shows in what’s coming up${cents ? ` and takes ${dollars(cents)} off what’s left to spend` : ""} until its date.`
          : kind === "bill"
            ? `It shows with your bills and is set aside from what’s left to spend each time it’s due. If the bank also shows it later, you can remove this one.`
            : `It shows with your Extras as a reminder. Like any spending, it counts against your budget when the charge comes through.`}
      </p>
      {error && <ErrorNote message={error} />}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Saving" : editing ? "Save changes" : "Add bill"}
        </Button>
      </div>
    </form>
  );
}
