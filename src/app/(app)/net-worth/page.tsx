"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TrendChart } from "@/components/charts";
import { Button, Dialog, ErrorNote, Field, Input, MoneyInput, PageHeader, Segmented, Sheet, SheetHeader, Skeleton, Tag, confirm, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { dollars, parseDollarsToCents } from "@/lib/money";
import { ACCOUNT_TYPE_LABEL, type AccountView, type NetWorthPayload } from "@/lib/types";

type Range = "1m" | "3m" | "6m" | "1y";
const RANGE_PHRASE: Record<Range, string> = { "1m": "in the last month", "3m": "in the last 3 months", "6m": "in the last 6 months", "1y": "in the last year" };

function ManualDialog({ open, account, onClose }: { open: boolean; account: AccountView | null; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={account ? "Update value" : "Add something by hand"}>
      <ManualForm key={account?.id ?? "new"} account={account} onClose={onClose} />
    </Dialog>
  );
}

function ManualForm({ account, onClose }: { account: AccountView | null; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<"asset" | "debt">(account && account.balance < 0 ? "debt" : "asset");
  const [value, setValue] = useState(account ? String(Math.abs(account.balance) / 100) : "");
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
    const cents = parseDollarsToCents(value);
    if (!name.trim()) return setError("Give it a name, like “Honda Civic”.");
    if (cents === null) return setError("Enter what it’s worth, like 18500.");
    void run(async () => {
      if (account) await send("PATCH", `/api/accounts/${account.id}`, { name, value: cents });
      else await send("POST", "/api/accounts", { name, kind, value: cents });
      toast(account ? `${name} updated` : `${name} added to your net worth`);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!account && <p className="text-small text-ink-2">For things no bank reports: a car, a house, jewelry, or money you owe a person.</p>}
      {!account && (
        <Segmented
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "asset", label: "Something I own" },
            { value: "debt", label: "Something I owe" },
          ]}
        />
      )}
      <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
      <Field label={kind === "asset" ? "What it’s worth today" : "What’s still owed"} error={error}>
        {(id) => <MoneyInput id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />}
      </Field>
      <div className="flex flex-wrap justify-between gap-2">
        {account ? (
          <Button variant="danger" disabled={busy} onClick={async () => {
              // Permanent, so this one asks first.
              if (!(await confirm({ title: `Remove ${account.name}?`, body: "It comes off your net worth, along with its history. This can’t be undone.", confirmLabel: "Remove", danger: true }))) return;
              void run(async () => {
                await send("DELETE", `/api/accounts/${account.id}`);
                toast(`${account.name} removed`);
              });
            }}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {account ? "Save value" : "Add to net worth"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Group({ type, accounts, onEdit }: { type: string; accounts: AccountView[]; onEdit: (a: AccountView) => void }) {
  if (accounts.length === 0) return null;
  const total = accounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{ACCOUNT_TYPE_LABEL[type] ?? type}</h3>
        <span className="tabular font-medium">{dollars(total)}</span>
      </div>
      <ul className="mt-1.5">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3 py-1.5 text-small">
            <span className="min-w-0">
              <span className="text-ink-2">{a.name}</span>
              {a.mask && <span className="tabular text-ink-3"> ending {a.mask}</span>}
              {a.itemId === null ? (
                <button type="button" onClick={() => onEdit(a)} className="ml-2 font-medium text-accent-text hover:underline">
                  Update
                </button>
              ) : (
                <span className="block text-micro text-ink-3">{a.institutionName}</span>
              )}
            </span>
            <span className="tabular whitespace-nowrap text-ink-2">{dollars(Math.abs(a.balance))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NetWorthPage() {
  const [range, setRange] = useState<Range>("6m");
  const { data, error, mutate, isValidating } = useApi<NetWorthPayload>(`/api/net-worth?range=${range}`, { refreshInterval: 30_000 });
  const [dialog, setDialog] = useState<{ open: boolean; account: AccountView | null }>({ open: false, account: null });

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-96 rounded-sheet" />
        <Skeleton className="h-72 rounded-sheet" />
      </div>
    );
  }

  const of = (type: string, sign: 1 | -1) => data.accounts.filter((a) => a.type === type && (sign === 1 ? a.balance >= 0 : a.balance < 0));
  const up = data.change >= 0;

  return (
    <>
      <PageHeader
        title="Net worth"
        lead="Everything you own minus everything you owe, tracked day by day."
        action={
          <Button onClick={() => setDialog({ open: true, account: null })}>
            <Plus size={17} /> Add by hand
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5">
        <Sheet>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="figure text-[clamp(2.75rem,8vw,4rem)]">{dollars(data.net)}</p>
              <p className="mt-3 text-ink-2">
                {data.change === 0 ? "No change" : <><span className="tabular font-medium text-ink">{dollars(Math.abs(data.change))}</span> {up ? "higher" : "lower"}</>} {RANGE_PHRASE[range]}.
                {!up && " Paying down debt and saving both move this up."}
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
            <TrendChart
              label="Net worth"
              height={260}
              points={data.series.map((p) => ({
                date: p.date,
                value: p.net,
                detail: [
                  { label: "You own", value: p.assets },
                  { label: "You owe", value: p.debts },
                ],
              }))}
            />
          </div>
        </Sheet>

        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <Sheet>
            <SheetHeader title="What you own" action={<Tag tone="mint">{dollars(data.assets)}</Tag>} />
            <div className="divide-y divide-line-soft">
              <Group type="depository" accounts={of("depository", 1)} onEdit={(a) => setDialog({ open: true, account: a })} />
              <Group type="investment" accounts={of("investment", 1)} onEdit={(a) => setDialog({ open: true, account: a })} />
              <Group type="property" accounts={of("property", 1)} onEdit={(a) => setDialog({ open: true, account: a })} />
            </div>
          </Sheet>
          <Sheet>
            <SheetHeader title="What you owe" action={<Tag tone="pink">{dollars(data.debts)}</Tag>} />
            {data.debts > 0 && (
              <Link href="/debt" className="mb-3 flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-sunk px-3.5 font-bold text-accent-text">
                See your payoff plan <ChevronRight size={17} />
              </Link>
            )}
            {data.debts > 0 ? (
              <div className="divide-y divide-line-soft">
                <Group type="credit" accounts={of("credit", -1)} onEdit={(a) => setDialog({ open: true, account: a })} />
                <Group type="loan" accounts={of("loan", -1)} onEdit={(a) => setDialog({ open: true, account: a })} />
              </div>
            ) : (
              <p className="text-ink-2">Nothing owed. Every linked card and loan is at zero.</p>
            )}
          </Sheet>
        </div>
      </div>

      <ManualDialog open={dialog.open} account={dialog.account} onClose={() => setDialog({ open: false, account: null })} />
    </>
  );
}
