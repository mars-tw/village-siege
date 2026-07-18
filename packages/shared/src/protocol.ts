export type MatchId = string;
export type PlayerId = string;
export type EntityId = string;
export type VillageId = "pinehold" | "riverstead" | "highcrag" | "marshwatch" | "sunfield";
export type PlayableVillageId = "pinehold" | "riverstead" | "highcrag";
export type ResourceKind = "food" | "wood" | "stone";
export type AiPersonality = "aggressor" | "guardian" | "prosperer" | "balanced" | "raider";
export type AiDifficulty = "novice" | "standard" | "veteran";
export type MatchPhase = "lobby" | "loading" | "playing" | "finished" | "disposed";
export type BuildingType = "townCenter" | "house" | "lumberCamp" | "farmstead" | "barracks" | "defenseTower";
export type UnitType = "villager" | "militia" | "spearman" | "archer" | "scout" | "batteringRam";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface ResourceWallet {
  readonly food: number;
  readonly wood: number;
  readonly stone: number;
}

export type GameCommand =
  | { readonly type: "move"; readonly entityIds: readonly EntityId[]; readonly target: GridPoint }
  | { readonly type: "attack"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "gather"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "build"; readonly builderIds: readonly EntityId[]; readonly buildingType: BuildingType; readonly origin: GridPoint }
  | { readonly type: "train"; readonly producerId: EntityId; readonly unitType: UnitType; readonly count: number }
  | { readonly type: "patrol"; readonly entityIds: readonly EntityId[]; readonly waypoints: readonly GridPoint[] }
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
  | "ACTION_ON_COOLDOWN"
  | "TARGET_NOT_VISIBLE"
  | "TARGET_NOT_REACHABLE";

export interface PublicEntityState {
  readonly id: EntityId;
  readonly ownerId: PlayerId | null;
  readonly kind: "unit" | "building" | "resource";
  readonly typeId: UnitType | BuildingType | ResourceKind;
  readonly position: GridPoint;
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly stateRevision: number;
}

export type DomainEvent =
  | { readonly type: "commandAccepted"; readonly sequence: number; readonly serverTick: number }
  | { readonly type: "commandRejected"; readonly sequence: number; readonly code: CommandRejectCode }
  | { readonly type: "entitySpawned"; readonly entity: PublicEntityState }
  | { readonly type: "entityUpdated"; readonly entity: PublicEntityState }
  | { readonly type: "entityRemoved"; readonly entityId: EntityId; readonly reason: "destroyed" | "completed" | "despawned" }
  | { readonly type: "matchFinished"; readonly winningTeamIds: readonly string[]; readonly reason: "conquest" | "surrender" | "disconnect" };

export function isGridPoint(value: unknown): value is GridPoint {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ["x", "y"]) && isSafeInteger(value.x) && isSafeInteger(value.y);
}

export function isGameCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "move":
      return hasOnlyKeys(value, ["type", "entityIds", "target"]) && isIdArray(value.entityIds) && isGridPoint(value.target);
    case "attack":
    case "gather":
      return hasOnlyKeys(value, ["type", "entityIds", "targetId"]) && isIdArray(value.entityIds) && typeof value.targetId === "string" && value.targetId.length > 0;
    case "build":
      return hasOnlyKeys(value, ["type", "builderIds", "buildingType", "origin"]) && isIdArray(value.builderIds) && isBuildingType(value.buildingType) && isGridPoint(value.origin);
    case "train":
      return hasOnlyKeys(value, ["type", "producerId", "unitType", "count"]) && typeof value.producerId === "string" && isUnitType(value.unitType) && isSafeInteger(value.count) && value.count >= 1 && value.count <= 5;
    case "patrol":
      return hasOnlyKeys(value, ["type", "entityIds", "waypoints"]) && isIdArray(value.entityIds) && Array.isArray(value.waypoints) && value.waypoints.length >= 2 && value.waypoints.length <= 8 && value.waypoints.every(isGridPoint);
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
  return typeof value === "string" && (["townCenter", "house", "lumberCamp", "farmstead", "barracks", "defenseTower"] as const).includes(value as BuildingType);
}

export function isUnitType(value: unknown): value is UnitType {
  return typeof value === "string" && (["villager", "militia", "spearman", "archer", "scout", "batteringRam"] as const).includes(value as UnitType);
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
