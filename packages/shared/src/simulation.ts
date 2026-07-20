import {
  BUILDINGS,
  MAX_TRAINING_QUEUE_DEPTH,
  MAX_UNITS_PER_PLAYER,
  RESOURCE_NODES,
  RULES_VERSION,
  SETTLEMENT_TIERS,
  SETTLEMENT_TIER_ORDER,
  STARTING_RESOURCES,
  TICKS_PER_SECOND,
  TOWN_CENTER_REBUILD_GRACE_TICKS,
  UNITS,
  getVillage,
} from "./content.js";
import {
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ID,
  VILLAGE_ASSAULT_MAP_WIDTH,
  getVillageAssaultBuildBlockedCells,
  getVillageAssaultWalkBlockedCells,
  isVillageAssaultWalkableCell,
} from "./battlefield.js";
import { normalizeSeed } from "./random.js";
import { findNextPathStep, findPathToAny, getFootprintCells, getFootprintPerimeterCells, validateFootprintPlacement } from "./spatial.js";
import {
  isCommandEnvelope,
  type BuildingType,
  type CommandEnvelope,
  type CommandRejectCode,
  type DomainEvent,
  type EntityId,
  type GameCommand,
  type GridPoint,
  type MatchId,
  type MatchPhase,
  type PlayerId,
  type PublicEntityState,
  type ResourceKind,
  type ResourceWallet,
  type SettlementTier,
  type UnitType,
  type VillageId,
} from "./protocol.js";

export type UnitOrder =
  | { type: "idle" }
  | { type: "move"; target: GridPoint }
  | { type: "attack"; targetId: EntityId }
  | { type: "gather"; targetId: EntityId; resourceKind: ResourceKind; phase: "toSource" | "toDropOff"; dropOffId: EntityId | null }
  | { type: "deliver"; targetId: EntityId }
  | { type: "construct"; targetId: EntityId }
  | { type: "patrol"; waypoints: GridPoint[]; waypointIndex: number };

export interface UnitEntityState {
  id: EntityId;
  ownerId: PlayerId;
  kind: "unit";
  typeId: UnitType;
  position: GridPoint;
  hitPoints: number;
  maxHitPoints: number;
  stateRevision: number;
  order: UnitOrder;
  movementProgress: number;
  attackCooldownTicks: number;
  workCooldownTicks: number;
  cargo: { kind: ResourceKind | null; amount: number };
  gatherRemainderMilli: ResourceWallet;
}

export interface TrainingJob {
  unitType: UnitType;
  remainingTicks: number;
}

export interface BuildingEntityState {
  id: EntityId;
  ownerId: PlayerId;
  kind: "building";
  typeId: BuildingType;
  position: GridPoint;
  hitPoints: number;
  maxHitPoints: number;
  stateRevision: number;
  complete: boolean;
  constructionRemainingTicks: number;
  attackCooldownTicks: number;
  trainingQueue: TrainingJob[];
}

export interface ResourceEntityState {
  id: EntityId;
  ownerId: null;
  kind: "resource";
  typeId: ResourceKind;
  position: GridPoint;
  hitPoints: number;
  maxHitPoints: number;
  stateRevision: number;
  amount: number;
  renewAtTick: number | null;
}

export type EntityState = UnitEntityState | BuildingEntityState | ResourceEntityState;

export interface PlayerState {
  id: PlayerId;
  teamId: string;
  villageId: VillageId;
  resources: ResourceWallet;
  population: { used: number; capacity: number };
  settlementTier: SettlementTier;
  advancement: { producerId: EntityId; targetTier: SettlementTier; remainingTicks: number } | null;
  lastSequence: number;
  surrendered: boolean;
  eliminated: boolean;
}

export interface MatchState {
  rulesVersion: string;
  matchId: MatchId;
  seed: number;
  randomState: number;
  tick: number;
  ticksPerSecond: 10;
  phase: MatchPhase;
  map: { id: "open" | typeof VILLAGE_ASSAULT_MAP_ID; width: number; height: number };
  players: PlayerState[];
  entities: EntityState[];
  nextEntityNumber: number;
  teamTownCenterLostAt: { teamId: string; tick: number }[];
  winningTeamIds: string[];
  finishReason: "conquest" | "surrender" | "disconnect" | null;
}

export interface InitialPlayer {
  readonly id: PlayerId;
  readonly teamId: string;
  readonly villageId: VillageId;
}

export interface CreateInitialStateOptions {
  readonly matchId?: MatchId;
  readonly seed?: number;
  readonly players?: readonly InitialPlayer[];
  readonly map?: { readonly id?: "open" | typeof VILLAGE_ASSAULT_MAP_ID; readonly width: number; readonly height: number };
  readonly spawnOverrides?: Readonly<Partial<Record<PlayerId, GridPoint>>>;
}

export type CommandValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CommandRejectCode };

export interface CommandApplication {
  readonly state: MatchState;
  readonly validation: CommandValidation;
  readonly events: readonly DomainEvent[];
}

export interface SimulationStepResult {
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
}

const DEFAULT_PLAYERS: readonly InitialPlayer[] = [
  { id: "player-1", teamId: "team-1", villageId: "pinehold" },
  { id: "player-2", teamId: "team-2", villageId: "riverstead" },
];

const SPAWNS: Readonly<Record<VillageId, GridPoint>> = {
  pinehold: { x: 6, y: 6 },
  riverstead: { x: 25, y: 6 },
  highcrag: { x: 15, y: 25 },
  marshwatch: { x: 6, y: 25 },
  sunfield: { x: 25, y: 25 },
};

const VILLAGE_ASSAULT_SPAWNS: readonly GridPoint[] = [
  { x: 3, y: 8 },
  { x: 14, y: 8 },
  { x: 3, y: 2 },
  { x: 14, y: 2 },
  { x: 8, y: 13 },
];

