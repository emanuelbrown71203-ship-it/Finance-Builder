"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { NotifySettings, PushDevice } from "@/server/notifications";
import type { RecurringPayload, RecurringView } from "@/lib/types";
import { Switch, ago } from "./settings-sections";
import { Button, Fold, Sheet, SheetHeader, toast } from "./ui";
import { send, useApi, useNow } from "./use-api";

/*
 * Phone notifications in the browser: turning them on for this device (the phone asks first, and only
 * from a tap), the kinds wanted, and which bills to be told about. On an iPhone or iPad they work once
 * Passbook is on the home screen and opened from there.
 */

type PushInfo = { key: string; demo: boolean; devices: PushDevice[]; settings: NotifySettings };
type DeviceState = "loading" | "unsupported" | "home-screen" | "denied" | "off" | "on";

const fail = (e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong. Try again.", { tone: "error" });

function isAppleTouch(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function fromHomeScreen(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** What this device is called in the list of devices. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "This device";
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: string): boolean {
  const had = sub.options?.applicationServerKey;
  if (!had) return true;
  const a = new Uint8Array(had);
  const b = keyBytes(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** The same short fingerprint of a push address the server lists devices by. */
async function matchOf(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Stops notifications to this device (signing out). Quietly does nothing when they were never on. */
export async function forgetThisDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await send("DELETE", "/api/push", { endpoint });
  } catch {
    // Signing out carries on regardless.
  }
}

/**
 * A device's notifications end with its sign-in. When the person signs in again on a device that still
 * has them switched on, they're quietly put back (never one removed from the list on another device:
 * the server keeps that one off). Checked each time the app opens.
 */
export function PushKeeper() {
  useEffect(() => {
    if (!supported() || Notification.permission !== "granted") return;
    let stop = false;
    const timer = setTimeout(async () => {
      try {
        const sub = await currentSubscription();
        if (!sub || stop) return;
        const res = await fetch("/api/push", { headers: { accept: "application/json" } });
        if (!res.ok) return;
        const info = (await res.json()) as PushInfo;
        // Made with an old key, it can't be sent to: Settings shows it off, to be switched on again there.
        if (info.demo || !sameKey(sub, info.key)) return;
        const match = await matchOf(sub.endpoint);
        if (!info.devices.some((d) => d.match === match)) await send("POST", "/api/push", { subscription: sub.toJSON(), label: deviceLabel(), auto: true });
      } catch {
        // Tried again next time.
      }
    }, 4000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
}

/** This device's notifications: whether they're on, and switching them on or off. */
function usePushDevice(info: PushInfo | undefined) {
  const [state, setState] = useState<DeviceState>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported()) return setState(isAppleTouch() && !fromHomeScreen() ? "home-screen" : "unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const sub = await currentSubscription().catch(() => null);
    setEndpoint(sub?.endpoint ?? null);
    setState(sub && Notification.permission === "granted" ? "on" : "off");
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(first);
  }, [refresh]);

  // On in the browser but not on the server's list (removed, or its sign-in ended), or made with an old key:
  // shown as off, so switching it on sets it up afresh. (The sample household lists no devices to check.)
  const [listed, setListed] = useState(true);
  useEffect(() => {
    if (!info || state !== "on" || !endpoint) return;
    let stop = false;
    void (async () => {
      const sub = await currentSubscription().catch(() => null);
      const keyOk = !!sub && sameKey(sub, info.key);
      const match = await matchOf(endpoint);
      const known = info.demo || info.devices.some((d) => d.match === match);
      if (!stop) setListed(keyOk && known);
    })();
    return () => {
      stop = true;
    };
  }, [info, state, endpoint]);

  const turnOn = async (): Promise<boolean> => {
    if (!info) return false;
    // Asked straight from the tap: a phone only shows the question then.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      await refresh();
      if (permission === "denied") toast("Notifications are blocked for Passbook. You can allow them in your phone’s Settings.", { tone: "error" });
      return false;
    }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // One made with another key can't be sent to: start over.
    if (sub && !sameKey(sub, info.key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.key) });
    await send("POST", "/api/push", { subscription: sub.toJSON(), label: deviceLabel() });
    await refresh();
    return true;
  };

  const turnOff = async () => {
    await forgetThisDevice();
    await refresh();
  };

  return { state: state === "on" && !listed ? "off" : state, endpoint, turnOn, turnOff };
}

function Row({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-t border-line-soft py-3">
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <p className="text-small text-ink-3">{detail}</p>
      </div>
      {children}
    </div>
  );
}

const noSubscribe = () => () => {};

const followable = (s: RecurringView) => s.kind !== "income" && s.active && !s.cancelled;

/** Settings › Notifications. */
export function NotificationsSection() {
  const { data: info, mutate } = useApi<PushInfo>("/api/push");
  const { data: recurring } = useApi<RecurringPayload>("/api/recurring");
  const device = usePushDevice(info);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  // Worked out in the browser only: the page is first drawn on the server, which can't know the device.
  const label = useSyncExternalStore(
    noSubscribe,
    () => (deviceLabel() === "This device" ? "device" : deviceLabel()),
    () => "device",
  );

  const toggleDevice = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        if (await device.turnOn()) toast(`Notifications are on for this ${label}`);
      } else {
        await device.turnOff();
        toast(`Notifications are off for this ${label}`);
      }
      await mutate();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const { sent } = await send<{ sent: number }>("POST", "/api/push/test", { endpoint: device.endpoint ?? undefined });
      toast(sent === 1 ? "Sent. It should pop up in a moment." : `Sent to ${sent} devices.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const setKind = async (patch: Partial<NotifySettings>) => {
    try {
      await send("PUT", "/api/push", patch);
    } catch (e) {
      fail(e);
    }
  };

  const follow = async (s: RecurringView, on: boolean) => {
    try {
      await send("PATCH", "/api/recurring", { key: s.key, notifyPaid: on });
    } catch (e) {
      fail(e);
    }
  };

  const removeOther = async (d: PushDevice) => {
    try {
      await send("DELETE", "/api/push", { id: d.id });
      toast(`${d.label} won’t get notifications now`);
    } catch (e) {
      fail(e);
    }
  };

  const bills = (recurring?.series ?? []).filter(followable).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "bill" ? -1 : 1));
  const following = bills.filter((s) => s.notifyPaid).length;
  const settings = info?.settings;
  const devices = info?.devices ?? [];

  return (
    <Sheet id="notifications" className="scroll-mt-4">
      <SheetHeader title="Notifications" hint="A tap on the shoulder when a bill you pick is paid, when money is short for one coming up, and on Monday mornings." />

      {device.state === "home-screen" && (
        <p className="mb-3 rounded-2xl bg-sunk px-3.5 py-3 text-small text-ink-2">On an iPhone or iPad, notifications work once Passbook is on your home screen. Add it (see “Use it like an app” below), open it from there, and turn them on here.</p>
      )}
      {device.state === "unsupported" && <p className="mb-3 rounded-2xl bg-sunk px-3.5 py-3 text-small text-ink-2">This browser can’t show notifications. Try Safari on an iPhone (from the home screen), or Chrome.</p>}
      {device.state === "denied" && (
        <p className="mb-3 rounded-2xl bg-sunk px-3.5 py-3 text-small text-ink-2">Notifications are blocked for Passbook on this {label}. Open your phone’s Settings, then Notifications, then Passbook, and allow them. Then come back here.</p>
      )}

      <Row title={`On this ${label}`} detail={device.state === "on" ? "On. Notes show on your lock screen, like a text." : "Off. Turn it on to choose what you hear about."}>
        <Switch checked={device.state === "on"} onChange={(on) => !busy && device.state !== "loading" && (device.state === "on" || device.state === "off") && void toggleDevice(on)} label={`Notifications on this ${label}`} />
      </Row>
      {device.state === "on" && (
        <div className="flex justify-end pb-3">
          <Button onClick={test} disabled={busy}>
            Send a test
          </Button>
        </div>
      )}

      <Fold title="Tell me when these are paid" summary={following ? `${following} on` : "None yet"} className="border-t border-line-soft">
        <p className="pb-1 text-small text-ink-3">A note once the bank shows the payment went through. You can also switch this on from a bill itself.</p>
        {recurring && bills.length === 0 && <p className="py-2 text-small text-ink-3">No bills found yet.</p>}
        <ul>
          {bills.map((s) => (
            <li key={s.key} className="flex min-h-12 items-center justify-between gap-3 border-t border-line-soft py-2 first:border-0">
              <span className="min-w-0">
                <span className="block truncate font-bold">{s.name}</span>
                <span className="block text-small text-ink-3">{s.kind === "bill" ? "Bill" : "Extra"}</span>
              </span>
              <Switch checked={s.notifyPaid} onChange={(on) => void follow(s, on)} label={`Tell me when ${s.name} is paid`} />
            </li>
          ))}
        </ul>
      </Fold>

      {settings && (
        <>
          <Row title="Not enough for a bill" detail="When checking has less than the bills it pays in the next 3 days.">
            <Switch checked={settings.lowBalance} onChange={(on) => void setKind({ lowBalance: on })} label="Not enough for a bill" />
          </Row>
          <Row title="Weekly review" detail="Monday mornings, when your review is ready.">
            <Switch checked={settings.weeklyReview} onChange={(on) => void setKind({ weeklyReview: on })} label="Weekly review" />
          </Row>
          <Row title="No-spend week" detail="The morning it starts, the last 7 days of the month.">
            <Switch checked={settings.noSpend} onChange={(on) => void setKind({ noSpend: on })} label="No-spend week" />
          </Row>
          <Row title="Show amounts" detail={settings.amounts ? "Notes show dollar amounts, on the lock screen too." : "Notes only say what happened. Open Passbook for the numbers."}>
            <Switch checked={settings.amounts} onChange={(on) => void setKind({ amounts: on })} label="Show amounts in notifications" />
          </Row>
        </>
      )}

      {devices.length > 0 && (
        <Fold title="Devices with notifications on" summary={String(devices.length)} className="border-t border-line-soft">
          <ul>
            {devices.map((d) => (
              <li key={d.id} className="flex min-h-12 items-center justify-between gap-3 border-t border-line-soft py-2 first:border-0">
                <span className="min-w-0">
                  <span className="block font-bold">{d.label}</span>
                  <span className="block text-small text-ink-3">{d.lastSentAt ? `Last note ${ago(d.lastSentAt, now)}` : `Turned on ${ago(d.createdAt, now)}`}</span>
                </span>
                <Button size="sm" onClick={() => void removeOther(d)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </Sheet>
  );
}

/** On a bill's sheet: "Tell me when it's paid". */
export function NotifyPaidRow({ series }: { series: RecurringView }) {
  const router = useRouter();
  const { data: info } = useApi<PushInfo>("/api/push");
  const [on, setOn] = useState(series.notifyPaid);

  const toggle = async (next: boolean) => {
    setOn(next);
    try {
      await send("PATCH", "/api/recurring", { key: series.key, notifyPaid: next });
      if (next && info && info.devices.length === 0) {
        toast("Saved. Turn on notifications in Settings to get it.", { action: { label: "Settings", run: () => router.push("/settings#notifications") } });
      } else {
        toast(next ? `You’ll get a note when ${series.name} is paid` : `No more notes for ${series.name}`);
      }
    } catch (e) {
      setOn(!next);
      fail(e);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-control border border-line-soft px-3.5 py-3">
      <div className="min-w-0">
        <p className="font-bold">Tell me when it’s paid</p>
        <p className="text-small text-ink-3">A note on your phone once the bank shows it went through.</p>
      </div>
      <Switch checked={on} onChange={(next) => void toggle(next)} label={`Tell me when ${series.name} is paid`} />
    </div>
  );
}
