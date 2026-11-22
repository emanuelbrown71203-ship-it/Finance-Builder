import type { BadgeId } from "@/lib/game/progress";

/*
 * Little pixel pictures for badges and the streak, drawn as squares on a
 * 12 by 12 grid (the way old handhelds drew them), in the app's own colours.
 * Each letter in a picture is a colour from its palette; "." is empty.
 */

type Art = { rows: string[]; colors: Record<string, string> };

const WHITE = "var(--on-accent)";

const FLAME = [
  ".....e......",
  "....ee......",
  "....eae.....",
  "...eaaee....",
  "...eaaae.e..",
  "..eaabaaeee.",
  "..eaabbaaae.",
  ".eaabbbbaae.",
  ".eabbbbbbae.",
  ".eabbbcbbae.",
  "..eabbbbae..",
  "...eeeeee...",
];

const ART: Record<BadgeId | "flame" | "coin", Art> = {
  "first-win": {
    rows: [
      ".....ab.....",
      ".....ab.....",
      "....aabb....",
      "....aabb....",
      "aaaaaabbbbbb",
      ".aaaaabbbbb.",
      "..aaaabbbb..",
      "...aaabbb...",
      "...aaabbb...",
      "..aaa..bbb..",
      "..aa....bb..",
      ".a........b.",
    ],
    colors: { a: "var(--series-4)", b: "var(--c-budget)" },
  },
  sorter: {
    rows: [
      "............",
      "............",
      "....aaaaaaa.",
      "...aaaaaaaab",
      "..aaaaaaaaab",
      ".aacaaaaaaab",
      "..aaaaaaaaab",
      "...aaaaaaaab",
      "....bbbbbbb.",
      "............",
      "............",
      "............",
    ],
    colors: { a: "var(--c-activity)", b: "var(--sky-ink)", c: WHITE },
  },
  "name-tamer": {
    rows: [
      ".........ee.",
      "........eeee",
      ".......aaee.",
      "......aaab..",
      ".....aaab...",
      "....aaab....",
      "...aaab.....",
      "..aaab......",
      ".ddab.......",
      ".ddb........",
      ".d..........",
      "............",
    ],
    colors: { a: "var(--series-4)", b: "var(--c-budget)", d: "var(--ink-2)", e: "var(--c-bills)" },
  },
  slayer: {
    rows: [
      "..........aa",
      ".........aca",
      "........aca.",
      ".......aca..",
      "......aca...",
      "..b..aca....",
      "...baca.....",
      "....bb......",
      "...bbbb.....",
      "..ee..b.....",
      ".ee.........",
      "ee..........",
    ],
    colors: { a: "var(--c-accounts)", b: "var(--series-4)", c: "var(--sky)", e: "var(--c-bills)" },
  },
  "goal-getter": {
    rows: [
      ".dd.........",
      ".ddaaaaaa...",
      ".ddaaaaaaaa.",
      ".ddaacaaaaa.",
      ".ddaaaaaaab.",
      ".ddaaaabbbb.",
      ".dd.........",
      ".dd.........",
      ".dd.........",
      ".dd.........",
      "dddd........",
      "dddd........",
    ],
    colors: { a: "var(--c-savings)", b: "var(--series-3)", c: WHITE, d: "var(--ink-3)" },
  },
  saver: {
    rows: [
      "...aaaaaa...",
      "..acccaaab..",
      "..abbbbbbb..",
      "..aaaaaaab..",
      "..abbbbbbb..",
      "..aaaaaaab..",
      "..abbbbbbb..",
      "..aaaaaaab..",
      "..abbbbbbb..",
      "..aaaaaaab..",
      "...bbbbbb...",
      "............",
    ],
    colors: { a: "var(--series-4)", b: "var(--c-budget)", c: WHITE },
  },
  milestone: {
    rows: [
      "......ee....",
      "......eee...",
      "......d.....",
      ".....acb....",
      "....acccb...",
      "....aaabb...",
      "...aaaaabb..",
      "..aaaaaabbb.",
      "..aaaaabbbb.",
      ".aaaaaabbbbb",
      "aaaaaaabbbbb",
      "aaaaaaabbbbb",
    ],
    colors: { a: "var(--c-worth)", b: "var(--sky-ink)", c: WHITE, d: "var(--ink-3)", e: "var(--c-bills)" },
  },
  "budget-boss": {
    rows: [
      "............",
      "a....a....a.",
      "aa..aaa..aa.",
      "aaa.aea.aaa.",
      "aaaaaaaaaaa.",
      "aaaaaaaaaab.",
      "abbbbbbbbbb.",
      "aeaafaaeaab.",
      "aaaaaaaaaab.",
      ".bbbbbbbbb..",
      "............",
      "............",
    ],
    colors: { a: "var(--series-4)", b: "var(--c-budget)", e: "var(--c-bills)", f: "var(--c-activity)" },
  },
  planner: {
    rows: [
      "....dddd....",
      "..bbddddbb..",
      "..bccccccb..",
      "..bceccddb..",
      "..beeccccb..",
      "..bccccccb..",
      "..bceccddb..",
      "..beeccccb..",
      "..bccccccb..",
      "..bccccccb..",
      "..bbbbbbbb..",
      "............",
    ],
    colors: { b: "var(--c-budget)", c: WHITE, d: "var(--ink-3)", e: "var(--series-3)" },
  },
  "streak-7": { rows: FLAME, colors: { a: "var(--c-budget)", b: "var(--series-4)", c: WHITE, e: "var(--c-bills)" } },
  // Hotter: the same flame, burning blue with a white-hot middle.
  "streak-30": { rows: FLAME, colors: { a: "var(--c-activity)", b: WHITE, c: "var(--c-activity)", e: "var(--c-worth)" } },
  "no-spend-ninja": {
    rows: [
      "...aaaaaa...",
      "..aaaaaaaa..",
      ".aaaaaaaaaa.",
      ".eeeeeeeeeee",
      ".aaaaaaaaaae",
      ".acccaaccca.",
      ".acdcaacdca.",
      ".aaaaaaaaaa.",
      ".aaaaaaaaaa.",
      "..aaaaaaaa..",
      "...aaaaaa...",
      "............",
    ],
    colors: { a: "var(--ink-2)", c: WHITE, d: "var(--ink)", e: "var(--c-bills)" },
  },
  "level-5": {
    rows: [
      ".aaaaaaaaab.",
      ".acaaaaaabb.",
      ".aaaacaaabb.",
      ".aaacccaabb.",
      ".aacccccabb.",
      ".aaacccaabb.",
      ".aacaacabbb.",
      "..aaaaabbb..",
      "..aaaaabbb..",
      "...aaabbb...",
      "....aabb....",
      ".....ab.....",
    ],
    colors: { a: "var(--c-worth)", b: "var(--sky-ink)", c: WHITE },
  },
  "level-10": {
    rows: [
      ".aaaaaaaaab.",
      "aaacaaaaabbb",
      "a.acaaaaab.b",
      "a.aaaaaaab.b",
      ".aaaaaaaab..",
      "..aaaaaab...",
      "...aaaab....",
      "....aab.....",
      "....aab.....",
      "...dddddd...",
      "..dddddddd..",
      "..dddddddd..",
    ],
    colors: { a: "var(--series-4)", b: "var(--c-budget)", c: WHITE, d: "var(--c-accounts)" },
  },
  flame: { rows: FLAME, colors: { a: "var(--c-budget)", b: "var(--series-4)", c: WHITE, e: "var(--c-bills)" } },
  coin: {
    rows: [
      "...aaaaaa...",
      "..aaccaaab..",
      ".aacaaaaabb.",
      ".acaaabaabb.",
      ".acaaabaabb.",
      ".aaaaabaabb.",
      ".aaaaabaabb.",
      ".aaaaaaaabb.",
      ".aaaaaaabbb.",
      "..abbbbbbb..",
      "...bbbbbb...",
      "............",
    ],
    colors: { a: "var(--series-4)", b: "var(--c-budget)", c: WHITE },
  },
};

export type SpriteId = keyof typeof ART;

/** One pixel picture. `locked` draws it as a grey outline of itself: not won yet. */
export function Sprite({ id, size = 48, locked = false, className }: { id: SpriteId; size?: number; locked?: boolean; className?: string }) {
  const art = ART[id];
  const cells: { x: number; y: number; fill: string }[] = [];
  art.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      cells.push({ x, y, fill: locked ? "var(--line)" : (art.colors[ch] ?? "var(--ink-3)") });
    }),
  );
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden className={className}>
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} fill={c.fill} />
      ))}
    </svg>
  );
}