export function createInitialState(options: CreateInitialStateOptions = {}): MatchState {
  const participants = options.players ?? DEFAULT_PLAYERS;
  if (participants.length < 2 || participants.length > 5) throw new RangeError("A match requires two to five factions");
  if (new Set(participants.map((player) => player.id)).size !== participants.length) throw new Error("Player ids must be unique");
  if (new Set(participants.map((player) => player.villageId)).size !== participants.length) throw new Error("Village ids must be unique");

  const mapId = options.map?.id ?? "open";
  const mapWidth = options.map?.width ?? 32;
  const mapHeight = options.map?.height ?? 32;
  if (mapId === VILLAGE_ASSAULT_MAP_ID && (mapWidth !== VILLAGE_ASSAULT_MAP_WIDTH || mapHeight !== VILLAGE_ASSAULT_MAP_HEIGHT)) {
    throw new RangeError(`Village assault map must be ${VILLAGE_ASSAULT_MAP_WIDTH}x${VILLAGE_ASSAULT_MAP_HEIGHT}`);
  }
  const state: MatchState = {
    rulesVersion: RULES_VERSION,
    matchId: options.matchId ?? "local-match",
    seed: normalizeSeed(options.seed ?? 1),
    randomState: normalizeSeed(options.seed ?? 1),
    tick: 0,
    ticksPerSecond: TICKS_PER_SECOND,
    phase: "playing",
    map: { id: mapId, width: mapWidth, height: mapHeight },
    players: participants.map((participant) => ({
      ...participant,
      resources: { ...STARTING_RESOURCES },
      population: { used: 0, capacity: 0 },
      settlementTier: "frontier",
      advancement: null,
      lastSequence: -1,
      surrendered: false,
      eliminated: false,
    })),
    entities: [],
    nextEntityNumber: 1,
    teamTownCenterLostAt: [],
    winningTeamIds: [],
    finishReason: null,
  };

  for (const [playerIndex, player] of state.players.entries()) {
    const defaultSpawn = mapId === VILLAGE_ASSAULT_MAP_ID ? VILLAGE_ASSAULT_SPAWNS[playerIndex]! : SPAWNS[player.villageId];
    const center = clampBuildingOrigin(options.spawnOverrides?.[player.id] ?? defaultSpawn, "townCenter", state);
    state.entities.push(createBuilding(state, player.id, "townCenter", center, true));
    const villagerOffsets = [{ x: -1, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }];
    for (const offset of villagerOffsets) {
      state.entities.push(createUnit(state, player.id, "villager", clampPoint({ x: center.x + offset.x, y: center.y + offset.y }, state)));
    }
    const resources: readonly [ResourceKind, number, number][] = [["wood", -2, 0], ["food", 2, 0], ["stone", 0, -2]];
    for (const [kind, dx, dy] of resources) {
      state.entities.push(createResource(state, kind, clampPoint({ x: center.x + dx, y: center.y + dy }, state)));
    }
  }
  syncPopulation(state);
  return state;
}

export const createMatchState = createInitialState;

export function validateCommand(state: MatchState, envelope: unknown): CommandValidation {
  if (!isCommandEnvelope(envelope)) return rejected("INVALID_PAYLOAD");
  if (envelope.matchId !== state.matchId) return rejected("INVALID_PAYLOAD");
  if (state.phase !== "playing") return rejected("MATCH_NOT_PLAYING");
  const player = state.players.find((candidate) => candidate.id === envelope.playerId);
  if (!player) return rejected("NOT_ROOM_MEMBER");
  if (player.surrendered || player.eliminated) return rejected("MATCH_NOT_PLAYING");
  if (envelope.sequence <= player.lastSequence) return rejected("STALE_OR_DUPLICATE_SEQUENCE");
  return validateGameCommand(state, player, envelope.command);
}

export function applyCommand(state: MatchState, envelope: CommandEnvelope): CommandApplication {
  const next = cloneMatchState(state);
  const validation = validateCommand(next, envelope);
  if (!validation.ok) {
    return { state: next, validation, events: [{ type: "commandRejected", sequence: envelope.sequence, code: validation.code }] };
  }
  const events: DomainEvent[] = [{ type: "commandAccepted", sequence: envelope.sequence, serverTick: next.tick }];
  const player = next.players.find((candidate) => candidate.id === envelope.playerId)!;
  player.lastSequence = envelope.sequence;
  applyGameCommand(next, player, envelope.command, events);
  syncPopulation(next);
  evaluateVictory(next, events);
  return { state: next, validation, events };
}

export function stepSimulation(state: MatchState, commands: readonly CommandEnvelope[] = [], deltaTicks = 1): SimulationStepResult {
  if (!Number.isSafeInteger(deltaTicks) || deltaTicks < 0) throw new RangeError("deltaTicks must be a non-negative safe integer");
  let next = cloneMatchState(state);
  const events: DomainEvent[] = [];
  const ordered = [...commands].sort((left, right) => left.playerId.localeCompare(right.playerId) || left.sequence - right.sequence);
  for (const envelope of ordered) {
    const applied = applyCommand(next, envelope);
    next = applied.state;
    events.push(...applied.events);
  }
  for (let index = 0; index < deltaTicks && next.phase === "playing"; index += 1) {
    advanceOneTick(next, events);
  }
  return { state: next, events };
}

export function cloneMatchState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

export function hashMatchState(state: MatchState): string {
  return fnv1a(stableStringify(state));
}

export function hashReplay(initialState: MatchState, commands: readonly CommandEnvelope[], deltaTicks: number): string {
  const result = stepSimulation(initialState, commands, deltaTicks);
  return fnv1a(stableStringify({ initial: hashMatchState(initialState), commands, deltaTicks, final: hashMatchState(result.state) }));
}

export function toPublicEntity(entity: EntityState): PublicEntityState {
  const publicEntity: PublicEntityState = {
    id: entity.id,
    ownerId: entity.ownerId,
    kind: entity.kind,
    typeId: entity.typeId,
    position: entity.position,
    hitPoints: entity.hitPoints,
    maxHitPoints: entity.maxHitPoints,
    stateRevision: entity.stateRevision,
  };
  if (entity.kind === "unit") {
    return {
      ...publicEntity,
      cargo: {
        kind: entity.cargo.kind,
        amount: entity.cargo.amount,
        capacity: UNITS[entity.typeId].carryCapacity,
      },
    };
  }
  if (entity.kind === "resource") {
    return {
      ...publicEntity,
      resourceNode: {
        amount: entity.amount,
        maxAmount: entity.maxHitPoints,
        renewAtTick: entity.renewAtTick,
      },
    };
  }
  return publicEntity;
}

export function isEntityVisibleToPlayer(state: MatchState, playerId: PlayerId, target: EntityState): boolean {
  if (target.ownerId === playerId) return true;
  return state.entities.some((observer) => {
    if (observer.ownerId !== playerId || observer.hitPoints <= 0) return false;
    const radius = observer.kind === "unit" ? UNITS[observer.typeId].sightRadius : BUILDINGS[observer.typeId].sightRadius;
    return distanceSquared(observer.position, target.position) <= radius * radius;
  });
}

export function getEntityFootprintCells(entity: EntityState): readonly GridPoint[] {
  return entity.kind === "building"
    ? getFootprintCells(entity.position, BUILDINGS[entity.typeId].footprint)
    : [entity.position];
}

export function getOccupiedMapCells(state: MatchState): readonly GridPoint[] {
  return state.entities.flatMap((entity) => entity.kind === "unit" ? [] : getEntityFootprintCells(entity));
}

