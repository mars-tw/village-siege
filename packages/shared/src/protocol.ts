import {
  COMBAT_UNIT_IDS,
  type AbilityPhase,
  type CombatUnitId,
  type Facing,
  type MonsterBoonId,
  type MonsterId,
  type ProjectileProfileId,
  type StatusEffectId,
} from "./combat.js";

export type MatchId = string;
export type PlayerId = string;
export type EntityId = string;
export type VillageId = "pinehold" | "riverstead" | "highcrag" | "marshwatch" | "sunfield";
export type PlayableVillageId = "pinehold" | "riverstead" | "highcrag";
export type ResourceKind = "food" | "wood" | "stone";
export type AiPersonality = "aggressor" | "guardian" | "prosperer" | "balanced" | "raider";
export type AiDifficulty = "novice" | "standard" | "veteran";
export type AiStrategicPhase = "economy" | "scouting" | "defending" | "repairing" | "assaulting" | "retreating" | "regrouping";

export interface AiEnemyMemory {
  readonly entityId: EntityId;
  readonly ownerId: PlayerId;
  readonly kind: "unit" | "building";
  readonly typeId: UnitType | BuildingType;
  readonly lastKnownPosition: GridPoint;
  readonly healthPermille: number;
  readonly observedAtTick: number;
  /** Last-seen static topology. Undefined for mobile units and older saves. */
  readonly orientation?: StructureOrientation;
  readonly gateOpen?: boolean;
  readonly complete?: boolean;
  readonly healthBand?: StructureHealthBand;
  readonly blocksMovement?: boolean;
}

export interface AiWaveState {
  readonly memberIds: readonly EntityId[];
  readonly targetEntityId: EntityId | null;
  readonly targetPosition: GridPoint;
  readonly launchedAtTick: number;
  readonly baselineStrength: number;
}

export interface AiTelemetryCounters {
  readonly decisions: number;
  readonly scoutsSent: number;
  readonly repairsOrdered: number;
  readonly retreatsOrdered: number;
  readonly wavesLaunched: number;
  readonly counterSwitches: number;
}

/** Private deterministic planner state. It is hashed/saved with MatchState and never projected in VisibleSnapshot. */
export interface AiAuthorityState {
  readonly playerId: PlayerId;
  readonly personality: AiPersonality;
  readonly difficulty: AiDifficulty;
  readonly randomState: number;
  readonly lastDecisionTick: number;
  readonly phase: AiStrategicPhase;
  readonly phaseStartedTick: number;
  readonly phaseLockedUntilTick: number;
  readonly enemyMemory: readonly AiEnemyMemory[];
  readonly desiredCounterUnit: CombatUnitId | null;
  readonly counterLockedUntilTick: number;
  readonly repairTargetId: EntityId | null;
  readonly regroupPoint: GridPoint | null;
  readonly activeWave: AiWaveState | null;
  readonly waveIndex: number;
  readonly nextWaveAtTick: number;
  readonly nextScoutAtTick: number;
  readonly scoutIndex: number;
  readonly telemetry: AiTelemetryCounters;
}
export type MatchPhase = "lobby" | "loading" | "playing" | "finished" | "disposed";
export type VictoryFinishReason = "conquest" | "elimination" | "landmark" | "timedControl" | "surrender" | "disconnect";
export type MatchOutcome = "victory" | "draw";
export type TeamEliminationReason = "conquest" | "elimination" | "surrender" | "disconnect";
export type VictoryObjectiveKind = "landmark" | "timedControl";

export interface VictoryPolicy {
  readonly commandCenterConquest: { readonly rebuildGraceTicks: number } | null;
  readonly elimination: boolean;
  readonly landmark: {
    readonly buildingType: "copperLandmark";
    readonly requiredCount: number;
    readonly holdTicks: number;
  } | null;
  readonly timedControl: {
    readonly point: GridPoint;
    readonly radius: number;
    readonly startsAtTick: number;
    readonly targetTicks: number;
  } | null;
}

