"use client";

import { useRef, useState } from "react";
import { formatShort } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { AccountsPayload, AppleCardImport, AppleCardPreview } from "@/lib/types";
import { XpTag } from "./game/level";
import { WINS } from "@/lib/game/progress";
import { CopyField, ago } from "./settings-sections";
import { Button, Dialog, Field, MoneyInput, Sheet, SheetHeader, Tag, confirm, toast } from "./ui";
import { send, useApi, useNow } from "./use-api";

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
      const undo = { label: "Undo", run: () => send("POST", "/api/import/apple-card/undo", { batch: done.batch, to: done.to, previousOwed: done.previousOwed, owed: done.owed, earned: done.earned, confirmed: done.confirmed, removed: done.removed }) };
      const count = done.added + done.confirmed.length;
      toast(count > 0 ? `Brought in ${plural(count, "Apple Card transaction", "Apple Card transactions")}` : "Apple Card balance updated", { action: undo });
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
            {plural(card.transactions, "transaction", "transactions")} so far{card.pendingTaps > 0 ? `, and ${plural(card.pendingTaps, "tap", "taps")} waiting for the statement to confirm ${card.pendingTaps === 1 ? "it" : "them"}` : ""}. Bring it up to date any time: export any dates at card.apple.com (Statements, Export Transactions, CSV), or a monthly statement from Wallet. Overlapping dates are fine.
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
          <p className="mt-2 text-small text-ink-3">Or any dates, any time: at card.apple.com, Statements, Export Transactions, CSV (on a laptop or in Safari).</p>
          {demo && <p className="mt-3 text-small text-ink-3">This is the sample household, so it tries a made-up statement instead of a file of yours.</p>}
          <Button className="mt-4" variant="primary" disabled={busy} onClick={pick}>
            {busy ? "Reading…" : demo ? "Try a sample statement" : "Choose a statement"}
            <XpTag xp={WINS.import.xp} />
          </Button>
        </>
      )}
      {error && <p className="mt-3 rounded-control bg-canary px-3 py-2 text-small text-canary-ink">{error}</p>}
      <AppleCardTaps demo={demo} />

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
              {(p.confirmedTaps > 0 || p.droppedTaps > 0) && (
                <p className="mt-1 text-small text-ink-2">
                  {p.confirmedTaps > 0 && `${plural(p.confirmedTaps, "tap-to-pay purchase", "tap-to-pay purchases")} confirmed. `}
                  {p.droppedTaps > 0 && `${plural(p.droppedTaps, "tap", "taps")} the statement doesn’t show (declined, or a tip changed the amount) ${p.droppedTaps === 1 ? "is" : "are"} replaced by what it does show.`}
                </p>
              )}
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

type TapStatus = { on: boolean; createdAt: string | null; lastUsedAt: string | null; demo: boolean };

/**
 * Automatic Apple Card purchases: an iPhone Shortcuts automation sends each tap at a register to a
 * private link, and the purchase shows up at once, pending until a statement confirms it. The link is
 * shown once, with the steps to set it up.
 */
