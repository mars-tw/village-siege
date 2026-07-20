import { BUILDINGS, getBuildingFootprint, MAX_TRAINING_QUEUE_DEPTH, SETTLEMENT_TIERS, TECHNOLOGIES, TECHNOLOGY_ORDER, UNITS } from "./content.js";
import { getVillageAssaultBuildBlockedCells, getVillageAssaultWalkBlockedCells, VILLAGE_ASSAULT_MAP_ID } from "./battlefield.js";
import { createAiAuthorityState, decisionInterval } from "./aiAuthority.js";
import { nextUint32 } from "./random.js";
import { COMBAT_UNITS, COUNTER_MATRIX, type CombatUnitId } from "./combat.js";
import { arePlayersHostile, isEntityVisibleToPlayer, toPublicEntity, type BuildingEntityState, type MatchState, type ProductionJob } from "./simulation.js";
import { findPathRoute, findPathToAny, getFootprintCells, getFootprintPerimeterCells, validateFootprintPlacement } from "./spatial.js";
import { getPlayerVisibilityState } from "./visibility.js";
import type {
  AiAuthorityState,
  AiDifficulty,
  AiEnemyMemory,
  AiPersonality,
  AiStrategicPhase,
  AiTelemetryCounters,
  BuildingType,
  EntityId,
  GameCommand,
  GridPoint,
  PlayableVillageId,
  PlayerId,
  PublicEntityState,
  ResourceKind,
  ResourceWallet,
  SettlementTier,
  StructureHealthBand,
  StructureOrientation,
  TechnologyType,
  UnitType,
} from "./protocol.js";

export interface RememberedEnemySite {
  readonly entityId: EntityId;
  readonly typeId?: UnitType | BuildingType;
  readonly lastKnownPosition: GridPoint;
  readonly observedAtTick: number;
  readonly orientation?: StructureOrientation;
  readonly gateOpen?: boolean;
  readonly complete?: boolean;
  readonly healthBand?: StructureHealthBand;
  readonly blocksMovement?: boolean;
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
  readonly map: { readonly id: "open" | typeof VILLAGE_ASSAULT_MAP_ID; readonly width: number; readonly height: number; readonly layoutId?: PlayableVillageId };
  readonly ownEntities: readonly PublicEntityState[];
  readonly ownTrainingQueueDepth: Readonly<Record<EntityId, number>>;
  readonly ownProductionQueues: Readonly<Record<EntityId, readonly ProductionJob[]>>;
  readonly ownRallyPoints: Readonly<Record<EntityId, GridPoint | null>>;
  readonly completedTechnologyIds: readonly TechnologyType[];
  readonly ownIncompleteBuildingIds: readonly EntityId[];
  readonly visibleEnemyEntities: readonly PublicEntityState[];
  readonly visibleResourceEntities: readonly PublicEntityState[];
  /** Visible allied and neutral world entities not represented by the other lists. */
  readonly visibleWorldEntities: readonly PublicEntityState[];
  readonly visibleTileIndices: readonly number[];
  readonly exploredTileIndices: readonly number[];
  readonly rememberedEnemySites: readonly RememberedEnemySite[];
}

export interface AiKnownSpatialModel {
  readonly walkBlockedCells: readonly GridPoint[];
  readonly placementBlockedCells: readonly GridPoint[];
}

export interface AiStrategicSnapshot {
  readonly phase: AiStrategicPhase;
  readonly waveNumber: number;
  readonly counterUnit: CombatUnitId | null;
  readonly counterLockedUntilTick: number;
  readonly lastEnemyObservedTick: number | null;
  readonly targetSite: RememberedEnemySite | null;
  readonly regroupUntilTick: number;
  readonly nextAssaultTick: number;
  readonly assaultUnitIds: readonly EntityId[];
  readonly telemetry: AiTelemetryCounters;
}

export interface AiController {
  readonly personality: AiPersonality;
  readonly playerId: PlayerId;
  readonly difficulty: AiDifficulty;
  decide(observation: AiObservation, budgetMs: number): readonly GameCommand[];
  getStrategicSnapshot(): AiStrategicSnapshot;
}

interface AiStrategyTuning {
  readonly minimumAssaultUnits: number;
  readonly defenderReserve: number;
  readonly retreatStrengthRatio: number;
  readonly retreatHealthRatio: number;
  readonly regroupTicks: number;
  readonly waveCooldownTicks: number;
  readonly counterLockTicks: number;
  readonly repairHealthRatio: number;
  readonly scoutIntervalTicks: number;
}

type MutableAiAuthorityState = {
  -readonly [Key in keyof AiAuthorityState]: AiAuthorityState[Key];
};

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
  readonly preferredTechnologies: readonly TechnologyType[];
  readonly researchAfterTick: number;
  readonly researchIntervalTicks: number;
}

export const AI_PROFILES: Readonly<Record<AiPersonality, AiProfile>> = {
  aggressor: { id: "aggressor", economyWeight: 15, defenseWeight: 10, aggressionWeight: 60, mobilityWeight: 15, preferredUnits: ["warrior", "shieldBearer", "heavyCrossbowman"], preferredBuildings: ["barracks", "siegeWorkshop", "house"], targetPriority: ["townCenter", "military", "villager", "economy"], advanceAfterTick: { stronghold: 260, artificer: 11_000 }, preferredTechnologies: ["layeredHarness", "starfireBores", "torsionCradles"], researchAfterTick: 1_500, researchIntervalTicks: 2_200 },
  guardian: { id: "guardian", economyWeight: 20, defenseWeight: 55, aggressionWeight: 10, mobilityWeight: 15, preferredUnits: ["shieldBearer", "archer", "warrior"], preferredBuildings: ["defenseTower", "barracks", "archeryRange", "house"], targetPriority: ["military", "townCenter", "villager", "economy"], advanceAfterTick: { stronghold: 420, artificer: 14_000 }, preferredTechnologies: ["surveyedFoundations", "layeredHarness", "resinboundKits"], researchAfterTick: 2_200, researchIntervalTicks: 2_600 },
  prosperer: { id: "prosperer", economyWeight: 60, defenseWeight: 15, aggressionWeight: 15, mobilityWeight: 10, preferredUnits: ["villager", "archer", "heavyCrossbowman"], preferredBuildings: ["lumberCamp", "farmstead", "archeryRange", "siegeWorkshop", "house"], targetPriority: ["economy", "townCenter", "military", "villager"], advanceAfterTick: { stronghold: 520, artificer: 13_000 }, preferredTechnologies: ["hearthlandAlmanac", "resinboundKits", "surveyedFoundations"], researchAfterTick: 1_200, researchIntervalTicks: 1_600 },
  balanced: { id: "balanced", economyWeight: 30, defenseWeight: 25, aggressionWeight: 25, mobilityWeight: 20, preferredUnits: ["shieldBearer", "archer", "mage", "musketeer"], preferredBuildings: ["house", "barracks", "archeryRange", "mageSanctum", "gunWorkshop", "defenseTower"], targetPriority: ["military", "economy", "townCenter", "villager"], advanceAfterTick: { stronghold: 360, artificer: 12_000 }, preferredTechnologies: ["resinboundKits", "layeredHarness", "surveyedFoundations", "starfireBores"], researchAfterTick: 1_800, researchIntervalTicks: 2_000 },
  raider: { id: "raider", economyWeight: 15, defenseWeight: 10, aggressionWeight: 35, mobilityWeight: 40, preferredUnits: ["boarRider", "archer", "warrior"], preferredBuildings: ["beastStable", "archeryRange", "barracks", "house"], targetPriority: ["villager", "economy", "military", "townCenter"], advanceAfterTick: { stronghold: 220, artificer: 10_500 }, preferredTechnologies: ["windspurRigging", "resinboundKits", "layeredHarness"], researchAfterTick: 1_400, researchIntervalTicks: 1_800 },
};

