"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { mutate } from "swr";
import { celebrate } from "../celebrate";
import { postQuietly, useApi } from "../use-api";
import type { Badge, GamePayload, GameWin } from "@/lib/game/progress";
import { play, primeSounds } from "./sounds";
import { Sprite, type SpriteId } from "./sprites";

/*
 * The game layer in the app: a "+XP" note whenever something earns some, a
 * level-up party, and a note for each new badge. (Your level shows on the You
 * tab, at the top of Home, and in full on the You screen.) The server decides what earns XP (src/server/game.ts); this
 * only notices the total going up after a change and says so.
 */

export const GAME_URL = "/api/game";

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
      className="xp-pop fixed left-1/2 top-[calc(env(safe-area-inset-top)+10px)] z-[65] flex max-w-[min(92vw,420px)] items-center gap-3 edge rounded-control bg-sheet py-2.5 pl-3 pr-4 text-left shadow-card"
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

  // Today's check-in, once the app knows it hasn't happened yet. The home-screen app can stay open
  // for days, so this runs again whenever a fresh day shows up (and after a check-in that failed).
  useEffect(() => {
    if (!data) return;
    if (data.checkedInToday) {
      checking.current = false;
      return;
    }
    if (checking.current) return;
    checking.current = true;
    postQuietly<GamePayload>(GAME_URL)
      .then((fresh) => mutate(GAME_URL, fresh, { revalidate: false }))
      .catch(() => {
        checking.current = false;
      });
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
      // A new month's first visit brings last month's budget results with the check-in: lead with those.
      const kept = fresh.filter((w) => w.kind === "under");
      const swept = fresh.find((w) => w.kind === "allunder");
      const lead = swept ? `Kept every budget in ${swept.label}` : kept.length > 0 ? `Stayed under budget in ${kept.length} ${kept.length === 1 ? "category" : "categories"}` : null;
      const text = lead ?? (!newest ? "Nice work" : newest.kind === "checkin" ? `Checked in: ${data.streak}-day streak` : winText(newest));
      const counted = lead ? kept.length + (swept ? 1 : 0) : 1;
      pushNote({ kind: "xp", xp: gained, text, more: Math.max(0, fresh.length - counted) });
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
