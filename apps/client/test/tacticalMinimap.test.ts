import { describe, expect, it } from "vitest";
import { encodeExploredTilesRle, type PublicEntityState } from "@village-siege/shared";
import { minimapPointToGrid, projectTacticalMinimap, type TacticalMinimapSnapshot } from "../src/game/tacticalMinimap.js";

function fixture(): TacticalMinimapSnapshot {
  return {
    map: { id: "test", width: 3, height: 2, layoutId: "pinehold" },
    recipientPlayerId: "player", recipientTeamId: "friendly",
    participants: [
      { id: "player", teamId: "friendly" },
      { id: "ally", teamId: "friendly" },
      { id: "enemy", teamId: "hostile" },
    ] as TacticalMinimapSnapshot["participants"],
    entities: [], visibleEntityIds: [], visibleTileIndices: [0, 1],
    exploredTilesRle: encodeExploredTilesRle(3, 2, [0, 1, 2]),
  };
}

function entity(id: string, ownerId: string, x: number, y: number): PublicEntityState {
  return { id, ownerId, kind: "unit", typeId: "warrior", position: { x, y }, hitPoints: 100, maxHitPoints: 100 } as PublicEntityState;
}

describe("tactical minimap public fog projection", () => {
  it("renders current sight, dims explored land and withholds unknown terrain", () => {
    const projection = projectTacticalMinimap(fixture());
    expect(projection.tiles.map((tile) => tile.visibility)).toEqual(["visible", "visible", "explored", "unknown", "unknown", "unknown"]);
    expect(projection.tiles.slice(3).every((tile) => tile.glyph === null)).toBe(true);
    expect(projection.tiles[2]!.glyph).not.toBeNull();
  });

  it("rejects enemy positions on explored or unknown tiles even when accidentally included in public entities", () => {
    const snapshot = fixture();
    const projection = projectTacticalMinimap({
      ...snapshot,
      entities: [entity("seen", "enemy", 1, 0), entity("remembered", "enemy", 2, 0), entity("hidden", "enemy", 0, 1)],
      visibleEntityIds: ["seen", "remembered", "hidden"],
    });
    expect(projection.markers.map((marker) => marker.id)).toEqual(["seen"]);
    expect(projection.markers[0]!.relation).toBe("enemy");
  });

  it("requires the visibility allowlist and identifies the recipient and its allies", () => {
    const projection = projectTacticalMinimap({
      ...fixture(),
      entities: [entity("own", "player", 0, 0), entity("ally", "ally", 1, 0), entity("unlisted", "enemy", 1, 0), entity("outside", "enemy", 12, 3)],
      visibleEntityIds: ["own", "ally", "outside"],
    });
    expect(projection.markers.map((marker) => [marker.id, marker.relation])).toEqual([["own", "own"], ["ally", "ally"]]);
  });

  it("turns minimap taps into bounded grid coordinates without issuing unit commands", () => {
    expect(minimapPointToGrid(100, 50, 200, 100, 18, 16)).toEqual({ x: 9, y: 8 });
    expect(minimapPointToGrid(-5, -10, 200, 100, 18, 16)).toEqual({ x: 0, y: 0 });
    expect(minimapPointToGrid(205, 105, 200, 100, 18, 16)).toEqual({ x: 17, y: 15 });
  });
});