const AI_STRATEGY: Readonly<Record<AiPersonality, AiStrategyTuning>> = {
  aggressor: { minimumAssaultUnits: 3, defenderReserve: 0, retreatStrengthRatio: 0.48, retreatHealthRatio: 0.34, regroupTicks: 180, waveCooldownTicks: 420, counterLockTicks: 800, repairHealthRatio: 0.58, scoutIntervalTicks: 420 },
  guardian: { minimumAssaultUnits: 5, defenderReserve: 3, retreatStrengthRatio: 0.82, retreatHealthRatio: 0.5, regroupTicks: 320, waveCooldownTicks: 900, counterLockTicks: 1_200, repairHealthRatio: 0.82, scoutIntervalTicks: 800 },
  prosperer: { minimumAssaultUnits: 4, defenderReserve: 1, retreatStrengthRatio: 0.62, retreatHealthRatio: 0.42, regroupTicks: 260, waveCooldownTicks: 720, counterLockTicks: 1_000, repairHealthRatio: 0.7, scoutIntervalTicks: 650 },
  balanced: { minimumAssaultUnits: 3, defenderReserve: 1, retreatStrengthRatio: 0.62, retreatHealthRatio: 0.4, regroupTicks: 220, waveCooldownTicks: 600, counterLockTicks: 900, repairHealthRatio: 0.68, scoutIntervalTicks: 560 },
  raider: { minimumAssaultUnits: 2, defenderReserve: 0, retreatStrengthRatio: 0.72, retreatHealthRatio: 0.46, regroupTicks: 140, waveCooldownTicks: 360, counterLockTicks: 650, repairHealthRatio: 0.55, scoutIntervalTicks: 300 },
};

export function createAiController(personality: AiPersonality, playerId: PlayerId, seed: number, difficulty: AiDifficulty = "standard"): AiController {
  let authority = createAiAuthorityState(personality, playerId, seed, difficulty);

  return {
    personality,
    playerId,
    difficulty,
    decide(observation, budgetMs) {
      const reduced = reduceAi(authority, observation, budgetMs);
      authority = reduced.authority;
      return reduced.commands;
    },
    getStrategicSnapshot() {
      return strategicSnapshot(authority);
    },
  };
}

export interface AiReduceResult {
  readonly authority: AiAuthorityState;
  readonly commands: readonly GameCommand[];
}

/** Pure, fixed-work planner reducer suitable for save/restore and replay. */
export function reduceAi(authority: AiAuthorityState, observation: AiObservation, budgetMs: number): AiReduceResult {
  if (observation.selfPlayerId !== authority.playerId || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    return { authority, commands: [] };
  }
  if (observation.serverTick - authority.lastDecisionTick < decisionInterval(authority.difficulty)) {
    return { authority, commands: [] };
  }
  const next = cloneAuthority(authority);
  next.lastDecisionTick = observation.serverTick;
  const randomStep = nextUint32(next.randomState);
  next.randomState = randomStep.state;
  next.telemetry = { ...next.telemetry, decisions: next.telemetry.decisions + 1 };
  const profile = AI_PROFILES[next.personality];
  const tuning = AI_STRATEGY[next.personality];
  refreshStrategicKnowledge(profile, tuning, next, observation);
  const command = decideForProfile(profile, tuning, next, observation, randomStep.value);
  return { authority: next, commands: command ? [command] : [] };
}

function cloneAuthority(authority: AiAuthorityState): MutableAiAuthorityState {
  return JSON.parse(JSON.stringify(authority)) as MutableAiAuthorityState;
}

function strategicSnapshot(authority: AiAuthorityState): AiStrategicSnapshot {
  const newest = [...authority.enemyMemory]
    .sort((left, right) => right.observedAtTick - left.observedAtTick || compareText(left.entityId, right.entityId))[0];
  const lastEnemyObservedTick = authority.enemyMemory.length > 0
    ? Math.max(...authority.enemyMemory.map((memory) => memory.observedAtTick))
    : null;
  return {
    phase: authority.phase,
    waveNumber: authority.waveIndex,
    counterUnit: authority.desiredCounterUnit,
    counterLockedUntilTick: authority.counterLockedUntilTick,
    lastEnemyObservedTick,
    targetSite: newest ? {
      entityId: newest.entityId,
      typeId: newest.typeId,
      lastKnownPosition: { ...newest.lastKnownPosition },
      observedAtTick: newest.observedAtTick,
    } : null,
    regroupUntilTick: authority.phase === "regrouping" ? authority.phaseLockedUntilTick : 0,
    nextAssaultTick: authority.nextWaveAtTick,
    assaultUnitIds: authority.activeWave ? [...authority.activeWave.memberIds] : [],
    telemetry: { ...authority.telemetry },
  };
}

function refreshStrategicKnowledge(
  profile: AiProfile,
  tuning: AiStrategyTuning,
  strategic: MutableAiAuthorityState,
  observation: AiObservation,
): void {
  if (strategic.nextScoutAtTick === 0) strategic.nextScoutAtTick = tuning.scoutIntervalTicks;
  const currentById = new Map(strategic.enemyMemory.map((memory) => [memory.entityId, memory]));
  for (const entity of observation.visibleEnemyEntities) {
    if ((entity.kind !== "unit" && entity.kind !== "building") || entity.ownerId === null) continue;
    currentById.set(entity.id, {
      entityId: entity.id,
      ownerId: entity.ownerId,
      kind: entity.kind,
      typeId: entity.typeId as UnitType | BuildingType,
      lastKnownPosition: { ...entity.position },
      healthPermille: Math.max(0, Math.min(1_000, Math.floor(entity.hitPoints * 1_000 / Math.max(1, entity.maxHitPoints)))),
      observedAtTick: observation.serverTick,
      ...(entity.kind === "building" ? {
        orientation: entity.orientation,
        gateOpen: entity.gateOpen,
        complete: entity.complete,
        healthBand: entity.healthBand,
        blocksMovement: entity.blocksMovement,
      } : {}),
    });
  }

  const visibleIds = new Set(observation.visibleEnemyEntities.map((entity) => entity.id));
  const staleBuildings = new Map(observation.rememberedEnemySites.map((site) => [site.entityId, site]));
  strategic.enemyMemory = [...currentById.values()]
    .filter((memory) => {
      if (visibleIds.has(memory.entityId)) return true;
      if (memory.kind === "unit") return observation.serverTick - memory.observedAtTick <= 1_200;
      return staleBuildings.has(memory.entityId);
    })
    .map((memory) => {
      const stale = staleBuildings.get(memory.entityId);
      return stale && !visibleIds.has(memory.entityId)
        ? {
          ...memory,
          lastKnownPosition: { ...stale.lastKnownPosition },
          observedAtTick: stale.observedAtTick,
          orientation: stale.orientation,
          gateOpen: stale.gateOpen,
          complete: stale.complete,
          healthBand: stale.healthBand,
          blocksMovement: stale.blocksMovement,
        }
        : memory;
    })
    .sort((left, right) => compareText(left.entityId, right.entityId));

  const composition = new Map<CombatUnitId, number>();
  for (const memory of strategic.enemyMemory) {
    if (memory.kind !== "unit" || !isCombatUnitType(memory.typeId)) continue;
    const age = observation.serverTick - memory.observedAtTick;
    const confidence = age <= 200 ? 1_000 : age <= 600 ? 650 : 350;
    composition.set(memory.typeId, (composition.get(memory.typeId) ?? 0) + confidence);
  }
  if (composition.size === 0) return;

  const scored = counterCandidates(observation, composition, profile);
  const challenger = scored[0];
  if (!challenger) return;
  const current = strategic.desiredCounterUnit
    ? scored.find((entry) => entry.candidate === strategic.desiredCounterUnit)
    : undefined;
  const maySwitch = strategic.desiredCounterUnit === null
    || (observation.serverTick >= strategic.counterLockedUntilTick
      && (!current || challenger.score >= current.score + 150));
  if (maySwitch && strategic.desiredCounterUnit !== challenger.candidate) {
    strategic.desiredCounterUnit = challenger.candidate;
    strategic.counterLockedUntilTick = observation.serverTick + tuning.counterLockTicks;
    strategic.telemetry = { ...strategic.telemetry, counterSwitches: strategic.telemetry.counterSwitches + 1 };
  }
}

