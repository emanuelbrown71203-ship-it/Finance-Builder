"use client";

import { ChevronRight, MessageCircle, Mic, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { INTRO, SMALL_TALK, cheerFor, type Mood, type Tip } from "@/lib/nickel/brain";
import { CLAUDE_PREFIX, CLAUDE_QUESTIONS, claudeLink } from "@/lib/nickel/claude";
import { parseCommand, type Command } from "@/lib/nickel/commands";
import type { Answer, LastVerdict } from "@/lib/nickel/answers";
import { BillForm, type BillDraft } from "../bill-form";
import { GoalDialog } from "../goals";
import { formatShort } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { NickelPayload } from "@/server/nickel";
import { Dialog, Input, cx, toast } from "../ui";
import { getJson, send, useApi, useNow } from "../use-api";
import { canListen, hush, listen, prime, speak, yesOrNo } from "./voice";
import { RoboDog, type Eyes, type Mouth } from "./robo-dog";
import { pawPrint, planLegs, type Dir, type Leg } from "@/lib/nickel/walk";
import { countTask, markSeen, nickelSettings, seenToday, useNickelSettings, type NickelEvent } from "./store";

/*
 * Nickel, the robo dog who lives in the corner of every screen.
 *
 * What makes him feel alive is lots of small, unscheduled things: he blinks
 * at uneven intervals, breathes, wags at a speed that matches his mood, looks
 * toward wherever you touch or scroll, twitches an ear, tilts his head, sniffs
 * around, and dozes off when left alone (sooner at night). He perks up when a
 * new charge arrives, hops when money goes into a goal, and spins when one is
 * reached. Tap him and he tells you what he's noticed; hold him for options;
 * drag him to the other side if he's in the way.
 *
 * He only reads what's already on screen in Passbook. Nothing leaves the app.
 */

type Action = "hop" | "spin" | "shake" | "sniff" | "bark" | "stretch" | "look" | "wiggle";
type Effect = "hearts" | "bang" | "question" | "sparkle" | "party";
type Bubble = { text: string; href?: string; link?: string; tipId?: string; sticky: boolean; kind: "tip" | "intro" | "talk" | "event" | "done"; undo?: string };

const LOOK: Record<Mood, { eyes: Eyes; mouth: Mouth; wag: string; antenna: string; cheeks: boolean; ears: "" | "perk" | "down" }> = {
  happy: { eyes: "open", mouth: "smile", wag: "0.7s", antenna: "var(--good)", cheeks: true, ears: "" },
  excited: { eyes: "star", mouth: "open", wag: "0.26s", antenna: "var(--pink-ink)", cheeks: true, ears: "perk" },
  proud: { eyes: "happy", mouth: "smile", wag: "0.45s", antenna: "var(--good)", cheeks: true, ears: "perk" },
  curious: { eyes: "curious", mouth: "smile", wag: "0.95s", antenna: "var(--sky-ink)", cheeks: false, ears: "perk" },
  worried: { eyes: "worried", mouth: "flat", wag: "1.8s", antenna: "var(--warn)", cheeks: false, ears: "down" },
  sleepy: { eyes: "sleepy", mouth: "flat", wag: "0s", antenna: "var(--series-muted)", cheeks: false, ears: "down" },
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const isNight = () => {
  const h = new Date().getHours();
  return h >= 22 || h < 6;
};

const UNPROMPTED_GAP = 8 * 60_000;
/** How wide he is on screen, and how far he keeps from the edges. */
const DOG_W = 72;
const DOG_H = 75;
/** How long a paw print takes to fade (matches .nk-print in globals.css). */
const PRINT_MS = 1700;
/** Bits of colour for a party: where each one flies. */
const CONFETTI = [
  { dx: -46, dy: -40, c: "var(--warn)" },
  { dx: -30, dy: -64, c: "var(--sky-ink)" },
  { dx: -8, dy: -72, c: "var(--good)" },
  { dx: 14, dy: -70, c: "var(--pink-ink)" },
  { dx: 34, dy: -58, c: "var(--canary-ink)" },
  { dx: 50, dy: -34, c: "var(--accent)" },
  { dx: -54, dy: -10, c: "var(--pink-ink)" },
  { dx: 56, dy: -6, c: "var(--sky-ink)" },
];
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const EVENT_GAP = 3 * 60_000;

export function Nickel() {
  const settings = useNickelSettings();
  const now = useNow(30_000);
  // Until the clock is read (just after the page appears), a nap that was set counts as still on.
  const napping = settings.napUntil > 0 && (now === 0 || settings.napUntil > now);
  const visible = settings.on && !napping;
  const { data } = useApi<NickelPayload>(visible ? "/api/nickel" : null, { refreshInterval: 45_000 });

  const [action, setAction] = useState<{ name: Action; key: number } | null>(null);
  const [effect, setEffect] = useState<{ name: Effect; key: number } | null>(null);
  const [override, setOverride] = useState<Mood | null>(null);
  const overrideTimer = useRef(0);
  const [blink, setBlink] = useState(false);
  const [tilt, setTilt] = useState<0 | -1 | 1>(0);
  const [twitch, setTwitch] = useState<"" | "l" | "r">("");
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [asleep, setAsleep] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const [doing, setDoing] = useState(false);
  const [billDraft, setBillDraft] = useState<Partial<BillDraft> | null>(null);
  const [newGoal, setNewGoal] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [wide, setWide] = useState(false);
  const [screenH, setScreenH] = useState(800);
  const [screenW, setScreenW] = useState(390);
  /** Where he's wandered to: px from the left and top of the screen. Null when he's sitting at his home spot. */
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  /** The leg of a walk he's on: across (side-on) or up or down (climbing), and how long it takes. */
  const [walk, setWalk] = useState<{ dir: Dir; ms: number } | null>(null);
  /** Paw prints behind him, each fading a moment after it's made (screen px, toes turned by `rot`). */
  const [prints, setPrints] = useState<{ id: number; x: number; y: number; rot: number; at: number }[]>([]);
  /** Room an on-screen message takes at the bottom; he hops up over it. */
  const [toastSpace, setToastSpace] = useState(0);
  const [toastTop, setToastTop] = useState<number | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const lastActive = useRef(0);
  const lastUnprompted = useRef(0);
  const lastEvent = useRef(0);
  const latestSeen = useRef<string | null>(null);
  const shownThisVisit = useRef(new Set<string>());
  const taps = useRef<number[]>([]);
  const press = useRef<{ x: number; y: number; t: number; timer: number; moved: boolean; held: boolean } | null>(null);
  /** The leg he's walking now and when he set off on it, to know where his paws are. Null when he isn't walking. */
  const legNow = useRef<(Leg & { start: number }) | null>(null);
  /** Where the whole walk ends (its last leg). */
  const walkEnd = useRef<{ x: number; y: number } | null>(null);
  const printId = useRef(0);
  /** Counts walks, so one that was replaced before it set off never starts. */
  const walkGen = useRef(0);
  const bubbleTimer = useRef(0);
  // Anything unexpected from the server counts as "nothing to say", never a broken screen.
  const tips = useMemo(() => (Array.isArray(data?.tips) ? data.tips : []), [data]);
  const today = tips[0]?.id?.split(":").pop() ?? "";
  const introShown = useRef(false);

  const mood: Mood = asleep ? "sleepy" : (override ?? data?.mood ?? "happy");
  const look = LOOK[mood];

  const act = useCallback((name: Action) => setAction({ name, key: Date.now() + Math.random() }), []);
  const pop = useCallback((name: Effect) => setEffect({ name, key: Date.now() + Math.random() }), []);
  /** A feeling that lasts a little while, then he goes back to his usual mood. */
  const feel = useCallback((m: Mood, ms: number) => {
    window.clearTimeout(overrideTimer.current);
    setOverride(m);
    overrideTimer.current = window.setTimeout(() => setOverride(null), ms);
  }, []);

  const say = useCallback((b: Bubble, ms = 9000) => {
    window.clearTimeout(bubbleTimer.current);
    setBubble(b);
    if (b.tipId && today) markSeen(today, b.tipId);
    if (!b.sticky) bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, [today]);

  const wake = useCallback(() => {
    lastActive.current = Date.now();
    setAsleep((was) => {
      if (was) {
        act("stretch");
        feel("happy", 4000);
      }
      return false;
    });
  }, [act, feel]);

  /** The next thing worth saying: unseen tips first (most important first), then small talk. */
  const nextLine = useCallback((): Bubble => {
    const seen = today ? seenToday(today) : new Set<string>();
    const fresh = tips.find((t) => !shownThisVisit.current.has(t.id) && !seen.has(t.id)) ?? tips.find((t) => !shownThisVisit.current.has(t.id));
    if (fresh) {
      shownThisVisit.current.add(fresh.id);
      return { text: fresh.text, href: fresh.href, link: fresh.link, tipId: fresh.id, sticky: true, kind: "tip" };
    }
    shownThisVisit.current.clear();
    return { text: SMALL_TALK[Math.floor(Math.random() * SMALL_TALK.length)], sticky: false, kind: "talk" };
  }, [tips, today]);

  /* ---------- life: blinking, idle habits, dozing ---------- */

  useEffect(() => {
    if (!visible) return;
    let timer = 0;
    const loop = () => {
      timer = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 130);
        // Now and then a double blink.
        if (Math.random() < 0.22) window.setTimeout(() => {
          setBlink(true);
          window.setTimeout(() => setBlink(false), 110);
        }, 260);
        loop();
      }, rand(2200, 6200));
    };
    loop();
    return () => window.clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    lastActive.current = Date.now();
    let timer = 0;
    const loop = () => {
      timer = window.setTimeout(() => {
        const idle = Date.now() - lastActive.current;
        const sleepAfter = isNight() ? 20_000 : 80_000;
        if (legNow.current) {
          // Busy walking: habits can wait until he gets there.
        } else if (idle > sleepAfter) {
          setAsleep(true);
          setTilt(0);
        } else if (!press.current) {
          const roll = Math.random();
          if (roll < 0.22) act("look");
          else if (roll < 0.38) {
            setTilt(Math.random() < 0.5 ? -1 : 1);
            window.setTimeout(() => setTilt(0), rand(1200, 2600));
          } else if (roll < 0.58) {
            setTwitch(Math.random() < 0.5 ? "l" : "r");
            window.setTimeout(() => setTwitch(""), 450);
          } else if (roll < 0.68) act("sniff");
          else if (roll < 0.74) act("wiggle");
          else if (roll < 0.79) act("stretch");
          else if (roll < 0.84 && (data?.mood === "happy" || data?.mood === "excited" || data?.mood === "proud")) act("hop");
          // Otherwise he just sits there, which real pets do a lot.
        }
        loop();
      }, rand(6000, 14000));
    };
    loop();
    return () => window.clearTimeout(timer);
  }, [visible, act, data?.mood]);

  // Eyes follow touches, the pointer and scrolling; any of them also wakes him.
  useEffect(() => {
    if (!visible) return;
    let reset = 0;
    const lookAt = (x: number, y: number) => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height * 0.35);
      const len = Math.hypot(dx, dy) || 1;
      const next = { x: Math.round((dx / len) * 2.8 * 2) / 2, y: Math.round((dy / len) * 2.2 * 2) / 2 };
      // Only redraw when where he's looking actually changes.
      setGaze((g) => (g.x === next.x && g.y === next.y ? g : next));
      window.clearTimeout(reset);
      reset = window.setTimeout(() => setGaze({ x: 0, y: 0 }), 2600);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.type === "pointermove" && Math.random() < 0.6) return; // a little lazy, like a real dog
      lookAt(e.clientX, e.clientY);
      if (e.type === "pointerdown") wake();
      else lastActive.current = Date.now();
    };
    let lastY = window.scrollY;
    const onScroll = () => {
      const dy = window.scrollY - lastY;
      lastY = window.scrollY;
      const y = dy > 0 ? 2 : -2;
      setGaze((g) => (g.x === 0 && g.y === y ? g : { x: 0, y }));
      window.clearTimeout(reset);
      reset = window.setTimeout(() => setGaze({ x: 0, y: 0 }), 900);
      lastActive.current = Date.now();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(reset);
    };
  }, [visible, wake]);

  /* ---------- wandering, like a real dog ---------- */

  // The latest of what the wander loop needs to know, without restarting it every time something changes.
  const calm = useRef({ asleep, bubble: false, menu: false, drag: false });
  useEffect(() => {
    calm.current = { asleep, bubble: bubble !== null, menu, drag: drag !== null };
  });
  const spotRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    spotRef.current = spot;
  }, [spot]);
  const walkTimer = useRef(0);
  /** Where his home spot is on screen, measured the last time he set off from it (for this screen size). */
  const homeAt = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const goingHome = useRef(false);
  const homeTimer = useRef(0);

  /**
   * The area he can roam: below the screen's title bar, above the tab bar, inside the edges, and clear
   * of the sidebar on a laptop.
   */
  const bounds = useCallback(() => {
    const margin = wide ? 24 : 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const measured = homeAt.current && homeAt.current.w === vw && homeAt.current.h === vh ? homeAt.current : null;
    const lowest = vh - (wide ? 20 : 80) - DOG_H - 8;
    const home = measured ?? { x: settings.side === "right" ? vw - margin - DOG_W : margin, y: lowest - 26 };
    const minX = wide ? 276 : margin;
    return { minX, maxX: vw - margin - DOG_W, minY: wide ? 96 : 118, maxY: Math.max(wide ? 96 : 118, Math.min(lowest, home.y)), home: { x: home.x, y: Math.min(lowest, home.y) } };
  }, [wide, settings.side]);

  /** Trots to a spot anywhere on the screen (null: back home), then does something doggy there. */
  const trot = useCallback(
    (target: { x: number; y: number } | null) => {
      // Already walking (sent home, or off somewhere new): stop where he really is, and plan from there.
      const gen = ++walkGen.current;
      const wasWalking = legNow.current !== null;
      if (wasWalking) {
        const r = root.current?.getBoundingClientRect();
        window.clearTimeout(walkTimer.current);
        legNow.current = null;
        walkEnd.current = null;
        setWalk(null);
        if (r) spotRef.current = { x: r.left, y: r.top };
      }
      // Setting off from home: remember exactly where home is, so he can come back to it.
      if (spotRef.current === null) {
        const r = root.current?.getBoundingClientRect();
        if (r) homeAt.current = { x: r.left, y: r.top, w: window.innerWidth, h: window.innerHeight };
      }
      const b = bounds();
      const from = spotRef.current ?? b.home;
      const to = target === null ? b.home : { x: Math.max(b.minX, Math.min(b.maxX, target.x)), y: Math.max(b.minY, Math.min(b.maxY, target.y)) };
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance < 30) {
        if (target === null) setSpot(null);
        else if (wasWalking) setSpot(from);
        return;
      }
      // Across side-on and up or down climbing, never a diagonal (see lib/nickel/walk.ts). Climbing is slower.
      const legs = planLegs(from, to, { across: rand(90, 130), climb: rand(55, 80) });
      if (legs.length === 0) {
        if (target === null) setSpot(null);
        else if (wasWalking) setSpot(from);
        return;
      }
      walkEnd.current = to;
      goingHome.current = target === null;
      setGaze({ x: 0, y: 0 });
      // Start from where he is (switching from sitting at home to a spot), then set off on the next frame.
      setSpot(from);
      window.clearTimeout(walkTimer.current);
      const arrive = () => {
        setWalk(null);
        legNow.current = null;
        walkEnd.current = null;
        goingHome.current = false;
        if (target === null) {
          setSpot(null);
          return;
        }
        // What a dog does on arriving somewhere.
        const roll = Math.random();
        if (roll < 0.35) act("sniff");
        else if (roll < 0.55) act("look");
        else if (roll < 0.65) act("stretch");
        else if (roll < 0.72) act("wiggle");
        else if (roll < 0.77) {
          act("spin"); // chasing his tail
          pop("hearts");
        }
      };
      const step = (i: number) => {
        if (gen !== walkGen.current) return;
        const leg = legs[i];
        legNow.current = { ...leg, start: performance.now() };
        setWalk({ dir: leg.dir, ms: leg.ms });
        setSpot(leg.to);
        walkTimer.current = window.setTimeout(() => (i + 1 < legs.length ? step(i + 1) : arrive()), leg.ms);
      };
      requestAnimationFrame(() => requestAnimationFrame(() => step(0)));
    },
    [bounds, act, pop],
  );

  useEffect(() => {
    if (!visible || !settings.roams) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;
    const loop = () => {
      timer = window.setTimeout(() => {
        const c = calm.current;
        const quiet = Date.now() - lastActive.current > 3500 && !press.current && document.visibilityState === "visible" && !document.querySelector("dialog[open]");
        if (!reduced.matches && quiet && !c.asleep && !c.bubble && !c.menu && !c.drag && !legNow.current) {
          const here = spotRef.current;
          if (here !== null && Math.random() < 0.3) trot(null);
          else {
            const b = bounds();
            const start = here ?? b.home;
            // Anywhere on the screen: along the bottom, up a side, or out in the open, a fair way from where he is.
            const pickSpot = () => {
              const roll = Math.random();
              if (roll < 0.3) return { x: rand(b.minX, b.maxX), y: b.maxY };
              if (roll < 0.55) return { x: Math.random() < 0.5 ? b.minX : b.maxX, y: rand(b.minY, b.maxY) };
              return { x: rand(b.minX, b.maxX), y: rand(b.minY, b.maxY) };
            };
            let target = pickSpot();
            for (let i = 0; i < 10 && Math.hypot(target.x - start.x, target.y - start.y) < 110; i++) target = pickSpot();
            trot(target);
          }
        }
        loop();
      }, rand(16_000, 40_000));
    };
    loop();
    return () => window.clearTimeout(timer);
  }, [visible, settings.roams, bounds, trot]);

  // Out in the middle of the screen when you start scrolling or tapping, he trots back to his spot so he's
  // never in the way, the way a dog heads back to its bed when people start moving about.
  useEffect(() => {
    if (!visible) return;
    const outOfTheWay = (e: Event) => {
      const here = spotRef.current;
      // Not while you're talking with him or holding him: he stays put with his bubble.
      if (here === null || goingHome.current || calm.current.drag || calm.current.bubble || calm.current.menu || press.current) return;
      if (e.type === "pointerdown" && root.current?.contains(e.target as Node)) return;
      const b = bounds();
      if ((walkEnd.current ?? here).y >= b.maxY - 40) return; // already along the bottom, and staying there
      window.clearTimeout(homeTimer.current);
      homeTimer.current = window.setTimeout(() => trot(null), 250);
    };
    window.addEventListener("pointerdown", outOfTheWay, { passive: true });
    window.addEventListener("scroll", outOfTheWay, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", outOfTheWay);
      window.removeEventListener("scroll", outOfTheWay);
      window.clearTimeout(homeTimer.current);
    };
  }, [visible, bounds, trot]);

  // Switched off: he goes home.
  useEffect(() => {
    if (settings.roams) return;
    const t = window.setTimeout(() => {
      walkGen.current++;
      window.clearTimeout(walkTimer.current);
      legNow.current = null;
      walkEnd.current = null;
      setWalk(null);
      setSpot(null);
    }, 0);
    return () => window.clearTimeout(t);
  }, [settings.roams]);

  /** Stops where he is (when touched mid-trot). */
  const halt = () => {
    walkGen.current++; // a walk about to set off doesn't
    window.clearTimeout(homeTimer.current);
    if (!walk) return;
    const r = root.current?.getBoundingClientRect();
    window.clearTimeout(walkTimer.current);
    legNow.current = null;
    walkEnd.current = null;
    setWalk(null);
    goingHome.current = false;
    if (r) setSpot({ x: r.left, y: r.top });
  };

  // A paw print every few steps where his paws are, each fading a moment later; the last ones fade after he stops.
  useEffect(() => {
    if (!walk) return;
    let n = 0;
    const timer = window.setInterval(
      () => {
        const leg = legNow.current;
        if (!leg) return;
        const now = performance.now();
        const at = pawPrint(leg, (now - leg.start) / leg.ms, n++, { w: DOG_W, h: DOG_H });
        setPrints((list) => [...list.filter((p) => now - p.at < PRINT_MS), { id: ++printId.current, ...at, at: now }]);
      },
      walk.dir === "l" || walk.dir === "r" ? 230 : 300,
    );
    return () => window.clearInterval(timer);
  }, [walk]);
  useEffect(() => {
    if (walk || prints.length === 0) return;
    const t = window.setTimeout(() => setPrints([]), PRINT_MS);
    return () => window.clearTimeout(t);
  }, [walk, prints.length]);

  useEffect(() => {
    const onSpace = (e: Event) => {
      const detail = (e as CustomEvent<{ space?: number; top?: number | null }>).detail ?? {};
      setToastSpace(Number(detail.space) || 0);
      setToastTop(typeof detail.top === "number" && detail.top > 0 ? detail.top : null);
    };
    window.addEventListener("passbook-toast-space", onSpace);
    return () => window.removeEventListener("passbook-toast-space", onSpace);
  }, []);

  /* ---------- noticing things ---------- */

  // A new charge or deposit arrived since he last looked: he perks up and sniffs it.
  useEffect(() => {
    const latest = data?.latest;
    if (!latest) return;
    const before = latestSeen.current;
    latestSeen.current = latest.id;
    if (before === null || before === latest.id) return;
    const t = window.setTimeout(() => {
      wake();
      act("sniff");
      pop("bang");
      feel("curious", 5000);
      if (settings.chatty && Date.now() - lastEvent.current > EVENT_GAP && !bubble?.sticky) {
        lastEvent.current = Date.now();
        say({ text: `Sniff sniff! ${latest.amount < 0 ? `${dollars(-latest.amount)} at` : `${dollars(latest.amount)} from`} ${latest.name}.`, href: "/transactions", link: "See it", sticky: false, kind: "event" }, 6500);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [data?.latest, act, pop, feel, wake, say, settings.chatty, bubble?.sticky]);

  // Says hello the first time, and speaks up on his own about something important, now and then.
  useEffect(() => {
    if (!visible || !data) return;
    if (!settings.introDone && introShown.current) return;
    const t = window.setTimeout(() => {
      if (!settings.introDone) {
        // Once per visit: closing the hello never brings it straight back.
        introShown.current = true;
        act("hop");
        say({ text: INTRO.replace("Nickel", settings.name), sticky: true, kind: "intro" });
        return;
      }
      if (!settings.chatty || bubble || Date.now() - lastUnprompted.current < UNPROMPTED_GAP) return;
      const seen = seenToday(today);
      const urgent = tips.find((tip: Tip) => tip.priority <= 2 && !seen.has(tip.id));
      if (!urgent) return;
      lastUnprompted.current = Date.now();
      act(urgent.mood === "excited" ? "spin" : urgent.mood === "worried" ? "wiggle" : "bark");
      if (urgent.mood === "excited") pop("sparkle");
      say({ text: urgent.text, href: urgent.href, link: urgent.link, tipId: urgent.id, sticky: false, kind: "tip" }, 11000);
      shownThisVisit.current.add(urgent.id);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [visible, data, tips, settings.introDone, settings.chatty, settings.name, bubble, today, act, pop, say]);

  // Things that happen elsewhere in the app.
  useEffect(() => {
    const onReact = (e: Event) => {
      const ev = (e as CustomEvent<NickelEvent>).detail;
      wake();
      if (ev.type === "deposit") {
        act("hop");
        pop("hearts");
        feel("proud", 6000);
        if (settings.chatty) say({ text: `Woof! ${dollars(ev.amount)} closer to “${ev.goal}”.`, sticky: false, kind: "event" }, 5000);
      } else if (ev.type === "celebrate") {
        act("spin");
        pop("hearts");
        feel("excited", 9000);
      } else if (ev.type === "refreshed") {
        act("shake");
        pop("sparkle");
      } else if (ev.type === "task") {
        // A small money task done: he cheers, and throws a party for the big ones and every few in a day.
        const today = localToday();
        const n = countTask(today);
        const cheer = cheerFor(ev.task, { name: ev.name, amount: ev.amount, percent: ev.percent }, n, `${today}:${n}`);
        if (cheer.party) {
          act("spin");
          pop("party");
          feel("excited", 8000);
          window.setTimeout(() => pop("hearts"), 1300);
        } else {
          act((["hop", "wiggle", "bark"] as const)[n % 3]);
          pop(n % 2 ? "hearts" : "sparkle");
          feel("proud", 5000);
        }
        if (settings.chatty || cheer.party) say({ text: cheer.text, sticky: false, kind: "event" }, cheer.party ? 6500 : 4500);
      }
    };
    window.addEventListener("passbook-nickel-react", onReact);
    return () => window.removeEventListener("passbook-nickel-react", onReact);
  }, [act, pop, feel, wake, say, settings.chatty]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setWide(mq.matches);
      setScreenH(window.innerHeight);
      setScreenW(window.innerWidth);
    };
    const t = window.setTimeout(update, 0);
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Leaves room at the bottom of each screen so he never sits on top of the last row.
  useEffect(() => {
    document.documentElement.style.setProperty("--nickel-space", visible ? "80px" : "0px");
    return () => document.documentElement.style.setProperty("--nickel-space", "0px");
  }, [visible]);

  /* ---------- touching him ---------- */

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    halt();
    const timer = window.setTimeout(() => {
      if (press.current && !press.current.moved) {
        press.current.held = true;
        navigator.vibrate?.(12);
        setMenu(true);
        setBubble(null);
      }
    }, 520);
    press.current = { x: e.clientX, y: e.clientY, t: Date.now(), timer, moved: false, held: false };
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      p.moved = true;
      window.clearTimeout(p.timer);
      setBubble(null);
      setMenu(false);
      feel("excited", 60_000);
    }
    if (p.moved) setDrag({ x: e.clientX, y: e.clientY });
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (p.moved) {
      // Lands on whichever side is nearer, at the height he was dropped.
      const side = e.clientX < window.innerWidth / 2 ? "left" : "right";
      const baseBottom = wide ? 20 : 80;
      const lift = Math.max(0, Math.min(window.innerHeight - 260, window.innerHeight - e.clientY - 40 - baseBottom));
      nickelSettings.setPlace(side, lift);
      setSpot(null);
      setDrag(null);
      setOverride(null);
      act("hop");
      return;
    }
    if (p.held) return;
    wake();
    // Five quick taps: zoomies.
    taps.current = [...taps.current.filter((t) => Date.now() - t < 2500), Date.now()];
    if (taps.current.length >= 5) {
      taps.current = [];
      act("spin");
      pop("hearts");
      feel("excited", 5000);
      say({ text: "Hehe, that tickles! Zoomies!", sticky: false, kind: "talk" }, 3500);
      return;
    }
    if (bubble?.kind === "intro") {
      nickelSettings.finishIntro();
      setBubble(null);
      return;
    }
    act("bark");
    const line = nextLine();
    if (line.kind === "talk") pop(Math.random() < 0.5 ? "hearts" : "question");
    say(line);
  };

  // Where he sat is re-checked against today's screen, so turning an iPad never leaves him off the edge.
  const lift = Math.min(settings.lift, Math.max(0, screenH - 300));
  // Up high, his bubble opens below him instead of off the top of the screen.
  const bubbleBelow = spot ? spot.y < screenH / 2 - 60 : lift > screenH / 2 - 120;
  const margin = wide ? 24 : 10;
  // Wherever he wandered, re-checked against today's screen width.
  const x = spot === null ? null : Math.max(wide ? 276 : margin, Math.min(screenW - margin - DOG_W, spot.x));
  // Kept below the title bar and above the tab bar even after the screen turns, and above a message while one shows.
  const lowest = Math.min(screenH - (wide ? 20 : 80) - DOG_H - 8, !wide && toastTop !== null ? toastTop - DOG_H - 8 : Infinity);
  const y = spot === null ? null : Math.max(wide ? 96 : 118, Math.min(lowest, spot.y));
  const sideStyle = useMemo(() => {
    const bottomBase = wide ? 20 : 80;
    if (drag) return { left: drag.x - 38, top: drag.y - 40 };
    // On a phone, a message along the bottom would cover him: he hops up above it, and back down after.
    const over = !wide && lift < toastSpace + 12 ? toastSpace : 0;
    const bottom = `calc(${bottomBase + lift + over}px + ${wide ? "0px" : "env(safe-area-inset-bottom)"})`;
    const hop = "bottom 0.38s cubic-bezier(0.3, 1.45, 0.5, 1)";
    if (x !== null && y !== null) return { left: x, top: y, transition: walk ? `left ${walk.ms}ms linear, top ${walk.ms}ms linear` : undefined };
    return { [settings.side]: margin, bottom, transition: hop };
  }, [drag, settings.side, lift, wide, x, y, walk, margin, toastSpace]);
  // Out in the middle of the screen, his bubble stays on screen and its point stays on him.
  const bubbleW = Math.min(304, screenW - 24);
  const bubbleLeft = x === null ? null : Math.max(12, Math.min(screenW - 12 - bubbleW, x + DOG_W / 2 - bubbleW / 2));
  const bubblePlace = x === null || bubbleLeft === null ? null : { box: { left: bubbleLeft - x, width: bubbleW }, point: { left: Math.max(16, Math.min(bubbleW - 32, x + DOG_W / 2 - bubbleLeft - 8)) } };

  if (!visible) return null;

  const eyes: Eyes = blink && look.eyes !== "sleepy" && look.eyes !== "happy" ? "sleepy" : look.eyes;

  return (
    <>
      {prints.length > 0 && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[29]">
          {prints.map((p) => (
            <svg key={p.id} viewBox="0 0 10 10" fill="currentColor" className="nk-print" style={{ left: p.x, top: p.y, ["--rot" as string]: `${p.rot}deg` }}>
              <ellipse cx="5" cy="6.6" rx="2.6" ry="2.1" />
              <circle cx="2.1" cy="3.9" r="1.05" />
              <circle cx="3.9" cy="2.3" r="1.05" />
              <circle cx="6.1" cy="2.3" r="1.05" />
              <circle cx="7.9" cy="3.9" r="1.05" />
            </svg>
          ))}
        </div>
      )}
      <div ref={root} data-no-pull className={cx("nk-root fixed z-30 select-none", drag && "nk-dragging")} style={sideStyle}>
        {/* What he says */}
        {(bubble || menu) && !drag && (
          <div className={cx("nk-bubble absolute w-[min(19rem,calc(100vw-1.5rem))]", bubbleBelow ? "top-[86px]" : "bottom-[86px]", !bubblePlace && (settings.side === "right" ? "right-0" : "left-0"))} style={bubblePlace?.box}>
            <div role="status" aria-live="polite" className="max-h-[min(30rem,calc(100dvh-13rem))] overflow-y-auto overscroll-contain rounded-[18px] border border-line bg-sheet p-3.5 text-small text-ink shadow-float">
              <div className="flex items-start justify-between gap-2">
                <p className="text-micro font-extrabold uppercase tracking-wide text-accent-text">{settings.name}</p>
                <button type="button" onClick={() => (bubble?.kind === "intro" ? (nickelSettings.finishIntro(), setBubble(null)) : (setBubble(null), setMenu(false), setAsking(false), setDoing(false)))} aria-label="Close" className="-mr-2 -mt-2 inline-flex size-9 items-center justify-center rounded-full text-ink-3 active:bg-sunk">
                  <X size={16} />
                </button>
              </div>
              {menu && asking ? (
                <AskClaude onDone={() => (setMenu(false), setAsking(false))} />
              ) : menu && doing && data ? (
                <NickelDo
                  today={data.today}
                  goals={data.goals ?? []}
                  loans={data.loans ?? []}
                  talksBack={settings.talksBack}
                  onDone={(done) => {
                    setMenu(false);
                    setDoing(false);
                    const n = countTask(localToday());
                    const party = cheerFor("done", {}, n, String(n)).party;
                    act(party ? "spin" : "hop");
                    pop(party ? "party" : "sparkle");
                    feel("excited", 6000);
                    say({ kind: "done", text: `Done! ${done.summary}`, href: done.href, link: "See it", undo: done.activityId, sticky: true });
                  }}
                  onBill={(draft) => (setMenu(false), setDoing(false), setBillDraft(draft))}
                  onGoal={() => (setMenu(false), setDoing(false), setNewGoal(true))}
                  onLeave={() => (setMenu(false), setDoing(false))}
                />
              ) : menu ? (
                <ul className="-mx-1 mt-1 flex flex-col">
                  <MenuItem onClick={() => setDoing(true)}>Ask me something</MenuItem>
                  <MenuItem onClick={() => (setMenu(false), act("bark"), say(nextLine()))}>Tell me something</MenuItem>
                  <MenuItem onClick={() => setAsking(true)}>Chat with Claude about my money</MenuItem>
                  <MenuItem onClick={() => (setMenu(false), nickelSettings.napFor(60 * 60_000))}>Nap for an hour</MenuItem>
                  <li>
                    <Link href="/settings#nickel" onClick={() => setMenu(false)} className="flex min-h-11 items-center justify-between rounded-xl px-2 font-bold active:bg-sunk">
                      {settings.name} settings <ChevronRight size={16} className="text-ink-3" />
                    </Link>
                  </li>
                </ul>
              ) : (
                bubble && (
                  <>
                    <p className="mt-0.5 leading-relaxed">{bubble.text}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {bubble.kind === "intro" ? (
                        <button type="button" onClick={() => (nickelSettings.finishIntro(), setBubble(null), act("hop"))} className="min-h-10 rounded-control bg-accent px-4 text-small font-bold text-on-accent active:scale-[0.97]">
                          Nice to meet you
                        </button>
                      ) : (
                        <>
                          {bubble.href && (
                            <Link href={bubble.href} onClick={() => setBubble(null)} className="inline-flex min-h-10 items-center rounded-control bg-accent-soft px-3.5 text-small font-bold text-accent-text active:scale-[0.97]">
                              {bubble.link ?? "Show me"}
                            </Link>
                          )}
                          {bubble.undo && (
                            <button
                              type="button"
                              onClick={async () => {
                                const id = bubble.undo!;
                                try {
                                  await send("POST", `/api/activity/${id}/undo`);
                                  act("shake");
                                  say({ kind: "talk", text: "Undone. It’s back the way it was.", sticky: false }, 5000);
                                } catch (e) {
                                  say({ kind: "talk", text: e instanceof Error ? e.message : "I couldn’t undo that. It’s under Settings, Activity.", sticky: true });
                                }
                              }}
                              className="inline-flex min-h-10 items-center rounded-control px-3 text-small font-bold text-ink-2 underline underline-offset-2 active:bg-sunk"
                            >
                              Undo
                            </button>
                          )}
                          {/* Asking is always one tap away, not hidden behind holding him. */}
                          {data && (
                            <button type="button" onClick={() => (setBubble(null), setMenu(true), setDoing(true))} className="inline-flex min-h-10 items-center gap-1.5 rounded-control bg-accent px-3.5 text-small font-bold text-on-accent active:scale-[0.97]">
                              <MessageCircle size={15} aria-hidden /> Ask me something
                            </button>
                          )}
                          {bubble.kind === "tip" && (
                            <button type="button" onClick={() => (act("bark"), say(nextLine()))} className="inline-flex min-h-10 items-center rounded-control px-3 text-small font-bold text-ink-2 active:bg-sunk">
                              Anything else?
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )
              )}
            </div>
            <span aria-hidden className={cx("absolute size-4 rotate-45 border-line bg-sheet", bubbleBelow ? "-top-[7px] border-l border-t" : "-bottom-[7px] border-b border-r", !bubblePlace && (settings.side === "right" ? "right-8" : "left-8"))} style={bubblePlace?.point} />
          </div>
        )}

        {data && (
          <Dialog open={billDraft !== null} onClose={() => setBillDraft(null)} title={billDraft?.frequency === "once" ? "Add an upcoming bill" : "Add a bill"}>
            {billDraft && (
              <BillForm
                today={data.today}
                draft={billDraft}
                via="nickel"
                onDone={() => setBillDraft(null)}
                onCancel={() => setBillDraft(null)}
              />
            )}
          </Dialog>
        )}
        {data && newGoal && <GoalDialog sheet={{ kind: "new" }} today={data.today} onClose={() => setNewGoal(false)} />}

        <button
          type="button"
          aria-label={`${settings.name}, your robo dog. Tap for what he’s noticed, hold for options, drag to move him.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            if (press.current) window.clearTimeout(press.current.timer);
            press.current = null;
            setDrag(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              wake();
              act("bark");
              say(nextLine());
            }
          }}
          className={cx("nk-btn relative block touch-none rounded-full outline-offset-4", walk && `nk-walking nk-walk-${walk.dir}`)}
          style={{ ["--nk-wag" as string]: look.wag }}
        >
          <div key={action?.key} className={cx("nk-wrap", action && `nk-act-${action.name}`)} onAnimationEnd={(e) => e.animationName === `nk-${action?.name}` && setAction(null)}>
            <RoboDog
              key={walk?.dir ?? "sit"}
              walk={walk?.dir ?? null}
              eyes={eyes}
              mouth={action?.name === "bark" ? "open" : asleep && blink ? "yawn" : look.mouth}
              antenna={look.antenna}
              cheeks={look.cheeks}
              tongue={mood === "happy" || mood === "proud" || mood === "excited"}
              gaze={asleep ? { x: 0, y: 0 } : gaze}
              className={cx(asleep && "nk-sleep", look.ears === "down" && "nk-ears-down", look.ears === "perk" && "nk-ears-perk", tilt === -1 && "nk-tilt-l", tilt === 1 && "nk-tilt-r", twitch && `nk-twitch-${twitch}`, look.wag === "0s" && "nk-still", walk && "nk-turn")}
            />
          </div>
          {asleep && (
            <span aria-hidden className="pointer-events-none absolute -top-1 right-0 font-extrabold text-ink-3">
              <span className="nk-z" style={{ animationDelay: "0s" }}>z</span>
              <span className="nk-z text-small" style={{ animationDelay: "1s" }}>z</span>
              <span className="nk-z text-lead" style={{ animationDelay: "2s" }}>Z</span>
            </span>
          )}
          {effect && (
            <span key={effect.key} aria-hidden className="pointer-events-none absolute inset-x-0 -top-3 flex justify-center" onAnimationEnd={() => setEffect(null)}>
              {effect.name === "bang" && <span className="nk-pop text-lead font-black text-[var(--warn)]">!</span>}
              {effect.name === "question" && <span className="nk-pop text-lead font-black text-[var(--sky-ink)]">?</span>}
              {effect.name === "hearts" && (
                <>
                  <span className="nk-heart text-[var(--pink-ink)]" style={{ animationDelay: "0s", marginLeft: -18 }}>♥</span>
                  <span className="nk-heart text-[var(--pink-ink)]" style={{ animationDelay: "0.15s" }}>♥</span>
                  <span className="nk-heart text-[var(--pink-ink)]" style={{ animationDelay: "0.3s", marginLeft: 18 }}>♥</span>
                </>
              )}
              {effect.name === "party" &&
                CONFETTI.map((p, i) => <span key={i} className="nk-confetti" style={{ background: p.c, animationDelay: `${(i % 3) * 0.06}s`, ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px` }} />)}
              {effect.name === "sparkle" && (
                <>
                  <span className="nk-heart text-[var(--warn)]" style={{ animationDelay: "0s", marginLeft: -20 }}>✦</span>
                  <span className="nk-heart text-[var(--sky-ink)]" style={{ animationDelay: "0.12s" }}>✦</span>
                  <span className="nk-heart text-[var(--good)]" style={{ animationDelay: "0.24s", marginLeft: 20 }}>✦</span>
                </>
              )}
            </span>
          )}
        </button>
      </div>
    </>
  );
}

type Done = { activityId: string; summary: string; href: string };

/** The question being typed to Nickel, kept until it's sent: in memory, and for this tab in case the page reloads. */
const DRAFT_KEY = "passbook-nickel-draft";
let draft: string | null = null;
function readDraft(): string {
  if (draft !== null) return draft;
  try {
    draft = sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    draft = "";
  }
  return draft;
}
function saveDraft(value: string) {
  draft = value;
  try {
    if (value) sessionStorage.setItem(DRAFT_KEY, value);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private browsing: kept in memory only.
  }
}
/** The last thing asked and his answer, shown again when the panel reopens soon after. */
let lastTalk: { youSaid: string; reply: Answer | null; at: number } | null = null;

const EXAMPLES = ["add rent $2,150 on the 1st", "upcoming vet bill $250 next friday", "new goal Japan $4,500 by June", "add $200 to the emergency fund", "student loan rate 4.5%"];

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const HOW_OFTEN: Record<string, string> = { weekly: "every week", biweekly: "every 2 weeks", monthly: "every month", quarterly: "every 3 months", semiannual: "every 6 months", yearly: "every year" };

type Plan = { body: Record<string, unknown>; read: string; form?: Partial<BillDraft> } | { ask: string } | { form: Partial<BillDraft> };

/**
 * What Nickel would do with an instruction, read back in plain words so a
 * misread can be caught before anything changes; or what to ask for when
 * something's missing.
 */
function plan(c: Command, loans: { name: string }[]): Plan {
  switch (c.kind) {
    case "bill":
    case "upcoming": {
      const form: Partial<BillDraft> = { name: c.name ?? "", amount: c.amount, frequency: c.kind === "upcoming" ? "once" : c.frequency, startDate: c.date, kind: "bill" };
      if (!c.name || !c.amount || !c.date) return { form };
      return c.kind === "upcoming"
        ? { body: { kind: "upcoming", name: c.name, amount: c.amount, date: c.date }, read: `Add an upcoming bill: ${c.name}, ${usd(c.amount)}, due ${formatShort(c.date)}.`, form }
        : // The anchor carries the day asked for ("the 31st"); the read-back says when the next one is due.
          { body: { kind: "bill", name: c.name, amount: c.amount, frequency: c.frequency, date: c.anchor ?? c.date }, read: `Add a bill: ${c.name}, ${usd(c.amount)} ${HOW_OFTEN[c.frequency]}, next on ${formatShort(c.date)}.`, form };
    }
    case "goal":
      if (!c.name) return { ask: "What’s the goal called? Like “new goal Japan $4,500 by June”." };
      if (!c.target) return { ask: `How much does “${c.name}” need? Like “new goal ${c.name} $3,000 by June”.` };
      return { body: { kind: "goal", name: c.name, target: c.target, date: c.date }, read: `Make a savings goal: ${c.name}, ${usd(c.target)}${c.date ? ` by ${formatShort(c.date)}` : ""}.` };
    case "deposit":
      if (!c.goal) return { ask: "Which goal?" };
      if (!c.amount) return { ask: `How much should I put toward “${c.goal}”? Like “add $100 to ${c.goal}”.` };
      return { body: { kind: "deposit", goal: c.goal, amount: c.amount }, read: `Put ${usd(c.amount)} toward ${c.goal}. (A note in Passbook; no money moves.)` };
    case "loan":
      if (!c.loan) return { ask: loans.length ? `Which one? ${loans.map((l) => l.name).join(", ")}.` : "I don’t see any loans or cards to change." };
      if (c.aprPercent === null && c.payment === null) return { ask: `What should change on ${c.loan}? A rate like “4.5%” or a payment like “$300 a month”.` };
      return {
        body: { kind: "loan", loan: c.loan, aprPercent: c.aprPercent, payment: c.payment },
        read: `Change ${c.loan}: ${[c.aprPercent !== null ? `${c.aprPercent}% interest` : "", c.payment !== null ? `${usd(c.payment)} a month` : ""].filter(Boolean).join(", ")}.`,
      };
    case "rename":
      if (!c.from || !c.to) return { ask: "Rename what to what? Like “rename SQ *TARTINE to Tartine”." };
      return { body: { kind: "rename", from: c.from, to: c.to, onlyAmount: c.onlyAmount }, read: `Rename “${c.from}” to “${c.to}”${c.onlyAmount ? ` (only charges of ${usd(c.onlyAmount)})` : ", for every charge like it"}.` };
  }
}

/** What he last decided about a purchase, kept for a few minutes so asking again (or pleading) gets the same answer. */
let lastVerdict: { verdict: LastVerdict; at: number } | null = null;
const rememberedVerdict = () => (lastVerdict && Date.now() - lastVerdict.at < 10 * 60_000 ? lastVerdict.verdict : null);

const VERDICT_CHIP: Record<LastVerdict["verdict"], { label: string; className: string }> = {
  yes: { label: "YES", className: "bg-mint text-mint-ink" },
  wait: { label: "NOT YET", className: "bg-canary text-canary-ink" },
  no: { label: "NO", className: "bg-pink text-pink-ink" },
};

/**
 * "Talk to me": say it or type it. Instructions ("add Netflix $15.99 on the
 * 5th") are read back and done on "yes" or "Do it", with Undo. Questions
 * ("what's left?", "can I afford a $300 jacket?") are answered from the
 * household's own numbers. Hearing uses the phone's own speech recognition
 * and he answers in the phone's own voice: no AI service, no keys, no cost.
 */
function NickelDo({ today, goals, loans, talksBack, onDone, onBill, onGoal, onLeave }: { today: string; goals: { name: string }[]; loans: { name: string }[]; talksBack: boolean; onDone: (d: Done) => void; onBill: (draft: Partial<BillDraft>) => void; onGoal: () => void; onLeave: () => void }) {
  // What's typed survives the panel closing (a stray tap on the X, nudging him) and is there when it opens again.
  const [text, setTextState] = useState(readDraft);
  const setText = (value: string) => {
    setTextState(value);
    saveDraft(value);
  };
  const [hint, setHint] = useState<string | null>(null);
  const [pending, setPending] = useState<{ body: Record<string, unknown>; read: string; form?: Partial<BillDraft>; byVoice: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  // So is the last question and his answer, for a few minutes.
  const [youSaid, setYouSaid] = useState<string | null>(() => (lastTalk && Date.now() - lastTalk.at < 10 * 60_000 ? lastTalk.youSaid : null));
  const [reply, setReply] = useState<Answer | null>(() => (lastTalk && Date.now() - lastTalk.at < 10 * 60_000 ? lastTalk.reply : null));
  const stop = useRef<() => void>(() => {});
  const quiet = useRef<() => void>(() => {});
  const input = useRef<HTMLInputElement>(null);
  /** False once the panel has closed: nothing heard or finished after that does anything. */
  const alive = useRef(true);
  /** A change is on its way to the server; a second "yes" or tap doesn't send it again. */
  const sending = useRef(false);
  /** The last thing said ("Done! …") may finish after the panel closes. */
  const letFinish = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current();
      quiet.current();
      if (!letFinish.current) hush();
    };
  }, []);

  /** Says something back: on screen always, out loud too when it was said to him. */
  const answer = (words: string, byVoice: boolean, then?: () => void) => {
    if (byVoice && talksBack) quiet.current = speak(words, () => alive.current && then?.());
    else then?.();
  };

  /** Does a read-back instruction: from the "Do it" button or a spoken "yes". Only ever once. */
  const doIt = async (body: Record<string, unknown>, byVoice: boolean) => {
    if (sending.current || !alive.current) return;
    sending.current = true;
    stop.current();
    setListening(false);
    setBusy(true);
    try {
      const done = await send<Done>("POST", "/api/nickel/do", body);
      if (byVoice && talksBack) {
        letFinish.current = true;
        speak(`Done! ${done.summary}`);
      }
      if (alive.current) onDone(done);
    } catch (err) {
      sending.current = false;
      if (!alive.current) return;
      const msg = err instanceof Error ? err.message : "That didn’t work. Try again.";
      setHint(msg);
      answer(msg, byVoice);
      setPending(null);
      setBusy(false);
    }
  };

  /** After reading an instruction back out loud, he listens for "yes" or "no". Anything unclear does nothing. */
  const hearYesNo = (next: { body: Record<string, unknown>; read: string }) => {
    if (!canListen() || !alive.current) return;
    setListening(true);
    stop.current = listen({
      onWords: () => {},
      onDone: (said) => {
        if (!alive.current) return;
        setListening(false);
        const yn = yesOrNo(said);
        if (yn === "yes") void doIt(next.body, true);
        else if (yn === "no") {
          setPending(null);
          answer("Okay, I won’t.", true);
        } else setHint("Say “yes” or “no”, or tap a button.");
      },
      onError: () => alive.current && setListening(false),
    });
  };

  const handle = async (words: string, byVoice: boolean) => {
    const said = words.trim();
    if (!said) return;
    setYouSaid(said);
    setReply(null);
    setHint(null);
    setPending(null);
    const command = parseCommand(said, { today, goals: goals.map((g) => g.name), loans: loans.map((l) => l.name) });
    if (command) {
      const next = plan(command, loans);
      if ("ask" in next) {
        setHint(next.ask);
        answer(next.ask, byVoice);
        return;
      }
      if (!("body" in next)) return onBill(next.form);
      setPending({ ...next, byVoice });
      answer(`Got it. ${next.read} Shall I do it?`, byVoice, () => byVoice && talksBack && hearYesNo(next));
      return;
    }
    // A question: answered from the household's own numbers.
    setBusy(true);
    try {
      const last = rememberedVerdict();
      const { answer: a } = await getJson<{ answer: Answer | null }>(`/api/nickel/ask?q=${encodeURIComponent(said.slice(0, 300))}${last ? `&last=${encodeURIComponent(JSON.stringify(last))}` : ""}`);
      if (!alive.current) return;
      if (!a) {
        const miss = "I didn’t catch that. Ask me what’s left to spend, what’s due, what you’ve spent on something, how a goal is doing, or “can I afford…?”. Or tell me to add a bill or a goal.";
        setHint(miss);
        answer("I didn’t catch that. Try asking what’s left to spend, or tell me to add a bill.", byVoice);
      } else {
        setReply(a);
        lastTalk = { youSaid: said, reply: a, at: Date.now() };
        if (a.verdict) lastVerdict = { verdict: a.verdict, at: Date.now() };
        answer(a.text, byVoice);
      }
    } catch (err) {
      if (alive.current) setHint(err instanceof Error ? err.message : "I couldn’t look that up just now.");
    } finally {
      if (alive.current) {
        setBusy(false);
        setText("");
      }
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void handle(text, false);
  };

  const mic = () => {
    if (listening) {
      stop.current();
      setListening(false);
      return;
    }
    if (!canListen()) {
      setHint("This browser can’t listen. Tap the box, then the microphone on your keyboard to talk.");
      input.current?.focus();
      return;
    }
    // This tap is what lets the phone speak and listen.
    prime();
    hush();
    setHint(null);
    setText("");
    setListening(true);
    stop.current = listen({
      onWords: (w) => alive.current && setText(w),
      onDone: (final) => {
        if (!alive.current) return;
        setListening(false);
        if (final.trim()) void handle(final, true);
        else setHint("I didn’t hear anything. Tap the mic and try again.");
      },
      onError: (e) => {
        if (!alive.current) return;
        setListening(false);
        setHint(e === "not-allowed" ? "I need the microphone. Allow it when your phone asks, or in your phone’s settings for this site." : e === "no-speech" ? "I didn’t hear anything. Tap the mic and try again." : "I couldn’t listen just now. Type it instead.");
      },
    });
  };

  const chip = "inline-flex min-h-10 items-center rounded-control border-2 border-line px-3 text-small font-bold text-ink-2 active:bg-sunk";
  if (pending) {
    return (
      <div className="mt-1">
        <p className="text-micro font-extrabold uppercase tracking-wide text-ink-3">Got it</p>
        <p className="mt-1 leading-relaxed">{pending.read}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void doIt(pending.body, pending.byVoice)} className="min-h-11 rounded-control bg-accent px-5 font-bold text-on-accent active:scale-[0.97] disabled:opacity-50">
            {busy ? "Doing it…" : "Do it"}
          </button>
          <button type="button" disabled={busy} onClick={() => (stop.current(), pending.form ? onBill(pending.form) : setPending(null))} className={chip}>
            Change it
          </button>
          {listening && <span className="text-small font-bold text-accent-text">Listening… say “yes” or “no”</span>}
        </div>
        {hint && <p className="mt-2 text-ink-2">{hint}</p>}
      </div>
    );
  }
  return (
    <div className="mt-1">
      {reply || youSaid ? (
        <div className="mb-2.5" aria-live="polite">
          {youSaid && <p className="text-micro font-bold text-ink-3">You: “{youSaid}”</p>}
          {reply && (
            <div className="mt-1">
              {reply.verdict && <span className={cx("mb-1 inline-block rounded-md px-2 py-0.5 text-micro font-extrabold tracking-wider", VERDICT_CHIP[reply.verdict.verdict].className)}>{VERDICT_CHIP[reply.verdict.verdict].label}</span>}
              <p className="leading-relaxed">{reply.text}</p>
              {reply.href && (
                <Link href={reply.href} onClick={onLeave} className="mt-1.5 inline-flex min-h-10 items-center rounded-control bg-accent-soft px-3.5 text-small font-bold text-accent-text">
                  {reply.link ?? "Show me"}
                </Link>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="leading-relaxed">Tap the mic and talk, or type. Ask what’s left, what’s due, what you spent this week, how much you owe or have, or “can I afford…?”. Or tell me to add something.</p>
      )}
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <Input ref={input} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="go" maxLength={300} aria-label="What should Nickel do?" placeholder={listening ? "Listening…" : "Ask or tell me…"} className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={mic}
          aria-label={listening ? "Stop listening" : "Talk to Nickel"}
          aria-pressed={listening}
          className={cx("inline-flex size-12 shrink-0 items-center justify-center rounded-control font-bold active:scale-[0.97]", listening ? "animate-pulse bg-bad text-sheet" : "bg-accent-soft text-accent-text")}
        >
          <Mic size={20} aria-hidden />
        </button>
        <button type="submit" disabled={busy || !text.trim()} className="min-h-12 shrink-0 rounded-control bg-accent px-3.5 font-bold text-on-accent active:scale-[0.97] disabled:opacity-50">
          {busy ? "…" : "Go"}
        </button>
      </form>
      {hint && (
        <p role="status" className="mt-2 leading-relaxed text-ink-2">
          {hint}
        </p>
      )}
      {/* Shortcuts and examples to start with; once you're talking, they step aside to keep the bubble small. */}
      {!youSaid && (
        <>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className={chip} onClick={() => onBill({})}>
              Add a bill
            </button>
            <button type="button" className={chip} onClick={() => onBill({ frequency: "once" })}>
              Upcoming bill
            </button>
            <button type="button" className={chip} onClick={onGoal}>
              New goal
            </button>
            <button type="button" className={chip} onClick={() => void handle("what's left to spend?", false)}>
              What’s left?
            </button>
          </div>
          <p className="mt-2.5 text-micro text-ink-3">Like: “how much did I spend this week?”, “how much do I owe?”, “can I afford a $300 jacket?”, “{EXAMPLES[1]}”. Changes I make show under Settings, Activity, with Undo.</p>
        </>
      )}
    </div>
  );
}

type ConnectorStatus = { connected: boolean; sampleKey: string | null };

/**
 * Starts a chat in the owner's own Claude app, on their own plan, with a
 * question ready. Claude reads the numbers through the read-only Passbook
 * connector; the link carries only the question.
 */
function AskClaude({ onDone }: { onDone: () => void }) {
  const { data } = useApi<ConnectorStatus>("/api/connector");
  if (!data) return <p className="mt-1 px-1 py-2 text-ink-3">One sec…</p>;
  if (!data.connected && !data.sampleKey) {
    return (
      <div className="mt-1">
        <p className="leading-relaxed">I can open a chat with Claude about your numbers, on your own Claude plan. Connect Claude once in Settings first. It can look, and it can’t change anything.</p>
        <Link href="/settings#claude" onClick={onDone} className="mt-2.5 inline-flex min-h-10 items-center rounded-control bg-accent px-4 text-small font-bold text-on-accent active:scale-[0.97]">
          Set up Claude
        </Link>
      </div>
    );
  }
  const open = (question: string) => {
    // In case Claude doesn't fill the question in, it's ready to paste.
    void navigator.clipboard?.writeText(CLAUDE_PREFIX + question).catch(() => {});
    toast("Opening Claude. Your question is copied too, in case you need to paste it.");
    onDone();
  };
  return (
    <div className="mt-1">
      <p className="px-1 pb-1 text-ink-2">Opens Claude with a question ready. Claude reads your numbers and can’t change anything.</p>
      <ul className="-mx-1 flex flex-col">
        {[...CLAUDE_QUESTIONS, ""].map((q) => (
          <li key={q || "own"}>
            <a href={claudeLink(q)} target="_blank" rel="noopener noreferrer" onClick={() => open(q)} className="flex min-h-11 items-center rounded-xl px-2 py-1.5 font-bold leading-snug active:bg-sunk">
              {q || "Ask my own question"}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center rounded-xl px-2 text-left font-bold active:bg-sunk">
        {children}
      </button>
    </li>
  );
}
