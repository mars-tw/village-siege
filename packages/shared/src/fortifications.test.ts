import { describe, expect, it } from "vitest";
import { BUILDINGS, getBuildingFootprint } from "./content";
import { findPathRoute, getFootprintCells } from "./spatial";
import {
  RUBBLE_DECAY_TICKS,
  applyCommand,
  cloneMatchState,
  createInitialState,
  getNavigationBlockedMapCells,
  getOccupiedMapCells,
  getStructureHealthBand,
  hashMatchState,
  stepSimulation,
  toPublicEntity,
  toVisibleSnapshot,
  validateCommand,
  type BuildingEntityState,
  type MatchState,
  type UnitEntityState,
} from "./simulation";
import { isGameCommand, type BuildingType, type CommandEnvelope, type GridPoint, type PlayerId, type StructureOrientation } from "./protocol";

function envelope(state: MatchState, playerId: PlayerId, sequence: number, command: CommandEnvelope["command"]): CommandEnvelope {
  return { matchId: state.matchId, playerId, sequence, clientTick: state.tick, command };
}

function building(
  id: string,
  ownerId: PlayerId,
  typeId: BuildingType,
  position: GridPoint,
  orientation: StructureOrientation = "ne",
): BuildingEntityState {
  const definition = BUILDINGS[typeId];
  return {
    id,
    ownerId,
    kind: "building",
    typeId,
    position,
    hitPoints: definition.maxHitPoints,
    maxHitPoints: definition.maxHitPoints,
    stateRevision: 0,
    complete: true,
    constructionRemainingTicks: 0,
    attackCooldownTicks: 0,
    statuses: [],
    rallyPoint: null,
    productionQueue: [],
    orientation,
    gateOpen: false,
  };
}

function barrierState(): { state: MatchState; gate: BuildingEntityState; mover: UnitEntityState } {
  const state = createInitialState({
    matchId: "fortification-barrier",
    seed: 91,
    map: { id: "fortification-test", width: 7, height: 5 },
    victoryPolicy: { commandCenterConquest: null, elimination: false },
  });
  const mover = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1")!;
  mover.position = { x: 1, y: 2 };
  mover.order = { type: "idle" };
  mover.movementProgress = 0;
  const gate = building("gate", "player-1", "surveyGate", { x: 3, y: 2 }, "se");
  state.entities = [
    mover,
    building("wall-0", "player-1", "resinPalisade", { x: 3, y: 0 }),
    building("wall-1", "player-1", "resinPalisade", { x: 3, y: 1 }),
    gate,
    building("wall-4", "player-1", "resinPalisade", { x: 3, y: 4 }),
  ];
  return { state, gate, mover };
}

