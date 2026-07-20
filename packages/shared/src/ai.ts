import { BUILDINGS, MAX_TRAINING_QUEUE_DEPTH, SETTLEMENT_TIERS, UNITS } from "./content.js";
import { getVillageAssaultBuildBlockedCells, getVillageAssaultWalkBlockedCells, VILLAGE_ASSAULT_MAP_ID } from "./battlefield.js";
import { nextUint32, normalizeSeed } from "./random.js";
import { isEntityVisibleToPlayer, toPublicEntity, type BuildingEntityState, type MatchState } from "./simulation.js";
import { getFootprintCells, getFootprintPerimeterCells, validateFootprintPlacement } from "./spatial.js";
import type {
  AiDifficulty,
  AiPersonality,
  BuildingType,
  EntityId,
  GameCommand,
  GridPoint,
  PlayerId,
  PublicEntityState,
  ResourceKind,
  ResourceWallet,
  SettlementTier,
  UnitType,
} from "./protocol.js";

export interface RememberedEnemySite {
  readonly entityId: EntityId;
  readonly typeId?: string;
  readonly lastKnownPosition: GridPoint;
  readonly observedAtTick: number;
}

export interface AiObservation {
  readonly serverTick: number;
  readonly selfPlayerId: PlayerId;
  readonly wallet: ResourceWallet;
  readonly population: { readonly used: number; readonly capacity: number };
  readonly settlementTier: SettlementTier;
  readonly advancement: {
    readonly producerId: EntityId;
    readonly targetTier: SettlementTier;
    readonly remainingTicks: number;
  } | null;
  readonly map: { readonly id: "open" | typeof VILLAGE_ASSAULT_MAP_ID; readonly width: number; readonly height: number };
  readonly ownEntities: readonly PublicEntityState[];
  readonly ownTrainingQueueDepth: Readonly<Record<EntityId, number>>;
  readonly ownIncompleteBuildingIds: readonly EntityId[];
  readonly visibleEnemyEntities: readonly PublicEntityState[];
  readonly visibleResourceEntities: readonly PublicEntityState[];
  readonly rememberedEnemySites: readonly RememberedEnemySite[];
}

export interface AiController {
  readonly personality: AiPersonality;
  readonly playerId: PlayerId;
  readonly difficulty: AiDifficulty;
  decide(observation: AiObservation, budgetMs: number): readonly GameCommand[];
}

export interface AiProfile {
  readonly id: AiPersonality;
  readonly economyWeight: number;
  readonly defenseWeight: number;
  readonly aggressionWeight: number;
  readonly mobilityWeight: number;
  readonly preferredUnits: readonly UnitType[];
  readonly preferredBuildings: readonly BuildingType[];
  readonly targetPriority: readonly ("townCenter" | "military" | "economy" | "villager")[];
  readonly advanceAfterTick: Readonly<Record<Exclude<SettlementTier, "frontier">, number>>;
}

