import {
  COMBAT_UNIT_IDS,
  FACING_DIRECTIONS,
  MONSTER_BOON_IDS,
  MONSTER_IDS,
  PROJECTILE_PROFILE_IDS,
  STATUS_EFFECT_IDS,
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
export const MATCH_PROTOCOL_VERSION = "village-siege-network/2" as const;
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

/** Recipient-originated command contract. Identity and match ownership are always added by the server. */
export interface MatchCommandIntent<T extends GameCommand = GameCommand> {
  readonly protocolVersion: typeof MATCH_PROTOCOL_VERSION;
  readonly rulesVersion: string;
  readonly commandId: string;
  readonly clientCommandSeq: number;
  readonly lastServerTickSeen: number;
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

export type MatchCommandResult =
  | {
      readonly commandId: string | null;
      readonly clientCommandSeq: number;
      readonly accepted: true;
      readonly serverTick: number;
    }
  | {
      readonly commandId: string | null;
      readonly clientCommandSeq: number;
      readonly accepted: false;
      readonly code: CommandRejectCode | "COMMAND_ID_CONFLICT" | "PROTOCOL_MISMATCH" | "RULES_MISMATCH";
      readonly serverTick: number;
    };

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

export interface CollectionDelta<T> {
  readonly upserted: readonly T[];
  readonly removedIds: readonly EntityId[];
}

/** A recipient-filtered patch that can only be applied to its exact tick/checksum base. */
export interface VisibleSnapshotDelta {
  readonly matchId: MatchId;
  readonly rulesVersion: string;
  readonly recipientPlayerId: PlayerId;
  readonly baseServerTick: number;
  readonly serverTick: number;
  readonly baseChecksum: string;
  readonly checksum: string;
  readonly changes: {
    readonly phase?: MatchPhase;
    readonly victory?: VictoryState;
    readonly wallet?: ResourceWallet;
    readonly population?: { readonly used: number; readonly capacity: number };
    readonly settlementTier?: SettlementTier;
    readonly completedTechnologyIds?: readonly TechnologyType[];
    readonly activeMonsterBoons?: readonly ActiveMonsterBoon[];
    readonly exploredTilesRle?: string;
    readonly visibilityRevision?: number;
    readonly visibleTileIndices?: readonly number[];
    readonly visibleEntityIds?: readonly EntityId[];
  };
  readonly entities: CollectionDelta<PublicEntityState>;
  readonly projectiles: CollectionDelta<PublicProjectileState>;
  readonly staleEnemySightings: CollectionDelta<StaleEntitySighting>;
}

export interface CanonicalStateHash {
  readonly algorithm: "fnv1a-32";
  readonly serverTick: number;
  readonly value: string;
}

export interface MatchVersionOffer {
  readonly protocolVersion: string;
  readonly rulesVersion: string;
}

export interface MatchServerHello {
  readonly protocolVersion: typeof MATCH_PROTOCOL_VERSION;
  readonly rulesVersion: string;
  readonly matchId: MatchId;
  readonly recipientPlayerId: PlayerId;
  readonly tickMilliseconds: number;
  readonly fullSnapshotIntervalTicks: number;
  readonly canonicalHashIntervalTicks: number;
  readonly lastReceivedClientCommandSeq: number;
  readonly nextClientCommandSeq: number;
}

export const MATCH_RECOVERY_FAILURE_CODES = [
  "RECONNECT_LEASE_EXPIRED",
  "SERVER_UNAVAILABLE",
  "PERSISTENCE_UNAVAILABLE",
  "STATE_CORRUPT",
  "LEASE_LOST",
  "RECOVERY_TIMEOUT",
  "SEQUENCE_DIVERGED",
  "MATCH_ENDED",
] as const;

export type MatchRecoveryFailureCode = typeof MATCH_RECOVERY_FAILURE_CODES[number];

interface MatchLifecycleMessageBase {
  readonly protocolVersion: typeof MATCH_PROTOCOL_VERSION;
  readonly rulesVersion: string;
  readonly matchId: MatchId;
  readonly recipientPlayerId: PlayerId;
  readonly serverTick: number;
  readonly recoveryEpoch: number;
}

export type MatchLifecycleMessage =
  | (MatchLifecycleMessageBase & {
      readonly type: "recovering";
      readonly leaseExpiresAtEpochMs: number;
    })
  | (MatchLifecycleMessageBase & {
      readonly type: "resumed";
    })
  | (MatchLifecycleMessageBase & {
      readonly type: "failed";
      readonly code: MatchRecoveryFailureCode;
      readonly recoverable: boolean;
    });

interface MatchReplicationFrameBase {
  readonly protocolVersion: typeof MATCH_PROTOCOL_VERSION;
  readonly rulesVersion: string;
  readonly matchId: MatchId;
  readonly recipientPlayerId: PlayerId;
  readonly serverTick: number;
  /** World events only. Command acknowledgement has one dedicated match.commandResult channel. */
  readonly events: readonly ReplicatedWorldEvent[];
}

export interface MatchSnapshotFrame extends MatchReplicationFrameBase {
  readonly kind: "snapshot";
  readonly snapshot: VisibleSnapshot;
}

export interface MatchDeltaFrame extends MatchReplicationFrameBase {
  readonly kind: "delta";
  readonly delta: VisibleSnapshotDelta;
}

export type MatchReplicationFrame = MatchSnapshotFrame | MatchDeltaFrame;

export type ReplicatedWorldEvent = Exclude<
  DomainEvent,
  { readonly type: "commandAccepted" | "commandRejected" }
>;

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

export function isMatchVersionOffer(value: unknown): value is MatchVersionOffer {
  return isRecord(value)
    && hasOnlyKeys(value, ["protocolVersion", "rulesVersion"])
    && typeof value.protocolVersion === "string"
    && value.protocolVersion.length > 0
    && value.protocolVersion.length <= 64
    && typeof value.rulesVersion === "string"
    && value.rulesVersion.length > 0
    && value.rulesVersion.length <= 64;
}

export function isMatchCommandIntent(value: unknown): value is MatchCommandIntent {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "protocolVersion",
    "rulesVersion",
    "commandId",
    "clientCommandSeq",
    "lastServerTickSeen",
    "command",
  ])) return false;
  return value.protocolVersion === MATCH_PROTOCOL_VERSION
    && typeof value.rulesVersion === "string"
    && isCommandId(value.commandId)
    && isSafeInteger(value.clientCommandSeq)
    && value.clientCommandSeq >= 0
    && isSafeInteger(value.lastServerTickSeen)
    && value.lastServerTickSeen >= 0
    && isGameCommand(value.command);
}

