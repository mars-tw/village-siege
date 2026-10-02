import { describe, expect, it } from "vitest";
import type { PublicEntityState, VisibleSnapshot } from "@village-siege/shared";
import { battleObjectiveCards } from "../src/game/battleObjectives";
import { createVillageAssaultRuntime } from "../src/game/villageAssaultRuntime";

const base = (): VisibleSnapshot => createVillageAssaultRuntime({ playerVillageId: "pinehold", aiPersonality: "balanced", seed: 26 }).view;
const entity = (id: string, kind: "unit" | "building", typeId: string, ownerId = "player-1", x = 7): PublicEntityState => ({
  id, kind, typeId, ownerId, position: { x, y: 8 }, hitPoints: 100, maxHitPoints: 100, stateRevision: 1,
  ...(kind === "building" ? { complete: true, ownerControl: ownerId === "player-1" ? { rallyPoint: null, productionQueue: [] } : undefined } : {}),
}) as PublicEntityState;

function armyView(extra: readonly PublicEntityState[] = [], visibleEntityIds?: readonly string[]): VisibleSnapshot {
  const view = base();
  const additions = [
    entity("barracks-own", "building", "barracks"),
    entity("lumber-own", "building", "lumberCamp"),
    entity("warrior-1", "unit", "warrior"),
    entity("warrior-2", "unit", "warrior"),
    entity("shield-1", "unit", "shieldBearer"),
    ...extra,
  ];
  return { ...view, entities: [...view.entities, ...additions], visibleEntityIds: visibleEntityIds ?? [...view.visibleEntityIds, ...additions.map(({ id }) => id)] };
}

describe("battle objective guidance", () => {
  it("derives real development prerequisites and a build action", () => {
    const development = battleObjectiveCards(base()).find(({ id }) => id === "development")!;
    expect(development.status).toContain("兵營 未完成");
    expect(development.action).toEqual({ kind: "build", buildingType: "barracks" });
  });

  it("reports the actual army count and points to an existing legal producer", () => {
    const view = base();
    const barracks = entity("barracks-own", "building", "barracks");
    const rally = battleObjectiveCards({ ...view, entities: [...view.entities, barracks] }).find(({ id }) => id === "rally")!;
    expect(rally.status).toContain("目前 0 / 3 名");
    expect(rally.action).toEqual({ kind: "showProducer", buildingType: "barracks", unitType: "warrior" });
  });

  it("scouts with owned military toward a public, passable map waypoint", () => {
    const scout = battleObjectiveCards(armyView()).find(({ id }) => id === "scout")!;
    expect(scout.action).toMatchObject({ kind: "command", command: { type: "attackMove", target: { x: 25, y: 8 } } });
    expect((scout.action as { command: { entityIds: string[] } }).command.entityIds).toEqual(["warrior-1", "warrior-2", "shield-1"]);
  });

  it("never turns a hidden enemy entity or stale sighting into an attack target", () => {
    const hiddenTown = entity("enemy-secret", "building", "townCenter", "player-2", 25);
    const view = armyView([hiddenTown], armyView().visibleEntityIds.filter((id) => id !== hiddenTown.id));
    const objective = battleObjectiveCards(view).find(({ id }) => id === "scout" || id === "assault")!;
    expect(objective.id).toBe("scout");
    expect(JSON.stringify(objective)).not.toContain("enemy-secret");
  });

  it("does not issue scouting moves on an unsupported map", () => {
    const view = armyView();
    const scout = battleObjectiveCards({ ...view, map: { ...view.map, id: "unsupported" } }).find(({ id }) => id === "scout")!;
    expect(scout.action).toBeUndefined();
  });

  it("does not issue scouting moves for an invalid village-assault layout", () => {
    const view = armyView();
    const invalidLayout = { ...view, map: { ...view.map, layoutId: "invalid-layout" } } as unknown as VisibleSnapshot;
    const scout = battleObjectiveCards(invalidLayout).find(({ id }) => id === "scout")!;
    expect(scout.action).toBeUndefined();
  });

  it("attacks only a currently visible hostile town center", () => {
    const enemyTown = entity("enemy-visible", "building", "townCenter", "player-2", 25);
    const assault = battleObjectiveCards(armyView([enemyTown])).find(({ id }) => id === "assault")!;
    expect(assault.action).toMatchObject({ kind: "command", command: { type: "attack", targetId: "enemy-visible" } });
  });

  it("offers no action after the match finishes", () => {
    const view = armyView();
    const finished: VisibleSnapshot = { ...view, phase: "finished", victory: { ...view.victory, finishReason: "conquest", finishedAtTick: view.serverTick } };
    expect(battleObjectiveCards(finished).every((card) => card.action === undefined)).toBe(true);
  });
});
