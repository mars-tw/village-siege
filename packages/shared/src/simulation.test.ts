import { describe, expect, it } from "vitest";
import { nextUint32 } from "./random";
import { VILLAGE_ASSAULT_LAYOUT_IDS, isVillageAssaultBuildableCell, isVillageAssaultWalkableCell } from "./battlefield";
import { BUILDINGS, RESOURCE_NODES, RULES_VERSION, SETTLEMENT_TIERS, TECHNOLOGIES, TECHNOLOGY_ORDER, UNITS } from "./content";
import { COMBAT_UNIT_IDS, COMBAT_UNITS, COUNTER_MATRIX, calculateDamage, type CombatUnitId } from "./combat";
import { getAiObservation } from "./ai";
import {
  applyCommand,
  cloneMatchState,
  createInitialState,
  getEntityFootprintCells,
  getEffectiveBuildingMaxHitPoints,
  getEffectiveCarryCapacity,
  getEffectiveGatherRatePermille,
  getEffectiveUnitAttackDamage,
  getEffectiveUnitMaxHitPoints,
  getEffectiveUnitSpeedMilliTilesPerSecond,
  hashMatchState,
  hashReplay,
  isBuildLocationAvailable,
  isRallyPointAvailable,
  stepSimulation,
  toPublicEntity,
  toPublicProjectile,
  validateCommand,
  type BuildingEntityState,
  type MatchState,
  type MonsterEntityState,
  type ProjectileState,
  type ResourceEntityState,
  type UnitEntityState,
} from "./simulation";
import { isGameCommand, type BuildingType, type CommandEnvelope, type DomainEvent, type GridPoint, type PlayerId } from "./protocol";

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
    statuses: [],
    rallyPoint: null,
    productionQueue: [],
    orientation: "ne",
    gateOpen: false,
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