export function isMatchServerHello(value: unknown): value is MatchServerHello {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "protocolVersion",
    "rulesVersion",
    "matchId",
    "recipientPlayerId",
    "tickMilliseconds",
    "fullSnapshotIntervalTicks",
    "canonicalHashIntervalTicks",
    "lastReceivedClientCommandSeq",
    "nextClientCommandSeq",
  ])) return false;
  return value.protocolVersion === MATCH_PROTOCOL_VERSION
    && typeof value.rulesVersion === "string"
    && typeof value.matchId === "string"
    && value.matchId.length > 0
    && typeof value.recipientPlayerId === "string"
    && value.recipientPlayerId.length > 0
    && isSafeInteger(value.tickMilliseconds)
    && value.tickMilliseconds > 0
    && isSafeInteger(value.fullSnapshotIntervalTicks)
    && value.fullSnapshotIntervalTicks > 0
    && isSafeInteger(value.canonicalHashIntervalTicks)
    && value.canonicalHashIntervalTicks > 0
    && isSafeInteger(value.lastReceivedClientCommandSeq)
    && value.lastReceivedClientCommandSeq >= -1
    && isSafeInteger(value.nextClientCommandSeq)
    && value.nextClientCommandSeq === value.lastReceivedClientCommandSeq + 1;
}

export function isMatchLifecycleMessage(value: unknown): value is MatchLifecycleMessage {
  if (!isRecord(value)) return false;
  const variantKeys = value.type === "recovering"
    ? ["leaseExpiresAtEpochMs"]
    : value.type === "resumed"
      ? []
      : value.type === "failed"
        ? ["code", "recoverable"]
        : null;
  if (!variantKeys || !hasOnlyKeys(value, [
    "type",
    "protocolVersion",
    "rulesVersion",
    "matchId",
    "recipientPlayerId",
    "serverTick",
    "recoveryEpoch",
    ...variantKeys,
  ])) return false;
  if (value.protocolVersion !== MATCH_PROTOCOL_VERSION
    || typeof value.rulesVersion !== "string"
    || value.rulesVersion.length === 0
    || value.rulesVersion.length > 64
    || typeof value.matchId !== "string"
    || value.matchId.length === 0
    || typeof value.recipientPlayerId !== "string"
    || value.recipientPlayerId.length === 0
    || !isSafeInteger(value.serverTick)
    || value.serverTick < 0
    || !isSafeInteger(value.recoveryEpoch)
    || value.recoveryEpoch < 0) return false;
  if (value.type === "recovering") {
    return isSafeInteger(value.leaseExpiresAtEpochMs) && value.leaseExpiresAtEpochMs >= 0;
  }
  if (value.type === "failed") {
    return typeof value.code === "string"
      && MATCH_RECOVERY_FAILURE_CODE_SET.has(value.code)
      && typeof value.recoverable === "boolean";
  }
  return true;
}

export function isMatchCommandResult(value: unknown): value is MatchCommandResult {
  if (!isRecord(value)) return false;
  const common = typeof value.commandId === "string" ? isCommandId(value.commandId) : value.commandId === null;
  if (!common
    || !isSafeInteger(value.clientCommandSeq)
    || value.clientCommandSeq < 0
    || !isSafeInteger(value.serverTick)
    || value.serverTick < 0) return false;
  if (value.accepted === true) {
    return hasOnlyKeys(value, ["commandId", "clientCommandSeq", "accepted", "serverTick"]);
  }
  return value.accepted === false
    && hasOnlyKeys(value, ["commandId", "clientCommandSeq", "accepted", "code", "serverTick"])
    && typeof value.code === "string"
    && COMMAND_RESULT_CODES.has(value.code);
}

