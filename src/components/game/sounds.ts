"use client";

import { useSyncExternalStore } from "react";

/*
 * 8-bit sounds, made on the spot with the browser's own audio (square and
 * triangle waves, like an old handheld). No sound files and nothing
 * downloaded. They are quiet, they mix with music instead of stopping it,
 * and on an iPhone they follow the silent switch. Switched off in Settings.
 */

const KEY = "passbook-sounds";
const EVENT = "passbook-sounds-change";

export function soundsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSounds(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  window.dispatchEvent(new Event(EVENT));
  if (on) play("coin");
}

export function useSounds(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener(EVENT, l);
      return () => window.removeEventListener(EVENT, l);
    },
    soundsOn,
    () => true,
  );
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext; navigator: Navigator & { audioSession?: { type: string } } };

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (audio) return audio;
  const w = window as AudioWindow;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  // "Ambient": plays alongside music and stays quiet when the phone is on silent (Safari 16.4 and later).
  try {
    if (w.navigator.audioSession) w.navigator.audioSession.type = "ambient";
  } catch {}
  try {
    audio = new Ctor();
  } catch {
    return null;
  }
  return audio;
}

/**
 * Phones only let a page make sound once the person has touched it. The first
 * tap anywhere wakes the audio, so a win that arrives a moment after a tap
 * (once the server has said so) can still be heard.
 */
export function primeSounds() {
  if (typeof window === "undefined") return;
  const wake = () => {
    const ctx = context();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", wake, { once: true, capture: true });
  window.addEventListener("keydown", wake, { once: true, capture: true });
}

type Note = { f: number; at: number; len: number; wave?: OscillatorType; vol?: number };

/** C major, the notes old games are made of. */
const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 };

const TUNES: Record<"coin" | "level" | "badge" | "streak", Note[]> = {
  // A coin: two quick notes up.
  coin: [
    { f: N.B5, at: 0, len: 0.07 },
    { f: N.E6, at: 0.07, len: 0.22 },
  ],
  // Level up: a run up the scale and a held chord.
  level: [
    { f: N.C5, at: 0, len: 0.09 },
    { f: N.E5, at: 0.09, len: 0.09 },
    { f: N.G5, at: 0.18, len: 0.09 },
    { f: N.C6, at: 0.27, len: 0.12 },
    { f: N.G5, at: 0.42, len: 0.08 },
    { f: N.C6, at: 0.5, len: 0.5 },
    { f: N.E6, at: 0.5, len: 0.5, wave: "triangle", vol: 0.8 },
    { f: N.G6, at: 0.5, len: 0.5, wave: "triangle", vol: 0.5 },
  ],
  // A badge: a little jingle.
  badge: [
    { f: N.E6, at: 0, len: 0.08 },
    { f: N.C6, at: 0.08, len: 0.08 },
    { f: N.D6, at: 0.16, len: 0.08 },
    { f: N.G6, at: 0.24, len: 0.3 },
  ],
  // Today's check-in: soft and short.
  streak: [
    { f: N.G5, at: 0, len: 0.06, wave: "triangle" },
    { f: N.C6, at: 0.07, len: 0.16, wave: "triangle" },
  ],
};

export type Tune = keyof typeof TUNES;

export function play(tune: Tune) {
  if (typeof window === "undefined" || !soundsOn()) return;
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = 0.05;
  master.connect(ctx.destination);
  for (const n of TUNES[tune]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.wave ?? "square";
    osc.frequency.setValueAtTime(n.f, start + n.at);
    const peak = n.vol ?? 1;
    gain.gain.setValueAtTime(0.0001, start + n.at);
    gain.gain.exponentialRampToValueAtTime(peak, start + n.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.len);
    osc.connect(gain).connect(master);
    osc.start(start + n.at);
    osc.stop(start + n.at + n.len + 0.02);
  }
  setTimeout(() => master.disconnect(), 1500);
}