export interface TeamVictoryProgress {
  readonly teamId: string;
  readonly landmarkHoldTicks: number;
  readonly timedControlScoreTicks: number;
  readonly eliminatedAtTick: number | null;
  readonly eliminationReason: TeamEliminationReason | null;
}

export interface VictoryState {
  readonly policy: VictoryPolicy;
  readonly teams: readonly TeamVictoryProgress[];
  readonly control: { readonly controllerTeamId: string | null; readonly contested: boolean };
  readonly outcome: MatchOutcome | null;
  readonly winningTeamIds: readonly string[];
  readonly finishReason: VictoryFinishReason | null;
  readonly triggeredReasons: readonly VictoryFinishReason[];
  readonly finishedAtTick: number | null;
}
export type SettlementTier = "frontier" | "stronghold" | "artificer";
export type TechnologyType =
  | "hearthlandAlmanac"
  | "resinboundKits"
  | "layeredHarness"
  | "surveyedFoundations"
  | "windspurRigging"
  | "starfireBores"
  | "torsionCradles";
export type BuildingType =
  | "townCenter"
  | "house"
  | "lumberCamp"
  | "farmstead"
  | "barracks"
  | "defenseTower"
  | "archeryRange"
  | "mageSanctum"
  | "gunWorkshop"
  | "beastStable"
  | "siegeWorkshop"
  | "resinPalisade"
  | "surveyGate"
  | "copperLandmark";
export type UnitType = "villager" | CombatUnitId;
export type CombatStance = "aggressive" | "defensive" | "holdGround";
export type FormationKind = "line" | "wedge" | "box";
export type StructureOrientation = "ne" | "se";
export type StructureHealthBand = "healthy" | "damaged" | "critical" | "destroyed";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface ResourceWallet {
  readonly food: number;
  readonly wood: number;
  readonly stone: number;
}

export interface ResourceCargo {
  readonly kind: ResourceKind | null;
  readonly amount: number;
  readonly capacity: number;
}

export interface ActiveMonsterBoon {
  readonly id: MonsterBoonId;
  readonly expiresAtTick: number;
}

export interface ProductionJobId {
  readonly commandSequence: number;
  readonly itemIndex: number;
}

export type AbilityTarget =
  | { readonly kind: "self" }
  | { readonly kind: "entity"; readonly entityId: EntityId }
  | { readonly kind: "ground"; readonly point: GridPoint }
  | { readonly kind: "direction"; readonly vector: GridPoint };

export type GameCommand =
  | { readonly type: "move"; readonly entityIds: readonly EntityId[]; readonly target: GridPoint }
  | { readonly type: "attackMove"; readonly entityIds: readonly EntityId[]; readonly target: GridPoint }
  | { readonly type: "attack"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "gather"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "dropOff"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "build"; readonly builderIds: readonly EntityId[]; readonly buildingType: BuildingType; readonly origin: GridPoint; readonly orientation?: StructureOrientation }
  | { readonly type: "train"; readonly producerId: EntityId; readonly unitType: UnitType; readonly count: number }
  | { readonly type: "research"; readonly producerId: EntityId; readonly technologyId: TechnologyType }
  | { readonly type: "cancelProduction"; readonly producerId: EntityId; readonly jobId: ProductionJobId }
  | { readonly type: "setRallyPoint"; readonly producerId: EntityId; readonly target: GridPoint | null }
  | { readonly type: "setGateState"; readonly gateId: EntityId; readonly open: boolean }
  | { readonly type: "advanceSettlement"; readonly producerId: EntityId; readonly targetTier: SettlementTier }
  | { readonly type: "patrol"; readonly entityIds: readonly EntityId[]; readonly waypoints: readonly GridPoint[] }
  | { readonly type: "repair"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "setStance"; readonly entityIds: readonly EntityId[]; readonly stance: CombatStance }
  | { readonly type: "setFormation"; readonly entityIds: readonly EntityId[]; readonly formation: FormationKind }
  | { readonly type: "castAbility"; readonly casterId: EntityId; readonly abilityId: string; readonly target: AbilityTarget }
  | { readonly type: "stop"; readonly entityIds: readonly EntityId[] }
  | { readonly type: "surrender" };

