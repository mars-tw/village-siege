import { describe, expect, it } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  isMatchCommandIntent,
  isMatchLifecycleMessage,
  isMatchReplicationFrame,
  isMatchServerHello,
  isVisibleSnapshot,
  type MatchDeltaFrame,
  type MatchLifecycleMessage,
  type MatchRecoveryFailureCode,
  type MatchSnapshotFrame,
  type VisibleSnapshot,
} from "./protocol.js";
import {
  ReplicationError,
  applyVisibleSnapshotDelta,
  createVisibleSnapshotDelta,
} from "./replication.js";
import {
  createInitialState,
  hashVisibleSnapshot,
  toVisibleSnapshot,
  verifyVisibleSnapshotChecksum,
} from "./simulation.js";
import { RULES_VERSION, TICK_MILLISECONDS } from "./content.js";
import { updateVisibilityState } from "./visibility.js";

describe("recipient-filtered replication", () => {
  it("round-trips top-level and keyed collection changes without mutating the base", () => {
    const base = createSnapshot();
    const before = structuredClone(base);
    const mutable = structuredClone(base) as MutableSnapshot;
    mutable.serverTick = 1;
    mutable.wallet.food -= 50;
    mutable.visibilityRevision += 1;
    mutable.participants = mutable.participants.map((participant) => participant.id === "player-2"
      ? { ...participant, surrendered: true }
      : participant);
    const ownBuildingIndex = mutable.entities.findIndex((entity) => entity.kind === "building" && entity.ownerId === "player-1");
    const ownBuilding = mutable.entities[ownBuildingIndex]!;
    mutable.entities[ownBuildingIndex] = {
      ...ownBuilding,
      hitPoints: ownBuilding.hitPoints - 1,
      stateRevision: ownBuilding.stateRevision + 1,
      ownerControl: {
        productionQueue: [{
          jobId: { commandSequence: 4, itemIndex: 0 },
          kind: "train",
          unitType: "villager",
          remainingTicks: 90,
          totalTicks: 120,
          paidCost: { food: 50, wood: 0, stone: 0 },
        }],
        rallyPoint: { x: 8, y: 8 },
      },
    };
    mutable.advancement = { producerId: ownBuilding.id, targetTier: "stronghold", remainingTicks: 311 };
    const removedIndex = mutable.entities.findIndex((entity, index) => index !== ownBuildingIndex && entity.kind === "resource");
    mutable.entities.splice(removedIndex, 1);
    mutable.visibleEntityIds = mutable.entities.map((entity) => entity.id);
    mutable.projectiles.push({
      id: "projectile-test",
      ownerId: "player-1",
      sourceId: null,
      profileId: "arrow",
      position: { x: 3, y: 3 },
      targetId: null,
      targetPoint: { x: 4, y: 3 },
      impactTick: 2,
    });
    const next = withChecksum(mutable);

    const delta = createVisibleSnapshotDelta(base, next);
    expect(delta.entities.upserted).toHaveLength(1);
    expect(delta.entities.removedIds).toHaveLength(1);
    expect(delta.projectiles.upserted).toHaveLength(1);
    expect(delta.changes.participants?.find((participant) => participant.id === "player-2")?.surrendered).toBe(true);
    expect(delta.changes.advancement).toEqual({ producerId: ownBuilding.id, targetTier: "stronghold", remainingTicks: 311 });
    expect(applyVisibleSnapshotDelta(base, delta)).toEqual(next);
    expect(base).toEqual(before);
  });

  it("rejects tick, base checksum and target checksum mismatches atomically", () => {
    const base = createSnapshot();
    const next = withChecksum({ ...structuredClone(base), serverTick: 1 });
    const delta = createVisibleSnapshotDelta(base, next);
    const before = structuredClone(base);

    expect(() => applyVisibleSnapshotDelta({ ...base, serverTick: 9 }, delta)).toThrowError(ReplicationError);
    expect(() => applyVisibleSnapshotDelta({ ...base, checksum: "00000000" }, delta)).toThrowError(ReplicationError);
    expect(() => applyVisibleSnapshotDelta(base, { ...delta, checksum: "00000000" })).toThrowError(ReplicationError);
    expect(base).toEqual(before);
  });

  it("never includes a hostile entity that changed only outside recipient vision", () => {
    const state = createSeparatedState();
    const hidden = state.entities.find((entity) => entity.ownerId === "player-2" && entity.kind === "unit")!;
    const base = toVisibleSnapshot(state, "player-1");
    expect(base.entities.some((entity) => entity.id === hidden.id)).toBe(false);

    hidden.position = { x: hidden.position.x - 1, y: hidden.position.y };
    hidden.hitPoints -= 3;
    hidden.stateRevision += 1;
    state.tick += 1;
    updateVisibilityState(state);
    const next = toVisibleSnapshot(state, "player-1");
    const serialized = JSON.stringify(createVisibleSnapshotDelta(base, next));

    expect(serialized).not.toContain(hidden.id);
    expect(serialized).not.toContain(String(hidden.hitPoints));
  });

  it("strictly guards hello, command intent and frame identities", () => {
    const snapshot = createSnapshot();
    const hello = {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: snapshot.matchId,
      recipientPlayerId: snapshot.recipientPlayerId,
      tickMilliseconds: TICK_MILLISECONDS,
      fullSnapshotIntervalTicks: 50,
      canonicalHashIntervalTicks: 20,
      lastReceivedClientCommandSeq: -1,
      nextClientCommandSeq: 0,
    };
    expect(isMatchServerHello(hello)).toBe(true);
    expect(isMatchServerHello({ ...hello, extra: true })).toBe(false);
    expect(isMatchServerHello({ ...hello, nextClientCommandSeq: 2 })).toBe(false);

    const intent = {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      commandId: "command_00000001",
      clientCommandSeq: 0,
      lastServerTickSeen: 0,
      command: { type: "surrender" },
    };
    expect(isMatchCommandIntent(intent)).toBe(true);
    expect(isMatchCommandIntent({ ...intent, playerId: "forged" })).toBe(false);
    expect(isMatchCommandIntent({ ...intent, commandId: "short" })).toBe(false);

    const frame: MatchSnapshotFrame = {
      kind: "snapshot",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: snapshot.matchId,
      recipientPlayerId: snapshot.recipientPlayerId,
      serverTick: snapshot.serverTick,
      events: [],
      snapshot,
    };
    expect(isMatchReplicationFrame(frame)).toBe(true);
    expect(isMatchReplicationFrame({ ...frame, matchId: "wrong-match" })).toBe(false);
    expect(isMatchReplicationFrame({ ...frame, events: [{ type: "commandAccepted", sequence: 0, serverTick: 0 }] })).toBe(false);
  });

  it("strictly guards every recovery lifecycle variant and failure code", () => {
    const common = {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: "recovery-match",
      recipientPlayerId: "player-1",
      serverTick: 27,
      recoveryEpoch: 2,
    } as const;
    const failureCodes: readonly MatchRecoveryFailureCode[] = [
      "RECONNECT_LEASE_EXPIRED",
      "SERVER_UNAVAILABLE",
      "PERSISTENCE_UNAVAILABLE",
      "STATE_CORRUPT",
      "LEASE_LOST",
      "RECOVERY_TIMEOUT",
      "SEQUENCE_DIVERGED",
      "MATCH_ENDED",
    ];
    const valid: MatchLifecycleMessage[] = [
      { ...common, type: "recovering", leaseExpiresAtEpochMs: 1_800_000_000_000 },
      { ...common, type: "resumed" },
      ...failureCodes.map((code) => ({ ...common, type: "failed" as const, code, recoverable: false })),
      { ...common, type: "failed", code: "SERVER_UNAVAILABLE", recoverable: true },
    ];
    for (const message of valid) expect(isMatchLifecycleMessage(message)).toBe(true);

    const invalid: unknown[] = [
      null,
      [],
      { ...common },
      { ...common, type: "unknown" },
      { ...common, type: "resumed", extra: true },
      { ...common, type: "resumed", protocolVersion: "village-siege-network/0" },
      { ...common, type: "resumed", rulesVersion: "" },
      { ...common, type: "resumed", rulesVersion: 14 },
      { ...common, type: "resumed", matchId: "" },
      { ...common, type: "resumed", recipientPlayerId: "" },
      { ...common, type: "resumed", serverTick: -1 },
      { ...common, type: "resumed", serverTick: 1.5 },
      { ...common, type: "resumed", recoveryEpoch: -1 },
      { ...common, type: "resumed", recoveryEpoch: 1.5 },
      { ...common, type: "recovering" },
      { ...common, type: "recovering", leaseExpiresAtEpochMs: -1 },
      { ...common, type: "recovering", leaseExpiresAtEpochMs: 1.5 },
      { ...common, type: "recovering", leaseExpiresAtEpochMs: "later" },
      { ...common, type: "recovering", leaseExpiresAtEpochMs: 1_800_000_000_000, recoverable: true },
      { ...common, type: "resumed", leaseExpiresAtEpochMs: 1_800_000_000_000 },
      { ...common, type: "failed", code: "SERVER_UNAVAILABLE" },
      { ...common, type: "failed", recoverable: false },
      { ...common, type: "failed", code: "UNKNOWN", recoverable: false },
      { ...common, type: "failed", code: "STATE_CORRUPT", recoverable: "no" },
      { ...common, type: "failed", code: "STATE_CORRUPT", recoverable: false, leaseExpiresAtEpochMs: 1 },
    ];
    for (const message of invalid) expect(isMatchLifecycleMessage(message)).toBe(false);
  });

  it("rejects duplicate and overlapping keyed delta identities", () => {
    const base = createSnapshot();
    const next = withChecksum({ ...structuredClone(base), serverTick: 1 });
    const delta = createVisibleSnapshotDelta(base, next);
    const entity = base.entities[0]!;
    const malformed: MatchDeltaFrame = {
      kind: "delta",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: base.rulesVersion,
      matchId: base.matchId,
      recipientPlayerId: base.recipientPlayerId,
      serverTick: 1,
      events: [],
      delta: {
        ...delta,
        entities: { upserted: [entity, entity], removedIds: [entity.id] },
      },
    };
    expect(isMatchReplicationFrame(malformed)).toBe(false);
  });

  it("rejects malformed nested state and unknown world events even with a recomputed checksum", () => {
    const snapshot = createSnapshot();
    const unitIndex = snapshot.entities.findIndex((entity) => entity.kind === "unit");
    const malformedEntities = structuredClone(snapshot.entities) as unknown as Record<string, unknown>[];
    malformedEntities[unitIndex] = { ...malformedEntities[unitIndex], statuses: "not-an-array" };
    const malformedSnapshot = withChecksum({
      ...structuredClone(snapshot),
      entities: malformedEntities,
    } as unknown as VisibleSnapshot);
    const frame = snapshotFrame(malformedSnapshot);

    expect(verifyVisibleSnapshotChecksum(malformedSnapshot)).toBe(true);
    expect(isMatchReplicationFrame(frame)).toBe(false);
    expect(isMatchReplicationFrame({
      ...snapshotFrame(snapshot),
      events: [{ type: "privateCanonicalDump", value: "secret" }],
    })).toBe(false);
    expect(isMatchReplicationFrame(snapshotFrame(withChecksum({
      ...structuredClone(snapshot),
      victory: { ...structuredClone(snapshot.victory), teams: "not-an-array" },
    } as unknown as VisibleSnapshot)))).toBe(false);
    expect(isMatchReplicationFrame(snapshotFrame(withChecksum({
      ...structuredClone(snapshot),
      activeMonsterBoons: [{ id: "unknown-boon", expiresAtTick: 10 }],
    } as unknown as VisibleSnapshot)))).toBe(false);
  });

  it("rejects recipient-contract tampering even when the visible checksum is recomputed", () => {
    const snapshot = createSnapshot();
    const ownBuildingIndex = snapshot.entities.findIndex((entity) => entity.kind === "building" && entity.ownerId === snapshot.recipientPlayerId);
    const ownBuilding = snapshot.entities[ownBuildingIndex]!;

    const withoutOwnControl = structuredClone(snapshot) as MutableSnapshot;
    withoutOwnControl.entities[ownBuildingIndex] = { ...ownBuilding, ownerControl: undefined };
    const withoutOwnControlChecksum = withChecksum(withoutOwnControl);
    expect(verifyVisibleSnapshotChecksum(withoutOwnControlChecksum)).toBe(true);
    expect(isVisibleSnapshot(withoutOwnControlChecksum)).toBe(false);
    expect(isMatchReplicationFrame(snapshotFrame(withoutOwnControlChecksum))).toBe(false);

    const foreignControl = structuredClone(snapshot) as MutableSnapshot;
    foreignControl.entities[ownBuildingIndex] = { ...ownBuilding, ownerId: "player-2" };
    const foreignControlChecksum = withChecksum(foreignControl);
    expect(verifyVisibleSnapshotChecksum(foreignControlChecksum)).toBe(true);
    expect(isVisibleSnapshot(foreignControlChecksum)).toBe(false);
    expect(isMatchReplicationFrame(snapshotFrame(foreignControlChecksum))).toBe(false);

    const wrongTeam = withChecksum({ ...structuredClone(snapshot), recipientTeamId: "forged-team" });
    expect(isVisibleSnapshot(wrongTeam)).toBe(false);

    const privateParticipant = structuredClone(snapshot) as unknown as Record<string, unknown>;
    privateParticipant.participants = (snapshot.participants as readonly unknown[]).map((participant, index) => index === 0
      ? { ...(participant as object), resources: { food: 999, wood: 999, stone: 999 } }
      : participant);
    const privateParticipantChecksum = withChecksum(privateParticipant as unknown as VisibleSnapshot);
    expect(verifyVisibleSnapshotChecksum(privateParticipantChecksum)).toBe(true);
    expect(isVisibleSnapshot(privateParticipantChecksum)).toBe(false);

    const wrongAdvancement = withChecksum({
      ...structuredClone(snapshot),
      advancement: { producerId: snapshot.entities.find((entity) => entity.kind === "unit")!.id, targetTier: "stronghold", remainingTicks: 1 },
    });
    expect(isVisibleSnapshot(wrongAdvancement)).toBe(false);
  });

  it("rejects participant identity changes and foreign owner control in deltas", () => {
    const base = createSnapshot();
    const changedIdentity = structuredClone(base) as MutableSnapshot;
    changedIdentity.serverTick = 1;
    changedIdentity.participants = changedIdentity.participants.map((participant) => participant.id === "player-2"
      ? { ...participant, teamId: "forged-team" }
      : participant);
    expect(() => createVisibleSnapshotDelta(base, withChecksum(changedIdentity))).toThrowError(ReplicationError);

    const ownBuildingIndex = base.entities.findIndex((entity) => entity.kind === "building" && entity.ownerId === base.recipientPlayerId);
    const invalidNext = structuredClone(base) as MutableSnapshot;
    invalidNext.serverTick = 1;
    invalidNext.entities[ownBuildingIndex] = { ...invalidNext.entities[ownBuildingIndex]!, ownerId: "player-2" };
    const invalidDelta = createVisibleSnapshotDelta(base, withChecksum(invalidNext));
    expect(() => applyVisibleSnapshotDelta(base, invalidDelta)).toThrowError(ReplicationError);

    const frame: MatchDeltaFrame = {
      kind: "delta",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: base.rulesVersion,
      matchId: base.matchId,
      recipientPlayerId: base.recipientPlayerId,
      serverTick: invalidDelta.serverTick,
      events: [],
      delta: invalidDelta,
    };
    expect(isMatchReplicationFrame(frame)).toBe(false);
  });

  it("round-trips advancement clearing through a delta", () => {
    const state = createSeparatedState();
    const ownTown = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    state.players.find((player) => player.id === "player-1")!.advancement = {
      producerId: ownTown.id,
      targetTier: "stronghold",
      remainingTicks: 200,
    };
    const base = toVisibleSnapshot(state, "player-1");
    state.tick += 1;
    state.players.find((player) => player.id === "player-1")!.advancement = null;
    const next = toVisibleSnapshot(state, "player-1");
    const delta = createVisibleSnapshotDelta(base, next);

    expect(delta.changes).toHaveProperty("advancement", null);
    expect(applyVisibleSnapshotDelta(base, delta)).toEqual(next);
  });
});

