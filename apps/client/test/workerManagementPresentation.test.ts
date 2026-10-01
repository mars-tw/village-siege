import { describe, expect, it } from "vitest";
import type { PublicEntityState, VisibleSnapshot } from "@village-siege/shared";
import { createVillageAssaultRuntime } from "../src/game/villageAssaultRuntime";
import { visibleOwnedWorkers, workerManagementPageSize } from "../src/game/workerManagementPresentation";

function base(): VisibleSnapshot {
  return createVillageAssaultRuntime({ playerVillageId: "riverstead", aiPersonality: "balanced", seed: 25 }).view;
}

function villager(id: string, ownerId: string, activity: PublicEntityState["civilianActivity"] = "idle"): PublicEntityState {
  return {
    id,
    ownerId,
    kind: "unit",
    typeId: "villager",
    position: { x: 4, y: 4 },
    hitPoints: 100,
    maxHitPoints: 100,
    stateRevision: 1,
    civilianActivity: activity,
    cargo: { kind: "wood", amount: 6, capacity: 12 },
  };
}

describe("worker management public presentation", () => {
  it("shows only living, visible workers owned by the snapshot recipient", () => {
    const view = base();
    const own = villager("worker-10", view.recipientPlayerId, "gathering");
    const hiddenOwn = villager("worker-11", view.recipientPlayerId);
    const enemy = villager("worker-12", "other-player");
    const dead = { ...villager("worker-13", view.recipientPlayerId), hitPoints: 0 };
    const snapshot: VisibleSnapshot = {
      ...view,
      entities: [own, hiddenOwn, enemy, dead],
      visibleEntityIds: [own.id, enemy.id, dead.id],
    };

    expect(visibleOwnedWorkers(snapshot)).toEqual([{
      id: "worker-10",
      label: "工匠 1",
      activity: "採集中",
      cargo: "攜帶木 6/12",
    }]);
  });

  it("uses the required responsive page sizes", () => {
    expect(workerManagementPageSize(1280, 720)).toBe(4);
    expect(workerManagementPageSize(844, 390)).toBe(2);
    expect(workerManagementPageSize(568, 320)).toBe(1);
  });
});