export interface CommandEnvelope<T extends GameCommand = GameCommand> {
  readonly matchId: MatchId;
  readonly playerId: PlayerId;
  readonly sequence: number;
  readonly clientTick: number;
  readonly command: T;
}

export type CommandRejectCode =
  | "MATCH_NOT_PLAYING"
  | "NOT_ROOM_MEMBER"
  | "STALE_OR_DUPLICATE_SEQUENCE"
  | "RATE_LIMITED"
  | "INVALID_PAYLOAD"
  | "ENTITY_NOT_OWNED"
  | "INSUFFICIENT_RESOURCES"
  | "DUPLICATE_RESEARCH"
  | "PRODUCTION_JOB_NOT_FOUND"
  | "PREREQUISITE_NOT_MET"
  | "ABILITY_NOT_READY"
  | "ACTION_ON_COOLDOWN"
  | "TARGET_NOT_VISIBLE"
  | "TARGET_NOT_REACHABLE";

export interface PublicEntityState {
  readonly id: EntityId;
  readonly ownerId: PlayerId | null;
  readonly kind: "unit" | "building" | "resource" | "rubble" | "monster";
  readonly typeId: UnitType | BuildingType | ResourceKind | MonsterId;
  readonly position: GridPoint;
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly stateRevision: number;
  readonly orientation?: StructureOrientation;
  readonly gateOpen?: boolean;
  readonly complete?: boolean;
  readonly constructionRemainingTicks?: number;
  readonly healthBand?: StructureHealthBand;
  readonly blocksMovement?: boolean;
  readonly facing?: Facing;
  readonly stance?: CombatStance;
  readonly formation?: FormationKind;
  readonly combatPhase?: AbilityPhase;
  readonly abilityReadyTick?: number;
  readonly statuses?: readonly { readonly id: StatusEffectId; readonly expiresAtTick: number }[];
  readonly passiveProgress?: {
    readonly stationarySinceTick: number;
    readonly movedTilesSinceAttack: number;
    readonly rhythmStacks: number;
    readonly rhythmExpiresAtTick: number;
    readonly braceCooldownUntilTick: number;
  };
  readonly cargo?: ResourceCargo;
  readonly civilianActivity?: "idle" | "walking" | "gathering" | "hauling" | "constructing" | "repairing";
  readonly resourceNode?: {
    readonly amount: number;
    readonly maxAmount: number;
    readonly renewAtTick: number | null;
  };
  readonly monsterState?: {
    readonly home: GridPoint;
    readonly leashRadius: number;
    readonly disposition: "neutral" | "retaliating" | "returning";
    readonly attackCooldownTicks: number;
  };
}

export interface PublicProjectileState {
  readonly id: EntityId;
  readonly ownerId: PlayerId;
  readonly sourceId: EntityId | null;
  readonly profileId: ProjectileProfileId;
  readonly position: GridPoint;
  readonly targetId: EntityId | null;
  readonly targetPoint: GridPoint;
  readonly impactTick: number;
}

export interface StaleEntitySighting {
  readonly entityId: EntityId;
  readonly ownerId: PlayerId;
  readonly typeId: BuildingType;
  readonly position: GridPoint;
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly stateRevision: number;
  readonly orientation: StructureOrientation;
  readonly gateOpen?: boolean;
  readonly complete: boolean;
  readonly constructionRemainingTicks: number;
  readonly healthBand: StructureHealthBand;
  readonly blocksMovement: boolean;
  readonly observedAtTick: number;
}

export interface VisibleSnapshot {
  readonly matchId: MatchId;
  readonly rulesVersion: string;
  readonly serverTick: number;
  readonly recipientPlayerId: PlayerId;
  readonly phase: MatchPhase;
  readonly victory: VictoryState;
  readonly map: { readonly id: string; readonly width: number; readonly height: number; readonly layoutId?: PlayableVillageId };
  readonly wallet: ResourceWallet;
  readonly population: { readonly used: number; readonly capacity: number };
  readonly settlementTier: SettlementTier;
  readonly completedTechnologyIds: readonly TechnologyType[];
  readonly activeMonsterBoons: readonly ActiveMonsterBoon[];
  readonly entities: readonly PublicEntityState[];
  readonly projectiles: readonly PublicProjectileState[];
  readonly staleEnemySightings: readonly StaleEntitySighting[];
  readonly exploredTilesRle: string;
  readonly visibilityRevision: number;
  readonly visibleTileIndices: readonly number[];
  readonly visibleEntityIds: readonly EntityId[];
  readonly checksum: string;
}

