"use client";

import { useState } from "react";
import { celebrate } from "@/components/celebrate";
import { Button, Dialog, ErrorNote, Field, Input, MoneyInput, confirm, cx, toast, type Tone } from "@/components/ui";
import { nickelReact } from "@/components/nickel/store";
import { send } from "@/components/use-api";
import { formatMedium, formatShort, monthName, type ISODate } from "@/lib/dates";
import { monthlyFor, quickDates } from "@/lib/finance/goalplan";
import { dollars, parseDollarsToCents } from "@/lib/money";
import type { GoalView } from "@/lib/types";

/* ---------- how a goal is going, in words ---------- */

export function goalStatus(goal: GoalView): { tone: Tone; label: string } {
  const gap = Math.abs(goal.gap ?? 0);
  switch (goal.status) {
    case "reached":
      return { tone: "mint", label: "Reached" };
    case "ahead":
      return { tone: "mint", label: `${dollars(gap)} ahead` };
    case "on_track":
      return { tone: "sky", label: "On track" };
    case "behind":
      return { tone: "canary", label: `${dollars(gap)} behind` };
    case "overdue":
      return { tone: "pink", label: "Date passed" };
    default:
      return { tone: "plain", label: "No date" };
  }
}

const monthYear = (date: ISODate) => `${monthName(date.slice(0, 7))} ${date.slice(0, 4)}`;

/** One or two plain sentences: what to put away, and how it's going. */
export function goalSentence(goal: GoalView): string {
  const left = goal.target - goal.saved;
  const by = goal.targetDate ? formatMedium(goal.targetDate) : null;
  const payday = goal.perPayday ? ` That’s ${dollars(goal.perPayday)} from each paycheck.` : "";
  switch (goal.status) {
    case "reached":
      return `Fully funded: ${dollars(goal.target)} saved.`;
    case "overdue":
      return `The date passed with ${dollars(left)} to go. Pick a new date for a fresh plan.`;
    case "no_date":
      return goal.pace > 0 && goal.projectedDate
        ? `${dollars(left)} to go. At about ${dollars(goal.pace)} a month you get there around ${monthYear(goal.projectedDate)}. Set a date to get a plan.`
        : `${dollars(left)} to go. Set a date and Passbook works out what to put away.`;
    case "behind":
      return `${dollars(Math.abs(goal.gap ?? 0))} behind where the plan has you today. Put away ${dollars(goal.perMonth ?? 0)} a month from now to still make ${by}.${payday}`;
    case "ahead":
      return `${dollars(goal.gap ?? 0)} ahead of the plan. ${dollars(goal.perMonth ?? 0)} a month from now gets you there by ${by}.${payday}`;
    default:
      return `Put away ${dollars(goal.perMonth ?? 0)} a month to reach it by ${by}.${payday}`;
  }
}

/* ---------- the sheet for making, changing and adding to a goal ---------- */

export type GoalSheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; goal: GoalView } | { kind: "add"; goal: GoalView } | { kind: "withdraw"; goal: GoalView };

export function GoalDialog({ sheet, today, onClose, onDeleted }: { sheet: GoalSheet; today: ISODate; onClose: () => void; onDeleted?: () => void }) {
  const goal = sheet.kind === "closed" || sheet.kind === "new" ? null : sheet.goal;
  const title = { closed: "", new: "New savings goal", edit: "Change goal", add: `Add to ${goal?.name}`, withdraw: `Take out of ${goal?.name}` }[sheet.kind];
  return (
    <Dialog open={sheet.kind !== "closed"} onClose={onClose} title={title}>
      {sheet.kind === "add" || sheet.kind === "withdraw" ? (
        <MoneyForm key={`${sheet.kind}-${sheet.goal.id}`} kind={sheet.kind} goal={sheet.goal} onClose={onClose} />
      ) : sheet.kind !== "closed" ? (
        <GoalForm key={`${sheet.kind}-${goal?.id ?? "new"}`} goal={goal} today={today} onClose={onClose} onDeleted={onDeleted} />
      ) : null}
    </Dialog>
  );
}