export function isBuildLocationAvailable(state: MatchState, buildingType: BuildingType, origin: GridPoint): boolean {
  const terrainBlocked = state.map.id === VILLAGE_ASSAULT_MAP_ID ? getVillageAssaultBuildBlockedCells() : [];
  const occupied = getOccupiedMapCells(state);
  const placement = validateFootprintPlacement(
    origin,
    BUILDINGS[buildingType].footprint,
    state.map.width,
    state.map.height,
    [...occupied, ...terrainBlocked],
  );
  if (!placement.ok) return false;
  const walkBlocked = state.map.id === VILLAGE_ASSAULT_MAP_ID ? getVillageAssaultWalkBlockedCells() : [];
  const approachBlocked = new Set([...occupied, ...walkBlocked].map(pointKey));
  return getFootprintPerimeterCells(origin, BUILDINGS[buildingType].footprint).some((cell) => (
    isPointInBounds(cell, state) && !approachBlocked.has(pointKey(cell))
  ));
}

function validateGameCommand(state: MatchState, player: PlayerState, command: GameCommand): CommandValidation {
  if (command.type === "surrender") return { ok: true };
  if (command.type === "advanceSettlement") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (producer.typeId !== "townCenter") return rejected("INVALID_PAYLOAD");
    if (!producer.complete || player.advancement !== null) return rejected("ACTION_ON_COOLDOWN");
    const currentIndex = SETTLEMENT_TIER_ORDER.indexOf(player.settlementTier);
    const targetIndex = SETTLEMENT_TIER_ORDER.indexOf(command.targetTier);
    if (targetIndex !== currentIndex + 1) return rejected("PREREQUISITE_NOT_MET");
    const definition = SETTLEMENT_TIERS[command.targetTier];
    if (!hasCompletedPrerequisites(state, player.id, definition.prerequisites)) return rejected("PREREQUISITE_NOT_MET");
    return canAfford(player.resources, definition.cost) ? { ok: true } : rejected("INSUFFICIENT_RESOURCES");
  }
  if (command.type === "build") {
    const builders = ownedUnits(state, player.id, command.builderIds);
    if (!builders) return rejected("ENTITY_NOT_OWNED");
    if (builders.some((builder) => builder.typeId !== "villager")) return rejected("INVALID_PAYLOAD");
    if (!isBuildLocationAvailable(state, command.buildingType, command.origin)) return rejected("TARGET_NOT_REACHABLE");
    if (!meetsTier(player.settlementTier, BUILDINGS[command.buildingType].requiredTier)) return rejected("PREREQUISITE_NOT_MET");
    return canAfford(player.resources, BUILDINGS[command.buildingType].cost) ? { ok: true } : rejected("INSUFFICIENT_RESOURCES");
  }
  if (command.type === "train") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (!producer.complete || producer.trainingQueue.length + command.count > MAX_TRAINING_QUEUE_DEPTH) return rejected("ACTION_ON_COOLDOWN");
    const definition = UNITS[command.unitType];
    if (!definition.producers.includes(producer.typeId)) return rejected("INVALID_PAYLOAD");
    if (!meetsTier(player.settlementTier, definition.requiredTier)) return rejected("PREREQUISITE_NOT_MET");
    if (usedPopulation(state, player.id) + queuedPopulation(state, player.id) + definition.population * command.count > player.population.capacity || countUnits(state, player.id) + command.count > MAX_UNITS_PER_PLAYER) return rejected("ACTION_ON_COOLDOWN");
    return canAfford(player.resources, multiplyWallet(definition.cost, command.count)) ? { ok: true } : rejected("INSUFFICIENT_RESOURCES");
  }
  const ids = command.entityIds;
  const units = ownedUnits(state, player.id, ids);
  if (!units) return rejected("ENTITY_NOT_OWNED");
  if (command.type === "move") return isPointInBounds(command.target, state) && isMapCellWalkable(state, command.target) && !isMapCellBlocked(state, command.target) ? { ok: true } : rejected("TARGET_NOT_REACHABLE");
  if (command.type === "patrol") return command.waypoints.every((point) => isPointInBounds(point, state) && isMapCellWalkable(state, point) && !isMapCellBlocked(state, point)) ? { ok: true } : rejected("TARGET_NOT_REACHABLE");
  if (command.type === "stop") return { ok: true };
  const target = state.entities.find((entity) => entity.id === command.targetId);
  if (!target) return rejected("INVALID_PAYLOAD");
  if (!isEntityVisibleToPlayer(state, player.id, target)) return rejected("TARGET_NOT_VISIBLE");
  if (command.type === "gather") {
    const resourceKind = gatherSourceKind(target);
    if (!resourceKind || gatherSourceAmount(target) <= 0 || units.some((unit) => unit.typeId !== "villager")) return rejected("INVALID_PAYLOAD");
    if (units.some((unit) => !isEntityReachable(state, unit.position, target))) return rejected("TARGET_NOT_REACHABLE");
    if (units.some((unit) => {
      const capacity = UNITS[unit.typeId].carryCapacity;
      const depositKind = unit.cargo.amount > 0 && (unit.cargo.kind !== resourceKind || unit.cargo.amount >= capacity)
        ? unit.cargo.kind
        : resourceKind;
      return depositKind === null || findNearestDropOff(state, player.id, depositKind, unit.position) === null;
    })) return rejected("TARGET_NOT_REACHABLE");
    return { ok: true };
  }
  if (command.type === "dropOff") {
    if (target.kind !== "building" || target.ownerId !== player.id || !target.complete || target.hitPoints <= 0) return rejected("INVALID_PAYLOAD");
    if (units.some((unit) => unit.typeId !== "villager" || unit.cargo.kind === null || unit.cargo.amount <= 0 || !buildingAcceptsResource(target, unit.cargo.kind))) return rejected("INVALID_PAYLOAD");
    if (units.some((unit) => !isEntityReachable(state, unit.position, target))) return rejected("TARGET_NOT_REACHABLE");
    return { ok: true };
  }
  if (target.kind === "resource" || target.ownerId === player.id) return rejected("INVALID_PAYLOAD");
  return { ok: true };
}

