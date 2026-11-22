import { cx } from "../ui";

/*
 * The two retro pieces everything else is built from: the level block (a
 * chunky square with the level in a pixel face, like a handheld's score) and
 * the XP bar (blocks that fill one at a time, like an old health bar).
 */

export function LevelBlock({ level, size = 48, fresh = false, className }: { level: number; size?: number; fresh?: boolean; className?: string }) {
  const big = size >= 64;
  return (
    <span
      role="img"
      aria-label={`Level ${level}`}
      className={cx("inline-flex shrink-0 flex-col items-center justify-center gap-1 bg-accent text-on-accent", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size / 5), boxShadow: `inset 0 -${Math.max(3, Math.round(size / 14))}px 0 var(--accent-strong)` }}
    >
      <span aria-hidden className="pixel opacity-80" style={{ fontSize: big ? 10 : 8 }}>
        LV
      </span>
      <span aria-hidden className={cx("pixel", fresh && "lv-new")} style={{ fontSize: level >= 100 ? (big ? 16 : 10) : big ? 24 : 16 }}>
        {level}
      </span>
    </span>
  );
}

/** XP toward the next level, as blocks. Each block is an equal share; the last one fills only when the level's done. */
export function XpBar({ into, needed, blocks = 10, label = "XP toward the next level", className }: { into: number; needed: number; blocks?: number; label?: string; className?: string }) {
  const share = needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
  const filled = Math.floor(share * blocks);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={needed} aria-valuenow={Math.min(into, needed)} aria-valuetext={`${into} of ${needed} XP`} className={cx("flex gap-[3px]", className)}>
      {Array.from({ length: blocks }, (_, i) => (
        <span key={i} className={cx("h-2.5 flex-1 rounded-[2px]", i < filled ? "bg-[var(--series-4)]" : "bg-sunk ring-1 ring-inset ring-line")} />
      ))}
    </div>
  );
}