export function isVisibleSnapshot(value: unknown): value is VisibleSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "matchId", "rulesVersion", "serverTick", "recipientPlayerId", "phase", "victory", "map", "wallet",
    "population", "settlementTier", "completedTechnologyIds", "activeMonsterBoons", "entities", "projectiles",
    "staleEnemySightings", "exploredTilesRle", "visibilityRevision", "visibleTileIndices", "visibleEntityIds", "checksum",
  ])) return false;
  return typeof value.matchId === "string"
    && value.matchId.length > 0
    && typeof value.rulesVersion === "string"
    && isSafeInteger(value.serverTick)
    && value.serverTick >= 0
    && typeof value.recipientPlayerId === "string"
    && value.recipientPlayerId.length > 0
    && isMatchPhase(value.phase)
    && isVictoryState(value.victory)
    && isSnapshotMap(value.map)
    && isResourceWallet(value.wallet)
    && isPopulation(value.population)
    && isSettlementTier(value.settlementTier)
    && Array.isArray(value.completedTechnologyIds)
    && value.completedTechnologyIds.every(isTechnologyType)
    && new Set(value.completedTechnologyIds).size === value.completedTechnologyIds.length
    && Array.isArray(value.activeMonsterBoons)
    && value.activeMonsterBoons.every(isActiveMonsterBoon)
    && new Set(value.activeMonsterBoons.map((boon) => boon.id)).size === value.activeMonsterBoons.length
    && Array.isArray(value.entities)
    && value.entities.every(isPublicEntityLike)
    && hasUniqueCollectionIds(value.entities, "id")
    && Array.isArray(value.projectiles)
    && value.projectiles.every(isPublicProjectileLike)
    && hasUniqueCollectionIds(value.projectiles, "id")
    && Array.isArray(value.staleEnemySightings)
    && value.staleEnemySightings.every(isStaleSightingLike)
    && hasUniqueCollectionIds(value.staleEnemySightings, "entityId")
    && typeof value.exploredTilesRle === "string"
    && isSafeInteger(value.visibilityRevision)
    && value.visibilityRevision >= 0
    && isSafeIntegerArray(value.visibleTileIndices)
    && isStringArray(value.visibleEntityIds)
    && isChecksum(value.checksum);
}

export function isVisibleSnapshotDelta(value: unknown): value is VisibleSnapshotDelta {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "matchId", "rulesVersion", "recipientPlayerId", "baseServerTick", "serverTick", "baseChecksum", "checksum",
    "changes", "entities", "projectiles", "staleEnemySightings",
  ])) return false;
  return typeof value.matchId === "string"
    && value.matchId.length > 0
    && typeof value.rulesVersion === "string"
    && typeof value.recipientPlayerId === "string"
    && value.recipientPlayerId.length > 0
    && isSafeInteger(value.baseServerTick)
    && value.baseServerTick >= 0
    && isSafeInteger(value.serverTick)
    && value.serverTick > value.baseServerTick
    && isChecksum(value.baseChecksum)
    && isChecksum(value.checksum)
    && isDeltaChanges(value.changes)
    && isCollectionDelta(value.entities, "id", isPublicEntityLike)
    && isCollectionDelta(value.projectiles, "id", isPublicProjectileLike)
    && isCollectionDelta(value.staleEnemySightings, "entityId", isStaleSightingLike);
}

export function isMatchReplicationFrame(value: unknown): value is MatchReplicationFrame {
  if (!isRecord(value)) return false;
  const payloadKey = value.kind === "snapshot" ? "snapshot" : value.kind === "delta" ? "delta" : null;
  if (!payloadKey || !hasOnlyKeys(value, [
    "kind", "protocolVersion", "rulesVersion", "matchId", "recipientPlayerId", "serverTick", "events", payloadKey,
  ])) return false;
  if (value.protocolVersion !== MATCH_PROTOCOL_VERSION
    || typeof value.rulesVersion !== "string"
    || typeof value.matchId !== "string"
    || value.matchId.length === 0
    || typeof value.recipientPlayerId !== "string"
    || value.recipientPlayerId.length === 0
    || !isSafeInteger(value.serverTick)
    || value.serverTick < 0
    || !Array.isArray(value.events)
    || !value.events.every(isReplicatedWorldEvent)) return false;
  const payload = value[payloadKey];
  if (value.kind === "snapshot" && !isVisibleSnapshot(payload)) return false;
  if (value.kind === "delta" && !isVisibleSnapshotDelta(payload)) return false;
  if (!isRecord(payload)) return false;
  return payload.matchId === value.matchId
    && payload.rulesVersion === value.rulesVersion
    && payload.recipientPlayerId === value.recipientPlayerId
    && payload.serverTick === value.serverTick;
}

