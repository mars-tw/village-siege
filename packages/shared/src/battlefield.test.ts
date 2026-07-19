import { describe, expect, it } from "vitest";
import {
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_WIDTH,
  getVillageAssaultBuildBlockedCells,
  getVillageAssaultTerrainGlyph,
  getVillageAssaultWalkBlockedCells,
  isVillageAssaultBuildableCell,
  isVillageAssaultWalkableCell,
} from "./battlefield";

function key(point: { readonly x: number; readonly y: number }): string {
  return `${point.x},${point.y}`;
}

describe("village assault battlefield rules", () => {
  it("classifies terrain consistently for walking and building", () => {
    expect(getVillageAssaultTerrainGlyph({ x: 6, y: 0 })).toBe("R");
    expect(getVillageAssaultTerrainGlyph({ x: 7, y: 3 })).toBe("W");
    expect(getVillageAssaultTerrainGlyph({ x: 3, y: 2 })).toBe("M");
    expect(getVillageAssaultTerrainGlyph({ x: 3, y: 4 })).toBe("S");
    expect(getVillageAssaultTerrainGlyph({ x: 0, y: 0 })).toBe("T");
    expect(getVillageAssaultTerrainGlyph({ x: -1, y: 0 })).toBeUndefined();

    for (const blocked of [{ x: 6, y: 0 }, { x: 7, y: 3 }]) {
      expect(isVillageAssaultWalkableCell(blocked)).toBe(false);
      expect(isVillageAssaultBuildableCell(blocked)).toBe(false);
    }
    for (const open of [{ x: 3, y: 2 }, { x: 3, y: 4 }, { x: 0, y: 0 }]) {
      expect(isVillageAssaultWalkableCell(open)).toBe(true);
      expect(isVillageAssaultBuildableCell(open)).toBe(true);
    }
  });

  it("reserves a two-cell-wide walkable route that buildings cannot close", () => {
    const reservedRoute = Array.from({ length: 10 }, (_, row) => row + 3)
      .flatMap((y) => [{ x: 9, y }, { x: 10, y }]);
    const buildBlocked = new Set(getVillageAssaultBuildBlockedCells().map(key));
    const walkBlocked = new Set(getVillageAssaultWalkBlockedCells().map(key));

    expect(reservedRoute).toHaveLength(20);
    for (const point of reservedRoute) {
      expect(isVillageAssaultWalkableCell(point), `reserved route ${key(point)} must remain walkable`).toBe(true);
      expect(isVillageAssaultBuildableCell(point), `reserved route ${key(point)} must reject construction`).toBe(false);
      expect(buildBlocked.has(key(point))).toBe(true);
      expect(walkBlocked.has(key(point))).toBe(false);
    }
  });

  it("returns complete, duplicate-free blocked-cell collections within map bounds", () => {
    for (const cells of [getVillageAssaultWalkBlockedCells(), getVillageAssaultBuildBlockedCells()]) {
      expect(new Set(cells.map(key)).size).toBe(cells.length);
      expect(cells.every((point) => point.x >= 0 && point.y >= 0 && point.x < VILLAGE_ASSAULT_MAP_WIDTH && point.y < VILLAGE_ASSAULT_MAP_HEIGHT)).toBe(true);
    }
    expect(getVillageAssaultBuildBlockedCells().length).toBeGreaterThan(getVillageAssaultWalkBlockedCells().length);
  });
});
