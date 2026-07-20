import { describe, expect, it } from "vitest";
import {
  doesFootprintOverlap,
  findNextPathStep,
  findPathToAny,
  findPathRoute,
  getFootprintCells,
  getFootprintPerimeterCells,
  isFootprintWithinBounds,
  validateFootprintPlacement,
} from "./spatial";

const TWO_BY_TWO = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
] as const;

describe("footprint spatial rules", () => {
  it("resolves a 2x2 footprint from its origin without mutating the offsets", () => {
    expect(getFootprintCells({ x: 3, y: 4 }, TWO_BY_TWO)).toEqual([
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ]);
    expect(TWO_BY_TWO[0]).toEqual({ x: 0, y: 0 });
  });

  it("accepts an edge footprint and rejects cells outside map bounds", () => {
    const atEdge = getFootprintCells({ x: 3, y: 2 }, TWO_BY_TWO);
    const outside = getFootprintCells({ x: 4, y: 2 }, TWO_BY_TWO);

    expect(isFootprintWithinBounds(atEdge, 5, 4)).toBe(true);
    expect(isFootprintWithinBounds(outside, 5, 4)).toBe(false);
    expect(validateFootprintPlacement({ x: -1, y: 0 }, TWO_BY_TWO, 5, 4, [])).toMatchObject({
      ok: false,
      reason: "OUT_OF_BOUNDS",
    });
  });

  it("rejects fractional coordinates and invalid map dimensions", () => {
    expect(isFootprintWithinBounds([{ x: 1.5, y: 2 }], 5, 4)).toBe(false);
    expect(isFootprintWithinBounds([{ x: 1, y: 2 }], 0, 4)).toBe(false);
  });

  it("returns a stable unique perimeter around a 2x2 footprint", () => {
    expect(getFootprintPerimeterCells({ x: 3, y: 4 }, TWO_BY_TWO)).toEqual([
      { x: 3, y: 3 }, { x: 2, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 },
      { x: 3, y: 6 }, { x: 2, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 6 },
    ]);
  });

  it("detects resource and building occupancy while allowing open placement", () => {
    const resourceCells = [{ x: 4, y: 4 }];
    const buildingCells = getFootprintCells({ x: 7, y: 7 }, TWO_BY_TWO);
    const occupiedCells = [...resourceCells, ...buildingCells];
    const candidate = getFootprintCells({ x: 3, y: 3 }, TWO_BY_TWO);

    expect(doesFootprintOverlap(candidate, occupiedCells)).toBe(true);
    expect(validateFootprintPlacement({ x: 6, y: 6 }, TWO_BY_TWO, 12, 12, occupiedCells)).toEqual({
      ok: false,
      reason: "OCCUPIED",
      cells: [
        { x: 6, y: 6 },
        { x: 7, y: 6 },
        { x: 6, y: 7 },
        { x: 7, y: 7 },
      ],
    });
    expect(validateFootprintPlacement({ x: 1, y: 1 }, TWO_BY_TWO, 12, 12, occupiedCells).ok).toBe(true);
  });
});

describe("deterministic four-way pathfinding", () => {
  it("routes around a 2x2 obstacle with a repeatable shortest step", () => {
    const obstacle = getFootprintCells({ x: 2, y: 1 }, TWO_BY_TWO);

    expect(findNextPathStep({ x: 1, y: 2 }, { x: 4, y: 2 }, 6, 5, obstacle)).toEqual({ x: 1, y: 3 });
    expect(findNextPathStep({ x: 1, y: 2 }, { x: 4, y: 2 }, 6, 5, obstacle)).toEqual({ x: 1, y: 3 });
    expect(findPathRoute({ x: 1, y: 2 }, { x: 4, y: 2 }, 6, 5, obstacle)).toEqual({ firstStep: { x: 1, y: 3 }, distance: 5 });
  });

  it("walks to a reachable neighbor when the requested target is blocked", () => {
    const blockedTarget = [{ x: 3, y: 2 }];

    expect(findNextPathStep({ x: 0, y: 2 }, { x: 3, y: 2 }, 5, 5, blockedTarget)).toEqual({ x: 1, y: 2 });
    expect(findNextPathStep({ x: 2, y: 2 }, { x: 3, y: 2 }, 5, 5, blockedTarget)).toEqual({ x: 2, y: 2 });
  });

  it("returns null when the goal cannot be reached", () => {
    const wall = [
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ];

    expect(findNextPathStep({ x: 0, y: 2 }, { x: 4, y: 2 }, 5, 5, wall)).toBeNull();
  });

  it("finds the nearest reachable member of a target set in one deterministic search", () => {
    const wall = [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }];
    expect(findPathToAny({ x: 0, y: 2 }, [{ x: 3, y: 2 }, { x: 1, y: 4 }], 5, 5, wall)).toEqual({
      target: { x: 1, y: 4 },
      firstStep: { x: 1, y: 2 },
      distance: 3,
    });
  });
});