function isReplicatedWorldEvent(value: unknown): value is ReplicatedWorldEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "entitySpawned":
    case "entityUpdated":
      return hasOnlyKeys(value, ["type", "entity"]) && isPublicEntityLike(value.entity);
    case "combatPhaseChanged":
      return hasOnlyKeys(value, ["type", "entityId", "phase", "action"])
        && isNonEmptyString(value.entityId)
        && isAbilityPhase(value.phase)
        && (value.action === null || value.action === "attack" || value.action === "ability");
    case "projectileSpawned":
      return hasOnlyKeys(value, ["type", "projectile"]) && isPublicProjectileLike(value.projectile);
    case "projectileImpacted":
      return hasOnlyKeys(value, ["type", "projectileId", "position", "targetIds"])
        && isNonEmptyString(value.projectileId)
        && isGridPoint(value.position)
        && isStringArray(value.targetIds);
    case "entityDamaged":
      return hasOnlyKeys(value, ["type", "sourceId", "targetId", "amount", "hitPoints"])
        && isNullableNonEmptyString(value.sourceId)
        && isNonEmptyString(value.targetId)
        && isNonNegativeSafeInteger(value.amount)
        && isNonNegativeSafeInteger(value.hitPoints);
    case "statusApplied":
      return hasOnlyKeys(value, ["type", "sourceId", "targetId", "statusId", "expiresAtTick"])
        && isNullableNonEmptyString(value.sourceId)
        && isNonEmptyString(value.targetId)
        && isStatusEffectId(value.statusId)
        && isNonNegativeSafeInteger(value.expiresAtTick);
    case "statusExpired":
      return hasOnlyKeys(value, ["type", "entityId", "statusId"])
        && isNonEmptyString(value.entityId)
        && isStatusEffectId(value.statusId);
    case "entityRemoved":
      return hasOnlyKeys(value, ["type", "entityId", "entity", "reason"])
        && isNonEmptyString(value.entityId)
        && isPublicEntityLike(value.entity)
        && (value.entity as PublicEntityState).id === value.entityId
        && (value.reason === "destroyed" || value.reason === "completed" || value.reason === "depleted" || value.reason === "despawned");
    case "settlementAdvanced":
      return hasOnlyKeys(value, ["type", "playerId", "producerId", "settlementTier"])
        && isNonEmptyString(value.playerId)
        && isNonEmptyString(value.producerId)
        && isSettlementTier(value.settlementTier);
    case "technologyResearched":
      return hasOnlyKeys(value, ["type", "playerId", "producerId", "technologyId"])
        && isNonEmptyString(value.playerId)
        && isNonEmptyString(value.producerId)
        && isTechnologyType(value.technologyId);
    case "rallyPointChanged":
      return hasOnlyKeys(value, ["type", "playerId", "producerId", "target"])
        && isNonEmptyString(value.playerId)
        && isNonEmptyString(value.producerId)
        && (value.target === null || isGridPoint(value.target));
    case "gateStateChanged":
      return hasOnlyKeys(value, ["type", "playerId", "gateId", "open"])
        && isNonEmptyString(value.playerId)
        && isNonEmptyString(value.gateId)
        && typeof value.open === "boolean";
    case "productionCancelled":
      return hasOnlyKeys(value, [
        "type", "playerId", "producerId", "jobId", "formerQueueIndex", "job", "remainingTicks", "refunded",
      ])
        && isNonEmptyString(value.playerId)
        && isNonEmptyString(value.producerId)
        && isProductionJobId(value.jobId)
        && isNonNegativeSafeInteger(value.formerQueueIndex)
        && isCancelledProductionJob(value.job)
        && isNonNegativeSafeInteger(value.remainingTicks)
        && isResourceWallet(value.refunded);
    case "resourcesDeposited":
      return hasOnlyKeys(value, ["type", "playerId", "unitId", "dropOffId", "resourceKind", "amount"])
        && isNonEmptyString(value.playerId)
        && isNonEmptyString(value.unitId)
        && isNonEmptyString(value.dropOffId)
        && isResourceKind(value.resourceKind)
        && isNonNegativeSafeInteger(value.amount);
    case "resourceDepleted":
      return hasOnlyKeys(value, ["type", "resourceId", "resourceKind", "renewable", "renewAtTick"])
        && isNonEmptyString(value.resourceId)
        && isResourceKind(value.resourceKind)
        && typeof value.renewable === "boolean"
        && (value.renewAtTick === null || isNonNegativeSafeInteger(value.renewAtTick));
    case "resourceRenewed":
      return hasOnlyKeys(value, ["type", "resourceId", "resourceKind", "amount"])
        && isNonEmptyString(value.resourceId)
        && isResourceKind(value.resourceKind)
        && isNonNegativeSafeInteger(value.amount);
    case "tacticalSignalRaised":
      return hasOnlyKeys(value, ["type", "actingPlayerId", "signal", "anchorEntityId", "emittedAtTick"])
        && isNonEmptyString(value.actingPlayerId)
        && isTacticalSignal(value.signal)
        && isNonEmptyString(value.anchorEntityId)
        && isNonNegativeSafeInteger(value.emittedAtTick);
    case "monsterProvoked":
      return hasOnlyKeys(value, ["type", "monsterId", "monsterTypeId", "teamId", "sourceId"])
        && isNonEmptyString(value.monsterId)
        && isMonsterId(value.monsterTypeId)
        && isNullableNonEmptyString(value.teamId)
        && isNullableNonEmptyString(value.sourceId);
    case "monsterDefeated":
      return hasOnlyKeys(value, ["type", "monsterId", "monsterTypeId", "creditedTeamId"])
        && isNonEmptyString(value.monsterId)
        && isMonsterId(value.monsterTypeId)
        && isNullableNonEmptyString(value.creditedTeamId);
    case "monsterRewardGranted":
      return hasOnlyKeys(value, ["type", "monsterId", "monsterTypeId", "playerId", "reward", "boon"])
        && isNonEmptyString(value.monsterId)
        && isMonsterId(value.monsterTypeId)
        && isNonEmptyString(value.playerId)
        && isResourceWallet(value.reward)
        && (value.boon === null || isActiveMonsterBoon(value.boon));
    case "breachCreated":
      return hasOnlyKeys(value, ["type", "structureId", "rubbleId", "ownerId", "position", "createdTick", "effectExpiresAtTick"])
        && isNonEmptyString(value.structureId)
        && isNonEmptyString(value.rubbleId)
        && isNonEmptyString(value.ownerId)
        && isGridPoint(value.position)
        && isNonNegativeSafeInteger(value.createdTick)
        && isNonNegativeSafeInteger(value.effectExpiresAtTick);
    case "teamEliminated":
      return hasOnlyKeys(value, ["type", "teamId", "reason", "eliminatedAtTick"])
        && isNonEmptyString(value.teamId)
        && isTeamEliminationReason(value.reason)
        && isNonNegativeSafeInteger(value.eliminatedAtTick);
    case "controlObjectiveChanged":
      return hasOnlyKeys(value, ["type", "controllerTeamId", "contested", "changedAtTick"])
        && isNullableNonEmptyString(value.controllerTeamId)
        && typeof value.contested === "boolean"
        && isNonNegativeSafeInteger(value.changedAtTick);
    case "victoryProgressChanged":
      return hasOnlyKeys(value, ["type", "teamId", "objective", "progressTicks", "targetTicks"])
        && isNonEmptyString(value.teamId)
        && (value.objective === "landmark" || value.objective === "timedControl")
        && isNonNegativeSafeInteger(value.progressTicks)
        && isNonNegativeSafeInteger(value.targetTicks);
    case "matchFinished":
      return hasOnlyKeys(value, [
        "type", "winningTeamIds", "outcome", "reason", "triggeredReasons", "finishedAtTick", "teamScores",
      ])
        && isStringArray(value.winningTeamIds)
        && isMatchOutcome(value.outcome)
        && isVictoryFinishReason(value.reason)
        && Array.isArray(value.triggeredReasons)
        && value.triggeredReasons.every(isVictoryFinishReason)
        && isNonNegativeSafeInteger(value.finishedAtTick)
        && isTeamScores(value.teamScores);
    default:
      return false;
  }
}

