"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { mutate } from "swr";
import { celebrate } from "../celebrate";
import { postQuietly, useApi } from "../use-api";
import type { Badge, GamePayload, GameWin } from "@/lib/game/progress";
import { LevelBlock, XpBar } from "./level";
import { play, primeSounds } from "./sounds";
import { Sprite, type SpriteId } from "./sprites";

/*
 * The game layer in the app: a strip on Home with the level, XP and streak;
 * a "+XP" note whenever something earns some; a level-up party; and a note for
 * each new badge. The server decides what earns XP (src/server/game.ts); this
 * only notices the total going up after a change and says so.
 */

export const GAME_URL = "/api/game";

/** The strip at the top of Home. Taps through to Progress. */
export function GameStrip() {
  const { data, error } = useApi<GamePayload>(GAME_URL);
  if (error && !data) return null;
  if (!data) return <div aria-hidden className="mb-4 h-[76px] rounded-sheet border border-line-soft bg-sheet shadow-card" />;
  const toGo = data.needed - data.into;
  return (
    <Link
      href="/progress"
      aria-label={`Level ${data.level}. ${toGo} XP to level ${data.level + 1}. ${data.streak > 0 ? `${data.streak}-day streak.` : ""} See your progress and badges.`}
      className="mb-4 flex items-center gap-3 rounded-sheet border border-line-soft bg-sheet p-3 pr-4 shadow-card active:bg-sunk"
    >
      <LevelBlock level={data.level} size={52} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold">{toGo} XP to level {data.level + 1}</span>
          {data.todayXp > 0 && <span className="pixel shrink-0 text-[8px] text-accent-text">+{data.todayXp} today</span>}
        </span>
        <XpBar into={data.into} needed={data.needed} className="mt-2" />
      </span>
      <span aria-hidden className={data.streak > 0 ? "flex flex-col items-center gap-1" : "flex flex-col items-center gap-1 opacity-50"}>
        <Sprite id="flame" size={24} locked={data.streak === 0} />
        <span className="pixel text-[10px]">{data.streak}</span>
      </span>
    </Link>
  );
}

/* ---------- Notes that pop up ---------- */

type NoteInput = { kind: "xp"; xp: number; text: string; more: number } | { kind: "badge"; badge: Badge };
type Note = NoteInput & { id: number };

let shown: Note | null = null;
const waiting: Note[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let ids = 0;

const emit = () => listeners.forEach((l) => l());

function next() {
  if (timer) clearTimeout(timer);
  shown = waiting.shift() ?? null;
  emit();
  if (shown) {
    if (shown.kind === "badge") play("badge");
    timer = setTimeout(next, 2800);
  }
}

function pushNote(note: NoteInput) {
  const full: Note = { ...note, id: ++ids };
  // More XP while an XP note is still up: added to it, so several quick wins read as one.
  if (full.kind === "xp" && shown?.kind === "xp") {
    shown = { ...shown, id: full.id, xp: shown.xp + full.xp, text: full.text, more: shown.more + 1 + full.more };
    emit();
    if (timer) clearTimeout(timer);
    timer = setTimeout(next, 2800);
    return;
  }
  waiting.push(full);
  if (!shown) next();
}

function winText(w: GameWin): string {
  return w.label ? `${w.title}: ${w.label}` : w.title;
}

function Notes() {
  const note = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
    () => null,
  );
  if (!note) return null;
  return (
    <button
      key={note.id}
      type="button"
      onClick={next}
      role="status"
      className="xp-pop fixed left-1/2 top-[calc(env(safe-area-inset-top)+10px)] z-[65] flex max-w-[min(92vw,420px)] items-center gap-3 rounded-2xl border border-line-soft bg-sheet py-2.5 pl-3 pr-4 text-left shadow-float"
    >
      {note.kind === "xp" ? (
        <>
          <Sprite id="coin" size={30} />
          <span className="min-w-0">
            <span className="pixel block text-[12px] text-accent-text">+{note.xp} XP</span>
            <span className="mt-1 block truncate text-small text-ink-2">
              {note.text}
              {note.more > 0 && ` and ${note.more} more`}
            </span>
          </span>
        </>
      ) : (
        <>
          <Sprite id={note.badge.id as SpriteId} size={36} />
          <span className="min-w-0">
            <span className="block text-micro font-bold text-accent-text">Badge won</span>
            <span className="block truncate font-bold">{note.badge.name}</span>
          </span>
        </>
      )}
    </button>
  );
}

/**
 * Always on screen (in the app's frame). Checks in once a day, and watches
 * the XP total: when a change earns some, it pops up a note, plays a sound,
 * and throws a party on a level up.
 */
export function GameWatcher() {
  const { data } = useApi<GamePayload>(GAME_URL);
  const before = useRef<GamePayload | null>(null);
  const checking = useRef(false);

  useEffect(() => primeSounds(), []);

  // Today's check-in, once the app knows it hasn't happened yet.
  useEffect(() => {
    if (!data || data.checkedInToday || checking.current) return;
    checking.current = true;
    postQuietly<GamePayload>(GAME_URL)
      .then((fresh) => mutate(GAME_URL, fresh, { revalidate: false }))
      .catch(() => {});
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const old = before.current;
    before.current = data;
    if (!old) return;

    const gained = data.xp - old.xp;
    if (gained > 0) {
      const seen = new Set(old.recent.map((w) => w.id));
      const fresh = data.recent.filter((w) => !seen.has(w.id));
      const newest = fresh[0];
      const checkIn = fresh.length > 0 && fresh.every((w) => w.kind === "checkin" || w.kind === "nospend");
      const text = !newest ? "Nice work" : newest.kind === "checkin" ? `Checked in: ${data.streak}-day streak` : winText(newest);
      pushNote({ kind: "xp", xp: gained, text, more: Math.max(0, fresh.length - 1) });
      play(checkIn ? "streak" : "coin");
    }
    if (data.level > old.level) {
      setTimeout(() => {
        celebrate(`Level ${data.level}!`, `${data.xp} XP so far. Every small thing you do with your money counts.`, { level: data.level });
        play("level");
      }, 700);
    }
    for (const badge of data.badges) {
      if (badge.earned && !old.badges.find((b) => b.id === badge.id)?.earned) pushNote({ kind: "badge", badge });
    }
  }, [data]);

  return <Notes />;
}