export const AI_PROFILES: Readonly<Record<AiPersonality, AiProfile>> = {
  aggressor: { id: "aggressor", economyWeight: 15, defenseWeight: 10, aggressionWeight: 60, mobilityWeight: 15, preferredUnits: ["militia", "spearman", "batteringRam"], preferredBuildings: ["barracks", "siegeWorkshop", "house"], targetPriority: ["townCenter", "military", "villager", "economy"], advanceAfterTick: { stronghold: 260, artificer: 11_000 } },
  guardian: { id: "guardian", economyWeight: 20, defenseWeight: 55, aggressionWeight: 10, mobilityWeight: 15, preferredUnits: ["spearman", "archer", "militia"], preferredBuildings: ["defenseTower", "barracks", "archeryRange", "house"], targetPriority: ["military", "townCenter", "villager", "economy"], advanceAfterTick: { stronghold: 420, artificer: 14_000 } },
  prosperer: { id: "prosperer", economyWeight: 60, defenseWeight: 15, aggressionWeight: 15, mobilityWeight: 10, preferredUnits: ["villager", "archer", "batteringRam"], preferredBuildings: ["lumberCamp", "farmstead", "archeryRange", "siegeWorkshop", "house"], targetPriority: ["economy", "townCenter", "military", "villager"], advanceAfterTick: { stronghold: 520, artificer: 13_000 } },
  balanced: { id: "balanced", economyWeight: 30, defenseWeight: 25, aggressionWeight: 25, mobilityWeight: 20, preferredUnits: ["spearman", "archer", "mage", "musketeer"], preferredBuildings: ["house", "barracks", "archeryRange", "mageSanctum", "gunWorkshop", "defenseTower"], targetPriority: ["military", "economy", "townCenter", "villager"], advanceAfterTick: { stronghold: 360, artificer: 12_000 } },
  raider: { id: "raider", economyWeight: 15, defenseWeight: 10, aggressionWeight: 35, mobilityWeight: 40, preferredUnits: ["scout", "archer", "militia"], preferredBuildings: ["beastStable", "archeryRange", "barracks", "house"], targetPriority: ["villager", "economy", "military", "townCenter"], advanceAfterTick: { stronghold: 220, artificer: 10_500 } },
};

const DIFFICULTY_INTERVAL: Readonly<Record<AiDifficulty, number>> = { novice: 40, standard: 20, veteran: 10 };

export function createAiController(personality: AiPersonality, playerId: PlayerId, seed: number, difficulty: AiDifficulty = "standard"): AiController {
  const profile = AI_PROFILES[personality];
  let randomState = normalizeSeed(seed ^ hashText(personality) ^ hashText(playerId));
  let lastDecisionTick = -DIFFICULTY_INTERVAL[difficulty];

  return {
    personality,
    playerId,
    difficulty,
    decide(observation, budgetMs) {
      if (observation.selfPlayerId !== playerId || !Number.isFinite(budgetMs) || budgetMs <= 0) return [];
      if (observation.serverTick - lastDecisionTick < DIFFICULTY_INTERVAL[difficulty]) return [];
      lastDecisionTick = observation.serverTick;
      const step = nextUint32(randomState);
      randomState = step.state;
      const command = decideForProfile(profile, observation, step.value);
      return command ? [command] : [];
    },
  };
}