function isCancelledProductionJob(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "train") return hasOnlyKeys(value, ["kind", "unitType"]) && isUnitType(value.unitType);
  return value.kind === "research"
    && hasOnlyKeys(value, ["kind", "technologyId"])
    && isTechnologyType(value.technologyId);
}

function isTacticalSignal(value: unknown): value is TacticalSignal {
  return value === "scouting" || value === "alarm" || value === "repairing" || value === "retreating"
    || value === "regrouping" || value === "assaulting";
}

function isTeamScores(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((score) => isRecord(score)
      && hasOnlyKeys(score, ["teamId", "landmarkHoldTicks", "timedControlScoreTicks"])
      && isNonEmptyString(score.teamId)
      && isNonNegativeSafeInteger(score.landmarkHoldTicks)
      && isNonNegativeSafeInteger(score.timedControlScoreTicks))
    && new Set(value.map((score) => (score as Record<string, unknown>).teamId)).size === value.length;
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

const COMMAND_RESULT_CODES = new Set<string>([
  "MATCH_NOT_PLAYING",
  "NOT_ROOM_MEMBER",
  "STALE_OR_DUPLICATE_SEQUENCE",
  "RATE_LIMITED",
  "INVALID_PAYLOAD",
  "ENTITY_NOT_OWNED",
  "INSUFFICIENT_RESOURCES",
  "DUPLICATE_RESEARCH",
  "PRODUCTION_JOB_NOT_FOUND",
  "PREREQUISITE_NOT_MET",
  "ABILITY_NOT_READY",
  "ACTION_ON_COOLDOWN",
  "TARGET_NOT_VISIBLE",
  "TARGET_NOT_REACHABLE",
  "COMMAND_ID_CONFLICT",
  "PROTOCOL_MISMATCH",
  "RULES_MISMATCH",
]);

const MATCH_RECOVERY_FAILURE_CODE_SET = new Set<string>(MATCH_RECOVERY_FAILURE_CODES);

function isCommandId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isResourceKind(value: unknown): value is ResourceKind {
  return value === "food" || value === "wood" || value === "stone";
}

function isStatusEffectId(value: unknown): value is StatusEffectId {
  return typeof value === "string" && STATUS_EFFECT_IDS.includes(value as StatusEffectId);
}

function isMonsterId(value: unknown): value is MonsterId {
  return typeof value === "string" && MONSTER_IDS.includes(value as MonsterId);
}

function isMonsterBoonId(value: unknown): value is MonsterBoonId {
  return typeof value === "string" && MONSTER_BOON_IDS.includes(value as MonsterBoonId);
}

function isProjectileProfileId(value: unknown): value is ProjectileProfileId {
  return typeof value === "string" && PROJECTILE_PROFILE_IDS.includes(value as ProjectileProfileId);
}

function isFacing(value: unknown): value is Facing {
  return typeof value === "string" && FACING_DIRECTIONS.includes(value as Facing);
}

function isAbilityPhase(value: unknown): value is AbilityPhase {
  return value === "windup" || value === "commit" || value === "recovery" || value === "ready";
}

function isVictoryFinishReason(value: unknown): value is VictoryFinishReason {
  return typeof value === "string" && ([
    "conquest", "elimination", "landmark", "timedControl", "surrender", "disconnect",
  ] as const).includes(value as VictoryFinishReason);
}

function isTeamEliminationReason(value: unknown): value is TeamEliminationReason {
  return value === "conquest" || value === "elimination" || value === "surrender" || value === "disconnect";
}

function isMatchOutcome(value: unknown): value is MatchOutcome {
  return value === "victory" || value === "draw";
}

function isActiveMonsterBoon(value: unknown): value is ActiveMonsterBoon {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "expiresAtTick"])
    && isMonsterBoonId(value.id)
    && isNonNegativeSafeInteger(value.expiresAtTick);
}