describe("deterministic fortifications", () => {
  it("strictly parses oriented construction and authoritative gate commands", () => {
    expect(isGameCommand({ type: "build", builderIds: ["worker"], buildingType: "surveyGate", origin: { x: 3, y: 4 }, orientation: "se" })).toBe(true);
    expect(isGameCommand({ type: "build", builderIds: ["worker"], buildingType: "surveyGate", origin: { x: 3, y: 4 }, orientation: "west" })).toBe(false);
    expect(isGameCommand({ type: "setGateState", gateId: "gate", open: true })).toBe(true);
    expect(getBuildingFootprint("surveyGate", "ne")).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(getBuildingFootprint("surveyGate", "se")).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  });

  it("keeps closed and damaged gates blocking while an open gate preserves placement occupancy", () => {
    const { state, gate } = barrierState();
    const start = { x: 1, y: 2 };
    const target = { x: 5, y: 2 };
    gate.complete = false;
    gate.gateOpen = true;
    expect(findPathRoute(start, target, 7, 5, getNavigationBlockedMapCells(state))).toBeNull();
    gate.complete = true;
    gate.gateOpen = false;
    expect(findPathRoute(start, target, 7, 5, getNavigationBlockedMapCells(state))).toBeNull();
    gate.hitPoints = Math.floor(gate.maxHitPoints / 2);
    expect(getStructureHealthBand(gate)).toBe("damaged");
    expect(findPathRoute(start, target, 7, 5, getNavigationBlockedMapCells(state))).toBeNull();

    const opened = applyCommand(state, envelope(state, "player-1", 0, { type: "setGateState", gateId: gate.id, open: true }));
    expect(opened.validation.ok).toBe(true);
    const openedGate = opened.state.entities.find((entity): entity is BuildingEntityState => entity.id === gate.id && entity.kind === "building")!;
    expect(openedGate.gateOpen).toBe(true);
    expect(opened.events.map((event) => event.type)).toContain("gateStateChanged");
    expect(findPathRoute(start, target, 7, 5, getNavigationBlockedMapCells(opened.state))).not.toBeNull();
    expect(getOccupiedMapCells(opened.state)).toEqual(expect.arrayContaining(getFootprintCells(gate.position, getBuildingFootprint(gate.typeId, gate.orientation))));
  });

  it("rejects closing a gate over a living unit and applies the transition atomically once clear", () => {
    const { state, gate, mover } = barrierState();
    gate.gateOpen = true;
    mover.position = { x: 3, y: 2 };
    const blocked = envelope(state, "player-1", 0, { type: "setGateState", gateId: gate.id, open: false });
    const before = hashMatchState(state);
    expect(validateCommand(state, blocked)).toEqual({ ok: false, code: "TARGET_NOT_REACHABLE" });
    expect(applyCommand(state, blocked).state).toEqual(state);
    expect(hashMatchState(state)).toBe(before);

    mover.position = { x: 2, y: 2 };
    const closed = applyCommand(state, envelope(state, "player-1", 0, { type: "setGateState", gateId: gate.id, open: false }));
    expect(closed.validation.ok).toBe(true);
    expect(closed.state.entities.find((entity) => entity.id === gate.id && entity.kind === "building")?.gateOpen).toBe(false);
  });

  it("retains blocked move intent and resumes through a gate after it opens", () => {
    const { state, gate, mover } = barrierState();
    const ordered = applyCommand(state, envelope(state, "player-1", 0, { type: "move", entityIds: [mover.id], target: { x: 5, y: 2 } }));
    const waiting = stepSimulation(ordered.state, [], 20).state;
    const waitingMover = waiting.entities.find((entity): entity is UnitEntityState => entity.id === mover.id && entity.kind === "unit")!;
    expect(waitingMover.position).toEqual({ x: 1, y: 2 });
    expect(waitingMover.order).toEqual({ type: "move", target: { x: 5, y: 2 } });

    const opened = applyCommand(waiting, envelope(waiting, "player-1", 1, { type: "setGateState", gateId: gate.id, open: true }));
    const arrived = stepSimulation(opened.state, [], 70).state.entities.find((entity): entity is UnitEntityState => entity.id === mover.id && entity.kind === "unit")!;
    expect(arrived.position).toEqual({ x: 5, y: 2 });
  });

  it("atomically replaces destroyed fortifications with walkable, placement-blocking rubble that expires", () => {
    const { state, gate } = barrierState();
    gate.hitPoints = 0;
    const transitioned = stepSimulation(state, [], 1);
    const rubble = transitioned.state.entities.find((entity) => entity.kind === "rubble");
    expect(rubble).toMatchObject({ ownerId: null, kind: "rubble", typeId: "surveyGate", orientation: "se" });
    expect(transitioned.events.map((event) => event.type)).toEqual(expect.arrayContaining(["entityRemoved", "entitySpawned"]));
    expect(findPathRoute({ x: 1, y: 2 }, { x: 5, y: 2 }, 7, 5, getNavigationBlockedMapCells(transitioned.state))).not.toBeNull();
    expect(getOccupiedMapCells(transitioned.state)).toEqual(expect.arrayContaining(getFootprintCells(gate.position, getBuildingFootprint(gate.typeId, gate.orientation))));

    const cleared = stepSimulation(transitioned.state, [], RUBBLE_DECAY_TICKS).state;
    expect(cleared.entities.some((entity) => entity.kind === "rubble")).toBe(false);
  });

  it("creates multiple same-tick rubble entities in stable source-id order", () => {
    const { state, gate } = barrierState();
    const wall = state.entities.find((entity): entity is BuildingEntityState => entity.id === "wall-0" && entity.kind === "building")!;
    gate.hitPoints = 0;
    wall.hitPoints = 0;
    state.entities = [wall, gate];
    const reversed = cloneMatchState(state);
    reversed.entities.reverse();

    const forwardResult = stepSimulation(state, [], 1).state;
    const reversedResult = stepSimulation(reversed, [], 1).state;
    const summarizeRubble = (candidate: MatchState) => candidate.entities
      .filter((entity) => entity.kind === "rubble")
      .map((entity) => ({ id: entity.id, typeId: entity.typeId, position: entity.position }));

    expect(summarizeRubble(forwardResult)).toEqual([
      { id: `rubble-${state.nextEntityNumber}`, typeId: "surveyGate", position: { x: 3, y: 2 } },
      { id: `rubble-${state.nextEntityNumber + 1}`, typeId: "resinPalisade", position: { x: 3, y: 0 } },
    ]);
    expect(summarizeRubble(reversedResult)).toEqual(summarizeRubble(forwardResult));
    expect(hashMatchState(reversedResult)).toBe(hashMatchState(forwardResult));
  });

  it("preserves construction damage instead of full-healing a completed wall", () => {
    const state = createInitialState({
      matchId: "damaged-foundation",
      seed: 33,
      map: { id: "construction-test", width: 10, height: 10 },
      victoryPolicy: { commandCenterConquest: null, elimination: false },
    });
    const worker = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1")!;
    worker.position = { x: 1, y: 2 };
    const wall = building("foundation", "player-1", "resinPalisade", { x: 2, y: 2 });
    wall.complete = false;
    wall.constructionRemainingTicks = 1;
    wall.hitPoints = 20;
    worker.order = { type: "construct", targetId: wall.id };
    state.entities = [worker, wall];
    const completed = stepSimulation(state, [], 1);
    const built = completed.state.entities.find((entity): entity is BuildingEntityState => entity.id === wall.id && entity.kind === "building")!;
    expect(built.complete).toBe(true);
    expect(built.hitPoints).toBeGreaterThan(20);
    expect(built.hitPoints).toBeLessThan(built.maxHitPoints);
    expect(completed.events.some((event) => event.type === "entityUpdated" && event.entity.id === wall.id)).toBe(true);
  });

  it("publishes last-seen gate topology without updating hidden state", () => {
    const state = createInitialState({ matchId: "gate-fog", seed: 14, map: { id: "fog-test", width: 30, height: 20 } });
    const scout = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1")!;
    for (const entity of state.entities) {
      if (entity.ownerId === "player-1") entity.position = { x: 1, y: 1 };
    }
    scout.position = { x: 18, y: 15 };
    const gate = building("enemy-gate", "player-2", "surveyGate", { x: 20, y: 15 });
    state.entities.push(gate);
    let next = stepSimulation(state, [], 1).state;
    expect(toVisibleSnapshot(next, "player-1").entities.find((entity) => entity.id === gate.id)).toMatchObject({ gateOpen: false, blocksMovement: true });

    const movedScout = next.entities.find((entity): entity is UnitEntityState => entity.id === scout.id && entity.kind === "unit")!;
    movedScout.position = { x: 1, y: 1 };
    movedScout.stateRevision += 1;
    next = stepSimulation(next, [], 1).state;
    const hiddenGate = next.entities.find((entity): entity is BuildingEntityState => entity.id === gate.id && entity.kind === "building")!;
    hiddenGate.gateOpen = true;
    hiddenGate.stateRevision += 1;
    next = stepSimulation(next, [], 1).state;
    const hiddenView = toVisibleSnapshot(next, "player-1");
    expect(hiddenView.entities.some((entity) => entity.id === gate.id)).toBe(false);
    expect(hiddenView.staleEnemySightings.find((sighting) => sighting.entityId === gate.id)).toMatchObject({ gateOpen: false, blocksMovement: true });
    expect(toPublicEntity(hiddenGate)).toMatchObject({ gateOpen: true, blocksMovement: false });
  });
});