function counterCandidates(
  observation: AiObservation,
  composition: ReadonlyMap<CombatUnitId, number>,
  profile: AiProfile,
): readonly { readonly candidate: CombatUnitId; readonly score: number }[] {
  const preferred = new Map(profile.preferredUnits.map((unitType, index) => [unitType, index]));
  const owned = new Map<CombatUnitId, number>();
  for (const entity of observation.ownEntities) {
    if (entity.kind === "unit" && isCombatUnitType(entity.typeId)) owned.set(entity.typeId, (owned.get(entity.typeId) ?? 0) + 1);
  }
  for (const queue of Object.values(observation.ownProductionQueues)) {
    for (const job of queue) {
      if (job.kind === "train" && isCombatUnitType(job.unitType)) owned.set(job.unitType, (owned.get(job.unitType) ?? 0) + 1);
    }
  }
  return (Object.keys(COMBAT_UNITS) as CombatUnitId[])
    .filter((candidate) => tierReached(observation.settlementTier, UNITS[candidate].requiredTier))
    .map((candidate) => ({
      candidate,
      score: [...composition.entries()].reduce((sum, [enemy, confidence]) => (
        sum + Math.round(COUNTER_MATRIX[candidate][enemy] * confidence)
      ), 0) - (owned.get(candidate) ?? 0) * 120 + (profile.preferredUnits.includes(candidate) ? 40 : 0),
    }))
    .sort((left, right) => right.score - left.score
      || (preferred.get(left.candidate) ?? 999) - (preferred.get(right.candidate) ?? 999)
      || compareText(left.candidate, right.candidate));
}

function urgentStrategicCommand(
  profile: AiProfile,
  tuning: AiStrategyTuning,
  strategic: MutableAiAuthorityState,
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  military: readonly PublicEntityState[],
  visibleTarget: PublicEntityState | undefined,
): GameCommand | null {
  const home = homePoint(observation, military[0]?.position ?? { x: 0, y: 0 });
  if (strategic.phase === "retreating") return null;
  const defendedStructures = observation.ownEntities.filter((entity) => entity.kind === "building" && (
    entity.typeId === "townCenter"
    || entity.typeId === "surveyGate"
    || entity.typeId === "resinPalisade"
    || entity.typeId === "defenseTower"
  ));
  const threats = observation.visibleEnemyEntities
    .filter((entity) => entity.kind === "unit" && isCombatUnitType(entity.typeId))
    .filter((enemy) => defendedStructures.some((structure) => distanceSquared(enemy.position, structure.position) <= 64))
    .sort((left, right) => distanceSquared(left.position, home) - distanceSquared(right.position, home) || compareText(left.id, right.id));
  if (threats.length > 0 && (profile.id === "guardian" || profile.id === "balanced")) {
    setStrategicPhase(strategic, "defending", observation.serverTick, observation.serverTick + 80);
    strategic.activeWave = null;
    const ownPower = forceStrength(military);
    const enemyPower = forceStrength(threats);
    if (military.length > 0 && ownPower >= enemyPower * (profile.id === "guardian" ? 0.72 : 0.9)) {
      const target = threats[0]!;
      return abilityCommand(profile, observation, military, target)
        ?? { type: "attack", entityIds: military.map((unit) => unit.id), targetId: target.id };
    }
    if (military.length > 0) return retreatCommand(strategic, tuning, observation, military, home);
  }

  if (strategic.phase === "assaulting" && strategic.activeWave) {
    const members = military.filter((unit) => strategic.activeWave!.memberIds.includes(unit.id));
    if (members.length === 0) {
      strategic.activeWave = null;
      strategic.regroupPoint = nearestOpenWaypoint(observation, home) ?? home;
      setStrategicPhase(strategic, "regrouping", observation.serverTick, observation.serverTick + tuning.regroupTicks);
      return null;
    }
    const strengthRatio = forceStrength(members) / Math.max(1, strategic.activeWave.baselineStrength);
    if (members.length > 0
      && observation.serverTick >= strategic.phaseLockedUntilTick
      && (strengthRatio <= tuning.retreatStrengthRatio || averageHealthRatio(members) <= tuning.retreatHealthRatio)) {
      return retreatCommand(strategic, tuning, observation, members, home);
    }
  }

  const repair = repairCommand(tuning, strategic, observation, villagers, threats);
  if (repair) return repair;

  if (visibleTarget && military.length > 0 && strategic.phase === "assaulting") {
    return abilityCommand(profile, observation, military, visibleTarget);
  }
  return null;
}

function repairCommand(
  tuning: AiStrategyTuning,
  strategic: MutableAiAuthorityState,
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  threats: readonly PublicEntityState[],
): GameCommand | null {
  if (observation.wallet.wood < 1 || threats.length > 0) return null;
  const priority: Readonly<Record<string, number>> = {
    surveyGate: 0,
    townCenter: 1,
    defenseTower: 2,
    resinPalisade: 3,
  };
  const candidates = observation.ownEntities
    .filter((entity) => entity.kind === "building"
      && entity.complete !== false
      && entity.hitPoints > 0
      && entity.hitPoints < entity.maxHitPoints
      && entity.hitPoints / Math.max(1, entity.maxHitPoints) <= tuning.repairHealthRatio)
    .sort((left, right) => (priority[left.typeId] ?? 4) - (priority[right.typeId] ?? 4)
      || left.hitPoints / left.maxHitPoints - right.hitPoints / right.maxHitPoints
      || compareText(left.id, right.id));
  const available = villagers
    .filter((villager) => (villager.cargo?.amount ?? 0) <= 0
      && (villager.civilianActivity === undefined || villager.civilianActivity === "idle" || villager.civilianActivity === "walking"))
    .sort((left, right) => compareText(left.id, right.id));
  for (const target of candidates) {
    const builder = available.find((villager) => canReachKnownEntity(observation, villager.position, target));
    if (!builder) continue;
    if (strategic.repairTargetId === target.id && builder.civilianActivity === "repairing") return null;
    strategic.repairTargetId = target.id;
    setStrategicPhase(strategic, "repairing", observation.serverTick, observation.serverTick + 40);
    strategic.telemetry = { ...strategic.telemetry, repairsOrdered: strategic.telemetry.repairsOrdered + 1 };
    return { type: "repair", entityIds: [builder.id], targetId: target.id };
  }
  strategic.repairTargetId = null;
  return null;
}

