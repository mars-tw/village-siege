import {
  BUILDINGS,
  MAX_TRAINING_QUEUE_DEPTH,
  MAX_UNITS_PER_PLAYER,
  RESOURCE_NODES,
  RULES_VERSION,
  SETTLEMENT_TIERS,
  SETTLEMENT_TIER_ORDER,
  STARTING_RESOURCES,
  TECHNOLOGIES,
  TECHNOLOGY_ORDER,
  TICKS_PER_SECOND,
  TOWN_CENTER_REBUILD_GRACE_TICKS,
  UNITS,
  getBuildingFootprint,
  getVillage,
} from "./content.js";
import {
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ID,
  VILLAGE_ASSAULT_MAP_WIDTH,
  getVillageAssaultBuildBlockedCells,
  getVillageAssaultLayout,
  getVillageAssaultWalkBlockedCells,
  isVillageAssaultBuildableCell,
  isVillageAssaultLayoutId,
  isVillageAssaultWalkableCell,
} from "./battlefield.js";
import { createAiAuthorityState } from "./aiAuthority.js";
import { normalizeSeed } from "./random.js";
import {
  COMBAT_UNITS,
  MONSTER_BOONS,
  MONSTERS,
  PROJECTILE_PROFILES,
  STATUS_EFFECTS,
  calculateDamage,
  quantizeFacing,
  type AbilityPhase,
  type AbilityTargeting,
  type CombatUnitId,
  type Facing,
  type MonsterBoonId,
  type MonsterId,
  type ProjectileProfileId,
  type StatusEffectDefinition,
  type StatusEffectId,
} from "./combat.js";
import { findNextPathStep, findPathRoute, findPathToAny, getFootprintCells, getFootprintPerimeterCells, validateFootprintPlacement } from "./spatial.js";
import {
  createPlayerVisibilityStates,
  encodeExploredTilesRle,
  getPlayerVisibilityState,
  isEntityVisibleToPlayerFromFog,
  isTileVisibleToPlayer,
  updateVisibilityState,
  type PlayerVisibilityState,
} from "./visibility.js";
import {
  isCommandEnvelope,
  type AiAuthorityState,
  type AiDifficulty,
  type AiPersonality,
  type AbilityTarget,
  type ActiveMonsterBoon,
  type BuildingType,
  type CombatStance,
  type CommandEnvelope,
  type CommandRejectCode,
  type DomainEvent,
  type EntityId,
  type GameCommand,
  type GridPoint,
  type FormationKind,
  type MatchId,
  type MatchPhase,
  type PlayerId,
  type PlayableVillageId,
  type ProductionJobId,
  type PublicEntityState,
  type PublicProjectileState,
  type ResourceKind,
  type ResourceWallet,
  type SettlementTier,
  type StructureHealthBand,
  type StructureOrientation,
  type TechnologyType,
  type TeamEliminationReason,
  type UnitType,
  type VisibleSnapshot,
  type VillageId,
  type VictoryFinishReason,
  type VictoryPolicy,
  type VictoryState,
} from "./protocol.js";

export type UnitOrder =
  | { type: "idle" }
  | { type: "move"; target: GridPoint }
  | { type: "attackMove"; target: GridPoint; engagedTargetId: EntityId | null }
  | { type: "attack"; targetId: EntityId }
  | { type: "gather"; targetId: EntityId; resourceKind: ResourceKind; phase: "toSource" | "toDropOff"; dropOffId: EntityId | null }
  | { type: "deliver"; targetId: EntityId }
  | { type: "construct"; targetId: EntityId }
  | { type: "repair"; targetId: EntityId }
  | { type: "patrol"; waypoints: GridPoint[]; waypointIndex: number };

export interface ActiveStatusState {
  id: StatusEffectId;
  sourceId: EntityId;
  sourceOwnerId?: PlayerId | null;
  expiresAtTick: number;
  nextTickAt: number | null;
}

export interface UnitCombatState {
  phase: AbilityPhase;
  action: "attack" | "ability" | null;
  abilityId: string | null;
  target: AbilityTarget | null;
  commitTick: number | null;
  readyTick: number;
}

export interface UnitPassiveState {
  stationarySinceTick: number;
  movedTilesSinceAttack: number;
  rhythmTargetId: EntityId | null;
  rhythmStacks: number;
  rhythmLastHitTick: number;
  braceCooldownUntilTick: number;
}

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
  facing: Facing;
  stance: CombatStance;
  formation: FormationKind;
  combat: UnitCombatState;
  abilityReadyTick: number;
  passive: UnitPassiveState;
  statuses: ActiveStatusState[];
  cargo: { kind: ResourceKind | null; amount: number };
  cargoCapacity: number;
  gatherRemainderMilli: ResourceWallet;
}

export type ProductionJob =
  | { jobId: ProductionJobId; kind: "train"; unitType: UnitType; remainingTicks: number; totalTicks: number; paidCost: ResourceWallet }
  | { jobId: ProductionJobId; kind: "research"; technologyId: TechnologyType; remainingTicks: number; totalTicks: number; paidCost: ResourceWallet };

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
  statuses: ActiveStatusState[];
  rallyPoint: GridPoint | null;
  productionQueue: ProductionJob[];
  orientation: StructureOrientation;
  gateOpen: boolean;
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

export interface RubbleEntityState {
  id: EntityId;
  ownerId: null;
  kind: "rubble";
  typeId: BuildingType;
  position: GridPoint;
  hitPoints: number;
  maxHitPoints: number;
  stateRevision: number;
  orientation: StructureOrientation;
  decayAtTick: number;
}

export interface MonsterEntityState {
  id: EntityId;
  ownerId: null;
  kind: "monster";
  typeId: MonsterId;
  position: GridPoint;
  home: GridPoint;
  hitPoints: number;
  maxHitPoints: number;
  stateRevision: number;
  facing: Facing;
  statuses: ActiveStatusState[];
  combat: UnitCombatState;
  movementProgress: number;
  attackCooldownTicks: number;
  abilityReadyTick: number;
  camouflageReady: boolean;
  camouflageSpeedUntilTick: number;
  leashRadius: number;
  provokedByTeamId: string | null;
  provokedAtTick: number | null;
  targetId: EntityId | null;
  contributions: {
    playerId: PlayerId;
    teamId: string;
    actualDamage: number;
    firstHitTick: number;
    lastHitTick: number;
  }[];
  rewardGranted: boolean;
}

export type EntityState = UnitEntityState | BuildingEntityState | ResourceEntityState | RubbleEntityState | MonsterEntityState;

export const RUBBLE_DECAY_TICKS = 200;

interface ProjectileDamageSpec {
  sourceUnitType: CombatUnitId;
  baseDamage: number;
  abilityId: string;
  skillMultiplier: number;
  structureMultiplierBonus: number;
}

type ProjectileResolution =
  | { kind: "groundArea"; groupId: string; hitAll: boolean; maxHitsPerTarget: number; radiusSquared: number; damage: ProjectileDamageSpec }
  | { kind: "line"; origin: GridPoint; maxTargets: number; halfWidth: number; lastResolvedDistance: number; hitTargetIds: EntityId[]; damage: ProjectileDamageSpec }
  | null;

export interface ProjectileState {
  id: EntityId;
  ownerId: PlayerId;
  sourceId: EntityId;
  profileId: ProjectileProfileId;
  origin: GridPoint;
  position: GridPoint;
  targetId: EntityId | null;
  targetPoint: GridPoint;
  fixedImpact: boolean;
  launchTick: number;
  impactTick: number;
  damage: number;
  statusEffects: StatusEffectId[];
  resolution: ProjectileResolution;
}

export interface PlayerState {
  id: PlayerId;
  teamId: string;
  villageId: VillageId;
  resources: ResourceWallet;
  population: { used: number; capacity: number };
  settlementTier: SettlementTier;
  advancement: { producerId: EntityId; targetTier: SettlementTier; remainingTicks: number } | null;
  completedTechnologyIds: TechnologyType[];
  activeMonsterBoons: ActiveMonsterBoon[];
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
  map: { id: "open" | typeof VILLAGE_ASSAULT_MAP_ID; width: number; height: number; layoutId?: PlayableVillageId };
  players: PlayerState[];
  aiControllers: AiAuthorityState[];
  entities: EntityState[];
  projectiles: ProjectileState[];
  visibilityByPlayer: PlayerVisibilityState[];
  nextEntityNumber: number;
  teamTownCenterLostAt: { teamId: string; tick: number }[];
  winningTeamIds: string[];
  finishReason: VictoryFinishReason | null;
  victory: VictoryState;
}

export interface InitialPlayer {
  readonly id: PlayerId;
  readonly teamId: string;
  readonly villageId: VillageId;
  readonly ai?: { readonly personality: AiPersonality; readonly difficulty?: AiDifficulty };
}

export interface CreateInitialStateOptions {
  readonly matchId?: MatchId;
  readonly seed?: number;
  readonly players?: readonly InitialPlayer[];
  readonly map?: { readonly id?: "open" | typeof VILLAGE_ASSAULT_MAP_ID; readonly width: number; readonly height: number; readonly layoutId?: PlayableVillageId };
  readonly spawnOverrides?: Readonly<Partial<Record<PlayerId, GridPoint>>>;
  readonly victoryPolicy?: Partial<VictoryPolicy>;
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

export interface DomainEventFrame {
  readonly serverTick: number;
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

function createVictoryState(
  participants: readonly InitialPlayer[],
  mapWidth: number,
  mapHeight: number,
  requested: Partial<VictoryPolicy> | undefined,
): VictoryState {
  const commandCenterConquest = requested?.commandCenterConquest === undefined
    ? { rebuildGraceTicks: TOWN_CENTER_REBUILD_GRACE_TICKS }
    : requested.commandCenterConquest;
  const landmark = requested?.landmark ?? null;
  const timedControl = requested?.timedControl ?? null;
  if (commandCenterConquest && (!Number.isSafeInteger(commandCenterConquest.rebuildGraceTicks) || commandCenterConquest.rebuildGraceTicks < 0)) {
    throw new RangeError("commandCenterConquest.rebuildGraceTicks must be a non-negative safe integer");
  }
  if (landmark && (landmark.buildingType !== "copperLandmark"
    || !Number.isSafeInteger(landmark.requiredCount)
    || landmark.requiredCount < 1
    || !Number.isSafeInteger(landmark.holdTicks)
    || landmark.holdTicks < 1)) {
    throw new RangeError("landmark victory requires copperLandmark, positive requiredCount and positive holdTicks");
  }
  if (timedControl && (!Number.isSafeInteger(timedControl.point.x)
    || !Number.isSafeInteger(timedControl.point.y)
    || timedControl.point.x < 0
    || timedControl.point.y < 0
    || timedControl.point.x >= mapWidth
    || timedControl.point.y >= mapHeight
    || !Number.isSafeInteger(timedControl.radius)
    || timedControl.radius < 1
    || timedControl.radius > Math.max(mapWidth, mapHeight)
    || !Number.isSafeInteger(timedControl.startsAtTick)
    || timedControl.startsAtTick < 0
    || !Number.isSafeInteger(timedControl.targetTicks)
    || timedControl.targetTicks < 1)) {
    throw new RangeError("timedControl requires an in-bounds point and positive integer radius/targetTicks");
  }
  if (requested?.elimination !== undefined && typeof requested.elimination !== "boolean") {
    throw new TypeError("elimination victory policy must be boolean");
  }
  const teamIds = [...new Set(participants.map((participant) => participant.teamId))].sort(compareText);
  return {
    policy: {
      commandCenterConquest: commandCenterConquest ? { ...commandCenterConquest } : null,
      elimination: requested?.elimination ?? true,
      landmark: landmark ? { ...landmark } : null,
      timedControl: timedControl ? { ...timedControl, point: { ...timedControl.point } } : null,
    },
    teams: teamIds.map((teamId) => ({
      teamId,
      landmarkHoldTicks: 0,
      timedControlScoreTicks: 0,
      eliminatedAtTick: null,
      eliminationReason: null,
    })),
    control: { controllerTeamId: null, contested: false },
    outcome: null,
    winningTeamIds: [],
    finishReason: null,
    triggeredReasons: [],
    finishedAtTick: null,
  };
}

function cloneVictoryState(victory: VictoryState): VictoryState {
  return {
    policy: {
      commandCenterConquest: victory.policy.commandCenterConquest ? { ...victory.policy.commandCenterConquest } : null,
      elimination: victory.policy.elimination,
      landmark: victory.policy.landmark ? { ...victory.policy.landmark } : null,
      timedControl: victory.policy.timedControl ? { ...victory.policy.timedControl, point: { ...victory.policy.timedControl.point } } : null,
    },
    teams: victory.teams.map((team) => ({ ...team })),
    control: { ...victory.control },
    outcome: victory.outcome,
    winningTeamIds: [...victory.winningTeamIds],
    finishReason: victory.finishReason,
    triggeredReasons: [...victory.triggeredReasons],
    finishedAtTick: victory.finishedAtTick,
  };
}

export function createInitialState(options: CreateInitialStateOptions = {}): MatchState {
  const participants = options.players ?? DEFAULT_PLAYERS;
  if (participants.length < 2 || participants.length > 5) throw new RangeError("A match requires two to five factions");
  if (new Set(participants.map((player) => player.id)).size !== participants.length) throw new Error("Player ids must be unique");
  if (new Set(participants.map((player) => player.teamId)).size < 2) throw new Error("A match requires at least two opposing teams");

  const mapId = options.map?.id ?? "open";
  if (mapId === "open" && new Set(participants.map((player) => player.villageId)).size !== participants.length) {
    throw new Error("Open-map village ids must be unique because they select spawn locations");
  }
  const mapWidth = options.map?.width ?? 32;
  const mapHeight = options.map?.height ?? 32;
  if (mapId === VILLAGE_ASSAULT_MAP_ID && (mapWidth !== VILLAGE_ASSAULT_MAP_WIDTH || mapHeight !== VILLAGE_ASSAULT_MAP_HEIGHT)) {
    throw new RangeError(`Village assault map must be ${VILLAGE_ASSAULT_MAP_WIDTH}x${VILLAGE_ASSAULT_MAP_HEIGHT}`);
  }
  const requestedAssaultLayoutId: unknown = options.map?.layoutId ?? participants[0]?.villageId;
  const assaultLayoutId: PlayableVillageId = isVillageAssaultLayoutId(requestedAssaultLayoutId) ? requestedAssaultLayoutId : "pinehold";
  const state: MatchState = {
    rulesVersion: RULES_VERSION,
    matchId: options.matchId ?? "local-match",
    seed: normalizeSeed(options.seed ?? 1),
    randomState: normalizeSeed(options.seed ?? 1),
    tick: 0,
    ticksPerSecond: TICKS_PER_SECOND,
    phase: "playing",
    map: {
      id: mapId,
      width: mapWidth,
      height: mapHeight,
      ...(mapId === VILLAGE_ASSAULT_MAP_ID
        ? { layoutId: assaultLayoutId }
        : {}),
    },
    players: participants.map((participant) => ({
      id: participant.id,
      teamId: participant.teamId,
      villageId: participant.villageId,
      resources: { ...STARTING_RESOURCES },
      population: { used: 0, capacity: 0 },
      settlementTier: "frontier",
      advancement: null,
      completedTechnologyIds: [],
      activeMonsterBoons: [],
      lastSequence: -1,
      surrendered: false,
      eliminated: false,
    })),
    aiControllers: participants
      .filter((participant) => participant.ai !== undefined)
      .map((participant) => createAiAuthorityState(
        participant.ai!.personality,
        participant.id,
        options.seed ?? 1,
        participant.ai!.difficulty ?? "standard",
      ))
      .sort((left, right) => compareText(left.playerId, right.playerId)),
    entities: [],
    projectiles: [],
    visibilityByPlayer: createPlayerVisibilityStates(participants.map((participant) => participant.id)),
    nextEntityNumber: 1,
    teamTownCenterLostAt: [],
    winningTeamIds: [],
    finishReason: null,
    victory: createVictoryState(participants, mapWidth, mapHeight, options.victoryPolicy),
  };

  const fortifiedLayout = mapId === VILLAGE_ASSAULT_MAP_ID && participants.length === 2 && options.spawnOverrides === undefined
    ? getVillageAssaultLayout(state.map.layoutId ?? "pinehold")
    : null;
  for (const [playerIndex, player] of state.players.entries()) {
    if (fortifiedLayout) {
      const slot = fortifiedLayout.startSlots[playerIndex]!;
      const buildingByPlacementId = new Map<string, BuildingEntityState>();
      for (const placement of slot.placements) {
        const building = createBuilding(state, player.id, placement.buildingType, placement.origin, true, placement.orientation);
        if (building.typeId === "surveyGate") building.gateOpen = playerIndex === 0;
        state.entities.push(building);
        buildingByPlacementId.set(placement.id, building);
      }
      const resourceByAnchorId = new Map<string, ResourceEntityState>();
      for (const anchor of slot.resourceAnchors) {
        const resource = createResource(state, anchor.resourceKind, anchor.position);
        state.entities.push(resource);
        resourceByAnchorId.set(anchor.id, resource);
      }
      for (const activity of slot.civilianActivities) {
        const villager = createUnit(state, player.id, "villager", activity.spawn);
        const source = resourceByAnchorId.get(activity.resourceAnchorId);
        const dropOff = buildingByPlacementId.get(activity.dropOffPlacementId);
        if (source && dropOff) {
          villager.order = {
            type: "gather",
            targetId: source.id,
            resourceKind: source.typeId,
            phase: "toSource",
            dropOffId: dropOff.id,
          };
        }
        state.entities.push(villager);
      }
      continue;
    }
    const defaultSpawn = mapId === VILLAGE_ASSAULT_MAP_ID ? VILLAGE_ASSAULT_SPAWNS[playerIndex]! : SPAWNS[player.villageId];
    const preferredCenter = options.spawnOverrides?.[player.id] ?? defaultSpawn;
    const center = mapId === VILLAGE_ASSAULT_MAP_ID
      ? findNearestLegacyAssaultBuildingOrigin(state, "townCenter", preferredCenter)
      : clampBuildingOrigin(preferredCenter, "townCenter", state);
    state.entities.push(createBuilding(state, player.id, "townCenter", center, true));
    const villagerOffsets = [{ x: -1, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }];
    for (const offset of villagerOffsets) {
      const preferred = clampPoint({ x: center.x + offset.x, y: center.y + offset.y }, state);
      const spawn = mapId === VILLAGE_ASSAULT_MAP_ID ? findNearestLegacyAssaultFreeCell(state, preferred) : preferred;
      state.entities.push(createUnit(state, player.id, "villager", spawn));
    }
    const resources: readonly [ResourceKind, number, number][] = [["wood", -2, 0], ["food", 2, 0], ["stone", 0, -2]];
    for (const [kind, dx, dy] of resources) {
      const preferred = clampPoint({ x: center.x + dx, y: center.y + dy }, state);
      const spawn = mapId === VILLAGE_ASSAULT_MAP_ID ? findNearestLegacyAssaultFreeCell(state, preferred, true) : preferred;
      state.entities.push(createResource(state, kind, spawn));
    }
  }
  if (fortifiedLayout) {
    for (const camp of fortifiedLayout.neutralCamps) {
      state.entities.push(createMonster(state, camp.monsterTypeId, camp.position, camp.leashRadius));
    }
  }
  syncPopulation(state);
  updateVisibilityState(state);
  return state;
}

function findNearestLegacyAssaultBuildingOrigin(state: MatchState, buildingType: BuildingType, preferred: GridPoint): GridPoint {
  const occupied = new Set(state.entities.flatMap(getEntityFootprintCells).map(pointKey));
  const candidates: GridPoint[] = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const candidate = { x, y };
      const footprintIsFree = getFootprintCells(candidate, getBuildingFootprint(buildingType)).every((cell) => !occupied.has(pointKey(cell)));
      if (footprintIsFree && isBuildLocationAvailable(state, buildingType, candidate)) candidates.push(candidate);
    }
  }
  const resolved = candidates.sort((left, right) => (
    distanceSquared(left, preferred) - distanceSquared(right, preferred)
    || left.y - right.y
    || left.x - right.x
  ))[0];
  if (!resolved) throw new Error(`No valid ${buildingType} origin remains on the village-assault layout`);
  return resolved;
}

