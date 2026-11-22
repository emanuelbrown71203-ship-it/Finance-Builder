/*
 * How Nickel gets from one spot on the screen to another, the way a small dog
 * would on a wall: he walks across side-on, and climbs up or down with his belly
 * and paws flat on the glass. Never a diagonal. Going up, he walks across first
 * and climbs at the end; coming down, he climbs down first and walks across at
 * the bottom. He leaves paw prints behind him that fade (drawn in nickel.tsx).
 */

export type Point = { x: number; y: number };
/** Left, right (side-on), up, down (climbing). */
export type Dir = "l" | "r" | "u" | "d";
export type Leg = { from: Point; to: Point; dir: Dir; ms: number };

/** Shorter than this, a leg isn't worth turning for: it's folded into the other one. */
const SMALL = 12;

const across = (from: Point, to: Point): Dir => (to.x >= from.x ? "r" : "l");
const upDown = (from: Point, to: Point): Dir => (to.y <= from.y ? "u" : "d");

/** The legs of a walk, each one straight across or straight up or down. `speed` is px a second. */
export function planLegs(from: Point, to: Point, speed: { across: number; climb: number }): Leg[] {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const leg = (a: Point, b: Point, dir: Dir): Leg => {
    const climbing = dir === "u" || dir === "d";
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    return { from: a, to: b, dir, ms: Math.round((distance / (climbing ? speed.climb : speed.across)) * 1000) };
  };
  if (dx < SMALL && dy < SMALL) return [];
  if (dy < SMALL) return [leg(from, to, across(from, to))];
  if (dx < SMALL) return [leg(from, to, upDown(from, to))];
  if (to.y < from.y) {
    const corner = { x: to.x, y: from.y };
    return [leg(from, corner, across(from, corner)), leg(corner, to, "u")];
  }
  const corner = { x: from.x, y: to.y };
  return [leg(from, corner, "d"), leg(corner, to, across(corner, to))];
}

/*
 * Where his paws are in his drawing, as shares of his box: walking across, the
 * front and back paws on the near side along the bottom; climbing, the two front
 * paws near the top (near the bottom when he's heading down, upside down).
 */
const SIDE = { front: 0.62, back: 0.34, y: 0.9 };
const CLIMB = { left: 0.22, right: 0.78, y: 0.27 };

/**
 * Where a paw print lands: `step` steps into a leg, `t` of the way through it (0 to 1), with his box
 * `box` wide and tall. The point is the middle of the print, in screen px; `rot` turns the print so its
 * toes point the way he's going (0 is up the screen).
 */
export function pawPrint(leg: Leg, t: number, step: number, box: { w: number; h: number }): { x: number; y: number; rot: number } {
  const share = Math.max(0, Math.min(1, t));
  const left = leg.from.x + (leg.to.x - leg.from.x) * share;
  const top = leg.from.y + (leg.to.y - leg.from.y) * share;
  const even = step % 2 === 0;
  switch (leg.dir) {
    case "r":
      return { x: left + box.w * (even ? SIDE.front : SIDE.back), y: top + box.h * SIDE.y, rot: 90 };
    case "l":
      return { x: left + box.w * (1 - (even ? SIDE.front : SIDE.back)), y: top + box.h * SIDE.y, rot: -90 };
    case "u":
      return { x: left + box.w * (even ? CLIMB.left : CLIMB.right), y: top + box.h * CLIMB.y, rot: 0 };
    case "d":
      return { x: left + box.w * (even ? CLIMB.right : CLIMB.left), y: top + box.h * (1 - CLIMB.y), rot: 180 };
  }
}
