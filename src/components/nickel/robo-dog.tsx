"use client";

import { useId } from "react";
import type { Dir } from "@/lib/nickel/walk";
import { cx } from "../ui";

/*
 * Nickel, drawn by hand in the app's Neon Arcade style: a small robot pup
 * sitting up, with a dark visor for a face where his eyes glow, angular ears,
 * a light on his antenna that shows his mood, and a glowing coin on his chest.
 * Every part that moves is its own group, so the animations in globals.css
 * (breathing, tail, ears, head, antenna, walking legs) move it on its own.
 * He keeps the same neon colours in light and dark mode, like the app icon.
 *
 * Three poses: sitting (most of the time), side-on while he walks across the
 * screen (facing the way he's going), and climbing, when he walks up or down
 * it with his belly and paws flat on the glass, as if the screen were a window.
 */

export type Eyes = "open" | "happy" | "worried" | "sleepy" | "star" | "heart" | "curious" | "wink";
export type Mouth = "smile" | "open" | "yawn" | "flat";

const NEON = { body: "#1b1f4a", rim: "#9ba4ff", visor: "#06071a", glow: "#3dffb5", ear: "#5a8cff", pink: "#ff5fd2", coin: "#ffe45e", paw: "#2a2f66" };

/** Mood colours arrive as the app's tokens; his antenna light always shines in neon. */
const BULB: Record<string, string> = {
  "var(--good)": NEON.glow,
  "var(--pink-ink)": NEON.pink,
  "var(--sky-ink)": NEON.rim,
  "var(--warn)": NEON.coin,
  "var(--bad)": "#ff6fa8",
  "var(--series-muted)": "#6b72b8",
};

const EYE_L = { x: 47, y: 39 };
const EYE_R = { x: 73, y: 39 };

function Eye({ kind, at, side }: { kind: Eyes; at: { x: number; y: number }; side: "l" | "r" }) {
  const { x, y } = at;
  const ink = NEON.glow;
  if (kind === "happy" || (kind === "wink" && side === "r")) return <path className="nk-eye" d={`M${x - 5},${y + 2.5} Q${x},${y - 5} ${x + 5},${y + 2.5}`} fill="none" stroke={ink} strokeWidth="3.2" strokeLinecap="round" />;
  if (kind === "sleepy") return <path className="nk-eye" d={`M${x - 5},${y + 1} Q${x},${y + 3.5} ${x + 5},${y + 1}`} fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" />;
  if (kind === "star")
    return (
      <path
        className="nk-eye"
        d={`M${x},${y - 6} L${x + 1.8},${y - 1.9} L${x + 6},${y - 1.6} L${x + 2.8},${y + 1.2} L${x + 3.8},${y + 5.4} L${x},${y + 3.1} L${x - 3.8},${y + 5.4} L${x - 2.8},${y + 1.2} L${x - 6},${y - 1.6} L${x - 1.8},${y - 1.9} Z`}
        fill={NEON.coin}
        strokeLinejoin="round"
      />
    );
  if (kind === "heart") return <path className="nk-eye" d={`M${x},${y + 4.5} C${x - 7},${y - 0.5} ${x - 3.5},${y - 6.5} ${x},${y - 2.6} C${x + 3.5},${y - 6.5} ${x + 7},${y - 0.5} ${x},${y + 4.5} Z`} fill={NEON.pink} />;
  const big = kind === "curious" && side === "r";
  const h = kind === "worried" ? 7 : big ? 12 : 10;
  return <rect className="nk-eye" x={x - 3.4} y={y - h / 2} width="6.8" height={h} rx="2" fill={ink} />;
}

