import { describe, expect, it } from "vitest";
import { nextUint32 } from "./random";
import { isVillageAssaultWalkableCell } from "./battlefield";
import { BUILDINGS, RESOURCE_NODES, RULES_VERSION, SETTLEMENT_TIERS, UNITS } from "./content";
import {
  applyCommand,
  cloneMatchState,
  createInitialState,
  getEntityFootprintCells,
  hashMatchState,
  hashReplay,
  isBuildLocationAvailable,
  stepSimulation,
  validateCommand,
  type BuildingEntityState,
  type MatchState,
} from "./simulation";
import type { BuildingType, CommandEnvelope, DomainEvent, GridPoint, PlayerId } from "./protocol";

function envelope(state: MatchState, sequence: number, command: CommandEnvelope["command"]): CommandEnvelope {
  return { matchId: state.matchId, playerId: "player-1", sequence, clientTick: state.tick, command };
}

function addCompletedBuilding(state: MatchState, ownerId: PlayerId, typeId: BuildingType, id: string, position: GridPoint): BuildingEntityState {
  const definition = BUILDINGS[typeId];
  const building: BuildingEntityState = {
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
    trainingQueue: [],
  };
  state.entities.push(building);
  return building;
}

function prepareStrongholdAdvance(state: MatchState): BuildingEntityState {
  const player = state.players.find((candidate) => candidate.id === "player-1")!;
  player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
  addCompletedBuilding(state, player.id, "barracks", "prerequisite-barracks", { x: 18, y: 18 });
  addCompletedBuilding(state, player.id, "lumberCamp", "prerequisite-lumber-camp", { x: 21, y: 18 });
  return state.entities.find((entity): entity is BuildingEntityState => (
    entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter"
  ))!;
}

