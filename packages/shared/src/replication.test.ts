import { describe, expect, it } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  isMatchCommandIntent,
  isMatchReplicationFrame,
  isMatchServerHello,
  type MatchDeltaFrame,
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
    mutable.entities[0]!.hitPoints -= 1;
    mutable.entities[0]!.stateRevision += 1;
    mutable.entities.pop();
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