/** Coarse, perception-safe battlefield intent. Detailed AI planner state remains private. */
export type TacticalSignal = "scouting" | "alarm" | "repairing" | "retreating" | "regrouping" | "assaulting";

export type DomainEvent =
  | { readonly type: "commandAccepted"; readonly sequence: number; readonly serverTick: number }
  | { readonly type: "commandRejected"; readonly sequence: number; readonly code: CommandRejectCode }
  | { readonly type: "entitySpawned"; readonly entity: PublicEntityState }
  | { readonly type: "entityUpdated"; readonly entity: PublicEntityState }
  | { readonly type: "combatPhaseChanged"; readonly entityId: EntityId; readonly phase: AbilityPhase; readonly action: "attack" | "ability" | null }
  | { readonly type: "projectileSpawned"; readonly projectile: PublicProjectileState }
  | { readonly type: "projectileImpacted"; readonly projectileId: EntityId; readonly position: GridPoint; readonly targetIds: readonly EntityId[] }
  | { readonly type: "entityDamaged"; readonly sourceId: EntityId | null; readonly targetId: EntityId; readonly amount: number; readonly hitPoints: number }
  | { readonly type: "statusApplied"; readonly sourceId: EntityId | null; readonly targetId: EntityId; readonly statusId: StatusEffectId; readonly expiresAtTick: number }
  | { readonly type: "statusExpired"; readonly entityId: EntityId; readonly statusId: StatusEffectId }
  | { readonly type: "entityRemoved"; readonly entityId: EntityId; readonly entity: PublicEntityState; readonly reason: "destroyed" | "completed" | "depleted" | "despawned" }
  | { readonly type: "settlementAdvanced"; readonly playerId: PlayerId; readonly producerId: EntityId; readonly settlementTier: SettlementTier }
  | { readonly type: "technologyResearched"; readonly playerId: PlayerId; readonly producerId: EntityId; readonly technologyId: TechnologyType }
  | { readonly type: "rallyPointChanged"; readonly playerId: PlayerId; readonly producerId: EntityId; readonly target: GridPoint | null }
  | { readonly type: "gateStateChanged"; readonly playerId: PlayerId; readonly gateId: EntityId; readonly open: boolean }
  | {
      readonly type: "productionCancelled";
      readonly playerId: PlayerId;
      readonly producerId: EntityId;
      readonly jobId: ProductionJobId;
      readonly formerQueueIndex: number;
      readonly job: { readonly kind: "train"; readonly unitType: UnitType } | { readonly kind: "research"; readonly technologyId: TechnologyType };
      readonly remainingTicks: number;
      readonly refunded: ResourceWallet;
    }
  | { readonly type: "resourcesDeposited"; readonly playerId: PlayerId; readonly unitId: EntityId; readonly dropOffId: EntityId; readonly resourceKind: ResourceKind; readonly amount: number }
  | { readonly type: "resourceDepleted"; readonly resourceId: EntityId; readonly resourceKind: ResourceKind; readonly renewable: boolean; readonly renewAtTick: number | null }
  | { readonly type: "resourceRenewed"; readonly resourceId: EntityId; readonly resourceKind: ResourceKind; readonly amount: number }
  | { readonly type: "tacticalSignalRaised"; readonly actingPlayerId: PlayerId; readonly signal: TacticalSignal; readonly anchorEntityId: EntityId; readonly emittedAtTick: number }
  | { readonly type: "monsterProvoked"; readonly monsterId: EntityId; readonly monsterTypeId: MonsterId; readonly teamId: string | null; readonly sourceId: EntityId | null }
  | { readonly type: "monsterDefeated"; readonly monsterId: EntityId; readonly monsterTypeId: MonsterId; readonly creditedTeamId: string | null }
  | { readonly type: "monsterRewardGranted"; readonly monsterId: EntityId; readonly monsterTypeId: MonsterId; readonly playerId: PlayerId; readonly reward: ResourceWallet; readonly boon: ActiveMonsterBoon | null }
  | { readonly type: "breachCreated"; readonly structureId: EntityId; readonly rubbleId: EntityId; readonly ownerId: PlayerId; readonly position: GridPoint; readonly createdTick: number; readonly effectExpiresAtTick: number }
  | { readonly type: "teamEliminated"; readonly teamId: string; readonly reason: TeamEliminationReason; readonly eliminatedAtTick: number }
  | { readonly type: "controlObjectiveChanged"; readonly controllerTeamId: string | null; readonly contested: boolean; readonly changedAtTick: number }
  | { readonly type: "victoryProgressChanged"; readonly teamId: string; readonly objective: VictoryObjectiveKind; readonly progressTicks: number; readonly targetTicks: number }
  | {
      readonly type: "matchFinished";
      readonly winningTeamIds: readonly string[];
      readonly outcome: MatchOutcome;
      readonly reason: VictoryFinishReason;
      readonly triggeredReasons: readonly VictoryFinishReason[];
      readonly finishedAtTick: number;
      readonly teamScores: readonly { readonly teamId: string; readonly landmarkHoldTicks: number; readonly timedControlScoreTicks: number }[];
    };