function isVictoryState(value: unknown): value is VictoryState {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "policy", "teams", "control", "outcome", "winningTeamIds", "finishReason", "triggeredReasons", "finishedAtTick",
  ])) return false;
  if (!isVictoryPolicy(value.policy)
    || !Array.isArray(value.teams)
    || !value.teams.every(isTeamVictoryProgress)
    || new Set(value.teams.map((team) => team.teamId)).size !== value.teams.length
    || !isRecord(value.control)
    || !hasOnlyKeys(value.control, ["controllerTeamId", "contested"])
    || !isNullableNonEmptyString(value.control.controllerTeamId)
    || typeof value.control.contested !== "boolean"
    || !(value.outcome === null || isMatchOutcome(value.outcome))
    || !isStringArray(value.winningTeamIds)
    || !(value.finishReason === null || isVictoryFinishReason(value.finishReason))
    || !Array.isArray(value.triggeredReasons)
    || !value.triggeredReasons.every(isVictoryFinishReason)
    || !(value.finishedAtTick === null || isNonNegativeSafeInteger(value.finishedAtTick))) return false;
  return true;
}

function isVictoryPolicy(value: unknown): value is VictoryPolicy {
  if (!isRecord(value) || !hasOnlyKeys(value, ["commandCenterConquest", "elimination", "landmark", "timedControl"])) return false;
  const conquest = value.commandCenterConquest;
  const landmark = value.landmark;
  const timedControl = value.timedControl;
  return (conquest === null || (isRecord(conquest)
      && hasOnlyKeys(conquest, ["rebuildGraceTicks"])
      && isNonNegativeSafeInteger(conquest.rebuildGraceTicks)))
    && typeof value.elimination === "boolean"
    && (landmark === null || (isRecord(landmark)
      && hasOnlyKeys(landmark, ["buildingType", "requiredCount", "holdTicks"])
      && landmark.buildingType === "copperLandmark"
      && isNonNegativeSafeInteger(landmark.requiredCount)
      && isNonNegativeSafeInteger(landmark.holdTicks)))
    && (timedControl === null || (isRecord(timedControl)
      && hasOnlyKeys(timedControl, ["point", "radius", "startsAtTick", "targetTicks"])
      && isGridPoint(timedControl.point)
      && isNonNegativeSafeInteger(timedControl.radius)
      && isNonNegativeSafeInteger(timedControl.startsAtTick)
      && isNonNegativeSafeInteger(timedControl.targetTicks)));
}

function isTeamVictoryProgress(value: unknown): value is TeamVictoryProgress {
  return isRecord(value)
    && hasOnlyKeys(value, ["teamId", "landmarkHoldTicks", "timedControlScoreTicks", "eliminatedAtTick", "eliminationReason"])
    && isNonEmptyString(value.teamId)
    && isNonNegativeSafeInteger(value.landmarkHoldTicks)
    && isNonNegativeSafeInteger(value.timedControlScoreTicks)
    && (value.eliminatedAtTick === null || isNonNegativeSafeInteger(value.eliminatedAtTick))
    && (value.eliminationReason === null || isTeamEliminationReason(value.eliminationReason));
}

function isMatchPhase(value: unknown): value is MatchPhase {
  return value === "lobby" || value === "loading" || value === "playing" || value === "finished" || value === "disposed";
}