function applyGameCommand(state: MatchState, player: PlayerState, command: GameCommand, events: DomainEvent[]): void {
  switch (command.type) {
    case "move":
      setOrders(state, command.entityIds, { type: "move", target: command.target });
      break;
    case "attack":
      setOrders(state, command.entityIds, { type: "attack", targetId: command.targetId });
      break;
    case "gather": {
      const target = state.entities.find((entity) => entity.id === command.targetId)!;
      const resourceKind = gatherSourceKind(target)!;
      for (const id of command.entityIds) {
        const unit = state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
        if (unit.order.type === "gather" && unit.order.targetId === command.targetId && unit.order.resourceKind === resourceKind) continue;
        const capacity = UNITS[unit.typeId].carryCapacity;
        const mustDeposit = unit.cargo.amount > 0 && (unit.cargo.kind !== resourceKind || unit.cargo.amount >= capacity);
        unit.order = {
          type: "gather",
          targetId: command.targetId,
          resourceKind,
          phase: mustDeposit ? "toDropOff" : "toSource",
          dropOffId: mustDeposit ? findNearestDropOff(state, unit.ownerId, unit.cargo.kind!, unit.position)?.id ?? null : null,
        };
        unit.stateRevision += 1;
      }
      break;
    }
    case "dropOff":
      setOrders(state, command.entityIds, { type: "deliver", targetId: command.targetId });
      break;
    case "patrol":
      setOrders(state, command.entityIds, { type: "patrol", waypoints: [...command.waypoints], waypointIndex: 0 });
      break;
    case "stop":
      setOrders(state, command.entityIds, { type: "idle" });
      break;
    case "build": {
      const building = createBuilding(state, player.id, command.buildingType, command.origin, false);
      state.entities.push(building);
      subtractWallet(player, BUILDINGS[command.buildingType].cost);
      setOrders(state, command.builderIds, { type: "construct", targetId: building.id });
      events.push({ type: "entitySpawned", entity: toPublicEntity(building) });
      break;
    }
    case "train": {
      const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building")!;
      const definition = UNITS[command.unitType];
      subtractWallet(player, multiplyWallet(definition.cost, command.count));
      for (let index = 0; index < command.count; index += 1) producer.trainingQueue.push({ unitType: command.unitType, remainingTicks: definition.trainTicks });
      producer.stateRevision += 1;
      break;
    }
    case "advanceSettlement": {
      const definition = SETTLEMENT_TIERS[command.targetTier];
      subtractWallet(player, definition.cost);
      player.advancement = {
        producerId: command.producerId,
        targetTier: command.targetTier,
        remainingTicks: definition.advanceTicks,
      };
      const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
      if (producer) producer.stateRevision += 1;
      break;
    }
    case "surrender":
      player.surrendered = true;
      player.eliminated = true;
      break;
  }
}

function advanceOneTick(state: MatchState, events: DomainEvent[]): void {
  state.tick += 1;
  const resources = state.entities
    .filter((entity): entity is ResourceEntityState => entity.kind === "resource")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const resource of resources) updateRenewableResourceNode(state, resource, events);
  const units = state.entities
    .filter((entity): entity is UnitEntityState => entity.kind === "unit")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const unit of units) {
    unit.attackCooldownTicks = Math.max(0, unit.attackCooldownTicks - 1);
    unit.workCooldownTicks = Math.max(0, unit.workCooldownTicks - 1);
    updateUnit(state, unit, events);
  }
  const buildings = state.entities
    .filter((entity): entity is BuildingEntityState => entity.kind === "building")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const building of buildings) {
    building.attackCooldownTicks = Math.max(0, building.attackCooldownTicks - 1);
    updateTraining(state, building, events);
    updateTower(state, building);
  }
  const removed = state.entities.filter((entity) => (
    entity.kind === "resource"
      ? entity.amount <= 0 && entity.renewAtTick === null
      : entity.hitPoints <= 0
  ));
  if (removed.length > 0) {
    const removedIds = new Set(removed.map((entity) => entity.id));
    state.entities = state.entities.filter((entity) => !removedIds.has(entity.id));
    for (const entity of removed) events.push({ type: "entityRemoved", entityId: entity.id, reason: entity.kind === "resource" ? "depleted" : "destroyed" });
  }
  updateSettlementAdvancements(state, events);
  syncPopulation(state);
  evaluateVictory(state, events);
}

function updateUnit(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): void {
  const order = unit.order;
  if (order.type === "idle") return;
  if (order.type === "move") {
    if (moveToward(state, unit, order.target)) unit.order = { type: "idle" };
    return;
  }
  if (order.type === "patrol") {
    const target = order.waypoints[order.waypointIndex];
    if (!target) { unit.order = { type: "idle" }; return; }
    if (moveToward(state, unit, target)) order.waypointIndex = (order.waypointIndex + 1) % order.waypoints.length;
    return;
  }
  if (order.type === "gather") {
    updateGatherOrder(state, unit, order, events);
    return;
  }
  if (order.type === "deliver") {
    updateDeliveryOrder(state, unit, order.targetId, events);
    return;
  }
  const target = state.entities.find((entity) => entity.id === order.targetId);
  if (!target) { unit.order = { type: "idle" }; return; }
  if (order.type === "construct") {
    if (target.kind !== "building" || target.complete) { unit.order = { type: "idle" }; return; }
    if (!isEntityInteractionCell(unit.position, target)) { moveTowardEntity(state, unit, target); return; }
    target.constructionRemainingTicks = Math.max(0, target.constructionRemainingTicks - 1);
    target.hitPoints = Math.max(1, Math.floor(target.maxHitPoints * (1 - target.constructionRemainingTicks / BUILDINGS[target.typeId].buildTicks)));
    target.stateRevision += 1;
    if (target.constructionRemainingTicks === 0) {
      target.complete = true;
      target.hitPoints = target.maxHitPoints;
      unit.order = { type: "idle" };
    }
    return;
  }
  const stats = UNITS[unit.typeId];
  if (distanceSquaredToEntity(unit.position, target) > stats.attackRange * stats.attackRange) { moveToward(state, unit, closestApproachableEntityCell(state, unit.position, target)); return; }
  if (unit.attackCooldownTicks === 0) {
    target.hitPoints = Math.max(0, target.hitPoints - damageAfterVillageTrait(state, target, stats.attackDamage));
    target.stateRevision += 1;
    unit.attackCooldownTicks = stats.attackCooldownTicks;
  }
}

