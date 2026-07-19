import { BUILDINGS, MAX_TRAINING_QUEUE_DEPTH, UNITS } from "./content.js";
import { nextUint32, normalizeSeed } from "./random.js";
import { isEntityVisibleToPlayer, toPublicEntity, type BuildingEntityState, type MatchState } from "./simulation.js";
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
  readonly map: { readonly width: number; readonly height: number };
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
}

export const AI_PROFILES: Readonly<Record<AiPersonality, AiProfile>> = {
  aggressor: { id: "aggressor", economyWeight: 15, defenseWeight: 10, aggressionWeight: 60, mobilityWeight: 15, preferredUnits: ["militia", "spearman", "batteringRam"], preferredBuildings: ["barracks", "house"], targetPriority: ["townCenter", "military", "villager", "economy"] },
  guardian: { id: "guardian", economyWeight: 20, defenseWeight: 55, aggressionWeight: 10, mobilityWeight: 15, preferredUnits: ["spearman", "archer", "militia"], preferredBuildings: ["defenseTower", "house", "barracks"], targetPriority: ["military", "townCenter", "villager", "economy"] },
  prosperer: { id: "prosperer", economyWeight: 60, defenseWeight: 15, aggressionWeight: 15, mobilityWeight: 10, preferredUnits: ["villager", "archer", "batteringRam"], preferredBuildings: ["lumberCamp", "farmstead", "house"], targetPriority: ["economy", "townCenter", "military", "villager"] },
  balanced: { id: "balanced", economyWeight: 30, defenseWeight: 25, aggressionWeight: 25, mobilityWeight: 20, preferredUnits: ["spearman", "archer", "mage", "musketeer"], preferredBuildings: ["house", "barracks", "defenseTower"], targetPriority: ["military", "economy", "townCenter", "villager"] },
  raider: { id: "raider", economyWeight: 15, defenseWeight: 10, aggressionWeight: 35, mobilityWeight: 40, preferredUnits: ["scout", "archer", "militia"], preferredBuildings: ["barracks", "house"], targetPriority: ["villager", "economy", "military", "townCenter"] },
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
  const barracksSite = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "barracks");
  const barracks = barracksSite && !incompleteIds.has(barracksSite.id) ? barracksSite : undefined;
  const visibleTarget = chooseTarget(profile, observation.visibleEnemyEntities, randomValue);

  switch (profile.id) {
    case "aggressor":
      if (visibleTarget && military.length >= 2) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id };
      if (military.length >= 3) return advanceTowardEnemy(observation, military);
      if (barracks) return affordableTrain(observation, barracks.id, "militia") ?? economyCommand(observation, villagers, randomValue);
      if (incompleteBuilding || barracksSite) return null;
      return affordableBuild(observation, villagers, "barracks", 1) ?? economyCommand(observation, villagers, randomValue);
    case "guardian": {
      const home = townCenter?.position;
      const closeEnemy = home && [...observation.visibleEnemyEntities]
        .filter((enemy) => distanceSquared(home, enemy.position) <= 64)
        .sort((left, right) => distanceSquared(home, left.position) - distanceSquared(home, right.position) || left.id.localeCompare(right.id))[0];
      if (closeEnemy && military.length > 0) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: closeEnemy.id };
      if (incompleteBuilding) return null;
      if (!observation.ownEntities.some((entity) => entity.kind === "building" && entity.typeId === "defenseTower")) return affordableBuild(observation, villagers, "defenseTower", 2);
      if (barracks && military.length >= 3) return visibleTarget
        ? { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id }
        : defensivePatrol(observation, military, home ?? military[0]!.position);
      return barracks
        ? affordableTrain(observation, barracks.id, "spearman") ?? economyCommand(observation, villagers, randomValue)
        : barracksSite
          ? null
          : affordableBuild(observation, villagers, "barracks", 1) ?? economyCommand(observation, villagers, randomValue);
    }
    case "prosperer":
      if (townCenter && villagers.length < 5 && observation.population.used + 1 <= observation.population.capacity) {
        const train = affordableTrain(observation, townCenter.id, "villager");
        if (train) return train;
        return economyCommand(observation, villagers, randomValue);
      }
      if (incompleteBuilding) return null;
      if (!barracksSite) return affordableBuild(observation, villagers, "barracks", 1) ?? economyCommand(observation, villagers, randomValue);
      if (barracks && military.length < 3) return affordableTrain(observation, barracks.id, "archer") ?? economyCommand(observation, villagers, randomValue);
      if (military.length >= 3) return visibleTarget
        ? { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id }
        : advanceTowardEnemy(observation, military);
      return economyCommand(observation, villagers, randomValue) ?? affordableBuild(observation, villagers, "lumberCamp", 2);
    case "balanced":
      if (visibleTarget && military.length >= 3) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id };
      if (military.length >= 3) return advanceTowardEnemy(observation, military);
      if (incompleteBuilding) return null;
      if (observation.serverTick === 0) return economyCommand(observation, villagers, randomValue);
      if (!barracksSite) return affordableBuild(observation, villagers, "barracks", 1) ?? economyCommand(observation, villagers, randomValue);
      if (!barracks) return null;
      return affordableTrain(observation, barracks.id, (["spearman", "archer", "mage", "musketeer"] as const)[randomValue % 4]!)
        ?? economyCommand(observation, villagers, randomValue);
    case "raider":
      if (visibleTarget && military.length > 0) return { type: "attack", entityIds: military.map((unit) => unit.id), targetId: visibleTarget.id };
      if (military.length >= 2) return advanceTowardEnemy(observation, military);
      if (barracks) return affordableTrain(observation, barracks.id, "scout") ?? economyCommand(observation, villagers, randomValue);
      if (incompleteBuilding || barracksSite) return null;
      if (military.length > 0) return flankPatrol(observation, military[0]!, randomValue);
      return affordableBuild(observation, villagers, "barracks", -1) ?? economyCommand(observation, villagers, randomValue);
  }
}

