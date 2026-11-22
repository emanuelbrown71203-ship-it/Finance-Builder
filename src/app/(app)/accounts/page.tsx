"use client";

import { useState } from "react";
import { AppleCardSheet } from "@/components/apple-card";
import { LinkBankButton } from "@/components/link-bank";
import { Button, Dialog, EmptyState, ErrorNote, PageHeader, Sheet, SheetHeader, Skeleton, Tag } from "@/components/ui";
import { send, useApi, useNow } from "@/components/use-api";
import { dollars } from "@/lib/money";
import { ACCOUNT_TYPE_LABEL, type AccountsPayload, type LinkedInstitution, type Me } from "@/lib/types";

function since(iso: string | null, now: number): string {
  if (!iso) return "Waiting for the first update";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  if (minutes < 1440) return `Updated ${Math.round(minutes / 60)} hr ago`;
  return `Updated ${Math.round(minutes / 1440)} days ago`;
}

function Institution({ institution, now, onRemove }: { institution: LinkedInstitution; now: number; onRemove: () => void }) {
  const broken = institution.status !== "ok";
  return (
    <Sheet as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="display text-lead">{institution.institutionName}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-small text-ink-3">
            {broken ? <Tag tone="canary">{institution.status === "needs_reauth" ? "Needs you to sign in again" : "Couldn’t update"}</Tag> : <Tag tone="mint">Connected</Tag>}
            <span suppressHydrationWarning>{now > 0 && since(institution.lastSyncedAt, now)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {broken && (
            <LinkBankButton institutionId={institution.id} size="sm">
              Sign in again
            </LinkBankButton>
          )}
          <Button size="sm" variant="danger" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
      {broken && institution.error && <p className="mt-3 rounded-control bg-canary px-3 py-2 text-small text-canary-ink">{institution.error}</p>}
      <ul className="mt-4 divide-y divide-line-soft border-t border-line-soft">
        {institution.accounts.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-4 py-2.5 last:pb-0">
            <span>
              <span className="font-medium">{a.name}</span>
              {a.mask && <span className="tabular text-ink-3"> ending {a.mask}</span>}
              <span className="block text-small text-ink-3">
                {ACCOUNT_TYPE_LABEL[a.type] ?? a.type}
                {a.creditLimit ? `, ${dollars(a.creditLimit)} limit` : ""}
                {a.aprPercent ? `, ${a.aprPercent}% APR` : ""}
              </span>
            </span>
            <span className="tabular whitespace-nowrap font-medium">
              {a.balance < 0 ? `${dollars(-a.balance)} owed` : dollars(a.balance)}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export default function AccountsPage() {
  const { data, error, mutate } = useApi<AccountsPayload>("/api/accounts", { refreshInterval: 30_000 });
  const { data: me } = useApi<Me>("/api/me");
  const [removing, setRemoving] = useState<LinkedInstitution | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const now = useNow(30_000);

  if (error && !data) return <ErrorNote message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-5">
        <Skeleton className="h-48 rounded-sheet" />
        <Skeleton className="h-48 rounded-sheet" />
      </div>
    );
  }

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await send("DELETE", `/api/institutions/${removing.id}`);
      setRemoving(null);
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Couldn’t remove it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Accounts" back={{ href: "/you", label: "You" }} lead="The banks, cards, lenders and brokerages feeding Passbook. Add as many as you have." action={<LinkBankButton />} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="grid grid-cols-1 gap-5">
          {data.institutions.length > 0 ? (
            data.institutions.map((i) => <Institution key={i.id} institution={i} now={now} onRemove={() => setRemoving(i)} />)
          ) : (
            <Sheet>
              <EmptyState title="Nothing linked yet" action={<LinkBankButton />}>
                Link your main checking account first. Transactions, bills and your monthly plan fill in from there.
              </EmptyState>
            </Sheet>
          )}
          <AppleCardSheet card={data.appleCard} demo={me?.demo ?? false} />
          {data.manual.length > 0 && (
            <Sheet>
              <SheetHeader title="Tracked by hand" hint="Update these on the Net worth screen." />
              <ul className="divide-y divide-line-soft">
                {data.manual.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <span className="font-medium">{a.name}</span>
                    <span className="tabular font-medium">{a.balance < 0 ? `${dollars(-a.balance)} owed` : dollars(a.balance)}</span>
                  </li>
                ))}
              </ul>
            </Sheet>
          )}
        </div>

        <Sheet className="bg-sunk">
          <h2 className="display text-lead">How linking works</h2>
          <dl className="mt-4 flex flex-col gap-4 text-small">
            <div>
              <dt className="font-medium">You sign in with your bank, not with us</dt>
              <dd className="mt-1 text-ink-2">Linking runs through Plaid. Your bank password goes to your bank and is never seen or stored by Passbook.</dd>
            </div>
            <div>
              <dt className="font-medium">Read-only access</dt>
              <dd className="mt-1 text-ink-2">Passbook can see balances, transactions and holdings. It cannot move money, pay bills or change anything at your bank.</dd>
            </div>
            <div>
              <dt className="font-medium">Updates arrive on their own</dt>
              <dd className="mt-1 text-ink-2">Your bank tells us when something new posts, usually within minutes for card charges and a few times a day for other accounts.</dd>
            </div>
            <div>
              <dt className="font-medium">Remove a bank any time</dt>
              <dd className="mt-1 text-ink-2">Removing a connection revokes access and deletes that bank’s accounts and history from Passbook.</dd>
            </div>
          </dl>
          {me?.bankLinking.sandbox && <p className="mt-4 rounded-control bg-canary px-3 py-2 text-small text-canary-ink">Test mode: Plaid’s practice banks only. Use the username user_good and password pass_good.</p>}
        </Sheet>
      </div>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.institutionName ?? ""}?`}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              Remove and delete its history
            </Button>
          </>
        }
      >
        <p className="text-ink-2">
          This disconnects {removing?.institutionName} and deletes its {removing?.accounts.length === 1 ? "account" : `${removing?.accounts.length ?? 0} accounts`} and all of their transactions from Passbook. Nothing changes at the bank itself.
        </p>
        {removeError && <div className="mt-3"><ErrorNote message={removeError} /></div>}
      </Dialog>
    </>
  );
}
