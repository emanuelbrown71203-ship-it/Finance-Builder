"use client";

import { useRef, useState } from "react";
import { formatShort } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { AccountsPayload, AppleCardImport, AppleCardPreview } from "@/lib/types";
import { XpTag } from "./game/level";
import { WINS } from "@/lib/game/progress";
import { Button, Dialog, Field, MoneyInput, Sheet, SheetHeader, Tag, confirm, toast } from "./ui";
import { send } from "./use-api";

/*
 * Apple Card on the Accounts screen. Apple doesn't let websites link Apple
 * Card, so once a month the person exports the statement from Wallet (as CSV)
 * and picks the file here. Passbook shows what's in it and what's new before
 * anything is saved, asks what the card owes now (Wallet shows it), and brings
 * it in with Undo. In the sample household there's no file to pick: it tries a
 * made-up statement, so nobody's real purchases land in the shared sample.
 */

/** Statement files are small; a file bigger than this is something else (or years of history). */
const MAX_FILE = 230_000;
const FILES = ".csv,text/csv,text/comma-separated-values";

function centsFrom(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function AppleCardSheet({ card, demo }: { card: AccountsPayload["appleCard"]; demo: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ text: string; preview: AppleCardPreview } | null>(null);
  const [owed, setOwed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owedError, setOwedError] = useState<string | null>(null);

  const look = async (text: string) => {
    setBusy(true);
    try {
      const preview = await send<AppleCardPreview>("POST", "/api/import/apple-card", { text, preview: true });
      setPicked({ text, preview });
      setOwed(preview.suggestedOwed === null ? "" : (preview.suggestedOwed / 100).toFixed(2));
      setOwedError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t read that file. Try exporting it again.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE) {
      setError("That file is too big for one statement. In Wallet, export one month at a time.");
      return;
    }
    await look(await file.text());
  };

  // The sample household tries a made-up statement instead of a file (the server uses it either way).
  const pick = () => (demo ? void look("sample") : input.current?.click());

  const bringIn = async () => {
    if (!picked) return;
    const cents = centsFrom(owed);
    if (cents === null) {
      setOwedError("Type what the card owes, like 612.34.");
      return;
    }
    setBusy(true);
    try {
      const done = await send<AppleCardImport>("POST", "/api/import/apple-card", { text: picked.text, owed: cents });
      setPicked(null);
      const undo = { label: "Undo", run: () => send("POST", "/api/import/apple-card/undo", { batch: done.batch, to: done.to, previousOwed: done.previousOwed, owed: done.owed, earned: done.earned }) };
      toast(done.added > 0 ? `Brought in ${plural(done.added, "Apple Card transaction", "Apple Card transactions")}` : "Apple Card balance updated", { action: undo });
    } catch (e) {
      setOwedError(e instanceof Error ? e.message : "Couldn’t bring it in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!card) return;
    const ok = await confirm({
      title: "Remove Apple Card?",
      body: "This takes Apple Card and everything brought in from its statements out of Passbook. Your card itself isn’t affected, and you can bring statements in again any time.",
      confirmLabel: "Remove Apple Card",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/accounts/${card.accountId}`);
      toast("Apple Card removed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t remove it. Try again.", { tone: "error" });
    }
  };

  const p = picked?.preview;
  return (
    <Sheet as="article">
      <input ref={input} type="file" accept={FILES} className="hidden" aria-hidden tabIndex={-1} onChange={(e) => void choose(e.target.files?.[0])} />
      {card ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="display text-lead">Apple Card</h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-small text-ink-3">
                <Tag tone="sky">From statements</Tag>
                <span>{card.lastDate ? `Up to ${formatShort(card.lastDate)}` : "No purchases yet"}</span>
              </p>
            </div>
            <span className="tabular whitespace-nowrap font-medium">{dollars(card.owed)} owed</span>
          </div>
          <p className="mt-3 text-small text-ink-2">
            {plural(card.transactions, "transaction", "transactions")} so far. Each month, once your statement arrives: Wallet, Apple Card, Card Balance, the statement, Export Transactions, CSV.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={pick}>
              {busy ? "Reading…" : demo ? "Try a sample statement" : "Bring in a statement"}
              <XpTag xp={WINS.import.xp} />
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <SheetHeader title="Apple Card" hint="Apple doesn’t let websites link Apple Card, so bring it in from your statement instead. It takes a minute a month." />
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-small text-ink-2">
            <li>In the Wallet app, open Apple Card and tap Card Balance.</li>
            <li>Pick a monthly statement, tap Export Transactions and choose CSV.</li>
            <li>Save it to Files, then choose it here.</li>
          </ol>
          {demo && <p className="mt-3 text-small text-ink-3">This is the sample household, so it tries a made-up statement instead of a file of yours.</p>}
          <Button className="mt-4" variant="primary" disabled={busy} onClick={pick}>
            {busy ? "Reading…" : demo ? "Try a sample statement" : "Choose a statement"}
            <XpTag xp={WINS.import.xp} />
          </Button>
        </>
      )}
      {error && <p className="mt-3 rounded-control bg-canary px-3 py-2 text-small text-canary-ink">{error}</p>}

      <Dialog
        open={p !== undefined}
        onClose={() => setPicked(null)}
        title="Bring in Apple Card"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="primary" disabled={busy} onClick={() => void bringIn()}>
              {p && p.fresh > 0 ? `Bring in ${plural(p.fresh, "transaction", "transactions")}` : "Update what’s owed"}
              {p && p.fresh > 0 && <XpTag xp={WINS.import.xp} />}
            </Button>
            <Button variant="quiet" onClick={() => setPicked(null)}>
              Cancel
            </Button>
          </div>
        }
      >
        {p && (
          <div className="flex flex-col gap-4">
            <div className="rounded-control bg-sunk px-3.5 py-3">
              <p className="font-bold">
                {formatShort(p.from)} to {formatShort(p.to)}
              </p>
              <p className="mt-0.5 text-small text-ink-2">
                {p.fresh === 0
                  ? `All ${plural(p.total, "transaction", "transactions")} in this file are already in Passbook.`
                  : p.already > 0
                    ? `${plural(p.fresh, "new transaction", "new transactions")}. ${p.already} already in Passbook ${p.already === 1 ? "stays" : "stay"} as ${p.already === 1 ? "it is" : "they are"}.`
                    : `${plural(p.fresh, "transaction", "transactions")}, all new.`}
                {p.pending > 0 && ` ${plural(p.pending, "purchase hasn’t", "purchases haven’t")} cleared yet: ${p.pending === 1 ? "it comes" : "they come"} with the next statement.`}
              </p>
              {p.sample && <p className="mt-1 text-small text-ink-3">A made-up statement, because this is the sample household.</p>}
            </div>
            <Field label="What the card owes now" error={owedError} hint={p.suggestedOwed === null ? "The Card Balance on the Apple Card screen in Wallet." : "Worked out from the last balance and this statement. Check it against the Card Balance in Wallet."}>
              {(id) => <MoneyInput id={id} value={owed} placeholder="0.00" onChange={(e) => setOwed(e.target.value)} />}
            </Field>
            <p className="text-small text-ink-3">Purchases count in your budget like any other card. Paying Apple Card off is a transfer, so it never counts twice.</p>
          </div>
        )}
      </Dialog>
    </Sheet>
  );
}
