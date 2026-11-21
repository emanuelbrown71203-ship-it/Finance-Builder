"use client";

import { useSyncExternalStore } from "react";

/*
 * Nickel's settings and memory, kept on this device only (like the light/dark
 * choice): whether he's shown, his name, whether he speaks up on his own,
 * where he sits, naps, and which tips he has already said today.
 */

const KEY = {
  on: "passbook-nickel-on",
  name: "passbook-nickel-name",
  chatty: "passbook-nickel-chatty",
  pos: "passbook-nickel-pos",
  nap: "passbook-nickel-nap",
  intro: "passbook-nickel-intro",
  seen: "passbook-nickel-seen",
} as const;

const EVENT = "passbook-nickel-change";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export type NickelSettings = { on: boolean; name: string; chatty: boolean; napUntil: number; introDone: boolean; side: "left" | "right"; lift: number };

const DEFAULTS: NickelSettings = { on: true, name: "Nickel", chatty: true, napUntil: 0, introDone: false, side: "right", lift: 0 };

let cached: { raw: string; value: NickelSettings } | null = null;

function snapshot(): NickelSettings {
  const raw = [KEY.on, KEY.name, KEY.chatty, KEY.nap, KEY.intro, KEY.pos].map(read).join("\u0000");
  if (cached?.raw === raw) return cached.value;
  let pos: { side?: string; lift?: number } = {};
  try {
    pos = JSON.parse(read(KEY.pos) ?? "{}");
  } catch {}
  const value: NickelSettings = {
    on: read(KEY.on) !== "0",
    name: (read(KEY.name) ?? "").trim().slice(0, 20) || DEFAULTS.name,
    chatty: read(KEY.chatty) !== "0",
    napUntil: Number(read(KEY.nap) ?? 0) || 0,
    introDone: read(KEY.intro) === "1",
    side: pos.side === "left" ? "left" : "right",
    lift: Math.max(0, Math.min(600, Number(pos.lift) || 0)),
  };
  cached = { raw, value };
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useNickelSettings(): NickelSettings {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
}

export const nickelSettings = {
  setOn: (on: boolean) => write(KEY.on, on ? null : "0"),
  setName: (name: string) => write(KEY.name, name.trim() ? name.trim().slice(0, 20) : null),
  setChatty: (chatty: boolean) => write(KEY.chatty, chatty ? null : "0"),
  napFor: (ms: number) => write(KEY.nap, String(Date.now() + ms)),
  wake: () => write(KEY.nap, null),
  finishIntro: () => write(KEY.intro, "1"),
  setPlace: (side: "left" | "right", lift: number) => write(KEY.pos, JSON.stringify({ side, lift: Math.round(lift) })),
};

/** Tips already said today, so he doesn't repeat himself. */
export function seenToday(today: string): Set<string> {
  try {
    const parsed = JSON.parse(read(KEY.seen) ?? "{}") as { date?: string; ids?: string[] };
    return new Set(parsed.date === today ? (parsed.ids ?? []) : []);
  } catch {
    return new Set();
  }
}

export function markSeen(today: string, id: string) {
  const ids = seenToday(today);
  ids.add(id);
  try {
    localStorage.setItem(KEY.seen, JSON.stringify({ date: today, ids: [...ids].slice(-100) }));
  } catch {}
}

/** Things happening elsewhere in the app that Nickel reacts to. */
export type NickelEvent = { type: "deposit"; amount: number; goal: string } | { type: "celebrate" } | { type: "refreshed" };

export function nickelReact(event: NickelEvent) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<NickelEvent>("passbook-nickel-react", { detail: event }));
}
