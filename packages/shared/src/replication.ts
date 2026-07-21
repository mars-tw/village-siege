import {
  isVisibleSnapshot,
  isVisibleSnapshotDelta,
  type CollectionDelta,
  type PublicEntityState,
  type PublicProjectileState,
  type StaleEntitySighting,
  type VisibleSnapshot,
  type VisibleSnapshotDelta,
} from "./protocol.js";
import { hashVisibleSnapshot, verifyVisibleSnapshotChecksum } from "./simulation.js";

export type ReplicationErrorCode =
  | "INVALID_DELTA"
  | "BASE_IDENTITY_MISMATCH"
  | "BASE_TICK_MISMATCH"
  | "BASE_CHECKSUM_MISMATCH"
  | "RESULT_CHECKSUM_MISMATCH";

export class ReplicationError extends Error {
  constructor(readonly code: ReplicationErrorCode, message: string) {
    super(message);
    this.name = "ReplicationError";
  }
}

/** Creates a patch from two already recipient-filtered snapshots. Canonical MatchState is intentionally not accepted. */
export function createVisibleSnapshotDelta(
  base: VisibleSnapshot,
  next: VisibleSnapshot,
): VisibleSnapshotDelta {
  assertSnapshotPair(base, next);
  if (!verifyVisibleSnapshotChecksum(base) || !verifyVisibleSnapshotChecksum(next)) {
    throw new ReplicationError("BASE_CHECKSUM_MISMATCH", "Cannot diff a snapshot with an invalid visible checksum");
  }

  const changes: MutableChanges = {};
  copyChange(changes, "phase", base.phase, next.phase);
  copyChange(changes, "victory", base.victory, next.victory);
  copyChange(changes, "wallet", base.wallet, next.wallet);
  copyChange(changes, "population", base.population, next.population);
  copyChange(changes, "settlementTier", base.settlementTier, next.settlementTier);
  copyChange(changes, "participants", base.participants, next.participants);
  copyChange(changes, "advancement", base.advancement, next.advancement);
  copyChange(changes, "completedTechnologyIds", base.completedTechnologyIds, next.completedTechnologyIds);
  copyChange(changes, "activeMonsterBoons", base.activeMonsterBoons, next.activeMonsterBoons);
  copyChange(changes, "exploredTilesRle", base.exploredTilesRle, next.exploredTilesRle);
  copyChange(changes, "visibilityRevision", base.visibilityRevision, next.visibilityRevision);
  copyChange(changes, "visibleTileIndices", base.visibleTileIndices, next.visibleTileIndices);
  copyChange(changes, "visibleEntityIds", base.visibleEntityIds, next.visibleEntityIds);

  return {
    matchId: next.matchId,
    rulesVersion: next.rulesVersion,
    recipientPlayerId: next.recipientPlayerId,
    baseServerTick: base.serverTick,
    serverTick: next.serverTick,
    baseChecksum: base.checksum,
    checksum: next.checksum,
    changes,
    entities: diffCollection(base.entities, next.entities, (entity) => entity.id),
    projectiles: diffCollection(base.projectiles, next.projectiles, (projectile) => projectile.id),
    staleEnemySightings: diffCollection(
      base.staleEnemySightings,
      next.staleEnemySightings,
      (sighting) => sighting.entityId,
    ),
  };
}