export function getAiObservation(state: MatchState, playerId: PlayerId, rememberedEnemySites: readonly RememberedEnemySite[] = []): AiObservation {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown AI player: ${playerId}`);
  const ownEntities = sortPublicEntities(state.entities.filter((entity) => entity.ownerId === playerId).map(toPublicEntity));
  const visible = state.entities.filter((entity) => entity.ownerId !== playerId && isEntityVisibleToPlayer(state, playerId, entity));
  return {
    serverTick: state.tick,
    selfPlayerId: playerId,
    wallet: { ...player.resources },
    population: { ...player.population },
    settlementTier: player.settlementTier,
    advancement: player.advancement ? { ...player.advancement } : null,
    map: { ...state.map },
    ownEntities,
    ownTrainingQueueDepth: Object.fromEntries(
      state.entities
        .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === playerId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((building) => [building.id, building.trainingQueue.length]),
    ),
    ownIncompleteBuildingIds: state.entities
      .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === playerId && !entity.complete)
      .map((building) => building.id)
      .sort((left, right) => left.localeCompare(right)),
    visibleEnemyEntities: sortPublicEntities(visible.filter((entity) => entity.ownerId !== null).map(toPublicEntity)),
    visibleResourceEntities: sortPublicEntities(visible.filter((entity) => entity.kind === "resource").map(toPublicEntity)),
    rememberedEnemySites: sanitizeRememberedEnemySites(rememberedEnemySites, state.tick, state.map),
  };
}

function decideForProfile(profile: AiProfile, observation: AiObservation, randomValue: number): GameCommand | null {
  const ownUnits = observation.ownEntities.filter((entity) => entity.kind === "unit");
  const villagers = ownUnits.filter((entity) => entity.typeId === "villager");
  const military = ownUnits.filter((entity) => entity.typeId !== "villager");
  const incompleteIds = new Set(observation.ownIncompleteBuildingIds);
  const townCenterSite = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter");
  const townCenter = townCenterSite && !incompleteIds.has(townCenterSite.id) ? townCenterSite : undefined;
  const incompleteBuilding = incompleteIds.size > 0;
  const visibleTarget = chooseTarget(profile, observation.visibleEnemyEntities, randomValue);

  if (observation.advancement) {
    return advancementSupportCommand(observation, villagers, incompleteBuilding, randomValue);
  }
  const progression = settlementProgressionCommand(profile, observation, villagers, randomValue);
  if (progression) return progression;

  switch (profile.id) {
    case "aggressor":
      if (visibleTarget && military.length >= 2) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id };
      if (military.length >= 3) return advanceTowardEnemy(observation, military);
      if (incompleteBuilding) return null;
      return productionCommand(profile, observation, villagers, "militia", 1, randomValue);
    case "guardian": {
      const home = townCenter?.position;
      const closeEnemy = home && [...observation.visibleEnemyEntities]
        .filter((enemy) => distanceSquared(home, enemy.position) <= 64)
        .sort((left, right) => distanceSquared(home, left.position) - distanceSquared(home, right.position) || left.id.localeCompare(right.id))[0];
      if (closeEnemy && military.length > 0) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: closeEnemy.id };
      if (incompleteBuilding) return null;
      if (!observation.ownEntities.some((entity) => entity.kind === "building" && entity.typeId === "defenseTower")) {
        return affordableBuild(observation, villagers, "defenseTower", 2) ?? economyCommand(observation, villagers, randomValue);
      }
      if (military.length >= 3) return visibleTarget
        ? { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id }
        : defensivePatrol(observation, military, home ?? military[0]!.position);
      return productionCommand(profile, observation, villagers, "spearman", 1, randomValue);
    }
    case "prosperer":
      if (townCenter && villagers.length < 5 && observation.population.used + 1 <= observation.population.capacity) {
        const train = affordableTrain(observation, townCenter.id, "villager");
        if (train) return train;
        return economyCommand(observation, villagers, randomValue);
      }
      if (incompleteBuilding) return null;
      if (military.length < 3) return productionCommand(profile, observation, villagers, "archer", 1, randomValue);
      if (military.length >= 3) return visibleTarget
        ? { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id }
        : advanceTowardEnemy(observation, military);
      return economyCommand(observation, villagers, randomValue) ?? affordableBuild(observation, villagers, "lumberCamp", 2);
    case "balanced":
      if (visibleTarget && military.length >= 3) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id };
      if (military.length >= 3) return advanceTowardEnemy(observation, military);
      if (incompleteBuilding) return null;
      if (observation.serverTick === 0) return economyCommand(observation, villagers, randomValue);
      const availableBalancedUnits = (["spearman", "archer", "mage", "musketeer"] as const)
        .filter((unitType) => tierReached(observation.settlementTier, UNITS[unitType].requiredTier));
      return productionCommand(
        profile,
        observation,
        villagers,
        availableBalancedUnits[military.length % availableBalancedUnits.length]!,
        1,
        randomValue,
      );
    case "raider":
      if (visibleTarget && military.length > 0) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id };
      if (military.length >= 2) return advanceTowardEnemy(observation, military);
      if (incompleteBuilding) return null;
      if (military.length > 0) return flankPatrol(observation, military[0]!, randomValue);
      return productionCommand(profile, observation, villagers, "scout", -1, randomValue);
  }
}

function defensivePatrol(observation: AiObservation, military: readonly PublicEntityState[], home: GridPoint): GameCommand {
  const first = nearestOpenWaypoint(observation, { x: home.x - 3, y: home.y - 2 }) ?? military[0]!.position;
  const second = nearestOpenWaypoint(observation, { x: home.x + 3, y: home.y + 2 }) ?? military[0]!.position;
  return {
    type: "patrol",
    entityIds: military.map((unit) => unit.id),
    waypoints: [first, second],
  };
}

function advanceTowardEnemy(observation: AiObservation, military: readonly PublicEntityState[]): GameCommand {
  const home = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? military[0]!.position;
  const desired = {
    x: home.x < observation.map.width / 2 ? Math.floor(observation.map.width * 2 / 3) : Math.floor(observation.map.width / 3),
    y: Math.max(1, Math.min(observation.map.height - 2, home.y)),
  };
  return {
    type: "move",
    entityIds: military.map((unit) => unit.id),
    target: nearestOpenWaypoint(observation, desired) ?? military[0]!.position,
  };
}

function economyCommand(observation: AiObservation, villagers: readonly PublicEntityState[], randomValue: number): GameCommand | null {
  if (villagers.length === 0 || observation.visibleResourceEntities.length === 0) return null;
  const scarce = (["stone", "wood", "food"] satisfies ResourceKind[]).sort((left, right) => observation.wallet[left] - observation.wallet[right])[0]!;
  const candidates = observation.visibleResourceEntities.filter((entity) => entity.typeId === scarce).sort((left, right) => left.id.localeCompare(right.id));
  const pool = candidates.length > 0 ? candidates : [...observation.visibleResourceEntities].sort((left, right) => left.id.localeCompare(right.id));
  const target = pool[randomValue % pool.length];
  return target ? { type: "gather", entityIds: villagers.map((villager) => villager.id), targetId: target.id } : null;
}

function affordableTrain(observation: AiObservation, producerId: EntityId, unitType: UnitType): GameCommand | null {
  const definition = UNITS[unitType];
  if (!tierReached(observation.settlementTier, definition.requiredTier)) return null;
  if (observation.ownTrainingQueueDepth[producerId] === undefined) return null;
  if (observation.ownTrainingQueueDepth[producerId] >= MAX_TRAINING_QUEUE_DEPTH) return null;
  if (!canAfford(observation.wallet, definition.cost) || observation.population.used + definition.population > observation.population.capacity) return null;
  return { type: "train", producerId, unitType, count: 1 };
}

function productionCommand(
  profile: AiProfile,
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  unitType: UnitType,
  direction: number,
  randomValue: number,
): GameCommand | null {
  if (!tierReached(observation.settlementTier, UNITS[unitType].requiredTier)) {
    return settlementProgressionCommand(profile, observation, villagers, randomValue)
      ?? economyCommand(observation, villagers, randomValue);
  }
  const producerType = UNITS[unitType].producers[0];
  if (!producerType) return economyCommand(observation, villagers, randomValue);
  const producer = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === producerType);
  if (producer) {
    if (observation.ownIncompleteBuildingIds.includes(producer.id)) return null;
    return affordableTrain(observation, producer.id, unitType) ?? economyCommand(observation, villagers, randomValue);
  }
  return affordableBuild(observation, villagers, producerType, direction) ?? economyCommand(observation, villagers, randomValue);
}

function affordableBuild(observation: AiObservation, villagers: readonly PublicEntityState[], buildingType: BuildingType, direction: number): GameCommand | null {
  if (!tierReached(observation.settlementTier, BUILDINGS[buildingType].requiredTier)) return null;
  if (villagers.length === 0 || !canAfford(observation.wallet, BUILDINGS[buildingType].cost)) return null;
  const anchor = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? villagers[0]!.position;
  const origin = findOpenPoint(observation, anchor, buildingType, direction);
  return origin ? { type: "build", builderIds: [villagers[0]!.id], buildingType, origin } : null;
}

function settlementProgressionCommand(
  profile: AiProfile,
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  randomValue: number,
): GameCommand | null {
  const targetTier = nextSettlementTier(observation.settlementTier);
  if (!targetTier || observation.serverTick < profile.advanceAfterTick[targetTier]) return null;
  const definition = SETTLEMENT_TIERS[targetTier];
  const incompleteIds = new Set(observation.ownIncompleteBuildingIds);
  for (const prerequisite of definition.prerequisites) {
    const existing = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === prerequisite);
    if (existing) {
      if (incompleteIds.has(existing.id)) return null;
      continue;
    }
    return affordableBuild(observation, villagers, prerequisite, profile.mobilityWeight >= profile.defenseWeight ? -1 : 1)
      ?? economyCommand(observation, villagers, randomValue);
  }
  const townCenter = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter");
  if (!townCenter || incompleteIds.has(townCenter.id)) return economyCommand(observation, villagers, randomValue);
  if (!canAfford(observation.wallet, definition.cost)) return economyCommand(observation, villagers, randomValue);
  return { type: "advanceSettlement", producerId: townCenter.id, targetTier };
}

function advancementSupportCommand(
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  hasIncompleteBuilding: boolean,
  randomValue: number,
): GameCommand | null {
  if (hasIncompleteBuilding) return null;
  const populationHeadroom = observation.population.capacity - observation.population.used;
  if (populationHeadroom <= 2) {
    const house = affordableBuild(observation, villagers, "house", 1);
    if (house) return house;
  }
  return economyCommand(observation, villagers, randomValue);
}

function nextSettlementTier(current: SettlementTier): Exclude<SettlementTier, "frontier"> | null {
  if (current === "frontier") return "stronghold";
  if (current === "stronghold") return "artificer";
  return null;
}

function tierReached(current: SettlementTier, required: SettlementTier): boolean {
  const rank: Readonly<Record<SettlementTier, number>> = { frontier: 0, stronghold: 1, artificer: 2 };
  return rank[current] >= rank[required];
}

function flankPatrol(observation: AiObservation, unit: PublicEntityState, randomValue: number): GameCommand {
  const side = randomValue % 2 === 0 ? 1 : -1;
  const first = nearestOpenWaypoint(observation, { x: unit.position.x + 5 * side, y: unit.position.y + 3 }) ?? unit.position;
  const second = nearestOpenWaypoint(observation, { x: unit.position.x + 8 * side, y: unit.position.y - 3 }) ?? unit.position;
  return {
    type: "patrol",
    entityIds: [unit.id],
    waypoints: [first, second],
  };
}

function nearestOpenWaypoint(observation: AiObservation, desired: GridPoint): GridPoint | null {
  const blocked = new Set(
    [...observation.ownEntities, ...observation.visibleEnemyEntities, ...observation.visibleResourceEntities]
      .filter((entity) => entity.kind !== "unit")
      .flatMap((entity) => entity.kind === "building"
        ? getFootprintCells(entity.position, BUILDINGS[entity.typeId as BuildingType].footprint)
        : [entity.position])
      .map((cell) => `${cell.x},${cell.y}`),
  );
  if (observation.map.id === VILLAGE_ASSAULT_MAP_ID) {
    for (const cell of getVillageAssaultWalkBlockedCells()) blocked.add(`${cell.x},${cell.y}`);
  }
  const center = clamp(desired, observation.map);
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const point = { x: center.x + dx, y: center.y + dy };
        if (point.x < 0 || point.y < 0 || point.x >= observation.map.width || point.y >= observation.map.height) continue;
        if (!blocked.has(`${point.x},${point.y}`)) return point;
      }
    }
  }
  return null;
}

function chooseTarget(profile: AiProfile, visibleEnemies: readonly PublicEntityState[], randomValue: number): PublicEntityState | undefined {
  for (const priority of profile.targetPriority) {
    const candidates = visibleEnemies.filter((entity) => targetClass(entity) === priority).sort((left, right) => left.id.localeCompare(right.id));
    if (candidates.length > 0) return candidates[randomValue % candidates.length];
  }
  return undefined;
}

function targetClass(entity: PublicEntityState): "townCenter" | "military" | "economy" | "villager" {
  if (entity.typeId === "townCenter") return "townCenter";
  if (entity.typeId === "villager") return "villager";
  if (entity.kind === "unit" || (entity.kind === "building" && !["townCenter", "house", "lumberCamp", "farmstead"].includes(entity.typeId))) return "military";
  return "economy";
}

function findOpenPoint(observation: AiObservation, anchor: GridPoint, buildingType: BuildingType, direction: number): GridPoint | null {
  const known = [...observation.ownEntities, ...observation.visibleEnemyEntities, ...observation.visibleResourceEntities];
  const occupied = known.flatMap((entity) => (
    entity.kind === "building"
      ? getFootprintCells(entity.position, BUILDINGS[entity.typeId as BuildingType].footprint)
      : [entity.position]
  ));
  const placementBlocked = observation.map.id === VILLAGE_ASSAULT_MAP_ID
    ? [...occupied, ...getVillageAssaultBuildBlockedCells()]
    : occupied;
  const approachBlocked = new Set((observation.map.id === VILLAGE_ASSAULT_MAP_ID
    ? [...occupied, ...getVillageAssaultWalkBlockedCells()]
    : occupied).map((cell) => `${cell.x},${cell.y}`));
  const candidates: GridPoint[] = [];
  for (let radius = 2; radius <= 7; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        candidates.push({ x: anchor.x + dx, y: anchor.y + dy });
      }
    }
  }
  candidates.sort((left, right) => (
    Math.abs(left.x - anchor.x) + Math.abs(left.y - anchor.y) - (Math.abs(right.x - anchor.x) + Math.abs(right.y - anchor.y))
    || direction * (right.x - left.x)
    || left.y - right.y
    || left.x - right.x
  ));
  return candidates.find((origin) => {
    const footprint = BUILDINGS[buildingType].footprint;
    if (!validateFootprintPlacement(origin, footprint, observation.map.width, observation.map.height, placementBlocked).ok) return false;
    return getFootprintPerimeterCells(origin, footprint).some((cell) => (
      cell.x >= 0
      && cell.y >= 0
      && cell.x < observation.map.width
      && cell.y < observation.map.height
      && !approachBlocked.has(`${cell.x},${cell.y}`)
    ));
  }) ?? null;
}

function canAfford(wallet: ResourceWallet, cost: ResourceWallet): boolean {
  return (Object.keys(cost) as ResourceKind[]).every((kind) => wallet[kind] >= cost[kind]);
}

function clamp(point: GridPoint, map: { readonly width: number; readonly height: number }): GridPoint {
  return { x: Math.max(0, Math.min(map.width - 1, point.x)), y: Math.max(0, Math.min(map.height - 1, point.y)) };
}

function distanceSquared(left: GridPoint, right: GridPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function sortPublicEntities(entities: readonly PublicEntityState[]): PublicEntityState[] {
  return [...entities].sort((left, right) => left.id.localeCompare(right.id));
}

function sanitizeRememberedEnemySites(
  sites: readonly RememberedEnemySite[],
  serverTick: number,
  map: { readonly width: number; readonly height: number },
): RememberedEnemySite[] {
  const newestByEntity = new Map<EntityId, RememberedEnemySite>();
  for (const site of sites) {
    if (!site.entityId || !Number.isSafeInteger(site.observedAtTick) || site.observedAtTick < 0 || site.observedAtTick > serverTick) continue;
    if (!Number.isSafeInteger(site.lastKnownPosition.x) || !Number.isSafeInteger(site.lastKnownPosition.y)) continue;
    if (site.lastKnownPosition.x < 0 || site.lastKnownPosition.y < 0 || site.lastKnownPosition.x >= map.width || site.lastKnownPosition.y >= map.height) continue;
    const previous = newestByEntity.get(site.entityId);
    if (!previous || previous.observedAtTick < site.observedAtTick) {
      newestByEntity.set(site.entityId, { ...site, lastKnownPosition: { ...site.lastKnownPosition } });
    }
  }
  return [...newestByEntity.values()].sort((left, right) => left.entityId.localeCompare(right.entityId));
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