function configureCombatUnit(state: MatchState, ownerId: PlayerId, index: number, typeId: CombatUnitId, position: GridPoint): UnitEntityState {
  const unit = state.entities.filter((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === ownerId)[index]!;
  const definition = UNITS[typeId];
  unit.typeId = typeId;
  unit.position = { ...position };
  unit.hitPoints = definition.maxHitPoints;
  unit.maxHitPoints = definition.maxHitPoints;
  unit.order = { type: "idle" };
  unit.movementProgress = 0;
  unit.attackCooldownTicks = 0;
  unit.workCooldownTicks = 0;
  unit.facing = "e";
  unit.stance = "holdGround";
  unit.formation = "line";
  unit.combat = { phase: "ready", action: null, abilityId: null, target: null, commitTick: null, readyTick: 0 };
  unit.abilityReadyTick = 0;
  unit.passive = { stationarySinceTick: state.tick, movedTilesSinceAttack: 0, rhythmTargetId: null, rhythmStacks: 0, rhythmLastHitTick: 0, braceCooldownUntilTick: 0 };
  unit.statuses = [];
  return unit;
}

describe("deterministic shared simulation", () => {
  it("defines the original three-tier settlement content and frontier defaults", () => {
    const state = createInitialState({ seed: 1, matchId: "settlement-content" });

    expect(RULES_VERSION).toBe("village-siege/0.13.0");
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
      resinPalisade: "frontier",
      surveyGate: "frontier",
      copperLandmark: "stronghold",
    });
    expect(Object.fromEntries(Object.entries(UNITS).map(([id, definition]) => [id, definition.requiredTier]))).toEqual({
      villager: "frontier",
      warrior: "frontier",
      shieldBearer: "frontier",
      archer: "stronghold",
      mage: "artificer",
      musketeer: "artificer",
      boarRider: "stronghold",
      heavyCrossbowman: "artificer",
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
    expect(cancelled.events).toContainEqual(expect.objectContaining({
      type: "entityRemoved", entityId: townCenter.id, entity: expect.objectContaining({ id: townCenter.id }), reason: "destroyed",
    }));
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

  it("defines original technology contracts and strictly parses research commands", () => {
    expect(TECHNOLOGY_ORDER).toEqual([
      "hearthlandAlmanac",
      "resinboundKits",
      "layeredHarness",
      "surveyedFoundations",
      "windspurRigging",
      "starfireBores",
      "torsionCradles",
    ]);
    expect(Object.keys(TECHNOLOGIES)).toEqual(TECHNOLOGY_ORDER);
    expect(Object.values(TECHNOLOGIES).every((technology) => technology.researchTicks > 0 && Number.isSafeInteger(technology.researchTicks))).toBe(true);
    expect(isGameCommand({ type: "research", producerId: "forge-1", technologyId: "starfireBores" })).toBe(true);
    expect(isGameCommand({ type: "research", producerId: "", technologyId: "starfireBores" })).toBe(false);
    expect(isGameCommand({ type: "research", producerId: "forge-1", technologyId: "unknown" })).toBe(false);
    expect(isGameCommand({ type: "research", producerId: "forge-1", technologyId: "starfireBores", extra: true })).toBe(false);
  });

  it("strictly parses stable production cancellation and nullable rally commands", () => {
    expect(isGameCommand({ type: "cancelProduction", producerId: "hall-1", jobId: { commandSequence: 7, itemIndex: 2 } })).toBe(true);
    expect(isGameCommand({ type: "cancelProduction", producerId: "hall-1", jobId: { commandSequence: 7, itemIndex: -1 } })).toBe(false);
    expect(isGameCommand({ type: "cancelProduction", producerId: "hall-1", jobId: { commandSequence: 7, itemIndex: 2, extra: true } })).toBe(false);
    expect(isGameCommand({ type: "cancelProduction", producerId: "", jobId: { commandSequence: 7, itemIndex: 2 } })).toBe(false);
    expect(isGameCommand({ type: "setRallyPoint", producerId: "hall-1", target: { x: 10, y: 11 } })).toBe(true);
    expect(isGameCommand({ type: "setRallyPoint", producerId: "hall-1", target: null })).toBe(true);
    expect(isGameCommand({ type: "setRallyPoint", producerId: "hall-1", target: { x: 10.5, y: 11 } })).toBe(false);
    expect(isGameCommand({ type: "setRallyPoint", producerId: "hall-1", target: null, extra: true })).toBe(false);
  });

  it("shares one deterministic production queue between training and research", () => {
    const state = createInitialState({ seed: 61, matchId: "research-shared-lane" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    player.settlementTier = "stronghold";

    const firstTrain = applyCommand(state, envelope(state, 0, { type: "train", producerId: townCenter.id, unitType: "villager", count: 1 }));
    const research = applyCommand(firstTrain.state, envelope(firstTrain.state, 1, { type: "research", producerId: townCenter.id, technologyId: "surveyedFoundations" }));
    const secondTrain = applyCommand(research.state, envelope(research.state, 2, { type: "train", producerId: townCenter.id, unitType: "villager", count: 1 }));
    expect(secondTrain.validation).toEqual({ ok: true });
    const queuedCenter = secondTrain.state.entities.find((entity): entity is BuildingEntityState => entity.id === townCenter.id && entity.kind === "building")!;
    expect(queuedCenter.productionQueue.map((job) => job.kind)).toEqual(["train", "research", "train"]);

    const firstDone = stepSimulation(secondTrain.state, [], UNITS.villager.trainTicks);
    const afterFirst = firstDone.state.entities.find((entity): entity is BuildingEntityState => entity.id === townCenter.id && entity.kind === "building")!;
    expect(afterFirst.productionQueue[0]).toEqual({
      jobId: { commandSequence: 1, itemIndex: 0 },
      kind: "research",
      technologyId: "surveyedFoundations",
      remainingTicks: TECHNOLOGIES.surveyedFoundations.researchTicks,
      totalTicks: TECHNOLOGIES.surveyedFoundations.researchTicks,
      paidCost: TECHNOLOGIES.surveyedFoundations.cost,
    });

    const almost = stepSimulation(firstDone.state, [], TECHNOLOGIES.surveyedFoundations.researchTicks - 1);
    expect(almost.state.players[0]!.completedTechnologyIds).toEqual([]);
    expect(almost.events.some((event) => event.type === "technologyResearched")).toBe(false);

    const completed = stepSimulation(almost.state, [], 1);
    const upgradedCenter = completed.state.entities.find((entity): entity is BuildingEntityState => entity.id === townCenter.id && entity.kind === "building")!;
    expect(completed.state.players[0]!.completedTechnologyIds).toEqual(["surveyedFoundations"]);
    expect(upgradedCenter.maxHitPoints).toBe(1_399);
    expect(upgradedCenter.hitPoints).toBe(1_399);
    expect(upgradedCenter.productionQueue[0]).toEqual({
      jobId: { commandSequence: 2, itemIndex: 0 },
      kind: "train",
      unitType: "villager",
      remainingTicks: UNITS.villager.trainTicks,
      totalTicks: UNITS.villager.trainTicks,
      paidCost: UNITS.villager.cost,
    });
    expect(completed.events).toContainEqual({ type: "technologyResearched", playerId: player.id, producerId: townCenter.id, technologyId: "surveyedFoundations" });
  });

  it("cancels exact jobs by stable identity with deterministic progress refunds", () => {
    const state = createInitialState({ seed: 611, matchId: "production-cancel-refund" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    player.resources = { food: 1_000, wood: 1_000, stone: 1_000 };

    const queued = applyCommand(state, envelope(state, 0, { type: "train", producerId: townCenter.id, unitType: "villager", count: 3 }));
    expect(queued.validation).toEqual({ ok: true });
    expect((queued.state.entities.find((entity) => entity.id === townCenter.id) as BuildingEntityState).productionQueue.map((job) => job.jobId)).toEqual([
      { commandSequence: 0, itemIndex: 0 },
      { commandSequence: 0, itemIndex: 1 },
      { commandSequence: 0, itemIndex: 2 },
    ]);

    const progressed = stepSimulation(queued.state, [], 30).state;
    const middleCancelled = applyCommand(progressed, envelope(progressed, 1, {
      type: "cancelProduction",
      producerId: townCenter.id,
      jobId: { commandSequence: 0, itemIndex: 1 },
    }));
    expect(middleCancelled.validation).toEqual({ ok: true });
    expect(middleCancelled.state.players[0]!.resources.food).toBe(900);
    expect((middleCancelled.state.entities.find((entity) => entity.id === townCenter.id) as BuildingEntityState).productionQueue.map((job) => job.jobId)).toEqual([
      { commandSequence: 0, itemIndex: 0 },
      { commandSequence: 0, itemIndex: 2 },
    ]);
    expect(middleCancelled.events).toContainEqual({
      type: "productionCancelled",
      playerId: player.id,
      producerId: townCenter.id,
      jobId: { commandSequence: 0, itemIndex: 1 },
      formerQueueIndex: 1,
      job: { kind: "train", unitType: "villager" },
      remainingTicks: UNITS.villager.trainTicks,
      refunded: { food: 50, wood: 0, stone: 0 },
    });

    const activeCancelled = applyCommand(middleCancelled.state, envelope(middleCancelled.state, 2, {
      type: "cancelProduction",
      producerId: townCenter.id,
      jobId: { commandSequence: 0, itemIndex: 0 },
    }));
    expect(activeCancelled.state.players[0]!.resources.food).toBe(937);
    expect(activeCancelled.events).toContainEqual(expect.objectContaining({
      type: "productionCancelled",
      remainingTicks: 90,
      refunded: { food: 37, wood: 0, stone: 0 },
    }));

    const beforeRepeat = hashMatchState(activeCancelled.state);
    const repeated = applyCommand(activeCancelled.state, envelope(activeCancelled.state, 3, {
      type: "cancelProduction",
      producerId: townCenter.id,
      jobId: { commandSequence: 0, itemIndex: 0 },
    }));
    expect(repeated.validation).toEqual({ ok: false, code: "PRODUCTION_JOB_NOT_FOUND" });
    expect(hashMatchState(repeated.state)).toBe(beforeRepeat);
  });

  it("cancels research without completion and releases its duplicate lock", () => {
    const state = createInitialState({ seed: 612, matchId: "research-cancel-refund" });
    const player = state.players[0]!;
    player.settlementTier = "stronghold";
    player.resources = { food: 1_000, wood: 1_000, stone: 1_000 };
    const farmstead = addCompletedBuilding(state, player.id, "farmstead", "cancel-farmstead", { x: 18, y: 18 });
    const started = applyCommand(state, envelope(state, 0, { type: "research", producerId: farmstead.id, technologyId: "hearthlandAlmanac" }));
    const progressed = stepSimulation(started.state, [], 1).state;
    const cancelled = applyCommand(progressed, envelope(progressed, 1, {
      type: "cancelProduction",
      producerId: farmstead.id,
      jobId: { commandSequence: 0, itemIndex: 0 },
    }));
    expect(cancelled.state.players[0]).toMatchObject({
      resources: { food: 999, wood: 999, stone: 1_000 },
      completedTechnologyIds: [],
    });
    expect(cancelled.events.some((event) => event.type === "technologyResearched")).toBe(false);
    expect(validateCommand(cancelled.state, envelope(cancelled.state, 2, {
      type: "research",
      producerId: farmstead.id,
      technologyId: "hearthlandAlmanac",
    }))).toEqual({ ok: true });
  });

  it("sets, copies, clears, and executes a future-unit rally without blocking production", () => {
    const state = createInitialState({ seed: 613, matchId: "rally-lifecycle" });
    const player = state.players[0]!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    player.resources = { food: 1_000, wood: 1_000, stone: 1_000 };
    const target = { x: 10, y: 10 };
    expect(isRallyPointAvailable(state, townCenter.id, target)).toBe(true);
    const set = applyCommand(state, envelope(state, 0, { type: "setRallyPoint", producerId: townCenter.id, target }));
    target.x = 20;
    expect((set.state.entities.find((entity) => entity.id === townCenter.id) as BuildingEntityState).rallyPoint).toEqual({ x: 10, y: 10 });
    expect(set.events).toContainEqual({ type: "rallyPointChanged", playerId: player.id, producerId: townCenter.id, target: { x: 10, y: 10 } });

    const trained = applyCommand(set.state, envelope(set.state, 1, { type: "train", producerId: townCenter.id, unitType: "villager", count: 1 }));
    const completed = stepSimulation(trained.state, [], UNITS.villager.trainTicks);
    const rallied = completed.state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.id !== "unit-2" && entity.id !== "unit-3" && entity.id !== "unit-4" && entity.order.type === "move");
    expect(rallied).toMatchObject({ order: { type: "move", target: { x: 10, y: 10 } } });

    const cleared = applyCommand(completed.state, envelope(completed.state, 2, { type: "setRallyPoint", producerId: townCenter.id, target: null }));
    expect((cleared.state.entities.find((entity) => entity.id === townCenter.id) as BuildingEntityState).rallyPoint).toBeNull();
    expect(cleared.events).toContainEqual({ type: "rallyPointChanged", playerId: player.id, producerId: townCenter.id, target: null });
  });

  it("rejects illegal rally producers and leaves a spawned unit idle when the target later blocks", () => {
    const state = createInitialState({ seed: 614, matchId: "rally-invalidated" });
    const player = state.players[0]!;
    const townCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
    const house = addCompletedBuilding(state, player.id, "house", "rally-house", { x: 18, y: 18 });
    player.resources = { food: 1_000, wood: 1_000, stone: 1_000 };
    expect(validateCommand(state, envelope(state, 0, { type: "setRallyPoint", producerId: house.id, target: { x: 20, y: 20 } }))).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
    expect(validateCommand(state, envelope(state, 0, { type: "setRallyPoint", producerId: townCenter.id, target: townCenter.position }))).toEqual({ ok: false, code: "TARGET_NOT_REACHABLE" });

    const target = { x: 10, y: 10 };
    const set = applyCommand(state, envelope(state, 0, { type: "setRallyPoint", producerId: townCenter.id, target }));
    const trained = applyCommand(set.state, envelope(set.state, 1, { type: "train", producerId: townCenter.id, unitType: "villager", count: 1 }));
    const blocker = trained.state.entities.find((entity) => entity.kind === "resource" && entity.ownerId === null)!;
    blocker.position = { ...target };
    const completed = stepSimulation(trained.state, [], UNITS.villager.trainTicks);
    const spawned = completed.events.find((event) => event.type === "entitySpawned" && event.entity.typeId === "villager");
    expect(spawned).toBeDefined();
    const unit = spawned && completed.state.entities.find((entity) => entity.id === spawned.entity.id);
    expect(unit).toMatchObject({ kind: "unit", order: { type: "idle" } });
    expect((completed.state.entities.find((entity) => entity.id === townCenter.id) as BuildingEntityState).productionQueue).toEqual([]);
  });

  it("keeps nested production and rally state clone-isolated and canonically replay ordered", () => {
    const state = createInitialState({ seed: 615, matchId: "production-rally-replay" });
    state.players[0]!.resources = { food: 1_000, wood: 1_000, stone: 1_000 };
    const firstCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    const secondCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const firstRally: CommandEnvelope = { matchId: state.matchId, playerId: "player-1", sequence: 0, clientTick: 0, command: { type: "setRallyPoint", producerId: firstCenter.id, target: { x: 10, y: 10 } } };
    const secondRally: CommandEnvelope = { matchId: state.matchId, playerId: "player-2", sequence: 0, clientTick: 0, command: { type: "setRallyPoint", producerId: secondCenter.id, target: { x: 21, y: 10 } } };
    expect(hashReplay(state, [secondRally, firstRally], 0)).toBe(hashReplay(state, [firstRally, secondRally], 0));
    expect(hashMatchState(stepSimulation(state, [secondRally, firstRally], 0).state)).toBe(hashMatchState(stepSimulation(state, [firstRally, secondRally], 0).state));

    const rallied = applyCommand(state, firstRally).state;
    const trained = applyCommand(rallied, envelope(rallied, 1, { type: "train", producerId: firstCenter.id, unitType: "villager", count: 1 })).state;
    const cloned = cloneMatchState(trained);
    const clonedCenter = cloned.entities.find((entity) => entity.id === firstCenter.id) as BuildingEntityState;
    clonedCenter.rallyPoint = { x: 11, y: 11 };
    clonedCenter.productionQueue[0]!.jobId = { commandSequence: 99, itemIndex: 99 };
    clonedCenter.productionQueue[0]!.paidCost = { food: 999, wood: 999, stone: 999 };
    const originalCenter = trained.entities.find((entity) => entity.id === firstCenter.id) as BuildingEntityState;
    expect(originalCenter.rallyPoint).toEqual({ x: 10, y: 10 });
    expect(originalCenter.productionQueue[0]).toMatchObject({ jobId: { commandSequence: 1, itemIndex: 0 }, paidCost: UNITS.villager.cost });
    expect(hashMatchState(cloned)).not.toBe(hashMatchState(trained));
  });

  it("rejects illegal and player-global duplicate research without mutation", () => {
    const state = createInitialState({ seed: 62, matchId: "research-validation" });
    const player = state.players.find((candidate) => candidate.id === "player-1")!;
    const foreignCenter = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const farmA = addCompletedBuilding(state, player.id, "farmstead", "research-farm-a", { x: 18, y: 18 });
    const farmB = addCompletedBuilding(state, player.id, "farmstead", "research-farm-b", { x: 21, y: 18 });
    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    const originalHash = hashMatchState(state);

    expect(validateCommand(state, envelope(state, 0, { type: "research", producerId: foreignCenter.id, technologyId: "surveyedFoundations" }))).toEqual({ ok: false, code: "ENTITY_NOT_OWNED" });
    expect(validateCommand(state, envelope(state, 0, { type: "research", producerId: farmA.id, technologyId: "hearthlandAlmanac" }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
    expect(hashMatchState(state)).toBe(originalHash);

    player.settlementTier = "stronghold";
    expect(validateCommand(state, envelope(state, 0, { type: "research", producerId: farmA.id, technologyId: "surveyedFoundations" }))).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
    farmA.complete = false;
    expect(validateCommand(state, envelope(state, 0, { type: "research", producerId: farmA.id, technologyId: "hearthlandAlmanac" }))).toEqual({ ok: false, code: "ACTION_ON_COOLDOWN" });
    farmA.complete = true;
    farmA.hitPoints = 0;
    expect(validateCommand(state, envelope(state, 0, { type: "research", producerId: farmA.id, technologyId: "hearthlandAlmanac" }))).toEqual({ ok: false, code: "ACTION_ON_COOLDOWN" });
    farmA.hitPoints = farmA.maxHitPoints;
    player.resources = { food: 219, wood: 80, stone: 0 };
    expect(validateCommand(state, envelope(state, 0, { type: "research", producerId: farmA.id, technologyId: "hearthlandAlmanac" }))).toEqual({ ok: false, code: "INSUFFICIENT_RESOURCES" });

    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    const started = applyCommand(state, envelope(state, 0, { type: "research", producerId: farmA.id, technologyId: "hearthlandAlmanac" }));
    expect(started.validation).toEqual({ ok: true });
    expect(started.state.players[0]!.resources).toEqual({ food: 4_780, wood: 4_920, stone: 5_000 });
    const duplicateHash = hashMatchState(started.state);
    expect(validateCommand(started.state, envelope(started.state, 1, { type: "research", producerId: farmB.id, technologyId: "hearthlandAlmanac" }))).toEqual({ ok: false, code: "DUPLICATE_RESEARCH" });
    expect(hashMatchState(started.state)).toBe(duplicateHash);

    const completed = stepSimulation(started.state, [], TECHNOLOGIES.hearthlandAlmanac.researchTicks).state;
    expect(validateCommand(completed, envelope(completed, 1, { type: "research", producerId: farmB.id, technologyId: "hearthlandAlmanac" }))).toEqual({ ok: false, code: "DUPLICATE_RESEARCH" });
    const gunWorkshop = addCompletedBuilding(completed, player.id, "gunWorkshop", "research-gun-workshop", { x: 24, y: 18 });
    completed.players[0]!.settlementTier = "artificer";
    expect(validateCommand(completed, envelope(completed, 1, { type: "research", producerId: gunWorkshop.id, technologyId: "starfireBores" }))).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
  });

  it("cancels destroyed-producer research without refund or completion", () => {
    const initial = createInitialState({ seed: 63, matchId: "research-destroyed" });
    const player = initial.players[0]!;
    player.settlementTier = "stronghold";
    player.resources = { food: 1_000, wood: 1_000, stone: 1_000 };
    const farm = addCompletedBuilding(initial, player.id, "farmstead", "doomed-research-farm", { x: 18, y: 18 });
    const started = applyCommand(initial, envelope(initial, 0, { type: "research", producerId: farm.id, technologyId: "hearthlandAlmanac" }));
    const paidWallet = { ...started.state.players[0]!.resources };
    started.state.entities.find((entity) => entity.id === farm.id)!.hitPoints = 0;

    const result = stepSimulation(started.state, [], TECHNOLOGIES.hearthlandAlmanac.researchTicks);
    expect(result.state.entities.some((entity) => entity.id === farm.id)).toBe(false);
    expect(result.state.players[0]!.completedTechnologyIds).toEqual([]);
    expect(result.state.players[0]!.resources).toEqual(paidWallet);
    expect(result.events.some((event) => event.type === "technologyResearched")).toBe(false);
  });

  it("derives isolated economy, combat, mobility, durability, and future-unit effects", () => {
    const state = createInitialState({ seed: 64, matchId: "research-effects" });
    const player = state.players[0]!;
    const opponent = state.players[1]!;
    player.completedTechnologyIds = [...TECHNOLOGY_ORDER];

    expect(getEffectiveGatherRatePermille(state, player.id, "villager", "food")).toBe(1_184);
    expect(getEffectiveGatherRatePermille(state, opponent.id, "villager", "food")).toBe(1_000);
    expect(getEffectiveUnitAttackDamage(state, player.id, "musketeer")).toBe(52);
    expect(getEffectiveUnitAttackDamage(state, opponent.id, "musketeer")).toBe(46);
    expect(getEffectiveUnitMaxHitPoints(state, player.id, "warrior")).toBe(168);
    expect(getEffectiveUnitMaxHitPoints(state, opponent.id, "warrior")).toBe(150);
    expect(getEffectiveUnitSpeedMilliTilesPerSecond(state, player.id, "boarRider")).toBe(2_012);
    expect(getEffectiveUnitSpeedMilliTilesPerSecond(state, opponent.id, "boarRider")).toBe(1_802);
    expect(getEffectiveBuildingMaxHitPoints(state, player.id, "townCenter")).toBe(1_399);
    expect(getEffectiveBuildingMaxHitPoints(state, opponent.id, "townCenter")).toBe(1_200);

    const replayInitial = createInitialState({ seed: 65, matchId: "research-replay" });
    replayInitial.players[0]!.settlementTier = "stronghold";
    replayInitial.players[0]!.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    const farm = addCompletedBuilding(replayInitial, replayInitial.players[0]!.id, "farmstead", "replay-research-farm", { x: 18, y: 18 });
    const commands = [envelope(replayInitial, 0, { type: "research", producerId: farm.id, technologyId: "hearthlandAlmanac" })];
    const first = stepSimulation(replayInitial, commands, TECHNOLOGIES.hearthlandAlmanac.researchTicks).state;
    const second = stepSimulation(replayInitial, commands, TECHNOLOGIES.hearthlandAlmanac.researchTicks).state;
    expect(hashMatchState(first)).toBe(hashMatchState(second));
    expect(hashReplay(replayInitial, commands, TECHNOLOGIES.hearthlandAlmanac.researchTicks)).toBe(hashReplay(replayInitial, commands, TECHNOLOGIES.hearthlandAlmanac.researchTicks));
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
    unit.typeId = "heavyCrossbowman";
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
    townCenter.productionQueue = Array.from({ length: 4 }, (_, index) => ({
      jobId: { commandSequence: 0, itemIndex: index },
      kind: "train" as const,
      unitType: "villager" as const,
      remainingTicks: 120,
      totalTicks: 120,
      paidCost: { ...UNITS.villager.cost },
    }));
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
    for (const layoutId of VILLAGE_ASSAULT_LAYOUT_IDS) {
      const state = createInitialState({
        seed: 231,
        matchId: `village-assault-spawns-${layoutId}`,
        map: { id: "villageAssault", width: 18, height: 16, layoutId },
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

      expect(new Set(keys).size, `${layoutId} static entities must not overlap`).toBe(keys.length);
      expect(staticCells.every((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < 18 && cell.y < 16)).toBe(true);
      for (const entity of state.entities) {
        if (entity.kind === "building" || entity.kind === "resource") {
          expect(getEntityFootprintCells(entity).every((cell) => isVillageAssaultBuildableCell(cell, layoutId)), `${layoutId}.${entity.id} must use buildable terrain`).toBe(true);
        } else if (entity.kind === "unit" || entity.kind === "monster") {
          expect(isVillageAssaultWalkableCell(entity.position, layoutId), `${layoutId}.${entity.id} must use walkable terrain`).toBe(true);
        }
      }
    }
  });

  it("keeps overlapping legacy spawn overrides clear of previously placed civilians", () => {
    for (const layoutId of VILLAGE_ASSAULT_LAYOUT_IDS) {
      const players = [
        { id: "p1", teamId: "t1", villageId: "pinehold" as const },
        { id: "p2", teamId: "t2", villageId: "riverstead" as const },
        { id: "p3", teamId: "t3", villageId: "highcrag" as const },
        { id: "p4", teamId: "t4", villageId: "marshwatch" as const },
        { id: "p5", teamId: "t5", villageId: "sunfield" as const },
      ];
      const state = createInitialState({
        seed: 2311,
        matchId: `overlapping-overrides-${layoutId}`,
        map: { id: "villageAssault", width: 18, height: 16, layoutId },
        players,
        spawnOverrides: Object.fromEntries(players.map((player) => [player.id, { x: 3, y: 8 }])),
      });
      const occupiedCells = state.entities.flatMap((entity) => getEntityFootprintCells(entity).map((cell) => `${cell.x},${cell.y}`));
      expect(new Set(occupiedCells).size, `${layoutId} custom overrides must not overlap any entity`).toBe(occupiedCells.length);
    }
  });

  it("bootstraps a deterministic fortified assault with working civilians and three neutral monsters", () => {
    const initial = createInitialState({
      seed: 232,
      matchId: "fortified-assault-bootstrap",
      map: { id: "villageAssault", width: 18, height: 16, layoutId: "riverstead" },
    });
    const replay = createInitialState({
      seed: 232,
      matchId: "fortified-assault-bootstrap",
      map: { id: "villageAssault", width: 18, height: 16, layoutId: "riverstead" },
    });
    expect(hashMatchState(initial)).toBe(hashMatchState(replay));

    for (const [index, player] of initial.players.entries()) {
      const buildings = initial.entities.filter((entity) => entity.kind === "building" && entity.ownerId === player.id);
      expect(buildings.filter((building) => building.typeId === "townCenter")).toHaveLength(1);
      expect(buildings.filter((building) => building.typeId === "surveyGate")).toHaveLength(1);
      expect(buildings.filter((building) => building.typeId === "defenseTower")).toHaveLength(2);
      expect(buildings.filter((building) => building.typeId === "resinPalisade").length).toBeGreaterThanOrEqual(8);
      expect(buildings.some((building) => building.typeId === "barracks")).toBe(true);
      expect(buildings.find((building) => building.typeId === "surveyGate")?.gateOpen).toBe(index === 0);
      const civilians = initial.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager");
      expect(civilians).toHaveLength(3);
      expect(civilians.every((civilian) => civilian.order.type === "gather")).toBe(true);
    }

    const monsters = initial.entities.filter((entity) => entity.kind === "monster");
    expect(monsters.map((monster) => monster.typeId).sort()).toEqual(["ashwing", "miremaw", "rootback"]);
    expect(monsters.every((monster) => monster.ownerId === null && monster.provokedByTeamId === null)).toBe(true);
    const beforeAmounts = initial.entities.filter((entity): entity is ResourceEntityState => entity.kind === "resource").map((resource) => resource.amount);
    const active = stepSimulation(initial, [], 120).state;
    const afterAmounts = active.entities.filter((entity): entity is ResourceEntityState => entity.kind === "resource").map((resource) => resource.amount);
    expect(afterAmounts.some((amount, index) => amount < beforeAmounts[index]!)).toBe(true);
  });

  it("keeps every authored civilian connected to a legal deposit route on all three layouts", () => {
    for (const layoutId of ["pinehold", "riverstead", "highcrag"] as const) {
      let state = createInitialState({
        seed: 235,
        matchId: `civilian-routes-${layoutId}`,
        map: { id: "villageAssault", width: 18, height: 16, layoutId },
      });
      const civilianIds = state.entities
        .filter((entity) => entity.kind === "unit" && entity.typeId === "villager")
        .map((entity) => entity.id)
        .sort();
      const deposited = new Set<string>();
      for (let tick = 0; tick < 1_200 && deposited.size < civilianIds.length; tick += 1) {
        const stepped = stepSimulation(state, [], 1);
        state = stepped.state;
        for (const event of stepped.events) if (event.type === "resourcesDeposited") deposited.add(event.unitId);
      }
      expect([...deposited].sort(), `${layoutId} must not trap an authored worker`).toEqual(civilianIds);
    }
  });

  it("allows an explicit neutral-monster attack, delays retaliation, and grants contribution-based rewards once", () => {
    let state = createInitialState({
      seed: 233,
      matchId: "neutral-monster-combat",
      map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
    });
    const player = state.players[0]!;
    const villager = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "villager")!;
    const monster = state.entities.find((entity) => entity.kind === "monster" && entity.typeId === "miremaw")!;
    monster.position = { ...villager.position };
    monster.home = { ...villager.position };
    monster.hitPoints = 1;
    monster.maxHitPoints = 1;
    const wallet = { ...player.resources };

    const ordered = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [villager.id], targetId: monster.id }));
    expect(ordered.validation).toEqual({ ok: true });
    const resolved = stepSimulation(ordered.state, [], 8);
    state = resolved.state;
    expect(state.entities.some((entity) => entity.id === monster.id)).toBe(false);
    expect(resolved.events.filter((event) => event.type === "monsterProvoked" && event.monsterId === monster.id)).toHaveLength(1);
    expect(resolved.events.filter((event) => event.type === "monsterDefeated" && event.monsterId === monster.id)).toHaveLength(1);
    expect(resolved.events.filter((event) => event.type === "monsterRewardGranted" && event.monsterId === monster.id)).toHaveLength(1);
    expect(player.resources).toEqual(wallet);
    expect(state.players[0]!.resources).toEqual({
      food: wallet.food + 120,
      wood: wallet.wood + 60,
      stone: wallet.stone,
    });
    const rewardEvent = resolved.events.find((event): event is Extract<DomainEvent, { type: "monsterRewardGranted" }> => event.type === "monsterRewardGranted");
    expect(rewardEvent?.boon?.id).toBe("scoutingRations");
    expect(rewardEvent?.boon?.expiresAtTick).toBeGreaterThan(state.tick);
    expect(state.players[0]!.activeMonsterBoons).toEqual(rewardEvent?.boon ? [rewardEvent.boon] : []);
    expect(getEffectiveGatherRatePermille(state, player.id, "villager", "wood")).toBe(Math.floor(1_030 * 1_150 / 1_000));

    const expired = stepSimulation(state, [], (rewardEvent?.boon?.expiresAtTick ?? state.tick) - state.tick).state;
    expect(expired.players[0]!.activeMonsterBoons).toEqual([]);
    expect(getEffectiveGatherRatePermille(expired, player.id, "villager", "wood")).toBe(1_030);
  });

  it("executes every neutral monster ability and its authored target passive authoritatively", () => {
    const run = (typeId: MonsterEntityState["typeId"]): { state: MatchState; monster: MonsterEntityState; events: DomainEvent[]; primary: UnitEntityState | BuildingEntityState } => {
      const state = createInitialState({
        seed: 234,
        matchId: `monster-ability-${typeId}`,
        map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
      });
      const player = state.players[0]!;
      const monster = state.entities.find((entity): entity is MonsterEntityState => entity.kind === "monster" && entity.typeId === typeId)!;
      const units = state.entities.filter((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === player.id);
      const primary = typeId === "rootback"
        ? state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!
        : configureCombatUnit(state, player.id, 0, typeId === "ashwing" ? "archer" : "warrior", { x: 5, y: 7 });
      primary.position = { x: 5, y: 7 };
      if (typeId === "ashwing") configureCombatUnit(state, player.id, 1, "warrior", { x: 6, y: 7 });
      for (const unit of units.slice(typeId === "ashwing" ? 2 : 1)) unit.position = { x: 1, y: 14 };
      monster.position = { x: 7, y: 7 };
      monster.home = { x: 7, y: 7 };
      monster.provokedByTeamId = player.teamId;
      monster.provokedAtTick = state.tick - 1;
      monster.abilityReadyTick = 0;
      if (typeId === "rootback") monster.hitPoints = Math.floor(monster.maxHitPoints * 0.4);
      const beforeHitPoints = primary.hitPoints;
      const result = stepSimulation(state, [], 12);
      const resolvedMonster = result.state.entities.find((entity): entity is MonsterEntityState => entity.kind === "monster" && entity.id === monster.id)!;
      expect(result.events.some((event) => event.type === "combatPhaseChanged" && event.entityId === monster.id && event.action === "ability" && event.phase === "windup")).toBe(true);
      expect(result.events.some((event) => event.type === "combatPhaseChanged" && event.entityId === monster.id && event.action === "ability" && event.phase === "commit")).toBe(true);
      expect(result.events.some((event) => event.type === "statusApplied" && event.sourceId === monster.id && event.targetId === primary.id)).toBe(true);
      const resolvedPrimary = result.state.entities.find((entity) => entity.id === primary.id)!;
      expect(resolvedPrimary.hitPoints).toBeLessThan(beforeHitPoints);
      return { state: result.state, monster: resolvedMonster, events: result.events, primary: resolvedPrimary as UnitEntityState | BuildingEntityState };
    };

    const miremaw = run("miremaw");
    expect(miremaw.primary.statuses.some((status) => status.id === "slow")).toBe(true);
    const ashwing = run("ashwing");
    expect(ashwing.monster.targetId).toBe(ashwing.primary.id);
    expect(ashwing.primary.statuses.some((status) => status.id === "stagger")).toBe(true);
    const rootback = run("rootback");
    expect(rootback.monster.targetId).toBe(rootback.primary.id);

    const rootbackStrike = (enraged: boolean): { damage: number; cooldown: number } => {
      const state = createInitialState({
        seed: 235,
        matchId: `rootback-strike-${enraged}`,
        map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
      });
      const player = state.players[0]!;
      const monster = state.entities.find((entity): entity is MonsterEntityState => entity.kind === "monster" && entity.typeId === "rootback")!;
      const target = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter")!;
      target.position = { x: 5, y: 7 };
      monster.position = { x: 7, y: 7 };
      monster.home = { ...monster.position };
      monster.provokedByTeamId = player.teamId;
      monster.provokedAtTick = state.tick - 1;
      monster.abilityReadyTick = Number.MAX_SAFE_INTEGER;
      if (enraged) monster.hitPoints = Math.floor(monster.maxHitPoints * 0.4);
      const result = stepSimulation(state, [], 1);
      const damage = result.events.find((event): event is Extract<DomainEvent, { type: "entityDamaged" }> => event.type === "entityDamaged" && event.sourceId === monster.id)?.amount ?? 0;
      const resolved = result.state.entities.find((entity): entity is MonsterEntityState => entity.kind === "monster" && entity.id === monster.id)!;
      return { damage, cooldown: resolved.attackCooldownTicks };
    };
    const ordinaryStrike = rootbackStrike(false);
    const enragedStrike = rootbackStrike(true);
    expect(enragedStrike.damage).toBeGreaterThan(ordinaryStrike.damage);
    expect(enragedStrike.cooldown).toBeLessThan(ordinaryStrike.cooldown);
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
    expect(house).toMatchObject({ complete: true, hitPoints: 381, constructionRemainingTicks: 0 });
    expect(state.players.find((candidate) => candidate.id === player.id)?.population.capacity).toBe(18);

    state = applyCommand(state, envelope(state, 2, { type: "build", builderIds: [villager.id], buildingType: "barracks", origin: { x: 11, y: 9 } })).state;
    state = stepSimulation(state, [], 340).state;
    const barracks = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "barracks");
    expect(barracks?.kind).toBe("building");
    expect(barracks).toMatchObject({ complete: true, constructionRemainingTicks: 0 });
    if (!barracks || barracks.kind !== "building") throw new Error("barracks was not constructed");

    const warriorsBefore = state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "warrior").length;
    const trained = applyCommand(state, envelope(state, 3, { type: "train", producerId: barracks.id, unitType: "warrior", count: 1 }));
    expect(trained.validation).toEqual({ ok: true });
    state = stepSimulation(trained.state, [], UNITS.warrior.trainTicks).state;
    expect(state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === player.id && entity.typeId === "warrior")).toHaveLength(warriorsBefore + 1);
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
    expect(depletionEvents).toContainEqual(expect.objectContaining({
      type: "entityRemoved", entityId: wood.id, entity: expect.objectContaining({ id: wood.id }), reason: "depleted",
    }));

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

  it("applies two authoritative gameplay parameters for every playable village", () => {
    const pineAndRiver = createInitialState({ seed: 33, matchId: "dual-village-traits" });
    const pine = pineAndRiver.players[0]!;
    const river = pineAndRiver.players[1]!;
    expect(getEffectiveGatherRatePermille(pineAndRiver, pine.id, "villager", "wood")).toBe(1_030);
    expect(getEffectiveBuildingMaxHitPoints(pineAndRiver, pine.id, "townCenter")).toBe(1_272);
    expect(getEffectiveUnitSpeedMilliTilesPerSecond(pineAndRiver, river.id, "boarRider")).toBe(1_802);
    expect(getEffectiveCarryCapacity(pineAndRiver, river.id, "villager")).toBe(13);

    const highcrag = createInitialState({
      seed: 34,
      matchId: "highcrag-dual-traits",
      players: [
        { id: "player-1", teamId: "team-1", villageId: "highcrag" },
        { id: "player-2", teamId: "team-2", villageId: "pinehold" },
      ],
    });
    expect(getEffectiveBuildingMaxHitPoints(highcrag, "player-1", "townCenter")).toBe(1_320);
    expect(getEffectiveBuildingMaxHitPoints(highcrag, "player-1", "defenseTower")).toBe(Math.floor(BUILDINGS.defenseTower.maxHitPoints * 1.1));
  });

  it("strictly parses tactical, formation, repair, and ability commands", () => {
    expect(isGameCommand({ type: "attackMove", entityIds: ["unit-1"], target: { x: 4, y: 5 } })).toBe(true);
    expect(isGameCommand({ type: "repair", entityIds: ["unit-1"], targetId: "building-1" })).toBe(true);
    expect(isGameCommand({ type: "setStance", entityIds: ["unit-1"], stance: "holdGround" })).toBe(true);
    expect(isGameCommand({ type: "setFormation", entityIds: ["unit-1"], formation: "wedge" })).toBe(true);
    expect(isGameCommand({ type: "castAbility", casterId: "unit-1", abilityId: "armorSunder", target: { kind: "entity", entityId: "unit-2" } })).toBe(true);
    expect(isGameCommand({ type: "castAbility", casterId: "unit-1", abilityId: "tuskCharge", target: { kind: "direction", vector: { x: 0, y: 0 } } })).toBe(false);
    expect(isGameCommand({ type: "attackMove", entityIds: ["unit-1"], target: { x: 4, y: 5 }, extra: true })).toBe(false);
    expect(isGameCommand({ type: "setStance", entityIds: ["unit-1"], stance: "berserk" })).toBe(false);
  });

  it("uses the seven illustrated combat roles as the single canonical RTS roster", () => {
    expect(Object.keys(UNITS)).toEqual(["villager", ...COMBAT_UNIT_IDS]);
    for (const id of COMBAT_UNIT_IDS) {
      expect(UNITS[id]).toMatchObject({
        id,
        cost: COMBAT_UNITS[id].cost,
        maxHitPoints: COMBAT_UNITS[id].maxHitPoints,
        attackDamage: COMBAT_UNITS[id].baseDamage,
        attackRange: COMBAT_UNITS[id].attackRange,
        population: COMBAT_UNITS[id].population,
      });
    }
  });

  it("rejects allied attacks and excludes allied forces from tower and AI enemy targeting", () => {
    let state = createInitialState({
      seed: 320,
      matchId: "team-safety",
      players: [
        { id: "player-1", teamId: "alliance", villageId: "pinehold" },
        { id: "player-2", teamId: "enemy", villageId: "riverstead" },
        { id: "player-3", teamId: "alliance", villageId: "highcrag" },
      ],
    });
    const attacker = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const enemy = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 5 });
    const ally = configureCombatUnit(state, "player-3", 0, "warrior", { x: 5, y: 6 });
    expect(validateCommand(state, envelope(state, 0, { type: "attack", entityIds: [attacker.id], targetId: ally.id }))).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
    expect(validateCommand(state, envelope(state, 0, { type: "attack", entityIds: [attacker.id], targetId: enemy.id }))).toEqual({ ok: true });

    const tower = addCompletedBuilding(state, "player-1", "defenseTower", "team-tower", { x: 9, y: 9 });
    ally.position = { x: 10, y: 9 };
    enemy.position = { x: 25, y: 25 };
    const allyHp = ally.hitPoints;
    state = stepSimulation(state, [], BUILDINGS.defenseTower.attackCooldownTicks + 5).state;
    expect(state.entities.find((entity) => entity.id === ally.id)?.hitPoints).toBe(allyHp);
    expect(getAiObservation(state, "player-1").visibleEnemyEntities.some((entity) => entity.id === ally.id)).toBe(false);
    expect(tower.hitPoints).toBeGreaterThan(0);
  });

  it("applies canonical armor and counter damage through the formal simulation", () => {
    let state = createInitialState({ seed: 321, matchId: "counter-integration" });
    const attacker = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const defender = configureCombatUnit(state, "player-2", 0, "shieldBearer", { x: 6, y: 5 });
    const expected = calculateDamage({
      baseDamage: COMBAT_UNITS.warrior.baseDamage,
      armor: COMBAT_UNITS.shieldBearer.armor,
      counterMultiplier: COUNTER_MATRIX.warrior.shieldBearer,
    });
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [attacker.id], targetId: defender.id })).state;
    const result = stepSimulation(state, [], UNITS.warrior.attackCooldownTicks);
    expect(result.events).toContainEqual({ type: "entityDamaged", sourceId: attacker.id, targetId: defender.id, amount: expected, hitPoints: COMBAT_UNITS.shieldBearer.maxHitPoints - expected });
  });

  it("delays ranged damage until its deterministic projectile impact tick", () => {
    let state = createInitialState({ seed: 322, matchId: "projectile-impact" });
    const archer = configureCombatUnit(state, "player-1", 0, "archer", { x: 5, y: 5 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 8, y: 5 });
    state.entities = [archer, target];
    const initialHp = target.hitPoints;
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [archer.id], targetId: target.id })).state;
    const launched = stepSimulation(state, [], 4);
    expect(launched.events.some((event) => event.type === "projectileSpawned" && event.projectile.profileId === "arrow")).toBe(true);
    expect(launched.state.entities.find((entity) => entity.id === target.id)?.hitPoints).toBe(initialHp);
    const impacted = stepSimulation(launched.state, [], 3);
    expect(impacted.events.some((event) => event.type === "projectileImpacted" && event.targetIds.includes(target.id))).toBe(true);
    expect(impacted.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBeLessThan(initialHp);
  });

  it("preserves projectile and burn ownership after the source unit has been removed", () => {
    let state = createInitialState({
      seed: 3221,
      matchId: "delayed-monster-attribution",
      map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
    });
    const player = state.players[0]!;
    const source = configureCombatUnit(state, player.id, 0, "mage", { x: 5, y: 5 });
    const monster = state.entities.find((entity): entity is MonsterEntityState => entity.kind === "monster" && entity.typeId === "miremaw")!;
    monster.position = { x: 6, y: 5 };
    monster.home = { ...monster.position };
    const projectile: ProjectileState = {
      id: "orphaned-burn-projectile",
      ownerId: player.id,
      sourceId: source.id,
      profileId: "arcaneCinder",
      origin: { ...source.position },
      position: { ...source.position },
      targetId: monster.id,
      targetPoint: { ...monster.position },
      fixedImpact: false,
      launchTick: state.tick,
      impactTick: state.tick + 1,
      damage: 1,
      statusEffects: ["burn"],
      resolution: null,
    };
    state.projectiles.push(projectile);
    state = stepSimulation(state, [], 1).state;
    const burningMonster = state.entities.find((entity): entity is MonsterEntityState => entity.kind === "monster" && entity.id === monster.id)!;
    expect(burningMonster.statuses.find((status) => status.id === "burn")?.sourceOwnerId).toBe(player.id);
    burningMonster.contributions = [];
    burningMonster.hitPoints = 1;
    state.entities = state.entities.filter((entity) => entity.id !== source.id);

    const burnedOut = stepSimulation(state, [], 10);
    expect(burnedOut.events.some((event) => event.type === "monsterRewardGranted" && event.playerId === player.id)).toBe(true);
  });

  it("keeps ordinary arrows ballistic so a unit can leave the committed cell", () => {
    let state = createInitialState({ seed: 323, matchId: "ballistic-projectile-miss" });
    const archer = configureCombatUnit(state, "player-1", 0, "archer", { x: 5, y: 5 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 8, y: 5 });
    state.entities = [archer, target];
    const initialHp = target.hitPoints;
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [archer.id], targetId: target.id })).state;
    const launched = stepSimulation(state, [], 4).state;
    launched.entities.find((entity) => entity.id === target.id)!.position = { x: 9, y: 5 };

    const impacted = stepSimulation(launched, [], 3);
    expect(impacted.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBe(initialHp);
    expect(impacted.events).toContainEqual({
      type: "projectileImpacted",
      projectileId: expect.any(String),
      position: { x: 8, y: 5 },
      targetIds: [],
    });
  });

  it("fizzles an entity-target ability when the target leaves range during windup", () => {
    let state = createInitialState({ seed: 323, matchId: "ability-range-recheck" });
    const caster = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 5 });
    state.entities = [caster, target];
    const initialHp = target.hitPoints;
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility",
      casterId: caster.id,
      abilityId: "armorSunder",
      target: { kind: "entity", entityId: target.id },
    })).state;
    state.entities.find((entity) => entity.id === target.id)!.position = { x: 7, y: 5 };
    const result = stepSimulation(state, [], 5);
    expect(result.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBe(initialHp);
    expect(result.events.some((event) => event.type === "entityDamaged" && event.targetId === target.id)).toBe(false);
  });

  it("rejects unit-target abilities against buildings without mutating state", () => {
    const state = createInitialState({ seed: 325, matchId: "ability-unit-filter" });
    const caster = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const building = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2")!;
    building.position = { x: 6, y: 5 };
    const before = hashMatchState(state);
    const result = applyCommand(state, envelope(state, 0, {
      type: "castAbility",
      casterId: caster.id,
      abilityId: "armorSunder",
      target: { kind: "entity", entityId: building.id },
    }));
    expect(result.validation).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
    expect(hashMatchState(result.state)).toBe(before);
  });

  it("interrupts an active windup when stagger is applied", () => {
    let state = createInitialState({ seed: 326, matchId: "stagger-interrupt" });
    const caster = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 5 });
    state.entities = [caster, target];
    const initialHp = target.hitPoints;
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility",
      casterId: caster.id,
      abilityId: "armorSunder",
      target: { kind: "entity", entityId: target.id },
    })).state;
    const activeCaster = state.entities.find((entity): entity is UnitEntityState => entity.id === caster.id && entity.kind === "unit")!;
    activeCaster.statuses.push({ id: "stagger", sourceId: target.id, expiresAtTick: state.tick + 8, nextTickAt: null });
    const result = stepSimulation(state, [], 5);
    expect(result.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBe(initialHp);
    expect(result.events).toContainEqual({ type: "combatPhaseChanged", entityId: caster.id, phase: "ready", action: null });
  });

  it("blocks terrain-sensitive heavy bolts at the village ridge", () => {
    let state = createInitialState({
      seed: 324,
      matchId: "projectile-terrain-block",
      map: { id: "villageAssault", width: 18, height: 16 },
      spawnOverrides: { "player-1": { x: 3, y: 8 }, "player-2": { x: 14, y: 8 } },
    });
    const crossbow = configureCombatUnit(state, "player-1", 0, "heavyCrossbowman", { x: 10, y: 2 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 2 });
    state.entities = [crossbow, target];
    const initialHp = target.hitPoints;
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [crossbow.id], targetId: target.id })).state;
    const result = stepSimulation(state, [], 12);
    const projectile = result.events.find((event) => event.type === "projectileSpawned");
    expect(projectile?.type === "projectileSpawned" ? projectile.projectile.targetId : "missing").toBeNull();
    expect(result.events.some((event) => event.type === "projectileImpacted" && event.targetIds.length === 0)).toBe(true);
    expect(result.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBe(initialHp);
  });

  it("keeps ground-area projectiles fixed instead of homing after launch", () => {
    let state = createInitialState({ seed: 327, matchId: "fixed-ground-projectile" });
    const caster = configureCombatUnit(state, "player-1", 0, "archer", { x: 5, y: 5 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 8, y: 5 });
    const entrant = configureCombatUnit(state, "player-2", 1, "warrior", { x: 14, y: 12 });
    state.entities = [caster, target, entrant];
    const initialHp = target.hitPoints;
    const entrantHp = entrant.hitPoints;
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "pinningVolley", target: { kind: "ground", point: { x: 8, y: 5 } },
    })).state;
    const launched = stepSimulation(state, [], 6);
    const launchedTarget = launched.state.entities.find((entity) => entity.id === target.id)!;
    launchedTarget.position = { x: 14, y: 12 };
    launched.state.entities.find((entity) => entity.id === entrant.id)!.position = { x: 8, y: 5 };
    const impacted = stepSimulation(launched.state, [], 4);
    expect(impacted.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBe(initialHp);
    expect(impacted.state.entities.find((entity) => entity.id === entrant.id)!.hitPoints).toBeLessThan(entrantHp);
    expect(impacted.events.some((event) => event.type === "projectileImpacted" && event.targetIds.includes(entrant.id))).toBe(true);
  });

  it("resolves a three-arrow volley at impact with a two-hit cap per target", () => {
    let state = createInitialState({ seed: 341, matchId: "volley-impact-allocation" });
    const caster = configureCombatUnit(state, "player-1", 0, "archer", { x: 5, y: 5 });
    const first = configureCombatUnit(state, "player-2", 0, "warrior", { x: 14, y: 12 });
    const second = configureCombatUnit(state, "player-2", 1, "warrior", { x: 14, y: 13 });
    state.entities = [caster, first, second];
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "pinningVolley", target: { kind: "ground", point: { x: 8, y: 5 } },
    })).state;
    const launched = stepSimulation(state, [], 6);
    expect(launched.events.filter((event) => event.type === "projectileSpawned" && event.projectile.profileId === "pinningVolley")).toHaveLength(3);
    launched.state.entities.find((entity) => entity.id === first.id)!.position = { x: 8, y: 5 };
    launched.state.entities.find((entity) => entity.id === second.id)!.position = { x: 9, y: 5 };
    const impacted = stepSimulation(launched.state, [], 4);
    const hits = impacted.events.filter((event): event is Extract<DomainEvent, { type: "entityDamaged" }> => event.type === "entityDamaged");
    expect(hits).toHaveLength(3);
    expect(hits.filter((event) => event.targetId === first.id)).toHaveLength(2);
    expect(hits.filter((event) => event.targetId === second.id)).toHaveLength(1);
    const arrowDamage = calculateDamage({
      baseDamage: COMBAT_UNITS.archer.baseDamage,
      armor: COMBAT_UNITS.warrior.armor,
      counterMultiplier: COUNTER_MATRIX.archer.warrior,
      skillMultiplier: 0.55,
    });
    expect(hits.every((event) => event.amount === arrowDamage)).toBe(true);
    expect(impacted.events.filter((event) => event.type === "statusApplied" && event.statusId === "slow")).toHaveLength(2);
  });

  it("lets enemies enter an empty ember sigil before authoritative impact", () => {
    let state = createInitialState({ seed: 342, matchId: "ember-impact-entry" });
    const caster = configureCombatUnit(state, "player-1", 0, "mage", { x: 5, y: 5 });
    const entrant = configureCombatUnit(state, "player-2", 0, "warrior", { x: 14, y: 12 });
    state.entities = [caster, entrant];
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "emberSigil", target: { kind: "ground", point: { x: 8, y: 5 } },
    })).state;
    const launched = stepSimulation(state, [], 8);
    const beforeHp = launched.state.entities.find((entity) => entity.id === entrant.id)!.hitPoints;
    launched.state.entities.find((entity) => entity.id === entrant.id)!.position = { x: 8, y: 5 };
    const impacted = stepSimulation(launched.state, [], 5);
    expect(impacted.state.entities.find((entity) => entity.id === entrant.id)!.hitPoints).toBeLessThan(beforeHp);
    const emberDamage = calculateDamage({
      baseDamage: COMBAT_UNITS.mage.baseDamage,
      armor: COMBAT_UNITS.warrior.armor,
      counterMultiplier: COUNTER_MATRIX.mage.warrior,
      skillMultiplier: 32 / 30,
      armorIgnore: 0.35,
    });
    expect(impacted.events.some((event) => event.type === "entityDamaged" && event.targetId === entrant.id && event.amount === emberDamage)).toBe(true);
    expect(impacted.events.some((event) => event.type === "statusApplied" && event.targetId === entrant.id && event.statusId === "burn")).toBe(true);
  });

  it("resolves a line bolt against impact-time entrants and stops at a building", () => {
    let state = createInitialState({ seed: 343, matchId: "line-impact-collision" });
    const caster = configureCombatUnit(state, "player-1", 0, "heavyCrossbowman", { x: 5, y: 5 });
    caster.statuses.push({ id: "emplaced", sourceId: caster.id, expiresAtTick: Number.MAX_SAFE_INTEGER, nextTickAt: null });
    const front = configureCombatUnit(state, "player-2", 0, "warrior", { x: 14, y: 12 });
    const behind = configureCombatUnit(state, "player-2", 1, "warrior", { x: 14, y: 13 });
    const building = addCompletedBuilding(state, "player-2", "house", "line-blocking-house", { x: 14, y: 14 });
    state.entities = [caster, front, behind, building];
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "breachingBolt", target: { kind: "direction", vector: { x: 9, y: 0 } },
    })).state;
    const launched = stepSimulation(state, [], 12);
    const frontBefore = launched.state.entities.find((entity) => entity.id === front.id)!.hitPoints;
    const behindBefore = launched.state.entities.find((entity) => entity.id === behind.id)!.hitPoints;
    const buildingBefore = launched.state.entities.find((entity) => entity.id === building.id)!.hitPoints;
    launched.state.entities.find((entity) => entity.id === front.id)!.position = { x: 8, y: 5 };
    launched.state.entities.find((entity) => entity.id === building.id)!.position = { x: 10, y: 5 };
    launched.state.entities.find((entity) => entity.id === behind.id)!.position = { x: 12, y: 5 };
    const impacted = stepSimulation(launched.state, [], 8);
    expect(impacted.state.entities.find((entity) => entity.id === front.id)!.hitPoints).toBeLessThan(frontBefore);
    expect(impacted.state.entities.find((entity) => entity.id === building.id)!.hitPoints).toBeLessThan(buildingBefore);
    expect(impacted.state.entities.find((entity) => entity.id === behind.id)!.hitPoints).toBe(behindBefore);
    const impact = impacted.events.find((event) => event.type === "projectileImpacted");
    expect(impact?.type === "projectileImpacted" ? impact.targetIds : []).toEqual([front.id, building.id]);
    expect(impact?.type === "projectileImpacted" ? impact.position : null).toEqual({ x: 10, y: 5 });
    expect(frontBefore - impacted.state.entities.find((entity) => entity.id === front.id)!.hitPoints).toBe(calculateDamage({
      baseDamage: COMBAT_UNITS.heavyCrossbowman.baseDamage,
      armor: COMBAT_UNITS.warrior.armor,
      counterMultiplier: COUNTER_MATRIX.heavyCrossbowman.warrior,
      skillMultiplier: 1.6,
    }));
    expect(buildingBefore - impacted.state.entities.find((entity) => entity.id === building.id)!.hitPoints).toBe(calculateDamage({
      baseDamage: COMBAT_UNITS.heavyCrossbowman.baseDamage,
      armor: 6,
      skillMultiplier: 1.6 * 0.75,
      structureMultiplier: 1.45 * 1.2,
    }));
  });

  it("does not hit a unit that enters a line bolt after the projectile has passed", () => {
    let state = createInitialState({ seed: 353, matchId: "line-passed-entry" });
    const caster = configureCombatUnit(state, "player-1", 0, "heavyCrossbowman", { x: 5, y: 5 });
    const early = configureCombatUnit(state, "player-2", 0, "warrior", { x: 8, y: 5 });
    const late = configureCombatUnit(state, "player-2", 1, "warrior", { x: 14, y: 12 });
    state.entities = [caster, early, late];
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "breachingBolt", target: { kind: "direction", vector: { x: 9, y: 0 } },
    })).state;
    state = stepSimulation(state, [], 15).state;
    const inFlight = state.projectiles.find((projectile) => projectile.profileId === "breachingBolt")!;
    expect(inFlight.position.x).toBeGreaterThan(5);
    expect(toPublicProjectile(inFlight).position).toEqual(inFlight.position);
    const lateHp = state.entities.find((entity) => entity.id === late.id)!.hitPoints;
    state.entities.find((entity) => entity.id === late.id)!.position = { x: 7, y: 5 };
    const finished = stepSimulation(state, [], 6);
    expect(finished.state.entities.find((entity) => entity.id === late.id)!.hitPoints).toBe(lateHp);
    const impact = finished.events.find((event) => event.type === "projectileImpacted");
    expect(impact?.type === "projectileImpacted" ? impact.targetIds : []).toEqual([early.id]);
  });

  it("stops breaching bolts at village terrain before targets beyond the ridge", () => {
    let state = createInitialState({
      seed: 354,
      matchId: "line-terrain-block",
      map: { id: "villageAssault", width: 18, height: 16 },
      spawnOverrides: { "player-1": { x: 3, y: 8 }, "player-2": { x: 14, y: 8 } },
    });
    const caster = configureCombatUnit(state, "player-1", 0, "heavyCrossbowman", { x: 10, y: 2 });
    const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 2 });
    state.entities = [caster, target];
    const initialHp = target.hitPoints;
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "breachingBolt", target: { kind: "direction", vector: { x: -9, y: 0 } },
    })).state;
    const result = stepSimulation(state, [], 25);
    expect(result.state.entities.find((entity) => entity.id === target.id)!.hitPoints).toBe(initialHp);
    expect(result.events.some((event) => event.type === "projectileImpacted" && event.targetIds.length === 0)).toBe(true);
  });

  it("uses partial cooldown for cancelled windup and preserves committed recovery", () => {
    let cancelled = createInitialState({ seed: 328, matchId: "ability-cancel-cooldown" });
    const cancelledCaster = configureCombatUnit(cancelled, "player-1", 0, "warrior", { x: 5, y: 5 });
    const cancelledTarget = configureCombatUnit(cancelled, "player-2", 0, "warrior", { x: 6, y: 5 });
    cancelled.entities = [cancelledCaster, cancelledTarget];
    cancelled = applyCommand(cancelled, envelope(cancelled, 0, {
      type: "castAbility", casterId: cancelledCaster.id, abilityId: "armorSunder", target: { kind: "entity", entityId: cancelledTarget.id },
    })).state;
    cancelled = applyCommand(cancelled, envelope(cancelled, 1, { type: "move", entityIds: [cancelledCaster.id], target: { x: 4, y: 5 } })).state;
    const afterCancel = cancelled.entities.find((entity): entity is UnitEntityState => entity.id === cancelledCaster.id && entity.kind === "unit")!;
    expect(afterCancel.combat.phase).toBe("ready");
    expect(afterCancel.abilityReadyTick).toBe(36);

    let committed = createInitialState({ seed: 329, matchId: "ability-recovery-lock" });
    const committedCaster = configureCombatUnit(committed, "player-1", 0, "warrior", { x: 5, y: 5 });
    const committedTarget = configureCombatUnit(committed, "player-2", 0, "warrior", { x: 6, y: 5 });
    committed.entities = [committedCaster, committedTarget];
    committed = applyCommand(committed, envelope(committed, 0, {
      type: "castAbility", casterId: committedCaster.id, abilityId: "armorSunder", target: { kind: "entity", entityId: committedTarget.id },
    })).state;
    committed = stepSimulation(committed, [], 4).state;
    committed = applyCommand(committed, envelope(committed, 1, { type: "move", entityIds: [committedCaster.id], target: { x: 4, y: 5 } })).state;
    const queuedMove = committed.entities.find((entity): entity is UnitEntityState => entity.id === committedCaster.id && entity.kind === "unit")!;
    expect(queuedMove.combat.phase).toBe("recovery");
    const beforeRecovery = { ...queuedMove.position };
    committed = stepSimulation(committed, [], 5).state;
    const duringRecovery = committed.entities.find((entity): entity is UnitEntityState => entity.id === committedCaster.id && entity.kind === "unit")!;
    expect(duringRecovery.position).toEqual(beforeRecovery);
    expect(duringRecovery.combat.phase).toBe("recovery");
  });

  it("rotates line formation perpendicular to an eastbound march", () => {
    let state = createInitialState({ seed: 330, matchId: "formation-heading" });
    const units = [0, 1, 2].map((index) => configureCombatUnit(state, "player-1", index, "warrior", { x: 2, y: 2 + index }));
    state.entities = [...units];
    state = applyCommand(state, envelope(state, 0, { type: "move", entityIds: units.map((unit) => unit.id), target: { x: 10, y: 3 } })).state;
    const destinations = state.entities
      .filter((entity): entity is UnitEntityState => entity.kind === "unit")
      .map((unit) => unit.order.type === "move" ? unit.order.target : { x: -1, y: -1 });
    expect(destinations.map((point) => point.x)).toEqual([10, 10, 10]);
    expect(destinations.map((point) => point.y).sort((left, right) => left - right)).toEqual([2, 3, 4]);
  });

  it("cancels a villager attack windup when gathering is ordered", () => {
    let state = createInitialState({ seed: 331, matchId: "gather-cancels-attack" });
    const villager = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const enemy = configureCombatUnit(state, "player-2", 0, "warrior", { x: villager.position.x + 1, y: villager.position.y });
    const resource = state.entities.find((entity): entity is ResourceEntityState => entity.kind === "resource" && entity.ownerId === null)!;
    resource.position = { x: villager.position.x, y: villager.position.y + 1 };
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    if (townCenter.kind === "building") townCenter.attackCooldownTicks = 1_000;
    state.entities = [townCenter, villager, enemy, resource];
    const initialHp = enemy.hitPoints;
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [villager.id], targetId: enemy.id })).state;
    state = stepSimulation(state, [], 1).state;
    state = applyCommand(state, envelope(state, 1, { type: "gather", entityIds: [villager.id], targetId: resource.id })).state;
    const result = stepSimulation(state, [], UNITS.villager.attackCooldownTicks);
    expect(result.state.entities.find((entity) => entity.id === enemy.id)!.hitPoints).toBe(initialHp);
    expect(result.events.some((event) => event.type === "entityDamaged" && event.targetId === enemy.id)).toBe(false);
  });

  it("applies aimed-shot armor penetration and moves a tusk charge along its line", () => {
    let aimed = createInitialState({ seed: 332, matchId: "aimed-shot-penetration" });
    const musketeer = configureCombatUnit(aimed, "player-1", 0, "musketeer", { x: 5, y: 5 });
    const shield = configureCombatUnit(aimed, "player-2", 0, "shieldBearer", { x: 6, y: 5 });
    aimed.entities = [musketeer, shield];
    aimed = applyCommand(aimed, envelope(aimed, 0, {
      type: "castAbility", casterId: musketeer.id, abilityId: "aimedShot", target: { kind: "entity", entityId: shield.id },
    })).state;
    const aimedResult = stepSimulation(aimed, [], 11);
    const expected = calculateDamage({
      baseDamage: COMBAT_UNITS.musketeer.baseDamage,
      armor: COMBAT_UNITS.shieldBearer.armor,
      counterMultiplier: COUNTER_MATRIX.musketeer.shieldBearer,
      skillMultiplier: 1.6,
      armorIgnore: 0.6,
    });
    expect(aimedResult.events).toContainEqual({
      type: "entityDamaged", sourceId: musketeer.id, targetId: shield.id, amount: expected, hitPoints: COMBAT_UNITS.shieldBearer.maxHitPoints - expected,
    });

    let charge = createInitialState({ seed: 333, matchId: "tusk-charge-movement" });
    const rider = configureCombatUnit(charge, "player-1", 0, "boarRider", { x: 5, y: 5 });
    const chargeTarget = configureCombatUnit(charge, "player-2", 0, "warrior", { x: 7, y: 5 });
    charge.entities = [rider, chargeTarget];
    charge = applyCommand(charge, envelope(charge, 0, {
      type: "castAbility", casterId: rider.id, abilityId: "tuskCharge", target: { kind: "direction", vector: { x: 6, y: 0 } },
    })).state;
    const chargeResult = stepSimulation(charge, [], 4);
    expect(chargeResult.state.entities.find((entity) => entity.id === rider.id)!.position).toEqual({ x: 11, y: 5 });
    expect(chargeResult.events.some((event) => event.type === "statusApplied" && event.targetId === chargeTarget.id && event.statusId === "stagger")).toBe(true);
  });

  it("reduces projectile damage only inside the active shield-wall front arc", () => {
    const damageFrom = (attackerX: number): number => {
      let state = createInitialState({ seed: 334 + attackerX, matchId: `shield-front-${attackerX}` });
      const archer = configureCombatUnit(state, "player-1", 0, "archer", { x: attackerX, y: 5 });
      const defender = configureCombatUnit(state, "player-2", 0, "shieldBearer", { x: 5, y: 5 });
      defender.facing = "e";
      defender.statuses.push({ id: "shieldWall", sourceId: defender.id, expiresAtTick: 100, nextTickAt: null });
      state.entities = [archer, defender];
      state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [archer.id], targetId: defender.id })).state;
      const result = stepSimulation(state, [], 8);
      return COMBAT_UNITS.shieldBearer.maxHitPoints - result.state.entities.find((entity) => entity.id === defender.id)!.hitPoints;
    };
    const frontDamage = damageFrom(8);
    const rearDamage = damageFrom(2);
    expect(frontDamage).toBe(Math.max(1, Math.round(rearDamage * 0.45)));
  });

  it("builds and expires warrior combat rhythm on authoritative hit timing", () => {
    let state = createInitialState({ seed: 344, matchId: "warrior-rhythm" });
    const warrior = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const target = configureCombatUnit(state, "player-2", 0, "shieldBearer", { x: 6, y: 5 });
    state.entities = [warrior, target];
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [warrior.id], targetId: target.id })).state;
    const result = stepSimulation(state, [], 40);
    const amounts = result.events
      .filter((event): event is Extract<DomainEvent, { type: "entityDamaged" }> => event.type === "entityDamaged" && event.sourceId === warrior.id)
      .map((event) => event.amount);
    expect(amounts.slice(0, 4)).toEqual([1, 1.05, 1.1, 1.15].map((skillMultiplier) => calculateDamage({
      baseDamage: COMBAT_UNITS.warrior.baseDamage,
      armor: COMBAT_UNITS.shieldBearer.armor,
      counterMultiplier: COUNTER_MATRIX.warrior.shieldBearer,
      skillMultiplier,
    })));
    const resolvedWarrior = result.state.entities.find((entity): entity is UnitEntityState => entity.id === warrior.id && entity.kind === "unit")!;
    resolvedWarrior.order = { type: "idle" };
    const expired = stepSimulation(result.state, [], 21).state.entities.find((entity): entity is UnitEntityState => entity.id === warrior.id && entity.kind === "unit")!;
    expect(expired.passive.rhythmStacks).toBe(0);
    expect(expired.passive.rhythmTargetId).toBeNull();
  });

  it("braces after eight ticks and reverses a frontal tusk charge", () => {
    let state = createInitialState({ seed: 345, matchId: "shield-brace-charge" });
    const rider = configureCombatUnit(state, "player-1", 0, "boarRider", { x: 5, y: 5 });
    const shield = configureCombatUnit(state, "player-2", 0, "shieldBearer", { x: 7, y: 5 });
    shield.facing = "w";
    state.entities = [rider, shield];
    state = stepSimulation(state, [], 8).state;
    expect((state.entities.find((entity) => entity.id === shield.id) as UnitEntityState).statuses.some((status) => status.id === "braced")).toBe(true);
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: rider.id, abilityId: "tuskCharge", target: { kind: "direction", vector: { x: 6, y: 0 } },
    })).state;
    const result = stepSimulation(state, [], 4);
    const expected = calculateDamage({
      baseDamage: COMBAT_UNITS.boarRider.baseDamage,
      armor: COMBAT_UNITS.shieldBearer.armor,
      counterMultiplier: COUNTER_MATRIX.boarRider.shieldBearer,
      skillMultiplier: 1.6 * 0.6,
    });
    expect(result.events.some((event) => event.type === "entityDamaged" && event.targetId === shield.id && event.amount === expected)).toBe(true);
    expect(result.events.some((event) => event.type === "statusApplied" && event.targetId === rider.id && event.statusId === "stagger")).toBe(true);
    const resolvedShield = result.state.entities.find((entity): entity is UnitEntityState => entity.id === shield.id && entity.kind === "unit")!;
    expect(resolvedShield.statuses.some((status) => status.id === "braced")).toBe(false);
    expect(resolvedShield.passive.braceCooldownUntilTick).toBeGreaterThan(result.state.tick);
  });

  it("consumes matchlock rest and boar momentum on the next basic attack", () => {
    let rested = createInitialState({ seed: 346, matchId: "matchlock-rest", victoryPolicy: { commandCenterConquest: null, elimination: false } });
    const musketeer = configureCombatUnit(rested, "player-1", 0, "musketeer", { x: 5, y: 5 });
    const spotter = configureCombatUnit(rested, "player-1", 1, "warrior", { x: 13, y: 6 });
    const distant = configureCombatUnit(rested, "player-2", 0, "warrior", { x: 14, y: 5 });
    rested.entities = [musketeer, spotter];
    rested = stepSimulation(rested, [], 15).state;
    rested.entities.push(distant);
    const restedAttack = applyCommand(rested, envelope(rested, 0, { type: "attack", entityIds: [musketeer.id], targetId: distant.id }));
    expect(restedAttack.validation).toEqual({ ok: true });
    rested = restedAttack.state;
    rested = stepSimulation(rested, [], 1).state;
    const activeMusketeer = rested.entities.find((entity): entity is UnitEntityState => entity.id === musketeer.id && entity.kind === "unit")!;
    expect(activeMusketeer.combat.phase).toBe("windup");
    expect(activeMusketeer.combat.readyTick - rested.tick).toBe(Math.floor(UNITS.musketeer.attackCooldownTicks * 0.8));

    let momentum = createInitialState({ seed: 347, matchId: "boar-momentum", victoryPolicy: { commandCenterConquest: null, elimination: false } });
    const rider = configureCombatUnit(momentum, "player-1", 0, "boarRider", { x: 2, y: 5 });
    const target = configureCombatUnit(momentum, "player-2", 0, "warrior", { x: 14, y: 12 });
    momentum.entities = [rider, target];
    momentum = applyCommand(momentum, envelope(momentum, 0, { type: "move", entityIds: [rider.id], target: { x: 5, y: 5 } })).state;
    momentum = stepSimulation(momentum, [], 18).state;
    momentum.entities.find((entity) => entity.id === target.id)!.position = { x: 6, y: 5 };
    momentum = applyCommand(momentum, envelope(momentum, 1, { type: "attack", entityIds: [rider.id], targetId: target.id })).state;
    const charged = stepSimulation(momentum, [], 4);
    const expected = calculateDamage({
      baseDamage: COMBAT_UNITS.boarRider.baseDamage,
      armor: COMBAT_UNITS.warrior.armor,
      counterMultiplier: COUNTER_MATRIX.boarRider.warrior,
      skillMultiplier: 1.2,
    });
    expect(charged.events.some((event) => event.type === "entityDamaged" && event.targetId === target.id && event.amount === expected)).toBe(true);
    expect((charged.state.entities.find((entity) => entity.id === rider.id) as UnitEntityState).passive.movedTilesSinceAttack).toBe(0);
  });

  it("automatically emplaces a stationary heavy crossbow and clears it on redeploy", () => {
    let state = createInitialState({ seed: 348, matchId: "heavy-emplacement", victoryPolicy: { commandCenterConquest: null, elimination: false } });
    const crossbow = configureCombatUnit(state, "player-1", 0, "heavyCrossbowman", { x: 5, y: 5 });
    state.entities = [crossbow];
    state = stepSimulation(state, [], 20).state;
    const emplaced = state.entities.find((entity) => entity.id === crossbow.id) as UnitEntityState;
    expect(emplaced.statuses.some((status) => status.id === "emplaced")).toBe(true);
    expect(toPublicEntity(emplaced).passiveProgress).toMatchObject({ stationarySinceTick: 0, movedTilesSinceAttack: 0, rhythmStacks: 0 });
    const redeploy = applyCommand(state, envelope(state, 0, { type: "move", entityIds: [crossbow.id], target: { x: 6, y: 5 } }));
    expect(redeploy.events).toContainEqual({ type: "statusExpired", entityId: crossbow.id, statusId: "emplaced" });
    state = redeploy.state;
    expect((state.entities.find((entity) => entity.id === crossbow.id) as UnitEntityState).statuses.some((status) => status.id === "emplaced")).toBe(false);
  });

  it("clears warrior rhythm immediately when an attack order switches targets", () => {
    let state = createInitialState({ seed: 349, matchId: "rhythm-target-switch" });
    const warrior = configureCombatUnit(state, "player-1", 0, "warrior", { x: 5, y: 5 });
    const first = configureCombatUnit(state, "player-2", 0, "shieldBearer", { x: 6, y: 5 });
    const second = configureCombatUnit(state, "player-2", 1, "shieldBearer", { x: 5, y: 6 });
    warrior.passive.rhythmTargetId = first.id;
    warrior.passive.rhythmStacks = 3;
    warrior.passive.rhythmLastHitTick = state.tick;
    state.entities = [warrior, first, second];
    state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [warrior.id], targetId: second.id })).state;
    let resolvedWarrior = state.entities.find((entity): entity is UnitEntityState => entity.id === warrior.id && entity.kind === "unit")!;
    expect(resolvedWarrior.passive.rhythmStacks).toBe(0);
    state = applyCommand(state, envelope(state, 1, { type: "attack", entityIds: [warrior.id], targetId: first.id })).state;
    const result = stepSimulation(state, [], 4);
    const baseDamage = calculateDamage({
      baseDamage: COMBAT_UNITS.warrior.baseDamage,
      armor: COMBAT_UNITS.shieldBearer.armor,
      counterMultiplier: COUNTER_MATRIX.warrior.shieldBearer,
    });
    expect(result.events.some((event) => event.type === "entityDamaged" && event.targetId === first.id && event.amount === baseDamage)).toBe(true);
    resolvedWarrior = result.state.entities.find((entity): entity is UnitEntityState => entity.id === warrior.id && entity.kind === "unit")!;
    expect(resolvedWarrior.passive.rhythmStacks).toBe(1);
  });

  it("applies the archer gap-hunter bonus only to an emplaced heavy crossbow", () => {
    const damageAgainst = (emplaced: boolean): number => {
      let state = createInitialState({ seed: emplaced ? 351 : 350, matchId: `gap-hunter-${emplaced}` });
      const archer = configureCombatUnit(state, "player-1", 0, "archer", { x: 5, y: 5 });
      const target = configureCombatUnit(state, "player-2", 0, "heavyCrossbowman", { x: 8, y: 5 });
      if (emplaced) target.statuses.push({ id: "emplaced", sourceId: target.id, expiresAtTick: Number.MAX_SAFE_INTEGER, nextTickAt: null });
      state.entities = [archer, target];
      state = applyCommand(state, envelope(state, 0, { type: "attack", entityIds: [archer.id], targetId: target.id })).state;
      const result = stepSimulation(state, [], 8);
      return COMBAT_UNITS.heavyCrossbowman.maxHitPoints - result.state.entities.find((entity) => entity.id === target.id)!.hitPoints;
    };
    expect(damageAgainst(false)).toBe(calculateDamage({
      baseDamage: COMBAT_UNITS.archer.baseDamage,
      armor: COMBAT_UNITS.heavyCrossbowman.armor,
      counterMultiplier: 1,
    }));
    expect(damageAgainst(true)).toBe(calculateDamage({
      baseDamage: COMBAT_UNITS.archer.baseDamage,
      armor: COMBAT_UNITS.heavyCrossbowman.armor,
      counterMultiplier: COUNTER_MATRIX.archer.heavyCrossbowman,
    }));
  });

  it("knocks a heavy crossbow out of emplacement during a tusk charge", () => {
    let state = createInitialState({ seed: 352, matchId: "charge-breaks-emplacement" });
    const rider = configureCombatUnit(state, "player-1", 0, "boarRider", { x: 5, y: 5 });
    const crossbow = configureCombatUnit(state, "player-2", 0, "heavyCrossbowman", { x: 7, y: 5 });
    state.entities = [rider, crossbow];
    state = stepSimulation(state, [], 20).state;
    expect((state.entities.find((entity) => entity.id === crossbow.id) as UnitEntityState).statuses.some((status) => status.id === "emplaced")).toBe(true);
    state = applyCommand(state, envelope(state, 0, {
      type: "castAbility", casterId: rider.id, abilityId: "tuskCharge", target: { kind: "direction", vector: { x: 6, y: 0 } },
    })).state;
    const result = stepSimulation(state, [], 4);
    const pushed = result.state.entities.find((entity): entity is UnitEntityState => entity.id === crossbow.id && entity.kind === "unit")!;
    expect(pushed.position).toEqual({ x: 8, y: 5 });
    expect(pushed.statuses.some((status) => status.id === "emplaced")).toBe(false);
    expect(result.events).toContainEqual({ type: "statusExpired", entityId: crossbow.id, statusId: "emplaced" });
  });

  it("repeats a projectile and status battle identically across 10,000 ticks", () => {
    const initial = createInitialState({ seed: 355, matchId: "combat-determinism-10000" });
    const caster = configureCombatUnit(initial, "player-1", 0, "archer", { x: 5, y: 5 });
    const target = configureCombatUnit(initial, "player-2", 0, "warrior", { x: 8, y: 5 });
    const centers = initial.entities.filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.typeId === "townCenter");
    centers[0]!.position = { x: 1, y: 1 };
    centers[1]!.position = { x: 29, y: 29 };
    centers.forEach((center) => { center.attackCooldownTicks = 20_000; });
    initial.entities = [centers[0]!, centers[1]!, caster, target];
    const commands = [envelope(initial, 0, {
      type: "castAbility", casterId: caster.id, abilityId: "pinningVolley", target: { kind: "ground", point: { x: 8, y: 5 } },
    })];
    const first = stepSimulation(initial, commands, 10_000);
    const second = stepSimulation(initial, commands, 10_000);
    expect(hashMatchState(first.state)).toBe(hashMatchState(second.state));
    expect(first.events).toEqual(second.events);
  }, 60_000);

  it("executes every combat role active ability through validated authoritative commands", () => {
    for (const [index, typeId] of COMBAT_UNIT_IDS.entries()) {
      let state = createInitialState({ seed: 330 + index, matchId: `ability-${typeId}` });
      const caster = configureCombatUnit(state, "player-1", 0, typeId, { x: 5, y: 5 });
      const target = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 5 });
      const ability = COMBAT_UNITS[typeId].activeAbility;
      const abilityTarget = ability.targeting === "self"
        ? { kind: "self" as const }
        : ability.targeting === "unit"
          ? { kind: "entity" as const, entityId: target.id }
          : ability.targeting === "ground"
            ? { kind: "ground" as const, point: { ...target.position } }
            : { kind: "direction" as const, vector: { x: 1, y: 0 } };
      const cast = applyCommand(state, envelope(state, 0, { type: "castAbility", casterId: caster.id, abilityId: ability.id, target: abilityTarget }));
      expect(cast.validation, `${typeId} ability should validate`).toEqual({ ok: true });
      const resolved = stepSimulation(cast.state, [], 40);
      expect(resolved.events.some((event) => event.type === "combatPhaseChanged" && event.entityId === caster.id && event.action === "ability"), `${typeId} should enter ability phase`).toBe(true);
      expect(
        resolved.events.some((event) => event.type === "entityDamaged" || event.type === "statusApplied" || event.type === "projectileSpawned"),
        `${typeId} should produce a combat result`,
      ).toBe(true);
      state = resolved.state;
      expect((state.entities.find((entity) => entity.id === caster.id) as UnitEntityState | undefined)?.abilityReadyTick).toBeGreaterThan(0);
    }
  });

  it("assigns distinct formation destinations, attack-moves through contact, and repairs with exact wood cost", () => {
    let state = createInitialState({ seed: 340, matchId: "tactical-orders" });
    const units = [0, 1].map((index) => configureCombatUnit(state, "player-1", index, "warrior", { x: 2, y: 2 + index }));
    const enemy = configureCombatUnit(state, "player-2", 0, "warrior", { x: 6, y: 3 });
    enemy.hitPoints = 1;
    state = applyCommand(state, envelope(state, 0, { type: "setFormation", entityIds: units.map((unit) => unit.id), formation: "wedge" })).state;
    state = applyCommand(state, envelope(state, 1, { type: "attackMove", entityIds: units.map((unit) => unit.id), target: { x: 10, y: 3 } })).state;
    const destinations = state.entities
      .filter((entity): entity is UnitEntityState => entity.kind === "unit" && units.some((unit) => unit.id === entity.id))
      .map((unit) => unit.order.type === "attackMove" ? `${unit.order.target.x},${unit.order.target.y}` : "invalid");
    expect(new Set(destinations).size).toBe(units.length);
    state = stepSimulation(state, [], 100).state;
    expect(state.entities.some((entity) => entity.id === enemy.id)).toBe(false);

    const villager = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const center = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    villager.position = { x: center.position.x - 1, y: center.position.y };
    center.hitPoints -= 20;
    const beforeWood = state.players[0]!.resources.wood;
    const beforeHp = center.hitPoints;
    const repaired = applyCommand(state, envelope(state, 2, { type: "repair", entityIds: [villager.id], targetId: center.id }));
    expect(repaired.validation).toEqual({ ok: true });
    const repairTick = stepSimulation(repaired.state, [], 1).state;
    expect(repairTick.players[0]!.resources.wood).toBe(beforeWood - 1);
    expect(repairTick.entities.find((entity) => entity.id === center.id)?.hitPoints).toBe(beforeHp + 10);
  });

  it("finishes conquest after an enemy town center is destroyed and its rebuild grace expires", () => {
    const initial = createInitialState({ seed: 31, matchId: "town-center-conquest" });
    const attacker = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const enemyCenter = initial.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    enemyCenter.position = { x: attacker.position.x, y: attacker.position.y + 1 };
    enemyCenter.hitPoints = 1;

    const attack = applyCommand(initial, envelope(initial, 0, { type: "attack", entityIds: [attacker.id], targetId: enemyCenter.id }));
    expect(attack.validation).toEqual({ ok: true });
    const result = stepSimulation(attack.state, [], 610);

    expect(result.state.phase).toBe("finished");
    expect(result.state.finishReason).toBe("conquest");
    expect(result.state.winningTeamIds).toEqual(["team-1"]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "entityRemoved", entityId: enemyCenter.id, entity: expect.objectContaining({ id: enemyCenter.id }), reason: "destroyed",
    }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: "matchFinished", winningTeamIds: ["team-1"], reason: "conquest", outcome: "victory" }));
  }, 60_000);
});