function defensivePatrol(observation: AiObservation, military: readonly PublicEntityState[], home: GridPoint): GameCommand {
  return {
    type: "patrol",
    entityIds: military.map((unit) => unit.id),
    waypoints: [
      clamp({ x: home.x - 3, y: home.y - 2 }, observation.map),
      clamp({ x: home.x + 3, y: home.y + 2 }, observation.map),
    ],
  };
}

function advanceTowardEnemy(observation: AiObservation, military: readonly PublicEntityState[]): GameCommand {
  const home = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? military[0]!.position;
  return {
    type: "move",
    entityIds: military.map((unit) => unit.id),
    target: {
      x: home.x < observation.map.width / 2 ? observation.map.width - 2 : 1,
      y: Math.max(1, Math.min(observation.map.height - 2, home.y)),
    },
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
  if (observation.ownTrainingQueueDepth[producerId] === undefined) return null;
  if (observation.ownTrainingQueueDepth[producerId] >= MAX_TRAINING_QUEUE_DEPTH) return null;
  if (!canAfford(observation.wallet, definition.cost) || observation.population.used + definition.population > observation.population.capacity) return null;
  return { type: "train", producerId, unitType, count: 1 };
}

function affordableBuild(observation: AiObservation, villagers: readonly PublicEntityState[], buildingType: BuildingType, direction: number): GameCommand | null {
  if (villagers.length === 0 || !canAfford(observation.wallet, BUILDINGS[buildingType].cost)) return null;
  const anchor = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? villagers[0]!.position;
  const origin = findOpenPoint(observation, anchor, direction);
  return origin ? { type: "build", builderIds: [villagers[0]!.id], buildingType, origin } : null;
}

function flankPatrol(observation: AiObservation, unit: PublicEntityState, randomValue: number): GameCommand {
  const side = randomValue % 2 === 0 ? 1 : -1;
  return {
    type: "patrol",
    entityIds: [unit.id],
    waypoints: [
      clamp({ x: unit.position.x + 5 * side, y: unit.position.y + 3 }, observation.map),
      clamp({ x: unit.position.x + 8 * side, y: unit.position.y - 3 }, observation.map),
    ],
  };
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
  if (entity.kind === "unit" || entity.typeId === "barracks" || entity.typeId === "defenseTower") return "military";
  return "economy";
}

function findOpenPoint(observation: AiObservation, anchor: GridPoint, direction: number): GridPoint | null {
  const occupied = new Set([...observation.ownEntities, ...observation.visibleEnemyEntities, ...observation.visibleResourceEntities].map((entity) => `${entity.position.x},${entity.position.y}`));
  const offsets = [{ x: 2 * direction, y: 0 }, { x: 0, y: 2 * direction }, { x: 2 * direction, y: 2 * direction }, { x: -2 * direction, y: 0 }];
  for (const offset of offsets) {
    const point = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    if (point.x >= 0 && point.y >= 0 && point.x < observation.map.width && point.y < observation.map.height && !occupied.has(`${point.x},${point.y}`)) return point;
  }
  return null;
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