export function isGridPoint(value: unknown): value is GridPoint {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["x", "y"]) && isSafeInteger(value.x) && isSafeInteger(value.y);
}

export function isGameCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "move":
    case "attackMove":
      return hasOnlyKeys(value, ["type", "entityIds", "target"]) && isIdArray(value.entityIds) && isGridPoint(value.target);
    case "attack":
    case "gather":
    case "dropOff":
      return hasOnlyKeys(value, ["type", "entityIds", "targetId"]) && isIdArray(value.entityIds) && typeof value.targetId === "string" && value.targetId.length > 0;
    case "build":
      return (value.orientation === undefined
        ? hasOnlyKeys(value, ["type", "builderIds", "buildingType", "origin"])
        : hasOnlyKeys(value, ["type", "builderIds", "buildingType", "origin", "orientation"]))
        && isIdArray(value.builderIds)
        && isBuildingType(value.buildingType)
        && isGridPoint(value.origin)
        && (value.orientation === undefined || isStructureOrientation(value.orientation));
    case "train":
      return hasOnlyKeys(value, ["type", "producerId", "unitType", "count"]) && typeof value.producerId === "string" && isUnitType(value.unitType) && isSafeInteger(value.count) && value.count >= 1 && value.count <= 5;
    case "research":
      return hasOnlyKeys(value, ["type", "producerId", "technologyId"]) && typeof value.producerId === "string" && value.producerId.length > 0 && isTechnologyType(value.technologyId);
    case "cancelProduction":
      return hasOnlyKeys(value, ["type", "producerId", "jobId"]) && typeof value.producerId === "string" && value.producerId.length > 0 && isProductionJobId(value.jobId);
    case "setRallyPoint":
      return hasOnlyKeys(value, ["type", "producerId", "target"]) && typeof value.producerId === "string" && value.producerId.length > 0 && (value.target === null || isGridPoint(value.target));
    case "setGateState":
      return hasOnlyKeys(value, ["type", "gateId", "open"]) && typeof value.gateId === "string" && value.gateId.length > 0 && typeof value.open === "boolean";
    case "advanceSettlement":
      return hasOnlyKeys(value, ["type", "producerId", "targetTier"]) && typeof value.producerId === "string" && value.producerId.length > 0 && isSettlementTier(value.targetTier);
    case "patrol":
      return hasOnlyKeys(value, ["type", "entityIds", "waypoints"]) && isIdArray(value.entityIds) && Array.isArray(value.waypoints) && value.waypoints.length >= 2 && value.waypoints.length <= 8 && value.waypoints.every(isGridPoint);
    case "repair":
      return hasOnlyKeys(value, ["type", "entityIds", "targetId"]) && isIdArray(value.entityIds) && typeof value.targetId === "string" && value.targetId.length > 0;
    case "setStance":
      return hasOnlyKeys(value, ["type", "entityIds", "stance"]) && isIdArray(value.entityIds) && isCombatStance(value.stance);
    case "setFormation":
      return hasOnlyKeys(value, ["type", "entityIds", "formation"]) && isIdArray(value.entityIds) && isFormationKind(value.formation);
    case "castAbility":
      return hasOnlyKeys(value, ["type", "casterId", "abilityId", "target"])
        && typeof value.casterId === "string"
        && value.casterId.length > 0
        && typeof value.abilityId === "string"
        && value.abilityId.length > 0
        && isAbilityTarget(value.target);
    case "stop":
      return hasOnlyKeys(value, ["type", "entityIds"]) && isIdArray(value.entityIds);
    case "surrender":
      return hasOnlyKeys(value, ["type"]);
    default:
      return false;
  }
}