function MoneyForm({ kind, goal, onClose }: { kind: "add" | "withdraw"; goal: GoalView; onClose: () => void }) {
  const [amount, setAmount] = useState(kind === "add" && goal.perMonth ? String(goal.perMonth / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseDollarsToCents(amount);
    if (cents === null || cents <= 0) return setError("Enter an amount, like 100.");
    if (kind === "withdraw" && cents > goal.saved) return setError(`There’s ${dollars(goal.saved)} in this goal.`);
    setBusy(true);
    try {
      const { depositId } = await send<{ depositId: string | null }>("PATCH", `/api/goals/${goal.id}`, { add: kind === "add" ? cents : -cents });
      // The deposit that takes a goal over the line gets a celebration.
      if (kind === "add" && goal.saved < goal.target && goal.saved + cents >= goal.target) celebrate("You did it!", `“${goal.name}” is fully funded: ${dollars(goal.target)} saved.`);
      const undo = depositId ? { label: "Undo", run: () => send("DELETE", `/api/goals/${goal.id}/deposits/${depositId}`) } : undefined;
      toast(kind === "add" ? `Added ${dollars(cents)} to ${goal.name}` : `Took ${dollars(cents)} out of ${goal.name}`, { action: undo });
      if (kind === "add") {
        // Crossing a quarter of the way (25, 50, 75%) is a milestone worth a party; reaching 100% gets the big celebration above.
        const before = Math.floor((goal.saved / goal.target) * 4);
        const after = Math.floor(((goal.saved + cents) / goal.target) * 4);
        if (after > before && after < 4) nickelReact({ type: "task", task: "milestone", name: goal.name, percent: after * 25 });
        else nickelReact({ type: "task", task: "deposit", name: goal.name, amount: cents });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label={kind === "add" ? "Amount to add" : "Amount to take out"}
        error={error}
        hint={kind === "add" ? `This records money you’ve set aside. It doesn’t move money at your bank.${goal.perMonth ? ` The plan asks for ${dollars(goal.perMonth)} a month.` : ""}` : "For when you’ve spent some of it. Your bank isn’t touched."}
      >
        {(id) => <MoneyInput id={id} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {kind === "add" ? "Add money" : "Take out"}
        </Button>
      </div>
    </form>
  );
}

function GoalForm({ goal, today, onClose, onDeleted }: { goal: GoalView | null; today: ISODate; onClose: () => void; onDeleted?: () => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target / 100) : "");
  const [saved, setSaved] = useState("");
  const [targetDate, setTargetDate] = useState<string>(goal ? (goal.targetDate ?? "") : quickDates(today)[2].date);
  const [monthly, setMonthly] = useState(goal && goal.monthlyContribution > 0 ? String(goal.monthlyContribution / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetCents = parseDollarsToCents(target);
  const savedCents = goal ? goal.saved : (parseDollarsToCents(saved) ?? 0);
  const suggested = targetCents && targetDate ? monthlyFor(targetCents, savedCents, today, targetDate) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name the goal, like “New roof”.");
    if (targetCents === null || targetCents < 100) return setError("Enter how much you need, like 5000.");
    const startCents = saved.trim() ? parseDollarsToCents(saved) : 0;
    const monthlyCents = monthly.trim() ? parseDollarsToCents(monthly) : (suggested ?? 0);
    if (startCents === null || monthlyCents === null) return setError("Amounts should be numbers, like 250.");
    if (targetDate && targetDate <= today && targetDate !== (goal?.targetDate ?? "")) return setError("Pick a date after today.");
    const body = { name, target: targetCents, monthlyContribution: monthlyCents, targetDate: targetDate || null };
    setBusy(true);
    try {
      if (goal) await send("PATCH", `/api/goals/${goal.id}`, body);
      else await send("POST", "/api/goals", { ...body, saved: startCents });
      toast(goal ? "Goal saved" : `“${name.trim()}” added to your goals`);
      if (!goal) nickelReact({ type: "task", task: "goal", name: name.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  const chips = [...quickDates(today), { label: "No date", date: "" }];
  const custom = targetDate !== "" && !chips.some((c) => c.date === targetDate);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="What are you saving for?">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="New roof" />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount needed">{(id) => <MoneyInput id={id} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" />}</Field>
        {!goal && <Field label="Already saved">{(id) => <MoneyInput id={id} value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="0" />}</Field>}
      </div>
      <div>
        <p className="mb-1.5 text-small font-bold text-ink-2">By when?</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Target date">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              role="radio"
              aria-checked={targetDate === c.date}
              onClick={() => setTargetDate(c.date)}
              className={cx("min-h-11 rounded-full border px-4 text-small font-bold active:scale-[0.97]", targetDate === c.date ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-sheet text-ink-2")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Field label={custom ? "Your date" : "Or pick a date"}>{(id) => <Input id={id} type="date" min={today} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}</Field>
      </div>
      {suggested !== null && targetDate && (
        <p className="rounded-2xl bg-sky px-3.5 py-3 text-small text-sky-ink">
          To have {dollars(targetCents ?? 0)} by {formatShort(targetDate)}, {savedCents > 0 ? `on top of ${dollars(savedCents)} already saved, ` : ""}that’s <span className="font-bold">{dollars(suggested)} a month</span>.
        </p>
      )}
      <Field label="Set aside each month" hint={suggested ? `Leave blank to use ${dollars(suggested)}. It’s counted in your monthly plan before “left to spend”.` : "Counted in your monthly plan before “left to spend”."}>
        {(id) => <MoneyInput id={id} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder={suggested ? String(suggested / 100) : "0"} />}
      </Field>
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap justify-between gap-2">
        {goal ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              // Permanent, so this one asks first.
              if (!(await confirm({ title: `Delete “${goal.name}”?`, body: "The goal, its plan and everything you’ve recorded toward it are removed. Your bank balance doesn’t change.", confirmLabel: "Delete goal", danger: true }))) return;
              setBusy(true);
              try {
                await send("DELETE", `/api/goals/${goal.id}`);
                toast("Goal deleted");
                onClose();
                onDeleted?.();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn’t delete. Try again.");
                setBusy(false);
              }
            }}
          >
            Delete goal
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {goal ? "Save changes" : "Create goal"}
          </Button>
        </div>
      </div>
    </form>
  );
}
