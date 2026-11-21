"use client";

import { PencilLine, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { TxList } from "@/components/transactions";
import { Button, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Segmented, Select, Sheet, Skeleton } from "@/components/ui";
import { LIVE_INTERVAL, useApi } from "@/components/use-api";
import { CATEGORIES } from "@/lib/categories";
import { addMonthsToMonth, monthName, monthOf } from "@/lib/dates";
import type { Me, TransactionsPayload } from "@/lib/types";

const PAGE = 60;
type Flow = "all" | "in" | "out";
const FLOW_OPTIONS: { value: Flow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in", label: "Money in" },
  { value: "out", label: "Money out" },
];

export default function TransactionsPage() {
  // Reading the address bar suspends during prerender, so the filters sit behind a boundary.
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-sheet" />}>
      <Transactions />
    </Suspense>
  );
}

function Transactions() {
  // Other screens link here with a filter already chosen, e.g. /transactions?category=dining.
  const params = useSearchParams();
  const { data: me } = useApi<Me>("/api/me");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [categoryKey, setCategoryKey] = useState(params.get("category") ?? "");
  const [account, setAccount] = useState("");
  const [month, setMonth] = useState(params.get("month") ?? "");
  const [flow, setFlow] = useState<Flow>("all");
  // "Show more" grows the page; changing any filter starts again from the first page.
  const filterKey = [q, categoryKey, account, month, flow].join("|");
  const [more, setMore] = useState({ key: filterKey, limit: PAGE });
  const limit = more.key === filterKey ? more.limit : PAGE;

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (q) p.set("q", q);
    if (categoryKey) p.set("category", categoryKey);
    if (account) p.set("account", account);
    if (month) p.set("month", month);
    if (flow !== "all") p.set("flow", flow);
    return `/api/transactions?${p}`;
  }, [q, categoryKey, account, month, flow, limit]);

  const { data, error, isValidating, mutate } = useApi<TransactionsPayload>(url, { refreshInterval: LIVE_INTERVAL });
  const months = useMemo(() => (me ? Array.from({ length: 14 }, (_, i) => addMonthsToMonth(monthOf(me.today), -i)) : []), [me]);
  const filtered = Boolean(q || categoryKey || account || month || flow !== "all");

  const clear = () => {
    setSearch("");
    setCategoryKey("");
    setAccount("");
    setMonth("");
    setFlow("all");
  };

  const [sheetOpen, setSheetOpen] = useState(false);
  const activeFilters = [categoryKey, account, month, flow !== "all" ? flow : ""].filter(Boolean).length;

  const categorySelect = (id?: string) => (
    <Select id={id} aria-label="Category" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
      <option value="">All categories</option>
      {CATEGORIES.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))}
    </Select>
  );
  const accountSelect = (id?: string) => (
    <Select id={id} aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
      <option value="">All accounts</option>
      {data?.accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
  const monthSelect = (id?: string) => (
    <Select id={id} aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
      <option value="">All time</option>
      {months.map((m) => (
        <option key={m} value={m}>
          {monthName(m)} {m.slice(0, 4)}
        </option>
      ))}
    </Select>
  );

  return (
    <>
      <PageHeader
        title="Transactions"
        lead="Every charge and deposit, newest first. Tap one to rename it, change its category or add a note."
        action={
          <Link href="/transactions/names" className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line bg-sheet px-3.5 text-small font-bold text-ink active:scale-[0.98] active:bg-sunk">
            <PencilLine size={16} aria-hidden />
            Names
          </Link>
        }
      />

      {/* On a phone: a search box and one Filter button. The choices open in a sheet. */}
      <div className="mb-4 flex gap-2 lg:hidden">
        <div className="relative min-w-0 flex-1">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input type="search" enterKeyHint="search" aria-label="Search transactions" placeholder="Search by name or note" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Button onClick={() => setSheetOpen(true)} className="relative px-4" aria-label={activeFilters > 0 ? `Filter, ${activeFilters} on` : "Filter"}>
          <SlidersHorizontal size={18} />
          Filter
          {activeFilters > 0 && <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--c-activity)] px-1 text-micro font-extrabold text-sheet">{activeFilters}</span>}
        </Button>
      </div>
      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter">
        <div className="flex flex-col gap-4">
          <Field label="Category">{(id) => categorySelect(id)}</Field>
          <Field label="Account">{(id) => accountSelect(id)}</Field>
          <Field label="Month">{(id) => monthSelect(id)}</Field>
          <Segmented label="Direction" full value={flow} onChange={setFlow} options={FLOW_OPTIONS} />
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={clear} disabled={!filtered}>
              Clear all
            </Button>
            <Button className="flex-1" variant="primary" onClick={() => setSheetOpen(false)}>
              {data ? `Show ${data.total.toLocaleString("en-US")}` : "Show results"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* On a wide screen everything fits in one row. */}
      <div className="mb-4 hidden gap-2.5 lg:grid lg:grid-cols-[minmax(14rem,1.4fr)_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input type="search" aria-label="Search transactions" placeholder="Search by name or note" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        {categorySelect()}
        {accountSelect()}
        {monthSelect()}
        <Segmented label="Direction" value={flow} onChange={setFlow} options={FLOW_OPTIONS} />
      </div>

      <Sheet className={isValidating && !data ? "opacity-60" : undefined}>
        {error && !data ? (
          <ErrorNote message={error.message} onRetry={() => mutate()} />
        ) : !data ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data.transactions.length === 0 ? (
          <EmptyState title={filtered ? "Nothing matches those filters" : "No transactions yet"} action={filtered ? <Button onClick={clear}>Clear filters</Button> : undefined}>
            {filtered ? "Try a different search, or widen the month and category." : "They show up here as soon as your bank reports them."}
          </EmptyState>
        ) : (
          <>
            <p className="mb-3 px-2 text-small text-ink-3" aria-live="polite">
              {data.total.toLocaleString("en-US")} {data.total === 1 ? "transaction" : "transactions"}
              {filtered && (
                <>
                  {" "}
                  match.{" "}
                  <button type="button" onClick={clear} className="font-bold text-accent-text">
                    Clear filters
                  </button>
                </>
              )}
            </p>
            <TxList transactions={data.transactions} today={data.today} />
            {data.hasMore && (
              <div className="mt-5 flex justify-center">
                <Button onClick={() => setMore({ key: filterKey, limit: limit + PAGE })}>Show more</Button>
              </div>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