function strategicFieldCommand(
  profile: AiProfile,
  tuning: AiStrategyTuning,
  strategic: MutableAiAuthorityState,
  observation: AiObservation,
  military: readonly PublicEntityState[],
  visibleTarget: PublicEntityState | undefined,
  randomValue: number,
): GameCommand | null {
  if (military.length === 0) {
    strategic.activeWave = null;
    if (strategic.phase !== "repairing") setStrategicPhase(strategic, "economy", observation.serverTick);
    return null;
  }
  const home = homePoint(observation, military[0]!.position);
  const regroup = strategic.regroupPoint ?? nearestOpenWaypoint(observation, home) ?? home;

  if (strategic.phase === "retreating") {
    const survivors = strategic.activeWave
      ? military.filter((unit) => strategic.activeWave!.memberIds.includes(unit.id))
      : [...military];
    const assembled = survivors.every((unit) => distanceSquared(unit.position, regroup) <= 16);
    if (assembled && observation.serverTick >= strategic.phaseLockedUntilTick) {
      strategic.activeWave = null;
      strategic.regroupPoint = { ...regroup };
      setStrategicPhase(strategic, "regrouping", observation.serverTick, observation.serverTick + tuning.regroupTicks);
    }
    return null;
  }

  const assaultForce = selectAssaultForce(military, home, tuning.defenderReserve);
  const requiredWaveSize = tuning.minimumAssaultUnits + Math.min(strategic.waveIndex, 2);
  if (strategic.phase === "regrouping") {
    const cohesive = assaultForce.every((unit) => distanceSquared(unit.position, regroup) <= 16);
    if (!cohesive) {
      const shouldRefreshMove = observation.serverTick === strategic.phaseStartedTick
        || (observation.serverTick - strategic.phaseStartedTick) % 200 === 0;
      return shouldRefreshMove && assaultForce.length > 0
        ? { type: "move", entityIds: assaultForce.map((unit) => unit.id), target: regroup }
        : null;
    }
    if (observation.serverTick < strategic.phaseLockedUntilTick || assaultForce.length < requiredWaveSize) return null;
    if (profile.id === "guardian" && !chooseRememberedObjective(profile, strategic.enemyMemory) && !visibleTarget) {
      setStrategicPhase(strategic, "defending", observation.serverTick);
      return defensivePatrol(observation, military, home);
    }
  }

  if (strategic.phase === "assaulting" && strategic.activeWave && !visibleTarget) {
    if (observation.serverTick >= strategic.nextWaveAtTick) {
      return retreatCommand(strategic, tuning, observation, military.filter((unit) => strategic.activeWave!.memberIds.includes(unit.id)), home);
    }
    return null;
  }
  if (visibleTarget && assaultForce.length >= tuning.minimumAssaultUnits) {
    const visibleEnemyForce = observation.visibleEnemyEntities.filter((entity) => entity.kind === "unit" && isCombatUnitType(entity.typeId));
    const canEngage = forceStrength(assaultForce) >= forceStrength(visibleEnemyForce) * tuning.retreatStrengthRatio;
    if (canEngage) {
      if (strategic.phase !== "assaulting" || !strategic.activeWave) {
        launchWave(strategic, tuning, observation, assaultForce, visibleTarget.id, visibleTarget.position);
      }
      return abilityCommand(profile, observation, assaultForce, chooseBreachTarget(observation, visibleTarget))
        ?? (strategic.phaseStartedTick === observation.serverTick
          ? { type: "attack", entityIds: assaultForce.map((unit) => unit.id), targetId: chooseBreachTarget(observation, visibleTarget).id }
          : null);
    }
  }

  if (assaultForce.length >= requiredWaveSize && observation.serverTick >= strategic.nextWaveAtTick) {
    const remembered = chooseRememberedObjective(profile, strategic.enemyMemory);
    if (profile.id !== "guardian" || remembered || visibleTarget) {
      const targetPosition = remembered?.lastKnownPosition ?? genericEnemyApproach(observation, home);
      const targetEntity = visibleTarget ?? (remembered
        ? observation.visibleEnemyEntities.find((entity) => entity.id === remembered.entityId)
        : undefined);
      launchWave(strategic, tuning, observation, assaultForce, targetEntity?.id ?? null, targetPosition);
      if (targetEntity) {
        const breach = chooseBreachTarget(observation, targetEntity);
        return { type: "attack", entityIds: assaultForce.map((unit) => unit.id), targetId: breach.id };
      }
      return {
        type: "attackMove",
        entityIds: assaultForce.map((unit) => unit.id),
        target: nearestOpenWaypoint(observation, targetPosition) ?? assaultForce[0]!.position,
      };
    }
  }

  if (observation.serverTick >= strategic.nextScoutAtTick && military.length > 0) {
    const scout = [...military].sort((left, right) => (
      (left.typeId === "boarRider" ? -1 : 0) - (right.typeId === "boarRider" ? -1 : 0)
      || compareText(left.id, right.id)
    ))[0]!;
    const remembered = chooseRememberedObjective(profile, strategic.enemyMemory);
    const target = remembered?.lastKnownPosition ?? scoutFrontier(observation, home, strategic.scoutIndex, randomValue);
    strategic.scoutIndex = (strategic.scoutIndex + 1) % 4;
    strategic.nextScoutAtTick = observation.serverTick + tuning.scoutIntervalTicks;
    setStrategicPhase(strategic, "scouting", observation.serverTick, observation.serverTick + 40);
    strategic.telemetry = { ...strategic.telemetry, scoutsSent: strategic.telemetry.scoutsSent + 1 };
    return { type: "attackMove", entityIds: [scout.id], target: nearestOpenWaypoint(observation, target) ?? scout.position };
  }
  return null;
}

function retreatCommand(
  strategic: MutableAiAuthorityState,
  tuning: AiStrategyTuning,
  observation: AiObservation,
  units: readonly PublicEntityState[],
  home: GridPoint,
): GameCommand {
  const target = nearestOpenWaypoint(observation, home) ?? units[0]!.position;
  strategic.regroupPoint = { ...target };
  strategic.nextWaveAtTick = observation.serverTick + tuning.waveCooldownTicks;
  setStrategicPhase(strategic, "retreating", observation.serverTick, observation.serverTick + 60);
  strategic.telemetry = { ...strategic.telemetry, retreatsOrdered: strategic.telemetry.retreatsOrdered + 1 };
  return { type: "move", entityIds: units.map((unit) => unit.id), target };
}

function launchWave(
  strategic: MutableAiAuthorityState,
  tuning: AiStrategyTuning,
  observation: AiObservation,
  units: readonly PublicEntityState[],
  targetEntityId: EntityId | null,
  targetPosition: GridPoint,
): void {
  strategic.waveIndex += 1;
  strategic.nextWaveAtTick = observation.serverTick + tuning.waveCooldownTicks;
  strategic.activeWave = {
    memberIds: units.map((unit) => unit.id).sort(compareText),
    targetEntityId,
    targetPosition: { ...targetPosition },
    launchedAtTick: observation.serverTick,
    baselineStrength: forceStrength(units),
  };
  setStrategicPhase(strategic, "assaulting", observation.serverTick, observation.serverTick + 80);
  strategic.telemetry = { ...strategic.telemetry, wavesLaunched: strategic.telemetry.wavesLaunched + 1 };
}

function setStrategicPhase(
  strategic: MutableAiAuthorityState,
  phase: AiStrategicPhase,
  tick: number,
  lockedUntilTick = tick,
): void {
  if (strategic.phase !== phase) {
    strategic.phase = phase;
    strategic.phaseStartedTick = tick;
  }
  strategic.phaseLockedUntilTick = Math.max(strategic.phaseLockedUntilTick, lockedUntilTick);
}

function chooseRememberedObjective(profile: AiProfile, memory: readonly AiEnemyMemory[]): AiEnemyMemory | undefined {
  const classRank = new Map(profile.targetPriority.map((target, index) => [target, index]));
  return [...memory]
    .filter((entry) => entry.kind === "building")
    .sort((left, right) => (classRank.get(targetClassFromType(left.kind, left.typeId)) ?? 99)
      - (classRank.get(targetClassFromType(right.kind, right.typeId)) ?? 99)
      || right.observedAtTick - left.observedAtTick
      || compareText(left.entityId, right.entityId))[0];
}

function chooseBreachTarget(observation: AiObservation, fallback: PublicEntityState): PublicEntityState {
  const priority: Readonly<Record<string, number>> = { surveyGate: 0, resinPalisade: 1 };
  return observation.visibleEnemyEntities
    .filter((entity) => entity.kind === "building" && (entity.typeId === "surveyGate" || entity.typeId === "resinPalisade"))
    .sort((left, right) => (priority[left.typeId] ?? 9) - (priority[right.typeId] ?? 9)
      || distanceSquared(left.position, fallback.position) - distanceSquared(right.position, fallback.position)
      || compareText(left.id, right.id))[0] ?? fallback;
}

function selectAssaultForce(
  military: readonly PublicEntityState[],
  home: GridPoint,
  reserve: number,
): PublicEntityState[] {
  const closestFirst = [...military].sort((left, right) => distanceSquared(left.position, home) - distanceSquared(right.position, home) || compareText(left.id, right.id));
  const reserved = new Set(closestFirst.slice(0, reserve).map((unit) => unit.id));
  return [...military].filter((unit) => !reserved.has(unit.id)).sort((left, right) => compareText(left.id, right.id));
}

function forceStrength(units: readonly PublicEntityState[]): number {
  return units.reduce((sum, unit) => {
    if (unit.kind !== "unit" || !isCombatUnitType(unit.typeId)) return sum;
    const definition = UNITS[unit.typeId];
    const base = definition.attackDamage * 8 + definition.maxHitPoints;
    return sum + Math.max(1, Math.floor(base * unit.hitPoints / Math.max(1, unit.maxHitPoints)));
  }, 0);
}

function averageHealthRatio(units: readonly PublicEntityState[]): number {
  const maximum = units.reduce((sum, unit) => sum + unit.maxHitPoints, 0);
  return maximum <= 0 ? 0 : units.reduce((sum, unit) => sum + unit.hitPoints, 0) / maximum;
}

function homePoint(observation: AiObservation, fallback: GridPoint): GridPoint {
  return observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? fallback;
}

function genericEnemyApproach(observation: AiObservation, home: GridPoint): GridPoint {
  return {
    x: home.x < observation.map.width / 2 ? Math.floor(observation.map.width * 2 / 3) : Math.floor(observation.map.width / 3),
    y: Math.max(1, Math.min(observation.map.height - 2, home.y)),
  };
}