function updateGatherOrder(
  state: MatchState,
  unit: UnitEntityState,
  order: Extract<UnitOrder, { type: "gather" }>,
  events: DomainEvent[],
): void {
  const capacity = UNITS[unit.typeId].carryCapacity;
  if (capacity <= 0) { unit.order = { type: "idle" }; return; }

  if (order.phase === "toDropOff") {
    if (unit.cargo.kind === null || unit.cargo.amount <= 0) {
      unit.cargo = { kind: null, amount: 0 };
      order.phase = "toSource";
      order.dropOffId = null;
      unit.stateRevision += 1;
      return;
    }
    const assigned = order.dropOffId
      ? state.entities.find((entity): entity is BuildingEntityState => entity.id === order.dropOffId && entity.kind === "building")
      : undefined;
    const dropOff = assigned
      && assigned.ownerId === unit.ownerId
      && assigned.complete
      && assigned.hitPoints > 0
      && buildingAcceptsResource(assigned, unit.cargo.kind)
      ? assigned
      : findNearestDropOff(state, unit.ownerId, unit.cargo.kind, unit.position);
    if (!dropOff) {
      if (order.dropOffId !== null) {
        order.dropOffId = null;
        unit.stateRevision += 1;
      }
      return;
    }
    if (order.dropOffId !== dropOff.id) {
      order.dropOffId = dropOff.id;
      unit.stateRevision += 1;
    }
    if (!isEntityInteractionCell(unit.position, dropOff)) {
      if (moveTowardEntity(state, unit, dropOff) === "blocked") {
        const alternative = findNearestDropOff(state, unit.ownerId, unit.cargo.kind, unit.position);
        const nextId = alternative?.id ?? null;
        if (order.dropOffId !== nextId) {
          order.dropOffId = nextId;
          unit.stateRevision += 1;
        }
      }
      return;
    }
    depositCargo(state, unit, dropOff, events);
    const source = findUsableGatherSource(state, unit.ownerId, order.targetId, order.resourceKind)
      ?? findNearestGatherSource(state, unit.ownerId, order.resourceKind, unit.position);
    if (!source) { unit.order = { type: "idle" }; return; }
    order.targetId = source.id;
    order.phase = "toSource";
    order.dropOffId = null;
    unit.stateRevision += 1;
    return;
  }

  if (unit.cargo.amount > 0 && (unit.cargo.kind !== order.resourceKind || unit.cargo.amount >= capacity)) {
    order.phase = "toDropOff";
    order.dropOffId = findNearestDropOff(state, unit.ownerId, unit.cargo.kind!, unit.position)?.id ?? null;
    unit.stateRevision += 1;
    return;
  }
  const source = findUsableGatherSource(state, unit.ownerId, order.targetId, order.resourceKind)
    ?? findNearestGatherSource(state, unit.ownerId, order.resourceKind, unit.position);
  if (!source) {
    if (unit.cargo.amount > 0 && unit.cargo.kind) {
      order.phase = "toDropOff";
      order.dropOffId = findNearestDropOff(state, unit.ownerId, unit.cargo.kind, unit.position)?.id ?? null;
      unit.stateRevision += 1;
    } else {
      unit.order = { type: "idle" };
    }
    return;
  }
  if (order.targetId !== source.id) {
    order.targetId = source.id;
    unit.stateRevision += 1;
  }
  if (gatherSourceAmount(source) <= 0) return;
  if (!isEntityInteractionCell(unit.position, source)) {
    if (moveTowardEntity(state, unit, source) === "blocked") {
      const alternative = findNearestGatherSource(state, unit.ownerId, order.resourceKind, unit.position);
      if (alternative && alternative.id !== order.targetId) {
        order.targetId = alternative.id;
        unit.stateRevision += 1;
      }
    }
    return;
  }
  if (unit.workCooldownTicks > 0) return;
  const remainingCapacity = Math.max(0, capacity - unit.cargo.amount);
  const amount = Math.min(gatherSourceAmount(source), gatherYield(state, unit, order.resourceKind), remainingCapacity);
  if (amount <= 0) return;
  unit.cargo = { kind: order.resourceKind, amount: unit.cargo.amount + amount };
  unit.stateRevision += 1;
  takeFromGatherSource(state, source, amount, events);
  unit.workCooldownTicks = TICKS_PER_SECOND;
  if (unit.cargo.amount >= capacity || gatherSourceAmount(source) <= 0) {
    order.phase = "toDropOff";
    order.dropOffId = findNearestDropOff(state, unit.ownerId, order.resourceKind, unit.position)?.id ?? null;
    unit.stateRevision += 1;
  }
}

function updateDeliveryOrder(state: MatchState, unit: UnitEntityState, targetId: EntityId, events: DomainEvent[]): void {
  if (unit.cargo.kind === null || unit.cargo.amount <= 0) {
    unit.cargo = { kind: null, amount: 0 };
    unit.order = { type: "idle" };
    return;
  }
  const assigned = state.entities.find((entity): entity is BuildingEntityState => entity.id === targetId && entity.kind === "building");
  const dropOff = assigned
    && assigned.ownerId === unit.ownerId
    && assigned.complete
    && assigned.hitPoints > 0
    && buildingAcceptsResource(assigned, unit.cargo.kind)
    ? assigned
    : findNearestDropOff(state, unit.ownerId, unit.cargo.kind, unit.position);
  if (!dropOff) return;
  if (dropOff.id !== targetId) {
    unit.order = { type: "deliver", targetId: dropOff.id };
    unit.stateRevision += 1;
  }
  if (!isEntityInteractionCell(unit.position, dropOff)) {
    if (moveTowardEntity(state, unit, dropOff) === "blocked") {
      const alternative = findNearestDropOff(state, unit.ownerId, unit.cargo.kind, unit.position);
      if (alternative && alternative.id !== targetId) {
        unit.order = { type: "deliver", targetId: alternative.id };
        unit.stateRevision += 1;
      }
    }
    return;
  }
  depositCargo(state, unit, dropOff, events);
  unit.order = { type: "idle" };
}

function depositCargo(state: MatchState, unit: UnitEntityState, dropOff: BuildingEntityState, events: DomainEvent[]): void {
  const resourceKind = unit.cargo.kind;
  const amount = unit.cargo.amount;
  if (!resourceKind || amount <= 0) return;
  const player = state.players.find((candidate) => candidate.id === unit.ownerId)!;
  player.resources = { ...player.resources, [resourceKind]: player.resources[resourceKind] + amount };
  unit.cargo = { kind: null, amount: 0 };
  unit.stateRevision += 1;
  events.push({ type: "resourcesDeposited", playerId: player.id, unitId: unit.id, dropOffId: dropOff.id, resourceKind, amount });
}

function findUsableGatherSource(state: MatchState, playerId: PlayerId, targetId: EntityId, resourceKind: ResourceKind): EntityState | null {
  const source = state.entities.find((entity) => entity.id === targetId);
  return source
    && gatherSourceKind(source) === resourceKind
    && isEntityVisibleToPlayer(state, playerId, source)
    ? source
    : null;
}

