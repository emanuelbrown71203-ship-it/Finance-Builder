"use client";

import { SectionTabs } from "@/components/nav";
import { useState } from "react";
import { SegmentedBar, TrendChart } from "@/components/charts";
import { LinkBankButton } from "@/components/link-bank";
import { EmptyState, ErrorNote, PageHeader, Segmented, Sheet, SheetHeader, Skeleton } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { dollars, dollarsExact, percent } from "@/lib/money";
import { ASSET_CLASS_LABEL, type HoldingView, type InvestmentsPayload } from "@/lib/types";

type Range = "1m" | "3m" | "6m" | "1y";
const RANGE_PHRASE: Record<Range, string> = { "1m": "in the last month", "3m": "in the last 3 months", "6m": "in the last 6 months", "1y": "in the last year" };

/** Combines the same fund held in several accounts into one line. */
function combine(holdings: HoldingView[]) {
  const map = new Map<string, HoldingView & { accounts: string[] }>();
  for (const h of holdings) {
    const key = h.symbol ?? h.name;
    const existing = map.get(key);
    if (existing) {
      existing.quantity += h.quantity;
      existing.value += h.value;
      existing.costBasis = existing.costBasis === null || h.costBasis === null ? null : existing.costBasis + h.costBasis;
      if (!existing.accounts.includes(h.accountName)) existing.accounts.push(h.accountName);
    } else {
      map.set(key, { ...h, accounts: [h.accountName] });
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

function Gain({ value, basis }: { value: number; basis: number | null }) {
  if (basis === null || basis <= 0) return <span className="text-ink-3">Not reported</span>;
  const gain = value - basis;
  return (
    <span className="tabular whitespace-nowrap">
      <span className={gain >= 0 ? "text-good" : "text-bad"}>{gain >= 0 ? "+" : "−"}{dollars(Math.abs(gain)).replace("−", "")}</span>
      <span className="ml-1.5 text-ink-3">{percent(gain / basis)}</span>
    </span>
  );
}

export default function InvestingPage() {
  const [range, setRange] = useState<Range>("6m");
  const { data, error, mutate, isValidating } = useApi<InvestmentsPayload>(`/api/investments?range=${range}`, { refreshInterval: 30_000 });

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-96 rounded-sheet" />
        <Skeleton className="h-72 rounded-sheet" />
      </div>
    );
  }

  if (data.accounts.length === 0) {
    return (
      <>
        <PageHeader title="Wealth" />
        <SectionTabs />
        <Sheet>
          <EmptyState title="No investment accounts linked" action={<LinkBankButton>Link an account</LinkBankButton>}>
            Link a brokerage, IRA or 401(k) to see what you hold, how it’s split, and how it has moved.
          </EmptyState>
        </Sheet>
      </>
    );
  }

  const rows = combine(data.holdings);
  // A whole split into at most six parts; anything smaller folds into "Other".
  const top = data.allocation.slice(0, 5);
  const rest = data.allocation.slice(5).reduce((s, a) => s + a.value, 0);
  const parts = [...top.map((a) => ({ name: ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass, value: a.value })), ...(rest > 0 ? [{ name: "Other", value: rest }] : [])];
  const totalGain = data.total - data.costBasis;

  return (
    <>
      <PageHeader title="Wealth" lead="Every brokerage and retirement account together. Balances include contributions, so a rise isn’t all market growth." />
      <SectionTabs />

      <div className="grid grid-cols-1 gap-5">
        <Sheet>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="figure text-[clamp(2.75rem,8vw,4rem)]">{dollars(data.total)}</p>
              <p className="mt-3 text-ink-2">
                <span className="tabular font-medium text-ink">{dollars(Math.abs(data.change))}</span> {data.change >= 0 ? "higher" : "lower"} {RANGE_PHRASE[range]}.{" "}
                {data.costBasis > 0 && (
                  <>
                    You put in {dollars(data.costBasis)}, so it has {totalGain >= 0 ? "grown" : "fallen"} by {dollars(Math.abs(totalGain))} overall.
                  </>
                )}
              </p>
            </div>
            <Segmented
              label="Time range"
              value={range}
              onChange={setRange}
              options={[
                { value: "1m", label: "1M" },
                { value: "3m", label: "3M" },
                { value: "6m", label: "6M" },
                { value: "1y", label: "1Y" },
              ]}
            />
          </div>
          <div className={isValidating ? "opacity-70 transition-opacity" : "transition-opacity"}>
            <TrendChart label="Total invested balance" height={260} points={data.series} />
          </div>
        </Sheet>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.2fr_1fr]">
          <Sheet>
            <SheetHeader title="How it’s split" hint="By type of investment, across all accounts." />
            {parts.length > 0 ? <SegmentedBar parts={parts} label="Investments by type" /> : <p className="text-ink-2">Your institution hasn’t reported individual holdings yet.</p>}
          </Sheet>
          <Sheet>
            <SheetHeader title="Accounts" />
            <ul className="divide-y divide-line-soft">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <span>
                    <span className="font-medium">{a.name}</span>
                    <span className="block text-small text-ink-3">{a.institutionName}</span>
                  </span>
                  <span className="tabular font-medium">{dollars(a.balance)}</span>
                </li>
              ))}
            </ul>
          </Sheet>
        </div>

        {rows.length > 0 && (
          <Sheet>
            <SheetHeader title="Holdings" hint="The same fund held in more than one account is shown as one line." />
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-small">
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th scope="col" className="px-2 pb-2 font-medium">Holding</th>
                    <th scope="col" className="px-2 pb-2 text-right font-medium">Shares</th>
                    <th scope="col" className="px-2 pb-2 text-right font-medium">Price</th>
                    <th scope="col" className="px-2 pb-2 text-right font-medium">Value</th>
                    <th scope="col" className="px-2 pb-2 text-right font-medium">Gain or loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {rows.map((h) => (
                    <tr key={h.symbol ?? h.name}>
                      <th scope="row" className="px-2 py-3 font-normal">
                        <span className="flex items-center gap-3">
                          <span className="inline-flex h-7 min-w-14 items-center justify-center rounded-[6px] bg-sunk px-1.5 text-micro font-semibold text-ink-2">{h.symbol ?? "N/A"}</span>
                          <span className="min-w-0">
                            <span className="block font-medium text-ink">{h.name}</span>
                            <span className="block text-micro text-ink-3">{h.accounts.join(", ")}</span>
                          </span>
                        </span>
                      </th>
                      <td className="tabular px-2 py-3 text-right text-ink-2">{h.symbol === "CASH" ? "" : h.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="tabular px-2 py-3 text-right text-ink-2">{h.symbol === "CASH" ? "" : dollarsExact(h.price)}</td>
                      <td className="tabular px-2 py-3 text-right font-medium">{dollars(h.value)}</td>
                      <td className="px-2 py-3 text-right">
                        {h.assetClass !== "cash" && <Gain value={h.value} basis={h.costBasis} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sheet>
        )}
      </div>
    </>
  );
}
