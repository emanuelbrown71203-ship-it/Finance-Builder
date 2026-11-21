"use client";

import { nickelReact } from "./nickel/store";
import { ArrowDown, Check, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { send } from "./use-api";

/*
 * Pull down at the top of any screen to refresh, the same as in the owner's
 * other apps (an app saved to the home screen has no browser refresh button).
 * It asks the banks for anything new, reloads every number on screen and, if
 * a newer version of the app has come out, loads it.
 *
 * The browser's own pull is switched off in globals.css (overscroll-behavior),
 * so there is only ever this one.
 */

/** How far the pill has to come down before letting go refreshes. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 110;

/** Pulls that start here are not refreshes: an open pop-up, a box being typed in, anything marked data-no-pull. */
const NOT_A_PULL = "dialog[open], input, textarea, select, [contenteditable='true'], [data-no-pull]";

/** How far the pill shows for a finger that has moved `dy` pixels down: it lags behind, then stops. */
export const pullDistance = (dy: number) => Math.max(0, Math.min(PULL_MAX, dy * 0.5));

/** True when the server is running a newer build than this page. */
async function newerVersionIsOut(): Promise<boolean> {
  const running = process.env.NEXT_PUBLIC_BUILD_ID;
  if (!running) return false;
  try {
    const response = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
    const { build } = (await response.json()) as { build: string | null };
    return Boolean(build && build !== running);
  } catch {
    return false;
  }
}

/** Refresh everything. Resolves "reload" when a newer app version is being loaded instead. */
export async function refreshApp(): Promise<"reload" | "done"> {
  if (await newerVersionIsOut()) {
    window.location.reload();
    return "reload";
  }
  // Pulls the latest from every linked bank, then reloads every screen's data.
  await send("POST", "/api/sync").catch(() => {});
  nickelReact({ type: "refreshed" });
  return "done";
}

type Phase = "idle" | "pulling" | "ready" | "refreshing" | "updating" | "done";

const LABEL: Record<Exclude<Phase, "idle">, string> = {
  pulling: "Pull to refresh",
  ready: "Let go to refresh",
  refreshing: "Refreshing",
  updating: "Getting the latest version",
  done: "Up to date",
};

export function PullToRefresh({ onRefresh = refreshApp }: { onRefresh?: () => Promise<"reload" | "done"> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pull, setPull] = useState(0);
  // Held in a ref so a new function on each render never resets a pull that is under way.
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let shown = 0;
    let busy = false;
    const show = (d: number) => {
      shown = d;
      setPull(d);
      setPhase(d === 0 ? "idle" : d >= PULL_THRESHOLD ? "ready" : "pulling");
    };

    const begin = (e: TouchEvent) => {
      start = null;
      if (busy || e.touches.length !== 1 || window.scrollY > 0) return;
      if (e.target instanceof Element && e.target.closest(NOT_A_PULL)) return;
      if (document.querySelector("dialog[open]")) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = e.touches[0].clientX - start.x;
      // A sideways swipe or a scroll down the page is not a pull.
      if (dy < -8 || (Math.abs(dx) > 24 && Math.abs(dx) > dy) || window.scrollY > 0) {
        start = null;
        if (shown) show(0);
        return;
      }
      show(pullDistance(dy));
    };
    const end = async () => {
      if (!start) return;
      start = null;
      if (shown < PULL_THRESHOLD) {
        if (shown) show(0);
        return;
      }
      busy = true;
      shown = PULL_THRESHOLD;
      setPull(PULL_THRESHOLD);
      setPhase("refreshing");
      const result = await refresh.current();
      if (result === "reload") {
        setPhase("updating");
        return;
      }
      setPhase("done");
      setTimeout(() => {
        shown = 0;
        setPull(0);
        setPhase("idle");
        busy = false;
      }, 700);
    };

    window.addEventListener("touchstart", begin, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", begin);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (phase === "idle") return null;
  const settling = phase === "refreshing" || phase === "updating" || phase === "done";
  return (
    <div className={`pull ${phase}${settling ? " settling" : ""}`} style={{ transform: `translate(-50%, ${pull - 44}px)`, opacity: Math.min(1, pull / PULL_THRESHOLD + 0.2) }} role="status" aria-live="polite">
      <span className={`pull-circle${phase === "refreshing" || phase === "updating" ? " spinning" : ""}`}>
        {phase === "done" ? <Check size={15} strokeWidth={3} /> : settling ? <RefreshCw size={15} /> : <ArrowDown size={15} style={{ transform: `rotate(${phase === "ready" ? 180 : 0}deg)`, transition: "transform 0.15s ease" }} />}
      </span>
      <span>{LABEL[phase]}</span>
    </div>
  );
}
