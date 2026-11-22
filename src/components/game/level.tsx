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
      className={cx("lv-block inline-flex shrink-0 flex-col items-center justify-center gap-1", className)}
      style={{ width: size, height: size, borderRadius: Math.max(6, Math.round(size / 7)) }}
    >
      <span aria-hidden className="pixel lv-label" style={{ fontSize: big ? 10 : 8 }}>
        LV
      </span>
      <span aria-hidden className={cx("pixel lv-num", fresh && "lv-new")} style={{ fontSize: level >= 100 ? (big ? 16 : 10) : big ? 24 : 16 }}>
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
        <span key={i} className={cx("h-2.5 flex-1 rounded-[2px]", i < filled ? "block-on" : "border border-line bg-sunk")} style={i < filled ? { background: "var(--xp)", color: "var(--xp)" } : undefined} />
      ))}
    </div>
  );
}

/** The level as a small pixel block: the You tab's icon, so your level is in view on every screen. */
export function LevelChip({ level, size = 24 }: { level: number | null; size?: number }) {
  return (
    <span aria-hidden className="lv-block lv-chip inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size / 5)) }}>
      <span className="pixel lv-num" style={{ fontSize: level !== null && level >= 10 ? Math.round(size / 3) : Math.round(size / 2.4) }}>
        {level ?? ""}
      </span>
    </span>
  );
}

/** A small "+50 XP" on a button that earns some, so the win is in view before it's done. */
export function XpTag({ xp, className }: { xp: number; className?: string }) {
  return (
    <span aria-label={`earns ${xp} XP`} className={cx("pixel ml-1 text-[8px] leading-none opacity-80", className)}>
      +{xp} XP
    </span>
  );
}
