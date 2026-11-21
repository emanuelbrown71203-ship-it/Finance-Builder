"use client";

import { cx } from "../ui";

/*
 * Nickel, drawn by hand: a small robot dog sitting up, with a screen for a
 * face. Every part that moves is its own group, so the animations in
 * globals.css (breathing, tail, ears, head, antenna) can move it on its own.
 * Colours are the app's own tokens, so he follows light and dark mode.
 */

export type Eyes = "open" | "happy" | "worried" | "sleepy" | "star" | "heart" | "curious" | "wink";
export type Mouth = "smile" | "open" | "yawn" | "flat";

const EYE_L = { x: 47, y: 38 };
const EYE_R = { x: 73, y: 38 };

function Eye({ kind, at, side }: { kind: Eyes; at: { x: number; y: number }; side: "l" | "r" }) {
  const { x, y } = at;
  const ink = "var(--on-accent)";
  if (kind === "happy" || (kind === "wink" && side === "r")) return <path className="nk-eye" d={`M${x - 4.5},${y + 2} Q${x},${y - 4.5} ${x + 4.5},${y + 2}`} fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" />;
  if (kind === "sleepy") return <path className="nk-eye" d={`M${x - 4.5},${y + 1} Q${x},${y + 3.5} ${x + 4.5},${y + 1}`} fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />;
  if (kind === "star")
    return (
      <path
        className="nk-eye"
        d={`M${x},${y - 6} L${x + 1.8},${y - 1.9} L${x + 6},${y - 1.6} L${x + 2.8},${y + 1.2} L${x + 3.8},${y + 5.4} L${x},${y + 3.1} L${x - 3.8},${y + 5.4} L${x - 2.8},${y + 1.2} L${x - 6},${y - 1.6} L${x - 1.8},${y - 1.9} Z`}
        fill={ink}
        strokeLinejoin="round"
      />
    );
  if (kind === "heart") return <path className="nk-eye" d={`M${x},${y + 4.5} C${x - 7},${y - 0.5} ${x - 3.5},${y - 6.5} ${x},${y - 2.6} C${x + 3.5},${y - 6.5} ${x + 7},${y - 0.5} ${x},${y + 4.5} Z`} fill="var(--pink-ink)" />;
  const big = kind === "curious" && side === "r";
  const h = kind === "worried" ? 8 : big ? 12.5 : 10.5;
  return (
    <g className="nk-eye">
      <rect x={x - 3.6} y={y - h / 2} width="7.2" height={h} rx="3.6" fill={ink} />
      <circle cx={x + 1.3} cy={y - h / 2 + 2.6} r="1.3" fill="var(--hero-b)" opacity="0.55" />
    </g>
  );
}