export function isCommandEnvelope(value: unknown): value is CommandEnvelope {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["matchId", "playerId", "sequence", "clientTick", "command"])
    && typeof value.matchId === "string"
    && typeof value.playerId === "string"
    && isSafeInteger(value.sequence)
    && value.sequence >= 0
    && isSafeInteger(value.clientTick)
    && value.clientTick >= 0
    && isGameCommand(value.command);
}

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === "string" && ([
    "townCenter",
    "house",
    "lumberCamp",
    "farmstead",
    "barracks",
    "defenseTower",
    "archeryRange",
    "mageSanctum",
    "gunWorkshop",
    "beastStable",
    "siegeWorkshop",
    "resinPalisade",
    "surveyGate",
    "copperLandmark",
  ] as const).includes(value as BuildingType);
}

export function isStructureOrientation(value: unknown): value is StructureOrientation {
  return value === "ne" || value === "se";
}

export function isUnitType(value: unknown): value is UnitType {
  return value === "villager" || (typeof value === "string" && COMBAT_UNIT_IDS.includes(value as CombatUnitId));
}

export function isCombatStance(value: unknown): value is CombatStance {
  return typeof value === "string" && (["aggressive", "defensive", "holdGround"] as const).includes(value as CombatStance);
}

export function isFormationKind(value: unknown): value is FormationKind {
  return typeof value === "string" && (["line", "wedge", "box"] as const).includes(value as FormationKind);
}

export function isAbilityTarget(value: unknown): value is AbilityTarget {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "self") return hasOnlyKeys(value, ["kind"]);
  if (value.kind === "entity") return hasOnlyKeys(value, ["kind", "entityId"]) && typeof value.entityId === "string" && value.entityId.length > 0;
  if (value.kind === "ground") return hasOnlyKeys(value, ["kind", "point"]) && isGridPoint(value.point);
  return value.kind === "direction"
    && hasOnlyKeys(value, ["kind", "vector"])
    && isGridPoint(value.vector)
    && (value.vector.x !== 0 || value.vector.y !== 0);
}

function isProductionJobId(value: unknown): value is ProductionJobId {
  return isRecord(value)
    && hasOnlyKeys(value, ["commandSequence", "itemIndex"])
    && isSafeInteger(value.commandSequence)
    && value.commandSequence >= 0
    && isSafeInteger(value.itemIndex)
    && value.itemIndex >= 0;
}

export function isSettlementTier(value: unknown): value is SettlementTier {
  return typeof value === "string" && (["frontier", "stronghold", "artificer"] as const).includes(value as SettlementTier);
}

export function isTechnologyType(value: unknown): value is TechnologyType {
  return typeof value === "string" && ([
    "hearthlandAlmanac",
    "resinboundKits",
    "layeredHarness",
    "surveyedFoundations",
    "windspurRigging",
    "starfireBores",
    "torsionCradles",
  ] as const).includes(value as TechnologyType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isIdArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 128 && value.every((item) => typeof item === "string" && item.length > 0);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key)) && allowed.every((key) => key in value);
}