function scoutFrontier(observation: AiObservation, home: GridPoint, index: number, randomValue: number): GridPoint {
  const explored = new Set(observation.exploredTileIndices);
  const terrainBlocked = new Set((observation.map.id === VILLAGE_ASSAULT_MAP_ID
    ? getVillageAssaultWalkBlockedCells(observation.map.layoutId)
    : []).map((point) => point.y * observation.map.width + point.x));
  const frontier: GridPoint[] = [];
  for (let y = 0; y < observation.map.height; y += 1) {
    for (let x = 0; x < observation.map.width; x += 1) {
      const tile = y * observation.map.width + x;
      if (explored.has(tile) || terrainBlocked.has(tile)) continue;
      const adjacent = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const;
      if (adjacent.some(([nextX, nextY]) => nextX >= 0
        && nextY >= 0
        && nextX < observation.map.width
        && nextY < observation.map.height
        && explored.has(nextY * observation.map.width + nextX))) {
        frontier.push({ x, y });
      }
    }
  }
  if (frontier.length > 0) {
    frontier.sort((left, right) => (
      distanceSquared(right, home) - distanceSquared(left, home)
      || (randomValue % 2 === 0 ? left.y - right.y : right.y - left.y)
      || left.x - right.x
    ));
    return frontier[index % frontier.length]!;
  }
  const margin = 2;
  const fallback = [
    { x: margin, y: margin },
    { x: observation.map.width - 1 - margin, y: margin },
    { x: observation.map.width - 1 - margin, y: observation.map.height - 1 - margin },
    { x: margin, y: observation.map.height - 1 - margin },
  ];
  return fallback[(index + (home.x < observation.map.width / 2 ? 1 : 3)) % fallback.length]!;
}

function canReachKnownEntity(observation: AiObservation, start: GridPoint, target: PublicEntityState): boolean {
  return target.kind === "building" && findKnownVisibleApproachRoute(observation, start, target) !== null;
}

function targetClassFromType(kind: "unit" | "building", typeId: UnitType | BuildingType): "townCenter" | "military" | "economy" | "villager" {
  if (typeId === "townCenter") return "townCenter";
  if (typeId === "villager") return "villager";
  if (kind === "unit" || !["townCenter", "house", "lumberCamp", "farmstead"].includes(typeId)) return "military";
  return "economy";
}

export function getAiObservation(state: MatchState, playerId: PlayerId, _rememberedEnemySites: readonly RememberedEnemySite[] = []): AiObservation {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`Unknown AI player: ${playerId}`);
  const visibility = getPlayerVisibilityState(state, playerId);
  const ownEntities = sortPublicEntities(state.entities.filter((entity) => entity.ownerId === playerId).map(toPublicEntity));
  const visible = state.entities.filter((entity) => entity.ownerId !== playerId && isEntityVisibleToPlayer(state, playerId, entity));
  const authoritativeMemory = visibility.staleEnemySightings.map((sighting) => ({
    entityId: sighting.entityId,
    typeId: sighting.typeId,
    lastKnownPosition: { ...sighting.position },
    observedAtTick: sighting.observedAtTick,
    orientation: sighting.orientation,
    gateOpen: sighting.gateOpen,
    complete: sighting.complete,
    healthBand: sighting.healthBand,
    blocksMovement: sighting.blocksMovement,
  }));
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
        .sort((left, right) => compareText(left.id, right.id))
        .map((building) => [building.id, building.productionQueue.length]),
    ),
    ownProductionQueues: Object.fromEntries(
      state.entities
        .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === playerId)
        .sort((left, right) => compareText(left.id, right.id))
        .map((building) => [building.id, building.productionQueue.map((job) => ({ ...job, jobId: { ...job.jobId }, paidCost: { ...job.paidCost } }))]),
    ),
    ownRallyPoints: Object.fromEntries(
      state.entities
        .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === playerId)
        .sort((left, right) => compareText(left.id, right.id))
        .map((building) => [building.id, building.rallyPoint ? { ...building.rallyPoint } : null]),
    ),
    completedTechnologyIds: [...player.completedTechnologyIds],
    ownIncompleteBuildingIds: state.entities
      .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === playerId && !entity.complete)
      .map((building) => building.id)
      .sort(compareText),
    visibleEnemyEntities: sortPublicEntities(visible.filter((entity) => entity.ownerId !== null && arePlayersHostile(state, playerId, entity.ownerId)).map(toPublicEntity)),
    // Keep fallow renewable fields in spatial knowledge so the AI will not try
    // to build over them. Economy selection separately filters empty nodes.
    visibleResourceEntities: sortPublicEntities(visible.filter((entity) => entity.kind === "resource").map(toPublicEntity)),
    visibleWorldEntities: sortPublicEntities(visible.filter((entity) => (
      entity.kind !== "resource"
      && (entity.ownerId === null || !arePlayersHostile(state, playerId, entity.ownerId))
    )).map(toPublicEntity)),
    visibleTileIndices: [...visibility.visibleTileIndices],
    exploredTileIndices: [...visibility.exploredTileIndices],
    rememberedEnemySites: sanitizeRememberedEnemySites(authoritativeMemory, state.tick, state.map),
  };
}

function decideForProfile(
  profile: AiProfile,
  tuning: AiStrategyTuning,
  strategic: MutableAiAuthorityState,
  observation: AiObservation,
  randomValue: number,
): GameCommand | null {
  const ownUnits = observation.ownEntities.filter((entity) => entity.kind === "unit");
  const villagers = ownUnits.filter((entity) => entity.typeId === "villager");
  const military = ownUnits.filter((entity) => entity.typeId !== "villager");
  const incompleteIds = new Set(observation.ownIncompleteBuildingIds);
  const townCenterSite = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter");
  const townCenter = townCenterSite && !incompleteIds.has(townCenterSite.id) ? townCenterSite : undefined;
  const incompleteBuilding = incompleteIds.size > 0;
  const visibleTarget = chooseTarget(profile, observation.visibleEnemyEntities, randomValue);

  const populationRecovery = populationRecoveryCommand(profile, observation);
  if (populationRecovery) return populationRecovery;

  if (observation.advancement) {
    return advancementSupportCommand(observation, villagers, incompleteBuilding, randomValue);
  }
  const progression = settlementProgressionCommand(profile, observation, villagers, randomValue);
  if (progression) return progression;
  // A visible enemy delays research until the AI has a field force, but does
  // not permanently freeze its strategic progression during a long battle.
  if (!visibleTarget || military.length >= 3) {
    const research = researchProgressionCommand(profile, observation, villagers, randomValue);
    if (research) return research;
  }

  const urgentStrategy = urgentStrategicCommand(profile, tuning, strategic, observation, villagers, military, visibleTarget);
  if (urgentStrategy) return urgentStrategy;

  const fieldStrategy = strategicFieldCommand(profile, tuning, strategic, observation, military, visibleTarget, randomValue);
  if (fieldStrategy) return fieldStrategy;

  switch (profile.id) {
    case "aggressor":
      if (incompleteBuilding) return null;
      return productionCommand(profile, observation, villagers, "warrior", 1, randomValue, strategic);
    case "guardian": {
      const home = townCenter?.position;
      if (incompleteBuilding) return null;
      if (!observation.ownEntities.some((entity) => entity.kind === "building" && entity.typeId === "defenseTower")) {
        return affordableBuild(observation, villagers, "defenseTower", 2) ?? economyCommand(observation, villagers, randomValue);
      }
      if (military.length >= 3 && (strategic.phase === "economy" || strategic.phase === "defending")) return defensivePatrol(observation, military, home ?? military[0]!.position);
      return productionCommand(profile, observation, villagers, "shieldBearer", 1, randomValue, strategic);
    }
    case "prosperer":
      if (townCenter && villagers.length < 5 && observation.population.used + 1 <= observation.population.capacity) {
        const train = affordableTrain(observation, townCenter.id, "villager");
        if (train) return train;
        return economyCommand(observation, villagers, randomValue);
      }
      if (incompleteBuilding) return null;
      if (military.length < tuning.minimumAssaultUnits + tuning.defenderReserve) return productionCommand(profile, observation, villagers, "archer", 1, randomValue, strategic);
      return economyCommand(observation, villagers, randomValue) ?? affordableBuild(observation, villagers, "lumberCamp", 2);
    case "balanced":
      if (incompleteBuilding) return null;
      if (observation.serverTick === 0) return economyCommand(observation, villagers, randomValue);
      const availableBalancedUnits = (["shieldBearer", "archer", "mage", "musketeer"] as const)
        .filter((unitType) => tierReached(observation.settlementTier, UNITS[unitType].requiredTier));
      return productionCommand(
        profile,
        observation,
        villagers,
        availableBalancedUnits[military.length % availableBalancedUnits.length]!,
        1,
        randomValue,
        strategic,
      );
    case "raider":
      if (incompleteBuilding) return null;
      if (military.length > 0 && (strategic.phase === "economy" || strategic.phase === "defending")) return flankPatrol(observation, military[0]!, randomValue);
      return productionCommand(profile, observation, villagers, "boarRider", -1, randomValue, strategic);
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
    type: "attackMove",
    entityIds: military.map((unit) => unit.id),
    target: nearestOpenWaypoint(observation, desired) ?? military[0]!.position,
  };
}

