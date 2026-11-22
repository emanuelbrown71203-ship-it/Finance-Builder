"use client";

import { LevelBlock } from "./game/level";
import { nickelReact } from "./nickel/store";
import { useEffect, useSyncExternalStore } from "react";

/*
 * A little celebration for the moments worth one: a savings goal reached, a
 * debt cleared. Confetti falls for a few seconds behind a card; tap anywhere
 * to close. It can be switched off in Settings, and with "reduce motion" on
 * the card shows without the confetti.
 */

const KEY = "passbook-celebrations";
const EVENT = "passbook-celebrations-change";
const COLORS = ["#08835a", "#2459d6", "#ffd84d", "#cf2f5b", "#8a3fc7", "#0b7c8a", "#eb6834"];

type Party = { title: string; body: string; level?: number } | null;
let current: Party = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function celebrationsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setCelebrations(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** For the Settings switch. */
export function useCelebrations(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener(EVENT, l);
      return () => window.removeEventListener(EVENT, l);
    },
    celebrationsOn,
    () => true,
  );
}

/** `level` shows the new level's pixel block instead of the party popper (a level up). */
export function celebrate(title: string, body: string, options?: { level?: number }) {
  nickelReact({ type: "celebrate" });
  if (!celebrationsOn()) return;
  current = { title, body, level: options?.level };
  emit();
}

const close = () => {
  current = null;
  emit();
};

// Fixed "random" spread so the pieces don't jump when the screen redraws.
const PIECES = Array.from({ length: 60 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 100) / 100,
  duration: 2.2 + ((i * 29) % 100) / 70,
  size: 7 + ((i * 17) % 7),
  color: COLORS[i % COLORS.length],
  spin: (i % 2 ? 1 : -1) * (360 + ((i * 71) % 360)),
  round: i % 3 === 0,
}));

export function Celebrations() {
  const party = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
  useEffect(() => {
    if (!party) return;
    const timer = setTimeout(close, 4200);
    return () => clearTimeout(timer);
  }, [party]);
  if (!party) return null;
  return (
    <div role="status" onClick={close} className="fixed inset-0 z-[70] grid cursor-pointer place-items-center overflow-hidden bg-[rgb(13_18_32/0.35)] px-6">
      <div aria-hidden className="confetti pointer-events-none absolute inset-0">
        {PIECES.map((p, i) => (
          <span key={i} style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? "50%" : 2, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, ["--spin" as string]: `${p.spin}deg` }} />
        ))}
      </div>
      <div className="party-card relative max-w-sm rounded-[26px] bg-sheet px-7 py-8 text-center shadow-float">
        {party.level ? (
          <span className="flex flex-col items-center gap-3">
            <span className="pixel text-micro text-accent-text">LEVEL UP</span>
            <LevelBlock level={party.level} size={72} fresh />
          </span>
        ) : (
          <p aria-hidden className="text-[3rem] leading-none">🎉</p>
        )}
        <h2 className="display mt-3 text-title">{party.title}</h2>
        <p className="mt-2 text-ink-2">{party.body}</p>
        <p className="mt-4 text-small text-ink-3">Tap anywhere to close</p>
      </div>
    </div>
  );
}