function findNearestGatherSource(state: MatchState, playerId: PlayerId, resourceKind: ResourceKind, position: GridPoint): EntityState | null {
  return state.entities
    .filter((entity) => (
      gatherSourceKind(entity) === resourceKind
      && (gatherSourceAmount(entity) > 0 || (entity.kind === "resource" && entity.renewAtTick !== null))
      && isEntityVisibleToPlayer(state, playerId, entity)
    ))
    .map((entity) => ({ entity, route: findEntityApproachRoute(state, position, entity) }))
    .filter((candidate): candidate is { entity: EntityState; route: EntityApproachRoute } => candidate.route !== null)
    .sort((left, right) => (
      Number(gatherSourceAmount(right.entity) > 0) - Number(gatherSourceAmount(left.entity) > 0)
      || left.route.distance - right.route.distance
      || left.entity.id.localeCompare(right.entity.id)
    ))[0]?.entity ?? null;
}

function findNearestDropOff(state: MatchState, playerId: PlayerId, resourceKind: ResourceKind, position: GridPoint): BuildingEntityState | null {
  return state.entities
    .filter((entity): entity is BuildingEntityState => (
      entity.kind === "building"
      && entity.ownerId === playerId
      && entity.complete
      && entity.hitPoints > 0
      && buildingAcceptsResource(entity, resourceKind)
    ))
    .map((entity) => ({ entity, route: findEntityApproachRoute(state, position, entity) }))
    .filter((candidate): candidate is { entity: BuildingEntityState; route: EntityApproachRoute } => candidate.route !== null)
    .sort((left, right) => left.route.distance - right.route.distance || left.entity.id.localeCompare(right.entity.id))[0]?.entity ?? null;
}

function buildingAcceptsResource(building: BuildingEntityState, resourceKind: ResourceKind): boolean {
  return BUILDINGS[building.typeId].dropOffResources?.includes(resourceKind) ?? false;
}

function gatherSourceKind(entity: EntityState): ResourceKind | null {
  if (entity.kind === "resource") return entity.typeId;
  return null;
}

function gatherSourceAmount(entity: EntityState): number {
  if (entity.kind === "resource") return entity.amount;
  return 0;
}

function takeFromGatherSource(state: MatchState, entity: EntityState, amount: number, events: DomainEvent[]): void {
  if (entity.kind !== "resource") return;
  entity.amount = Math.max(0, entity.amount - amount);
  entity.hitPoints = entity.amount;
  entity.stateRevision += 1;
  if (entity.amount > 0) return;
  const renewAfterTicks = RESOURCE_NODES[entity.typeId].renewAfterTicks;
  entity.renewAtTick = renewAfterTicks === null ? null : state.tick + renewAfterTicks;
  events.push({
    type: "resourceDepleted",
    resourceId: entity.id,
    resourceKind: entity.typeId,
    renewable: renewAfterTicks !== null,
    renewAtTick: entity.renewAtTick,
  });
}

function updateRenewableResourceNode(state: MatchState, resource: ResourceEntityState, events: DomainEvent[]): void {
  if (resource.renewAtTick === null || state.tick < resource.renewAtTick) return;
  const definition = RESOURCE_NODES[resource.typeId];
  resource.amount = definition.maxAmount;
  resource.hitPoints = definition.maxAmount;
  resource.renewAtTick = null;
  resource.stateRevision += 1;
  events.push({ type: "resourceRenewed", resourceId: resource.id, resourceKind: resource.typeId, amount: resource.amount });
}

function gatherYield(state: MatchState, unit: UnitEntityState, resourceKind: ResourceKind): number {
  const base = UNITS[unit.typeId].gatherPerSecond[resourceKind];
  const player = state.players.find((candidate) => candidate.id === unit.ownerId);
  const trait = player ? getVillage(player.villageId)?.trait : undefined;
  const multiplierPermille = trait?.metric === "gatherRate" ? trait.multiplierPermille : 1_000;
  const accumulatedMilli = unit.gatherRemainderMilli[resourceKind] + base * multiplierPermille;
  const gathered = Math.floor(accumulatedMilli / 1_000);
  unit.gatherRemainderMilli = {
    ...unit.gatherRemainderMilli,
    [resourceKind]: accumulatedMilli % 1_000,
  };
  return gathered;
}

function updateTraining(state: MatchState, building: BuildingEntityState, events: DomainEvent[]): void {
  if (!building.complete || building.trainingQueue.length === 0) return;
  const job = building.trainingQueue[0]!;
  job.remainingTicks -= 1;
  if (job.remainingTicks > 0) return;
  const spawn = buildingSpawnPoint(building, state);
  if (!spawn) return;
  building.trainingQueue.shift();
  const unit = createUnit(state, building.ownerId, job.unitType, spawn);
  state.entities.push(unit);
  building.stateRevision += 1;
  events.push({ type: "entitySpawned", entity: toPublicEntity(unit) });
}