describe("deterministic shared simulation", () => {
  it("defines the original three-tier settlement content and frontier defaults", () => {
    const state = createInitialState({ seed: 1, matchId: "settlement-content" });

    expect(RULES_VERSION).toBe("village-siege/0.4.0");
    expect(SETTLEMENT_TIERS).toEqual({
      frontier: { id: "frontier", cost: { food: 0, wood: 0, stone: 0 }, advanceTicks: 0, prerequisites: [] },
      stronghold: { id: "stronghold", cost: { food: 500, wood: 300, stone: 100 }, advanceTicks: 450, prerequisites: ["barracks", "lumberCamp"] },
      artificer: { id: "artificer", cost: { food: 750, wood: 500, stone: 300 }, advanceTicks: 600, prerequisites: ["archeryRange", "beastStable"] },
    });
    expect(state.players.every((player) => player.settlementTier === "frontier" && player.advancement === null)).toBe(true);
    expect(Object.fromEntries(Object.entries(BUILDINGS).map(([id, definition]) => [id, definition.requiredTier]))).toEqual({
      townCenter: "frontier",
      house: "frontier",
      lumberCamp: "frontier",
      farmstead: "frontier",
      barracks: "frontier",
      defenseTower: "stronghold",
      archeryRange: "stronghold",
      mageSanctum: "artificer",
      gunWorkshop: "artificer",
      beastStable: "stronghold",
      siegeWorkshop: "artificer",
    });
    expect(Object.fromEntries(Object.entries(UNITS).map(([id, definition]) => [id, definition.requiredTier]))).toEqual({
      villager: "frontier",
      militia: "frontier",
      spearman: "frontier",
      archer: "stronghold",
      mage: "artificer",
      musketeer: "artificer",
      scout: "stronghold",
      batteringRam: "artificer",
    });
    expect(UNITS.villager.carryCapacity).toBe(12);
    expect(Object.values(UNITS).filter((unit) => unit.id !== "villager").every((unit) => unit.carryCapacity === 0)).toBe(true);
    expect(BUILDINGS.townCenter.dropOffResources).toEqual(["food", "wood", "stone"]);
    expect(BUILDINGS.lumberCamp.dropOffResources).toEqual(["wood"]);
    expect(BUILDINGS.farmstead.dropOffResources).toEqual(["food"]);
    expect(RESOURCE_NODES).toEqual({
      food: { kind: "food", maxAmount: 360, renewAfterTicks: 300 },
      wood: { kind: "wood", maxAmount: 1_000, renewAfterTicks: null },
      stone: { kind: "stone", maxAmount: 700, renewAfterTicks: null },
    });
  });

  it("enforces settlement tiers for building and training", () => {
    const state = createInitialState({ seed: 2, matchId: "tier-gates" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const range = addCompletedBuilding(state, player.id, "archeryRange", "test-archery-range", { x: 18, y: 18 });

    expect(validateCommand(state, envelope(state, 0, {
      type: "build",
      builderIds: [villager.id],
      buildingType: "defenseTower",
      origin: { x: 12, y: 12 },
    }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
    expect(validateCommand(state, envelope(state, 0, {
      type: "train",
      producerId: range.id,
      unitType: "archer",
      count: 1,
    }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });

    player.settlementTier = "stronghold";
    expect(validateCommand(state, envelope(state, 0, {
      type: "build",
      builderIds: [villager.id],
      buildingType: "defenseTower",
      origin: { x: 12, y: 12 },
    }))).toEqual({ ok: true });
    expect(validateCommand(state, envelope(state, 0, {
      type: "train",
      producerId: range.id,
      unitType: "archer",
      count: 1,
    }))).toEqual({ ok: true });
    expect(validateCommand(state, envelope(state, 0, {
      type: "build",
      builderIds: [villager.id],
      buildingType: "siegeWorkshop",
      origin: { x: 12, y: 12 },
    }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
  });

  it("rejects invalid, unaffordable, and unprepared settlement advances", () => {
    const state = createInitialState({ seed: 3, matchId: "advance-validation" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    const foreignCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const house = addCompletedBuilding(state, player.id, "house", "not-a-town-center", { x: 18, y: 18 });
    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };

    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: foreignCenter.id, targetTier: "stronghold" }))).toEqual({ ok: false, code: "ENTITY_NOT_OWNED" });
    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: house.id, targetTier: "stronghold" }))).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "frontier" }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "artificer" }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });

    addCompletedBuilding(state, player.id, "barracks", "validation-barracks", { x: 21, y: 18 });
    addCompletedBuilding(state, player.id, "lumberCamp", "validation-lumber-camp", { x: 24, y: 18 });
    player.resources = { food: 499, wood: 300, stone: 100 };
    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" }))).toEqual({ ok: false, code: "INSUFFICIENT_RESOURCES" });

    townCenter.complete = false;
    player.resources = { food: 500, wood: 300, stone: 100 };
    expect(validateCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" }))).toEqual({ ok: false, code: "ACTION_ON_COOLDOWN" });
  });

  it("deducts once and atomically completes each settlement advance on its exact tick", () => {
    let state = createInitialState({ seed: 4, matchId: "advance-lifecycle" });
    const townCenter = prepareStrongholdAdvance(state);
    const start = applyCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" }));
    expect(start.validation).toEqual({ ok: true });
    expect(start.state.players[0]).toMatchObject({
      resources: { food: 4_500, wood: 4_700, stone: 4_900 },
      settlementTier: "frontier",
      advancement: { producerId: townCenter.id, targetTier: "stronghold", remainingTicks: 450 },
    });
    expect(start.events.some((event) => event.type === "settlementAdvanced")).toBe(false);

    const duplicate = applyCommand(start.state, envelope(start.state, 1, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" }));
    expect(duplicate.validation).toEqual({ ok: false, code: "ACTION_ON_COOLDOWN" });
    expect(duplicate.state.players[0]!.resources).toEqual({ food: 4_500, wood: 4_700, stone: 4_900 });

    const pending = stepSimulation(start.state, [], 449);
    expect(pending.state.players[0]).toMatchObject({
      settlementTier: "frontier",
      advancement: { producerId: townCenter.id, targetTier: "stronghold", remainingTicks: 1 },
    });
    expect(pending.events.some((event) => event.type === "settlementAdvanced")).toBe(false);

    const completed = stepSimulation(pending.state, [], 1);
    expect(completed.state.players[0]).toMatchObject({ settlementTier: "stronghold", advancement: null });
    expect(completed.events).toContainEqual({
      type: "settlementAdvanced",
      playerId: "player-1",
      producerId: townCenter.id,
      settlementTier: "stronghold",
    });
    expect(validateCommand(completed.state, envelope(completed.state, 1, {
      type: "advanceSettlement",
      producerId: townCenter.id,
      targetTier: "stronghold",
    }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });

    state = completed.state;
    addCompletedBuilding(state, "player-1", "archeryRange", "prerequisite-archery-range", { x: 18, y: 22 });
    addCompletedBuilding(state, "player-1", "beastStable", "prerequisite-beast-stable", { x: 21, y: 22 });
    const artificer = applyCommand(state, envelope(state, 1, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "artificer" }));
    expect(artificer.validation).toEqual({ ok: true });
    const final = stepSimulation(artificer.state, [], 600);
    expect(final.state.players[0]).toMatchObject({ settlementTier: "artificer", advancement: null });
    expect(final.events).toContainEqual({
      type: "settlementAdvanced",
      playerId: "player-1",
      producerId: townCenter.id,
      settlementTier: "artificer",
    });
  });

  it("cancels a pending advance without refund when its town center is destroyed", () => {
    const state = createInitialState({ seed: 5, matchId: "advance-cancelled" });
    const townCenter = prepareStrongholdAdvance(state);
    const started = applyCommand(state, envelope(state, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" }));
    const paidResources = { ...started.state.players[0]!.resources };
    const producer = started.state.entities.find((entity) => entity.id === townCenter.id)!;
    producer.hitPoints = 0;

    const cancelled = stepSimulation(started.state, [], 1);
    expect(cancelled.state.players[0]).toMatchObject({ settlementTier: "frontier", advancement: null, resources: paidResources });
    expect(cancelled.state.entities.some((entity) => entity.id === townCenter.id)).toBe(false);
    expect(cancelled.events).toContainEqual({ type: "entityRemoved", entityId: townCenter.id, reason: "destroyed" });
    expect(cancelled.events.some((event) => event.type === "settlementAdvanced")).toBe(false);
  });

  it("includes settlement advancement in deterministic state and replay hashes", () => {
    const initial = createInitialState({ seed: 6, matchId: "advance-replay" });
    const townCenter = prepareStrongholdAdvance(initial);
    const commands = [envelope(initial, 0, { type: "advanceSettlement", producerId: townCenter.id, targetTier: "stronghold" })];

    const first = stepSimulation(initial, commands, 450).state;
    const second = stepSimulation(initial, commands, 450).state;
    expect(first.players[0]).toMatchObject({ settlementTier: "stronghold", advancement: null });
    expect(hashMatchState(first)).toBe(hashMatchState(second));
    expect(hashReplay(initial, commands, 450)).toBe(hashReplay(initial, commands, 450));
  });

  it("repeats seeded random values and replay hashes", () => {
    const randomA = nextUint32(20260717);
    const randomB = nextUint32(20260717);
    expect(randomA).toEqual(randomB);

    const initial = createInitialState({ seed: 20260717, matchId: "replay" });
    const villager = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const commands = [envelope(initial, 0, { type: "move", entityIds: [villager.id], target: { x: 12, y: 12 } })];
    const first = stepSimulation(initial, commands, 80).state;
    const second = stepSimulation(initial, commands, 80).state;
    expect(hashMatchState(first)).toBe(hashMatchState(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(hashReplay(initial, commands, 80)).toBe(hashReplay(initial, commands, 80));
  });

  it("rejects malformed, foreign, unaffordable, and duplicate commands without mutation", () => {
    const initial = createInitialState({ seed: 7, matchId: "validation" });
    const originalHash = hashMatchState(initial);
    const foreign = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    expect(validateCommand(initial, envelope(initial, 0, { type: "move", entityIds: [foreign.id], target: { x: 5, y: 5 } }))).toEqual({ ok: false, code: "ENTITY_NOT_OWNED" });
    expect(validateCommand(initial, { ...envelope(initial, 0, { type: "surrender" }), forgedDamage: 999 })).toEqual({ ok: false, code: "INVALID_PAYLOAD" });

    const poor = JSON.parse(JSON.stringify(initial)) as MatchState;
    poor.players[0]!.resources = { food: 0, wood: 0, stone: 0 };
    const ownVillager = poor.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    expect(validateCommand(poor, envelope(poor, 0, { type: "build", builderIds: [ownVillager.id], buildingType: "house", origin: { x: 10, y: 10 } }))).toEqual({ ok: false, code: "INSUFFICIENT_RESOURCES" });

    const accepted = applyCommand(initial, envelope(initial, 1, { type: "move", entityIds: [ownVillager.id], target: { x: 10, y: 10 } }));
    expect(accepted.validation).toEqual({ ok: true });
    expect(validateCommand(accepted.state, envelope(accepted.state, 1, { type: "stop", entityIds: [ownVillager.id] }))).toEqual({ ok: false, code: "STALE_OR_DUPLICATE_SEQUENCE" });
    expect(hashMatchState(initial)).toBe(originalHash);
  });

  it("counts population cost instead of entity count for trained units", () => {
    const initial = createInitialState({ seed: 19, matchId: "population-cost" });
    const player = initial.players.find((candidate) => candidate.id === "player-1")!;
    const unit = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id);
    expect(unit?.kind).toBe("unit");
    if (!unit || unit.kind !== "unit") throw new Error("missing player unit");

    const previousUsed = player.population.used;
    unit.typeId = "batteringRam";
    const next = stepSimulation(initial, [], 1).state;
    const nextPlayer = next.players.find((candidate) => candidate.id === player.id)!;

    expect(nextPlayer.population.used).toBe(previousUsed - 1 + 3);
    nextPlayer.population.capacity = nextPlayer.population.used;
    const townCenter = next.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter");
    expect(townCenter?.kind).toBe("building");
    expect(validateCommand(next, envelope(next, 0, {
      type: "train",
      producerId: townCenter!.id,
      unitType: "villager",
      count: 1,
    }))).toEqual({ ok: false, code: "ACTION_ON_COOLDOWN" });
  });

  it("rejects a multi-unit training command that would overflow the queue", () => {
    const state = createInitialState({ seed: 21, matchId: "queue-depth-count" });
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    expect(townCenter?.kind).toBe("building");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing town center");
    townCenter.trainingQueue = Array.from({ length: 4 }, () => ({ unitType: "villager" as const, remainingTicks: 120 }));
    expect(validateCommand(state, envelope(state, 0, {
      type: "train",
      producerId: townCenter.id,
      unitType: "villager",
      count: 2,
    }))).toEqual({ ok: false, code: "ACTION_ON_COOLDOWN" });
  });

  it("uses clamped per-player spawn overrides without changing the other bootstrap rules", () => {
    const state = createInitialState({
      seed: 23,
      matchId: "spawn-overrides",
      map: { width: 12, height: 10 },
      spawnOverrides: {
        "player-1": { x: -4, y: 4 },
        "player-2": { x: 10, y: 99 },
      },
    });
    const playerOneCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    const playerTwoCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter");

    expect(playerOneCenter?.position).toEqual({ x: 0, y: 4 });
    expect(playerTwoCenter?.position).toEqual({ x: 10, y: 8 });
    expect(state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === "player-1")).toHaveLength(3);
    expect(state.entities.filter((entity) => entity.kind === "resource" && entity.position.x <= 2)).toHaveLength(3);
  });

  it("uses non-overlapping in-bounds defaults for the village assault map", () => {
    const state = createInitialState({
      seed: 231,
      matchId: "village-assault-spawns",
      map: { id: "villageAssault", width: 18, height: 16 },
      players: [
        { id: "p1", teamId: "t1", villageId: "pinehold" },
        { id: "p2", teamId: "t2", villageId: "riverstead" },
        { id: "p3", teamId: "t3", villageId: "highcrag" },
        { id: "p4", teamId: "t4", villageId: "marshwatch" },
        { id: "p5", teamId: "t5", villageId: "sunfield" },
      ],
    });
    const staticCells = state.entities
      .filter((entity) => entity.kind !== "unit")
      .flatMap((entity) => getEntityFootprintCells(entity));
    const keys = staticCells.map((cell) => `${cell.x},${cell.y}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(staticCells.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < 18 && cell.y < 16)).toBe(true);
  });

  it("rejects multi-cell footprints outside the map or overlapping a resource", () => {
    const state = createInitialState({
      seed: 24,
      matchId: "multi-cell-placement",
      map: { width: 12, height: 10 },
      spawnOverrides: {
        "player-1": { x: 3, y: 3 },
        "player-2": { x: 9, y: 7 },
      },
    });
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const wood = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 5)!;

    expect(wood.position).toEqual({ x: 1, y: 3 });
    expect(isBuildLocationAvailable(state, "siegeWorkshop", { x: 10, y: 7 })).toBe(false);
    expect(validateCommand(state, envelope(state, 0, {
      type: "build",
      builderIds: [villager.id],
      buildingType: "siegeWorkshop",
      origin: { x: 10, y: 7 },
    }))).toEqual({ ok: false, code: "TARGET_NOT_REACHABLE" });

    expect(isBuildLocationAvailable(state, "barracks", wood.position)).toBe(false);
    expect(validateCommand(state, envelope(state, 0, {
      type: "build",
      builderIds: [villager.id],
      buildingType: "barracks",
      origin: wood.position,
    }))).toEqual({ ok: false, code: "TARGET_NOT_REACHABLE" });
    expect(isBuildLocationAvailable(state, "siegeWorkshop", { x: 6, y: 5 })).toBe(true);
  });

  it("replays the same deterministic detour around a 2x2 building", () => {
    const initial = createInitialState({
      seed: 25,
      matchId: "building-detour-replay",
      map: { width: 10, height: 7 },
      spawnOverrides: {
        "player-1": { x: 3, y: 1 },
        "player-2": { x: 8, y: 5 },
      },
    });
    const mover = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const blocker = initial.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    mover.position = { x: 1, y: 2 };
    initial.entities = initial.entities.filter((entity) => entity.kind === "building" || entity.id === mover.id);
    blocker.position = { x: 3, y: 1 };
    const commands = [envelope(initial, 0, { type: "move", entityIds: [mover.id], target: { x: 6, y: 2 } })];

    const first = stepSimulation(initial, commands, 20).state;
    const second = stepSimulation(initial, commands, 20).state;
    const firstMover = first.entities.find((entity) => entity.id === mover.id);
    expect(firstMover?.position).toEqual({ x: 2, y: 3 });
    expect(first).toEqual(second);
    expect(hashMatchState(first)).toBe(hashMatchState(second));
    expect(hashReplay(initial, commands, 20)).toBe(hashReplay(initial, commands, 20));
  });

  it("spawns queued units on distinct free perimeter cells", () => {
    const initial = createInitialState({ seed: 26, matchId: "perimeter-spawn" });
    const townCenter = initial.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    const existingVillagerIds = new Set(initial.entities
      .filter((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")
      .map((entity) => entity.id));
    const producerFootprint = new Set(getEntityFootprintCells(townCenter).map((point) => `${point.x},${point.y}`));
    const occupiedBefore = new Set(initial.entities
      .filter((entity) => entity.kind !== "unit")
      .flatMap(getEntityFootprintCells)
      .map((point) => `${point.x},${point.y}`));

    const queued = applyCommand(initial, envelope(initial, 0, {
      type: "train",
      producerId: townCenter.id,
      unitType: "villager",
      count: 2,
    }));
    expect(queued.validation).toEqual({ ok: true });
    const result = stepSimulation(queued.state, [], 240);
    const trained = result.state.entities.filter((entity) => (
      entity.kind === "unit"
      && entity.ownerId === "player-1"
      && entity.typeId === "villager"
      && !existingVillagerIds.has(entity.id)
    ));
    const trainedKeys = trained.map((unit) => `${unit.position.x},${unit.position.y}`);

    expect(trained).toHaveLength(2);
    expect(new Set(trainedKeys).size).toBe(2);
    expect(trainedKeys.every((key) => !producerFootprint.has(key) && !occupiedBefore.has(key))).toBe(true);
    expect(trained.every((unit) => getEntityFootprintCells(townCenter).some((cell) => (
      Math.abs(cell.x - unit.position.x) + Math.abs(cell.y - unit.position.y) === 1
    )))).toBe(true);
    expect(result.events.filter((event) => event.type === "entitySpawned" && event.entity.typeId === "villager")).toHaveLength(2);
  });

  it("skips water and rock cells when choosing a training exit", () => {
    const initial = createInitialState({
      seed: 261,
      matchId: "walkable-training-exit",
      map: { id: "villageAssault", width: 18, height: 16 },
      spawnOverrides: { "player-1": { x: 3, y: 8 }, "player-2": { x: 14, y: 8 } },
    });
    const townCenter = initial.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    if (townCenter.kind !== "building") throw new Error("missing town center");
    townCenter.position = { x: 8, y: 13 };
    const existingVillagerIds = new Set(initial.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === "player-1").map((entity) => entity.id));
    const queued = applyCommand(initial, envelope(initial, 0, { type: "train", producerId: townCenter.id, unitType: "villager", count: 1 }));
    expect(queued.validation).toEqual({ ok: true });

    const result = stepSimulation(queued.state, [], 120).state;
    const trained = result.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && !existingVillagerIds.has(entity.id));
    expect(trained?.kind).toBe("unit");
    expect(trained && isVillageAssaultWalkableCell(trained.position)).toBe(true);
    expect(trained?.position).not.toEqual({ x: 8, y: 12 });
  });

  it("runs the deterministic gather, build, population, and training loop end to end", () => {
    let state = createInitialState({ seed: 29, matchId: "economy-loop" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const wood = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 10)!;
    const startingWood = player.resources.wood;
    const startingNodeAmount = wood.kind === "resource" ? wood.amount : 0;

    state = applyCommand(state, envelope(state, 0, { type: "gather", entityIds: [villager.id], targetId: wood.id })).state;
    for (let tick = 0; tick < 40; tick += 1) {
      state = stepSimulation(state, [], 1).state;
      const carrier = state.entities.find((entity) => entity.id === villager.id);
      if (carrier?.kind === "unit" && carrier.cargo.amount > 0) break;
    }
    const gatheredPlayer = state.players.find((candidate) => candidate.id === player.id)!;
    const gatheredWood = state.entities.find((entity) => entity.id === wood.id);
    const carryingVillager = state.entities.find((entity) => entity.id === villager.id);
    expect(gatheredPlayer.resources.wood).toBe(startingWood);
    expect(carryingVillager?.kind).toBe("unit");
    if (!carryingVillager || carryingVillager.kind !== "unit") throw new Error("gathering villager disappeared");
    expect(carryingVillager.cargo).toEqual({ kind: "wood", amount: 6 });
    expect(carryingVillager.gatherRemainderMilli.wood).toBe(180);
    expect(gatheredWood?.kind).toBe("resource");
    if (!gatheredWood || gatheredWood.kind !== "resource") throw new Error("wood node depleted unexpectedly");
    expect(gatheredWood.amount).toBe(startingNodeAmount - 6);

    const depositEvents: DomainEvent[] = [];
    for (let tick = 0; tick < 120; tick += 1) {
      const stepped = stepSimulation(state, [], 1);
      state = stepped.state;
      depositEvents.push(...stepped.events);
      if (stepped.events.some((event) => event.type === "resourcesDeposited" && event.unitId === villager.id)) break;
    }
    expect(state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(startingWood + 12);
    expect(state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: null, amount: 0 } });
    expect(depositEvents).toContainEqual({
      type: "resourcesDeposited",
      playerId: player.id,
      unitId: villager.id,
      dropOffId: state.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!.id,
      resourceKind: "wood",
      amount: 12,
    });

    state = applyCommand(state, envelope(state, 1, { type: "build", builderIds: [villager.id], buildingType: "house", origin: { x: 9, y: 9 } })).state;
    state = stepSimulation(state, [], 320).state;
    const house = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "house");
    expect(house).toMatchObject({ complete: true, hitPoints: 360, constructionRemainingTicks: 0 });
    expect(state.players.find((candidate) => candidate.id === player.id)?.population.capacity).toBe(18);

    state = applyCommand(state, envelope(state, 2, { type: "build", builderIds: [villager.id], buildingType: "barracks", origin: { x: 11, y: 9 } })).state;
    state = stepSimulation(state, [], 340).state;
    const barracks = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "barracks");
    expect(barracks?.kind).toBe("building");
    expect(barracks).toMatchObject({ complete: true, constructionRemainingTicks: 0 });
    if (!barracks || barracks.kind !== "building") throw new Error("barracks was not constructed");

    const militiaBefore = state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "militia").length;
    const trained = applyCommand(state, envelope(state, 3, { type: "train", producerId: barracks.id, unitType: "militia", count: 1 }));
    expect(trained.validation).toEqual({ ok: true });
    state = stepSimulation(trained.state, [], 150).state;
    expect(state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "militia")).toHaveLength(militiaBefore + 1);
    expect(state.players.find((candidate) => candidate.id === player.id)?.population.used).toBe(4);
  });

  it("uses nearby economy buildings as legal resource-specific drop-off points", () => {
    let state = createInitialState({ seed: 30, matchId: "economy-building-bonus" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const wood = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 10)!;

    state = applyCommand(state, envelope(state, 0, {
      type: "build",
      builderIds: [villager.id],
      buildingType: "lumberCamp",
      origin: { x: 4, y: 7 },
    })).state;
    state = stepSimulation(state, [], 220).state;
    const camp = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "lumberCamp");
    expect(camp).toMatchObject({ complete: true, constructionRemainingTicks: 0 });

    const before = state.players.find((candidate) => candidate.id === player.id)!.resources.wood;
    state = applyCommand(state, envelope(state, 1, { type: "gather", entityIds: [villager.id], targetId: wood.id })).state;
    for (let tick = 0; tick < 40; tick += 1) {
      state = stepSimulation(state, [], 1).state;
      const carrier = state.entities.find((entity) => entity.id === villager.id);
      if (carrier?.kind === "unit" && carrier.cargo.amount > 0) break;
    }
    expect(state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before);
    expect(state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: "wood", amount: 6 } });
    const dropped = applyCommand(state, envelope(state, 2, { type: "dropOff", entityIds: [villager.id], targetId: camp!.id }));
    expect(dropped.validation).toEqual({ ok: true });
    state = dropped.state;
    const deliveryEvents: DomainEvent[] = [];
    for (let tick = 0; tick < 80; tick += 1) {
      const stepped = stepSimulation(state, [], 1);
      state = stepped.state;
      deliveryEvents.push(...stepped.events);
      if (stepped.events.some((event) => event.type === "resourcesDeposited" && event.unitId === villager.id)) break;
    }
    expect(state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before + 6);
    expect(deliveryEvents).toContainEqual({
      type: "resourcesDeposited",
      playerId: player.id,
      unitId: villager.id,
      dropOffId: camp!.id,
      resourceKind: "wood",
      amount: 6,
    });
  });

  it("validates resource-specific manual drop-off without deleting cargo on interruption", () => {
    let state = createInitialState({ seed: 301, matchId: "manual-drop-off-rules" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    const foreignCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const lumberCamp = addCompletedBuilding(state, player.id, "lumberCamp", "drop-lumber", { x: 9, y: 8 });
    const farmstead = addCompletedBuilding(state, player.id, "farmstead", "drop-food", { x: 12, y: 8 });
    villager.position = { x: 8, y: 8 };
    villager.cargo = { kind: "wood", amount: 5 };

    expect(validateCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [villager.id], targetId: townCenter.id }))).toEqual({ ok: true });
    expect(validateCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [villager.id], targetId: lumberCamp.id }))).toEqual({ ok: true });
    expect(validateCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [villager.id], targetId: farmstead.id }))).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
    expect(validateCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [villager.id], targetId: foreignCenter.id }))).toEqual({ ok: false, code: "TARGET_NOT_VISIBLE" });

    const stopped = applyCommand(state, envelope(state, 0, { type: "stop", entityIds: [villager.id] }));
    expect(stopped.state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: "wood", amount: 5 }, order: { type: "idle" } });
    const delivered = applyCommand(stopped.state, envelope(stopped.state, 1, { type: "dropOff", entityIds: [villager.id], targetId: lumberCamp.id }));
    state = stepSimulation(delivered.state, [], 1).state;
    expect(state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(425);
    expect(state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: null, amount: 0 }, order: { type: "idle" } });
  });

  it("uses a reachable far-side cardinal perimeter when the geometrically nearest drop-off side is sealed", () => {
    let state = createInitialState({ seed: 311, matchId: "reachable-drop-off-perimeter" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    townCenter.position = { x: 5, y: 5 };
    villager.position = { x: 1, y: 5 };
    villager.cargo = { kind: "wood", amount: 12 };
    addCompletedBuilding(state, player.id, "house", "sealed-west-north", { x: 4, y: 4 });
    addCompletedBuilding(state, player.id, "house", "sealed-west-entry", { x: 3, y: 5 });
    addCompletedBuilding(state, player.id, "house", "sealed-west-south", { x: 4, y: 6 });
    const before = player.resources.wood;

    const command = applyCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [villager.id], targetId: townCenter.id }));
    expect(command.validation).toEqual({ ok: true });
    const delivered = stepSimulation(command.state, [], 160);
    state = delivered.state;

    expect(state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before + 12);
    expect(state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: null, amount: 0 }, order: { type: "idle" } });
    expect(delivered.events).toContainEqual({ type: "resourcesDeposited", playerId: player.id, unitId: villager.id, dropOffId: townCenter.id, resourceKind: "wood", amount: 12 });
  });

  it("does not gather or unload diagonally through a sealed corner", () => {
    let gatherState = createInitialState({ seed: 312, matchId: "no-diagonal-gather" });
    const gatherPlayer = gatherState.players.find((candidate) => candidate.id === "player-1")!;
    const gatherer = gatherState.entities.find((entity) => entity.kind === "unit" && entity.ownerId === gatherPlayer.id && entity.typeId === "villager")!;
    const wood = gatherState.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 10)!;
    gatherer.position = { x: 4, y: 4 };
    wood.position = { x: 5, y: 5 };
    addCompletedBuilding(gatherState, gatherPlayer.id, "house", "gather-corner-east", { x: 5, y: 4 });
    addCompletedBuilding(gatherState, gatherPlayer.id, "house", "gather-corner-south", { x: 4, y: 5 });
    const woodBefore = wood.amount;
    gatherState = applyCommand(gatherState, envelope(gatherState, 0, { type: "gather", entityIds: [gatherer.id], targetId: wood.id })).state;
    gatherState = stepSimulation(gatherState, [], 1).state;
    expect(gatherState.entities.find((entity) => entity.id === gatherer.id)).toMatchObject({ cargo: { kind: null, amount: 0 } });
    expect(gatherState.entities.find((entity) => entity.id === wood.id)).toMatchObject({ amount: woodBefore });

    let dropState = createInitialState({ seed: 313, matchId: "no-diagonal-drop-off" });
    const dropPlayer = dropState.players.find((candidate) => candidate.id === "player-1")!;
    const carrier = dropState.entities.find((entity) => entity.kind === "unit" && entity.ownerId === dropPlayer.id && entity.typeId === "villager")!;
    const townCenter = dropState.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === dropPlayer.id && entity.typeId === "townCenter")!;
    townCenter.position = { x: 5, y: 5 };
    carrier.position = { x: 4, y: 4 };
    carrier.cargo = { kind: "wood", amount: 6 };
    addCompletedBuilding(dropState, dropPlayer.id, "house", "drop-corner-east", { x: 5, y: 4 });
    addCompletedBuilding(dropState, dropPlayer.id, "house", "drop-corner-south", { x: 4, y: 5 });
    const walletBefore = dropPlayer.resources.wood;
    dropState = applyCommand(dropState, envelope(dropState, 0, { type: "dropOff", entityIds: [carrier.id], targetId: townCenter.id })).state;
    dropState = stepSimulation(dropState, [], 1).state;
    expect(dropState.players.find((candidate) => candidate.id === dropPlayer.id)!.resources.wood).toBe(walletBefore);
    expect(dropState.entities.find((entity) => entity.id === carrier.id)).toMatchObject({ cargo: { kind: "wood", amount: 6 }, order: { type: "deliver" } });
  });

  it("reroutes a carrier when its assigned drop-off becomes unreachable", () => {
    let state = createInitialState({ seed: 314, matchId: "dynamic-drop-off-reroute" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const carrier = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    townCenter.position = { x: 5, y: 5 };
    const camp = addCompletedBuilding(state, player.id, "lumberCamp", "reroute-lumber", { x: 12, y: 5 });
    carrier.position = { x: 1, y: 5 };
    carrier.cargo = { kind: "wood", amount: 12 };
    state = applyCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [carrier.id], targetId: townCenter.id })).state;
    state = stepSimulation(state, [], 10).state;
    const seal = [
      { x: 5, y: 4 }, { x: 4, y: 5 }, { x: 6, y: 4 }, { x: 7, y: 5 },
      { x: 5, y: 7 }, { x: 4, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 7 },
    ];
    seal.forEach((position, index) => addCompletedBuilding(state, player.id, "house", `reroute-seal-${index}`, position));
    const before = state.players.find((candidate) => candidate.id === player.id)!.resources.wood;

    const delivered = stepSimulation(state, [], 220);
    expect(delivered.state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before + 12);
    expect(delivered.events).toContainEqual({ type: "resourcesDeposited", playerId: player.id, unitId: carrier.id, dropOffId: camp.id, resourceKind: "wood", amount: 12 });
  });

  it("preserves cargo and the delivery order while every drop-off is blocked, then resumes after reopening", () => {
    let state = createInitialState({ seed: 316, matchId: "blocked-drop-off-resume" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const carrier = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    townCenter.position = { x: 5, y: 5 };
    carrier.position = { x: 1, y: 5 };
    carrier.cargo = { kind: "wood", amount: 12 };
    state = applyCommand(state, envelope(state, 0, { type: "dropOff", entityIds: [carrier.id], targetId: townCenter.id })).state;
    const sealPositions = [
      { x: 5, y: 4 }, { x: 4, y: 5 }, { x: 6, y: 4 }, { x: 7, y: 5 },
      { x: 5, y: 7 }, { x: 4, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 7 },
    ];
    const sealIds = sealPositions.map((position, index) => addCompletedBuilding(state, player.id, "house", `resume-seal-${index}`, position).id);
    state = stepSimulation(state, [], 40).state;
    expect(state.entities.find((entity) => entity.id === carrier.id)).toMatchObject({ cargo: { kind: "wood", amount: 12 }, order: { type: "deliver" } });

    state.entities = state.entities.filter((entity) => !sealIds.includes(entity.id));
    const before = state.players.find((candidate) => candidate.id === player.id)!.resources.wood;
    const resumed = stepSimulation(state, [], 160);
    expect(resumed.state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before + 12);
    expect(resumed.events).toContainEqual({ type: "resourcesDeposited", playerId: player.id, unitId: carrier.id, dropOffId: townCenter.id, resourceKind: "wood", amount: 12 });
  });

  it("skips an unreachable nearer replacement source after the prior node disappears", () => {
    let state = createInitialState({ seed: 315, matchId: "reachable-source-retarget" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const gatherer = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const woodNodes = state.entities.filter((entity) => entity.kind === "resource" && entity.typeId === "wood");
    const near = woodNodes[0]!;
    const far = woodNodes[1]!;
    state.entities = state.entities.filter((entity) => entity.kind !== "resource" || entity.id === near.id || entity.id === far.id);
    gatherer.position = { x: 1, y: 5 };
    gatherer.order = { type: "gather", targetId: "depleted-source", resourceKind: "wood", phase: "toSource", dropOffId: null };
    near.position = { x: 5, y: 5 };
    far.position = { x: 9, y: 5 };
    [{ x: 5, y: 4 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 5 }]
      .forEach((position, index) => addCompletedBuilding(state, player.id, "house", `source-seal-${index}`, position));

    state = stepSimulation(state, [], 1).state;
    expect(state.entities.find((entity) => entity.id === gatherer.id)).toMatchObject({ order: { type: "gather", targetId: far.id, phase: "toSource" } });
  });

  it("depletes finite nodes without losing the final carried load", () => {
    let state = createInitialState({ seed: 302, matchId: "finite-node-final-load" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const wood = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 10)!;
    wood.amount = 5;
    wood.hitPoints = 5;
    const before = player.resources.wood;

    state = applyCommand(state, envelope(state, 0, { type: "gather", entityIds: [villager.id], targetId: wood.id })).state;
    const depletionEvents: DomainEvent[] = [];
    for (let tick = 0; tick < 40; tick += 1) {
      const stepped = stepSimulation(state, [], 1);
      state = stepped.state;
      depletionEvents.push(...stepped.events);
      if (!state.entities.some((entity) => entity.id === wood.id)) break;
    }
    expect(state.entities.some((entity) => entity.id === wood.id)).toBe(false);
    expect(state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: "wood", amount: 5 }, order: { type: "gather", phase: "toDropOff" } });
    expect(state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before);
    expect(depletionEvents).toContainEqual({ type: "resourceDepleted", resourceId: wood.id, resourceKind: "wood", renewable: false, renewAtTick: null });
    expect(depletionEvents).toContainEqual({ type: "entityRemoved", entityId: wood.id, reason: "depleted" });

    const deposited = stepSimulation(state, [], 1);
    expect(deposited.state.players.find((candidate) => candidate.id === player.id)!.resources.wood).toBe(before + 5);
    expect(deposited.events.some((event) => event.type === "resourcesDeposited" && event.amount === 5)).toBe(true);
  });

  it("resolves multiple villagers contesting the last stock in stable id order with one depletion event", () => {
    let state = createInitialState({ seed: 317, matchId: "stable-final-stock" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villagers = state.entities
      .filter((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")
      .sort((left, right) => left.id.localeCompare(right.id));
    const wood = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 10)!;
    wood.position = { x: 5, y: 5 };
    wood.amount = 8;
    wood.hitPoints = 8;
    villagers[0]!.position = { x: 4, y: 5 };
    villagers[1]!.position = { x: 5, y: 4 };
    state = applyCommand(state, envelope(state, 0, { type: "gather", entityIds: villagers.slice(0, 2).map((villager) => villager.id), targetId: wood.id })).state;

    const depleted = stepSimulation(state, [], 1);
    const first = depleted.state.entities.find((entity) => entity.id === villagers[0]!.id);
    const second = depleted.state.entities.find((entity) => entity.id === villagers[1]!.id);
    expect(first).toMatchObject({ cargo: { kind: "wood", amount: 6 } });
    expect(second).toMatchObject({ cargo: { kind: "wood", amount: 2 } });
    expect(depleted.state.entities.some((entity) => entity.id === wood.id)).toBe(false);
    expect(depleted.events.filter((event) => event.type === "resourceDepleted" && event.resourceId === wood.id)).toHaveLength(1);
  });

  it("keeps depleted food fields fallow and renews them on the exact deterministic tick", () => {
    let state = createInitialState({ seed: 303, matchId: "renewable-food-field" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const food = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "food" && entity.position.x < 10)!;
    villager.position = { x: food.position.x, y: food.position.y + 1 };
    food.amount = 6;
    food.hitPoints = 6;

    state = applyCommand(state, envelope(state, 0, { type: "gather", entityIds: [villager.id], targetId: food.id })).state;
    const depleted = stepSimulation(state, [], 1);
    state = depleted.state;
    const fallow = state.entities.find((entity) => entity.id === food.id);
    expect(fallow).toMatchObject({ kind: "resource", amount: 0, renewAtTick: 301 });
    expect(depleted.events).toContainEqual({ type: "resourceDepleted", resourceId: food.id, resourceKind: "food", renewable: true, renewAtTick: 301 });

    state = stepSimulation(state, [], 1).state;
    state = applyCommand(state, envelope(state, 1, { type: "stop", entityIds: [villager.id] })).state;
    const beforeRenewal = stepSimulation(state, [], 298);
    expect(beforeRenewal.state.tick).toBe(300);
    expect(beforeRenewal.state.entities.find((entity) => entity.id === food.id)).toMatchObject({ amount: 0, renewAtTick: 301 });
    const renewed = stepSimulation(beforeRenewal.state, [], 1);
    expect(renewed.state.entities.find((entity) => entity.id === food.id)).toMatchObject({ amount: 360, hitPoints: 360, renewAtTick: null });
    expect(renewed.events).toContainEqual({ type: "resourceRenewed", resourceId: food.id, resourceKind: "food", amount: 360 });
  });

  it("keeps returning gather orders idempotent and hashes nested cargo state", () => {
    let state = createInitialState({ seed: 304, matchId: "gather-idempotence" });
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const wood = state.entities.find((entity) => entity.kind === "resource" && entity.typeId === "wood" && entity.position.x < 10)!;
    state = applyCommand(state, envelope(state, 0, { type: "gather", entityIds: [villager.id], targetId: wood.id })).state;
    for (let tick = 0; tick < 80; tick += 1) {
      state = stepSimulation(state, [], 1).state;
      const carrier = state.entities.find((entity) => entity.id === villager.id);
      if (carrier?.kind === "unit" && carrier.cargo.amount >= UNITS.villager.carryCapacity) break;
    }
    expect(state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: "wood", amount: 12 }, order: { type: "gather", phase: "toDropOff" } });

    const repeated = applyCommand(state, envelope(state, 1, { type: "gather", entityIds: [villager.id], targetId: wood.id }));
    expect(repeated.validation).toEqual({ ok: true });
    expect(repeated.state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { kind: "wood", amount: 12 }, order: { type: "gather", phase: "toDropOff" } });

    const cloned = cloneMatchState(repeated.state);
    const clonedVillager = cloned.entities.find((entity) => entity.id === villager.id);
    expect(clonedVillager?.kind).toBe("unit");
    if (!clonedVillager || clonedVillager.kind !== "unit") throw new Error("cloned villager missing");
    clonedVillager.cargo.amount = 11;
    expect(repeated.state.entities.find((entity) => entity.id === villager.id)).toMatchObject({ cargo: { amount: 12 } });
    expect(hashMatchState(cloned)).not.toBe(hashMatchState(repeated.state));
  });

  it("applies the selected village movement trait inside the authoritative simulation", () => {
    let state = createInitialState({
      seed: 32,
      matchId: "village-trait-speed",
      players: [
        { id: "player-1", teamId: "team-1", villageId: "riverstead" },
        { id: "player-2", teamId: "team-2", villageId: "pinehold" },
      ],
    });
    const villager = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    state = applyCommand(state, envelope(state, 0, { type: "move", entityIds: [villager.id], target: { x: 20, y: 20 } })).state;
    state = stepSimulation(state, [], 1).state;
    const moved = state.entities.find((entity) => entity.id === villager.id);
    expect(moved?.kind).toBe("unit");
    if (!moved || moved.kind !== "unit") throw new Error("riverstead villager disappeared");
    expect(moved.movementProgress).toBeCloseTo(1133);
  });

  it("finishes conquest after an enemy town center is destroyed and its rebuild grace expires", () => {
    const initial = createInitialState({ seed: 31, matchId: "town-center-conquest" });
    const attacker = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const enemyCenter = initial.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    enemyCenter.position = { x: attacker.position.x, y: attacker.position.y + 1 };
    enemyCenter.hitPoints = 4;

    const attack = applyCommand(initial, envelope(initial, 0, { type: "attack", entityIds: [attacker.id], targetId: enemyCenter.id }));
    expect(attack.validation).toEqual({ ok: true });
    const result = stepSimulation(attack.state, [], 601);

    expect(result.state.phase).toBe("finished");
    expect(result.state.finishReason).toBe("conquest");
    expect(result.state.winningTeamIds).toEqual(["team-1"]);
    expect(result.events).toContainEqual({ type: "entityRemoved", entityId: enemyCenter.id, reason: "destroyed" });
    expect(result.events).toContainEqual({ type: "matchFinished", winningTeamIds: ["team-1"], reason: "conquest" });
  }, 60_000);
});