export function RoboDog({ eyes, mouth, antenna, cheeks, gaze, tongue = false, size = 72, className }: { eyes: Eyes; mouth: Mouth; antenna: string; cheeks: boolean; gaze: { x: number; y: number }; tongue?: boolean; size?: number; className?: string }) {
  const line = "var(--series-muted)";
  return (
    <svg viewBox="0 0 120 124" width={size} height={size * (124 / 120)} className={cx("nk", className)} aria-hidden>
      {/* Shadow stays on the floor while he moves */}
      <ellipse className="nk-shadow" cx="60" cy="118" rx="27" ry="4.5" fill="var(--ink)" opacity="0.12" />
      <g className="nk-float">
        {/* Tail, behind everything */}
        <g className="nk-tail">
          <path d="M80,94 C93,92 99,80 95,69" fill="none" stroke={line} strokeWidth="4" strokeLinecap="round" />
          <circle cx="95" cy="67.5" r="5" fill="var(--accent)" stroke="var(--accent-strong)" strokeWidth="1.2" />
        </g>
        {/* Haunches */}
        <ellipse cx="41" cy="100" rx="13" ry="11" fill="var(--sunk)" stroke={line} strokeWidth="1.8" />
        <ellipse cx="79" cy="100" rx="13" ry="11" fill="var(--sunk)" stroke={line} strokeWidth="1.8" />
        {/* Body */}
        <rect x="35" y="62" width="50" height="44" rx="17" fill="var(--sunk)" stroke={line} strokeWidth="1.8" />
        <rect x="47" y="73" width="26" height="19" rx="7" fill="var(--accent)" />
        <circle cx="60" cy="82.5" r="6.2" fill="var(--canary)" stroke="var(--canary-ink)" strokeWidth="1.2" />
        <text x="60" y="85.3" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="var(--canary-ink)" style={{ fontFamily: "system-ui, sans-serif" }}>
          5
        </text>
        {/* Front legs and paws */}
        <g className="nk-legs">
          <rect x="45" y="96" width="11" height="17" rx="5.5" fill="var(--sunk)" stroke={line} strokeWidth="1.8" />
          <rect x="64" y="96" width="11" height="17" rx="5.5" fill="var(--sunk)" stroke={line} strokeWidth="1.8" />
          <ellipse cx="50.5" cy="113" rx="7.5" ry="4" fill="var(--sheet)" stroke={line} strokeWidth="1.6" />
          <ellipse cx="69.5" cy="113" rx="7.5" ry="4" fill="var(--sheet)" stroke={line} strokeWidth="1.6" />
        </g>
        {/* Collar */}
        <rect x="40" y="59" width="40" height="6.5" rx="3.25" fill="var(--accent-strong)" />

        {/* Head */}
        <g className="nk-head">
          {/* Floppy ears, hinged where they meet the head */}
          <g className="nk-ear-l">
            <path d="M34,19 C23,13 11,19 11,34 C11,45 17,52 24,49 C30,46 32,37 34,28 Z" fill="var(--accent)" stroke="var(--accent-strong)" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M29,22 C21,20 16,26 16,35 C16,42 19,46 23,44 C26,41 28,34 29,27 Z" fill="var(--accent-soft)" opacity="0.55" />
          </g>
          <g className="nk-ear-r">
            <path d="M86,19 C97,13 109,19 109,34 C109,45 103,52 96,49 C90,46 88,37 86,28 Z" fill="var(--accent)" stroke="var(--accent-strong)" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M91,22 C99,20 104,26 104,35 C104,42 101,46 97,44 C94,41 92,34 91,27 Z" fill="var(--accent-soft)" opacity="0.55" />
          </g>
          {/* Antenna: its light shows his mood */}
          <line x1="60" y1="15" x2="60" y2="5.5" stroke={line} strokeWidth="2.2" strokeLinecap="round" />
          <circle className="nk-bulb-glow" cx="60" cy="4.5" r="6" fill={antenna} opacity="0.3" />
          <circle cx="60" cy="4.5" r="3.6" fill={antenna} />
          {/* Shell and face screen */}
          <rect x="22" y="14" width="76" height="52" rx="21" fill="var(--sheet)" stroke={line} strokeWidth="1.8" />
          <rect x="30" y="22.5" width="60" height="35" rx="14" fill="var(--hero-b)" />
          <path d="M37,27 Q48,24.5 58,25.5" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" opacity="0.18" />
          {cheeks && (
            <>
              <ellipse cx="38.5" cy="48" rx="4.2" ry="2.4" fill="var(--pink-ink)" opacity="0.45" />
              <ellipse cx="81.5" cy="48" rx="4.2" ry="2.4" fill="var(--pink-ink)" opacity="0.45" />
            </>
          )}
          {/* Eyes follow whatever is happening on screen */}
          <g className="nk-gaze" style={{ transform: `translate(${gaze.x.toFixed(2)}px, ${gaze.y.toFixed(2)}px)` }}>
            <Eye kind={eyes} at={EYE_L} side="l" />
            <Eye kind={eyes} at={EYE_R} side="r" />
            {eyes === "worried" && (
              <>
                <path d={`M${EYE_L.x - 5},${EYE_L.y - 9} L${EYE_L.x + 3},${EYE_L.y - 11}`} stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" />
                <path d={`M${EYE_R.x + 5},${EYE_R.y - 9} L${EYE_R.x - 3},${EYE_R.y - 11}`} stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" />
              </>
            )}
            {eyes === "curious" && <path d={`M${EYE_R.x - 4},${EYE_R.y - 11.5} Q${EYE_R.x},${EYE_R.y - 14} ${EYE_R.x + 4},${EYE_R.y - 11.5}`} fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" />}
          </g>
          {/* Nose and mouth */}
          <path d="M57.4,44.2 h5.2 l-2.6,2.7 z" fill="var(--on-accent)" strokeLinejoin="round" />
          {mouth === "smile" && tongue && <path d="M57.6,49.6 Q57.6,55.6 60,55.6 Q62.4,55.6 62.4,49.6 Z" fill="var(--pink-ink)" />}
          {mouth === "smile" && <path d="M53.5,48.2 Q56.8,51.6 60,48.6 Q63.2,51.6 66.5,48.2" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          {mouth === "flat" && <path d="M55,49.5 L65,49.5" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" />}
          {mouth === "open" && (
            <>
              <path d="M54,48.2 Q60,56.5 66,48.2 Z" fill="var(--on-accent)" />
              <path d="M57,51.5 Q60,54.5 63,51.5" fill="var(--pink-ink)" />
            </>
          )}
          {mouth === "yawn" && <ellipse cx="60" cy="51" rx="4" ry="4.6" fill="var(--on-accent)" />}
        </g>
      </g>
    </svg>
  );
}