function updateTower(state: MatchState, building: BuildingEntityState): void {
  if (!building.complete || building.attackCooldownTicks > 0) return;
  const stats = BUILDINGS[building.typeId];
  if (stats.attackDamage <= 0) return;
  const enemies = state.entities
    .filter((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId !== building.ownerId && distanceSquared(entity.position, building.position) <= stats.attackRange * stats.attackRange)
    .sort((left, right) => distanceSquared(left.position, building.position) - distanceSquared(right.position, building.position) || left.id.localeCompare(right.id));
  const target = enemies[0];
  if (!target) return;
  target.hitPoints = Math.max(0, target.hitPoints - stats.attackDamage);
  target.stateRevision += 1;
  building.attackCooldownTicks = stats.attackCooldownTicks;
}

function evaluateVictory(state: MatchState, events: DomainEvent[]): void {
  if (state.phase !== "playing") return;
  const teams = [...new Set(state.players.map((player) => player.teamId))].sort();
  for (const teamId of teams) {
    const members = state.players.filter((player) => player.teamId === teamId);
    if (members.every((player) => player.surrendered)) {
      for (const member of members) member.eliminated = true;
      continue;
    }
    const hasTownCenter = state.entities.some((entity) => entity.kind === "building" && entity.typeId === "townCenter" && entity.hitPoints > 0 && members.some((member) => member.id === entity.ownerId));
    const timerIndex = state.teamTownCenterLostAt.findIndex((timer) => timer.teamId === teamId);
    if (hasTownCenter) {
      if (timerIndex >= 0) state.teamTownCenterLostAt.splice(timerIndex, 1);
    } else if (timerIndex < 0) {
      state.teamTownCenterLostAt.push({ teamId, tick: state.tick });
    } else if (state.tick - state.teamTownCenterLostAt[timerIndex]!.tick >= TOWN_CENTER_REBUILD_GRACE_TICKS) {
      for (const member of members) member.eliminated = true;
    }
  }
  const activeTeams = teams.filter((teamId) => state.players.some((player) => player.teamId === teamId && !player.eliminated));
  if (teams.length > 1 && activeTeams.length <= 1) {
    state.phase = "finished";
    state.winningTeamIds = activeTeams;
    state.finishReason = state.players.some((player) => player.surrendered) ? "surrender" : "conquest";
    events.push({ type: "matchFinished", winningTeamIds: activeTeams, reason: state.finishReason });
  }
}

function moveToward(state: MatchState, unit: UnitEntityState, target: GridPoint): boolean {
  if (samePoint(unit.position, target)) return true;
  const player = state.players.find((candidate) => candidate.id === unit.ownerId);
  const trait = player ? getVillage(player.villageId)?.trait : undefined;
  const speed = UNITS[unit.typeId].speedMilliTilesPerSecond * (trait?.metric === "unitSpeed" ? trait.multiplierPermille / 1000 : 1);
  unit.movementProgress += speed;
  if (unit.movementProgress < 1000 * TICKS_PER_SECOND) return false;
  unit.movementProgress -= 1000 * TICKS_PER_SECOND;
  const next = findNextPathStep(unit.position, target, state.map.width, state.map.height, getPathBlockedCells(state));
  if (!next) { unit.order = { type: "idle" }; return true; }
  if (samePoint(next, unit.position)) return true;
  unit.position = next;
  unit.stateRevision += 1;
  return samePoint(next, target);
}

type EntityMovementResult = "arrived" | "moving" | "blocked";

function moveTowardEntity(state: MatchState, unit: UnitEntityState, entity: EntityState): EntityMovementResult {
  if (isEntityInteractionCell(unit.position, entity)) return "arrived";
  const player = state.players.find((candidate) => candidate.id === unit.ownerId);
  const trait = player ? getVillage(player.villageId)?.trait : undefined;
  const speed = UNITS[unit.typeId].speedMilliTilesPerSecond * (trait?.metric === "unitSpeed" ? trait.multiplierPermille / 1000 : 1);
  const stepCost = 1000 * TICKS_PER_SECOND;
  unit.movementProgress += speed;
  if (unit.movementProgress < stepCost) return "moving";
  const route = findEntityApproachRoute(state, unit.position, entity);
  if (!route) {
    unit.movementProgress = stepCost;
    return "blocked";
  }
  unit.movementProgress -= stepCost;
  if (samePoint(route.firstStep, unit.position)) return "arrived";
  unit.position = route.firstStep;
  unit.stateRevision += 1;
  return isEntityInteractionCell(unit.position, entity) ? "arrived" : "moving";
}

function damageAfterVillageTrait(state: MatchState, target: EntityState, damage: number): number {
  if (target.kind !== "building" || target.typeId !== "defenseTower") return damage;
  const player = state.players.find((candidate) => candidate.id === target.ownerId);
  const trait = player ? getVillage(player.villageId)?.trait : undefined;
  return trait?.metric === "towerArmor" ? damage * 1000 / trait.multiplierPermille : damage;
}

function createUnit(state: MatchState, ownerId: PlayerId, typeId: UnitType, position: GridPoint): UnitEntityState {
  const definition = UNITS[typeId];
  return { id: nextId(state, "unit"), ownerId, kind: "unit", typeId, position, hitPoints: definition.maxHitPoints, maxHitPoints: definition.maxHitPoints, stateRevision: 0, order: { type: "idle" }, movementProgress: 0, attackCooldownTicks: 0, workCooldownTicks: 0, cargo: { kind: null, amount: 0 }, gatherRemainderMilli: { food: 0, wood: 0, stone: 0 } };
}

function createBuilding(state: MatchState, ownerId: PlayerId, typeId: BuildingType, position: GridPoint, complete: boolean): BuildingEntityState {
  const definition = BUILDINGS[typeId];
  return {
    id: nextId(state, "building"),
    ownerId,
    kind: "building",
    typeId,
    position,
    hitPoints: complete ? definition.maxHitPoints : 1,
    maxHitPoints: definition.maxHitPoints,
    stateRevision: 0,
    complete,
    constructionRemainingTicks: complete ? 0 : definition.buildTicks,
    attackCooldownTicks: 0,
    trainingQueue: [],
  };
}

function createResource(state: MatchState, typeId: ResourceKind, position: GridPoint): ResourceEntityState {
  const amount = RESOURCE_NODES[typeId].maxAmount;
  return { id: nextId(state, "resource"), ownerId: null, kind: "resource", typeId, position, hitPoints: amount, maxHitPoints: amount, stateRevision: 0, amount, renewAtTick: null };
}

function nextId(state: MatchState, prefix: string): EntityId {
  const id = `${prefix}-${state.nextEntityNumber}`;
  state.nextEntityNumber += 1;
  return id;
}

function setOrders(state: MatchState, ids: readonly EntityId[], order: UnitOrder): void {
  for (const id of ids) {
    const unit = state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
    unit.order = cloneOrder(order);
    unit.stateRevision += 1;
  }
}

function cloneOrder(order: UnitOrder): UnitOrder {
  return JSON.parse(JSON.stringify(order)) as UnitOrder;
}

function ownedUnits(state: MatchState, ownerId: PlayerId, ids: readonly EntityId[]): UnitEntityState[] | null {
  if (new Set(ids).size !== ids.length) return null;
  const units: UnitEntityState[] = [];
  for (const id of ids) {
    const entity = state.entities.find((candidate) => candidate.id === id);
    if (!entity || entity.kind !== "unit" || entity.ownerId !== ownerId) return null;
    units.push(entity);
  }
  return units;
}

function hasCompletedPrerequisites(state: MatchState, playerId: PlayerId, prerequisites: readonly BuildingType[]): boolean {
  return prerequisites.every((buildingType) => state.entities.some((entity) => (
    entity.kind === "building"
    && entity.ownerId === playerId
    && entity.typeId === buildingType
    && entity.complete
    && entity.hitPoints > 0
  )));
}

function meetsTier(currentTier: SettlementTier, requiredTier: SettlementTier): boolean {
  return SETTLEMENT_TIER_ORDER.indexOf(currentTier) >= SETTLEMENT_TIER_ORDER.indexOf(requiredTier);
}

function updateSettlementAdvancements(state: MatchState, events: DomainEvent[]): void {
  for (const player of state.players) {
    const advancement = player.advancement;
    if (!advancement) continue;
    const producer = state.entities.find((entity): entity is BuildingEntityState => (
      entity.id === advancement.producerId
      && entity.kind === "building"
      && entity.ownerId === player.id
      && entity.typeId === "townCenter"
      && entity.complete
      && entity.hitPoints > 0
    ));
    if (!producer) {
      player.advancement = null;
      continue;
    }
    advancement.remainingTicks = Math.max(0, advancement.remainingTicks - 1);
    if (advancement.remainingTicks > 0) continue;
    player.settlementTier = advancement.targetTier;
    player.advancement = null;
    producer.stateRevision += 1;
    events.push({
      type: "settlementAdvanced",
      playerId: player.id,
      producerId: producer.id,
      settlementTier: player.settlementTier,
    });
  }
}

function syncPopulation(state: MatchState): void {
  for (const player of state.players) {
    player.population = {
      used: usedPopulation(state, player.id) + queuedPopulation(state, player.id),
      capacity: state.entities.reduce((sum, entity) => sum + (entity.kind === "building" && entity.ownerId === player.id && entity.complete ? BUILDINGS[entity.typeId].populationCapacity : 0), 0),
    };
  }
}

function countUnits(state: MatchState, playerId: PlayerId): number {
  return state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === playerId).length;
}

