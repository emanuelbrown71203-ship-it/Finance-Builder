"use client";

import { nickelReact } from "@/components/nickel/store";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { Columns } from "@/components/charts";
import { Button, Dialog, ErrorNote, Field, IconButton, Meter, MoneyInput, PageHeader, Sheet, SheetHeader, Skeleton, Tag, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { SPENDING_CATEGORIES, category } from "@/lib/categories";
import { addMonthsToMonth, monthName, monthOf } from "@/lib/dates";
import { dollars, parseDollarsToCents } from "@/lib/money";
import type { BudgetPayload, BudgetRow, Me } from "@/lib/types";

function LimitDialog({ row, onClose }: { row: BudgetRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onClose={onClose} title={row ? `${category(row.category).label} limit` : ""}>
      {row && <LimitForm key={row.category} row={row} onClose={onClose} />}
    </Dialog>
  );
}

function LimitForm({ row, onClose }: { row: BudgetRow; onClose: () => void }) {
  const [value, setValue] = useState(row.limit !== null ? String(row.limit / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (monthlyLimit: number | null) => {
    setBusy(true);
    try {
      await send("PUT", "/api/budget", { category: row.category, monthlyLimit });
      onClose();
      const name = category(row.category).label;
      const before = row.limit;
      if (monthlyLimit !== null) nickelReact({ type: "task", task: "budget", name });
      toast(monthlyLimit === null ? `Limit removed from ${name}` : `${name} limit set to ${dollars(monthlyLimit)}`, {
        action: { label: "Undo", run: () => send("PUT", "/api/budget", { category: row.category, monthlyLimit: before }) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cents = parseDollarsToCents(value);
    if (cents === null || cents <= 0) return setError("Enter an amount, like 250.");
    void save(cents);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Monthly limit" error={error} hint={row.average > 0 ? `You’ve averaged ${dollars(row.average)} a month over the last three months.` : undefined}>
        {(id) => <MoneyInput id={id} autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />}
      </Field>
      <div className="flex flex-wrap justify-between gap-2">
        {row.limit !== null ? (
          <Button variant="danger" disabled={busy} onClick={() => save(null)}>
            Remove limit
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Save limit
          </Button>
        </div>
      </div>
    </form>
  );
}

export default function BudgetPage() {
  const { data: me } = useApi<Me>("/api/me");
  const [month, setMonth] = useState<string | null>(null);
  const current = me ? monthOf(me.today) : null;
  const shown = month ?? current;
  const { data, error, mutate, isValidating } = useApi<BudgetPayload>(shown ? `/api/budget?month=${shown}` : null, { refreshInterval: 30_000 });
  const [editing, setEditing] = useState<string | null>(null);

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data || !shown || !current) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-72 rounded-sheet" />
        <Skeleton className="h-96 rounded-sheet" />
      </div>
    );
  }

  const isCurrent = shown === current;
  const largest = Math.max(1, ...data.rows.map((r) => r.spent));
  const last = data.months[data.months.length - 2];
  const unbudgeted = SPENDING_CATEGORIES.filter((c) => !data.rows.some((r) => r.category === c.key));
  const limited = data.rows.filter((r) => r.limit !== null);
  const limitedSpent = limited.reduce((s, r) => s + r.spent, 0);
  const overCount = limited.filter((r) => r.spent > (r.limit ?? 0)).length;
  const editingRow = editing ? (data.rows.find((r) => r.category === editing) ?? { category: editing, spent: 0, limit: null, lastMonth: 0, average: 0 }) : null;

  return (
    <>
      <PageHeader
        title="Budget"
        lead="Where the month’s money went, by category. Set a limit on the ones you want to keep an eye on."
        action={
          <div className="flex items-center gap-1 rounded-control border border-line bg-sheet p-0.5">
            <IconButton label="Previous month" onClick={() => setMonth(addMonthsToMonth(shown, -1))} disabled={addMonthsToMonth(shown, -1) < addMonthsToMonth(current, -12)}>
              <ChevronLeft size={18} />
            </IconButton>
            <span className="min-w-32 text-center font-medium" aria-live="polite">
              {monthName(shown)} {shown.slice(0, 4)}
            </span>
            <IconButton label="Next month" onClick={() => setMonth(addMonthsToMonth(shown, 1))} disabled={isCurrent}>
              <ChevronRight size={18} />
            </IconButton>
          </div>
        }
      />

      <div className={`grid grid-cols-1 gap-5 transition-opacity ${isValidating && data.month !== shown ? "opacity-60" : ""}`}>
        <Sheet className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(15rem,20rem)_1fr]">
          <div>
            <p className="text-small text-ink-3">Spent in {monthName(data.month)}{isCurrent ? " so far" : ""}</p>
            <p className="figure mt-3 text-[3.25rem]">{dollars(data.totalSpent)}</p>
            <p className="mt-3 text-ink-2">
              {data.income > 0 ? (
                data.income >= data.totalSpent ? (
                  <>That’s {dollars(data.income - data.totalSpent)} less than the {dollars(data.income)} that came in.</>
                ) : (
                  <>That’s {dollars(data.totalSpent - data.income)} more than the {dollars(data.income)} that came in{isCurrent ? " so far" : ""}.</>
                )
              ) : (
                <>No income has arrived yet this month.</>
              )}{" "}
              {last && <>{monthName(last.month)} ended at {dollars(last.spending)}.</>}
            </p>
            {limited.length > 0 && (
              <div className="mt-5">
                <div className="mb-1.5 flex items-baseline justify-between text-small">
                  <span className="font-medium">All limits together</span>
                  <span className="tabular text-ink-2">
                    {dollars(limitedSpent)} of {dollars(data.totalLimit)}
                  </span>
                </div>
                <Meter value={limitedSpent} max={data.totalLimit} label="Total budget used" />
                {overCount > 0 && <p className="mt-2 text-small text-ink-3">{overCount === 1 ? "One category is over its limit." : `${overCount} categories are over their limits.`}</p>}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="display mb-3 text-lead">Money in and money out</h2>
            <Columns
              label="Income and spending for the last six months"
              series={[
                { name: "Money in", color: "var(--series-3)" },
                { name: "Money out", color: "var(--series-1)" },
              ]}
              groups={data.months.map((m) => ({ key: m.month, label: monthName(m.month).slice(0, 3), values: [m.income, m.spending] }))}
            />
          </div>
        </Sheet>

        <Sheet>
          <SheetHeader title="By category" hint="Largest first. Transfers between your own accounts are left out." />
          <ul className="divide-y divide-line-soft">
            {data.rows.map((row) => {
              const overBy = row.limit !== null ? row.spent - row.limit : 0;
              return (
                <li key={row.category} className="grid grid-cols-1 items-center gap-x-4 gap-y-2 py-3.5 sm:grid-cols-[minmax(11rem,15rem)_1fr_auto]">
                  <Link href={`/transactions?category=${row.category}&month=${data.month}`} className="flex items-center gap-3 rounded-control hover:underline">
                    <CategoryIcon category={row.category} />
                    <span className="font-medium">{category(row.category).label}</span>
                  </Link>
                  <div className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-small">
                      <span className="tabular">
                        <span className="font-medium">{dollars(row.spent)}</span>
                        {row.limit !== null && <span className="text-ink-2"> of {dollars(row.limit)}</span>}
                        {overBy > 0 && (
                          <Tag tone="pink" className="ml-2">
                            {dollars(overBy)} over
                          </Tag>
                        )}
                      </span>
                      <span className="tabular text-ink-3">{monthName(addMonthsToMonth(data.month, -1)).slice(0, 3)}: {dollars(row.lastMonth)}</span>
                    </div>
                    {row.limit !== null ? (
                      <Meter value={row.spent} max={row.limit} label={`${category(row.category).label} budget used`} />
                    ) : (
                      // No limit: the bar just compares this category with the biggest one.
                      <div aria-hidden className="h-2 w-full rounded-full bg-line-soft">
                        <div className="h-full rounded-full bg-[var(--series-muted)]" style={{ width: `${Math.max(1.5, (row.spent / largest) * 100)}%` }} />
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant={row.limit !== null ? "quiet" : "ghost"} onClick={() => setEditing(row.category)} className="justify-self-start sm:w-28 sm:justify-self-end">
                    {row.limit !== null ? "Change limit" : "Set a limit"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {unbudgeted.length > 0 && (
            <div className="mt-4 border-t border-line-soft pt-4">
              <p className="mb-2 text-small text-ink-3">Nothing spent here this month. Set a limit anyway:</p>
              <div className="flex flex-wrap gap-2">
                {unbudgeted.map((c) => (
                  <Button key={c.key} size="sm" onClick={() => setEditing(c.key)}>
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Sheet>
      </div>

      <LimitDialog row={editingRow} onClose={() => setEditing(null)} />
    </>
  );
}