function isSnapshotMap(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyAllowedKeys(value, ["id", "width", "height", "layoutId"])
    || !("id" in value && "width" in value && "height" in value)) return false;
  return typeof value.id === "string"
    && value.id.length > 0
    && isSafeInteger(value.width)
    && value.width > 0
    && isSafeInteger(value.height)
    && value.height > 0
    && (value.layoutId === undefined || (
      typeof value.layoutId === "string"
      && (["pinehold", "riverstead", "highcrag"] as const).includes(value.layoutId as PlayableVillageId)
    ));
}

function isResourceWallet(value: unknown): value is ResourceWallet {
  return isRecord(value)
    && hasOnlyKeys(value, ["food", "wood", "stone"])
    && isNonNegativeSafeInteger(value.food)
    && isNonNegativeSafeInteger(value.wood)
    && isNonNegativeSafeInteger(value.stone);
}

function isPopulation(value: unknown): value is { readonly used: number; readonly capacity: number } {
  return isRecord(value)
    && hasOnlyKeys(value, ["used", "capacity"])
    && isNonNegativeSafeInteger(value.used)
    && isNonNegativeSafeInteger(value.capacity);
}

function isPublicEntityKindAndType(kind: unknown, typeId: unknown): boolean {
  if (kind === "unit") return isUnitType(typeId);
  if (kind === "building" || kind === "rubble") return isBuildingType(typeId);
  if (kind === "resource") return isResourceKind(typeId);
  return kind === "monster" && isMonsterId(typeId);
}

function isStructureHealthBand(value: unknown): value is StructureHealthBand {
  return value === "healthy" || value === "damaged" || value === "critical" || value === "destroyed";
}

function isPublicStatuses(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= STATUS_EFFECT_IDS.length
    && value.every((status) => isRecord(status)
      && hasOnlyKeys(status, ["id", "expiresAtTick"])
      && isStatusEffectId(status.id)
      && isNonNegativeSafeInteger(status.expiresAtTick))
    && new Set(value.map((status) => (status as Record<string, unknown>).id)).size === value.length;
}

function isPassiveProgress(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "stationarySinceTick", "movedTilesSinceAttack", "rhythmStacks", "rhythmExpiresAtTick", "braceCooldownUntilTick",
    ])
    && isNonNegativeSafeInteger(value.stationarySinceTick)
    && isNonNegativeSafeInteger(value.movedTilesSinceAttack)
    && isNonNegativeSafeInteger(value.rhythmStacks)
    && isNonNegativeSafeInteger(value.rhythmExpiresAtTick)
    && isNonNegativeSafeInteger(value.braceCooldownUntilTick);
}

function isResourceCargo(value: unknown): value is ResourceCargo {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "amount", "capacity"])
    && (value.kind === null || isResourceKind(value.kind))
    && isNonNegativeSafeInteger(value.amount)
    && isNonNegativeSafeInteger(value.capacity)
    && value.amount <= value.capacity;
}

function isCivilianActivity(value: unknown): boolean {
  return value === "idle" || value === "walking" || value === "gathering" || value === "hauling"
    || value === "constructing" || value === "repairing";
}

function isResourceNode(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["amount", "maxAmount", "renewAtTick"])
    && isNonNegativeSafeInteger(value.amount)
    && isNonNegativeSafeInteger(value.maxAmount)
    && value.amount <= value.maxAmount
    && (value.renewAtTick === null || isNonNegativeSafeInteger(value.renewAtTick));
}

function isMonsterPublicState(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["home", "leashRadius", "disposition", "attackCooldownTicks"])
    && isGridPoint(value.home)
    && isNonNegativeSafeInteger(value.leashRadius)
    && (value.disposition === "neutral" || value.disposition === "retaliating" || value.disposition === "returning")
    && isNonNegativeSafeInteger(value.attackCooldownTicks);
}

function isPublicEntityLike(value: unknown): value is PublicEntityState {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, [
    "id", "ownerId", "kind", "typeId", "position", "hitPoints", "maxHitPoints", "stateRevision", "orientation",
    "gateOpen", "complete", "constructionRemainingTicks", "healthBand", "blocksMovement", "facing", "stance",
    "formation", "combatPhase", "abilityReadyTick", "statuses", "passiveProgress", "cargo", "civilianActivity",
    "resourceNode", "monsterState",
  ])) return false;
  return isNonEmptyString(value.id)
    && isNullableNonEmptyString(value.ownerId)
    && isPublicEntityKindAndType(value.kind, value.typeId)
    && isGridPoint(value.position)
    && isNonNegativeSafeInteger(value.hitPoints)
    && isNonNegativeSafeInteger(value.maxHitPoints)
    && value.hitPoints <= value.maxHitPoints
    && isNonNegativeSafeInteger(value.stateRevision)
    && (value.orientation === undefined || isStructureOrientation(value.orientation))
    && (value.gateOpen === undefined || typeof value.gateOpen === "boolean")
    && (value.complete === undefined || typeof value.complete === "boolean")
    && (value.constructionRemainingTicks === undefined || isNonNegativeSafeInteger(value.constructionRemainingTicks))
    && (value.healthBand === undefined || isStructureHealthBand(value.healthBand))
    && (value.blocksMovement === undefined || typeof value.blocksMovement === "boolean")
    && (value.facing === undefined || isFacing(value.facing))
    && (value.stance === undefined || isCombatStance(value.stance))
    && (value.formation === undefined || isFormationKind(value.formation))
    && (value.combatPhase === undefined || isAbilityPhase(value.combatPhase))
    && (value.abilityReadyTick === undefined || isNonNegativeSafeInteger(value.abilityReadyTick))
    && (value.statuses === undefined || isPublicStatuses(value.statuses))
    && (value.passiveProgress === undefined || isPassiveProgress(value.passiveProgress))
    && (value.cargo === undefined || isResourceCargo(value.cargo))
    && (value.civilianActivity === undefined || isCivilianActivity(value.civilianActivity))
    && (value.resourceNode === undefined || isResourceNode(value.resourceNode))
    && (value.monsterState === undefined || isMonsterPublicState(value.monsterState));
}