function usedPopulation(state: MatchState, playerId: PlayerId): number {
  return state.entities.reduce((sum, entity) => (
    entity.kind === "unit" && entity.ownerId === playerId
      ? sum + UNITS[entity.typeId].population
      : sum
  ), 0);
}

function queuedPopulation(state: MatchState, playerId: PlayerId): number {
  return state.entities.reduce((sum, entity) => sum + (entity.kind === "building" && entity.ownerId === playerId ? entity.trainingQueue.reduce((jobs, job) => jobs + UNITS[job.unitType].population, 0) : 0), 0);
}

function canAfford(wallet: ResourceWallet, cost: ResourceWallet): boolean {
  return wallet.food >= cost.food && wallet.wood >= cost.wood && wallet.stone >= cost.stone;
}

function subtractWallet(player: PlayerState, cost: ResourceWallet): void {
  player.resources = { food: player.resources.food - cost.food, wood: player.resources.wood - cost.wood, stone: player.resources.stone - cost.stone };
}

function multiplyWallet(wallet: ResourceWallet, count: number): ResourceWallet {
  return { food: wallet.food * count, wood: wallet.wood * count, stone: wallet.stone * count };
}

function rejected(code: CommandRejectCode): CommandValidation {
  return { ok: false, code };
}

function isPointInBounds(point: GridPoint, state: MatchState): boolean {
  return Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < state.map.width && point.y < state.map.height;
}

function clampPoint(point: GridPoint, state: MatchState): GridPoint {
  return { x: Math.max(0, Math.min(state.map.width - 1, point.x)), y: Math.max(0, Math.min(state.map.height - 1, point.y)) };
}

function clampBuildingOrigin(point: GridPoint, type: BuildingType, state: MatchState): GridPoint {
  const footprint = BUILDINGS[type].footprint;
  const maxOffsetX = Math.max(...footprint.map((cell) => cell.x));
  const maxOffsetY = Math.max(...footprint.map((cell) => cell.y));
  return {
    x: Math.max(0, Math.min(state.map.width - 1 - maxOffsetX, point.x)),
    y: Math.max(0, Math.min(state.map.height - 1 - maxOffsetY, point.y)),
  };
}

function buildingSpawnPoint(building: BuildingEntityState, state: MatchState): GridPoint | null {
  const cells = getEntityFootprintCells(building);
  const footprint = new Set(cells.map(pointKey));
  const occupied = new Set(state.entities.flatMap((entity) => getEntityFootprintCells(entity)).map(pointKey));
  const candidates: GridPoint[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const offset of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
      const candidate = { x: cell.x + offset.x, y: cell.y + offset.y };
      const key = pointKey(candidate);
      if (seen.has(key) || footprint.has(key)) continue;
      seen.add(key);
      if (isPointInBounds(candidate, state) && isMapCellWalkable(state, candidate) && !occupied.has(key)) candidates.push(candidate);
    }
  }
  return candidates[0] ?? null;
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function distanceSquared(left: GridPoint, right: GridPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function distanceSquaredToEntity(point: GridPoint, entity: EntityState): number {
  return Math.min(...getEntityFootprintCells(entity).map((cell) => distanceSquared(point, cell)));
}

interface EntityApproachRoute {
  readonly target: GridPoint;
  readonly firstStep: GridPoint;
  readonly distance: number;
}

function isEntityInteractionCell(point: GridPoint, entity: EntityState): boolean {
  return getEntityFootprintCells(entity).some((cell) => Math.abs(point.x - cell.x) + Math.abs(point.y - cell.y) === 1);
}

function findEntityApproachRoute(state: MatchState, start: GridPoint, entity: EntityState): EntityApproachRoute | null {
  if (isEntityInteractionCell(start, entity)) return { target: { ...start }, firstStep: { ...start }, distance: 0 };
  const footprint = entity.kind === "building" ? BUILDINGS[entity.typeId].footprint : [{ x: 0, y: 0 }];
  const blockedCells = getPathBlockedCells(state);
  const blocked = new Set(blockedCells.map(pointKey));
  const targets = getFootprintPerimeterCells(entity.position, footprint)
    .filter((target) => isPointInBounds(target, state) && isMapCellWalkable(state, target) && !blocked.has(pointKey(target)));
  return findPathToAny(start, targets, state.map.width, state.map.height, blockedCells);
}

function closestApproachableEntityCell(state: MatchState, point: GridPoint, entity: EntityState): GridPoint {
  const blocked = new Set(getPathBlockedCells(state).map(pointKey));
  const approachable = getEntityFootprintCells(entity).filter((cell) => (
    [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }].some((offset) => {
      const neighbor = { x: cell.x + offset.x, y: cell.y + offset.y };
      return isPointInBounds(neighbor, state) && !blocked.has(pointKey(neighbor));
    })
  ));
  const candidates = approachable.length > 0 ? approachable : getEntityFootprintCells(entity);
  return [...candidates].sort((left, right) => (
    distanceSquared(point, left) - distanceSquared(point, right)
    || left.y - right.y
    || left.x - right.x
  ))[0]!;
}

function isEntityReachable(state: MatchState, start: GridPoint, entity: EntityState): boolean {
  return findEntityApproachRoute(state, start, entity) !== null;
}

function isMapCellBlocked(state: MatchState, point: GridPoint): boolean {
  const key = pointKey(point);
  return getOccupiedMapCells(state).some((cell) => pointKey(cell) === key);
}

function isMapCellWalkable(state: MatchState, point: GridPoint): boolean {
  return state.map.id !== VILLAGE_ASSAULT_MAP_ID || isVillageAssaultWalkableCell(point);
}

function getPathBlockedCells(state: MatchState): readonly GridPoint[] {
  return state.map.id === VILLAGE_ASSAULT_MAP_ID
    ? [...getOccupiedMapCells(state), ...getVillageAssaultWalkBlockedCells()]
    : getOccupiedMapCells(state);
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