function snapshotFrame(snapshot: VisibleSnapshot): MatchSnapshotFrame {
  return {
    kind: "snapshot",
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: snapshot.rulesVersion,
    matchId: snapshot.matchId,
    recipientPlayerId: snapshot.recipientPlayerId,
    serverTick: snapshot.serverTick,
    events: [],
    snapshot,
  };
}

type MutableSnapshot = {
  -readonly [Key in keyof VisibleSnapshot]: VisibleSnapshot[Key] extends readonly (infer Item)[]
    ? Item[]
    : VisibleSnapshot[Key];
};

function createSnapshot(): VisibleSnapshot {
  return toVisibleSnapshot(createSeparatedState(), "player-1");
}

function createSeparatedState() {
  return createInitialState({
    matchId: "replication-match",
    seed: 73,
    map: { width: 40, height: 40 },
    players: [
      { id: "player-1", teamId: "team-1", villageId: "pinehold" },
      { id: "player-2", teamId: "team-2", villageId: "riverstead" },
    ],
    spawnOverrides: {
      "player-1": { x: 3, y: 3 },
      "player-2": { x: 35, y: 35 },
    },
  });
}

function withChecksum(snapshot: Omit<VisibleSnapshot, "checksum"> | VisibleSnapshot): VisibleSnapshot {
  const { checksum: _checksum, ...body } = snapshot as VisibleSnapshot;
  return { ...body, checksum: hashVisibleSnapshot(body) };
}