/** Applies and verifies a delta atomically. The supplied base object is never mutated. */
export function applyVisibleSnapshotDelta(
  base: VisibleSnapshot,
  delta: VisibleSnapshotDelta,
): VisibleSnapshot {
  if (!isVisibleSnapshotDelta(delta)) {
    throw new ReplicationError("INVALID_DELTA", "Visible snapshot delta failed its wire guard");
  }
  if (base.matchId !== delta.matchId
    || base.rulesVersion !== delta.rulesVersion
    || base.recipientPlayerId !== delta.recipientPlayerId) {
    throw new ReplicationError("BASE_IDENTITY_MISMATCH", "Delta identity does not match the current visible snapshot");
  }
  if (base.serverTick !== delta.baseServerTick) {
    throw new ReplicationError("BASE_TICK_MISMATCH", "Delta does not continue from the current visible tick");
  }
  if (!verifyVisibleSnapshotChecksum(base) || base.checksum !== delta.baseChecksum) {
    throw new ReplicationError("BASE_CHECKSUM_MISMATCH", "Delta base checksum does not match the current visible snapshot");
  }

  const changes = delta.changes;
  const candidateBody: Omit<VisibleSnapshot, "checksum"> = {
    matchId: base.matchId,
    rulesVersion: base.rulesVersion,
    serverTick: delta.serverTick,
    recipientPlayerId: base.recipientPlayerId,
    recipientTeamId: base.recipientTeamId,
    participants: cloneWire(changes.participants ?? base.participants),
    phase: changes.phase ?? base.phase,
    victory: cloneWire(changes.victory ?? base.victory),
    map: cloneWire(base.map),
    wallet: cloneWire(changes.wallet ?? base.wallet),
    population: cloneWire(changes.population ?? base.population),
    settlementTier: changes.settlementTier ?? base.settlementTier,
    advancement: hasOwn(changes, "advancement") ? cloneWire(changes.advancement ?? null) : cloneWire(base.advancement),
    completedTechnologyIds: cloneWire(changes.completedTechnologyIds ?? base.completedTechnologyIds),
    activeMonsterBoons: cloneWire(changes.activeMonsterBoons ?? base.activeMonsterBoons),
    entities: applyCollection(base.entities, delta.entities, (entity) => entity.id),
    projectiles: applyCollection(base.projectiles, delta.projectiles, (projectile) => projectile.id),
    staleEnemySightings: applyCollection(
      base.staleEnemySightings,
      delta.staleEnemySightings,
      (sighting) => sighting.entityId,
    ),
    exploredTilesRle: changes.exploredTilesRle ?? base.exploredTilesRle,
    visibilityRevision: changes.visibilityRevision ?? base.visibilityRevision,
    visibleTileIndices: cloneWire(changes.visibleTileIndices ?? base.visibleTileIndices),
    visibleEntityIds: cloneWire(changes.visibleEntityIds ?? base.visibleEntityIds),
  };
  const checksum = hashVisibleSnapshot(candidateBody);
  if (checksum !== delta.checksum) {
    throw new ReplicationError(
      "RESULT_CHECKSUM_MISMATCH",
      `Applied delta checksum ${checksum} does not match server visible checksum ${delta.checksum}`,
    );
  }
  if (!hasSameParticipantIdentity(base.participants, candidateBody.participants)) {
    throw new ReplicationError("BASE_IDENTITY_MISMATCH", "Participant identity cannot change inside a visible delta stream");
  }
  const candidate = { ...candidateBody, checksum };
  if (!isVisibleSnapshot(candidate)) {
    throw new ReplicationError("INVALID_DELTA", "Applied delta violates the visible snapshot recipient contract");
  }
  return candidate;
}

type MutableChanges = {
  -readonly [Key in keyof VisibleSnapshotDelta["changes"]]?: VisibleSnapshotDelta["changes"][Key];
};

function assertSnapshotPair(base: VisibleSnapshot, next: VisibleSnapshot): void {
  if (base.matchId !== next.matchId
    || base.rulesVersion !== next.rulesVersion
    || base.recipientPlayerId !== next.recipientPlayerId
    || base.recipientTeamId !== next.recipientTeamId
    || !hasSameParticipantIdentity(base.participants, next.participants)) {
    throw new ReplicationError("BASE_IDENTITY_MISMATCH", "Visible snapshots do not belong to the same recipient stream");
  }
  if (next.serverTick <= base.serverTick) {
    throw new ReplicationError("BASE_TICK_MISMATCH", "Visible delta target tick must advance");
  }
  if (canonicalJson(base.map) !== canonicalJson(next.map)) {
    throw new ReplicationError("BASE_IDENTITY_MISMATCH", "Map identity cannot change inside a visible delta stream");
  }
}

function hasSameParticipantIdentity(
  left: VisibleSnapshot["participants"],
  right: VisibleSnapshot["participants"],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((participant, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && participant.id === candidate.id
      && participant.teamId === candidate.teamId
      && participant.villageId === candidate.villageId;
  });
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function copyChange<Key extends keyof MutableChanges>(
  changes: MutableChanges,
  key: Key,
  before: VisibleSnapshotDelta["changes"][Key],
  after: VisibleSnapshotDelta["changes"][Key],
): void {
  if (canonicalJson(before) !== canonicalJson(after)) {
    changes[key] = cloneWire(after) as MutableChanges[Key];
  }
}

function diffCollection<T>(
  base: readonly T[],
  next: readonly T[],
  idOf: (item: T) => string,
): CollectionDelta<T> {
  const baseById = new Map(base.map((item) => [idOf(item), item]));
  const nextById = new Map(next.map((item) => [idOf(item), item]));
  const upserted = [...nextById]
    .filter(([id, item]) => !baseById.has(id) || canonicalJson(baseById.get(id)) !== canonicalJson(item))
    .sort(([left], [right]) => compareText(left, right))
    .map(([, item]) => cloneWire(item));
  const removedIds = [...baseById.keys()]
    .filter((id) => !nextById.has(id))
    .sort(compareText);
  return { upserted, removedIds };
}

function applyCollection<T>(
  base: readonly T[],
  delta: CollectionDelta<T>,
  idOf: (item: T) => string,
): T[] {
  const removed = new Set(delta.removedIds);
  const byId = new Map(base.filter((item) => !removed.has(idOf(item))).map((item) => [idOf(item), cloneWire(item)]));
  for (const item of delta.upserted) byId.set(idOf(item), cloneWire(item));
  return [...byId.entries()].sort(([left], [right]) => compareText(left, right)).map(([, item]) => item);
}

function cloneWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type { PublicEntityState, PublicProjectileState, StaleEntitySighting };
