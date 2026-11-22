import { describe, expect, it } from "vitest";
import { pawPrint, planLegs } from "@/lib/nickel/walk";

const speed = { across: 100, climb: 50 };
const box = { w: 72, h: 75 };

describe("how Nickel walks from one spot to another", () => {
  it("going up, he walks across first and then climbs, never a diagonal", () => {
    const legs = planLegs({ x: 300, y: 600 }, { x: 40, y: 200 }, speed);
    expect(legs.map((l) => [l.dir, l.to])).toEqual([
      ["l", { x: 40, y: 600 }],
      ["u", { x: 40, y: 200 }],
    ]);
    expect(legs[1].from).toEqual(legs[0].to);
  });

  it("going down, he climbs down first and then walks across", () => {
    const legs = planLegs({ x: 40, y: 200 }, { x: 300, y: 600 }, speed);
    expect(legs.map((l) => [l.dir, l.to])).toEqual([
      ["d", { x: 40, y: 600 }],
      ["r", { x: 300, y: 600 }],
    ]);
  });

  it("a step too small to see is folded in, and he still ends exactly on the spot", () => {
    const across = planLegs({ x: 20, y: 600 }, { x: 320, y: 595 }, speed);
    expect(across).toHaveLength(1);
    expect(across[0]).toMatchObject({ dir: "r", to: { x: 320, y: 595 } });
    const climb = planLegs({ x: 318, y: 600 }, { x: 320, y: 300 }, speed);
    expect(climb).toHaveLength(1);
    expect(climb[0]).toMatchObject({ dir: "u", to: { x: 320, y: 300 } });
    expect(planLegs({ x: 10, y: 10 }, { x: 12, y: 13 }, speed)).toEqual([]);
  });

  it("each leg takes as long as its distance at that kind of speed: climbing is slower", () => {
    const [across, up] = planLegs({ x: 300, y: 600 }, { x: 200, y: 500 }, speed);
    expect(across.ms).toBe(1000);
    expect(up.ms).toBe(2000);
  });
});

describe("where his paw prints land", () => {
  const right = planLegs({ x: 0, y: 500 }, { x: 200, y: 500 }, speed)[0];
  const left = planLegs({ x: 200, y: 500 }, { x: 0, y: 500 }, speed)[0];
  const up = planLegs({ x: 100, y: 600 }, { x: 100, y: 200 }, speed)[0];
  const down = planLegs({ x: 100, y: 200 }, { x: 100, y: 600 }, speed)[0];

  it("walking across, front and back paws take turns along the bottom, toes pointing the way he's going", () => {
    expect(pawPrint(right, 0, 0, box)).toEqual({ x: 72 * 0.62, y: 500 + 75 * 0.9, rot: 90 });
    expect(pawPrint(right, 0, 1, box)).toEqual({ x: 72 * 0.34, y: 500 + 75 * 0.9, rot: 90 });
    expect(pawPrint(left, 0, 0, box)).toEqual({ x: 200 + 72 * 0.38, y: 500 + 75 * 0.9, rot: -90 });
  });

  it("they land where he is at that moment of the walk", () => {
    expect(pawPrint(right, 0.5, 0, box).x).toBeCloseTo(100 + 72 * 0.62);
    expect(pawPrint(up, 0.25, 0, box).y).toBeCloseTo(500 + 75 * 0.27);
  });

  it("climbing, left and right front paws take turns, toes up the screen going up and down it going down", () => {
    expect(pawPrint(up, 0, 0, box)).toEqual({ x: 100 + 72 * 0.22, y: 600 + 75 * 0.27, rot: 0 });
    expect(pawPrint(up, 0, 1, box)).toEqual({ x: 100 + 72 * 0.78, y: 600 + 75 * 0.27, rot: 0 });
    expect(pawPrint(down, 0, 0, box)).toMatchObject({ y: 200 + 75 * 0.73, rot: 180 });
  });
});
