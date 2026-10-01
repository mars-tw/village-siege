import { describe, expect, it } from "vitest";
import { findPathToAny, type PublicEntityState } from "@village-siege/shared";
import { chooseContinuationWorker, constructionContinuationCommand, continuationMovementBlockedCells } from "../src/game/constructionContinuation";

const site = { id: "site-a", kind: "building", ownerId: "p1", typeId: "house", hitPoints: 20, complete: false, position: { x: 6, y: 8 } };
const worker = (id: string, activity = "idle") => ({ id, kind: "unit", ownerId: "p1", typeId: "villager", hitPoints: 55, position: { x: 5, y: 8 }, order: { type: activity } });

describe("construction continuation controls", () => {
  it("allows a worker to reach a site through an open gate and rubble, but not a closed gate", () => {
    const gate = { id: "gate", kind: "building", ownerId: "p1", typeId: "surveyGate", hitPoints: 100, maxHitPoints: 100,
      stateRevision: 1, position: { x: 2, y: 1 }, complete: true, gateOpen: true } as PublicEntityState;
    const entities = [gate, { ...gate, id: "breach", kind: "rubble", position: { x: 1, y: 1 }, blocksMovement: false },
      { ...gate, id: "wall-top", typeId: "resinPalisade", position: { x: 2, y: 0 } },
      { ...gate, id: "wall-bottom", typeId: "resinPalisade", position: { x: 2, y: 2 } }] as PublicEntityState[];
    const route = (items: PublicEntityState[]) => findPathToAny({ x: 0, y: 1 }, [{ x: 4, y: 1 }], 7, 3, continuationMovementBlockedCells(items));
    expect(route(entities)).not.toBeNull();
    expect(route([{ ...gate, gateOpen: false }, ...entities.slice(1)])).toBeNull();
  });

  it("explicitly redirects a selected builder from another job to the original site", () => {
    expect(constructionContinuationCommand(site, [worker("builder", "construct")], "p1"))
      .toEqual({ type: "repair", entityIds: ["builder"], targetId: "site-a" });
  });

  it("does not issue continuation for a completed, dead or hostile building", () => {
    for (const target of [{ ...site, complete: true }, { ...site, hitPoints: 0 }, { ...site, ownerId: "enemy" }]) {
      expect(constructionContinuationCommand(target, [worker("builder")], "p1")).toBeNull();
    }
  });

  it("requires a living owned worker and preserves selected military orders", () => {
    expect(constructionContinuationCommand(site, [worker("builder"), { ...worker("army"), typeId: "warrior" },
      { ...worker("dead"), hitPoints: 0 }, { ...worker("enemy"), ownerId: "enemy" }], "p1"))
      .toEqual({ type: "repair", entityIds: ["builder"], targetId: "site-a" });
  });

  it("the shortcut prefers a reachable idle worker and never steals another site's builder", () => {
    const workers = [worker("busy", "construct"), worker("gatherer", "gather"), worker("idle-far"), worker("blocked")];
    expect(chooseContinuationWorker(workers, site, "p1", w => w.id === "blocked" ? null : w.id === "idle-far" ? 8 : 1)?.id).toBe("idle-far");
    expect(chooseContinuationWorker([worker("busy", "construct")], site, "p1", () => 1)).toBeNull();
  });

  it("handles online public activities without reading private worker orders", () => {
    const publicWorkers = ["constructing", "repairing", "gathering", "idle"].map((civilianActivity, index) => ({
      id: `public-${index}`, kind: "unit", ownerId: "p1", typeId: "villager", hitPoints: 55, position: { x: 5, y: 8 }, civilianActivity,
    }));
    expect(chooseContinuationWorker(publicWorkers, site, "p1", () => 2)?.id).toBe("public-3");
  });
});