function isPublicProjectileLike(value: unknown): value is PublicProjectileState {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "ownerId", "sourceId", "profileId", "position", "targetId", "targetPoint", "impactTick"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.ownerId)
    && isNullableNonEmptyString(value.sourceId)
    && isProjectileProfileId(value.profileId)
    && isGridPoint(value.position)
    && isNullableNonEmptyString(value.targetId)
    && isGridPoint(value.targetPoint)
    && isNonNegativeSafeInteger(value.impactTick);
}

function isStaleSightingLike(value: unknown): value is StaleEntitySighting {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, [
    "entityId", "ownerId", "typeId", "position", "hitPoints", "maxHitPoints", "stateRevision", "orientation",
    "gateOpen", "complete", "constructionRemainingTicks", "healthBand", "blocksMovement", "observedAtTick",
  ])) return false;
  return isNonEmptyString(value.entityId)
    && isNonEmptyString(value.ownerId)
    && isBuildingType(value.typeId)
    && isGridPoint(value.position)
    && isNonNegativeSafeInteger(value.hitPoints)
    && isNonNegativeSafeInteger(value.maxHitPoints)
    && isNonNegativeSafeInteger(value.stateRevision)
    && isStructureOrientation(value.orientation)
    && (value.gateOpen === undefined || typeof value.gateOpen === "boolean")
    && typeof value.complete === "boolean"
    && isNonNegativeSafeInteger(value.constructionRemainingTicks)
    && isStructureHealthBand(value.healthBand)
    && typeof value.blocksMovement === "boolean"
    && isNonNegativeSafeInteger(value.observedAtTick);
}

function isDeltaChanges(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, [
    "phase", "victory", "wallet", "population", "settlementTier", "completedTechnologyIds", "activeMonsterBoons",
    "exploredTilesRle", "visibilityRevision", "visibleTileIndices", "visibleEntityIds",
  ])) return false;
  return (value.phase === undefined || isMatchPhase(value.phase))
    && (value.victory === undefined || isVictoryState(value.victory))
    && (value.wallet === undefined || isResourceWallet(value.wallet))
    && (value.population === undefined || isPopulation(value.population))
    && (value.settlementTier === undefined || isSettlementTier(value.settlementTier))
    && (value.completedTechnologyIds === undefined || (
      Array.isArray(value.completedTechnologyIds)
      && value.completedTechnologyIds.every(isTechnologyType)
      && new Set(value.completedTechnologyIds).size === value.completedTechnologyIds.length
    ))
    && (value.activeMonsterBoons === undefined || (
      Array.isArray(value.activeMonsterBoons)
      && value.activeMonsterBoons.every(isActiveMonsterBoon)
      && new Set(value.activeMonsterBoons.map((boon) => boon.id)).size === value.activeMonsterBoons.length
    ))
    && (value.exploredTilesRle === undefined || typeof value.exploredTilesRle === "string")
    && (value.visibilityRevision === undefined || isNonNegativeSafeInteger(value.visibilityRevision))
    && (value.visibleTileIndices === undefined || isSafeIntegerArray(value.visibleTileIndices))
    && (value.visibleEntityIds === undefined || isStringArray(value.visibleEntityIds));
}

function isCollectionDelta(
  value: unknown,
  idKey: "id" | "entityId",
  itemGuard: (item: unknown) => boolean,
): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["upserted", "removedIds"])
    || !Array.isArray(value.upserted)
    || !Array.isArray(value.removedIds)
    || !value.upserted.every(itemGuard)
    || !isStringArray(value.removedIds)) return false;
  const upsertedIds = value.upserted.map((item) => (item as Record<string, unknown>)[idKey]);
  if (!upsertedIds.every((id): id is string => typeof id === "string")
    || new Set(upsertedIds).size !== upsertedIds.length) return false;
  const removed = new Set(value.removedIds);
  return upsertedIds.every((id) => !removed.has(id));
}

function hasUniqueCollectionIds(value: readonly unknown[], idKey: "id" | "entityId"): boolean {
  const ids = value.map((item) => (item as Record<string, unknown>)[idKey]);
  return ids.every(isNonEmptyString) && new Set(ids).size === ids.length;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= 100_000
    && value.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function isSafeIntegerArray(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length <= 100_000
    && value.every(isNonNegativeSafeInteger)
    && new Set(value).size === value.length;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}