function abilityCommand(profile: AiProfile, observation: AiObservation, military: readonly PublicEntityState[], target: PublicEntityState): GameCommand | null {
  const preference = new Map(profile.preferredUnits.map((unitType, index) => [unitType, index]));
  const casters = [...military]
    .filter((unit) => isCombatUnitType(unit.typeId)
      && (unit.combatPhase === undefined || unit.combatPhase === "ready")
      && (unit.abilityReadyTick === undefined || unit.abilityReadyTick <= observation.serverTick)
      && !unit.statuses?.some((status) => status.id === "stagger"))
    .sort((left, right) => (preference.get(left.typeId as UnitType) ?? 999) - (preference.get(right.typeId as UnitType) ?? 999)
      || distanceSquared(left.position, target.position) - distanceSquared(right.position, target.position)
      || compareText(left.id, right.id));
  for (const caster of casters) {
    if (!isCombatUnitType(caster.typeId)) continue;
    const ability = COMBAT_UNITS[caster.typeId].activeAbility;
    const rangeSquared = UNITS[caster.typeId].attackRange ** 2;
    if (ability.targeting === "self") {
      if (distanceSquared(caster.position, target.position) > rangeSquared) continue;
      return { type: "castAbility", casterId: caster.id, abilityId: ability.id, target: { kind: "self" } };
    }
    if (ability.targeting === "unit") {
      const unitTarget = observation.visibleEnemyEntities
        .filter((candidate) => candidate.kind === "unit" && distanceSquared(caster.position, candidate.position) <= rangeSquared)
        .sort((left, right) => distanceSquared(caster.position, left.position) - distanceSquared(caster.position, right.position) || compareText(left.id, right.id))[0];
      if (unitTarget) return { type: "castAbility", casterId: caster.id, abilityId: ability.id, target: { kind: "entity", entityId: unitTarget.id } };
      continue;
    }
    if (ability.targeting === "ground") {
      if (distanceSquared(caster.position, target.position) > rangeSquared) continue;
      return { type: "castAbility", casterId: caster.id, abilityId: ability.id, target: { kind: "ground", point: { ...target.position } } };
    }
    const vector = { x: target.position.x - caster.position.x, y: target.position.y - caster.position.y };
    if (vector.x !== 0 || vector.y !== 0) return { type: "castAbility", casterId: caster.id, abilityId: ability.id, target: { kind: "direction", vector } };
  }
  return null;
}

function economyCommand(
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  randomValue: number,
  targetWallet?: ResourceWallet,
): GameCommand | null {
  const availableVillagers = villagers
    .filter((villager) => (
      (villager.cargo?.amount ?? 0) <= 0
      && (villager.civilianActivity === undefined
        || villager.civilianActivity === "idle"
        // A tier/build/research target is an explicit economy rebalance: an
        // empty-handed gatherer may move to the missing resource, while
        // hauling, construction and repairs remain protected.
        || (targetWallet !== undefined && villager.civilianActivity === "gathering"))
    ))
    .sort((left, right) => compareText(left.id, right.id));
  if (availableVillagers.length === 0 || observation.visibleResourceEntities.length === 0) return null;
  const scarce = (["stone", "wood", "food"] satisfies ResourceKind[]).sort((left, right) => (
    targetWallet
      ? (targetWallet[right] - observation.wallet[right]) - (targetWallet[left] - observation.wallet[left])
      : observation.wallet[left] - observation.wallet[right]
  ))[0]!;
  const stocked = observation.visibleResourceEntities.filter((entity) => (entity.resourceNode?.amount ?? 0) > 0);
  const candidates = stocked.filter((entity) => entity.typeId === scarce);
  const pool = candidates.length > 0 ? candidates : [...stocked];
  const home = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position;
  const localPool = home ? pool.filter((entity) => distanceSquared(home, entity.position) <= 100) : pool;
  // Once a nearby field is exhausted, migrate to another currently visible,
  // route-legal field instead of permanently starving the requested resource.
  const preferred = localPool.length > 0 ? localPool : pool;
  const assignments = preferred.flatMap((target) => {
    if (target.kind !== "resource") return [];
    const resourceKind = target.typeId as ResourceKind;
    const dropOffs = observation.ownEntities
      .filter((entity) => entity.kind === "building"
        && entity.hitPoints > 0
        && entity.complete !== false
        && isKnownBuildingType(entity.typeId)
        && (BUILDINGS[entity.typeId].dropOffResources?.includes(resourceKind) ?? false))
      .sort((left, right) => compareText(left.id, right.id));
    if (dropOffs.length === 0) return [];
    const reachable = availableVillagers.flatMap((villager) => {
      const resourceRoute = findKnownVisibleApproachRoute(observation, villager.position, target);
      const dropOffDistance = dropOffs.reduce<number | null>((best, dropOff) => {
        const route = findKnownVisibleApproachRoute(observation, villager.position, dropOff);
        return route && (best === null || route.distance < best) ? route.distance : best;
      }, null);
      return resourceRoute && dropOffDistance !== null
        ? [{ villager, distance: resourceRoute.distance }]
        : [];
    });
    return reachable.length > 0
      ? [{ target, villagers: reachable.map((entry) => entry.villager), distance: Math.min(...reachable.map((entry) => entry.distance)) }]
      : [];
  }).sort((left, right) => (
    left.distance - right.distance
    || (randomValue % 2 === 0 ? compareText(left.target.id, right.target.id) : compareText(right.target.id, left.target.id))
  ));
  const assignment = assignments[0];
  return assignment
    ? { type: "gather", entityIds: assignment.villagers.map((villager) => villager.id), targetId: assignment.target.id }
    : null;
}

function affordableTrain(observation: AiObservation, producerId: EntityId, unitType: UnitType): GameCommand | null {
  const definition = UNITS[unitType];
  if (!tierReached(observation.settlementTier, definition.requiredTier)) return null;
  if (observation.ownTrainingQueueDepth[producerId] === undefined) return null;
  if (observation.ownTrainingQueueDepth[producerId] >= MAX_TRAINING_QUEUE_DEPTH) return null;
  if (!canAfford(observation.wallet, definition.cost) || observation.population.used + definition.population > observation.population.capacity) return null;
  return { type: "train", producerId, unitType, count: 1 };
}

