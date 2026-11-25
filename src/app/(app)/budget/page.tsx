"use client";

import { ChevronLeft, ChevronRight, Circle, CircleCheck, CircleDashed, CircleMinus, Clock, RotateCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";
import { BudgetBar, STATUS, available } from "@/components/budget";
import { CategoryIcon } from "@/components/category-icon";
import { Columns, Runway } from "@/components/charts";
import { SectionTabs } from "@/components/nav";
import { nickelReact } from "@/components/nickel/store";
import { Switch } from "@/components/settings-sections";
import { Blocks, Button, Dialog, EmptyState, ErrorNote, Field, Fold, IconButton, MoneyInput, PageHeader, Sheet, SheetHeader, Skeleton, Tag, cx, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { budgetCategories, category } from "@/lib/categories";
import { TxList } from "@/components/transactions";
import { GoalDialog, type GoalSheet } from "@/components/goals";
import { addMonthsToMonth, dayOfMonth, formatShort, monthEnd, monthName, monthOf } from "@/lib/dates";
import { MonthBar, MonthLedger, type MonthFigures } from "@/components/month-money";
import { sharePercent, type SavingTodo } from "@/lib/finance/savings";
import { WINS } from "@/lib/game/progress";
import { dollars, dollarsExact, parseDollarsToCents } from "@/lib/money";
import type { BudgetPayload, BudgetRow, Me, TransactionsPayload } from "@/lib/types";

/*
 * The budget is the plan for the month's money. Up top, where it goes: what
 * comes in, bills, saving for goals, everyday budgets, and anything with no
 * job yet. Then each everyday category: what's left, what that is a day, and
 * whether it's on track at the usual pace. Tap one for the whole story (its
 * charges, six months of history, its limit and rollover). New here? One tap
 * suggests a whole budget from the last three months.
 */

type Previous = { monthlyLimit: number | null; rolloverSince: string | null; rolloverCarry: number };

/** Puts a category back the way it was (the Undo for any change to it). */
const restore = (cat: string, before: Previous) => send("PUT", "/api/budget", { category: cat, monthlyLimit: before.monthlyLimit, rolloverSince: before.rolloverSince, rolloverCarry: before.rolloverCarry });

function statusLine(row: BudgetRow, data: BudgetPayload): string {
  if (row.left === null) return row.average > 0 ? `Usually ${dollars(row.average)} a month` : "New this month";
  const spent = `${dollars(Math.max(0, row.spent))} spent of ${dollars(available(row))}`;
  if (row.left < 0 || !data.isCurrent) return spent;
  if (row.status === "watch") return `${spent}. On pace for about ${dollars(row.forecast)}`;
  return row.perDay !== null && data.daysLeft > 1 ? `${spent}. About ${dollars(row.perDay)} a day left` : spent;
}

/** Above the budgets: what's left in them, how much is over and where, and whether they fit the month's money. */
function BudgetsSummary({ data }: { data: BudgetPayload }) {
  const limited = data.rows.filter((r) => r.limit !== null);
  const overRows = limited.filter((r) => r.left !== null && r.left < 0);
  const overBy = overRows.reduce((s, r) => s - (r.left ?? 0), 0);
  const left = limited.reduce((s, r) => s + Math.max(0, r.left ?? 0), 0);
  const names = overRows.map((r) => category(r.category).label);
  const unplanned = data.plan.unplanned;
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-sunk px-3.5 py-2.5">
          <p className="text-small text-ink-3">Left in your budgets</p>
          <p className="tabular text-lead font-bold">{dollars(left)}</p>
        </div>
        <div className={cx("rounded-2xl px-3.5 py-2.5", overBy > 0 ? "bg-pink text-pink-ink" : "bg-sunk")}>
          <p className={cx("text-small", overBy > 0 ? "" : "text-ink-3")}>{overBy > 0 ? `Over, in ${overRows.length} ${overRows.length === 1 ? "budget" : "budgets"}` : "Over budget"}</p>
          <p className="tabular text-lead font-bold">{overBy > 0 ? dollars(overBy) : "None"}</p>
        </div>
      </div>
      {overBy > 0 && <p className="text-small text-ink-2">Over: {names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`}. That spending still counts in “Already spent” above.</p>}
      {data.isCurrent && unplanned > 2000 && <p className="text-small text-ink-2">{dollars(unplanned)} of this month’s money has no budget yet. Raise a limit, or put it toward a goal.</p>}
      {data.isCurrent && unplanned < 0 && <p className="rounded-control bg-pink px-3.5 py-3 text-small text-pink-ink">Your budgets add up to {dollars(-unplanned)} more than this month’s money, after bills and savings. Lowering a limit or two would make them fit.</p>}
    </div>
  );
}

function CategoryRow({ row, data, onOpen }: { row: BudgetRow; data: BudgetPayload; onOpen: () => void }) {
  const s = STATUS[row.status];
  const name = category(row.category).label;
  return (
    <li className="border-b border-line-soft last:border-0">
      <button type="button" onClick={onOpen} className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded-2xl px-1 py-3 text-left active:bg-sunk">
        <CategoryIcon category={row.category} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words font-bold leading-snug">{name}</span>
            <span className="tabular shrink-0">
              {row.left === null ? (
                <>
                  <span className="font-bold">{dollars(Math.max(0, row.spent))}</span>
                  <span className="text-small text-ink-3"> spent</span>
                </>
              ) : row.left < 0 ? (
                <span className="font-bold text-bad">Over by {dollars(-row.left)}</span>
              ) : (
                <>
                  <span className="font-bold">{dollars(row.left)}</span>
                  <span className="text-small text-ink-3"> left</span>
                </>
              )}
            </span>
          </span>
          {row.limit !== null && (
            <span className="mt-2 block">
              <BudgetBar row={row} />
            </span>
          )}
          <span className="mt-1.5 flex min-w-0 items-start gap-1.5 text-small text-ink-3">
            {row.limit !== null && (
              <Tag tone={s.tone} className="shrink-0">
                {s.label}
              </Tag>
            )}
            <span className="min-w-0">{statusLine(row, data)}</span>
          </span>
          {row.rollover && row.carried !== 0 && (
            <span className="mt-1 flex items-center gap-1 text-micro text-ink-3">
              <RotateCw size={12} aria-hidden /> {row.carried > 0 ? `${dollars(row.limit ?? 0)} budget plus ${dollars(row.carried)} carried over` : `${dollars(row.limit ?? 0)} budget less ${dollars(-row.carried)} overspent last time`}
            </span>
          )}
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
}

/**
 * The month at a glance, in four plain parts: what came in, what's already spent, what's spoken for (bills
 * still to pay and savings: promised, not spent yet), and what's free to spend, or how much it's over.
 * The same number as Home's.
 */
function MonthCard({ data, onPaychecks }: { data: BudgetPayload; onPaychecks: () => void }) {
  const current = monthOf(data.today);
  const when = data.month < current ? "past" : data.month > current ? "future" : "now";
  const p = data.plan;
  const f: MonthFigures = { month: data.month, incomeExpected: p.income, incomeReceived: p.incomeReceived, billsExpected: p.bills, billsPaid: p.billsPaid, savingsPlanned: p.saving, everydaySpent: p.everydaySpent, leftToSpend: p.leftToSpend, days: data.monthPlan?.days, savingsDone: data.savings.totals.saved };
  const over = p.leftToSpend < 0;
  const month = monthName(data.month);
  const explain =
    when === "past"
      ? over
        ? `${month} spent ${dollars(-p.leftToSpend)} more than came in, after bills and savings.`
        : `What ${month} had left after every bill, your savings and your spending.`
      : when === "future"
        ? `What ${month} should leave after the bills and savings expected, before any spending.`
        : over
          ? `Spending has gone past what this month’s money covers, after bills and savings. Holding off for the rest of ${month} keeps it from growing.`
          : `After every bill and your savings.${data.daysLeft > 1 ? ` About ${dollars(p.perDay)} a day for the ${data.daysLeft} days left.` : ""}`;
  return (
    <Sheet>
      <p className="text-small font-bold text-ink-2">{when === "past" ? month : when === "future" ? `${month}, planned` : `${month} so far`}</p>
      <p className={cx("mt-2 text-small font-bold", over ? "text-bad" : "text-ink-2")}>{over ? "Over by" : when === "past" ? "Left over" : "Free to spend"}</p>
      <p className={cx("figure mt-1 text-[clamp(2.75rem,13vw,3.75rem)]", over && "text-bad")}>{dollars(Math.abs(p.leftToSpend))}</p>
      <p className="mt-1.5 text-ink-2">{explain}</p>
      <MonthBar f={f} className="mt-5" />
      <div className="mt-2">
        <MonthLedger f={f} when={when} onPaychecks={data.paychecks.length > 0 ? onPaychecks : undefined} />
      </div>
    </Sheet>
  );
}

/**
 * The month ahead, split at each payday: what comes in, bills due, and everyday spending (spent so far,
 * then a forecast from the usual pattern, with nothing planned for the no-spend week), down to what's
 * likely left at the month's end.
 */
function MonthAheadCard({ data, ahead }: { data: BudgetPayload; ahead: NonNullable<BudgetPayload["ahead"]> }) {
  const month = monthName(data.month);
  const range = (a: string, b: string) => (a === b ? formatShort(a) : `${formatShort(a)} – ${dayOfMonth(b)}`);
  return (
    <Sheet>
      <SheetHeader title="Month ahead" hint="Split at each payday. Spending after today is a forecast from how you usually spend; the no-spend week is planned at $0." />
      <ol className="flex flex-col gap-2">
        {ahead.periods.map((p) => (
          <li key={p.start} className={cx("rounded-2xl border px-3 py-2.5", p.noSpend ? "border-mint-ink/30 bg-mint/40" : "border-line-soft")}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-bold">{range(p.start, p.end)}</span>
              <span className="flex flex-wrap gap-1.5">
                {p.paycheck ? <Tag tone={p.paycheck.expected ? "sky" : "mint"}>{p.paycheck.expected ? "Payday" : "Paid"} {dollars(p.paycheck.amount)}</Tag> : <Tag>Before payday</Tag>}
                {p.noSpend && <Tag tone="mint">No-spend week</Tag>}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[
                { label: "In", value: p.income, sign: "+" },
                { label: "Bills", value: p.bills, sign: "−" },
                { label: p.forecast > 0 && p.everyday === p.forecast ? "Spending (likely)" : p.forecast > 0 ? "Spending + likely" : "Spending", value: p.everyday, sign: "−" },
              ].map((x) => (
                <div key={x.label} className="min-w-0">
                  <dt className="truncate text-micro text-ink-3">{x.label}</dt>
                  <dd className="tabular font-bold">{x.value > 0 ? `${x.sign}${dollars(x.value)}` : "$0"}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
      <div className={cx("mt-3 rounded-2xl px-4 py-3", ahead.forecastLeft >= 0 ? "bg-mint text-mint-ink" : "bg-pink text-pink-ink")}>
        <p className="font-bold">
          {ahead.forecastLeft >= 0 ? `About ${dollars(ahead.forecastLeft)} left at the end of ${month}` : `About ${dollars(-ahead.forecastLeft)} short by the end of ${month}`}
        </p>
        <p className="mt-0.5 text-small">
          {ahead.forecast > 0 ? `If you spend like usual: ${dollars(ahead.leftNow)} free to spend now, less about ${dollars(ahead.forecast)} more spending. ` : ""}
          {ahead.forecastLeft > 0 ? "That’s what can go to savings." : "Skipping a few buys before the no-spend week closes the gap."}
        </p>
      </div>
    </Sheet>
  );
}

/** The month's paychecks. A coming one can be set lighter (missed days), and the month re-plans around it. */
function PaychecksDialog({ data, open, onClose }: { data: BudgetPayload; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Paychecks in ${monthName(data.month)}`}>
      <p className="mb-3 text-ink-2">Missed a day or two? Set what a coming paycheck will be, and your month re-plans around it.</p>
      <ul className="flex flex-col gap-2">
        {data.paychecks.map((p) => (
          <PaycheckRow key={`${p.key}|${p.date}|${p.amount}`} paycheck={p} />
        ))}
      </ul>
    </Dialog>
  );
}

function PaycheckRow({ paycheck: p }: { paycheck: BudgetPayload["paychecks"][number] }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(p.amount / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = (days: number) => Math.round((p.usual * (p.workdays - days)) / p.workdays);

  const save = async (amount: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const { previous } = await send<{ previous: number | null }>("PUT", "/api/paychecks", { key: p.key, date: p.date, amount });
      toast(amount === null ? `${formatShort(p.date)} paycheck is back to the usual ${dollars(p.usual)}` : `Planning on ${dollars(amount)} on ${formatShort(p.date)}`, {
        action: { label: "Undo", run: () => send("PUT", "/api/paychecks", { key: p.key, date: p.date, amount: previous }) },
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl border border-line-soft p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-bold">{formatShort(p.date)}</span>
          <span className="block truncate text-small text-ink-3">
            {p.name}
            {p.adjusted ? `, usually ${dollars(p.usual)}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {p.received ? <Tag tone="mint">In</Tag> : p.adjusted ? <Tag tone="canary">Lighter</Tag> : <Tag>Expected</Tag>}
          <span className="tabular font-bold">{dollarsExact(p.amount)}</span>
        </span>
      </div>
      {!p.received && !editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
          {p.adjusted && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(null)}>
              Back to usual
            </Button>
          )}
        </div>
      )}
      {editing && (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((n) => (
              <Button key={n} size="sm" disabled={busy} onClick={() => save(short(n))}>
                {n} {n === 1 ? "day" : "days"} short ({dollars(short(n))})
              </Button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const cents = parseDollarsToCents(value);
              if (cents === null || cents < 0) return setError("Enter an amount, like 750.");
              void save(cents);
            }}
          >
            <div className="min-w-0 flex-1">
              <MoneyInput aria-label="What this paycheck will be" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <Button variant="primary" type="submit" disabled={busy}>
              Save
            </Button>
          </form>
          {error && <p className="text-small text-bad">{error}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Savings, as the budget's first line: what the goals set aside each month (taken out before everyday
 * budgets, like a bill) and what's gone toward them this month. With no goal yet, it's where to start one.
 */
const SAVING_STATUS: Record<SavingTodo["status"], { icon: typeof Circle; label: string; className: string }> = {
  done: { icon: CircleCheck, label: "Done", className: "text-mint-ink" },
  partly: { icon: CircleDashed, label: "Part done", className: "text-accent-text" },
  todo: { icon: Circle, label: "To do", className: "text-accent-text" },
  coming: { icon: Clock, label: "Coming", className: "text-ink-3" },
  skipped: { icon: CircleMinus, label: "Skipped", className: "text-ink-3" },
};

/** Where one to-do's money comes from: "5% of your Nov 25 paycheck", "From your Nov 25 paycheck", "For November". */
function savingSource(t: SavingTodo): string {
  if (t.share !== null) return `${sharePercent(t.share)} of your ${formatShort(t.date)} paycheck`;
  if (t.paycheck !== null) return `From your ${formatShort(t.date)} paycheck`;
  return `For ${monthName(t.date.slice(0, 7))}`;
}

/**
 * Savings as a to-do each paycheck: what each goal gets from each paycheck, ticked off when the money goes
 * in (on its own for a goal that follows an account), with a habit already in place offered in one tap.
 */
function SavingsCard({ data, onOpen, onPlan, onGoal }: { data: BudgetPayload; onOpen: (t: SavingTodo) => void; onPlan: () => void; onGoal: (sheet: GoalSheet) => void }) {
  const { todos, totals, habit, goals } = data.savings;
  const [busy, setBusy] = useState(false);
  const month = monthName(data.month);
  const followHabit = async () => {
    if (!habit) return;
    if (!habit.goalId) return onGoal({ kind: "new" });
    setBusy(true);
    try {
      const goal = goals.find((g) => g.id === habit.goalId);
      await send("PATCH", `/api/goals/${habit.goalId}`, { accountId: habit.accountId, paycheckShare: habit.share });
      toast(`“${habit.goalName}” now follows ${habit.accountName}, at ${sharePercent(habit.share)} of each paycheck`, {
        action: goal ? { label: "Undo", run: () => send("PATCH", `/api/goals/${goal.id}`, { accountId: goal.account?.id ?? null, paycheckShare: goal.paycheckShare }) } : undefined,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t change that. Try again.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet>
      <SheetHeader
        title="Savings"
        hint={goals.length === 0 ? undefined : `What goes to your goals from each paycheck. It’s spoken for before “free to spend”, and ticks off when the money goes in.`}
        action={
          <Button size="sm" onClick={onPlan}>
            {goals.length === 0 ? "Start" : "Change plan"}
          </Button>
        }
      />
      {habit && (
        <div className="mb-3 rounded-2xl bg-mint/60 px-3.5 py-3 text-mint-ink">
          <p className="font-bold">
            {sharePercent(habit.share)} of every paycheck already goes into {habit.accountName}
          </p>
          <p className="mt-0.5 text-small">
            {habit.goalName ? `Have “${habit.goalName}” follow it? Each paycheck’s savings will tick off on their own when the money shows.` : "Start a goal that follows it, and each paycheck’s savings will tick off on their own."}
          </p>
          <Button size="sm" variant="primary" className="mt-2" disabled={busy} onClick={() => void followHabit()}>
            {habit.goalName ? `Yes, follow ${habit.accountName}` : "Start a goal"}
          </Button>
        </div>
      )}
      {goals.length === 0 ? (
        <p className="text-ink-2">Pick something to save for, and how much of each paycheck (or how much a month) goes to it. Passbook reminds you each payday and ticks it off when it’s done.</p>
      ) : todos.length === 0 ? (
        <p className="text-ink-2">No savings planned for {month}. Give a goal a share of each paycheck, or a monthly amount.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-small font-bold text-ink-2">{data.isCurrent ? `${month} so far` : month}</p>
            <p className="tabular text-small text-ink-2">
              <span className="font-bold text-ink">{dollars(totals.saved)}</span> of {dollars(totals.planned)} put aside
            </p>
          </div>
          <div className="mt-1.5">
            <Blocks share={totals.planned > 0 ? Math.min(1, totals.saved / totals.planned) : 0} color="var(--c-savings)" label="Put aside toward goals this month" height={10} />
          </div>
          {totals.toDo > 0 && data.isCurrent && <p className="mt-2 text-small font-bold text-accent-text">{dollars(totals.toDo)} still to put aside from paychecks that are in.</p>}
          <ul className="mt-2">
            {todos.map((t) => {
              const st = SAVING_STATUS[t.status];
              const Icon = st.icon;
              return (
                <li key={`${t.goalId}|${t.date}`} className="border-b border-line-soft last:border-0">
                  <button type="button" onClick={() => onOpen(t)} className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded-2xl px-1 py-2.5 text-left active:bg-sunk">
                    <Icon size={22} aria-hidden className={cx("shrink-0", st.className)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cx("min-w-0 break-words font-bold", t.status === "skipped" && "text-ink-3 line-through")}>{t.goalName}</span>
                        <span className={cx("tabular shrink-0 font-bold", t.status === "done" && "text-mint-ink")}>{dollarsExact(t.amount)}</span>
                      </span>
                      <span className="block text-small text-ink-3">
                        {savingSource(t)} · <span className={cx("font-bold", st.className)}>{t.status === "partly" ? `${dollarsExact(t.saved)} in` : st.label}</span>
                        {t.changed && t.status !== "skipped" ? " · changed" : ""}
                      </span>
                    </span>
                    <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}

/**
 * One paycheck's savings toward a goal: whether it can be done (the month's money, and checking before
 * payday), then mark it done, save less this time, skip it, or go back to the plan. Every change has Undo.
 */
function SavingTodoDialog({ data, todo, onClose }: { data: BudgetPayload; todo: SavingTodo | null; onClose: () => void }) {
  return (
    <Dialog open={todo !== null} onClose={onClose} title={todo ? todo.goalName : ""}>
      {todo && <SavingTodoDetail key={`${todo.goalId}|${todo.date}|${todo.amount}|${todo.saved}`} data={data} todo={todo} onClose={onClose} />}
    </Dialog>
  );
}

function SavingTodoDetail({ data, todo: t, onClose }: { data: BudgetPayload; todo: SavingTodo; onClose: () => void }) {
  const [less, setLess] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = Math.max(0, t.amount - t.saved);
  const free = data.plan.leftToSpend;
  const cash = data.savings.cash;
  const afterCash = cash ? cash.checking - remaining - cash.billsBeforePayday : null;
  const open = t.status === "todo" || t.status === "partly" || t.status === "coming";

  const mark = async (amount: number | null, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const { previous } = await send<{ previous: number | null }>("PUT", "/api/savings", { goalId: t.goalId, date: t.date, amount });
      toast(done, { action: { label: "Undo", run: () => send("PUT", "/api/savings", { goalId: t.goalId, date: t.date, amount: previous }) } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };
  const putAside = async () => {
    setBusy(true);
    setError(null);
    try {
      const { depositId } = await send<{ depositId: string | null }>("POST", "/api/savings", { goalId: t.goalId, date: t.date });
      toast(`${dollarsExact(remaining)} put toward ${t.goalName}`, depositId ? { action: { label: "Undo", run: () => send("DELETE", `/api/goals/${t.goalId}/deposits/${depositId}`) } } : {});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };
  const saveLess = () => {
    const cents = parseDollarsToCents(value);
    if (cents === null || cents < 0) return setError("Enter an amount, like 50.");
    if (cents >= t.planned) return setError(`That’s the plan or more. Leave it at ${dollarsExact(t.planned)}, or enter less.`);
    void mark(cents, `${t.goalName}: ${dollarsExact(cents)} from this paycheck`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="figure text-[2.5rem]">{dollarsExact(t.status === "done" ? t.amount : remaining)}</p>
        <p className="text-ink-2">
          {savingSource(t)}
          {t.changed && t.status !== "skipped" ? ` (planned ${dollarsExact(t.planned)})` : ""}.{" "}
          {t.status === "done" ? "Done: it’s put aside." : t.status === "partly" ? `${dollarsExact(t.saved)} is in so far.` : t.status === "coming" ? "That paycheck hasn’t come in yet." : t.status === "skipped" ? "You skipped this one." : "Still to put aside."}
        </p>
      </div>

      {open && remaining > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-small font-bold text-ink-2">Can you?</p>
          {free >= 0 ? (
            <p className="rounded-2xl bg-mint px-3.5 py-3 text-small text-mint-ink">Yes, for the month: it’s already counted, and {dollars(free)} is still free to spend after it.</p>
          ) : (
            <p className="rounded-2xl bg-pink px-3.5 py-3 text-small text-pink-ink">
              This month is over by {dollars(-free)}, with this counted. Saving less or skipping this one brings that down by the same amount{remaining + free > 0 ? `; saving ${dollarsExact(remaining + free)} would keep the month even` : ""}. Holding off on spending lets you save it all.
            </p>
          )}
          {cash && afterCash !== null && t.status !== "coming" && (
            <p className={cx("rounded-2xl px-3.5 py-3 text-small", afterCash < 0 ? "bg-canary text-canary-ink" : "bg-sunk text-ink-2")}>
              {afterCash < 0
                ? `Not right now from checking: it has ${dollars(cash.checking)}, and ${dollars(cash.billsBeforePayday)} in bills come out before ${cash.nextPayday ? `payday on ${formatShort(cash.nextPayday)}` : "the month ends"}. Moving ${dollarsExact(remaining)} now would leave it ${dollars(-afterCash)} short. Move it after payday, or save less.`
                : `Checking has ${dollars(cash.checking)}. After this and the ${dollars(cash.billsBeforePayday)} in bills before ${cash.nextPayday ? `payday on ${formatShort(cash.nextPayday)}` : "the month ends"}, it would still have ${dollars(afterCash)}.`}
            </p>
          )}
        </div>
      )}

      {open && remaining > 0 && t.account && t.status !== "coming" && (
        <p className="rounded-2xl bg-sunk px-3.5 py-3 text-small text-ink-2">Move {dollarsExact(remaining)} into {t.account.name} in your bank’s app. It ticks itself off when the bank shows it: pull down to refresh afterwards.</p>
      )}

      {less && (
        <Field label="Save this much from this paycheck" hint={`The plan is ${dollarsExact(t.planned)}. Only this paycheck changes.`} error={error}>
          {(id) => <MoneyInput id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={String(Math.round(t.planned / 2) / 100)} autoFocus />}
        </Field>
      )}
      {error && !less && <ErrorNote message={error} />}

      <div className="flex flex-wrap justify-end gap-2">
        {t.changed && (
          <Button disabled={busy} onClick={() => void mark(null, `${t.goalName}: back to ${dollarsExact(t.planned)}`)}>
            Back to the plan
          </Button>
        )}
        {open && t.status !== "skipped" && (
          <Button disabled={busy} onClick={() => void mark(0, `Skipped ${t.goalName} for this paycheck`)}>
            Skip this one
          </Button>
        )}
        {open && !less && (
          <Button disabled={busy} onClick={() => setLess(true)}>
            Save less this time
          </Button>
        )}
        {less && (
          <Button variant="primary" disabled={busy} onClick={saveLess}>
            Save {value ? "that" : "less"}
          </Button>
        )}
        {!less && open && remaining > 0 && !t.account && t.status !== "coming" && (
          <Button variant="primary" disabled={busy} onClick={() => void putAside()}>
            I put it aside
          </Button>
        )}
      </div>
    </div>
  );
}

/** Each goal's monthly amount, ready to change or add to, and a new goal. */
function SavingsDialog({ data, open, onClose, onGoal }: { data: BudgetPayload; open: boolean; onClose: () => void; onGoal: (sheet: GoalSheet) => void }) {
  const { goals } = data.savings;
  return (
    <Dialog open={open} onClose={onClose} title="Savings">
      <div className="flex flex-col gap-4">
        <p className="text-ink-2">
          {goals.length === 0
            ? "Pick something to save for, and how much of each paycheck (or how much a month) goes to it. It comes out of your month first, before everyday budgets, so it’s spoken for before “free to spend”."
            : `${dollars(data.plan.saving)} goes to your goals in ${monthName(data.month)}, first, before everyday budgets, so it’s spoken for before “free to spend”. Change a goal’s plan, or record money you put in.`}
        </p>
        {goals.length > 0 && (
          <ul className="flex flex-col gap-2">
            {goals.map((g) => (
              <li key={g.id} className="rounded-2xl border border-line-soft p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-bold">{g.name}</span>
                  <span className="tabular shrink-0 font-bold">{g.paycheckShare ? `${sharePercent(g.paycheckShare)} of each paycheck` : g.monthlyContribution > 0 ? `${dollars(g.monthlyContribution)}/mo` : "No plan yet"}</span>
                </div>
                <p className="text-small text-ink-3">
                  {dollars(g.saved)} of {dollars(g.target)} saved
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.account ? (
                    <span className="inline-flex min-h-9 items-center text-small text-ink-3">Follows {g.account.name}</span>
                  ) : (
                    <Button size="sm" onClick={() => onGoal({ kind: "add", goal: g })}>
                      Put money in
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => onGoal({ kind: "edit", goal: g })}>
                    Change plan
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Link href="/savings" onClick={onClose} className="inline-flex min-h-11 items-center px-2 text-small font-bold text-accent-text">
            See savings
          </Link>
          <Button variant="primary" onClick={() => onGoal({ kind: "new" })}>
            {goals.length === 0 ? "Start a savings goal" : "New goal"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** "Set up my budget": a limit for each everyday category from the last three months, sized to fit. */
function SetupDialog({ data, open, onClose }: { data: BudgetPayload; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="A budget from your spending">
      {open && data.suggestion && <SetupForm data={data} onClose={onClose} />}
    </Dialog>
  );
}

function SetupForm({ data, onClose }: { data: BudgetPayload; onClose: () => void }) {
  const suggestion = data.suggestion!;
  const has = new Set(data.rows.filter((r) => r.limit !== null).map((r) => r.category));
  const rows = suggestion.limits.filter((l) => !has.has(l.category));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.category, String(r.limit / 100)])));
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.category, true])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = rows.filter((r) => on[r.category]).map((r) => ({ category: r.category, monthlyLimit: parseDollarsToCents(values[r.category] ?? "") }));
  // $0 is a budget too: nothing on it this month.
  const missing = rows.filter((r) => on[r.category] && parseDollarsToCents(values[r.category] ?? "") === null).map((r) => category(r.category).label);
  const valid = missing.length === 0;
  const total = chosen.reduce((s, c) => s + (c.monthlyLimit ?? 0), 0) + data.rows.reduce((s, r) => s + (r.limit ?? 0), 0);
  const average = (cat: string) => data.rows.find((r) => r.category === cat)?.average ?? 0;

  const save = async () => {
    if (!valid || chosen.length === 0) return;
    setBusy(true);
    try {
      const { previous } = await send<{ previous: { category: string; monthlyLimit: number | null; rolloverSince: string | null }[] }>("POST", "/api/budget/plan", { limits: chosen });
      nickelReact({ type: "task", task: "budget", name: "your budget" });
      toast(`Budget set for ${chosen.length} ${chosen.length === 1 ? "category" : "categories"}`, { action: { label: "Undo", run: () => send("POST", "/api/budget/plan", { limits: previous }) } });
      onClose();
    } catch (e) {
      // Said here: a message at the bottom would sit behind this sheet.
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">
        What you usually spend on each, from the last three months, rounded up. Rent, utilities, insurance and loans aren’t here: they’re bills, set aside first.
        {suggestion.trimmed ? " Trimmed a little so everything fits what’s left after bills and saving." : ""} Change any amount, or untick ones you don’t want a limit on.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.category} className={cx("flex items-center gap-3 rounded-control border border-line-soft p-2.5", !on[r.category] && "opacity-60")}>
            <input type="checkbox" checked={on[r.category]} onChange={(e) => setOn({ ...on, [r.category]: e.target.checked })} aria-label={`Budget for ${category(r.category).label}`} className="size-5 shrink-0 accent-[var(--accent)]" />
            <CategoryIcon category={r.category} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{category(r.category).label}</span>
              <span className="block text-small text-ink-3">Usually {dollars(average(r.category))}</span>
            </span>
            <span className="w-28 shrink-0">
              <MoneyInput inputMode="decimal" aria-label={`${category(r.category).label} limit`} value={values[r.category] ?? ""} disabled={!on[r.category]} onChange={(e) => setValues({ ...values, [r.category]: e.target.value })} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-small text-ink-3">
        All your budgets would add up to <span className="tabular font-bold text-ink">{dollars(total)}</span>
        {suggestion.room > 0 ? (
          <>
            {" "}
            of the <span className="tabular font-bold text-ink">{dollars(suggestion.room)}</span> left after bills and saving.
          </>
        ) : (
          "."
        )}{" "}
        Each new limit earns {WINS.budget.xp} XP (up to {WINS.budget.perDay} a day).
      </p>
      {error && <p className="rounded-control bg-pink px-3.5 py-3 text-small text-pink-ink">{error}</p>}
      {/* Say why the button won't go, right beside it. */}
      {(!valid || chosen.length === 0) && (
        <p className="rounded-control bg-canary px-3.5 py-3 text-small text-canary-ink" aria-live="polite">
          {chosen.length === 0 ? "Tick at least one to set a budget." : `Put an amount for ${missing.join(", ")} (0 is fine), or untick it.`}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Not now</Button>
        <Button variant="primary" disabled={busy || !valid || chosen.length === 0} onClick={save}>
          Use this budget
        </Button>
      </div>
    </div>
  );
}

/** One category, in full: where it stands, its limit and rollover, six months, and this month's charges. */
function CategoryDialog({ row, data, onClose }: { row: BudgetRow | null; data: BudgetPayload; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onClose={onClose} title={row ? category(row.category).label : ""}>
      {row && <CategoryDetail key={row.category} row={row} data={data} onClose={onClose} />}
    </Dialog>
  );
}

function CategoryDetail({ row, data, onClose }: { row: BudgetRow; data: BudgetPayload; onClose: () => void }) {
  const [value, setValue] = useState(row.limit !== null ? String(row.limit / 100) : row.average > 0 ? String(Math.ceil(row.average / 1000) * 10) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: charges } = useApi<TransactionsPayload>(`/api/transactions?category=${row.category}&month=${data.month}&flow=out&limit=8`);
  const name = category(row.category).label;
  const top = Math.max(1, ...row.history.map((h) => h.spent), row.limit ?? 0);

  const saveLimit = async (monthlyLimit: number | null) => {
    setBusy(true);
    try {
      const { previous } = await send<{ previous: Previous }>("PUT", "/api/budget", { category: row.category, monthlyLimit });
      if (monthlyLimit !== null) nickelReact({ type: "task", task: "budget", name });
      toast(monthlyLimit === null ? `Limit removed from ${name}` : `${name} budget set to ${dollars(monthlyLimit)}`, { action: { label: "Undo", run: () => restore(row.category, previous) } });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseDollarsToCents(value);
    if (cents === null || cents < 0) return setError("Enter an amount, like 250 (or 0 for nothing this month).");
    void saveLimit(cents);
  };
  // The switch shows the change and flips straight back, so it needs no message (one would sit behind this sheet anyway).
  const [rollover, setRollover] = useState(row.rollover);
  // Switching it off forgets what was carried. Switching it back on (a stray tap) puts that back exactly.
  const [forgot, setForgot] = useState<Previous | null>(null);
  const toggleRollover = async (on: boolean) => {
    setRollover(on);
    setError(null);
    try {
      if (on && forgot?.rolloverSince) {
        await restore(row.category, forgot);
        setForgot(null);
      } else {
        const { previous } = await send<{ previous: Previous }>("PUT", "/api/budget", { category: row.category, rollover: on });
        if (!on) setForgot(previous);
      }
    } catch (e) {
      setRollover(!on);
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {row.limit !== null && (
        <div>
          <div className="flex items-center gap-2">
            <Tag tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Tag>
            <span className="text-small text-ink-3">{statusLine(row, data)}</span>
          </div>
          <p className={cx("figure mt-3 text-[2.75rem]", (row.left ?? 0) < 0 && "text-bad")}>{(row.left ?? 0) < 0 ? `−${dollars(-(row.left ?? 0))}` : dollars(row.left ?? 0)}</p>
          <p className="text-ink-2">{(row.left ?? 0) < 0 ? "over" : "left"} of {dollars(available(row))}</p>
          <div className="mt-3">
            <BudgetBar row={row} />
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2">
        {[
          ["Spent", dollars(Math.max(0, row.spent))],
          data.isCurrent ? ["Likely by " + formatShort(monthEnd(data.month)), dollars(row.forecast)] : ["Last month", dollars(row.lastMonth)],
          ["Usually", `${dollars(row.average)} a month`],
          row.rollover ? ["Carried over", row.carried >= 0 ? dollars(row.carried) : `−${dollars(-row.carried)}`] : ["Last month", dollars(row.lastMonth)],
        ].map(([k, v], i) => (
          <div key={`${k}-${i}`} className="rounded-control bg-sunk px-3 py-2.5">
            <dt className="text-micro font-bold text-ink-3">{k}</dt>
            <dd className="tabular mt-1 font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      {row.bills > 0 && <p className="-mt-2 text-small text-ink-3">Plus {dollarsExact(row.bills)} in bills from {name} (they’re in the charges below too), set aside separately and not counted against this budget.</p>}

      <div>
        <h3 className="mb-2 font-bold">Six months</h3>
        <div className="flex h-28 items-end gap-2" role="img" aria-label={`${name} spending for the last six months: ${row.history.map((h) => `${monthName(h.month)} ${dollars(h.spent)}`).join(", ")}`}>
          {row.history.map((h) => {
            const over = row.limit !== null && h.spent > row.limit;
            return (
              <div key={h.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="tabular text-[11px] text-ink-3">{h.spent >= 100_000 ? `${Math.round(h.spent / 100_000)}k` : Math.round(h.spent / 100)}</span>
                <span className="w-full rounded-t-md" style={{ height: `${Math.max(3, (h.spent / top) * 100)}%`, background: h.month === data.month ? "var(--sec)" : over ? "color-mix(in srgb, var(--bad) 55%, var(--sheet))" : "color-mix(in srgb, var(--sec) 35%, var(--sheet))" }} />
                <span className="text-[11px] text-ink-3">{monthName(h.month).slice(0, 3)}</span>
              </div>
            );
          })}
        </div>
        {row.limit !== null && row.history.some((h) => h.month !== data.month && h.spent > row.limit!) && <p className="mt-2 text-small text-ink-3">Pink months went over today’s {dollars(row.limit)} budget.</p>}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <Field label="Monthly budget" error={error} hint={row.average > 0 ? `You’ve averaged ${dollars(row.average)} a month over the last three months.` : undefined}>
          {(id) => (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <MoneyInput id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
              </div>
              <Button variant="primary" type="submit" disabled={busy}>
                {row.limit === null ? "Set budget" : "Save"}
              </Button>
            </div>
          )}
        </Field>
        {row.limit !== null && (
          <>
            <div className="flex min-h-12 items-center justify-between gap-4">
              <div>
                <p className="font-bold">Roll over what’s left</p>
                <p className="text-small text-ink-3">{rollover ? "On: what’s left at the end of this month carries into the next, and overspending comes off it." : "What isn’t spent carries into next month. Overspending is taken off next month."}</p>
              </div>
              <Switch checked={rollover} onChange={toggleRollover} label="Roll over what’s left" />
            </div>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => saveLimit(null)} className="self-start text-bad">
              Remove this budget
            </Button>
          </>
        )}
      </form>

      <div className="border-t border-line-soft pt-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="font-bold">This month’s charges</h3>
          <Link href={`/transactions?category=${row.category}&month=${data.month}`} className="text-small font-bold text-accent-text">
            See all
          </Link>
        </div>
        {!charges ? (
          <Skeleton className="h-24" />
        ) : charges.transactions.length === 0 ? (
          <p className="text-small text-ink-3">Nothing yet this month.</p>
        ) : (
          // Tap one to change its category (to a bill, say), name or note, right here.
          <TxList transactions={charges.transactions} today={data.today} grouped={false} />
        )}
      </div>
    </div>
  );
}

export default function BudgetPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-sheet" />}>
      <Budget />
    </Suspense>
  );
}

function Budget() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useApi<Me>("/api/me");
  const [month, setMonth] = useState<string | null>(null);
  const current = me ? monthOf(me.today) : null;
  const shown = month ?? current;
  const { data, error, mutate, isValidating } = useApi<BudgetPayload>(shown ? `/api/budget?month=${shown}` : null, { refreshInterval: 30_000 });
  const [setup, setSetup] = useState(false);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [paychecksOpen, setPaychecksOpen] = useState(false);
  const [goalSheet, setGoalSheet] = useState<GoalSheet>({ kind: "closed" });
  const [hidden, hide] = useSuggestionHidden(shown);
  const opened = params.get("category");
  const [adding, setAdding] = useState<string | null>(null);
  const open = (cat: string | null) => {
    setAdding(null);
    router.replace(cat ? `/budget?category=${cat}` : "/budget", { scroll: false });
  };
  // A savings to-do opens from its row, or from Home's "Put $X toward…" (`?save=<goal>|<date>`).
  const savingKey = params.get("save");
  const openSaving = (t: SavingTodo | null) => router.replace(t ? `/budget?save=${encodeURIComponent(`${t.goalId}|${t.date}`)}` : "/budget", { scroll: false });

  const header = (
    <>
      <PageHeader
        title="Spending"
        action={
          shown && current ? (
            <div className="flex items-center gap-0.5 rounded-control border border-line bg-sheet p-0.5">
              <IconButton label="Previous month" className="size-10" onClick={() => setMonth(addMonthsToMonth(shown, -1))} disabled={addMonthsToMonth(shown, -1) < addMonthsToMonth(current, -12)}>
                <ChevronLeft size={18} />
              </IconButton>
              <span className="min-w-[4.5rem] text-center text-small font-bold" aria-live="polite">
                {monthName(shown).slice(0, 3)} {shown.slice(2, 4) !== current.slice(2, 4) ? `’${shown.slice(2, 4)}` : ""}
              </span>
              <IconButton label="Next month" className="size-10" onClick={() => setMonth(addMonthsToMonth(shown, 1))} disabled={shown === current}>
                <ChevronRight size={18} />
              </IconButton>
            </div>
          ) : undefined
        }
      />
      <SectionTabs />
    </>
  );

  if (error && !data) {
    return (
      <>
        {header}
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data || !shown) {
    return (
      <>
        {header}
        <div className="grid grid-cols-1 gap-4">
          <Skeleton className="h-80 rounded-sheet" />
          <Skeleton className="h-96 rounded-sheet" />
        </div>
      </>
    );
  }

  const limited = data.rows.filter((r) => r.limit !== null);
  // No budget yet: everyday spending this month or usually. Categories that only ever pay bills sit with the rest.
  const everyday = (r: BudgetRow) => r.spent > 0 || r.average > 0;
  const loose = data.rows.filter((r) => r.limit === null && everyday(r));
  // Necessities (rent, insurance…) are bills, so they're never offered a budget.
  const nothingYet = budgetCategories().filter((c) => !data.rows.some((r) => r.category === c.key && (r.limit !== null || everyday(r))));
  const openRow = opened ? (data.rows.find((r) => r.category === opened) ?? (adding === opened || budgetCategories().some((c) => c.key === opened) ? blankRow(opened, data) : null)) : null;

  return (
    <>
      {header}
      <div className={cx("grid grid-cols-1 gap-4 transition-opacity xl:grid-cols-[1fr_1.1fr] xl:items-start", isValidating && data.month !== shown && "opacity-60")}>
        <div className="flex flex-col gap-4">
          {data.suggestion && (limited.length === 0 || !hidden) && (
            <Sheet className="border-accent-soft bg-accent-soft/40">
              <div className="flex items-start gap-3">
                <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
                  <Sparkles size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="display text-lead">{limited.length === 0 ? "Set up your budget in one tap" : "Some spending has no budget yet"}</h2>
                  <p className="mt-1 text-small text-ink-2">
                    {limited.length === 0
                      ? "Passbook suggests a monthly amount for each kind of everyday spending from your last three months, sized to fit what’s left after bills and saving."
                      : `Suggested amounts for ${data.suggestion.limits.filter((l) => !limited.some((r) => r.category === l.category)).length} more, from what you usually spend.`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => setSetup(true)}>
                      {limited.length === 0 ? "Suggest a budget" : "See suggestions"}
                    </Button>
                    {limited.length > 0 && <Button onClick={() => hide(data.month)}>Not now</Button>}
                  </div>
                </div>
              </div>
            </Sheet>
          )}
          <MonthCard data={data} onPaychecks={() => setPaychecksOpen(true)} />
          <SavingsCard data={data} onOpen={(t) => openSaving(t)} onPlan={() => setSavingsOpen(true)} onGoal={setGoalSheet} />
          {data.ahead && <MonthAheadCard data={data} ahead={data.ahead} />}
          {data.monthPlan && (
            <Sheet>
              <SheetHeader title="Spending pace" hint="What’s free to spend as the month goes on, against spending it evenly." />
              <Runway plan={data.monthPlan} height={220} />
            </Sheet>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Sheet>
            <SheetHeader title="Budgets" hint={limited.length > 0 ? "What’s left under the limit you set for each kind of everyday spending. Bills and savings aren’t in here: they’re in “Spoken for” above. The tick on each bar is where you’d be today, spending evenly." : undefined} />
            {limited.length > 0 && <BudgetsSummary data={data} />}
            {limited.length > 0 ? (
              <ul>
                {limited.map((r) => (
                  <CategoryRow key={r.category} row={r} data={data} onOpen={() => open(r.category)} />
                ))}
              </ul>
            ) : (
              <EmptyState title="No budgets yet">Tap a kind of spending below to give it a monthly amount, or use the suggestion above.</EmptyState>
            )}
          </Sheet>

          {(loose.length > 0 || nothingYet.length > 0) && (
            <Sheet>
              <SheetHeader title="No budget yet" hint="Everyday spending with no monthly amount. Tap one to add one." />
              {loose.length > 0 && (
                <ul>
                  {loose.map((r) => (
                    <CategoryRow key={r.category} row={r} data={data} onOpen={() => open(r.category)} />
                  ))}
                </ul>
              )}
              {nothingYet.length > 0 && data.isCurrent && (
                <Fold title="Nothing spent yet" summary={`${nothingYet.length} more`} className="mt-2 border-t border-line-soft">
                  <div className="flex flex-wrap gap-2 pb-3">
                    {nothingYet.map((c) => (
                      <Button
                        key={c.key}
                        size="sm"
                        onClick={() => {
                          setAdding(c.key);
                          router.replace(`/budget?category=${c.key}`, { scroll: false });
                        }}
                      >
                        {c.label}
                      </Button>
                    ))}
                  </div>
                </Fold>
              )}
            </Sheet>
          )}

          <Fold title="Money in and out" className="edge rounded-sheet bg-sheet px-4 shadow-card sm:px-6" summary={`${monthName(addMonthsToMonth(data.month, -5)).slice(0, 3)} to ${monthName(data.month).slice(0, 3)}`}>
            <div className="pb-4">
              <Columns
                label="Money in and money out for the last six months, bills included"
                series={[
                  { name: "Money in", color: "var(--series-3)" },
                  { name: "Money out", color: "var(--series-1)" },
                ]}
                groups={data.months.map((m) => ({ key: m.month, label: monthName(m.month).slice(0, 3), values: [m.income, m.spending] }))}
              />
            </div>
          </Fold>
          <p className="px-1 text-small text-ink-3">
            Bills you must pay aren’t part of these budgets: they come out of the month first. Extras like Netflix are, in their category. See both in{" "}
            <Link href="/bills" className="font-bold text-accent-text">
              Bills
            </Link>
            .
          </p>
        </div>
      </div>

      <CategoryDialog row={openRow} data={data} onClose={() => open(null)} />
      <SavingTodoDialog data={data} todo={savingKey ? (data.savings.todos.find((t) => `${t.goalId}|${t.date}` === savingKey) ?? null) : null} onClose={() => openSaving(null)} />
      <SetupDialog data={data} open={setup} onClose={() => setSetup(false)} />
      <PaychecksDialog data={data} open={paychecksOpen} onClose={() => setPaychecksOpen(false)} />
      <SavingsDialog
        data={data}
        open={savingsOpen}
        onClose={() => setSavingsOpen(false)}
        onGoal={(sheet) => {
          // One sheet at a time: the savings list closes while a goal is open.
          setSavingsOpen(false);
          setGoalSheet(sheet);
        }}
      />
      <GoalDialog sheet={goalSheet} today={data.today} onClose={() => setGoalSheet({ kind: "closed" })} />
    </>
  );
}

/** "Not now" on the suggestion card: hidden for the rest of the month, on this device. */
function useSuggestionHidden(month: string | null): [boolean, (month: string) => void] {
  const key = "passbook-budget-suggest-hidden";
  const hidden = useSyncExternalStore(
    (l) => {
      window.addEventListener(key, l);
      return () => window.removeEventListener(key, l);
    },
    () => {
      try {
        return localStorage.getItem(key) === month;
      } catch {
        return false;
      }
    },
    () => true,
  );
  const hide = (m: string) => {
    try {
      localStorage.setItem(key, m);
    } catch {}
    window.dispatchEvent(new Event(key));
  };
  return [hidden, hide];
}

/** A category with nothing spent and no budget yet, to give it one. */
function blankRow(cat: string, data: BudgetPayload): BudgetRow {
  return { category: cat, spent: 0, bills: 0, limit: null, rollover: false, carried: 0, left: null, perDay: null, forecast: 0, paceNow: null, status: "none", lastMonth: 0, lastMonthBills: 0, average: 0, history: Array.from({ length: 6 }, (_, i) => ({ month: addMonthsToMonth(data.month, i - 5), spent: 0 })) };
}
