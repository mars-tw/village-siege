import { describe, expect, it } from "vitest";
import {
  VILLAGE_ASSAULT_LAYOUTS,
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ROWS,
  VILLAGE_ASSAULT_MAP_WIDTH,
  getVillageAssaultLayout,
  getVillageAssaultBuildBlockedCells,
  getVillageAssaultTerrainGlyph,
  getVillageAssaultWalkBlockedCells,
  isVillageAssaultBuildableCell,
  isVillageAssaultWalkableCell,
  validateVillageAssaultLayout,
  validateVillageAssaultLayouts,
  type VillageAssaultLayoutId,
} from "./battlefield";
import { MONSTER_IDS } from "./combat";
import { getBuildingFootprint } from "./content";

function key(point: { readonly x: number; readonly y: number }): string {
  return `${point.x},${point.y}`;
}

describe("village assault battlefield rules", () => {
  it("uses a larger battlefield with readable terrain and three wide crossing lanes", () => {
    expect(VILLAGE_ASSAULT_MAP_WIDTH).toBe(32);
    expect(VILLAGE_ASSAULT_MAP_HEIGHT).toBe(24);
    expect(getVillageAssaultTerrainGlyph({ x: 15, y: 4 }, "pinehold")).toBe("W");
    expect(getVillageAssaultTerrainGlyph({ x: 15, y: 3 }, "highcrag")).toBe("R");
    expect(getVillageAssaultTerrainGlyph({ x: 0, y: 0 }, "pinehold")).toBe("T");
    expect(isVillageAssaultWalkableCell({ x: 15, y: 4 }, "pinehold")).toBe(false);
    expect(isVillageAssaultBuildableCell({ x: 15, y: 3 }, "highcrag")).toBe(false);
    expect(getVillageAssaultTerrainGlyph({ x: -1, y: 0 })).toBeUndefined();
    for (const layoutId of Object.keys(VILLAGE_ASSAULT_LAYOUTS) as VillageAssaultLayoutId[]) {
      for (const y of [8, 12, 17]) for (const x of [14, 15, 16, 17]) {
        expect(isVillageAssaultWalkableCell({ x, y }, layoutId), `${layoutId} crossing ${x},${y}`).toBe(true);
        expect(isVillageAssaultBuildableCell({ x, y }, layoutId)).toBe(false);
      }
    }
  });
  it("returns complete, duplicate-free blocked-cell collections within map bounds", () => {
    for (const cells of [getVillageAssaultWalkBlockedCells(), getVillageAssaultBuildBlockedCells()]) {
      expect(new Set(cells.map(key)).size).toBe(cells.length);
      expect(cells.every((point) => point.x >= 0 && point.y >= 0 && point.x < VILLAGE_ASSAULT_MAP_WIDTH && point.y < VILLAGE_ASSAULT_MAP_HEIGHT)).toBe(true);
    }
    expect(getVillageAssaultBuildBlockedCells().length).toBeGreaterThan(getVillageAssaultWalkBlockedCells().length);
  });

  it("registers three distinct, valid, data-driven playable layouts", () => {
    const layoutIds = Object.keys(VILLAGE_ASSAULT_LAYOUTS) as VillageAssaultLayoutId[];
    expect(layoutIds).toEqual(["pinehold", "riverstead", "highcrag"]);
    expect(validateVillageAssaultLayouts()).toEqual({ ok: true, errors: [] });
    expect(VILLAGE_ASSAULT_MAP_ROWS).toBe(getVillageAssaultLayout("pinehold").terrainRows);

    const terrainSignatures = new Set<string>();
    const constraintIds = new Set<string>();
    for (const layoutId of layoutIds) {
      const layout = getVillageAssaultLayout(layoutId);
      expect(layout.id).toBe(layoutId);
      expect(layout.terrainRows).toHaveLength(VILLAGE_ASSAULT_MAP_HEIGHT);
      expect(layout.terrainRows.every((row) => row.length === VILLAGE_ASSAULT_MAP_WIDTH)).toBe(true);
      expect(layout.startSlots.map((slot) => slot.id)).toEqual(["west", "east"]);
      expect(layout.neutralCamps).toHaveLength(3);
      expect(new Set(layout.neutralCamps.map((camp) => camp.monsterTypeId))).toEqual(new Set(MONSTER_IDS));
      terrainSignatures.add(layout.terrainRows.join("\n"));
      constraintIds.add(layout.constraint.id);
    }
    expect(terrainSignatures.size).toBe(layoutIds.length);
    expect(constraintIds.size).toBe(layoutIds.length);
  });

  it("provides an open town-center start with three separate workers and no prefilled defenses", () => {
    for (const layout of Object.values(VILLAGE_ASSAULT_LAYOUTS)) {
      for (const slot of layout.startSlots) {
        const roles = slot.placements.map((placement) => placement.role);
        expect(roles.filter((role) => role === "command")).toHaveLength(1);
        expect(roles.filter((role) => role === "gate")).toHaveLength(0);
        expect(roles.filter((role) => role === "perimeter")).toHaveLength(0);
        expect(roles.filter((role) => role === "defense")).toHaveLength(0);
        expect(roles.filter((role) => role === "production")).toHaveLength(0);
        expect(roles.filter((role) => role === "economy")).toHaveLength(0);
        expect(slot.placements.find((placement) => placement.role === "command")?.buildingType).toBe("townCenter");
        expect(slot.placements).toHaveLength(1);
        expect(slot.resourceAnchors.map((anchor) => anchor.resourceKind).sort()).toEqual(["food", "stone", "wood"]);
        expect(slot.civilianActivities.map((activity) => activity.role).sort()).toEqual(["gatherer", "mason", "porter"]);
        for (const activity of slot.civilianActivities) {
          expect(slot.resourceAnchors.some((anchor) => anchor.id === activity.resourceAnchorId)).toBe(true);
          expect(slot.placements.some((placement) => placement.id === activity.dropOffPlacementId)).toBe(true);
          expect(slot.placements.some((placement) => placement.id === activity.shelterPlacementId)).toBe(true);
        }
      }
    }
  });

  it("keeps every occupied anchor and oriented footprint legal and non-overlapping", () => {
    for (const layout of Object.values(VILLAGE_ASSAULT_LAYOUTS)) {
      const occupied = new Set<string>();
      const reserve = (point: { readonly x: number; readonly y: number }): void => {
        expect(occupied.has(key(point)), `${layout.id} duplicate occupancy at ${key(point)}`).toBe(false);
        occupied.add(key(point));
      };
      for (const slot of layout.startSlots) {
        for (const placement of slot.placements) {
          for (const offset of getBuildingFootprint(placement.buildingType, placement.orientation)) {
            const point = { x: placement.origin.x + offset.x, y: placement.origin.y + offset.y };
            expect(isVillageAssaultBuildableCell(point, layout.id), `${layout.id}.${placement.id} must be buildable`).toBe(true);
            reserve(point);
          }
        }
        for (const anchor of slot.resourceAnchors) {
          expect(isVillageAssaultBuildableCell(anchor.position, layout.id), `${layout.id}.${anchor.id} must be buildable`).toBe(true);
          reserve(anchor.position);
        }
        for (const activity of slot.civilianActivities) {
          expect(isVillageAssaultWalkableCell(activity.spawn, layout.id), `${layout.id}.${activity.id} must be walkable`).toBe(true);
          reserve(activity.spawn);
        }
      }
      for (const camp of layout.neutralCamps) {
        expect(isVillageAssaultWalkableCell(camp.position, layout.id), `${layout.id}.${camp.id} must be walkable`).toBe(true);
        reserve(camp.position);
      }
    }
  });

  it("routes optional layout ids without changing the pinehold-compatible default", () => {
    expect(getVillageAssaultTerrainGlyph({ x: 8, y: 5 })).toBe(getVillageAssaultTerrainGlyph({ x: 8, y: 5 }, "pinehold"));
    expect(isVillageAssaultBuildableCell({ x: 13, y: 7 }, "pinehold")).toBe(false);
    expect(isVillageAssaultBuildableCell({ x: 6, y: 16 }, "riverstead")).toBe(true);
    expect(getVillageAssaultBuildBlockedCells("highcrag").length).toBeGreaterThan(getVillageAssaultWalkBlockedCells("highcrag").length);
  });

  it("reports invalid generated metadata instead of silently accepting overlap", () => {
    const source = getVillageAssaultLayout("pinehold");
    const command = source.startSlots[0]!.placements.find((placement) => placement.role === "command")!;
    const invalid = {
      ...source,
      neutralCamps: [
        { ...source.neutralCamps[0]!, position: { ...command.origin } },
        ...source.neutralCamps.slice(1),
      ],
    };
    const result = validateVillageAssaultLayout(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("overlaps"))).toBe(true);

    const blockedRow = source.terrainRows[command.origin.y]!;
    const invalidTerrain = {
      ...source,
      terrainRows: source.terrainRows.map((row, index) => index === command.origin.y
        ? `${blockedRow.slice(0, command.origin.x)}W${blockedRow.slice(command.origin.x + 1)}`
        : row),
    };
    const terrainResult = validateVillageAssaultLayout(invalidTerrain);
    expect(terrainResult.ok).toBe(false);
    expect(terrainResult.errors.some((error) => error.includes("must occupy buildable"))).toBe(true);
  });

  it("rejects duplicate start slots and repeated reserved-cell topology", () => {
    const pinehold = getVillageAssaultLayout("pinehold");
    const duplicateSlots = {
      ...pinehold,
      startSlots: [pinehold.startSlots[0]!, { ...pinehold.startSlots[0]! }],
    };
    expect(validateVillageAssaultLayout(duplicateSlots).errors).toContain("layout.pinehold.startSlots must contain west and east exactly once");

    const riverstead = getVillageAssaultLayout("riverstead");
    const duplicateConstraintRegistry = {
      ...VILLAGE_ASSAULT_LAYOUTS,
      riverstead: {
        ...riverstead,
        constraint: { ...riverstead.constraint, reservedBuildCells: pinehold.constraint.reservedBuildCells },
      },
    };
    expect(validateVillageAssaultLayouts(duplicateConstraintRegistry).errors).toContain("layout.riverstead.constraint.reservedBuildCells must be unique");
  });
});