function findNearestLegacyAssaultFreeCell(state: MatchState, preferred: GridPoint, requireBuildable = false): GridPoint {
  const occupied = new Set(state.entities.flatMap(getEntityFootprintCells).map(pointKey));
  const candidates: GridPoint[] = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const candidate = { x, y };
      if (
        isMapCellWalkable(state, candidate)
        && (!requireBuildable || isVillageAssaultBuildableCell(candidate, state.map.layoutId))
        && !occupied.has(pointKey(candidate))
      ) candidates.push(candidate);
    }
  }
  const resolved = candidates.sort((left, right) => (
    distanceSquared(left, preferred) - distanceSquared(right, preferred)
    || left.y - right.y
    || left.x - right.x
  ))[0];
  if (!resolved) throw new Error(`No free ${requireBuildable ? "buildable" : "walkable"} cell remains on the village-assault layout`);
  return resolved;
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
  return applyCommandInternal(state, envelope, true);
}

function applyCommandInternal(state: MatchState, envelope: CommandEnvelope, evaluateImmediately: boolean): CommandApplication {
  const next = cloneMatchState(state);
  const validation = validateCommand(next, envelope);
  if (!validation.ok) {
    return { state: next, validation, events: [{ type: "commandRejected", sequence: envelope.sequence, code: validation.code }] };
  }
  const events: DomainEvent[] = [{ type: "commandAccepted", sequence: envelope.sequence, serverTick: next.tick }];
  const player = next.players.find((candidate) => candidate.id === envelope.playerId)!;
  player.lastSequence = envelope.sequence;
  applyGameCommand(next, player, envelope.sequence, envelope.command, events);
  syncPopulation(next);
  if (evaluateImmediately) evaluateVictory(next, events);
  return { state: next, validation, events };
}

export function stepSimulation(state: MatchState, commands: readonly CommandEnvelope[] = [], deltaTicks = 1): SimulationStepResult {
  if (!Number.isSafeInteger(deltaTicks) || deltaTicks < 0) throw new RangeError("deltaTicks must be a non-negative safe integer");
  let next = cloneMatchState(state);
  const events: DomainEvent[] = [];
  const ordered = orderCommands(commands);
  for (const envelope of ordered) {
    const applied = applyCommandInternal(next, envelope, false);
    next = applied.state;
    events.push(...applied.events);
  }
  evaluateVictory(next, events);
  if (deltaTicks > 0 && state.phase === "playing" && next.phase === "finished" && next.tick === state.tick) {
    advanceTerminalTransitionTick(next, events);
  }
  for (let index = 0; index < deltaTicks && next.phase === "playing"; index += 1) {
    advanceOneTick(next, events);
  }
  return { state: next, events };
}

/** A command-resolved terminal state still consumes its authoritative fixed step. */
function advanceTerminalTransitionTick(state: MatchState, events: DomainEvent[]): void {
  const previousTick = state.tick;
  const terminalTick = previousTick + 1;
  const eliminatedTeamIds = new Set(events.flatMap((event) => (
    event.type === "teamEliminated" && event.eliminatedAtTick === previousTick ? [event.teamId] : []
  )));
  state.tick = terminalTick;
  state.victory = {
    ...state.victory,
    teams: state.victory.teams.map((team) => eliminatedTeamIds.has(team.teamId) && team.eliminatedAtTick === previousTick
      ? { ...team, eliminatedAtTick: terminalTick }
      : team),
    finishedAtTick: state.victory.finishedAtTick === previousTick ? terminalTick : state.victory.finishedAtTick,
  };
  for (const [index, event] of events.entries()) {
    if (event.type === "commandAccepted" && event.serverTick === previousTick) {
      events[index] = { ...event, serverTick: terminalTick };
    } else if (event.type === "teamEliminated" && event.eliminatedAtTick === previousTick) {
      events[index] = { ...event, eliminatedAtTick: terminalTick };
    } else if (event.type === "matchFinished" && event.finishedAtTick === previousTick) {
      events[index] = { ...event, finishedAtTick: terminalTick };
    }
  }
}

/** Called by an authoritative room only after its reconnect lease expires. */
export function applyDisconnectedTeamDefeat(state: MatchState, teamId: string): SimulationStepResult {
  const next = cloneMatchState(state);
  if (next.phase !== "playing") return { state: next, events: [] };
  if (!next.victory.teams.some((team) => team.teamId === teamId)) throw new Error(`Unknown team: ${teamId}`);
  const events: DomainEvent[] = [];
  eliminateTeam(next, teamId, "disconnect", events);
  evaluateVictory(next, events);
  updateVisibilityState(next);
  return { state: next, events };
}

export function cloneMatchState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

export function hashMatchState(state: MatchState): string {
  return fnv1a(stableStringify(state));
}

/** Computes the recipient-visible checksum without requiring or exposing canonical MatchState. */
export function hashVisibleSnapshot(snapshot: VisibleSnapshot | Omit<VisibleSnapshot, "checksum">): string {
  const { checksum: _checksum, ...body } = snapshot as VisibleSnapshot;
  // Hash exactly what can cross JSON/WebSocket boundaries; optional undefined fields are not wire data.
  return fnv1a(stableStringify(JSON.parse(JSON.stringify(body))));
}

export function verifyVisibleSnapshotChecksum(snapshot: VisibleSnapshot): boolean {
  return hashVisibleSnapshot(snapshot) === snapshot.checksum;
}

export function hashReplay(initialState: MatchState, commands: readonly CommandEnvelope[], deltaTicks: number): string {
  const ordered = orderCommands(commands);
  const result = stepSimulation(initialState, ordered, deltaTicks);
  return fnv1a(stableStringify({ initial: hashMatchState(initialState), commands: ordered, deltaTicks, final: hashMatchState(result.state) }));
}

export function getStructureHealthBand(entity: BuildingEntityState | RubbleEntityState): StructureHealthBand {
  if (entity.kind === "rubble" || entity.hitPoints <= 0) return "destroyed";
  if (entity.hitPoints * 3 <= entity.maxHitPoints) return "critical";
  if (entity.hitPoints * 3 <= entity.maxHitPoints * 2) return "damaged";
  return "healthy";
}

export function doesEntityBlockMovement(entity: EntityState): boolean {
  if (entity.kind === "unit" || entity.kind === "monster" || entity.kind === "rubble") return false;
  if (entity.kind === "resource") return true;
  if (entity.hitPoints <= 0) return false;
  return BUILDINGS[entity.typeId].movementBlocking !== "whenClosed" || !entity.complete || !entity.gateOpen;
}