export function RoboDog({ eyes, mouth, antenna, cheeks, gaze, tongue = false, walk = null, size = 72, className }: { eyes: Eyes; mouth: Mouth; antenna: string; cheeks: boolean; gaze: { x: number; y: number }; tongue?: boolean; walk?: Dir | null; size?: number; className?: string }) {
  const glow = `nk-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const bulb = BULB[antenna] ?? antenna;
  const f = `url(#${glow})`;
  return (
    <svg viewBox="0 0 120 124" width={size} height={size * (124 / 120)} className={cx("nk", className)} aria-hidden>
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {walk === "l" || walk === "r" ? (
        <SideOn f={f} bulb={bulb} eyes={eyes} cheeks={cheeks} facing={walk} />
      ) : walk === "u" || walk === "d" ? (
        <Climbing f={f} bulb={bulb} eyes={eyes} heading={walk} />
      ) : (
        <Sitting f={f} bulb={bulb} eyes={eyes} mouth={mouth} cheeks={cheeks} gaze={gaze} tongue={tongue} />
      )}
    </svg>
  );
}

type Parts = { f: string; bulb: string; eyes: Eyes };

/** Sitting up, facing you: how he spends most of his time. */
function Sitting({ f, bulb, eyes, mouth, cheeks, gaze, tongue }: Parts & { mouth: Mouth; cheeks: boolean; gaze: { x: number; y: number }; tongue: boolean }) {
  return (
    <>
      {/* A glow on the floor that stays put while he moves */}
      <ellipse className="nk-shadow" cx="60" cy="118" rx="27" ry="4.5" fill="var(--nk-floor)" />
      <g className="nk-float">
        {/* Tail, behind everything: a neon cable with a light on the end */}
        <g className="nk-tail">
          <path d="M80,94 C93,92 99,80 95,69" fill="none" stroke={NEON.ear} strokeWidth="4" strokeLinecap="round" />
          <circle cx="95" cy="67.5" r="4.6" fill={NEON.pink} filter={f} />
        </g>
        {/* Haunches */}
        <ellipse cx="41" cy="100" rx="13" ry="11" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.2" />
        <ellipse cx="79" cy="100" rx="13" ry="11" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.2" />
        {/* Body, with his glowing coin (a nickel, of course) */}
        <rect x="36" y="63" width="48" height="43" rx="14" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.4" />
        <rect x="46" y="73" width="28" height="20" rx="7" fill={NEON.visor} stroke={NEON.glow} strokeWidth="1.2" />
        <circle cx="60" cy="83" r="6.4" fill={NEON.coin} filter={f} />
        <text x="60" y="85.8" textAnchor="middle" fontSize="7.5" fontWeight="800" fill={NEON.visor} style={{ fontFamily: "system-ui, sans-serif" }}>
          5
        </text>
        {/* Front legs and paws */}
        <g className="nk-legs">
          {/* Each leg steps on its own when he trots */}
          <g className="nk-leg-l">
            <rect x="45" y="96" width="11" height="17" rx="4" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.2" />
            <ellipse cx="50.5" cy="113" rx="7.5" ry="4" fill={NEON.paw} stroke={NEON.rim} strokeWidth="1.8" />
          </g>
          <g className="nk-leg-r">
            <rect x="64" y="96" width="11" height="17" rx="4" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.2" />
            <ellipse cx="69.5" cy="113" rx="7.5" ry="4" fill={NEON.paw} stroke={NEON.rim} strokeWidth="1.8" />
          </g>
        </g>
        {/* Collar: a strip of light */}
        <rect x="41" y="60" width="38" height="5" rx="2.5" fill={NEON.glow} filter={f} />

        {/* Head */}
        <g className="nk-head">
          {/* Pointed ears, hinged where they meet the head */}
          <g className="nk-ear-l">
            <path d="M27,24 L11,3 L43,15 Z" fill={NEON.ear} fillOpacity="0.22" stroke={NEON.ear} strokeWidth="2.6" strokeLinejoin="round" filter={f} />
          </g>
          <g className="nk-ear-r">
            <path d="M93,24 L109,3 L77,15 Z" fill={NEON.ear} fillOpacity="0.22" stroke={NEON.ear} strokeWidth="2.6" strokeLinejoin="round" filter={f} />
          </g>
          {/* Antenna: its light shows his mood */}
          <line x1="60" y1="15" x2="60" y2="5.5" stroke={NEON.rim} strokeWidth="2.4" strokeLinecap="round" />
          <circle className="nk-bulb-glow" cx="60" cy="4.5" r="6.5" fill={bulb} opacity="0.35" />
          <circle cx="60" cy="4.5" r="3.8" fill={bulb} filter={f} />
          {/* Shell and visor */}
          <rect x="22" y="14" width="76" height="52" rx="18" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.6" />
          <rect x="30" y="22.5" width="60" height="35" rx="12" fill={NEON.visor} stroke={NEON.glow} strokeWidth="1.6" />
          <path d="M37,27 Q48,24.5 58,25.5" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.14" />
          {cheeks && (
            <>
              <ellipse cx="38" cy="49" rx="4.2" ry="2.3" fill={NEON.pink} opacity="0.55" />
              <ellipse cx="82" cy="49" rx="4.2" ry="2.3" fill={NEON.pink} opacity="0.55" />
            </>
          )}
          {/* Eyes glow and follow whatever is happening on screen */}
          <g className="nk-gaze" filter={f} style={{ transform: `translate(${gaze.x.toFixed(2)}px, ${gaze.y.toFixed(2)}px)` }}>
            <Eye kind={eyes} at={EYE_L} side="l" />
            <Eye kind={eyes} at={EYE_R} side="r" />
            {eyes === "worried" && (
              <>
                <path d={`M${EYE_L.x - 5},${EYE_L.y - 8} L${EYE_L.x + 3},${EYE_L.y - 10.5}`} stroke={NEON.glow} strokeWidth="2.2" strokeLinecap="round" />
                <path d={`M${EYE_R.x + 5},${EYE_R.y - 8} L${EYE_R.x - 3},${EYE_R.y - 10.5}`} stroke={NEON.glow} strokeWidth="2.2" strokeLinecap="round" />
              </>
            )}
            {eyes === "curious" && <path d={`M${EYE_R.x - 4},${EYE_R.y - 11} Q${EYE_R.x},${EYE_R.y - 13.5} ${EYE_R.x + 4},${EYE_R.y - 11}`} fill="none" stroke={NEON.glow} strokeWidth="2.2" strokeLinecap="round" />}
          </g>
          {/* Mouth, lit on the visor */}
          <g filter={f}>
            {mouth === "smile" && tongue && <path d="M57.6,50.4 Q57.6,55.6 60,55.6 Q62.4,55.6 62.4,50.4 Z" fill={NEON.pink} />}
            {mouth === "smile" && <path d="M53.5,48.6 Q56.8,52 60,49 Q63.2,52 66.5,48.6" fill="none" stroke={NEON.glow} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
            {mouth === "flat" && <path d="M55,50 L65,50" stroke={NEON.glow} strokeWidth="2.2" strokeLinecap="round" />}
            {mouth === "open" && (
              <>
                <path d="M54,48.4 Q60,56.5 66,48.4 Z" fill={NEON.glow} />
                <path d="M57,51.6 Q60,54.4 63,51.6" fill={NEON.pink} />
              </>
            )}
            {mouth === "yawn" && <ellipse cx="60" cy="51" rx="4" ry="4.4" fill={NEON.glow} />}
          </g>
        </g>
      </g>
    </>
  );
}

/** One eye seen from the side or from below: open, a happy arc, or shut. */
function SmallEye({ kind, x, y, h = 10 }: { kind: Eyes; x: number; y: number; h?: number }) {
  if (kind === "happy" || kind === "wink") return <path d={`M${x - 4},${y + 2} Q${x},${y - 4} ${x + 4},${y + 2}`} fill="none" stroke={NEON.glow} strokeWidth="2.8" strokeLinecap="round" />;
  if (kind === "sleepy") return <path d={`M${x - 4},${y + 0.5} Q${x},${y + 3} ${x + 4},${y + 0.5}`} fill="none" stroke={NEON.glow} strokeWidth="2.6" strokeLinecap="round" />;
  return <rect x={x - 3} y={y - h / 2} width="6" height={h} rx="2" fill={kind === "heart" ? NEON.pink : kind === "star" ? NEON.coin : NEON.glow} />;
}

/**
 * Walking across: side-on, facing the way he's going. His legs swing in a trot
 * (each near leg with the far one diagonally opposite), the far ones darker.
 */
function SideOn({ f, bulb, eyes, cheeks, facing }: Parts & { cheeks: boolean; facing: "l" | "r" }) {
  const leg = (x: number, near: boolean, pair: "a" | "b") => (
    <g className={`nk-sl-${pair}`}>
      <rect x={x - 4.5} y="84" width="9" height="24" rx="4" fill={near ? NEON.body : "#12153a"} stroke={NEON.rim} strokeOpacity={near ? 1 : 0.5} strokeWidth="2.2" />
      <ellipse cx={x + 1.5} cy="109.5" rx="7" ry="3.8" fill={near ? NEON.paw : "#0e1030"} stroke={NEON.rim} strokeOpacity={near ? 1 : 0.5} strokeWidth="1.8" />
    </g>
  );
  return (
    // Drawn facing right; facing left is the same drawing turned around.
    <g transform={facing === "l" ? "translate(120 0) scale(-1 1)" : undefined}>
      <ellipse className="nk-shadow" cx="62" cy="116" rx="36" ry="4.5" fill="var(--nk-floor)" />
      <g className="nk-float">
        <g className="nk-tail-s">
          <path d="M28,70 C18,68 12,58 14,47" fill="none" stroke={NEON.ear} strokeWidth="4" strokeLinecap="round" />
          <circle cx="14" cy="45.5" r="4.4" fill={NEON.pink} filter={f} />
        </g>
        {leg(44, false, "a")}
        {leg(80, false, "b")}
        <rect x="26" y="58" width="60" height="32" rx="15" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.4" />
        <rect x="34" y="66" width="30" height="16" rx="6" fill={NEON.visor} stroke={NEON.glow} strokeWidth="1.1" />
        <circle cx="49" cy="74" r="5.2" fill={NEON.coin} filter={f} />
        <rect x="68" y="57" width="6" height="30" rx="3" fill={NEON.glow} filter={f} />
        {leg(36, true, "b")}
        {leg(72, true, "a")}
        <g className="nk-head">
          <g className="nk-ear-l">
            <path d="M68,26 L58,4 L84,17 Z" fill={NEON.ear} fillOpacity="0.22" stroke={NEON.ear} strokeWidth="2.6" strokeLinejoin="round" filter={f} />
          </g>
          <line x1="90" y1="18" x2="90" y2="9" stroke={NEON.rim} strokeWidth="2.4" strokeLinecap="round" />
          <circle className="nk-bulb-glow" cx="90" cy="7.5" r="6" fill={bulb} opacity="0.35" />
          <circle cx="90" cy="7.5" r="3.6" fill={bulb} filter={f} />
          <rect x="62" y="17" width="46" height="45" rx="15" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.6" />
          <rect x="80" y="25" width="25" height="29" rx="9.5" fill={NEON.visor} stroke={NEON.glow} strokeWidth="1.5" />
          <path d="M68,24 Q74,21.5 80,22" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.14" />
          {cheeks && <ellipse cx="88.5" cy="49" rx="3" ry="1.8" fill={NEON.pink} opacity="0.55" />}
          <g filter={f}>
            <SmallEye kind={eyes} x={97} y={39.5} h={11} />
            <path d="M92,49.5 Q96.5,53 101,49.5" fill="none" stroke={NEON.glow} strokeWidth="2" strokeLinecap="round" />
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * Climbing up or down the screen, seen through the glass: his belly and the
 * pads of all four paws pressed flat on it, legs spread, tail hanging, ears and
 * the top of his visor at the front. His paws move in diagonal pairs.
 */
function Climbing({ f, bulb, eyes, heading }: Parts & { heading: "u" | "d" }) {
  const paw = (x: number, y: number) => (
    <>
      <ellipse cx={x} cy={y} rx="8" ry="7.5" fill={NEON.paw} stroke={NEON.rim} strokeWidth="1.8" />
      <g filter={f} fill={NEON.glow}>
        <ellipse cx={x} cy={y + 1.8} rx="3.4" ry="2.6" />
        <circle cx={x - 3.6} cy={y - 2.6} r="1.5" />
        <circle cx={x} cy={y - 4} r="1.5" />
        <circle cx={x + 3.6} cy={y - 2.6} r="1.5" />
      </g>
    </>
  );
  const limb = (from: [number, number], to: [number, number], pair: "a" | "b") => (
    <g className={`nk-cl-${pair}`}>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={NEON.rim} strokeWidth="12" strokeLinecap="round" />
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={NEON.body} strokeWidth="8" strokeLinecap="round" />
      {paw(to[0], to[1])}
    </g>
  );
  return (
    // Drawn heading up; heading down is the same drawing turned upside down (head first, like a dog would).
    <g transform={heading === "d" ? "rotate(180 60 62)" : undefined}>
      <g className="nk-float">
        <g className="nk-tail-c">
          <path d="M60,96 C57,104 63,110 60,115" fill="none" stroke={NEON.ear} strokeWidth="4" strokeLinecap="round" />
          <circle cx="60" cy="117" r="4.2" fill={NEON.pink} filter={f} />
        </g>
        {limb([44, 54], [25, 36], "a")}
        {limb([76, 88], [95, 103], "a")}
        {limb([76, 54], [95, 36], "b")}
        {limb([44, 88], [25, 103], "b")}
        <rect x="38" y="40" width="44" height="60" rx="20" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.4" />
        <rect x="47" y="50" width="26" height="42" rx="12" fill="#262b66" />
        <path d="M53,76 H67 M53,81 H67 M53,86 H67" stroke={NEON.rim} strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
        <circle cx="60" cy="61" r="6.2" fill={NEON.coin} filter={f} />
        <text x="60" y="63.8" textAnchor="middle" fontSize="7.5" fontWeight="800" fill={NEON.visor} transform={heading === "d" ? "rotate(180 60 61)" : undefined} style={{ fontFamily: "system-ui, sans-serif" }}>
          5
        </text>
        <rect x="43" y="41" width="34" height="4.5" rx="2.2" fill={NEON.glow} filter={f} />
        <g className="nk-head">
          <g className="nk-ear-l">
            <path d="M40,24 L25,4 L52,14 Z" fill={NEON.ear} fillOpacity="0.22" stroke={NEON.ear} strokeWidth="2.6" strokeLinejoin="round" filter={f} />
          </g>
          <g className="nk-ear-r">
            <path d="M80,24 L95,4 L68,14 Z" fill={NEON.ear} fillOpacity="0.22" stroke={NEON.ear} strokeWidth="2.6" strokeLinejoin="round" filter={f} />
          </g>
          <line x1="60" y1="9" x2="60" y2="4" stroke={NEON.rim} strokeWidth="2.4" strokeLinecap="round" />
          <circle className="nk-bulb-glow" cx="60" cy="2.5" r="5.5" fill={bulb} opacity="0.35" />
          <circle cx="60" cy="2.5" r="3.4" fill={bulb} filter={f} />
          <rect x="34" y="8" width="52" height="38" rx="16" fill={NEON.body} stroke={NEON.rim} strokeWidth="2.6" />
          <rect x="41" y="12" width="38" height="15" rx="7.5" fill={NEON.visor} stroke={NEON.glow} strokeWidth="1.5" />
          {/* His eyes peek out of the top of his visor, looking where he's climbing. */}
          <g filter={f}>
            <SmallEye kind={eyes} x={52.5} y={19} h={8} />
            <SmallEye kind={eyes === "wink" ? "open" : eyes} x={67.5} y={19} h={8} />
          </g>
        </g>
      </g>
    </g>
  );
}
