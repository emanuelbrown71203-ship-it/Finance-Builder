"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Columns } from "@/components/charts";
import { Button, Dialog, EmptyState, ErrorNote, Field, Input, MoneyInput, PageHeader, Sheet, Skeleton, Tag, confirm, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { formatMedium, monthName } from "@/lib/dates";
import { dollars, parseDollarsToCents } from "@/lib/money";
import type { GoalView, GoalsPayload } from "@/lib/types";

type Mode = { kind: "closed" } | { kind: "new" } | { kind: "edit"; goal: GoalView } | { kind: "add"; goal: GoalView };

function GoalDialog({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const goal = mode.kind === "edit" || mode.kind === "add" ? mode.goal : null;
  const title = mode.kind === "new" ? "New savings goal" : mode.kind === "add" ? `Add to ${goal?.name}` : "Edit goal";
  return (
    <Dialog open={mode.kind !== "closed"} onClose={onClose} title={title}>
      {mode.kind !== "closed" && <GoalForm key={`${mode.kind}-${goal?.id ?? "new"}`} mode={mode} onClose={onClose} />}
    </Dialog>
  );
}

function GoalForm({ mode, onClose }: { mode: Exclude<Mode, { kind: "closed" }>; onClose: () => void }) {
  const goal = mode.kind === "new" ? null : mode.goal;
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target / 100) : "");
  const [saved, setSaved] = useState("");
  const [monthly, setMonthly] = useState(goal ? String(goal.monthlyContribution / 100) : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode.kind === "add") {
      const cents = parseDollarsToCents(amount);
      if (cents === null || cents <= 0) return setError("Enter an amount, like 100.");
      return void run(async () => {
        await send("PATCH", `/api/goals/${mode.goal.id}`, { add: cents });
        toast(`Added ${dollars(cents)} to ${mode.goal.name}`, { action: { label: "Undo", run: () => send("PATCH", `/api/goals/${mode.goal.id}`, { add: -cents }) } });
      });
    }
    const targetCents = parseDollarsToCents(target);
    const monthlyCents = monthly.trim() ? parseDollarsToCents(monthly) : 0;
    const savedCents = saved.trim() ? parseDollarsToCents(saved) : 0;
    if (!name.trim()) return setError("Name the goal, like “New roof”.");
    if (targetCents === null || targetCents < 100) return setError("Enter how much you need, like 5000.");
    if (monthlyCents === null || savedCents === null) return setError("Amounts should be numbers, like 250.");
    const body = { name, target: targetCents, monthlyContribution: monthlyCents, targetDate: targetDate || null };
    void run(async () => {
      if (mode.kind === "edit") await send("PATCH", `/api/goals/${mode.goal.id}`, body);
      else await send("POST", "/api/goals", { ...body, saved: savedCents });
      toast(mode.kind === "edit" ? "Goal saved" : `“${name.trim()}” added to your goals`);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
        {mode.kind === "add" ? (
          <Field label="Amount to add" error={error} hint="This records money you’ve set aside for the goal. It doesn’t move money at your bank.">
            {(id) => <MoneyInput id={id} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />}
          </Field>
        ) : (
          <>
            <Field label="What are you saving for?">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Amount needed">{(id) => <MoneyInput id={id} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" />}</Field>
              {mode.kind === "new" ? (
                <Field label="Already saved">{(id) => <MoneyInput id={id} value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="0" />}</Field>
              ) : (
                <Field label="Target date (optional)">{(id) => <Input id={id} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}</Field>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Set aside each month" hint="Counted in your monthly plan before “left to spend”.">
                {(id) => <MoneyInput id={id} value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" />}
              </Field>
              {mode.kind === "new" && <Field label="Target date (optional)">{(id) => <Input id={id} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}</Field>}
            </div>
            {error && <ErrorNote message={error} />}
          </>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          {mode.kind === "edit" ? (
            <Button variant="danger" disabled={busy} onClick={async () => {
              // Permanent, so this one asks first.
              if (!(await confirm({ title: `Delete “${mode.goal.name}”?`, body: "The goal and what you’ve recorded toward it are removed. Your bank balance doesn’t change.", confirmLabel: "Delete goal", danger: true }))) return;
              void run(async () => {
                await send("DELETE", `/api/goals/${mode.goal.id}`);
                toast("Goal deleted");
              });
            }}>
              Delete goal
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {mode.kind === "new" ? "Create goal" : mode.kind === "add" ? "Add money" : "Save changes"}
            </Button>
          </div>
        </div>
    </form>
  );
}

function GoalCard({ goal, today, onAdd, onEdit }: { goal: GoalView; today: string; onAdd: () => void; onEdit: () => void }) {
  const ratio = Math.min(1, goal.saved / goal.target);
  const done = goal.saved >= goal.target;
  const late = !done && goal.targetDate && goal.projectedDate && goal.projectedDate > goal.targetDate;
  return (
    <Sheet as="article" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <h3 className="display text-lead">{goal.name}</h3>
        {done ? <Tag tone="mint">Reached</Tag> : late ? <Tag tone="canary">Behind schedule</Tag> : null}
      </div>
      <p className="mt-4">
        <span className="figure text-[2.25rem]">{dollars(goal.saved)}</span>
        <span className="tabular ml-2 text-ink-2">of {dollars(goal.target)}</span>
      </p>
      <div role="meter" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={Math.min(goal.saved, goal.target)} className="mt-4 h-3 overflow-hidden rounded-full bg-sky">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(ratio > 0 ? 2 : 0, ratio * 100)}%` }} />
      </div>
      <p className="mt-3 flex-1 text-small text-ink-2">
        {done
          ? "Fully funded."
          : goal.monthlyContribution > 0 && goal.projectedDate
            ? `${dollars(goal.target - goal.saved)} to go. At ${dollars(goal.monthlyContribution)} a month you get there around ${monthName(goal.projectedDate.slice(0, 7))} ${goal.projectedDate.slice(0, 4)}.`
            : `${dollars(goal.target - goal.saved)} to go. Set a monthly amount to see when you’ll get there.`}
        {goal.targetDate && !done && ` You’re aiming for ${formatMedium(goal.targetDate)}.`}
        {late && ` Raising the monthly amount to ${dollars(monthlyNeeded(goal, today))} would hit that date.`}
      </p>
      <div className="mt-4 flex gap-2">
        {!done && (
          <Button size="sm" variant="primary" onClick={onAdd}>
            Add money
          </Button>
        )}
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </Sheet>
  );
}

function monthlyNeeded(goal: GoalView, today: string): number {
  if (!goal.targetDate) return goal.monthlyContribution;
  const months = Math.max(1, (Number(goal.targetDate.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(goal.targetDate.slice(5, 7)) - Number(today.slice(5, 7)));
  return Math.ceil((goal.target - goal.saved) / months / 100) * 100;
}

export default function SavingsPage() {
  const { data, error, mutate } = useApi<GoalsPayload>("/api/goals", { refreshInterval: 30_000 });
  const [mode, setMode] = useState<Mode>({ kind: "closed" });

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-64 rounded-sheet" />
        <Skeleton className="h-72 rounded-sheet" />
      </div>
    );
  }

  const earmarked = data.goals.reduce((s, g) => s + g.saved, 0);
  const monthlyPlan = data.goals.filter((g) => g.saved < g.target).reduce((s, g) => s + g.monthlyContribution, 0);
  const savedSixMonths = data.monthlySaved.reduce((s, m) => s + m.amount, 0);

  return (
    <>
      <PageHeader
        title="Savings"
        lead="What you’ve put away, and what it’s for."
        action={
          <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
            <Plus size={16} /> New goal
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5">
        <Sheet className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(15rem,20rem)_1fr]">
          <div>
            <p className="text-small text-ink-3">In savings accounts</p>
            <p className="figure mt-3 text-[3.25rem]">{dollars(data.savingsBalance)}</p>
            <dl className="mt-5 divide-y divide-line-soft border-y border-line-soft text-small">
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">Earmarked for goals</dt>
                <dd className="tabular font-medium">{dollars(earmarked)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">Not earmarked</dt>
                <dd className="tabular font-medium">{dollars(Math.max(0, data.savingsBalance - earmarked))}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">Planned each month</dt>
                <dd className="tabular font-medium">{dollars(monthlyPlan)}</dd>
              </div>
            </dl>
            <ul className="mt-4 text-small text-ink-2">
              {data.savingsAccounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-4 py-1">
                  <span>
                    {a.name}
                    <span className="block text-micro text-ink-3">{a.institutionName}</span>
                  </span>
                  <span className="tabular">{dollars(a.balance)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <h2 className="display text-lead">Added to savings each month</h2>
            <p className="mb-3 mt-1 text-small text-ink-3">
              Deposits and interest minus withdrawals. {savedSixMonths >= 0 ? `${dollars(savedSixMonths)} added` : `${dollars(-savedSixMonths)} taken out`} over six months.
            </p>
            {data.savingsAccounts.length > 0 ? (
              <Columns label="Net added to savings accounts in each of the last six months" series={[{ name: "Added to savings", color: "var(--series-1)" }]} groups={data.monthlySaved.map((m) => ({ key: m.month, label: monthName(m.month).slice(0, 3), values: [Math.max(0, m.amount)] }))} />
            ) : (
              <EmptyState title="No savings account linked">Link one on the Accounts screen to track deposits here.</EmptyState>
            )}
          </div>
        </Sheet>

        <section aria-labelledby="goals-heading">
          <h2 id="goals-heading" className="display mb-3 text-title">
            Goals
          </h2>
          {data.goals.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} today={data.today} onAdd={() => setMode({ kind: "add", goal })} onEdit={() => setMode({ kind: "edit", goal })} />
              ))}
            </div>
          ) : (
            <Sheet>
              <EmptyState title="No goals yet" action={<Button variant="primary" onClick={() => setMode({ kind: "new" })}>Create a goal</Button>}>
                Name something you’re saving for, set an amount, and Passbook works out when you’ll get there.
              </EmptyState>
            </Sheet>
          )}
        </section>
      </div>

      <GoalDialog mode={mode} onClose={() => setMode({ kind: "closed" })} />
    </>
  );
}