export function toPublicEntity(entity: EntityState): PublicEntityState {
  const publicEntity: PublicEntityState = {
    id: entity.id,
    ownerId: entity.ownerId,
    kind: entity.kind,
    typeId: entity.typeId,
    position: { ...entity.position },
    hitPoints: entity.hitPoints,
    maxHitPoints: entity.maxHitPoints,
    stateRevision: entity.stateRevision,
  };
  if (entity.kind === "unit") {
    return {
      ...publicEntity,
      facing: entity.facing,
      stance: entity.stance,
      formation: entity.formation,
      combatPhase: entity.combat.phase,
      abilityReadyTick: entity.abilityReadyTick,
      statuses: entity.statuses.map((status) => ({ id: status.id, expiresAtTick: status.expiresAtTick })),
      passiveProgress: {
        stationarySinceTick: entity.passive.stationarySinceTick,
        movedTilesSinceAttack: entity.passive.movedTilesSinceAttack,
        rhythmStacks: entity.passive.rhythmStacks,
        rhythmExpiresAtTick: entity.passive.rhythmTargetId === null ? 0 : entity.passive.rhythmLastHitTick + 20,
        braceCooldownUntilTick: entity.passive.braceCooldownUntilTick,
      },
      cargo: {
        kind: entity.cargo.kind,
        amount: entity.cargo.amount,
        capacity: entity.cargoCapacity,
      },
      civilianActivity: entity.typeId === "villager" ? civilianActivityForOrder(entity) : undefined,
    };
  }
  if (entity.kind === "monster") {
    return {
      ...publicEntity,
      facing: entity.facing,
      combatPhase: entity.combat.phase,
      abilityReadyTick: entity.abilityReadyTick,
      statuses: entity.statuses.map((status) => ({ id: status.id, expiresAtTick: status.expiresAtTick })),
      monsterState: {
        home: { ...entity.home },
        leashRadius: entity.leashRadius,
        disposition: entity.provokedByTeamId === null ? "neutral" : entity.targetId === null ? "returning" : "retaliating",
        attackCooldownTicks: entity.attackCooldownTicks,
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
  if (entity.kind === "rubble") {
    return {
      ...publicEntity,
      orientation: entity.orientation,
      healthBand: "destroyed",
      blocksMovement: false,
    };
  }
  return {
    ...publicEntity,
    statuses: entity.statuses.map((status) => ({ id: status.id, expiresAtTick: status.expiresAtTick })),
    orientation: entity.orientation,
    gateOpen: entity.typeId === "surveyGate" ? entity.gateOpen : undefined,
    complete: entity.complete,
    constructionRemainingTicks: entity.constructionRemainingTicks,
    healthBand: getStructureHealthBand(entity),
    blocksMovement: doesEntityBlockMovement(entity),
  };
}

function civilianActivityForOrder(unit: UnitEntityState): NonNullable<PublicEntityState["civilianActivity"]> {
  if (unit.order.type === "construct") return "constructing";
  if (unit.order.type === "repair") return "repairing";
  if (unit.order.type === "gather") return unit.order.phase === "toDropOff" || unit.cargo.amount > 0 ? "hauling" : "gathering";
  if (unit.order.type === "deliver") return "hauling";
  if (unit.order.type === "move" || unit.order.type === "attackMove" || unit.order.type === "patrol") return "walking";
  return "idle";
}

export function toPublicProjectile(projectile: ProjectileState): PublicProjectileState {
  return {
    id: projectile.id,
    ownerId: projectile.ownerId,
    sourceId: projectile.sourceId,
    profileId: projectile.profileId,
    position: { ...projectile.position },
    targetId: projectile.targetId,
    targetPoint: { ...projectile.targetPoint },
    impactTick: projectile.impactTick,
  };
}

export function toVisibleSnapshot(state: MatchState, playerId: PlayerId): VisibleSnapshot {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown snapshot recipient: ${playerId}`);
  const visibility = getPlayerVisibilityState(state, playerId);
  const entities = state.entities
    .filter((entity) => isEntityVisibleToPlayer(state, playerId, entity))
    .sort((left, right) => compareText(left.id, right.id))
    .map(toPublicEntity);
  const projectiles = state.projectiles
    .filter((projectile) => arePlayersAllied(state, playerId, projectile.ownerId) || isTileVisibleToPlayer(state, playerId, projectile.position))
    .sort((left, right) => compareText(left.id, right.id))
    .map((projectile) => maskPublicProjectileForPlayer(state, playerId, toPublicProjectile(projectile)));
  const body: Omit<VisibleSnapshot, "checksum"> = {
    matchId: state.matchId,
    rulesVersion: state.rulesVersion,
    serverTick: state.tick,
    recipientPlayerId: playerId,
    phase: state.phase,
    victory: cloneVictoryState(state.victory),
    map: { ...state.map },
    wallet: { ...player.resources },
    population: { ...player.population },
    settlementTier: player.settlementTier,
    completedTechnologyIds: [...player.completedTechnologyIds],
    activeMonsterBoons: player.activeMonsterBoons.map((boon) => ({ ...boon })),
    entities,
    projectiles,
    staleEnemySightings: visibility.staleEnemySightings.map((sighting) => ({ ...sighting, position: { ...sighting.position } })),
    exploredTilesRle: encodeExploredTilesRle(state.map.width, state.map.height, visibility.exploredTileIndices),
    visibilityRevision: visibility.revision,
    visibleTileIndices: [...visibility.visibleTileIndices],
    visibleEntityIds: entities.map((entity) => entity.id),
  };
  return { ...body, checksum: hashVisibleSnapshot(body) };
}

export function projectDomainEventsForPlayer(
  state: MatchState,
  playerId: PlayerId,
  frame: DomainEventFrame,
  commandSequences: readonly number[] = [],
): DomainEvent[] {
  if (frame.serverTick !== state.tick) throw new Error("Domain events must be projected against their single authoritative tick");
  const events = frame.events;
  const ownedSequences = new Set(commandSequences);
  const removedById = new Map(
    events
      .filter((event): event is Extract<DomainEvent, { type: "entityRemoved" }> => event.type === "entityRemoved")
      .map((event) => [event.entityId, event.entity]),
  );
  const projected: DomainEvent[] = [];
  for (const event of events) {
    switch (event.type) {
      case "commandAccepted":
      case "commandRejected":
        if (ownedSequences.has(event.sequence)) projected.push(event);
        break;
      case "entitySpawned":
      case "entityUpdated": {
        const entity = state.entities.find((candidate) => candidate.id === event.entity.id);
        if (entity ? isEntityVisibleToPlayer(state, playerId, entity) : isPublicEntityVisibleToPlayer(state, playerId, event.entity)) projected.push(event);
        break;
      }
      case "combatPhaseChanged":
      case "statusExpired": {
        const entity = state.entities.find((candidate) => candidate.id === event.entityId);
        if (entity && isEntityVisibleToPlayer(state, playerId, entity)) projected.push(event);
        break;
      }
      case "projectileSpawned":
        if (arePlayersAllied(state, playerId, event.projectile.ownerId) || isTileVisibleToPlayer(state, playerId, event.projectile.position)) {
          projected.push({ ...event, projectile: maskPublicProjectileForPlayer(state, playerId, event.projectile) });
        }
        break;
      case "projectileImpacted":
        if (isTileVisibleToPlayer(state, playerId, event.position)) {
          projected.push({
            ...event,
            targetIds: event.targetIds.filter((targetId) => {
              const target = state.entities.find((candidate) => candidate.id === targetId);
              return target
                ? isEntityVisibleToPlayer(state, playerId, target)
                : isPublicEntityVisibleToPlayer(state, playerId, removedById.get(targetId));
            }),
          });
        }
        break;
      case "entityDamaged":
      case "statusApplied": {
        const target = state.entities.find((candidate) => candidate.id === event.targetId);
        const targetVisible = target
          ? isEntityVisibleToPlayer(state, playerId, target)
          : isPublicEntityVisibleToPlayer(state, playerId, removedById.get(event.targetId));
        if (!targetVisible) break;
        const source = event.sourceId ? state.entities.find((candidate) => candidate.id === event.sourceId) : undefined;
        const removedSource = event.sourceId ? removedById.get(event.sourceId) : undefined;
        const sourceVisible = source
          ? isEntityVisibleToPlayer(state, playerId, source)
          : isPublicEntityVisibleToPlayer(state, playerId, removedSource);
        projected.push({ ...event, sourceId: sourceVisible ? event.sourceId : null });
        break;
      }
      case "entityRemoved":
        if (isPublicEntityVisibleToPlayer(state, playerId, event.entity)) projected.push(event);
        break;
      case "settlementAdvanced":
      case "technologyResearched":
      case "rallyPointChanged":
      case "gateStateChanged":
      case "productionCancelled":
      case "resourcesDeposited":
        if (event.playerId === playerId) projected.push(event);
        break;
      case "resourceDepleted":
      case "resourceRenewed": {
        const resource = state.entities.find((candidate) => candidate.id === event.resourceId);
        const resourceVisible = resource
          ? isEntityVisibleToPlayer(state, playerId, resource)
          : isPublicEntityVisibleToPlayer(state, playerId, removedById.get(event.resourceId));
        if (resourceVisible) projected.push(event);
        break;
      }
      case "tacticalSignalRaised": {
        const anchor = state.entities.find((candidate) => candidate.id === event.anchorEntityId);
        const removedAnchor = removedById.get(event.anchorEntityId);
        const anchorOwnerId = anchor?.ownerId ?? removedAnchor?.ownerId;
        const anchorVisible = anchor
          ? isEntityVisibleToPlayer(state, playerId, anchor)
          : isPublicEntityVisibleToPlayer(state, playerId, removedAnchor);
        if (!arePlayersHostile(state, playerId, event.actingPlayerId)
          || anchorOwnerId !== event.actingPlayerId
          || !anchorVisible) break;
        // Rebuild the public payload so runtime-only planner details can never
        // survive projection through an accidentally widened event object.
        projected.push({
          type: "tacticalSignalRaised",
          actingPlayerId: event.actingPlayerId,
          signal: event.signal,
          anchorEntityId: event.anchorEntityId,
          emittedAtTick: event.emittedAtTick,
        });
        break;
      }
      case "monsterProvoked": {
        const monster = state.entities.find((candidate) => candidate.id === event.monsterId);
        const removedMonster = removedById.get(event.monsterId);
        const monsterVisible = monster
          ? isEntityVisibleToPlayer(state, playerId, monster)
          : isPublicEntityVisibleToPlayer(state, playerId, removedMonster);
        if (!monsterVisible) break;
        const source = event.sourceId ? state.entities.find((candidate) => candidate.id === event.sourceId) : undefined;
        const removedSource = event.sourceId ? removedById.get(event.sourceId) : undefined;
        const sourceVisible = source
          ? isEntityVisibleToPlayer(state, playerId, source)
          : isPublicEntityVisibleToPlayer(state, playerId, removedSource);
        projected.push({
          ...event,
          teamId: sourceVisible ? event.teamId : null,
          sourceId: sourceVisible ? event.sourceId : null,
        });
        break;
      }
      case "monsterDefeated": {
        const removed = removedById.get(event.monsterId);
        if (isPublicEntityVisibleToPlayer(state, playerId, removed)) projected.push(event);
        break;
      }
      case "monsterRewardGranted":
        if (event.playerId === playerId) projected.push(event);
        break;
      case "breachCreated":
        if (arePlayersAllied(state, playerId, event.ownerId) || isTileVisibleToPlayer(state, playerId, event.position)) projected.push(event);
        break;
      case "teamEliminated":
      case "controlObjectiveChanged":
      case "victoryProgressChanged":
      case "matchFinished":
        projected.push(event);
        break;
    }
  }
  return projected;
}

function maskPublicProjectileForPlayer(state: MatchState, playerId: PlayerId, projectile: PublicProjectileState): PublicProjectileState {
  const source = projectile.sourceId ? state.entities.find((entity) => entity.id === projectile.sourceId) : undefined;
  const target = projectile.targetId ? state.entities.find((entity) => entity.id === projectile.targetId) : undefined;
  const targetVisible = Boolean(target && isEntityVisibleToPlayer(state, playerId, target));
  return {
    ...projectile,
    sourceId: source && isEntityVisibleToPlayer(state, playerId, source) ? source.id : null,
    targetId: targetVisible ? target!.id : null,
    targetPoint: isTileVisibleToPlayer(state, playerId, projectile.targetPoint)
      ? projectile.targetPoint
      : targetVisible
        ? target!.position
        : projectile.position,
  };
}

function isPublicEntityVisibleToPlayer(state: MatchState, playerId: PlayerId, entity: PublicEntityState | undefined): boolean {
  if (!entity) return false;
  if (entity.ownerId !== null && arePlayersAllied(state, playerId, entity.ownerId)) return true;
  if (entity.kind !== "building" && entity.kind !== "rubble") return isTileVisibleToPlayer(state, playerId, entity.position);
  return getFootprintCells(entity.position, getBuildingFootprint(entity.typeId as BuildingType, entity.orientation))
    .some((cell) => isTileVisibleToPlayer(state, playerId, cell));
}

export function isEntityVisibleToPlayer(state: MatchState, playerId: PlayerId, target: EntityState): boolean {
  return isEntityVisibleToPlayerFromFog(state, playerId, target);
}

export function getEntityFootprintCells(entity: EntityState): readonly GridPoint[] {
  return entity.kind === "building" || entity.kind === "rubble"
    ? getFootprintCells(entity.position, getBuildingFootprint(entity.typeId, entity.orientation))
    : [entity.position];
}

export function getOccupiedMapCells(state: MatchState): readonly GridPoint[] {
  return state.entities.flatMap((entity) => entity.kind === "unit" || entity.kind === "monster" ? [] : getEntityFootprintCells(entity));
}

export function getNavigationBlockedMapCells(state: MatchState): readonly GridPoint[] {
  return state.entities.flatMap((entity) => doesEntityBlockMovement(entity) ? getEntityFootprintCells(entity) : []);
}

export function isBuildLocationAvailable(state: MatchState, buildingType: BuildingType, origin: GridPoint, orientation: StructureOrientation = "ne"): boolean {
  const terrainBlocked = state.map.id === VILLAGE_ASSAULT_MAP_ID ? getVillageAssaultBuildBlockedCells(state.map.layoutId) : [];
  const occupied = getOccupiedMapCells(state);
  const placement = validateFootprintPlacement(
    origin,
    getBuildingFootprint(buildingType, orientation),
    state.map.width,
    state.map.height,
    [...occupied, ...terrainBlocked],
  );
  if (!placement.ok) return false;
  const walkBlocked = state.map.id === VILLAGE_ASSAULT_MAP_ID ? getVillageAssaultWalkBlockedCells(state.map.layoutId) : [];
  const approachBlocked = new Set([...occupied, ...walkBlocked].map(pointKey));
  return getFootprintPerimeterCells(origin, getBuildingFootprint(buildingType, orientation)).some((cell) => (
    isPointInBounds(cell, state) && !approachBlocked.has(pointKey(cell))
  ));
}

export function isRallyPointAvailable(state: MatchState, producerId: EntityId, target: GridPoint): boolean {
  const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === producerId && entity.kind === "building");
  if (!producer || !isTrainingProducer(producer.typeId) || !producer.complete || producer.hitPoints <= 0) return false;
  if (!isExactWalkTargetAvailable(state, target)) return false;
  const blocked = getPathBlockedCells(state);
  return getFootprintPerimeterCells(producer.position, getBuildingFootprint(producer.typeId, producer.orientation)).some((start) => (
    isPointInBounds(start, state)
    && isMapCellWalkable(state, start)
    && !isMapCellBlocked(state, start)
    && findPathRoute(start, target, state.map.width, state.map.height, blocked) !== null
  ));
}

function validateGameCommand(state: MatchState, player: PlayerState, command: GameCommand): CommandValidation {
  if (command.type === "surrender") return { ok: true };
  if (command.type === "advanceSettlement") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (producer.typeId !== "townCenter") return rejected("INVALID_PAYLOAD");
    if (!producer.complete || producer.hitPoints <= 0 || producer.productionQueue.length > 0 || player.advancement !== null) return rejected("ACTION_ON_COOLDOWN");
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
    const orientation = command.orientation ?? "ne";
    const footprint = getFootprintCells(command.origin, getBuildingFootprint(command.buildingType, orientation));
    if (!footprint.every((cell) => isPointInBounds(cell, state))) return rejected("TARGET_NOT_REACHABLE");
    if (!meetsTier(player.settlementTier, BUILDINGS[command.buildingType].requiredTier)) return rejected("PREREQUISITE_NOT_MET");
    if (!footprint.every((cell) => isTileVisibleToPlayer(state, player.id, cell))) return rejected("TARGET_NOT_VISIBLE");
    if (!isBuildLocationAvailable(state, command.buildingType, command.origin, orientation)) return rejected("TARGET_NOT_REACHABLE");
    const builderIds = new Set(builders.map((builder) => builder.id));
    if (state.entities.some((entity) => entity.kind === "unit" && entity.hitPoints > 0 && !builderIds.has(entity.id) && footprint.some((cell) => samePoint(cell, entity.position)))) return rejected("TARGET_NOT_REACHABLE");
    const blocked = [...getPathBlockedCells(state), ...footprint];
    const approachCells = getFootprintPerimeterCells(command.origin, getBuildingFootprint(command.buildingType, orientation))
      .filter((cell) => isPointInBounds(cell, state) && isMapCellWalkable(state, cell));
    if (builders.some((builder) => findPathToAny(builder.position, approachCells, state.map.width, state.map.height, blocked) === null)) return rejected("TARGET_NOT_REACHABLE");
    return canAfford(player.resources, BUILDINGS[command.buildingType].cost) ? { ok: true } : rejected("INSUFFICIENT_RESOURCES");
  }
  if (command.type === "train") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (!producer.complete || producer.hitPoints <= 0 || producer.productionQueue.length + command.count > MAX_TRAINING_QUEUE_DEPTH || player.advancement?.producerId === producer.id) return rejected("ACTION_ON_COOLDOWN");
    const definition = UNITS[command.unitType];
    if (!definition.producers.includes(producer.typeId)) return rejected("INVALID_PAYLOAD");
    if (!meetsTier(player.settlementTier, definition.requiredTier)) return rejected("PREREQUISITE_NOT_MET");
    if (usedPopulation(state, player.id) + queuedPopulation(state, player.id) + definition.population * command.count > player.population.capacity || countUnits(state, player.id) + command.count > MAX_UNITS_PER_PLAYER) return rejected("ACTION_ON_COOLDOWN");
    return canAfford(player.resources, multiplyWallet(definition.cost, command.count)) ? { ok: true } : rejected("INSUFFICIENT_RESOURCES");
  }
  if (command.type === "research") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    const definition = TECHNOLOGIES[command.technologyId];
    if (producer.typeId !== definition.producer) return rejected("INVALID_PAYLOAD");
    if (!producer.complete || producer.hitPoints <= 0 || producer.productionQueue.length >= MAX_TRAINING_QUEUE_DEPTH || player.advancement?.producerId === producer.id) return rejected("ACTION_ON_COOLDOWN");
    if (!meetsTier(player.settlementTier, definition.requiredTier)) return rejected("PREREQUISITE_NOT_MET");
    if (player.completedTechnologyIds.includes(command.technologyId) || hasQueuedTechnology(state, player.id, command.technologyId)) return rejected("DUPLICATE_RESEARCH");
    if (!definition.prerequisites.every((technologyId) => player.completedTechnologyIds.includes(technologyId))) return rejected("PREREQUISITE_NOT_MET");
    return canAfford(player.resources, definition.cost) ? { ok: true } : rejected("INSUFFICIENT_RESOURCES");
  }
  if (command.type === "cancelProduction") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (!producer.complete || producer.hitPoints <= 0) return rejected("ACTION_ON_COOLDOWN");
    return producer.productionQueue.some((job) => sameProductionJobId(job.jobId, command.jobId))
      ? { ok: true }
      : rejected("PRODUCTION_JOB_NOT_FOUND");
  }
  if (command.type === "setRallyPoint") {
    const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building");
    if (!producer || producer.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (!isTrainingProducer(producer.typeId)) return rejected("INVALID_PAYLOAD");
    if (!producer.complete || producer.hitPoints <= 0) return rejected("ACTION_ON_COOLDOWN");
    if (command.target !== null && !isTileVisibleToPlayer(state, player.id, command.target)) return rejected("TARGET_NOT_VISIBLE");
    return command.target === null || isRallyPointAvailable(state, producer.id, command.target)
      ? { ok: true }
      : rejected("TARGET_NOT_REACHABLE");
  }
  if (command.type === "setGateState") {
    const gate = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.gateId && entity.kind === "building");
    if (!gate || gate.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (gate.typeId !== "surveyGate") return rejected("INVALID_PAYLOAD");
    if (!gate.complete || gate.hitPoints <= 0 || gate.gateOpen === command.open) return rejected("ACTION_ON_COOLDOWN");
    if (!command.open) {
      const footprint = getEntityFootprintCells(gate);
      const occupied = state.entities.some((entity) => entity.kind === "unit" && entity.hitPoints > 0 && footprint.some((cell) => samePoint(cell, entity.position)));
      if (occupied) return rejected("TARGET_NOT_REACHABLE");
    }
    return { ok: true };
  }
  if (command.type === "castAbility") {
    const caster = state.entities.find((entity): entity is UnitEntityState => entity.id === command.casterId && entity.kind === "unit");
    if (!caster || caster.ownerId !== player.id) return rejected("ENTITY_NOT_OWNED");
    if (caster.typeId === "villager") return rejected("INVALID_PAYLOAD");
    const ability = COMBAT_UNITS[caster.typeId].activeAbility;
    if (command.abilityId !== ability.id || !abilityTargetMatches(ability.targeting, command.target)) return rejected("INVALID_PAYLOAD");
    if (caster.hitPoints <= 0 || caster.combat.phase !== "ready" || state.tick < caster.abilityReadyTick || hasStatus(caster, "stagger")) return rejected("ABILITY_NOT_READY");
    return validateAbilityTarget(state, player.id, caster, command.target);
  }
  const ids = command.entityIds;
  const units = ownedUnits(state, player.id, ids);
  if (!units) return rejected("ENTITY_NOT_OWNED");
  if (command.type === "move" || command.type === "attackMove") return isMovementTargetAvailableToPlayer(state, player.id, command.target) ? { ok: true } : rejected("TARGET_NOT_REACHABLE");
  if (command.type === "patrol") return command.waypoints.every((point) => isMovementTargetAvailableToPlayer(state, player.id, point)) ? { ok: true } : rejected("TARGET_NOT_REACHABLE");
  if (command.type === "setStance" || command.type === "setFormation") return { ok: true };
  if (command.type === "stop") return { ok: true };
  const target = state.entities.find((entity) => entity.id === command.targetId);
  // Missing and fog-hidden target IDs are intentionally indistinguishable to prevent entity-ID probing.
  if (!target) return rejected("TARGET_NOT_VISIBLE");
  if (!isEntityVisibleToPlayer(state, player.id, target)) return rejected("TARGET_NOT_VISIBLE");
  if (command.type === "gather") {
    const resourceKind = gatherSourceKind(target);
    if (!resourceKind || gatherSourceAmount(target) <= 0 || units.some((unit) => unit.typeId !== "villager")) return rejected("INVALID_PAYLOAD");
    if (units.some((unit) => !isEntityReachable(state, unit.position, target))) return rejected("TARGET_NOT_REACHABLE");
    if (units.some((unit) => {
      const capacity = unit.cargoCapacity;
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
  if (command.type === "repair") {
    if (units.some((unit) => unit.typeId !== "villager") || target.kind !== "building" || !arePlayersAllied(state, player.id, target.ownerId) || !target.complete || target.hitPoints <= 0 || target.hitPoints >= target.maxHitPoints) return rejected("INVALID_PAYLOAD");
    if (player.resources.wood < 1) return rejected("INSUFFICIENT_RESOURCES");
    return units.every((unit) => isEntityReachable(state, unit.position, target)) ? { ok: true } : rejected("TARGET_NOT_REACHABLE");
  }
  if (target.kind === "resource" || target.kind === "rubble") return rejected("INVALID_PAYLOAD");
  if (target.kind !== "monster" && (target.ownerId === null || !arePlayersHostile(state, player.id, target.ownerId))) return rejected("INVALID_PAYLOAD");
  return { ok: true };
}

function applyGameCommand(state: MatchState, player: PlayerState, commandSequence: number, command: GameCommand, events: DomainEvent[]): void {
  switch (command.type) {
    case "move":
      setFormationMovementOrders(state, command.entityIds, command.target, "move", events);
      break;
    case "attackMove":
      setFormationMovementOrders(state, command.entityIds, command.target, "attackMove", events);
      break;
    case "attack":
      setOrders(state, command.entityIds, { type: "attack", targetId: command.targetId }, events);
      break;
    case "gather": {
      const target = state.entities.find((entity) => entity.id === command.targetId)!;
      const resourceKind = gatherSourceKind(target)!;
      for (const id of command.entityIds) {
        const unit = state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
        if (unit.order.type === "gather" && unit.order.targetId === command.targetId && unit.order.resourceKind === resourceKind) continue;
        const capacity = unit.cargoCapacity;
        const mustDeposit = unit.cargo.amount > 0 && (unit.cargo.kind !== resourceKind || unit.cargo.amount >= capacity);
        unit.order = {
          type: "gather",
          targetId: command.targetId,
          resourceKind,
          phase: mustDeposit ? "toDropOff" : "toSource",
          dropOffId: mustDeposit ? findNearestDropOff(state, unit.ownerId, unit.cargo.kind!, unit.position)?.id ?? null : null,
        };
        cancelCombatAction(state, unit, events);
        unit.stateRevision += 1;
      }
      break;
    }
    case "dropOff":
      setOrders(state, command.entityIds, { type: "deliver", targetId: command.targetId }, events);
      break;
    case "repair":
      setOrders(state, command.entityIds, { type: "repair", targetId: command.targetId }, events);
      break;
    case "patrol":
      setOrders(state, command.entityIds, { type: "patrol", waypoints: [...command.waypoints], waypointIndex: 0 }, events);
      break;
    case "stop":
      setOrders(state, command.entityIds, { type: "idle" }, events);
      break;
    case "setStance":
      for (const id of command.entityIds) {
        const unit = state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
        unit.stance = command.stance;
        unit.stateRevision += 1;
      }
      break;
    case "setFormation":
      for (const id of command.entityIds) {
        const unit = state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
        unit.formation = command.formation;
        unit.stateRevision += 1;
      }
      break;
    case "castAbility": {
      const caster = state.entities.find((entity): entity is UnitEntityState => entity.id === command.casterId && entity.kind === "unit")!;
      beginAbility(state, caster, command.abilityId, command.target, events);
      break;
    }
    case "build": {
      const building = createBuilding(state, player.id, command.buildingType, command.origin, false, command.orientation ?? "ne");
      state.entities.push(building);
      subtractWallet(player, BUILDINGS[command.buildingType].cost);
      setOrders(state, command.builderIds, { type: "construct", targetId: building.id }, events);
      events.push({ type: "entitySpawned", entity: toPublicEntity(building) });
      break;
    }
    case "train": {
      const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building")!;
      const definition = UNITS[command.unitType];
      subtractWallet(player, multiplyWallet(definition.cost, command.count));
      for (let index = 0; index < command.count; index += 1) {
        producer.productionQueue.push({
          jobId: { commandSequence, itemIndex: index },
          kind: "train",
          unitType: command.unitType,
          remainingTicks: definition.trainTicks,
          totalTicks: definition.trainTicks,
          paidCost: { ...definition.cost },
        });
      }
      producer.stateRevision += 1;
      break;
    }
    case "research": {
      const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building")!;
      const definition = TECHNOLOGIES[command.technologyId];
      subtractWallet(player, definition.cost);
      producer.productionQueue.push({
        jobId: { commandSequence, itemIndex: 0 },
        kind: "research",
        technologyId: command.technologyId,
        remainingTicks: definition.researchTicks,
        totalTicks: definition.researchTicks,
        paidCost: { ...definition.cost },
      });
      producer.stateRevision += 1;
      break;
    }
    case "cancelProduction": {
      const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building")!;
      const formerQueueIndex = producer.productionQueue.findIndex((job) => sameProductionJobId(job.jobId, command.jobId));
      const [job] = producer.productionQueue.splice(formerQueueIndex, 1);
      const refunded = productionRefund(job!);
      addWallet(player, refunded);
      producer.stateRevision += 1;
      events.push({
        type: "productionCancelled",
        playerId: player.id,
        producerId: producer.id,
        jobId: { ...job!.jobId },
        formerQueueIndex,
        job: job!.kind === "train" ? { kind: "train", unitType: job!.unitType } : { kind: "research", technologyId: job!.technologyId },
        remainingTicks: job!.remainingTicks,
        refunded,
      });
      break;
    }
    case "setRallyPoint": {
      const producer = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.producerId && entity.kind === "building")!;
      producer.rallyPoint = command.target ? { ...command.target } : null;
      producer.stateRevision += 1;
      events.push({ type: "rallyPointChanged", playerId: player.id, producerId: producer.id, target: producer.rallyPoint ? { ...producer.rallyPoint } : null });
      break;
    }
    case "setGateState": {
      const gate = state.entities.find((entity): entity is BuildingEntityState => entity.id === command.gateId && entity.kind === "building")!;
      gate.gateOpen = command.open;
      gate.stateRevision += 1;
      events.push({ type: "gateStateChanged", playerId: player.id, gateId: gate.id, open: gate.gateOpen });
      events.push({ type: "entityUpdated", entity: toPublicEntity(gate) });
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
      player.advancement = null;
      deactivatePlayerAssets(state, player.id, events);
      break;
  }
}

function advanceOneTick(state: MatchState, events: DomainEvent[]): void {
  state.tick += 1;
  expirePlayerMonsterBoons(state);
  const resources = state.entities
    .filter((entity): entity is ResourceEntityState => entity.kind === "resource")
    .sort((left, right) => compareText(left.id, right.id));
  for (const resource of resources) updateRenewableResourceNode(state, resource, events);
  const units = state.entities
    .filter((entity): entity is UnitEntityState => entity.kind === "unit")
    .sort((left, right) => compareText(left.id, right.id));
  for (const unit of units) {
    unit.attackCooldownTicks = Math.max(0, unit.attackCooldownTicks - 1);
    unit.workCooldownTicks = Math.max(0, unit.workCooldownTicks - 1);
    updateStatuses(state, unit, events);
    if (unit.hitPoints <= 0 || !isPlayerOperational(state, unit.ownerId)) continue;
    updateUnit(state, unit, events);
  }
  const monsters = state.entities
    .filter((entity): entity is MonsterEntityState => entity.kind === "monster")
    .sort((left, right) => compareText(left.id, right.id));
  for (const monster of monsters) {
    monster.attackCooldownTicks = Math.max(0, monster.attackCooldownTicks - 1);
    updateStatuses(state, monster, events);
    if (monster.hitPoints > 0) updateMonster(state, monster, events);
  }
  const buildings = state.entities
    .filter((entity): entity is BuildingEntityState => entity.kind === "building")
    .sort((left, right) => compareText(left.id, right.id));
  for (const building of buildings) {
    building.attackCooldownTicks = Math.max(0, building.attackCooldownTicks - 1);
    updateStatuses(state, building, events);
    if (isPlayerOperational(state, building.ownerId)) updateTower(state, building, events);
  }
  updateProjectiles(state, events);
  // Resolve every production job only after unit and tower actions. A research
  // completion therefore benefits all entities uniformly from the next action tick.
  for (const building of buildings) if (isPlayerOperational(state, building.ownerId)) updateProduction(state, building, events);
  const removed = state.entities.filter((entity) => (
    entity.kind === "resource"
      ? entity.amount <= 0 && entity.renewAtTick === null
      : entity.kind === "rubble"
        ? state.tick >= entity.decayAtTick
        : entity.hitPoints <= 0
  )).sort((left, right) => compareText(left.id, right.id));
  if (removed.length > 0) {
    const removedIds = new Set(removed.map((entity) => entity.id));
    state.entities = state.entities.filter((entity) => !removedIds.has(entity.id));
    for (const entity of removed) {
      const reason = entity.kind === "resource" ? "depleted" : entity.kind === "rubble" ? "despawned" : "destroyed";
      events.push({ type: "entityRemoved", entityId: entity.id, entity: toPublicEntity(entity), reason });
      if (entity.kind === "building" && BUILDINGS[entity.typeId].leavesRubble) {
        const rubble = createRubble(state, entity);
        state.entities.push(rubble);
        events.push({ type: "entitySpawned", entity: toPublicEntity(rubble) });
        events.push({
          type: "breachCreated",
          structureId: entity.id,
          rubbleId: rubble.id,
          ownerId: entity.ownerId,
          position: { ...entity.position },
          createdTick: state.tick,
          effectExpiresAtTick: state.tick + 25,
        });
      }
      if (entity.kind === "monster") resolveMonsterReward(state, entity, events);
    }
  }
  updateSettlementAdvancements(state, events);
  syncPopulation(state);
  updateVisibilityState(state);
  evaluateVictory(state, events, true);
}

function expirePlayerMonsterBoons(state: MatchState): void {
  for (const player of state.players) {
    player.activeMonsterBoons = player.activeMonsterBoons.filter((boon) => boon.expiresAtTick > state.tick);
  }
}

function isPlayerOperational(state: MatchState, playerId: PlayerId): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return Boolean(player && !player.surrendered && !player.eliminated);
}

function updateUnit(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): void {
  updateUnitPassives(state, unit, events);
  if (hasStatus(unit, "stagger")) {
    if (unit.combat.phase !== "ready") cancelCombatAction(state, unit, events);
    return;
  }
  if (progressCombatAction(state, unit, events)) return;
  const order = unit.order;
  if (order.type === "idle") {
    const target = findAutomaticTarget(state, unit);
    if (target) unit.order = { type: "attack", targetId: target.id };
    return;
  }
  if (order.type === "move") {
    if (moveToward(state, unit, order.target)) unit.order = { type: "idle" };
    return;
  }
  if (order.type === "attackMove") {
    const engaged = order.engagedTargetId ? state.entities.find((entity) => entity.id === order.engagedTargetId) : undefined;
    const target = engaged && isValidHostileTarget(state, unit.ownerId, engaged) && isEntityVisibleToPlayer(state, unit.ownerId, engaged)
      ? engaged
      : findAutomaticTarget(state, unit, true);
    order.engagedTargetId = target?.id ?? null;
    if (target) {
      updateAttackOrder(state, unit, target, events);
      return;
    }
    if (moveToward(state, unit, order.target)) unit.order = { type: "idle" };
    return;
  }
  if (order.type === "patrol") {
    const automaticTarget = findAutomaticTarget(state, unit, true);
    if (automaticTarget) {
      updateAttackOrder(state, unit, automaticTarget, events);
      return;
    }
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
  if (order.type === "repair") {
    updateRepairOrder(state, unit, target);
    return;
  }
  if (order.type === "construct") {
    if (target.kind !== "building" || target.complete) { unit.order = { type: "idle" }; return; }
    if (!isEntityInteractionCell(unit.position, target)) { moveTowardEntity(state, unit, target); return; }
    const totalTicks = Math.max(1, BUILDINGS[target.typeId].buildTicks);
    const previousCap = Math.max(1, Math.floor(target.maxHitPoints * (1 - target.constructionRemainingTicks / totalTicks)));
    target.constructionRemainingTicks = Math.max(0, target.constructionRemainingTicks - 1);
    const nextCap = Math.max(1, Math.floor(target.maxHitPoints * (1 - target.constructionRemainingTicks / totalTicks)));
    target.hitPoints = Math.min(nextCap, target.hitPoints + Math.max(0, nextCap - previousCap));
    target.stateRevision += 1;
    if (target.constructionRemainingTicks === 0) {
      target.complete = true;
      unit.order = { type: "idle" };
      events.push({ type: "entityUpdated", entity: toPublicEntity(target) });
    }
    return;
  }
  updateAttackOrder(state, unit, target, events);
}

/** Deterministic neutral retaliation: a camp only hunts the team that first damaged it. */
function updateMonster(state: MatchState, monster: MonsterEntityState, events: DomainEvent[]): void {
  if (hasStatus(monster, "stagger")) {
    if (monster.combat.phase !== "ready") setMonsterCombatPhase(monster, "ready", null, events);
    return;
  }
  if (progressMonsterAbility(state, monster, events)) return;
  if (monster.provokedAtTick !== null && state.tick <= monster.provokedAtTick) return;
  const definition = MONSTERS[monster.typeId];
  const candidates = monster.provokedByTeamId === null
    ? []
    : state.entities
      .filter((entity): entity is UnitEntityState | BuildingEntityState => (
        (entity.kind === "unit" || entity.kind === "building")
        && entity.hitPoints > 0
        && state.players.find((player) => player.id === entity.ownerId)?.teamId === monster.provokedByTeamId
        && distanceSquaredToEntity(monster.home, entity) <= monster.leashRadius * monster.leashRadius
      ))
      .sort((left, right) => compareMonsterTargets(monster, left, right));
  const target = candidates.find((candidate) => candidate.id === monster.targetId) ?? candidates[0];
  if (!target) {
    monster.targetId = null;
    if (samePoint(monster.position, monster.home)) {
      if (monster.provokedByTeamId !== null) {
        monster.provokedByTeamId = null;
        monster.provokedAtTick = null;
        monster.camouflageReady = monster.typeId === "miremaw";
        monster.camouflageSpeedUntilTick = 0;
        monster.stateRevision += 1;
      }
      return;
    }
    moveMonsterToward(state, monster, monster.home);
    return;
  }
  if (monster.targetId !== target.id) {
    monster.targetId = target.id;
    monster.stateRevision += 1;
  }
  monster.facing = quantizeFacing(target.position.x - monster.position.x, target.position.y - monster.position.y, monster.facing);
  const abilityRange = monster.typeId === "ashwing" ? 4 : 3;
  if (state.tick >= monster.abilityReadyTick && distanceSquaredToEntity(monster.position, target) <= abilityRange * abilityRange) {
    beginMonsterAbility(state, monster, target, events);
    return;
  }
  if (distanceSquaredToEntity(monster.position, target) > definition.attackRange * definition.attackRange) {
    moveMonsterToward(state, monster, closestApproachableEntityCell(state, monster.position, target));
    return;
  }
  if (monster.attackCooldownTicks > 0) return;
  const enraged = monster.typeId === "rootback" && monster.hitPoints * 100 <= monster.maxHitPoints * 40;
  const damage = calculateDamage({ baseDamage: definition.baseDamage, armor: entityArmor(target), skillMultiplier: enraged ? 1.25 : 1 });
  applyDamage(state, monster.id, target, damage, events);
  monster.attackCooldownTicks = millisecondsToTicks(Math.floor(definition.attackIntervalMs * (enraged ? 0.75 : 1)));
  monster.stateRevision += 1;
}

function compareMonsterTargets(monster: MonsterEntityState, left: UnitEntityState | BuildingEntityState, right: UnitEntityState | BuildingEntityState): number {
  if (monster.typeId === "ashwing") {
    const leftRange = left.kind === "unit" ? UNITS[left.typeId].attackRange : 0;
    const rightRange = right.kind === "unit" ? UNITS[right.typeId].attackRange : 0;
    const rangedPriority = rightRange - leftRange;
    if (rangedPriority !== 0) return rangedPriority;
    const healthPriority = left.hitPoints * right.maxHitPoints - right.hitPoints * left.maxHitPoints;
    if (healthPriority !== 0) return healthPriority;
  }
  if (monster.typeId === "rootback" && left.kind !== right.kind) return left.kind === "building" ? -1 : 1;
  return distanceSquaredToEntity(monster.position, left) - distanceSquaredToEntity(monster.position, right)
    || compareText(left.id, right.id);
}

function beginMonsterAbility(
  state: MatchState,
  monster: MonsterEntityState,
  target: UnitEntityState | BuildingEntityState,
  events: DomainEvent[],
): void {
  const ability = MONSTERS[monster.typeId].activeAbility;
  const targetPoint = monster.typeId === "ashwing"
    ? closestApproachableEntityCell(state, monster.position, target)
    : { ...target.position };
  monster.combat = {
    phase: "windup",
    action: "ability",
    abilityId: ability.id,
    target: { kind: "ground", point: targetPoint },
    commitTick: state.tick + millisecondsToTicks(ability.windupMs),
    readyTick: state.tick + millisecondsToTicks(ability.windupMs + ability.recoveryMs),
  };
  monster.abilityReadyTick = state.tick + millisecondsToTicks(ability.cooldownMs);
  monster.stateRevision += 1;
  events.push({ type: "combatPhaseChanged", entityId: monster.id, phase: "windup", action: "ability" });
}

function progressMonsterAbility(state: MatchState, monster: MonsterEntityState, events: DomainEvent[]): boolean {
  const combat = monster.combat;
  if (combat.phase === "ready") return false;
  if (combat.phase === "windup" && combat.commitTick !== null && state.tick >= combat.commitTick) {
    setMonsterCombatPhase(monster, "commit", "ability", events);
    resolveMonsterAbility(state, monster, events);
    return true;
  }
  if (combat.phase === "commit") {
    setMonsterCombatPhase(monster, "recovery", "ability", events);
    return true;
  }
  if (combat.phase === "recovery" && state.tick >= combat.readyTick) {
    setMonsterCombatPhase(monster, "ready", null, events);
    return false;
  }
  return true;
}

function setMonsterCombatPhase(
  monster: MonsterEntityState,
  phase: AbilityPhase,
  action: "ability" | null,
  events: DomainEvent[],
): void {
  if (monster.combat.phase === phase && monster.combat.action === action) return;
  monster.combat.phase = phase;
  monster.combat.action = action;
  if (phase === "ready") {
    monster.combat.abilityId = null;
    monster.combat.target = null;
    monster.combat.commitTick = null;
    monster.combat.readyTick = 0;
  }
  monster.stateRevision += 1;
  events.push({ type: "combatPhaseChanged", entityId: monster.id, phase, action });
}

function resolveMonsterAbility(state: MatchState, monster: MonsterEntityState, events: DomainEvent[]): void {
  const target = monster.combat.target;
  if (target?.kind !== "ground") return;
  const ability = MONSTERS[monster.typeId].activeAbility;
  if (monster.typeId === "ashwing" && isMapCellWalkable(state, target.point) && !isMapCellBlocked(state, target.point)) {
    monster.facing = quantizeFacing(target.point.x - monster.position.x, target.point.y - monster.position.y, monster.facing);
    monster.position = { ...target.point };
    monster.movementProgress = 0;
    monster.stateRevision += 1;
  }
  const radiusSquared = monster.typeId === "rootback" ? 4 : 3;
  const enraged = monster.typeId === "rootback" && monster.hitPoints * 100 <= monster.maxHitPoints * 40;
  const victims = state.entities
    .filter((entity): entity is UnitEntityState | BuildingEntityState => (
      (entity.kind === "unit" || entity.kind === "building")
      && entity.ownerId !== null
      && entity.hitPoints > 0
      && distanceSquaredToEntity(target.point, entity) <= radiusSquared
    ))
    .sort((left, right) => compareText(left.id, right.id));
  for (const victim of victims) {
    const damage = calculateDamage({
      baseDamage: MONSTERS[monster.typeId].baseDamage,
      armor: entityArmor(victim),
      skillMultiplier: (ability.damageMultiplier ?? 1) * (enraged ? 1.25 : 1),
    });
    applyDamage(state, monster.id, victim, damage, events);
    for (const statusId of ability.statusEffects) applyStatus(state, monster.id, victim, statusId, events);
  }
}

function resolveMonsterReward(state: MatchState, monster: MonsterEntityState, events: DomainEvent[]): void {
  if (monster.rewardGranted) return;
  monster.rewardGranted = true;
  const byTeam = new Map<string, { damage: number; firstHitTick: number }>();
  for (const contribution of monster.contributions) {
    const current = byTeam.get(contribution.teamId);
    if (current) {
      current.damage += contribution.actualDamage;
      current.firstHitTick = Math.min(current.firstHitTick, contribution.firstHitTick);
    } else {
      byTeam.set(contribution.teamId, { damage: contribution.actualDamage, firstHitTick: contribution.firstHitTick });
    }
  }
  const creditedTeamId = [...byTeam.entries()]
    .sort((left, right) => right[1].damage - left[1].damage || left[1].firstHitTick - right[1].firstHitTick || compareText(left[0], right[0]))[0]?.[0] ?? null;
  events.push({ type: "monsterDefeated", monsterId: monster.id, monsterTypeId: monster.typeId, creditedTeamId });
  if (creditedTeamId === null) return;
  const recipients = state.players
    .filter((player) => player.teamId === creditedTeamId && !player.eliminated && !player.surrendered)
    .sort((left, right) => compareText(left.id, right.id));
  if (recipients.length === 0) return;
  const definition = MONSTERS[monster.typeId];
  const total = { food: definition.reward.food, wood: definition.reward.wood, stone: definition.reward.stone };
  const shares = recipients.map((player, index) => ({
    player,
    reward: {
      food: Math.floor(total.food / recipients.length) + (index < total.food % recipients.length ? 1 : 0),
      wood: Math.floor(total.wood / recipients.length) + (index < total.wood % recipients.length ? 1 : 0),
      stone: Math.floor(total.stone / recipients.length) + (index < total.stone % recipients.length ? 1 : 0),
    },
  }));
  for (const { player, reward } of shares) {
    addWallet(player, reward);
    const boon = grantMonsterBoon(player, definition.reward.buffId, definition.reward.buffDurationMs, state.tick);
    events.push({
      type: "monsterRewardGranted",
      monsterId: monster.id,
      monsterTypeId: monster.typeId,
      playerId: player.id,
      reward,
      boon,
    });
  }
}

function grantMonsterBoon(
  player: PlayerState,
  boonId: MonsterBoonId | undefined,
  durationMs: number | undefined,
  currentTick: number,
): ActiveMonsterBoon | null {
  if (boonId === undefined || durationMs === undefined) return null;
  const granted = { id: boonId, expiresAtTick: currentTick + millisecondsToTicks(durationMs) } satisfies ActiveMonsterBoon;
  const existing = player.activeMonsterBoons.find((boon) => boon.id === boonId);
  const resolved = existing
    ? { id: boonId, expiresAtTick: Math.max(existing.expiresAtTick, granted.expiresAtTick) }
    : granted;
  player.activeMonsterBoons = player.activeMonsterBoons.filter((boon) => boon.id !== boonId);
  player.activeMonsterBoons.push({ ...resolved });
  player.activeMonsterBoons.sort((left, right) => compareText(left.id, right.id));
  return { ...resolved };
}

function moveMonsterToward(state: MatchState, monster: MonsterEntityState, target: GridPoint): void {
  const camouflageBurst = monster.typeId === "miremaw" && state.tick < monster.camouflageSpeedUntilTick ? 1.35 : 1;
  const speedMilliTilesPerSecond = Math.max(1, Math.floor(MONSTERS[monster.typeId].moveSpeed * 1_000 * camouflageBurst));
  const stepCost = 1_000 * TICKS_PER_SECOND;
  monster.movementProgress += speedMilliTilesPerSecond;
  if (monster.movementProgress < stepCost) return;
  const next = findNextPathStep(monster.position, target, state.map.width, state.map.height, getPathBlockedCells(state));
  if (!next) {
    monster.movementProgress = stepCost;
    return;
  }
  monster.movementProgress -= stepCost;
  if (samePoint(next, monster.position)) return;
  monster.facing = quantizeFacing(next.x - monster.position.x, next.y - monster.position.y, monster.facing);
  monster.position = next;
  monster.stateRevision += 1;
}

function updateAttackOrder(state: MatchState, unit: UnitEntityState, target: EntityState, events: DomainEvent[]): void {
  if (!isValidHostileTarget(state, unit.ownerId, target) || !isEntityVisibleToPlayer(state, unit.ownerId, target)) {
    if (unit.order.type === "attack") unit.order = { type: "idle" };
    return;
  }
  clearWarriorRhythmForTarget(unit, target.id);
  const attackRange = effectiveBasicAttackRange(state, unit);
  if (distanceSquaredToEntity(unit.position, target) > attackRange * attackRange) {
    beginMovementForPassive(state, unit, events);
    moveToward(state, unit, closestApproachableEntityCell(state, unit.position, target));
    return;
  }
  if (unit.attackCooldownTicks > 0 || unit.combat.phase !== "ready") return;
  beginBasicAttack(state, unit, target, events);
}

function beginBasicAttack(state: MatchState, unit: UnitEntityState, target: EntityState, events: DomainEvent[]): void {
  const hasRestedMatchlock = unit.typeId === "musketeer" && isStationaryForTicks(state, unit, 15);
  const cooldownTicks = hasRestedMatchlock
    ? Math.max(1, Math.floor(UNITS[unit.typeId].attackCooldownTicks * 0.8))
    : UNITS[unit.typeId].attackCooldownTicks;
  const windupTicks = Math.max(1, Math.min(5, Math.floor(cooldownTicks / 4)));
  unit.facing = quantizeFacing(target.position.x - unit.position.x, target.position.y - unit.position.y, unit.facing);
  unit.combat = {
    phase: "windup",
    action: "attack",
    abilityId: null,
    target: { kind: "entity", entityId: target.id },
    commitTick: state.tick + windupTicks,
    readyTick: state.tick + cooldownTicks,
  };
  unit.attackCooldownTicks = cooldownTicks;
  unit.stateRevision += 1;
  events.push({ type: "combatPhaseChanged", entityId: unit.id, phase: "windup", action: "attack" });
}

function beginAbility(state: MatchState, unit: UnitEntityState, abilityId: string, target: AbilityTarget, events: DomainEvent[]): void {
  if (unit.typeId === "villager") return;
  const ability = COMBAT_UNITS[unit.typeId].activeAbility;
  const windupTicks = millisecondsToTicks(ability.windupMs);
  const recoveryTicks = millisecondsToTicks(ability.recoveryMs);
  unit.combat = {
    phase: "windup",
    action: "ability",
    abilityId,
    target: cloneAbilityTarget(target),
    commitTick: state.tick + windupTicks,
    readyTick: state.tick + windupTicks + recoveryTicks,
  };
  unit.stateRevision += 1;
  events.push({ type: "combatPhaseChanged", entityId: unit.id, phase: "windup", action: "ability" });
}

function progressCombatAction(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): boolean {
  if (unit.combat.phase === "ready") return false;
  if (unit.combat.phase === "windup") {
    if (unit.combat.commitTick === null || state.tick < unit.combat.commitTick) return true;
    if (unit.combat.action === "attack") commitBasicAttack(state, unit, events);
    else if (unit.combat.action === "ability") commitAbility(state, unit, events);
    setCombatPhase(unit, "recovery", unit.combat.action, events);
  }
  if (state.tick < unit.combat.readyTick) return true;
  setCombatPhase(unit, "ready", null, events);
  return false;
}

function commitBasicAttack(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): void {
  const targetId = unit.combat.target?.kind === "entity" ? unit.combat.target.entityId : null;
  const target = targetId ? state.entities.find((entity) => entity.id === targetId) : undefined;
  if (!target || !isValidHostileTarget(state, unit.ownerId, target)) return;
  const attackRange = effectiveBasicAttackRange(state, unit);
  if (distanceSquaredToEntity(unit.position, target) > attackRange * attackRange) return;
  const profileId = unit.typeId === "villager" ? undefined : COMBAT_UNITS[unit.typeId].projectileProfileId;
  const rhythmMultiplier = unit.typeId === "warrior" && unit.passive.rhythmTargetId === target.id && state.tick - unit.passive.rhythmLastHitTick <= 20
    ? 1 + Math.min(3, unit.passive.rhythmStacks) * 0.05
    : 1;
  const momentumMultiplier = unit.typeId === "boarRider" && unit.passive.movedTilesSinceAttack >= 3 ? 1.2 : 1;
  const emplacedStructureMultiplier = unit.typeId === "heavyCrossbowman" && target.kind === "building" && hasStatus(unit, "emplaced") ? 1.6 * 1.2 : null;
  const damage = calculateUnitDamage(state, unit, target, rhythmMultiplier * momentumMultiplier, null, profileId !== undefined, emplacedStructureMultiplier);
  if (profileId) spawnProjectile(state, unit.ownerId, unit.id, unit.position, target, profileId, damage, [], events);
  else applyDamage(state, unit.id, target, damage, events);
  if (unit.typeId === "warrior") {
    unit.passive.rhythmStacks = unit.passive.rhythmTargetId === target.id && state.tick - unit.passive.rhythmLastHitTick <= 20
      ? Math.min(3, unit.passive.rhythmStacks + 1)
      : 1;
    unit.passive.rhythmTargetId = target.id;
    unit.passive.rhythmLastHitTick = state.tick;
  } else if (unit.typeId === "musketeer" && isStationaryForTicks(state, unit, 15)) {
    unit.passive.stationarySinceTick = state.tick;
  } else if (unit.typeId === "boarRider") {
    unit.passive.movedTilesSinceAttack = 0;
  }
}

function commitAbility(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): void {
  if (unit.typeId === "villager" || unit.combat.abilityId === null || unit.combat.target === null) return;
  const definition = COMBAT_UNITS[unit.typeId];
  const ability = definition.activeAbility;
  if (ability.id !== unit.combat.abilityId) return;
  unit.abilityReadyTick = state.tick + millisecondsToTicks(ability.cooldownMs);
  const target = unit.combat.target;
  if (target.kind === "self") {
    for (const statusId of ability.statusEffects) applyStatus(state, unit.id, unit, statusId, events);
    return;
  }
  if (target.kind === "ground" && (ability.id === "pinningVolley" || ability.id === "emberSigil")) {
    spawnGroundAreaProjectiles(state, unit, target.point, ability.id, ability.damageMultiplier ?? 1, [...ability.statusEffects], events);
    return;
  }
  if (target.kind === "direction" && ability.id === "breachingBolt") {
    spawnLineProjectile(state, unit, target.vector, ability.id, ability.damageMultiplier ?? 1, events);
    return;
  }
  let candidates = abilityCandidates(state, unit, target)
    .slice(0, ability.projectileProfileId ? PROJECTILE_PROFILES[ability.projectileProfileId].maxTargets : 6);
  const bracedChargeTargets = new Set<EntityId>();
  if (ability.id === "tuskCharge" && target.kind === "direction") {
    candidates = candidates.slice(0, 1);
    for (const candidate of candidates) {
      if (candidate.kind === "unit" && candidate.typeId === "shieldBearer" && hasStatus(candidate, "braced") && isInFrontArc(candidate, unit.position)) {
        bracedChargeTargets.add(candidate.id);
      }
    }
    moveAlongChargeLine(state, unit, target.vector, 6, events);
  }
  if (ability.id === "breachingBolt") {
    const firstBuilding = candidates.findIndex((candidate) => candidate.kind === "building");
    if (firstBuilding >= 0) candidates = candidates.slice(0, firstBuilding + 1);
  }
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const projectileProfileId = ability.projectileProfileId ?? definition.projectileProfileId;
    const chargeBraceMultiplier = bracedChargeTargets.has(candidate.id) ? STATUS_EFFECTS.braced.magnitude : 1;
    const skillMultiplier = (ability.damageMultiplier ?? 1) * (ability.id === "breachingBolt" && candidateIndex === 1 ? 0.75 : 1) * chargeBraceMultiplier;
    const structureMultiplier = ability.id === "breachingBolt" && candidate.kind === "building" ? 1.45 : null;
    const damage = calculateUnitDamage(state, unit, candidate, skillMultiplier, ability.id, projectileProfileId !== undefined, structureMultiplier);
    if (projectileProfileId) {
      const fixedImpactPoint = target.kind === "ground" ? target.point : target.kind === "direction" ? candidate.position : null;
      spawnProjectile(state, unit.ownerId, unit.id, unit.position, candidate, projectileProfileId, damage, [...ability.statusEffects], events, fixedImpactPoint);
    } else {
      applyDamage(state, unit.id, candidate, damage, events);
      if (candidate.kind === "unit" || candidate.kind === "building" || candidate.kind === "monster") {
        for (const statusId of ability.statusEffects) {
          if (!bracedChargeTargets.has(candidate.id)) applyStatus(state, unit.id, candidate, statusId, events);
        }
      }
    }
    if (bracedChargeTargets.has(candidate.id) && candidate.kind === "unit") {
      removeStatus(candidate, "braced", events);
      candidate.passive.braceCooldownUntilTick = state.tick + 60;
      applyStatus(state, candidate.id, unit, "stagger", events);
    } else if (ability.id === "tuskCharge" && target.kind === "direction" && candidate.kind === "unit") {
      pushUnitByForce(state, candidate, target.vector, events);
    }
  }
}

function pushUnitByForce(state: MatchState, unit: UnitEntityState, vector: GridPoint, events: DomainEvent[]): void {
  const dx = Math.sign(vector.x);
  const dy = Math.sign(vector.y);
  if (dx === 0 && dy === 0) return;
  const destination = { x: unit.position.x + dx, y: unit.position.y + dy };
  if (!isPointInBounds(destination, state) || !isMapCellWalkable(state, destination) || isMapCellBlocked(state, destination)) return;
  unit.facing = quantizeFacing(dx, dy, unit.facing);
  unit.position = destination;
  recordUnitMovement(state, unit, 1, events);
  unit.movementProgress = 0;
  unit.stateRevision += 1;
}

function moveAlongChargeLine(state: MatchState, unit: UnitEntityState, vector: GridPoint, maximumTiles: number, events: DomainEvent[]): void {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0) return;
  const origin = { ...unit.position };
  let destination = origin;
  for (let distance = 1; distance <= maximumTiles; distance += 1) {
    const point = {
      x: origin.x + Math.round(vector.x / length * distance),
      y: origin.y + Math.round(vector.y / length * distance),
    };
    if (samePoint(point, destination)) continue;
    if (!isPointInBounds(point, state) || !isMapCellWalkable(state, point) || isMapCellBlocked(state, point)) break;
    destination = point;
  }
  if (samePoint(origin, destination)) return;
  unit.facing = quantizeFacing(destination.x - origin.x, destination.y - origin.y, unit.facing);
  unit.position = destination;
  recordUnitMovement(state, unit, Math.hypot(destination.x - origin.x, destination.y - origin.y), events);
  unit.movementProgress = 0;
  unit.stateRevision += 1;
}

function abilityCandidates(state: MatchState, unit: UnitEntityState, target: Exclude<AbilityTarget, { kind: "self" }>): EntityState[] {
  if (target.kind === "entity") {
    const entity = state.entities.find((candidate) => candidate.id === target.entityId);
    return entity
      && (entity.kind === "unit" || entity.kind === "monster")
      && isValidHostileTarget(state, unit.ownerId, entity)
      && isEntityVisibleToPlayer(state, unit.ownerId, entity)
      && distanceSquaredToEntity(unit.position, entity) <= UNITS[unit.typeId].attackRange ** 2
      ? [entity]
      : [];
  }
  if (target.kind === "ground") {
    return state.entities
      .filter((entity) => isValidHostileTarget(state, unit.ownerId, entity) && distanceSquaredToEntity(target.point, entity) <= 4)
      .sort((left, right) => distanceSquaredToEntity(target.point, left) - distanceSquaredToEntity(target.point, right) || compareText(left.id, right.id));
  }
  const length = Math.hypot(target.vector.x, target.vector.y);
  const dx = target.vector.x / length;
  const dy = target.vector.y / length;
  const range = unit.typeId === "boarRider" ? 6 : Math.max(3, UNITS[unit.typeId].attackRange);
  return state.entities
    .filter((entity) => {
      if (!isValidHostileTarget(state, unit.ownerId, entity)) return false;
      const ex = entity.position.x - unit.position.x;
      const ey = entity.position.y - unit.position.y;
      const forward = ex * dx + ey * dy;
      const lateral = Math.abs(ex * dy - ey * dx);
      return forward > 0 && forward <= range && lateral <= 1;
    })
    .sort((left, right) => distanceSquared(unit.position, left.position) - distanceSquared(unit.position, right.position) || compareText(left.id, right.id));
}

function setCombatPhase(unit: UnitEntityState, phase: AbilityPhase, action: "attack" | "ability" | null, events: DomainEvent[]): void {
  if (unit.combat.phase === phase && unit.combat.action === action) return;
  unit.combat.phase = phase;
  unit.combat.action = action;
  if (phase === "ready") {
    unit.combat.abilityId = null;
    unit.combat.target = null;
    unit.combat.commitTick = null;
    unit.combat.readyTick = 0;
  }
  unit.stateRevision += 1;
  events.push({ type: "combatPhaseChanged", entityId: unit.id, phase, action });
}

function cancelCombatAction(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): void {
  if (unit.combat.phase === "recovery") return;
  if (unit.combat.phase === "windup" && unit.combat.action === "ability" && unit.typeId !== "villager") {
    const fullCooldown = millisecondsToTicks(COMBAT_UNITS[unit.typeId].activeAbility.cooldownMs);
    unit.abilityReadyTick = Math.max(unit.abilityReadyTick, state.tick + Math.ceil(fullCooldown * 0.3));
  }
  setCombatPhase(unit, "ready", null, events);
}

function calculateUnitDamage(
  state: MatchState,
  attacker: UnitEntityState,
  target: EntityState,
  skillMultiplier: number,
  abilityId: string | null = null,
  deferProjectileShield = false,
  structureMultiplierOverride: number | null = null,
): number {
  const targetArmor = entityArmor(target);
  const armorBreak = (target.kind === "unit" || target.kind === "building" || target.kind === "monster") && hasStatus(target, "armorBreak") ? STATUS_EFFECTS.armorBreak.magnitude : 0;
  const attackerDefinition = attacker.typeId === "villager" ? null : COMBAT_UNITS[attacker.typeId];
  const shieldWallApplies = target.kind === "unit"
    && hasStatus(target, "shieldWall")
    && attackerDefinition !== null
    && attackerDefinition.damageType !== "arcane"
    && attackerDefinition.projectileProfileId !== undefined
    && isInFrontArc(target, attacker.position);
  const statusMultiplier = shieldWallApplies && !deferProjectileShield ? STATUS_EFFECTS.shieldWall.magnitude : 1;
  const counterMultiplier = combatCounterMultiplier(attacker.typeId, target);
  const structureMultiplier = structureMultiplierOverride ?? (target.kind === "building"
    ? attacker.typeId === "heavyCrossbowman" ? 1.6 : attacker.typeId === "boarRider" ? 0.8 : 1
    : 1);
  return calculateDamage({
    baseDamage: getEffectiveUnitAttackDamage(state, attacker.ownerId, attacker.typeId),
    armor: targetArmor,
    armorBreak,
    counterMultiplier,
    skillMultiplier,
    statusMultiplier,
    structureMultiplier,
    armorIgnore: abilityId === "aimedShot" ? 0.6 : attacker.typeId === "mage" ? 0.35 : 0,
  });
}

function isInFrontArc(unit: UnitEntityState, source: GridPoint): boolean {
  const facing = ({
    e: { x: 1, y: 0 }, ne: { x: 0.5, y: -0.866 }, nw: { x: -0.5, y: -0.866 },
    w: { x: -1, y: 0 }, sw: { x: -0.5, y: 0.866 }, se: { x: 0.5, y: 0.866 },
  } satisfies Record<Facing, { x: number; y: number }>)[unit.facing];
  const dx = source.x - unit.position.x;
  const dy = source.y - unit.position.y;
  const length = Math.hypot(dx, dy);
  return length > 0 && (facing.x * dx + facing.y * dy) / length >= 0.5;
}

function applyDamage(
  state: MatchState,
  sourceId: EntityId,
  target: EntityState,
  rawDamage: number,
  events: DomainEvent[],
  sourceOwnerId?: PlayerId,
): void {
  if (target.kind === "resource" || target.kind === "rubble" || target.hitPoints <= 0) return;
  const previousBand = target.kind === "building" ? getStructureHealthBand(target) : null;
  const damage = damageAfterVillageTrait(state, target, Math.max(1, Math.floor(rawDamage)));
  const actualDamage = Math.min(target.hitPoints, damage);
  target.hitPoints = Math.max(0, target.hitPoints - damage);
  if (target.kind === "monster" && actualDamage > 0) {
    const source = state.entities.find((entity) => entity.id === sourceId);
    const resolvedOwnerId = source?.ownerId ?? sourceOwnerId ?? null;
    if (resolvedOwnerId !== null) {
      const attacker = state.players.find((player) => player.id === resolvedOwnerId);
      if (attacker) {
        const contribution = target.contributions.find((entry) => entry.playerId === attacker.id);
        if (contribution) {
          contribution.actualDamage += actualDamage;
          contribution.lastHitTick = state.tick;
        } else {
          target.contributions.push({
            playerId: attacker.id,
            teamId: attacker.teamId,
            actualDamage,
            firstHitTick: state.tick,
            lastHitTick: state.tick,
          });
          target.contributions.sort((left, right) => compareText(left.playerId, right.playerId));
        }
        if (target.provokedByTeamId === null) {
          target.provokedByTeamId = attacker.teamId;
          target.provokedAtTick = state.tick;
          target.targetId = source?.id ?? null;
          if (target.typeId === "miremaw" && target.camouflageReady) {
            target.camouflageReady = false;
            target.camouflageSpeedUntilTick = state.tick + 20;
          }
          events.push({ type: "monsterProvoked", monsterId: target.id, monsterTypeId: target.typeId, teamId: attacker.teamId, sourceId });
        }
      }
    }
  }
  target.stateRevision += 1;
  events.push({ type: "entityDamaged", sourceId, targetId: target.id, amount: damage, hitPoints: target.hitPoints });
  if (target.kind === "building" && previousBand !== getStructureHealthBand(target)) {
    events.push({ type: "entityUpdated", entity: toPublicEntity(target) });
  }
}

function spawnGroundAreaProjectiles(
  state: MatchState,
  unit: UnitEntityState,
  targetPoint: GridPoint,
  abilityId: string,
  skillMultiplier: number,
  statusEffects: readonly StatusEffectId[],
  events: DomainEvent[],
): void {
  const isVolley = abilityId === "pinningVolley";
  const profileId: ProjectileProfileId = isVolley ? "pinningVolley" : "arcaneCinder";
  const groupId = `projectile-group-${state.nextEntityNumber}`;
  const damage: ProjectileDamageSpec = {
    sourceUnitType: unit.typeId as CombatUnitId,
    baseDamage: getEffectiveUnitAttackDamage(state, unit.ownerId, unit.typeId),
    abilityId,
    skillMultiplier,
    structureMultiplierBonus: 1,
  };
  const count = isVolley ? 3 : 1;
  for (let index = 0; index < count; index += 1) {
    spawnResolvingProjectile(state, unit, profileId, targetPoint, statusEffects, {
      kind: "groundArea",
      groupId,
      hitAll: !isVolley,
      maxHitsPerTarget: isVolley ? 2 : 1,
      radiusSquared: 2.25,
      damage,
    }, events);
  }
}

function spawnLineProjectile(
  state: MatchState,
  unit: UnitEntityState,
  vector: GridPoint,
  abilityId: string,
  skillMultiplier: number,
  events: DomainEvent[],
): void {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0) return;
  const range = Math.max(3, UNITS[unit.typeId].attackRange);
  const targetPoint = clampPoint({
    x: Math.round(unit.position.x + vector.x / length * range),
    y: Math.round(unit.position.y + vector.y / length * range),
  }, state);
  spawnResolvingProjectile(state, unit, "breachingBolt", targetPoint, [], {
    kind: "line",
    origin: { ...unit.position },
    maxTargets: 2,
    halfWidth: 1,
    lastResolvedDistance: 0,
    hitTargetIds: [],
    damage: {
      sourceUnitType: unit.typeId as CombatUnitId,
      baseDamage: getEffectiveUnitAttackDamage(state, unit.ownerId, unit.typeId),
      abilityId,
      skillMultiplier,
      structureMultiplierBonus: hasStatus(unit, "emplaced") ? 1.2 : 1,
    },
  }, events);
}

function spawnResolvingProjectile(
  state: MatchState,
  unit: UnitEntityState,
  profileId: ProjectileProfileId,
  intendedTargetPoint: GridPoint,
  statusEffects: readonly StatusEffectId[],
  resolution: Exclude<ProjectileResolution, null>,
  events: DomainEvent[],
): void {
  const profile = PROJECTILE_PROFILES[profileId];
  const terrainImpact = profile.blockedByTerrain ? firstProjectileTerrainImpact(state, unit.position, intendedTargetPoint) : null;
  const targetPoint = terrainImpact ?? intendedTargetPoint;
  const minimumTicks = millisecondsToTicks(profile.minTravelMs);
  const travelTicks = profile.speedTilesPerSecond === null
    ? minimumTicks
    : Math.ceil(Math.sqrt(distanceSquared(unit.position, targetPoint)) / profile.speedTilesPerSecond * TICKS_PER_SECOND);
  const projectile: ProjectileState = {
    id: nextId(state, "projectile"),
    ownerId: unit.ownerId,
    sourceId: unit.id,
    profileId,
    origin: { ...unit.position },
    position: { ...unit.position },
    targetId: null,
    targetPoint: { ...targetPoint },
    fixedImpact: true,
    launchTick: state.tick,
    impactTick: state.tick + Math.max(minimumTicks, travelTicks),
    damage: 0,
    statusEffects: [...statusEffects],
    resolution,
  };
  state.projectiles.push(projectile);
  events.push({ type: "projectileSpawned", projectile: toPublicProjectile(projectile) });
}

function spawnProjectile(
  state: MatchState,
  ownerId: PlayerId,
  sourceId: EntityId,
  origin: GridPoint,
  target: EntityState,
  profileId: ProjectileProfileId,
  damage: number,
  statusEffects: readonly StatusEffectId[],
  events: DomainEvent[],
  fixedImpactPoint: GridPoint | null = null,
): void {
  const profile = PROJECTILE_PROFILES[profileId];
  const intendedTargetPoint = fixedImpactPoint ?? target.position;
  const terrainImpact = profile.blockedByTerrain ? firstProjectileTerrainImpact(state, origin, intendedTargetPoint) : null;
  const targetPoint = terrainImpact ?? intendedTargetPoint;
  const minimumTicks = millisecondsToTicks(profile.minTravelMs);
  const travelTicks = profile.speedTilesPerSecond === null
    ? minimumTicks
    : Math.ceil(Math.sqrt(distanceSquared(origin, targetPoint)) / profile.speedTilesPerSecond * TICKS_PER_SECOND);
  const projectile: ProjectileState = {
    id: nextId(state, "projectile"),
    ownerId,
    sourceId,
    profileId,
    origin: { ...origin },
    position: { ...origin },
    targetId: terrainImpact ? null : target.id,
    targetPoint: { ...targetPoint },
    fixedImpact: fixedImpactPoint !== null,
    launchTick: state.tick,
    impactTick: state.tick + Math.max(minimumTicks, travelTicks),
    damage,
    statusEffects: [...statusEffects],
    resolution: null,
  };
  state.projectiles.push(projectile);
  events.push({ type: "projectileSpawned", projectile: toPublicProjectile(projectile) });
}

function firstProjectileTerrainImpact(state: MatchState, origin: GridPoint, target: GridPoint): GridPoint | null {
  if (state.map.id !== VILLAGE_ASSAULT_MAP_ID) return null;
  const blocked = new Set(getVillageAssaultWalkBlockedCells(state.map.layoutId).map(pointKey));
  let x = origin.x;
  let y = origin.y;
  const dx = Math.abs(target.x - origin.x);
  const dy = Math.abs(target.y - origin.y);
  const stepX = origin.x < target.x ? 1 : -1;
  const stepY = origin.y < target.y ? 1 : -1;
  let error = dx - dy;
  while (x !== target.x || y !== target.y) {
    const doubled = error * 2;
    if (doubled > -dy) { error -= dy; x += stepX; }
    if (doubled < dx) { error += dx; y += stepY; }
    const point = { x, y };
    if (blocked.has(pointKey(point))) return point;
  }
  return null;
}

function updateProjectiles(state: MatchState, events: DomainEvent[]): void {
  for (const projectile of state.projectiles) updateProjectilePosition(state, projectile);
  const active = state.projectiles
    .filter((projectile) => projectile.resolution?.kind === "line" || projectile.impactTick <= state.tick)
    .sort((left, right) => compareText(left.id, right.id));
  if (active.length === 0) return;
  const completedIds = new Set<EntityId>();
  const areaHitCounts = new Map<string, Map<EntityId, number>>();
  for (const projectile of active) {
    if (projectile.resolution?.kind === "line") {
      const result = advanceLineProjectile(state, projectile, events);
      if (result !== null) {
        events.push({ type: "projectileImpacted", projectileId: projectile.id, position: result.position, targetIds: result.targetIds });
        completedIds.add(projectile.id);
      }
      continue;
    }
    const impacted: EntityId[] = [];
    let impactPosition = projectile.targetPoint;
    if (projectile.resolution?.kind === "groundArea") {
      const resolution = projectile.resolution;
      const groupCounts = areaHitCounts.get(resolution.groupId) ?? new Map<EntityId, number>();
      areaHitCounts.set(resolution.groupId, groupCounts);
      const candidates = state.entities
        .filter((entity) => isValidHostileTarget(state, projectile.ownerId, entity) && distanceSquaredToEntity(projectile.targetPoint, entity) <= resolution.radiusSquared)
        .sort((left, right) => distanceSquaredToEntity(projectile.targetPoint, left) - distanceSquaredToEntity(projectile.targetPoint, right) || compareText(left.id, right.id));
      const targets = resolution.hitAll
        ? candidates
        : candidates.filter((candidate) => (groupCounts.get(candidate.id) ?? 0) < resolution.maxHitsPerTarget).slice(0, 1);
      for (const target of targets) {
        const priorHits = groupCounts.get(target.id) ?? 0;
        const rawDamage = projectileDamageFromSpec(state, projectile, target, 1);
        applyDamage(state, projectile.sourceId, target, projectileDamageAtImpact(projectile, target, rawDamage), events, projectile.ownerId);
        if ((target.kind === "unit" || target.kind === "building" || target.kind === "monster") && priorHits === 0) {
          for (const statusId of projectile.statusEffects) applyStatus(state, projectile.sourceId, target, statusId, events, projectile.ownerId);
        }
        groupCounts.set(target.id, priorHits + 1);
        impacted.push(target.id);
      }
    } else {
      const target = projectile.targetId ? state.entities.find((entity) => entity.id === projectile.targetId) : undefined;
      const remainsInImpactArea = target !== undefined && distanceSquaredToEntity(projectile.targetPoint, target) <= (projectile.fixedImpact ? 4 : 0);
      if (target && remainsInImpactArea && isValidHostileTarget(state, projectile.ownerId, target)) {
        applyDamage(state, projectile.sourceId, target, projectileDamageAtImpact(projectile, target), events, projectile.ownerId);
        if (target.kind === "unit" || target.kind === "building" || target.kind === "monster") for (const statusId of projectile.statusEffects) applyStatus(state, projectile.sourceId, target, statusId, events, projectile.ownerId);
        impacted.push(target.id);
      }
    }
    events.push({ type: "projectileImpacted", projectileId: projectile.id, position: { ...impactPosition }, targetIds: impacted });
    completedIds.add(projectile.id);
  }
  state.projectiles = state.projectiles.filter((projectile) => !completedIds.has(projectile.id));
}

function updateProjectilePosition(state: MatchState, projectile: ProjectileState): void {
  if (projectile.resolution?.kind === "line") return;
  const duration = Math.max(1, projectile.impactTick - projectile.launchTick);
  const elapsed = Math.max(0, Math.min(duration, state.tick - projectile.launchTick));
  projectile.position = {
    x: Math.round(projectile.origin.x + (projectile.targetPoint.x - projectile.origin.x) * elapsed / duration),
    y: Math.round(projectile.origin.y + (projectile.targetPoint.y - projectile.origin.y) * elapsed / duration),
  };
}

function projectileDamageAtImpact(projectile: ProjectileState, target: EntityState, rawDamage = projectile.damage): number {
  if (target.kind !== "unit" || !hasStatus(target, "shieldWall") || projectile.profileId === "arcaneCinder") return rawDamage;
  return isInFrontArc(target, projectile.origin)
    ? Math.max(1, Math.round(rawDamage * STATUS_EFFECTS.shieldWall.magnitude))
    : rawDamage;
}

function projectileDamageFromSpec(state: MatchState, projectile: ProjectileState, target: EntityState, hitMultiplier: number): number {
  const resolution = projectile.resolution;
  if (resolution === null) return projectile.damage;
  const spec = resolution.damage;
  const targetArmor = entityArmor(target);
  const armorBreak = (target.kind === "unit" || target.kind === "building" || target.kind === "monster") && hasStatus(target, "armorBreak") ? STATUS_EFFECTS.armorBreak.magnitude : 0;
  const counterMultiplier = combatCounterMultiplier(spec.sourceUnitType, target);
  const structureMultiplier = target.kind === "building"
    ? (spec.abilityId === "breachingBolt" ? 1.45 : spec.sourceUnitType === "heavyCrossbowman" ? 1.6 : spec.sourceUnitType === "boarRider" ? 0.8 : 1) * spec.structureMultiplierBonus
    : 1;
  return calculateDamage({
    baseDamage: spec.baseDamage,
    armor: targetArmor,
    armorBreak,
    counterMultiplier,
    skillMultiplier: spec.skillMultiplier * hitMultiplier,
    structureMultiplier,
    armorIgnore: spec.sourceUnitType === "mage" ? 0.35 : 0,
  });
}

function advanceLineProjectile(
  state: MatchState,
  projectile: ProjectileState,
  events: DomainEvent[],
): { position: GridPoint; targetIds: EntityId[] } | null {
  if (projectile.resolution?.kind !== "line") return null;
  const resolution = projectile.resolution;
  const dx = projectile.targetPoint.x - resolution.origin.x;
  const dy = projectile.targetPoint.y - resolution.origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return { position: { ...projectile.targetPoint }, targetIds: [...resolution.hitTargetIds] };
  const durationTicks = Math.max(1, projectile.impactTick - projectile.launchTick);
  const progress = Math.max(0, Math.min(1, (state.tick - projectile.launchTick) / durationTicks));
  const currentDistance = length * progress;
  const ux = dx / length;
  const uy = dy / length;
  const candidates = lineProjectileTargetsBetween(state, projectile, resolution.lastResolvedDistance, currentDistance, ux, uy);
  let stopDistance: number | null = null;
  for (const { entity, forward } of candidates) {
    if (resolution.hitTargetIds.includes(entity.id)) continue;
    const hitIndex = resolution.hitTargetIds.length;
    const rawDamage = projectileDamageFromSpec(state, projectile, entity, hitIndex === 0 ? 1 : 0.75);
    applyDamage(state, projectile.sourceId, entity, projectileDamageAtImpact(projectile, entity, rawDamage), events, projectile.ownerId);
    if (entity.kind === "unit" || entity.kind === "building" || entity.kind === "monster") for (const statusId of projectile.statusEffects) applyStatus(state, projectile.sourceId, entity, statusId, events, projectile.ownerId);
    resolution.hitTargetIds.push(entity.id);
    if (entity.kind === "building" || resolution.hitTargetIds.length >= resolution.maxTargets) {
      stopDistance = forward;
      break;
    }
  }
  resolution.lastResolvedDistance = currentDistance;
  const resolvedDistance = stopDistance ?? currentDistance;
  projectile.position = {
    x: Math.round(resolution.origin.x + ux * resolvedDistance),
    y: Math.round(resolution.origin.y + uy * resolvedDistance),
  };
  if (stopDistance === null && state.tick < projectile.impactTick) return null;
  return {
    position: { ...projectile.position },
    targetIds: [...resolution.hitTargetIds],
  };
}

function lineProjectileTargetsBetween(
  state: MatchState,
  projectile: ProjectileState,
  fromDistance: number,
  toDistance: number,
  ux: number,
  uy: number,
): { entity: EntityState; forward: number }[] {
  if (projectile.resolution?.kind !== "line" || toDistance <= fromDistance) return [];
  const resolution = projectile.resolution;
  return state.entities
    .map((entity) => {
      const intersections = getEntityFootprintCells(entity)
        .map((cell) => {
          const ex = cell.x - resolution.origin.x;
          const ey = cell.y - resolution.origin.y;
          return { forward: ex * ux + ey * uy, lateral: Math.abs(ex * uy - ey * ux) };
        })
        .filter(({ forward, lateral }) => forward > fromDistance + Number.EPSILON && forward <= toDistance + Number.EPSILON && lateral <= resolution.halfWidth)
        .sort((left, right) => left.forward - right.forward || left.lateral - right.lateral);
      return { entity, forward: intersections[0]?.forward ?? Number.POSITIVE_INFINITY };
    })
    .filter(({ entity, forward }) => isValidHostileTarget(state, projectile.ownerId, entity) && Number.isFinite(forward))
    .sort((left, right) => left.forward - right.forward || compareText(left.entity.id, right.entity.id));
}

function applyStatus(
  state: MatchState,
  sourceId: EntityId,
  target: UnitEntityState | BuildingEntityState | MonsterEntityState,
  statusId: StatusEffectId,
  events: DomainEvent[],
  sourceOwnerId?: PlayerId,
): void {
  target.statuses ??= [];
  if (statusId === "stagger" && hasStatus(target, "tenacity")) return;
  const definition: StatusEffectDefinition = STATUS_EFFECTS[statusId];
  const durationTicks = millisecondsToTicks(definition.durationMs);
  const expiresAtTick = durationTicks === 0 ? Number.MAX_SAFE_INTEGER : state.tick + durationTicks;
  const existing = target.statuses.find((status) => status.id === statusId);
  const nextTickAt = definition.tickIntervalMs === undefined ? null : state.tick + millisecondsToTicks(definition.tickIntervalMs);
  const resolvedSourceOwnerId = state.entities.find((entity) => entity.id === sourceId)?.ownerId ?? sourceOwnerId ?? null;
  if (existing) {
    existing.sourceId = sourceId;
    existing.sourceOwnerId = resolvedSourceOwnerId;
    existing.expiresAtTick = expiresAtTick;
    existing.nextTickAt = nextTickAt;
  } else {
    target.statuses.push({ id: statusId, sourceId, sourceOwnerId: resolvedSourceOwnerId, expiresAtTick, nextTickAt });
    target.statuses.sort((left, right) => compareText(left.id, right.id) || compareText(left.sourceId, right.sourceId));
  }
  target.stateRevision += 1;
  events.push({ type: "statusApplied", sourceId, targetId: target.id, statusId, expiresAtTick });
  if (statusId === "stagger" && target.kind === "unit" && target.combat.phase !== "ready") {
    cancelCombatAction(state, target, events);
  }
}

function updateStatuses(state: MatchState, target: UnitEntityState | BuildingEntityState | MonsterEntityState, events: DomainEvent[]): void {
  target.statuses ??= [];
  for (const status of target.statuses) {
    const definition: StatusEffectDefinition = STATUS_EFFECTS[status.id];
    if (status.id === "burn" && status.nextTickAt !== null && status.nextTickAt <= state.tick && target.hitPoints > 0) {
      applyDamage(state, status.sourceId, target, Math.max(1, Math.floor(definition.magnitude)), events, status.sourceOwnerId ?? undefined);
      status.nextTickAt += millisecondsToTicks(definition.tickIntervalMs ?? 1_000);
    }
  }
  const expired = target.statuses.filter((status) => status.expiresAtTick <= state.tick);
  if (expired.length === 0) return;
  const expiredIds = new Set(expired.map((status) => status.id));
  target.statuses = target.statuses.filter((status) => !expiredIds.has(status.id));
  target.stateRevision += 1;
  for (const status of expired) {
    events.push({ type: "statusExpired", entityId: target.id, statusId: status.id });
    const granted = (STATUS_EFFECTS[status.id] as StatusEffectDefinition).grantsStatusId;
    if (granted) applyStatus(state, status.sourceId, target, granted, events, status.sourceOwnerId ?? undefined);
  }
}

function updateRepairOrder(state: MatchState, unit: UnitEntityState, target: EntityState): void {
  if (unit.typeId !== "villager" || target.kind !== "building" || !target.complete || target.hitPoints <= 0 || !arePlayersAllied(state, unit.ownerId, target.ownerId)) {
    unit.order = { type: "idle" };
    return;
  }
  if (target.hitPoints >= target.maxHitPoints) {
    unit.order = { type: "idle" };
    return;
  }
  if (!isEntityInteractionCell(unit.position, target)) {
    moveTowardEntity(state, unit, target);
    return;
  }
  if (unit.workCooldownTicks > 0) return;
  const player = state.players.find((candidate) => candidate.id === unit.ownerId)!;
  if (player.resources.wood < 1) return;
  player.resources = { ...player.resources, wood: player.resources.wood - 1 };
  target.hitPoints = Math.min(target.maxHitPoints, target.hitPoints + 10);
  target.stateRevision += 1;
  unit.workCooldownTicks = 10;
}

function findAutomaticTarget(state: MatchState, unit: UnitEntityState, force = false): EntityState | undefined {
  if (unit.typeId === "villager" || (!force && unit.stance === "holdGround")) return undefined;
  const sight = UNITS[unit.typeId].sightRadius;
  const radius = !force && unit.stance === "defensive" ? Math.max(1, Math.floor(sight / 2)) : sight;
  return state.entities
    .filter((entity) => isAutomaticHostileTarget(state, unit.ownerId, entity) && isEntityVisibleToPlayer(state, unit.ownerId, entity) && distanceSquaredToEntity(unit.position, entity) <= radius * radius)
    .sort((left, right) => distanceSquaredToEntity(unit.position, left) - distanceSquaredToEntity(unit.position, right) || compareText(left.id, right.id))[0];
}

function isValidHostileTarget(state: MatchState, ownerId: PlayerId, target: EntityState): boolean {
  if (target.hitPoints <= 0 || target.kind === "resource" || target.kind === "rubble") return false;
  if (target.kind === "monster") return true;
  return target.ownerId !== null && arePlayersHostile(state, ownerId, target.ownerId);
}

function isAutomaticHostileTarget(state: MatchState, ownerId: PlayerId, target: EntityState): boolean {
  if (target.kind !== "monster") return isValidHostileTarget(state, ownerId, target);
  const teamId = state.players.find((player) => player.id === ownerId)?.teamId;
  return target.hitPoints > 0 && teamId !== undefined && target.provokedByTeamId === teamId;
}

function hasStatus(entity: UnitEntityState | BuildingEntityState | MonsterEntityState, statusId: StatusEffectId): boolean {
  return (entity.statuses ?? []).some((status) => status.id === statusId);
}

function removeStatus(entity: UnitEntityState | BuildingEntityState | MonsterEntityState, statusId: StatusEffectId, events?: DomainEvent[]): void {
  if (!hasStatus(entity, statusId)) return;
  entity.statuses = entity.statuses.filter((status) => status.id !== statusId);
  entity.stateRevision += 1;
  events?.push({ type: "statusExpired", entityId: entity.id, statusId });
}

function clearWarriorRhythmForTarget(unit: UnitEntityState, targetId: EntityId): void {
  if (unit.typeId !== "warrior" || unit.passive.rhythmTargetId === null || unit.passive.rhythmTargetId === targetId) return;
  unit.passive.rhythmTargetId = null;
  unit.passive.rhythmStacks = 0;
  unit.passive.rhythmLastHitTick = 0;
}

function combatCounterMultiplier(attackerType: UnitType, target: EntityState): number {
  if (attackerType === "villager" || target.kind !== "unit" || target.typeId === "villager") return 1;
  if (attackerType === "archer" && target.typeId === "heavyCrossbowman" && !hasStatus(target, "emplaced")) return 1;
  return COMBAT_UNITS[attackerType].counterModifiers[target.typeId];
}

function updateUnitPassives(state: MatchState, unit: UnitEntityState, events: DomainEvent[]): void {
  if (unit.typeId === "warrior" && unit.passive.rhythmTargetId !== null && state.tick - unit.passive.rhythmLastHitTick > 20) {
    unit.passive.rhythmTargetId = null;
    unit.passive.rhythmStacks = 0;
  }
  if (unit.typeId === "boarRider" && unit.passive.movedTilesSinceAttack > 0 && state.tick - unit.passive.stationarySinceTick > 10) {
    unit.passive.movedTilesSinceAttack = 0;
  }
  const stationary = isStationaryForPassive(state, unit);
  if (unit.typeId === "shieldBearer") {
    if (stationary && !hasStatus(unit, "stagger") && state.tick >= unit.passive.braceCooldownUntilTick && isStationaryForTicks(state, unit, 8)) {
      if (!hasStatus(unit, "braced")) applyStatus(state, unit.id, unit, "braced", events);
    } else if (!stationary) {
      removeStatus(unit, "braced", events);
    }
  }
  if (unit.typeId === "heavyCrossbowman") {
    if (stationary && !hasStatus(unit, "stagger") && isStationaryForTicks(state, unit, 20)) {
      if (!hasStatus(unit, "emplaced")) applyStatus(state, unit.id, unit, "emplaced", events);
    } else if (!stationary) {
      removeStatus(unit, "emplaced", events);
    }
  }
}

function isStationaryForTicks(state: MatchState, unit: UnitEntityState, ticks: number): boolean {
  return isStationaryForPassive(state, unit) && state.tick - unit.passive.stationarySinceTick >= ticks;
}

function isStationaryForPassive(state: MatchState, unit: UnitEntityState): boolean {
  if (unit.order.type === "idle") return true;
  if (unit.order.type === "attack") {
    const targetId = unit.order.targetId;
    const target = state.entities.find((entity) => entity.id === targetId);
    return target !== undefined && distanceSquaredToEntity(unit.position, target) <= effectiveBasicAttackRange(state, unit) ** 2;
  }
  if (unit.order.type === "attackMove" && unit.order.engagedTargetId !== null) {
    const targetId = unit.order.engagedTargetId;
    const target = state.entities.find((entity) => entity.id === targetId);
    return target !== undefined && distanceSquaredToEntity(unit.position, target) <= effectiveBasicAttackRange(state, unit) ** 2;
  }
  return false;
}

function effectiveBasicAttackRange(state: MatchState, unit: UnitEntityState): number {
  const base = UNITS[unit.typeId].attackRange;
  if (unit.typeId === "heavyCrossbowman" && hasStatus(unit, "emplaced")) return base + 1;
  if (unit.typeId === "musketeer" && state.tick - unit.passive.stationarySinceTick >= 15) {
    if (unit.order.type === "idle") return base + 1;
    if (unit.order.type === "attack") {
      const targetId = unit.order.targetId;
      const target = state.entities.find((entity) => entity.id === targetId);
      if (target !== undefined && distanceSquaredToEntity(unit.position, target) <= (base + 1) ** 2) return base + 1;
    }
    if (unit.order.type === "attackMove" && unit.order.engagedTargetId !== null) {
      const targetId = unit.order.engagedTargetId;
      const target = state.entities.find((entity) => entity.id === targetId);
      if (target !== undefined && distanceSquaredToEntity(unit.position, target) <= (base + 1) ** 2) return base + 1;
    }
  }
  return base;
}

function beginMovementForPassive(state: MatchState, unit: UnitEntityState, events?: DomainEvent[]): void {
  unit.passive.stationarySinceTick = state.tick;
  removeStatus(unit, "braced", events);
  removeStatus(unit, "emplaced", events);
}

function recordUnitMovement(state: MatchState, unit: UnitEntityState, tiles: number, events?: DomainEvent[]): void {
  unit.passive.stationarySinceTick = state.tick;
  unit.passive.movedTilesSinceAttack += Math.max(0, tiles);
  removeStatus(unit, "braced", events);
  removeStatus(unit, "emplaced", events);
}

function entityArmor(entity: EntityState): number {
  if (entity.kind === "resource" || entity.kind === "rubble") return 0;
  if (entity.kind === "monster") return MONSTERS[entity.typeId].armor;
  if (entity.kind === "unit") return entity.typeId === "villager" ? 0 : COMBAT_UNITS[entity.typeId].armor;
  return BUILDINGS[entity.typeId].armor;
}

function statusAdjustedSpeed(state: MatchState, unit: UnitEntityState): number {
  const base = getEffectiveUnitSpeedMilliTilesPerSecond(state, unit.ownerId, unit.typeId);
  const slowMultiplier = hasStatus(unit, "slow") ? 1 - STATUS_EFFECTS.slow.magnitude : 1;
  const shieldMultiplier = hasStatus(unit, "shieldWall") ? 0.65 : 1;
  return Math.max(1, Math.floor(base * slowMultiplier * shieldMultiplier));
}

function millisecondsToTicks(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / (1_000 / TICKS_PER_SECOND)));
}

function cloneAbilityTarget(target: AbilityTarget): AbilityTarget {
  if (target.kind === "self") return { kind: "self" };
  if (target.kind === "entity") return { kind: "entity", entityId: target.entityId };
  if (target.kind === "ground") return { kind: "ground", point: { ...target.point } };
  return { kind: "direction", vector: { ...target.vector } };
}

function updateGatherOrder(
  state: MatchState,
  unit: UnitEntityState,
  order: Extract<UnitOrder, { type: "gather" }>,
  events: DomainEvent[],
): void {
  const capacity = unit.cargoCapacity;
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
      || compareText(left.entity.id, right.entity.id)
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
    .sort((left, right) => left.route.distance - right.route.distance || compareText(left.entity.id, right.entity.id))[0]?.entity ?? null;
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
  const multiplierPermille = getEffectiveGatherRatePermille(state, unit.ownerId, unit.typeId, resourceKind);
  const accumulatedMilli = unit.gatherRemainderMilli[resourceKind] + base * multiplierPermille;
  const gathered = Math.floor(accumulatedMilli / 1_000);
  unit.gatherRemainderMilli = {
    ...unit.gatherRemainderMilli,
    [resourceKind]: accumulatedMilli % 1_000,
  };
  return gathered;
}

function updateProduction(state: MatchState, building: BuildingEntityState, events: DomainEvent[]): void {
  if (!building.complete || building.hitPoints <= 0 || building.productionQueue.length === 0) return;
  const job = building.productionQueue[0]!;
  job.remainingTicks = Math.max(0, job.remainingTicks - 1);
  building.stateRevision += 1;
  if (job.remainingTicks > 0) return;
  if (job.kind === "research") {
    building.productionQueue.shift();
    completeTechnology(state, building.ownerId, building.id, job.technologyId, events);
    return;
  }
  const spawn = buildingSpawnPoint(building, state);
  if (!spawn) return;
  building.productionQueue.shift();
  const unit = createUnit(state, building.ownerId, job.unitType, spawn);
  if (building.rallyPoint && canUnitMoveToExactPoint(state, spawn, building.rallyPoint) && !samePoint(spawn, building.rallyPoint)) {
    unit.order = { type: "move", target: { ...building.rallyPoint } };
  }
  state.entities.push(unit);
  events.push({ type: "entitySpawned", entity: toPublicEntity(unit) });
}

function updateTower(state: MatchState, building: BuildingEntityState, events: DomainEvent[]): void {
  if (!building.complete || building.hitPoints <= 0 || building.attackCooldownTicks > 0) return;
  const stats = BUILDINGS[building.typeId];
  if (stats.attackDamage <= 0) return;
  const enemies = state.entities
    .filter((entity): entity is UnitEntityState | MonsterEntityState => (
      (entity.kind === "unit" || entity.kind === "monster")
      && isAutomaticHostileTarget(state, building.ownerId, entity)
      && distanceSquared(entity.position, building.position) <= stats.attackRange * stats.attackRange
    ))
    .sort((left, right) => distanceSquared(left.position, building.position) - distanceSquared(right.position, building.position) || compareText(left.id, right.id));
  const target = enemies[0];
  if (!target) return;
  const armorBreak = hasStatus(target, "armorBreak") ? STATUS_EFFECTS.armorBreak.magnitude : 0;
  const damage = calculateDamage({ baseDamage: stats.attackDamage, armor: entityArmor(target), armorBreak });
  spawnProjectile(state, building.ownerId, building.id, building.position, target, "arrow", damage, [], events);
  building.attackCooldownTicks = stats.attackCooldownTicks;
}

function evaluateVictory(state: MatchState, events: DomainEvent[], advanceObjectiveProgress = false): void {
  if (state.phase !== "playing") return;
  const teams = [...new Set(state.players.map((player) => player.teamId))].sort(compareText);
  for (const teamId of teams) {
    const members = state.players.filter((player) => player.teamId === teamId);
    const progress = state.victory.teams.find((candidate) => candidate.teamId === teamId);
    if (!progress || progress.eliminatedAtTick !== null) continue;
    if (members.every((player) => player.surrendered)) {
      eliminateTeam(state, teamId, "surrender", events);
      continue;
    }
    if (members.every((player) => player.eliminated)) {
      eliminateTeam(state, teamId, "elimination", events);
      continue;
    }
    if (state.victory.policy.elimination && !teamHasEssentialPresence(state, members)) {
      eliminateTeam(state, teamId, "elimination", events);
      continue;
    }
    const conquest = state.victory.policy.commandCenterConquest;
    const activeMemberIds = new Set(members.filter((member) => !member.surrendered && !member.eliminated).map((member) => member.id));
    const hasTownCenter = state.entities.some((entity) => entity.kind === "building"
      && entity.typeId === "townCenter"
      && entity.complete
      && entity.hitPoints > 0
      && activeMemberIds.has(entity.ownerId));
    const timerIndex = state.teamTownCenterLostAt.findIndex((timer) => timer.teamId === teamId);
    if (!conquest || hasTownCenter) {
      if (timerIndex >= 0) state.teamTownCenterLostAt.splice(timerIndex, 1);
    } else {
      const lostAtTick = timerIndex < 0 ? state.tick : state.teamTownCenterLostAt[timerIndex]!.tick;
      if (timerIndex < 0) state.teamTownCenterLostAt.push({ teamId, tick: lostAtTick });
      if (state.tick - lostAtTick >= conquest.rebuildGraceTicks) eliminateTeam(state, teamId, "conquest", events);
    }
  }
  state.teamTownCenterLostAt.sort((left, right) => compareText(left.teamId, right.teamId));
  const activeTeams = teams.filter((teamId) => state.players.some((player) => player.teamId === teamId && !player.eliminated));
  if (teams.length > 1 && activeTeams.length <= 1) {
    const triggeredReasons = eliminationFinishReasons(state);
    finishMatch(state, activeTeams, triggeredReasons[0] ?? "elimination", events, triggeredReasons);
    return;
  }

  if (advanceObjectiveProgress) {
    updateLandmarkVictoryProgress(state, activeTeams, events);
    updateTimedControlProgress(state, activeTeams, events);
  }
  const landmarkTarget = state.victory.policy.landmark?.holdTicks;
  const landmarkWinners = landmarkTarget === undefined ? [] : activeTeams.filter((teamId) => (
    (state.victory.teams.find((team) => team.teamId === teamId)?.landmarkHoldTicks ?? 0) >= landmarkTarget
  ));
  const controlTarget = state.victory.policy.timedControl?.targetTicks;
  const controlWinners = controlTarget === undefined ? [] : activeTeams.filter((teamId) => (
    (state.victory.teams.find((team) => team.teamId === teamId)?.timedControlScoreTicks ?? 0) >= controlTarget
  ));
  const triggeredReasons: VictoryFinishReason[] = [];
  if (landmarkWinners.length > 0) triggeredReasons.push("landmark");
  if (controlWinners.length > 0) triggeredReasons.push("timedControl");
  if (triggeredReasons.length > 0) {
    finishMatch(
      state,
      [...landmarkWinners, ...controlWinners],
      triggeredReasons[0]!,
      events,
      triggeredReasons,
    );
  }
}

function teamHasEssentialPresence(state: MatchState, members: readonly PlayerState[]): boolean {
  const memberIds = new Set(members.filter((member) => !member.surrendered && !member.eliminated).map((member) => member.id));
  return state.entities.some((entity) => {
    if (entity.hitPoints <= 0 || entity.ownerId === null || !memberIds.has(entity.ownerId)) return false;
    if (entity.kind === "unit") return true;
    if (entity.kind !== "building" || entity.typeId === "resinPalisade" || entity.typeId === "surveyGate") return false;
    if (entity.complete) return true;
    return state.entities.some((candidate) => candidate.kind === "unit"
      && candidate.hitPoints > 0
      && memberIds.has(candidate.ownerId)
      && candidate.order.type === "construct"
      && candidate.order.targetId === entity.id);
  });
}

function eliminateTeam(state: MatchState, teamId: string, reason: TeamEliminationReason, events: DomainEvent[]): void {
  const current = state.victory.teams.find((team) => team.teamId === teamId);
  if (!current || current.eliminatedAtTick !== null) return;
  for (const player of state.players.filter((candidate) => candidate.teamId === teamId)) {
    player.eliminated = true;
    player.advancement = null;
    deactivatePlayerAssets(state, player.id, events);
  }
  state.victory = {
    ...state.victory,
    teams: state.victory.teams.map((team) => team.teamId === teamId
      ? { ...team, eliminatedAtTick: state.tick, eliminationReason: reason }
      : team),
  };
  events.push({ type: "teamEliminated", teamId, reason, eliminatedAtTick: state.tick });
}

function deactivatePlayerAssets(state: MatchState, playerId: PlayerId, events: DomainEvent[]): void {
  state.projectiles = state.projectiles.filter((projectile) => projectile.ownerId !== playerId);
  for (const entity of state.entities) {
    if (entity.kind !== "unit" || entity.ownerId !== playerId) continue;
    entity.order = { type: "idle" };
    entity.movementProgress = 0;
    if (entity.combat.phase !== "ready") cancelCombatAction(state, entity, events);
    entity.stateRevision += 1;
  }
}

function eliminationFinishReasons(state: MatchState): VictoryFinishReason[] {
  const priority: readonly TeamEliminationReason[] = ["surrender", "disconnect", "conquest", "elimination"];
  const currentTickReasons = state.victory.teams
    .filter((team) => team.eliminatedAtTick === state.tick && team.eliminationReason !== null)
    .map((team) => team.eliminationReason!);
  const reasons = currentTickReasons.length > 0
    ? currentTickReasons
    : state.victory.teams.flatMap((team) => team.eliminationReason ? [team.eliminationReason] : []);
  const triggered = priority.filter((reason) => reasons.includes(reason));
  return triggered.length > 0 ? triggered : ["elimination"];
}

function updateLandmarkVictoryProgress(state: MatchState, activeTeams: readonly string[], events: DomainEvent[]): void {
  const policy = state.victory.policy.landmark;
  if (!policy) return;
  for (const teamId of activeTeams) {
    const playerIds = new Set(state.players
      .filter((player) => player.teamId === teamId && !player.surrendered && !player.eliminated)
      .map((player) => player.id));
    const completed = state.entities.filter((entity) => entity.kind === "building"
      && entity.typeId === policy.buildingType
      && entity.complete
      && entity.hitPoints > 0
      && playerIds.has(entity.ownerId)).length;
    const current = state.victory.teams.find((team) => team.teamId === teamId)!;
    const nextTicks = completed >= policy.requiredCount ? Math.min(policy.holdTicks, current.landmarkHoldTicks + 1) : 0;
    if (nextTicks === current.landmarkHoldTicks) continue;
    state.victory = {
      ...state.victory,
      teams: state.victory.teams.map((team) => team.teamId === teamId ? { ...team, landmarkHoldTicks: nextTicks } : team),
    };
    if (crossedProgressReportBoundary(current.landmarkHoldTicks, nextTicks, policy.holdTicks)) {
      events.push({ type: "victoryProgressChanged", teamId, objective: "landmark", progressTicks: nextTicks, targetTicks: policy.holdTicks });
    }
  }
}

function updateTimedControlProgress(state: MatchState, activeTeams: readonly string[], events: DomainEvent[]): void {
  const policy = state.victory.policy.timedControl;
  if (!policy) return;
  const counts = new Map(activeTeams.map((teamId) => [teamId, 0]));
  if (state.tick >= policy.startsAtTick) {
    for (const entity of state.entities) {
      if (entity.kind !== "unit" || entity.hitPoints <= 0) continue;
      const player = state.players.find((candidate) => candidate.id === entity.ownerId);
      if (!player || player.eliminated || player.surrendered || !counts.has(player.teamId)) continue;
      if (distanceSquared(entity.position, policy.point) <= policy.radius * policy.radius) {
        counts.set(player.teamId, counts.get(player.teamId)! + 1);
      }
    }
  }
  const presentTeams = [...counts.entries()].filter(([, count]) => count > 0).map(([teamId]) => teamId).sort(compareText);
  const controllerTeamId = presentTeams.length === 1 ? presentTeams[0]! : null;
  const contested = presentTeams.length > 1;
  if (state.victory.control.controllerTeamId !== controllerTeamId || state.victory.control.contested !== contested) {
    state.victory = { ...state.victory, control: { controllerTeamId, contested } };
    events.push({ type: "controlObjectiveChanged", controllerTeamId, contested, changedAtTick: state.tick });
  }
  if (!controllerTeamId) return;
  const current = state.victory.teams.find((team) => team.teamId === controllerTeamId)!;
  const nextTicks = Math.min(policy.targetTicks, current.timedControlScoreTicks + 1);
  if (nextTicks === current.timedControlScoreTicks) return;
  state.victory = {
    ...state.victory,
    teams: state.victory.teams.map((team) => team.teamId === controllerTeamId ? { ...team, timedControlScoreTicks: nextTicks } : team),
  };
  if (crossedProgressReportBoundary(current.timedControlScoreTicks, nextTicks, policy.targetTicks)) {
    events.push({ type: "victoryProgressChanged", teamId: controllerTeamId, objective: "timedControl", progressTicks: nextTicks, targetTicks: policy.targetTicks });
  }
}

function crossedProgressReportBoundary(previous: number, next: number, target: number): boolean {
  if (next === 0 || next === target) return previous !== next;
  return Math.floor(previous * 20 / target) !== Math.floor(next * 20 / target);
}

function finishMatch(
  state: MatchState,
  winningTeamIds: readonly string[],
  reason: VictoryFinishReason,
  events: DomainEvent[],
  triggeredReasons: readonly VictoryFinishReason[] = [reason],
): void {
  if (state.phase !== "playing") return;
  const winners = [...new Set(winningTeamIds)].sort(compareText);
  state.phase = "finished";
  state.winningTeamIds = winners;
  state.finishReason = reason;
  state.victory = {
    ...state.victory,
    outcome: winners.length === 1 ? "victory" : "draw",
    winningTeamIds: winners,
    finishReason: reason,
    triggeredReasons: [...triggeredReasons],
    finishedAtTick: state.tick,
  };
  events.push({
    type: "matchFinished",
    winningTeamIds: winners,
    outcome: winners.length === 1 ? "victory" : "draw",
    reason,
    triggeredReasons: [...triggeredReasons],
    finishedAtTick: state.tick,
    teamScores: state.victory.teams
      .map((team) => ({ teamId: team.teamId, landmarkHoldTicks: team.landmarkHoldTicks, timedControlScoreTicks: team.timedControlScoreTicks }))
      .sort((left, right) => compareText(left.teamId, right.teamId)),
  });
}

function moveToward(state: MatchState, unit: UnitEntityState, target: GridPoint): boolean {
  if (samePoint(unit.position, target)) return true;
  const speed = statusAdjustedSpeed(state, unit);
  unit.movementProgress += speed;
  if (unit.movementProgress < 1000 * TICKS_PER_SECOND) return false;
  unit.movementProgress -= 1000 * TICKS_PER_SECOND;
  const next = findNextPathStep(unit.position, target, state.map.width, state.map.height, getPlanningPathBlockedCells(state, unit.ownerId));
  if (!next) {
    unit.movementProgress = Math.min(unit.movementProgress + 1000 * TICKS_PER_SECOND, 1000 * TICKS_PER_SECOND);
    return false;
  }
  if (isMapCellBlocked(state, next)) {
    unit.movementProgress = 1000 * TICKS_PER_SECOND;
    return false;
  }
  if (samePoint(next, unit.position)) return true;
  const origin = { ...unit.position };
  unit.facing = quantizeFacing(next.x - unit.position.x, next.y - unit.position.y, unit.facing);
  unit.position = next;
  recordUnitMovement(state, unit, Math.max(Math.abs(next.x - origin.x), Math.abs(next.y - origin.y)));
  unit.stateRevision += 1;
  return samePoint(next, target);
}

type EntityMovementResult = "arrived" | "moving" | "blocked";

function moveTowardEntity(state: MatchState, unit: UnitEntityState, entity: EntityState): EntityMovementResult {
  if (isEntityInteractionCell(unit.position, entity)) return "arrived";
  const speed = statusAdjustedSpeed(state, unit);
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
  const origin = { ...unit.position };
  unit.facing = quantizeFacing(route.firstStep.x - unit.position.x, route.firstStep.y - unit.position.y, unit.facing);
  unit.position = route.firstStep;
  recordUnitMovement(state, unit, Math.max(Math.abs(route.firstStep.x - origin.x), Math.abs(route.firstStep.y - origin.y)));
  unit.stateRevision += 1;
  return isEntityInteractionCell(unit.position, entity) ? "arrived" : "moving";
}

function damageAfterVillageTrait(state: MatchState, target: EntityState, damage: number): number {
  if (target.kind !== "building" || target.typeId !== "defenseTower") return damage;
  const multiplier = villageTraitMultiplier(state, target.ownerId, "towerArmor");
  return multiplier === 1_000 ? damage : Math.max(1, Math.floor(damage * 1_000 / multiplier));
}

function createUnit(state: MatchState, ownerId: PlayerId, typeId: UnitType, position: GridPoint): UnitEntityState {
  const maxHitPoints = getEffectiveUnitMaxHitPoints(state, ownerId, typeId);
  return {
    id: nextId(state, "unit"), ownerId, kind: "unit", typeId, position, hitPoints: maxHitPoints, maxHitPoints, stateRevision: 0,
    order: { type: "idle" }, movementProgress: 0, attackCooldownTicks: 0, workCooldownTicks: 0,
    facing: ownerId === state.players[0]?.id ? "ne" : "sw", stance: "aggressive", formation: "line",
    combat: { phase: "ready", action: null, abilityId: null, target: null, commitTick: null, readyTick: 0 },
    abilityReadyTick: 0,
    passive: { stationarySinceTick: state.tick, movedTilesSinceAttack: 0, rhythmTargetId: null, rhythmStacks: 0, rhythmLastHitTick: 0, braceCooldownUntilTick: 0 },
    statuses: [], cargo: { kind: null, amount: 0 }, cargoCapacity: getEffectiveCarryCapacity(state, ownerId, typeId), gatherRemainderMilli: { food: 0, wood: 0, stone: 0 },
  };
}

function createBuilding(
  state: MatchState,
  ownerId: PlayerId,
  typeId: BuildingType,
  position: GridPoint,
  complete: boolean,
  orientation: StructureOrientation = "ne",
): BuildingEntityState {
  const definition = BUILDINGS[typeId];
  const maxHitPoints = getEffectiveBuildingMaxHitPoints(state, ownerId, typeId);
  return {
    id: nextId(state, "building"),
    ownerId,
    kind: "building",
    typeId,
    position,
    hitPoints: complete ? maxHitPoints : 1,
    maxHitPoints,
    stateRevision: 0,
    complete,
    constructionRemainingTicks: complete ? 0 : definition.buildTicks,
    attackCooldownTicks: 0,
    statuses: [],
    rallyPoint: null,
    productionQueue: [],
    orientation,
    gateOpen: false,
  };
}

function createRubble(state: MatchState, source: BuildingEntityState): RubbleEntityState {
  return {
    id: nextId(state, "rubble"),
    ownerId: null,
    kind: "rubble",
    typeId: source.typeId,
    position: { ...source.position },
    hitPoints: 0,
    maxHitPoints: 0,
    stateRevision: 0,
    orientation: source.orientation,
    decayAtTick: state.tick + RUBBLE_DECAY_TICKS,
  };
}

function createResource(state: MatchState, typeId: ResourceKind, position: GridPoint): ResourceEntityState {
  const amount = RESOURCE_NODES[typeId].maxAmount;
  return { id: nextId(state, "resource"), ownerId: null, kind: "resource", typeId, position, hitPoints: amount, maxHitPoints: amount, stateRevision: 0, amount, renewAtTick: null };
}

function createMonster(state: MatchState, typeId: MonsterId, position: GridPoint, leashRadius = 6): MonsterEntityState {
  const definition = MONSTERS[typeId];
  return {
    id: nextId(state, "monster"),
    ownerId: null,
    kind: "monster",
    typeId,
    position: { ...position },
    home: { ...position },
    hitPoints: definition.maxHitPoints,
    maxHitPoints: definition.maxHitPoints,
    stateRevision: 0,
    facing: "se",
    statuses: [],
    combat: { phase: "ready", action: null, abilityId: null, target: null, commitTick: null, readyTick: 0 },
    movementProgress: 0,
    attackCooldownTicks: 0,
    abilityReadyTick: 0,
    camouflageReady: typeId === "miremaw",
    camouflageSpeedUntilTick: 0,
    leashRadius,
    provokedByTeamId: null,
    provokedAtTick: null,
    targetId: null,
    contributions: [],
    rewardGranted: false,
  };
}

function nextId(state: MatchState, prefix: string): EntityId {
  const id = `${prefix}-${state.nextEntityNumber}`;
  state.nextEntityNumber += 1;
  return id;
}

function setOrders(state: MatchState, ids: readonly EntityId[], order: UnitOrder, events: DomainEvent[]): void {
  for (const id of ids) {
    const unit = state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
    if (order.type === "attack") clearWarriorRhythmForTarget(unit, order.targetId);
    if (order.type === "patrol") beginMovementForPassive(state, unit, events);
    unit.order = cloneOrder(order);
    cancelCombatAction(state, unit, events);
    unit.stateRevision += 1;
  }
}

function setFormationMovementOrders(state: MatchState, ids: readonly EntityId[], target: GridPoint, kind: "move" | "attackMove", events: DomainEvent[]): void {
  const units = ids
    .map((id) => state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!)
    .sort((left, right) => compareText(left.id, right.id));
  const formation = units[0]?.formation ?? "line";
  const center = units.length === 0 ? target : {
    x: units.reduce((sum, unit) => sum + unit.position.x, 0) / units.length,
    y: units.reduce((sum, unit) => sum + unit.position.y, 0) / units.length,
  };
  const heading = { x: Math.sign(target.x - center.x), y: Math.sign(target.y - center.y) };
  if (heading.x === 0 && heading.y === 0) heading.y = 1;
  const reserved = new Set<string>();
  units.forEach((unit, index) => {
    const offset = formationOffset(formation, index, units.length, heading);
    const desired = { x: target.x + offset.x, y: target.y + offset.y };
    const destination = formationDestination(state, unit, desired, target, reserved);
    reserved.add(pointKey(destination));
    unit.order = kind === "move"
      ? { type: "move", target: destination }
      : { type: "attackMove", target: destination, engagedTargetId: null };
    beginMovementForPassive(state, unit, events);
    cancelCombatAction(state, unit, events);
    unit.stateRevision += 1;
  });
}

function formationOffset(formation: FormationKind, index: number, count: number, heading: GridPoint): GridPoint {
  let local: GridPoint;
  if (formation === "line") local = { x: index - Math.floor((count - 1) / 2), y: 0 };
  else if (formation === "box") {
    const width = Math.ceil(Math.sqrt(count));
    local = { x: index % width - Math.floor((width - 1) / 2), y: Math.floor(index / width) };
  } else if (index === 0) local = { x: 0, y: 0 };
  else {
    const row = Math.ceil((Math.sqrt(1 + 8 * index) - 1) / 2);
    const rowStart = row * (row - 1) / 2;
    local = { x: index - rowStart - Math.floor(row / 2), y: row };
  }
  const right = { x: -heading.y, y: heading.x };
  return {
    x: local.x * right.x - local.y * heading.x,
    y: local.x * right.y - local.y * heading.y,
  };
}

function formationDestination(state: MatchState, unit: UnitEntityState, desired: GridPoint, fallback: GridPoint, reserved: ReadonlySet<string>): GridPoint {
  const candidates = [desired, fallback];
  const blockers = getPathBlockedCells(state);
  const fallbackReachable = findPathRoute(unit.position, fallback, state.map.width, state.map.height, blockers) !== null;
  const maximumRadius = Math.max(state.map.width, state.map.height);
  for (let radius = 1; radius <= maximumRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        candidates.push({ x: fallback.x + dx, y: fallback.y + dy });
      }
    }
  }
  candidates.push(unit.position);
  return candidates.find((candidate) => (
    !reserved.has(pointKey(candidate))
    && isExactWalkTargetAvailable(state, candidate)
    && (!fallbackReachable || findPathRoute(unit.position, candidate, state.map.width, state.map.height, blockers) !== null)
  )) ?? fallback;
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

export function arePlayersHostile(state: MatchState, leftId: PlayerId, rightId: PlayerId): boolean {
  if (leftId === rightId) return false;
  const left = state.players.find((player) => player.id === leftId);
  const right = state.players.find((player) => player.id === rightId);
  return Boolean(left && right && left.teamId !== right.teamId);
}

export function arePlayersAllied(state: MatchState, leftId: PlayerId, rightId: PlayerId): boolean {
  const left = state.players.find((player) => player.id === leftId);
  const right = state.players.find((player) => player.id === rightId);
  return Boolean(left && right && left.teamId === right.teamId);
}

function abilityTargetMatches(targeting: AbilityTargeting, target: AbilityTarget): boolean {
  return (targeting === "self" && target.kind === "self")
    || (targeting === "unit" && target.kind === "entity")
    || (targeting === "ground" && target.kind === "ground")
    || (targeting === "direction" && target.kind === "direction");
}

function validateAbilityTarget(state: MatchState, playerId: PlayerId, caster: UnitEntityState, target: AbilityTarget): CommandValidation {
  if (target.kind === "self") return { ok: true };
  if (target.kind === "direction") return { ok: true };
  if (target.kind === "ground") {
    return isPointInBounds(target.point, state) && distanceSquared(caster.position, target.point) <= UNITS[caster.typeId].attackRange ** 2
      ? { ok: true }
      : rejected("TARGET_NOT_REACHABLE");
  }
  const entity = state.entities.find((candidate) => candidate.id === target.entityId);
  if (!entity || !isEntityVisibleToPlayer(state, playerId, entity)) return rejected("TARGET_NOT_VISIBLE");
  if (entity.kind !== "unit" && entity.kind !== "monster") return rejected("INVALID_PAYLOAD");
  if (!isValidHostileTarget(state, playerId, entity)) return rejected("INVALID_PAYLOAD");
  return distanceSquaredToEntity(caster.position, entity) <= UNITS[caster.typeId].attackRange ** 2
    ? { ok: true }
    : rejected("TARGET_NOT_REACHABLE");
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

function hasQueuedTechnology(state: MatchState, playerId: PlayerId, technologyId: TechnologyType): boolean {
  return state.entities.some((entity) => (
    entity.kind === "building"
    && entity.ownerId === playerId
    && entity.productionQueue.some((job) => job.kind === "research" && job.technologyId === technologyId)
  ));
}

function completeTechnology(state: MatchState, playerId: PlayerId, producerId: EntityId, technologyId: TechnologyType, events: DomainEvent[]): void {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.completedTechnologyIds.includes(technologyId)) return;
  player.completedTechnologyIds.push(technologyId);
  player.completedTechnologyIds.sort((left, right) => TECHNOLOGY_ORDER.indexOf(left) - TECHNOLOGY_ORDER.indexOf(right));

  for (const entity of state.entities) {
    if (entity.ownerId !== playerId) continue;
    const effectiveMaximum = entity.kind === "unit"
      ? getEffectiveUnitMaxHitPoints(state, playerId, entity.typeId)
      : getEffectiveBuildingMaxHitPoints(state, playerId, entity.typeId);
    const increase = Math.max(0, effectiveMaximum - entity.maxHitPoints);
    if (increase <= 0) continue;
    entity.maxHitPoints = effectiveMaximum;
    if (entity.kind === "unit" || entity.complete) entity.hitPoints = Math.min(effectiveMaximum, entity.hitPoints + increase);
    entity.stateRevision += 1;
  }
  events.push({ type: "technologyResearched", playerId, producerId, technologyId });
}

export function getEffectiveGatherRatePermille(state: MatchState, playerId: PlayerId, unitType: UnitType, resourceKind: ResourceKind): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  let multiplier = villageTraitMultiplier(state, playerId, "gatherRate");
  if (!player) return multiplier;
  multiplier = Math.floor(multiplier * activeMonsterBoonMultiplier(state, playerId, "gatherRate") / 1_000);
  for (const technologyId of TECHNOLOGY_ORDER) {
    if (!player.completedTechnologyIds.includes(technologyId)) continue;
    const effect = TECHNOLOGIES[technologyId].effect;
    if (effect.kind === "gatherRate" && effect.resourceKinds.includes(resourceKind) && UNITS[unitType].gatherPerSecond[resourceKind] > 0) {
      multiplier = Math.floor(multiplier * effect.multiplierPermille / 1_000);
    }
  }
  return multiplier;
}

export function getEffectiveUnitAttackDamage(state: MatchState, playerId: PlayerId, unitType: UnitType): number {
  const value = effectiveUnitStat(state, playerId, unitType, UNITS[unitType].attackDamage, "unitAttack");
  return Math.floor(value * activeMonsterBoonMultiplier(state, playerId, "unitAttack") / 1_000);
}

export function getEffectiveUnitMaxHitPoints(state: MatchState, playerId: PlayerId, unitType: UnitType): number {
  return effectiveUnitStat(state, playerId, unitType, UNITS[unitType].maxHitPoints, "unitMaxHitPoints");
}

export function getEffectiveUnitSpeedMilliTilesPerSecond(state: MatchState, playerId: PlayerId, unitType: UnitType): number {
  const villageMultiplierPermille = villageTraitMultiplier(state, playerId, "unitSpeed");
  const boonMultiplierPermille = activeMonsterBoonMultiplier(state, playerId, "unitSpeed");
  const base = Math.floor(UNITS[unitType].speedMilliTilesPerSecond * villageMultiplierPermille / 1_000 * boonMultiplierPermille / 1_000);
  return effectiveUnitStat(state, playerId, unitType, base, "unitSpeed");
}

export function getEffectiveBuildingMaxHitPoints(state: MatchState, playerId: PlayerId, buildingType: BuildingType): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  let value = Math.floor(BUILDINGS[buildingType].maxHitPoints * villageTraitMultiplier(state, playerId, "buildingDurability") / 1_000);
  if (!player) return value;
  for (const technologyId of TECHNOLOGY_ORDER) {
    if (!player.completedTechnologyIds.includes(technologyId)) continue;
    const effect = TECHNOLOGIES[technologyId].effect;
    if (effect.kind === "buildingMaxHitPoints" && (effect.buildingTypes === "all" || effect.buildingTypes.includes(buildingType))) {
      value = Math.floor(value * effect.multiplierPermille / 1_000);
    }
  }
  return value;
}

export function getEffectiveCarryCapacity(state: MatchState, playerId: PlayerId, unitType: UnitType): number {
  return Math.floor(UNITS[unitType].carryCapacity * villageTraitMultiplier(state, playerId, "carryCapacity") / 1_000);
}

function villageTraitMultiplier(
  state: MatchState,
  playerId: PlayerId,
  metric: "gatherRate" | "unitSpeed" | "towerArmor" | "buildingDurability" | "carryCapacity",
): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return (player ? getVillage(player.villageId)?.traits.find((trait) => trait.metric === metric)?.multiplierPermille : undefined) ?? 1_000;
}

function activeMonsterBoonMultiplier(
  state: MatchState,
  playerId: PlayerId,
  metric: "gatherRate" | "unitSpeed" | "unitAttack",
): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return 1_000;
  return player.activeMonsterBoons
    .filter((boon) => boon.expiresAtTick > state.tick && MONSTER_BOONS[boon.id].metric === metric)
    .reduce((multiplier, boon) => Math.floor(multiplier * MONSTER_BOONS[boon.id].multiplierPermille / 1_000), 1_000);
}

function effectiveUnitStat(
  state: MatchState,
  playerId: PlayerId,
  unitType: UnitType,
  base: number,
  kind: "unitAttack" | "unitMaxHitPoints" | "unitSpeed",
): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  let value = base;
  if (!player) return value;
  for (const technologyId of TECHNOLOGY_ORDER) {
    if (!player.completedTechnologyIds.includes(technologyId)) continue;
    const effect = TECHNOLOGIES[technologyId].effect;
    if (effect.kind === kind && effect.unitTypes.includes(unitType)) value = Math.floor(value * effect.multiplierPermille / 1_000);
  }
  return value;
}

function updateSettlementAdvancements(state: MatchState, events: DomainEvent[]): void {
  for (const player of state.players) {
    if (player.surrendered || player.eliminated) {
      player.advancement = null;
      continue;
    }
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
  return state.entities.reduce((sum, entity) => sum + (entity.kind === "building" && entity.ownerId === playerId ? entity.productionQueue.reduce((jobs, job) => jobs + (job.kind === "train" ? UNITS[job.unitType].population : 0), 0) : 0), 0);
}

function canAfford(wallet: ResourceWallet, cost: ResourceWallet): boolean {
  return wallet.food >= cost.food && wallet.wood >= cost.wood && wallet.stone >= cost.stone;
}

function subtractWallet(player: PlayerState, cost: ResourceWallet): void {
  player.resources = { food: player.resources.food - cost.food, wood: player.resources.wood - cost.wood, stone: player.resources.stone - cost.stone };
}

function addWallet(player: PlayerState, value: ResourceWallet): void {
  player.resources = { food: player.resources.food + value.food, wood: player.resources.wood + value.wood, stone: player.resources.stone + value.stone };
}

function productionRefund(job: ProductionJob): ResourceWallet {
  const remaining = Math.max(0, Math.min(job.totalTicks, job.remainingTicks));
  const refund = (amount: number): number => Math.floor(amount * remaining / Math.max(1, job.totalTicks));
  return { food: refund(job.paidCost.food), wood: refund(job.paidCost.wood), stone: refund(job.paidCost.stone) };
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

function sameProductionJobId(left: ProductionJobId, right: ProductionJobId): boolean {
  return left.commandSequence === right.commandSequence && left.itemIndex === right.itemIndex;
}

function isTrainingProducer(buildingType: BuildingType): boolean {
  return (Object.keys(UNITS) as UnitType[]).some((unitType) => UNITS[unitType].producers.includes(buildingType));
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
  const footprint = entity.kind === "building" || entity.kind === "rubble"
    ? getBuildingFootprint(entity.typeId, entity.orientation)
    : [{ x: 0, y: 0 }];
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
  return getNavigationBlockedMapCells(state).some((cell) => pointKey(cell) === key);
}

function isMapCellWalkable(state: MatchState, point: GridPoint): boolean {
  return state.map.id !== VILLAGE_ASSAULT_MAP_ID || isVillageAssaultWalkableCell(point, state.map.layoutId);
}

function isExactWalkTargetAvailable(state: MatchState, point: GridPoint): boolean {
  return isPointInBounds(point, state) && isMapCellWalkable(state, point) && !isMapCellBlocked(state, point);
}

function isMovementTargetAvailableToPlayer(state: MatchState, playerId: PlayerId, point: GridPoint): boolean {
  if (!isPointInBounds(point, state) || !isMapCellWalkable(state, point)) return false;
  return !isTileVisibleToPlayer(state, playerId, point) || !isMapCellBlocked(state, point);
}

function canUnitMoveToExactPoint(state: MatchState, start: GridPoint, target: GridPoint): boolean {
  return isExactWalkTargetAvailable(state, target)
    && findPathRoute(start, target, state.map.width, state.map.height, getPathBlockedCells(state)) !== null;
}

function getPathBlockedCells(state: MatchState): readonly GridPoint[] {
  return state.map.id === VILLAGE_ASSAULT_MAP_ID
    ? [...getNavigationBlockedMapCells(state), ...getVillageAssaultWalkBlockedCells(state.map.layoutId)]
    : getNavigationBlockedMapCells(state);
}

function getPlanningPathBlockedCells(state: MatchState, playerId: PlayerId): readonly GridPoint[] {
  const live = state.entities.flatMap((entity) => {
    if (!doesEntityBlockMovement(entity)) return [];
    if (entity.kind === "resource") return getEntityFootprintCells(entity);
    if (entity.kind !== "building") return [];
    return arePlayersAllied(state, playerId, entity.ownerId) || isEntityVisibleToPlayer(state, playerId, entity)
      ? getEntityFootprintCells(entity)
      : [];
  });
  const remembered = getPlayerVisibilityState(state, playerId).staleEnemySightings.flatMap((sighting) => (
    sighting.blocksMovement
      ? getFootprintCells(sighting.position, getBuildingFootprint(sighting.typeId, sighting.orientation))
      : []
  ));
  const terrain = state.map.id === VILLAGE_ASSAULT_MAP_ID ? getVillageAssaultWalkBlockedCells(state.map.layoutId) : [];
  return [...live, ...remembered, ...terrain];
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function orderCommands(commands: readonly CommandEnvelope[]): CommandEnvelope[] {
  return [...commands].sort((left, right) => (
    compareText(left.playerId, right.playerId)
    || left.sequence - right.sequence
    || compareText(stableStringify(left.command), stableStringify(right.command))
  ));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
