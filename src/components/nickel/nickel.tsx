"use client";

import { ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { INTRO, SMALL_TALK, type Mood, type Tip } from "@/lib/nickel/brain";
import { CLAUDE_PREFIX, CLAUDE_QUESTIONS, claudeLink } from "@/lib/nickel/claude";
import { parseCommand, type Command } from "@/lib/nickel/commands";
import { BillForm, type BillDraft } from "../bill-form";
import { GoalDialog } from "../goals";
import { formatShort } from "@/lib/dates";
import { dollars } from "@/lib/money";
import type { NickelPayload } from "@/server/nickel";
import { Dialog, Input, cx, toast } from "../ui";
import { send, useApi, useNow } from "../use-api";
import { RoboDog, type Eyes, type Mouth } from "./robo-dog";
import { markSeen, nickelSettings, seenToday, useNickelSettings, type NickelEvent } from "./store";

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
type Effect = "hearts" | "bang" | "question" | "sparkle";
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

  const root = useRef<HTMLDivElement>(null);
  const lastActive = useRef(0);
  const lastUnprompted = useRef(0);
  const lastEvent = useRef(0);
  const latestSeen = useRef<string | null>(null);
  const shownThisVisit = useRef(new Set<string>());
  const taps = useRef<number[]>([]);
  const press = useRef<{ x: number; y: number; t: number; timer: number; moved: boolean; held: boolean } | null>(null);
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
        if (idle > sleepAfter) {
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
  const bubbleBelow = lift > screenH / 2 - 120;
  const sideStyle = useMemo(() => {
    const bottomBase = wide ? 20 : 80;
    if (drag) return { left: drag.x - 38, top: drag.y - 40 };
    return {
      [settings.side]: wide ? 24 : 10,
      bottom: `calc(${bottomBase + lift}px + ${wide ? "0px" : "env(safe-area-inset-bottom)"})`,
    };
  }, [drag, settings.side, lift, wide]);

  if (!visible) return null;

  const eyes: Eyes = blink && look.eyes !== "sleepy" && look.eyes !== "happy" ? "sleepy" : look.eyes;

  return (
    <div ref={root} data-no-pull className={cx("nk-root fixed z-30 select-none", drag && "nk-dragging")} style={sideStyle}>
      {/* What he says */}
      {(bubble || menu) && !drag && (
        <div className={cx("nk-bubble absolute w-[min(19rem,calc(100vw-1.5rem))]", bubbleBelow ? "top-[86px]" : "bottom-[86px]", settings.side === "right" ? "right-0" : "left-0")}>
          <div role="status" aria-live="polite" className="rounded-[18px] border border-line bg-sheet p-3.5 text-small text-ink shadow-float">
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
                onDone={(done) => {
                  setMenu(false);
                  setDoing(false);
                  act("hop");
                  pop("sparkle");
                  feel("excited", 6000);
                  say({ kind: "done", text: `Done! ${done.summary}`, href: done.href, link: "See it", undo: done.activityId, sticky: true });
                }}
                onBill={(draft) => (setMenu(false), setDoing(false), setBillDraft(draft))}
                onGoal={() => (setMenu(false), setDoing(false), setNewGoal(true))}
                onLeave={() => (setMenu(false), setDoing(false))}
              />
            ) : menu ? (
              <ul className="-mx-1 mt-1 flex flex-col">
                <MenuItem onClick={() => setDoing(true)}>Tell me what to do</MenuItem>
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
                      <button type="button" onClick={() => (nickelSettings.finishIntro(), setBubble(null), act("hop"))} className="min-h-10 rounded-full bg-accent px-4 text-small font-bold text-on-accent active:scale-[0.97]">
                        Nice to meet you
                      </button>
                    ) : (
                      <>
                        {bubble.href && (
                          <Link href={bubble.href} onClick={() => setBubble(null)} className="inline-flex min-h-10 items-center rounded-full bg-accent-soft px-3.5 text-small font-bold text-accent-text active:scale-[0.97]">
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
                            className="inline-flex min-h-10 items-center rounded-full px-3 text-small font-bold text-ink-2 underline underline-offset-2 active:bg-sunk"
                          >
                            Undo
                          </button>
                        )}
                        {bubble.kind === "tip" && (
                          <button type="button" onClick={() => (act("bark"), say(nextLine()))} className="inline-flex min-h-10 items-center rounded-full px-3 text-small font-bold text-ink-2 active:bg-sunk">
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
          <span aria-hidden className={cx("absolute size-4 rotate-45 border-line bg-sheet", bubbleBelow ? "-top-[7px] border-l border-t" : "-bottom-[7px] border-b border-r", settings.side === "right" ? "right-8" : "left-8")} />
        </div>
      )}

      {data && (
        <Dialog open={billDraft !== null} onClose={() => setBillDraft(null)} title={billDraft?.frequency === "once" ? "Add an upcoming bill" : "Add a bill"}>
          {billDraft && (
            <BillForm
              today={data.today}
              draft={billDraft}
              via="nickel"
              onDone={() => {
                setBillDraft(null);
                act("hop");
                feel("excited", 5000);
              }}
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
        className="nk-btn relative block touch-none rounded-full outline-offset-4"
        style={{ ["--nk-wag" as string]: look.wag }}
      >
        <div key={action?.key} className={cx("nk-wrap", action && `nk-act-${action.name}`)} onAnimationEnd={() => setAction(null)}>
          <RoboDog
            eyes={eyes}
            mouth={action?.name === "bark" ? "open" : asleep && blink ? "yawn" : look.mouth}
            antenna={look.antenna}
            cheeks={look.cheeks}
            tongue={mood === "happy" || mood === "proud" || mood === "excited"}
            gaze={asleep ? { x: 0, y: 0 } : gaze}
            className={cx(asleep && "nk-sleep", look.ears === "down" && "nk-ears-down", look.ears === "perk" && "nk-ears-perk", tilt === -1 && "nk-tilt-l", tilt === 1 && "nk-tilt-r", twitch && `nk-twitch-${twitch}`, look.wag === "0s" && "nk-still")}
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
  );
}

type Done = { activityId: string; summary: string; href: string };

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

/**
 * "Tell me what to do": Nickel takes an instruction in plain words, reads
 * back what he understood, does it on "Do it", and reports back with Undo.
 * The words are understood right here on the phone (no AI service); when
 * something's missing he asks for just that, or opens the bill form with what
 * he understood filled in.
 */
function NickelDo({ today, goals, loans, onDone, onBill, onGoal, onLeave }: { today: string; goals: { name: string }[]; loans: { name: string }[]; onDone: (d: Done) => void; onBill: (draft: Partial<BillDraft>) => void; onGoal: () => void; onLeave: () => void }) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [pending, setPending] = useState<{ body: Record<string, unknown>; read: string; form?: Partial<BillDraft> } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setPending(null);
    const command = parseCommand(text, { today, goals: goals.map((g) => g.name), loans: loans.map((l) => l.name) });
    if (!command) return setHint(`I didn’t catch that. Try “${EXAMPLES[0]}” or “${EXAMPLES[2]}”.`);
    const next = plan(command, loans);
    if ("ask" in next) return setHint(next.ask);
    if (!("body" in next)) return onBill(next.form);
    setHint(null);
    setPending(next);
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      onDone(await send<Done>("POST", "/api/nickel/do", pending.body));
    } catch (err) {
      setHint(err instanceof Error ? err.message : "That didn’t work. Try again.");
      setPending(null);
      setBusy(false);
    }
  };

  const chip = "inline-flex min-h-10 items-center rounded-full border border-line px-3 text-small font-bold text-ink-2 active:bg-sunk";
  if (pending) {
    return (
      <div className="mt-1">
        <p className="text-micro font-extrabold uppercase tracking-wide text-ink-3">Got it</p>
        <p className="mt-1 leading-relaxed">{pending.read}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={run} className="min-h-11 rounded-full bg-accent px-5 font-bold text-on-accent active:scale-[0.97] disabled:opacity-50">
            {busy ? "Doing it…" : "Do it"}
          </button>
          <button type="button" disabled={busy} onClick={() => (pending.form ? onBill(pending.form) : setPending(null))} className={chip}>
            Change it
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1">
      <p className="leading-relaxed">What should I add or change? Say it like you’d tell a friend.</p>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus enterKeyHint="go" maxLength={300} aria-label="What should Nickel do?" placeholder="Add Netflix $15.99 on the 5th" className="min-w-0 flex-1" />
        <button type="submit" disabled={!text.trim()} className="min-h-12 shrink-0 rounded-control bg-accent px-4 font-bold text-on-accent active:scale-[0.97] disabled:opacity-50">
          Go
        </button>
      </form>
      {hint && (
        <p role="status" className="mt-2 leading-relaxed text-ink-2">
          {hint}
        </p>
      )}
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
        <Link href="/debt" onClick={onLeave} className={chip}>
          Loans
        </Link>
      </div>
      <p className="mt-2.5 text-micro text-ink-3">Like: {EXAMPLES.slice(1).map((x) => `“${x}”`).join(", ")}. Everything I do shows under Settings, Activity, with Undo.</p>
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
        <Link href="/settings#claude" onClick={onDone} className="mt-2.5 inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-small font-bold text-on-accent active:scale-[0.97]">
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
