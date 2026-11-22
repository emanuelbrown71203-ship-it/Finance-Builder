"use client";

import { ChevronLeft, ChevronRight, RotateCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BudgetBar, STATUS, available } from "@/components/budget";
import { CategoryIcon } from "@/components/category-icon";
import { Columns, Runway } from "@/components/charts";
import { SectionTabs } from "@/components/nav";
import { nickelReact } from "@/components/nickel/store";
import { Switch } from "@/components/settings-sections";
import { Button, Dialog, EmptyState, ErrorNote, Field, Fold, IconButton, MoneyInput, PageHeader, Sheet, SheetHeader, Skeleton, Tag, cx, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { SPENDING_CATEGORIES, category } from "@/lib/categories";
import { addMonthsToMonth, formatShort, monthEnd, monthName, monthOf } from "@/lib/dates";
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

type Previous = { monthlyLimit: number | null; rolloverSince: string | null };

/** Puts a category back the way it was (the Undo for any change to it). */
const restore = (cat: string, before: Previous) => send("PUT", "/api/budget", { category: cat, monthlyLimit: before.monthlyLimit, rolloverSince: before.rolloverSince });

function statusLine(row: BudgetRow, data: BudgetPayload): string {
  if (row.left === null) return row.average > 0 ? `Usually ${dollars(row.average)} a month` : "New this month";
  if (row.status === "over") return data.isCurrent ? `${dollars(Math.max(0, row.spent))} spent so far` : `${dollars(Math.max(0, row.spent))} spent`;
  if (!data.isCurrent) return `${dollars(row.left)} to spare`;
  if (row.status === "watch") return `On pace for about ${dollars(row.forecast)}`;
  return row.perDay !== null && data.daysLeft > 1 ? `${dollars(row.perDay)} a day for ${data.daysLeft} days` : "On track";
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
            <span className="truncate font-bold">{name}</span>
            <span className="tabular shrink-0">
              <span className={cx("font-bold", row.left !== null && row.left < 0 && "text-bad")}>{row.left === null ? dollars(Math.max(0, row.spent)) : row.left < 0 ? `${dollars(-row.left)} over` : `${dollars(row.left)} left`}</span>
              <span className="text-small text-ink-3"> {row.limit === null ? "spent" : `of ${dollars(available(row))}`}</span>
            </span>
          </span>
          {row.limit !== null && (
            <span className="mt-2 block">
              <BudgetBar row={row} />
            </span>
          )}
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-small text-ink-3">
            {row.limit !== null && <Tag tone={s.tone}>{s.label}</Tag>}
            <span className="truncate">{statusLine(row, data)}</span>
          </span>
          {row.rollover && row.carried !== 0 && (
            <span className="mt-1 flex items-center gap-1 text-micro text-ink-3">
              <RotateCw size={12} aria-hidden /> {row.carried > 0 ? `${dollars(row.carried)} carried over` : `${dollars(-row.carried)} overspent last time, taken off`}
            </span>
          )}
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
}

/** Where the month's money goes, as one bar and its parts. */
function PlanCard({ data }: { data: BudgetPayload }) {
  const p = data.plan;
  const limited = data.rows.filter((r) => r.limit !== null);
  const leftInBudgets = limited.reduce((s, r) => s + (r.left ?? 0), 0);
  const perDay = limited.reduce((s, r) => s + (r.perDay ?? 0), 0);
  const parts = [
    { label: "Bills and subscriptions", amount: p.bills, color: "var(--c-bills)" },
    { label: "Saving for goals", amount: p.saving, color: "var(--c-savings)" },
    { label: "Everyday budgets", amount: p.budgeted, color: "var(--accent)" },
    { label: p.unplanned >= 0 ? "Not planned yet" : "More than comes in", amount: Math.abs(p.unplanned), color: p.unplanned >= 0 ? "var(--line)" : "var(--bad)" },
  ];
  const whole = Math.max(1, parts.reduce((s, x) => s + x.amount, 0));
  return (
    <Sheet>
      {limited.length > 0 ? (
        <>
          <p className="text-small font-bold text-ink-2">{data.isCurrent ? "Left in your budgets" : `Left at the end of ${monthName(data.month)}`}</p>
          <p className={cx("figure mt-2 text-[clamp(2.75rem,13vw,3.75rem)]", leftInBudgets < 0 && "text-bad")}>{leftInBudgets < 0 ? `−${dollars(-leftInBudgets)}` : dollars(leftInBudgets)}</p>
          <p className="mt-1.5 text-ink-2">
            {data.isCurrent && data.daysLeft > 1 && leftInBudgets > 0 ? `About ${dollars(perDay)} a day across your budgets for the ${data.daysLeft} days left. ` : ""}
            {dollars(p.budgetedSpent)} spent of {dollars(p.budgeted)} budgeted{p.unbudgetedSpent > 0 ? `, and ${dollars(p.unbudgetedSpent)} where there’s no limit` : ""}.
          </p>
        </>
      ) : (
        <>
          <p className="text-small font-bold text-ink-2">Everyday spending in {monthName(data.month)}</p>
          <p className="figure mt-2 text-[clamp(2.75rem,13vw,3.75rem)]">{dollars(data.totalSpent)}</p>
          <p className="mt-1.5 text-ink-2">Bills and subscriptions are counted separately, in the plan below.</p>
        </>
      )}

      <div className="mt-5" aria-hidden>
        <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
          {parts.map((x) => x.amount > 0 && <span key={x.label} className="h-full" style={{ width: `${(x.amount / whole) * 100}%`, background: x.color }} />)}
        </div>
      </div>
      <dl className="mt-3 divide-y divide-line-soft">
        <div className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="font-bold">Money in{data.isCurrent ? " this month" : ""}</dt>
          <dd className="tabular font-bold">{dollars(p.income)}</dd>
        </div>
        {parts.map((x) => (
          <div key={x.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
              {x.label}
            </dt>
            <dd className={cx("tabular", x.label === "More than comes in" && "font-bold text-bad")}>{dollars(x.amount)}</dd>
          </div>
        ))}
      </dl>
      {data.isCurrent && p.unplanned > 2000 && limited.length > 0 && <p className="mt-2 rounded-control bg-sunk px-3.5 py-3 text-small text-ink-2">{dollars(p.unplanned)} has no job yet. Raise a limit, or put it toward a goal in Wealth.</p>}
      {data.isCurrent && p.unplanned < 0 && <p className="mt-2 rounded-control bg-pink px-3.5 py-3 text-small text-pink-ink">Your plan asks for {dollars(-p.unplanned)} more than comes in this month. Lowering a limit or two would close the gap.</p>}
    </Sheet>
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
  const chosen = rows.filter((r) => on[r.category]).map((r) => ({ category: r.category, monthlyLimit: parseDollarsToCents(values[r.category] ?? "") }));
  const valid = chosen.every((c) => c.monthlyLimit !== null && c.monthlyLimit > 0);
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
      toast(e instanceof Error ? e.message : "Couldn’t save. Try again.", { tone: "error" });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">
        What you usually spend on each, from the last three months, rounded up.
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
        Each new limit earns {WINS.budget.xp} XP.
      </p>
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
    if (cents === null || cents <= 0) return setError("Enter an amount, like 250.");
    void saveLimit(cents);
  };
  // The switch shows the change and flips straight back, so it needs no message (one would sit behind this sheet anyway).
  const [rollover, setRollover] = useState(row.rollover);
  const toggleRollover = async (on: boolean) => {
    setRollover(on);
    setError(null);
    try {
      await send("PUT", "/api/budget", { category: row.category, rollover: on });
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
      {row.bills > 0 && <p className="-mt-2 text-small text-ink-3">Plus {dollarsExact(row.bills)} in bills and subscriptions from {name}, planned separately and not counted here.</p>}

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
          <ul className="divide-y divide-line-soft">
            {charges.transactions.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{t.name}</span>
                  <span className="block text-small text-ink-3">{formatShort(t.date)}</span>
                </span>
                <span className="tabular shrink-0">{dollarsExact(-t.amount)}</span>
              </li>
            ))}
          </ul>
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
  const opened = params.get("category");
  const [adding, setAdding] = useState<string | null>(null);
  const open = (cat: string | null) => {
    setAdding(null);
    router.replace(cat ? `/budget?category=${cat}` : "/budget", { scroll: false });
  };

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
  const loose = data.rows.filter((r) => r.limit === null && r.spent > 0);
  const nothingYet = SPENDING_CATEGORIES.filter((c) => !data.rows.some((r) => r.category === c.key));
  const openRow = opened ? (data.rows.find((r) => r.category === opened) ?? (adding === opened || SPENDING_CATEGORIES.some((c) => c.key === opened) ? blankRow(opened, data) : null)) : null;

  return (
    <>
      {header}
      <div className={cx("grid grid-cols-1 gap-4 transition-opacity xl:grid-cols-[1fr_1.1fr] xl:items-start", isValidating && data.month !== shown && "opacity-60")}>
        <div className="flex flex-col gap-4">
          {data.suggestion && (
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
                  <Button variant="primary" className="mt-3" onClick={() => setSetup(true)}>
                    {limited.length === 0 ? "Suggest a budget" : "See suggestions"}
                  </Button>
                </div>
              </div>
            </Sheet>
          )}
          <PlanCard data={data} />
          {data.monthPlan && (
            <Sheet>
              <SheetHeader title="Spending pace" hint="What’s left to spend as the month goes on, against spending it evenly." />
              <Runway plan={data.monthPlan} height={220} />
            </Sheet>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Sheet>
            <SheetHeader title="Budgets" hint={limited.length > 0 ? "Everyday spending. The tick on each bar is where you’d be today spending evenly." : undefined} />
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

          <Fold title="Money in and out, six months" className="rounded-sheet border border-line-soft bg-sheet px-4 shadow-card sm:px-6" summary={`${monthName(addMonthsToMonth(data.month, -5)).slice(0, 3)} to ${monthName(data.month).slice(0, 3)}`}>
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
            Bills and subscriptions aren’t part of these budgets: they come out of the month first. See them in{" "}
            <Link href="/bills" className="font-bold text-accent-text">
              Bills
            </Link>
            .
          </p>
        </div>
      </div>

      <CategoryDialog row={openRow} data={data} onClose={() => open(null)} />
      <SetupDialog data={data} open={setup} onClose={() => setSetup(false)} />
    </>
  );
}

/** A category with nothing spent and no budget yet, to give it one. */
function blankRow(cat: string, data: BudgetPayload): BudgetRow {
  return { category: cat, spent: 0, bills: 0, limit: null, rollover: false, carried: 0, left: null, perDay: null, forecast: 0, paceNow: null, status: "none", lastMonth: 0, average: 0, history: Array.from({ length: 6 }, (_, i) => ({ month: addMonthsToMonth(data.month, i - 5), spent: 0 })) };
}
