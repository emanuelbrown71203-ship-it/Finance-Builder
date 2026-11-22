"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Check, Copy, Fingerprint, X } from "lucide-react";
import { useState } from "react";
import { category } from "@/lib/categories";
import type { TasksLinkStatus } from "@/server/tasks-link";
import { setCelebrations, useCelebrations } from "./celebrate";
import { setSounds, useSounds } from "./game/sounds";
import { RoboDog } from "./nickel/robo-dog";
import { nickelSettings, useNickelSettings } from "./nickel/store";
import { Button, ErrorNote, Field, Fold, Input, Select, Sheet, SheetHeader, Tag, confirm, cx, toast } from "./ui";
import { send, useApi, useNow } from "./use-api";

const fail = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong. Try again.", { tone: "error" });

function ago(iso: string | null, now: number): string {
  if (!iso || !now) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** An on/off switch, sized like the one on an iPhone. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cx("relative h-[31px] w-[51px] shrink-0 rounded-[9px] transition-colors after:absolute after:-inset-2", checked ? "bg-accent" : "bg-line")}>
      <span className={cx("absolute left-0.5 top-0.5 size-[27px] rounded-[7px] bg-[var(--bright)] shadow transition-transform", checked && "translate-x-5")} />
    </button>
  );
}

/** A value to copy, with a button that says when it has been. */
function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn’t copy. Press and hold the link to copy it instead.", { tone: "error" });
    }
  };
  return (
    <div className="mt-1.5 flex gap-2">
      <Input readOnly aria-label={label} value={value} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 text-small" data-no-pull />
      <Button onClick={copy} className="px-4">
        {copied ? <Check size={17} /> : <Copy size={17} />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function CelebrationsRow() {
  const on = useCelebrations();
  return (
    <div className="mt-4 flex min-h-12 items-center justify-between gap-4 border-t border-line-soft pt-3">
      <div>
        <p className="font-bold">Celebrations</p>
        <p className="text-small text-ink-3">A little confetti when you reach a savings goal or a new level.</p>
      </div>
      <Switch checked={on} onChange={setCelebrations} label="Celebrations" />
    </div>
  );
}

export function SoundsRow() {
  const on = useSounds();
  return (
    <div className="mt-4 flex min-h-12 items-center justify-between gap-4 border-t border-line-soft pt-3">
      <div>
        <p className="font-bold">Game sounds</p>
        <p className="text-small text-ink-3">8-bit blips when you earn XP or a badge. Quiet when your phone is on silent.</p>
      </div>
      <Switch checked={on} onChange={setSounds} label="Game sounds" />
    </div>
  );
}

/* ---------- Face ID sign-in ---------- */

type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

export function PasskeySection({ demo }: { demo: boolean }) {
  const { data } = useApi<{ passkeys: Passkey[] }>(demo ? null : "/api/auth/passkeys");
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);

  const add = async () => {
    if (!browserSupportsWebAuthn()) return toast("This browser can’t do that. Try Safari or Chrome, up to date.", { tone: "error" });
    setBusy(true);
    try {
      const optionsJSON = await send<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/api/auth/passkey/register-options");
      const response = await startRegistration({ optionsJSON });
      await send("POST", "/api/auth/passkey/register", response);
      toast("Done. Next time, sign in with your face or fingerprint.");
    } catch (e) {
      // Closing the Face ID prompt isn't an error worth shouting about.
      if (e instanceof Error && e.name === "NotAllowedError") toast("Cancelled. Nothing was changed.");
      else if (e instanceof Error && e.name === "InvalidStateError") toast("This device is already set up.");
      else fail(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (key: Passkey) => {
    if (!(await confirm({ title: `Remove ${key.name}?`, body: "That device will need your password to sign in again.", confirmLabel: "Remove", danger: true }))) return;
    await send("DELETE", `/api/auth/passkeys/${encodeURIComponent(key.id)}`).then(() => toast(`${key.name} removed`), fail);
  };

  return (
    <Sheet>
      <SheetHeader title="Sign in with Face ID" hint="Use your face or fingerprint instead of a password. It’s quicker, and it can’t be tricked by a fake website." />
      {demo ? (
        <p className="text-ink-2">This comes with your own account. The sample household has nothing to sign in to.</p>
      ) : (
        <>
          {data && data.passkeys.length > 0 && (
            <ul className="mb-3 divide-y divide-line-soft border-y border-line-soft">
              {data.passkeys.map((key) => (
                <li key={key.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <span>
                    <span className="block font-bold">{key.name}</span>
                    <span className="block text-small text-ink-3" suppressHydrationWarning>
                      {key.lastUsedAt ? `Last used ${ago(key.lastUsedAt, now)}` : `Added ${ago(key.createdAt, now)}`}
                    </span>
                  </span>
                  <Button size="sm" variant="danger" onClick={() => remove(key)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button className="w-full" variant={data?.passkeys.length ? "quiet" : "primary"} onClick={add} disabled={busy}>
            <Fingerprint size={18} /> {data?.passkeys.length ? "Set up another device" : "Set up on this device"}
          </Button>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Connect to Claude ---------- */

type ConnectorStatus = { connected: boolean; createdAt: string | null; lastUsedAt: string | null; sampleKey: string | null };

export function ClaudeSection() {
  const { data } = useApi<ConnectorStatus>("/api/connector");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const shownKey = key ?? data?.sampleKey ?? null;

  const connect = async () => {
    setBusy(true);
    try {
      setKey((await send<{ key: string }>("POST", "/api/connector")).key);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const renew = async () => {
    if (await confirm({ title: "Make a new link?", body: "The link you added to Claude stops working until you replace it there. Only do this if Claude can’t connect, or the link got out.", confirmLabel: "Make new link" })) void connect();
  };
  const disconnect = async () => {
    if (!(await confirm({ title: "Disconnect Claude?", body: "It won’t be able to see your money anymore.", confirmLabel: "Disconnect", danger: true }))) return;
    await send("DELETE", "/api/connector").then(() => (setKey(null), toast("Claude disconnected")), fail);
  };

  return (
    <Sheet id="claude" className="scroll-mt-24">
      <SheetHeader title="Ask Claude about your money" hint="“How much did we spend eating out last month?” Claude answers from your real numbers, on your own Claude plan. When you ask, it can also add bills and goals, change a loan’s details or rename charges; each change shows under Activity with Undo. It can’t delete anything or move money. Once it’s set up, hold Nickel and pick “Chat with Claude”." />
      {!data ? null : shownKey ? (
        <div className="text-ink-2">
          {data.sampleKey ? (
            <p className="mb-3 rounded-2xl bg-canary px-3.5 py-2.5 text-small text-canary-ink">This try-it link reads the sample household. Your own private link comes with your account.</p>
          ) : (
            <p className="mb-3 rounded-2xl bg-canary px-3.5 py-2.5 text-small text-canary-ink">
              This private link lets Claude see <span className="font-bold">your</span> accounts. Treat it like a password: anyone who has it can read your money. It’s shown this once, so copy it now.
            </p>
          )}
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Copy your link:
              <CopyField value={`${origin}/api/mcp/${shownKey}`} label="Connector link" />
            </li>
            <li>
              Open <span className="font-bold text-ink">claude.ai</span> in a browser and go to <span className="font-bold text-ink">Settings, then Connectors</span>.
            </li>
            <li>
              Tap <span className="font-bold text-ink">Add custom connector</span>, name it <span className="font-bold text-ink">Passbook</span>, paste the link, and tap Add.
            </li>
            <li>That’s it. It also works in the Claude app on your phone. In a chat, make sure Passbook is switched on in the tools menu. Claude asks you before it changes anything.</li>
          </ol>
          {key && (
            <Button className="mt-4 w-full" onClick={() => setKey(null)}>
              I’ve added it
            </Button>
          )}
        </div>
      ) : data.connected ? (
        <>
          <p className="flex items-start gap-2 rounded-2xl bg-mint px-3.5 py-3 text-mint-ink">
            <Check size={19} className="mt-0.5 shrink-0" />
            <span suppressHydrationWarning>Claude is connected{data.lastUsedAt ? `, last used ${ago(data.lastUsedAt, now)}` : " (not used yet)"}. Nothing else to do here: just ask Claude in a chat. The link switches itself off if it isn’t used for 90 days.</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={renew} disabled={busy}>
              Make a new link
            </Button>
            <Button size="sm" variant="danger" onClick={disconnect}>
              Disconnect Claude
            </Button>
          </div>
        </>
      ) : (
        <Button className="w-full" variant="primary" onClick={connect} disabled={busy}>
          Connect to Claude
        </Button>
      )}
    </Sheet>
  );
}

/* ---------- Tasks for Two ---------- */

export function TasksSection() {
  const { data, error, mutate } = useApi<TasksLinkStatus>("/api/tasks-link");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const now = useNow(60_000);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await send("POST", "/api/tasks-link", { url });
      setUrl("");
      toast("Tasks for Two connected");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn’t connect. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const link = (bill: TasksLinkStatus["bills"][number], merchant: string | null) => send("PUT", "/api/tasks-link/bills", { billId: bill.id, billName: bill.name, merchant }).catch(fail);
  const check = async () => {
    setBusy(true);
    try {
      toast((await send<{ message: string }>("POST", "/api/tasks-link/check")).message);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!(await confirm({ title: "Disconnect Tasks for Two?", body: "Bills there stop being ticked off on their own. Nothing in Tasks for Two is deleted.", confirmLabel: "Disconnect", danger: true }))) return;
    await send("DELETE", "/api/tasks-link").then(() => toast("Tasks for Two disconnected"), fail);
  };

  return (
    <Sheet>
      <SheetHeader title="Tasks for Two bills" hint="When your bank shows a bill was paid, the same bill is ticked off in Tasks for Two for you." />
      {error && !data ? (
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      ) : !data ? null : !data.available ? (
        <p className="text-ink-2">This switches on once your real bank is linked. Sample and practice data never touch your real bills.</p>
      ) : !data.connected ? (
        <form onSubmit={connect} className="flex flex-col gap-3">
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>In Tasks for Two, open Settings, then Connect to Claude.</li>
            <li>Tap “Make a new link” and copy it.</li>
            <li>Paste it here. If Claude uses Tasks for Two too, paste the same new link there.</li>
          </ol>
          <Field label="Your Tasks for Two link" error={formError}>
            {(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…supabase.co/functions/v1/pa-mcp/…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />}
          </Field>
          <Button variant="primary" type="submit" disabled={busy || url.trim().length < 20}>
            Connect
          </Button>
        </form>
      ) : (
        <>
          {data.lastMessage && <p className="mb-3 rounded-2xl bg-sunk px-3.5 py-2.5 text-small text-ink-2" suppressHydrationWarning>{data.lastMessage}{data.lastCheckedAt ? ` Checked ${ago(data.lastCheckedAt, now)}.` : ""}</p>}
          {data.bills.length === 0 ? (
            <p className="text-ink-2">No bills in Tasks for Two yet. Add some there and they show up here.</p>
          ) : (
            <>
              <p className="mb-2 text-small text-ink-3">For each bill, pick who it’s paid to at the bank. A bill is only ticked off when a payment to that exact place shows up near its due date.</p>
              <ul className="flex flex-col gap-3">
                {data.bills.map((bill) => (
                  <li key={bill.id}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-bold">{bill.name}</span>
                      {bill.merchant ? <Tag tone="mint">Linked</Tag> : bill.suggested ? <Tag tone="canary">Is this right?</Tag> : null}
                    </div>
                    <div className="flex gap-2">
                      <Select aria-label={`Who ${bill.name} is paid to`} value={bill.merchant ?? ""} onChange={(e) => link(bill, e.target.value || null)} className="min-w-0 flex-1">
                        <option value="">Not linked</option>
                        {data.merchants.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                      {!bill.merchant && bill.suggested && (
                        <Button onClick={() => link(bill, bill.suggested)} className="px-3.5">
                          Use {data.merchants.find((m) => m.key === bill.suggested)?.name ?? "suggestion"}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.recent.length > 0 && (
            <Fold title="Ticked off lately" summary={`${data.recent.length}`} className="mt-3 border-t border-line-soft">
              <ul className="pb-2 text-small text-ink-2">
                {data.recent.map((t) => (
                  <li key={`${t.billName}-${t.dueDate}`} className="flex justify-between gap-3 py-1">
                    <span>{t.billName}, due {t.dueDate}</span>
                    <span className="tabular">${(t.amount / 100).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </Fold>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={check} disabled={busy}>
              Check now
            </Button>
            <Button size="sm" variant="danger" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Remembered categories ---------- */

export function RulesSection() {
  const { data } = useApi<{ rules: { id: string; merchant: string; category: string }[] }>("/api/rules");
  if (!data || data.rules.length === 0) return null;
  const forget = (rule: { id: string; merchant: string }) => send("DELETE", `/api/rules/${rule.id}`).then(() => toast(`Stopped sorting ${rule.merchant} on its own`), fail);
  return (
    <Sheet>
      <SheetHeader title="Remembered categories" hint="Places you’ve told Passbook to always sort the same way." />
      <Fold title={`${data.rules.length} ${data.rules.length === 1 ? "place" : "places"}`} summary="Show" className="border-t border-line-soft">
        <ul className="divide-y divide-line-soft">
          {data.rules.map((rule) => (
            <li key={rule.id} className="flex min-h-14 items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate font-bold capitalize">{rule.merchant}</span>
                <span className="block text-small text-ink-3">Always {category(rule.category).label}</span>
              </span>
              <button type="button" aria-label={`Stop remembering ${rule.merchant}`} onClick={() => forget(rule)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3 active:bg-sunk">
                <X size={18} />
              </button>
            </li>
          ))}
        </ul>
      </Fold>
    </Sheet>
  );
}

/* ---------- Nickel ---------- */

export function NickelSection() {
  const settings = useNickelSettings();
  const now = useNow(30_000);
  const napping = now > 0 && settings.napUntil > now;
  return (
    <Sheet id="nickel" className="scroll-mt-24">
      <div className="flex items-start gap-3">
        <span aria-hidden className="shrink-0">
          <RoboDog eyes="happy" mouth="smile" antenna="var(--good)" cheeks tongue gaze={{ x: 0, y: 0 }} size={56} />
        </span>
        <SheetHeader title={`${settings.name}, your robo dog`} hint="He sits in the corner, notices things in your numbers and tells you about them. Tap him to hear what he’s found. Hold him and pick “Talk to me” to talk or type: ask what’s left, what’s due or “can I afford…?”, or tell him to add a bill or a goal. He gives straight answers and sticks to them. He wanders about, and cheers when you get little money jobs done. Drag him if he’s in the way." />
      </div>
      <div className="divide-y divide-line-soft border-y border-line-soft">
        <div className="flex min-h-14 items-center justify-between gap-4 py-2">
          <div>
            <p className="font-bold">Show {settings.name}</p>
            <p className="text-small text-ink-3">On this device.</p>
          </div>
          <Switch checked={settings.on} onChange={nickelSettings.setOn} label={`Show ${settings.name}`} />
        </div>
        <div className="flex min-h-14 items-center justify-between gap-4 py-2">
          <div>
            <p className="font-bold">Speaks up on his own</p>
            <p className="text-small text-ink-3">Off: he only talks when you tap him.</p>
          </div>
          <Switch checked={settings.chatty} onChange={nickelSettings.setChatty} label="Speaks up on his own" />
        </div>
        <div className="flex min-h-14 items-center justify-between gap-4 py-2">
          <div>
            <p className="font-bold">Wanders around</p>
            <p className="text-small text-ink-3">Now and then he trots to a new spot along the bottom. Off: he stays put.</p>
          </div>
          <Switch checked={settings.roams} onChange={nickelSettings.setRoams} label="Wanders around" />
        </div>
        <div className="flex min-h-14 items-center justify-between gap-4 py-2">
          <div>
            <p className="font-bold">Answers out loud</p>
            <p className="text-small text-ink-3">When you talk to him with the mic, he talks back. Listening uses your phone’s own speech recognition (Apple’s on an iPhone, Google’s in Chrome), and he speaks with a voice on the device. No AI chat service, no cost.</p>
          </div>
          <Switch checked={settings.talksBack} onChange={nickelSettings.setTalksBack} label="Answers out loud" />
        </div>
        <NickelName key={settings.name} current={settings.name} />
      </div>
      {napping && (
        <Button className="mt-3 w-full" onClick={nickelSettings.wake}>
          Wake {settings.name} up
        </Button>
      )}
      <p className="mt-3 text-small text-ink-3">{settings.name} is a robot dog, not a financial advisor. He points out what’s in your own numbers; what you do about it is up to you. He reads only what Passbook already shows you, and sends it nowhere.</p>
    </Sheet>
  );
}

/** Keyed by the saved name, so the box starts from it once this device's settings are read. */
function NickelName({ current }: { current: string }) {
  const [name, setName] = useState(current);
  return (
    <form
      className="flex flex-wrap items-end gap-2 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        nickelSettings.setName(name);
        toast(name.trim() ? `He’s ${name.trim()} now. Good name!` : "Back to Nickel");
      }}
    >
      <div className="min-w-0 flex-1">
        <Field label="His name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Nickel" />}</Field>
      </div>
      <Button type="submit" disabled={name.trim() === current}>
        Rename
      </Button>
    </form>
  );
}