function researchProgressionCommand(
  profile: AiProfile,
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  randomValue: number,
): GameCommand | null {
  const queuedTechnologies = new Set<TechnologyType>();
  for (const queue of Object.values(observation.ownProductionQueues)) {
    for (const job of queue) if (job.kind === "research") queuedTechnologies.add(job.technologyId);
  }
  const completed = new Set(observation.completedTechnologyIds);
  const incomplete = new Set(observation.ownIncompleteBuildingIds);
  if (queuedTechnologies.size > 0) return null;
  const preferredCompletedCount = profile.preferredTechnologies.filter((technologyId) => completed.has(technologyId)).length;
  if (observation.serverTick < profile.researchAfterTick + preferredCompletedCount * profile.researchIntervalTicks) return null;

  for (const technologyId of profile.preferredTechnologies) {
    if (completed.has(technologyId) || queuedTechnologies.has(technologyId)) continue;
    const definition = TECHNOLOGIES[technologyId];
    if (!tierReached(observation.settlementTier, definition.requiredTier)) continue;
    if (!definition.prerequisites.every((prerequisite) => completed.has(prerequisite))) continue;

    const producer = observation.ownEntities
      .filter((entity) => entity.kind === "building" && entity.typeId === definition.producer)
      .sort((left, right) => compareText(left.id, right.id))[0];
    if (!producer) {
      return affordableBuild(observation, villagers, definition.producer, profile.mobilityWeight >= profile.defenseWeight ? -1 : 1)
        ?? economyCommand(observation, villagers, randomValue, definition.cost);
    }
    if (incomplete.has(producer.id)) return null;
    if ((observation.ownTrainingQueueDepth[producer.id] ?? MAX_TRAINING_QUEUE_DEPTH) >= MAX_TRAINING_QUEUE_DEPTH) continue;
    if (!canAfford(observation.wallet, definition.cost)) return economyCommand(observation, villagers, randomValue, definition.cost);
    return { type: "research", producerId: producer.id, technologyId };
  }

  // Canonical fallback keeps a profile progressing if a future content update
  // removes one of its explicit preferences.
  const remaining = TECHNOLOGY_ORDER.find((technologyId) => (
    !completed.has(technologyId)
    && !queuedTechnologies.has(technologyId)
    && tierReached(observation.settlementTier, TECHNOLOGIES[technologyId].requiredTier)
    && TECHNOLOGIES[technologyId].prerequisites.every((prerequisite) => completed.has(prerequisite))
  ));
  if (!remaining) return null;
  const definition = TECHNOLOGIES[remaining];
  const producer = observation.ownEntities
    .filter((entity) => entity.kind === "building" && entity.typeId === definition.producer && !incomplete.has(entity.id))
    .sort((left, right) => compareText(left.id, right.id))[0];
  if (!producer || (observation.ownTrainingQueueDepth[producer.id] ?? MAX_TRAINING_QUEUE_DEPTH) >= MAX_TRAINING_QUEUE_DEPTH || !canAfford(observation.wallet, definition.cost)) return null;
  return { type: "research", producerId: producer.id, technologyId: remaining };
}

function productionCommand(
  profile: AiProfile,
  observation: AiObservation,
  villagers: readonly PublicEntityState[],
  unitType: UnitType,
  direction: number,
  randomValue: number,
  strategic?: AiAuthorityState,
): GameCommand | null {
  const counterUnit = strategic?.desiredCounterUnit ?? chooseCounterUnit(observation);
  unitType = counterUnit ?? unitType;
  if (!tierReached(observation.settlementTier, UNITS[unitType].requiredTier)) {
    return settlementProgressionCommand(profile, observation, villagers, randomValue)
      ?? economyCommand(observation, villagers, randomValue);
  }
  if (observation.population.used + UNITS[unitType].population > observation.population.capacity) {
    return affordableBuild(observation, villagers, "house", direction);
  }
  const producerType = UNITS[unitType].producers[0];
  if (!producerType) return economyCommand(observation, villagers, randomValue);
  const producer = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === producerType);
  if (producer) {
    if (observation.ownIncompleteBuildingIds.includes(producer.id)) return null;
    const train = affordableTrain(observation, producer.id, unitType);
    if (train && unitType !== "villager" && observation.ownRallyPoints[producer.id] === null) {
      const target = chooseRallyTarget(profile, observation, producer);
      if (target) return { type: "setRallyPoint", producerId: producer.id, target };
    }
    return train ?? economyCommand(observation, villagers, randomValue);
  }
  return affordableBuild(observation, villagers, producerType, direction) ?? economyCommand(observation, villagers, randomValue);
}

function affordableBuild(observation: AiObservation, villagers: readonly PublicEntityState[], buildingType: BuildingType, direction: number): GameCommand | null {
  if (!tierReached(observation.settlementTier, BUILDINGS[buildingType].requiredTier)) return null;
  if (!canAfford(observation.wallet, BUILDINGS[buildingType].cost)) return null;
  const builders = villagers
    .filter((villager) => (villager.cargo?.amount ?? 0) <= 0
      && villager.civilianActivity !== "constructing"
      && villager.civilianActivity !== "hauling"
      && villager.civilianActivity !== "repairing")
    .sort((left, right) => compareText(left.id, right.id));
  for (const builder of builders) {
    const anchor = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? builder.position;
    const origin = findOpenPoint(observation, anchor, buildingType, direction, builder);
    if (origin) return { type: "build", builderIds: [builder.id], buildingType, origin };
  }
  return null;
}

function chooseCounterUnit(observation: AiObservation): CombatUnitId | null {
  const enemyTypes = observation.visibleEnemyEntities
    .filter((entity) => entity.kind === "unit" && isCombatUnitType(entity.typeId))
    .map((entity) => entity.typeId as CombatUnitId);
  if (enemyTypes.length === 0) return null;
  return (Object.keys(COMBAT_UNITS) as CombatUnitId[])
    .filter((candidate) => tierReached(observation.settlementTier, UNITS[candidate].requiredTier))
    .map((candidate) => ({
      candidate,
      score: enemyTypes.reduce((sum, enemy) => sum + COUNTER_MATRIX[candidate][enemy], 0) / enemyTypes.length,
    }))
    .sort((left, right) => right.score - left.score || compareText(left.candidate, right.candidate))[0]?.candidate ?? null;
}

function isCombatUnitType(value: unknown): value is CombatUnitId {
  return typeof value === "string" && value in COMBAT_UNITS;
}

function populationRecoveryCommand(profile: AiProfile, observation: AiObservation): GameCommand | null {
  const queued = Object.entries(observation.ownProductionQueues).flatMap(([producerId, jobs]) => jobs.map((job, queueIndex) => ({ producerId, job, queueIndex })));
  // Authoritative population.used already includes queued training population.
  if (observation.population.used <= observation.population.capacity) return null;
  const preference = new Map(profile.preferredUnits.map((unitType, index) => [unitType, index]));
  const candidate = queued
    .filter((entry) => entry.job.kind === "train")
    .sort((left, right) => (
      right.queueIndex - left.queueIndex
      || (preference.get(right.job.kind === "train" ? right.job.unitType : "villager") ?? 999)
        - (preference.get(left.job.kind === "train" ? left.job.unitType : "villager") ?? 999)
      || compareText(right.producerId, left.producerId)
    ))[0];
  return candidate ? { type: "cancelProduction", producerId: candidate.producerId, jobId: { ...candidate.job.jobId } } : null;
}

function chooseRallyTarget(profile: AiProfile, observation: AiObservation, producer: PublicEntityState): GridPoint | null {
  const home = observation.ownEntities.find((entity) => entity.kind === "building" && entity.typeId === "townCenter")?.position ?? producer.position;
  const center = { x: Math.floor(observation.map.width / 2), y: Math.floor(observation.map.height / 2) };
  const toward = (from: GridPoint, to: GridPoint, distance: number): GridPoint => ({
    x: from.x + Math.sign(to.x - from.x) * distance,
    y: from.y + Math.sign(to.y - from.y) * distance,
  });
  const desired = profile.id === "guardian"
    ? toward(producer.position, home, 2)
    : profile.id === "raider"
      ? { x: producer.position.x + (producer.position.x < center.x ? 3 : -3), y: producer.position.y + (producer.position.y < center.y ? -2 : 2) }
      : profile.id === "prosperer"
        ? toward(producer.position, home, 2)
        : toward(producer.position, center, 3);
  if (producer.kind !== "building" || !isKnownBuildingType(producer.typeId)) return null;
  const blocked = knownVisibleWalkBlockedCells(observation);
  const blockedKeys = new Set(blocked.map(pointKey));
  const starts = getFootprintPerimeterCells(
    producer.position,
    getBuildingFootprint(producer.typeId, producer.orientation),
  ).filter((start) => (
    isPointInObservationBounds(observation, start)
    && isObservationTileVisible(observation, start)
    && !blockedKeys.has(pointKey(start))
  ));
  const centerTarget = clamp(desired, observation.map);
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const target = { x: centerTarget.x + dx, y: centerTarget.y + dy };
        if (!isPointInObservationBounds(observation, target)
          || !isObservationTileVisible(observation, target)
          || blockedKeys.has(pointKey(target))) continue;
        if (starts.some((start) => findPathRoute(start, target, observation.map.width, observation.map.height, blocked) !== null)) {
          return target;
        }
      }
    }
  }
  return null;
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
  if ((observation.ownTrainingQueueDepth[townCenter.id] ?? MAX_TRAINING_QUEUE_DEPTH) > 0) return null;
  if (!canAfford(observation.wallet, definition.cost)) return economyCommand(observation, villagers, randomValue, definition.cost);
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
  const blocked = new Set(knownWalkBlockedCells(observation).map((cell) => `${cell.x},${cell.y}`));
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