function AppleCardTaps({ demo }: { demo: boolean }) {
  const { data } = useApi<TapStatus>("/api/tap-link");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong. Try again.", { tone: "error" });

  const make = async () => {
    setBusy(true);
    try {
      setKey((await send<{ key: string }>("POST", "/api/tap-link")).key);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const renew = async () => {
    if (await confirm({ title: "Make a new tap link?", body: "The link in your Shortcuts automation stops working until you paste the new one in. Only do this if taps stopped arriving, or the link got out.", confirmLabel: "Make new link" })) void make();
  };
  const off = async () => {
    if (!(await confirm({ title: "Turn off automatic taps?", body: "Taps stop showing up right away. Your statements still bring every purchase in. You can delete the automation in Shortcuts too.", confirmLabel: "Turn off", danger: true }))) return;
    await send("DELETE", "/api/tap-link").then(() => toast("Automatic taps turned off"), fail);
  };
  const test = async () => {
    setBusy(true);
    try {
      await send("POST", "/api/tap-link/test", { amount: 6.5, merchant: "Soft Serve Co" });
      toast("Tap received: Soft Serve Co, $6.50. It’s in your latest activity as pending.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  return (
    <div className="mt-5 border-t border-line-soft pt-4">
      <h3 className="font-bold">Automatic: tap-to-pay purchases</h3>
      {data.demo || demo ? (
        <>
          <p className="mt-1 text-small text-ink-2">In your own account, your iPhone tells Passbook each time you tap Apple Card at a register, so purchases show up in seconds. Here’s what one looks like.</p>
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => void test()}>
            Send a test tap
          </Button>
        </>
      ) : data.on ? (
        <>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-small text-ink-2">
            <Tag tone="mint">On</Tag>
            <span suppressHydrationWarning>{data.lastUsedAt ? `Last tap ${ago(data.lastUsedAt, now)}` : "Waiting for your first tap"}</span>
          </p>
          <p className="mt-2 text-small text-ink-3">Taps show as pending until a statement confirms them. Online purchases come in with the statement. The link switches itself off after 6 months unused.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void renew()}>
              Make a new link
            </Button>
            <Button size="sm" variant="danger" onClick={() => void off()}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-small text-ink-2">Each time you tap Apple Card at a register, your iPhone can tell Passbook right away, so it shows up in seconds instead of at the end of the month. It takes about 5 minutes to set up in the Shortcuts app, once.</p>
          <Button className="mt-3" size="sm" variant="primary" disabled={busy} onClick={() => void make()}>
            Set it up
          </Button>
        </>
      )}

      <Dialog open={key !== null} onClose={() => setKey(null)} title="Set up automatic taps" footer={<Button variant="primary" className="w-full" onClick={() => setKey(null)}>I’ve set it up</Button>}>
        {key && (
          <div className="flex flex-col gap-3 text-small text-ink-2">
            <p className="rounded-control bg-canary px-3.5 py-2.5 text-canary-ink">This private link can only add Apple Card purchases to your Passbook. Keep it to yourself. It’s shown this once, so copy it now.</p>
            <ol className="flex list-decimal flex-col gap-2.5 pl-5">
              <li>
                Copy your link:
                <CopyField value={`${origin}/api/tap/${key}`} label="Tap link" />
              </li>
              <li>
                Open the <span className="font-bold text-ink">Shortcuts</span> app, tap <span className="font-bold text-ink">Automation</span> at the bottom, then <span className="font-bold text-ink">+</span>.
              </li>
              <li>
                Choose <span className="font-bold text-ink">Transaction</span>. Pick only <span className="font-bold text-ink">Apple Card</span>, leave the rest as it is, choose <span className="font-bold text-ink">Run Immediately</span>, and tap Next.
              </li>
              <li>
                Tap <span className="font-bold text-ink">New Blank Automation</span>, then <span className="font-bold text-ink">Add Action</span>, and search for <span className="font-bold text-ink">Get Contents of URL</span>.
              </li>
              <li>
                Tap <span className="font-bold text-ink">URL</span> and paste your link. Tap the arrow beside it to show more: set <span className="font-bold text-ink">Method</span> to POST and <span className="font-bold text-ink">Request Body</span> to JSON.
              </li>
              <li>
                Tap <span className="font-bold text-ink">Add new field</span>, choose Text, type <span className="font-bold text-ink">amount</span> as the key, then tap the value and choose <span className="font-bold text-ink">Shortcut Input</span>, then <span className="font-bold text-ink">Amount</span>. Add a second field the same way: key <span className="font-bold text-ink">merchant</span>, value Shortcut Input, then <span className="font-bold text-ink">Merchant</span>.
              </li>
              <li>Tap Done. The next time you tap Apple Card, it shows up in Passbook within seconds, marked pending. (To stop the banner each time, switch off Notify When Run in the automation.)</li>
            </ol>
          </div>
        )}
      </Dialog>
    </div>
  );
}
