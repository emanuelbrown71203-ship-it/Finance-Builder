"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { TxList } from "@/components/transactions";
import { Button, EmptyState, ErrorNote, Input, PageHeader, Segmented, Select, Sheet, Skeleton } from "@/components/ui";
import { LIVE_INTERVAL, useApi } from "@/components/use-api";
import { CATEGORIES } from "@/lib/categories";
import { addMonthsToMonth, monthName, monthOf } from "@/lib/dates";
import type { Me, TransactionsPayload } from "@/lib/types";

const PAGE = 60;
type Flow = "all" | "in" | "out";

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

  return (
    <>
      <PageHeader title="Transactions" lead="Every charge and deposit from your linked accounts, newest first. Select one to change its category or add a note." />

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.4fr)_1fr_1fr_1fr_auto]">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input type="search" aria-label="Search transactions" placeholder="Search by name or note" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Category" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>
          {data?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)} {m.slice(0, 4)}
            </option>
          ))}
        </Select>
        <Segmented
          label="Direction"
          value={flow}
          onChange={setFlow}
          options={[
            { value: "all", label: "All" },
            { value: "in", label: "Money in" },
            { value: "out", label: "Money out" },
          ]}
        />
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
                  <button type="button" onClick={clear} className="font-medium text-accent-text hover:underline">
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