function knownWalkBlockedCells(observation: AiObservation): GridPoint[] {
  return getAiKnownSpatialModel(observation).walkBlockedCells.slice();
}

export function getAiKnownSpatialModel(observation: AiObservation): AiKnownSpatialModel {
  return createAiKnownSpatialModel(observation, new Set());
}

function createAiKnownSpatialModel(observation: AiObservation, ignoredUnitIds: ReadonlySet<EntityId>): AiKnownSpatialModel {
  const entities = uniqueKnownEntities(observation);
  const walkBlocked = entities.flatMap((entity) => {
    if (entity.kind === "resource") return [entity.position];
    if (entity.kind !== "building") return [];
    if (!isKnownBuildingType(entity.typeId) || !publicBuildingBlocksMovement(entity)) return [];
    return getFootprintCells(entity.position, getBuildingFootprint(entity.typeId, entity.orientation));
  });
  const placementBlocked = entities.flatMap((entity) => {
    if (entity.kind === "monster") return [];
    if (entity.kind === "unit") return ignoredUnitIds.has(entity.id) ? [] : [entity.position];
    if ((entity.kind === "building" || entity.kind === "rubble") && isKnownBuildingType(entity.typeId)) {
      return getFootprintCells(entity.position, getBuildingFootprint(entity.typeId, entity.orientation));
    }
    return [entity.position];
  });
  for (const site of observation.rememberedEnemySites) {
    if (!site.typeId || !isKnownBuildingType(site.typeId)) continue;
    const footprint = getFootprintCells(site.lastKnownPosition, getBuildingFootprint(site.typeId, site.orientation));
    placementBlocked.push(...footprint);
    if (rememberedSiteBlocksMovement(site)) walkBlocked.push(...footprint);
  }
  if (observation.map.id === VILLAGE_ASSAULT_MAP_ID) {
    walkBlocked.push(...getVillageAssaultWalkBlockedCells(observation.map.layoutId));
    placementBlocked.push(...getVillageAssaultBuildBlockedCells(observation.map.layoutId));
  }
  return {
    walkBlockedCells: sortedUniquePoints(walkBlocked, observation.map.width),
    placementBlockedCells: sortedUniquePoints(placementBlocked, observation.map.width),
  };
}

function chooseTarget(profile: AiProfile, visibleEnemies: readonly PublicEntityState[], randomValue: number): PublicEntityState | undefined {
  for (const priority of profile.targetPriority) {
    const candidates = visibleEnemies.filter((entity) => targetClass(entity) === priority).sort((left, right) => compareText(left.id, right.id));
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

function findOpenPoint(
  observation: AiObservation,
  anchor: GridPoint,
  buildingType: BuildingType,
  direction: number,
  builder: PublicEntityState,
): GridPoint | null {
  const spatial = createAiKnownSpatialModel(observation, new Set([builder.id]));
  const placementBlocked = spatial.placementBlockedCells;
  const baseVisibleWalkBlocked = knownVisibleWalkBlockedCells(observation);
  const occupiedEntityKeys = new Set(knownOccupiedEntityCells(observation).map(pointKey));
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
    const footprint = getBuildingFootprint(buildingType);
    if (!validateFootprintPlacement(origin, footprint, observation.map.width, observation.map.height, placementBlocked).ok) return false;
    const footprintCells = getFootprintCells(origin, footprint);
    if (!footprintCells.every((cell) => isObservationTileVisible(observation, cell))) return false;
    const routeBlocked = sortedUniquePoints([...baseVisibleWalkBlocked, ...footprintCells], observation.map.width);
    const routeBlockedKeys = new Set(routeBlocked.map(pointKey));
    const approaches = getFootprintPerimeterCells(origin, footprint).filter((cell) => (
      isPointInObservationBounds(observation, cell)
      && isObservationTileVisible(observation, cell)
      && !occupiedEntityKeys.has(pointKey(cell))
      && !routeBlockedKeys.has(pointKey(cell))
    ));
    return findPathToAny(builder.position, approaches, observation.map.width, observation.map.height, routeBlocked) !== null;
  }) ?? null;
}

function uniqueKnownEntities(observation: AiObservation): PublicEntityState[] {
  const byId = new Map<EntityId, PublicEntityState>();
  for (const entity of [
    ...observation.ownEntities,
    ...observation.visibleEnemyEntities,
    ...observation.visibleResourceEntities,
    ...observation.visibleWorldEntities,
  ]) byId.set(entity.id, entity);
  return [...byId.values()].sort((left, right) => compareText(left.id, right.id));
}

function knownOccupiedEntityCells(observation: AiObservation): GridPoint[] {
  const occupied = uniqueKnownEntities(observation).flatMap((entity) => {
    if (entity.kind === "unit" || entity.kind === "monster") return [];
    if ((entity.kind === "building" || entity.kind === "rubble") && isKnownBuildingType(entity.typeId)) {
      return getFootprintCells(entity.position, getBuildingFootprint(entity.typeId, entity.orientation));
    }
    return [entity.position];
  });
  for (const site of observation.rememberedEnemySites) {
    if (site.typeId && isKnownBuildingType(site.typeId)) {
      occupied.push(...getFootprintCells(site.lastKnownPosition, getBuildingFootprint(site.typeId, site.orientation)));
    }
  }
  return sortedUniquePoints(occupied, observation.map.width);
}

function publicBuildingBlocksMovement(entity: PublicEntityState): boolean {
  if (entity.blocksMovement !== undefined) return entity.blocksMovement;
  if (!isKnownBuildingType(entity.typeId)) return false;
  return BUILDINGS[entity.typeId].movementBlocking !== "whenClosed" || entity.complete === false || entity.gateOpen !== true;
}

function rememberedSiteBlocksMovement(site: RememberedEnemySite): boolean {
  if (site.blocksMovement !== undefined) return site.blocksMovement;
  return site.typeId !== "surveyGate" || site.complete === false || site.gateOpen !== true;
}

function isKnownBuildingType(value: PublicEntityState["typeId"] | string): value is BuildingType {
  return typeof value === "string" && value in BUILDINGS;
}

function findKnownVisibleApproachRoute(observation: AiObservation, start: GridPoint, target: PublicEntityState) {
  const footprint = (target.kind === "building" || target.kind === "rubble") && isKnownBuildingType(target.typeId)
    ? getBuildingFootprint(target.typeId, target.orientation)
    : [{ x: 0, y: 0 }];
  const blocked = knownVisibleWalkBlockedCells(observation);
  const blockedKeys = new Set(blocked.map(pointKey));
  const targets = getFootprintPerimeterCells(target.position, footprint).filter((point) => (
    isPointInObservationBounds(observation, point)
    && isObservationTileVisible(observation, point)
    && !blockedKeys.has(pointKey(point))
  ));
  return findPathToAny(start, targets, observation.map.width, observation.map.height, blocked);
}

function knownVisibleWalkBlockedCells(observation: AiObservation): GridPoint[] {
  const blocked = [...knownWalkBlockedCells(observation)];
  const visible = new Set(observation.visibleTileIndices);
  for (let y = 0; y < observation.map.height; y += 1) {
    for (let x = 0; x < observation.map.width; x += 1) {
      if (!visible.has(y * observation.map.width + x)) blocked.push({ x, y });
    }
  }
  return sortedUniquePoints(blocked, observation.map.width);
}

function isObservationTileVisible(observation: AiObservation, point: GridPoint): boolean {
  return isPointInObservationBounds(observation, point)
    && observation.visibleTileIndices.includes(point.y * observation.map.width + point.x);
}

function isPointInObservationBounds(observation: AiObservation, point: GridPoint): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < observation.map.width && point.y < observation.map.height;
}

function sortedUniquePoints(points: readonly GridPoint[], mapWidth: number): GridPoint[] {
  const byKey = new Map<string, GridPoint>();
  for (const point of points) byKey.set(pointKey(point), { ...point });
  return [...byKey.values()].sort((left, right) => (
    left.y * mapWidth + left.x - (right.y * mapWidth + right.x)
  ));
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
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
  return [...entities].sort((left, right) => compareText(left.id, right.id));
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
  return [...newestByEntity.values()].sort((left, right) => compareText(left.entityId, right.entityId));
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
