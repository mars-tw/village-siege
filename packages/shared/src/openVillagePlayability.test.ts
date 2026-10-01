import { describe, expect, it } from "vitest";
import { VILLAGE_ASSAULT_LAYOUT_IDS, VILLAGE_ASSAULT_MAP_HEIGHT, VILLAGE_ASSAULT_MAP_WIDTH, VILLAGE_ASSAULT_CONTROL_OBJECTIVE, getVillageAssaultWalkBlockedCells } from "./battlefield";
import { getBuildingFootprint, UNITS } from "./content";
import { findPathRoute } from "./spatial";
import { applyCommand, createInitialState, getEntityFootprintCells, getNavigationBlockedMapCells, isBuildLocationAvailable, stepSimulation, toVisibleSnapshot, type MatchState } from "./simulation";
import type { GameCommand } from "./protocol";

function command(state: MatchState, sequence: number, value: GameCommand) {
  const result = applyCommand(state, { matchId: state.matchId, playerId: "player-1", clientTick: state.tick, sequence, command: value });
  expect(result.validation).toEqual({ ok: true });
  return result.state;
}

describe("open village playability gates", () => {
  it("keeps three gathering/deposit loops safe while leaving home expansion land and an initially hidden enemy", () => {
    for (const layoutId of VILLAGE_ASSAULT_LAYOUT_IDS) {
      let state = createInitialState({ seed: 4022, map: { id: "villageAssault", width: VILLAGE_ASSAULT_MAP_WIDTH, height: VILLAGE_ASSAULT_MAP_HEIGHT, layoutId } });
      const own = state.entities.filter(entity => entity.ownerId === "player-1");
      expect(own.filter(entity => entity.kind === "building")).toHaveLength(1);
      const workers = own.filter(entity => entity.kind === "unit");
      const ownResourcePositions = state.entities.filter(entity => entity.kind === "resource" && entity.position.x < 16).map(entity => entity.position);
      expect(workers).toHaveLength(3);
      expect(toVisibleSnapshot(state, "player-1").entities.some(entity => entity.ownerId === "player-2")).toBe(false);
      for (const origin of [{ x: 6, y: 6 }, { x: 7, y: 13 }, { x: 7, y: 16 }, { x: 3, y: 16 }]) {
        expect(isBuildLocationAvailable(state, "barracks", origin), `${layoutId} expansion ${origin.x},${origin.y}`).toBe(true);
        expect(getBuildingFootprint("barracks", "ne").every(offset => !ownResourcePositions.some(point => point.x === origin.x + offset.x && point.y === origin.y + offset.y))).toBe(true);
      }
      const deposited = new Set<string>();
      for (let tick = 0; tick < 300; tick += 1) {
        const next = stepSimulation(state);
        state = next.state;
        for (const event of next.events) if (event.type === "resourcesDeposited" && event.playerId === "player-1") deposited.add(event.unitId);
      }
      expect(deposited.size, `${layoutId} all workers must deposit through legal open routes`).toBe(3);
      expect(state.entities.filter(entity => entity.kind === "unit" && entity.ownerId === "player-1").every(entity => entity.hitPoints === entity.maxHitPoints)).toBe(true);
    }
  });

  it("builds a real barracks and spawns five units with routes to its wide staging area on every layout", () => {
    for (const layoutId of VILLAGE_ASSAULT_LAYOUT_IDS) {
      let state = createInitialState({ seed: 4023, map: { id: "villageAssault", width: VILLAGE_ASSAULT_MAP_WIDTH, height: VILLAGE_ASSAULT_MAP_HEIGHT, layoutId } });
      const builder = state.entities.find(entity => entity.kind === "unit" && entity.ownerId === "player-1")!;
      state = command(state, 0, { type: "build", builderIds: [builder.id], buildingType: "barracks", origin: { x: 7, y: 13 } });
      state = stepSimulation(state, [], 500).state;
      const barracks = state.entities.find(entity => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "barracks")!;
      expect(barracks.kind === "building" && barracks.complete).toBe(true);
      const rally = { x: 12, y: 12 };
      state = command(state, 1, { type: "setRallyPoint", producerId: barracks.id, target: rally });
      state = command(state, 2, { type: "train", producerId: barracks.id, unitType: "warrior", count: 5 });
      const spawned: string[] = [];
      for (let tick = 0; tick < UNITS.warrior.trainTicks * 5 + 60; tick += 1) {
        const next = stepSimulation(state);
        state = next.state;
        for (const event of next.events) if (event.type === "entitySpawned" && event.entity.kind === "unit" && event.entity.ownerId === "player-1" && event.entity.typeId === "warrior") {
          spawned.push(event.entity.id);
          const blocked = [...getNavigationBlockedMapCells(state), ...getVillageAssaultWalkBlockedCells(layoutId)];
          expect(findPathRoute(event.entity.position, rally, state.map.width, state.map.height, blocked), `${layoutId} spawn ${event.entity.id} must not enter a sealed pocket`).not.toBeNull();
          expect(getEntityFootprintCells(barracks).some(cell => cell.x === event.entity.position.x && cell.y === event.entity.position.y)).toBe(false);
        }
      }
      expect(spawned).toHaveLength(5);
      expect(new Set(spawned).size).toBe(5);
      expect(state.entities.filter(entity => spawned.includes(entity.id))).toHaveLength(5);
      expect(VILLAGE_ASSAULT_CONTROL_OBJECTIVE).toEqual({ point: { x: 16, y: 12 }, radius: 3 });
    }
  }, 20_000);
});
