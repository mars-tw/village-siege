import { describe, expect, it } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  TICK_MILLISECONDS,
  createInitialState,
  createVisibleSnapshotDelta,
  toVisibleSnapshot,
  updateVisibilityState,
  type MatchDeltaFrame,
  type MatchServerHello,
  type MatchSnapshotFrame,
} from "@village-siege/shared";
import { AuthoritativeMatchStore } from "../src/network/AuthoritativeMatchStore.js";

describe("AuthoritativeMatchStore", () => {
  it("requires an exact hello tuple before accepting a checksum-valid full snapshot", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId);

    expect(store.acceptHello({ ...hello(base.matchId, base.recipientPlayerId), rulesVersion: "wrong" })).toBe(false);
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: false });
    expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId))).toBe(true);
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: true, duplicate: false });
    expect(store.current).toEqual(base);
    expect(store.synchronization).toBe("synchronized");
  });

  it("applies a matching delta atomically and ignores an exact duplicate", () => {
    const { base, next } = snapshots();
    const store = readyStore(base);
    const applied = store.applyFrame(deltaFrame(base, next));

    expect(applied).toMatchObject({ accepted: true, duplicate: false });
    expect(store.current).toEqual(next);
    expect(store.applyFrame(deltaFrame(base, next))).toMatchObject({
      accepted: false,
      requestResync: false,
      reason: "Duplicate delta ignored",
    });
  });

  it("requests resynchronization for a checksum-valid divergent delta at the same tick", () => {
    const { base, next } = snapshots();
    const divergent = divergentSnapshotAtSameTick();
    const store = readyStore(base);

    expect(store.applyFrame(deltaFrame(base, next))).toMatchObject({ accepted: true });
    expect(divergent.serverTick).toBe(next.serverTick);
    expect(divergent.checksum).not.toBe(next.checksum);
    expect(store.applyFrame(deltaFrame(base, divergent))).toMatchObject({
      accepted: false,
      requestResync: true,
      reason: "Divergent delta at the same server tick",
    });
    expect(store.current).toEqual(next);
  });

  it("preserves the prior state on delta gaps/checksum failures and requests one resync", () => {
    const { base, next } = snapshots();
    const store = readyStore(base);
    const frame = deltaFrame(base, next);
    const before = store.current;

    expect(store.applyFrame({
      ...frame,
      delta: { ...frame.delta, baseServerTick: 99 },
    })).toMatchObject({ accepted: false, requestResync: true });
    expect(store.current).toEqual(before);
    expect(store.applyFrame(frame)).toMatchObject({
      accepted: false,
      requestResync: false,
      reason: "Delta ignored while awaiting a full snapshot",
    });
    expect(store.applyFrame({
      ...frame,
      delta: { ...frame.delta, baseChecksum: "00000000" },
    })).toMatchObject({ accepted: false, requestResync: false });
    expect(store.current).toEqual(before);
    expect(store.synchronization).toBe("resyncing");
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: true, duplicate: true });
    expect(store.synchronization).toBe("synchronized");
    expect(store.applyFrame(frame)).toMatchObject({ accepted: true });
  });

  it("rejects wrong recipient and divergent same-tick snapshots", () => {
    const { base } = snapshots();
    const store = readyStore(base);
    const wrong = snapshotFrame({ ...base, recipientPlayerId: "player-2" });
    expect(store.applyFrame(wrong)).toMatchObject({ accepted: false, requestResync: true });

    const recovered = readyStore(base);
    expect(recovered.applyFrame(snapshotFrame({ ...base, checksum: "00000000" }))).toMatchObject({
      accepted: false,
      requestResync: true,
    });
  });

  it("keeps a stable command ID/sequence across retry and consumes one correlated result", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId, () => "command_00000001");
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));

    const intent = store.createIntent({ type: "surrender" });
    expect(intent).toMatchObject({
      commandId: "command_00000001",
      clientCommandSeq: 0,
      lastServerTickSeen: base.serverTick,
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
    });
    expect(store.retryIntent(intent.commandId)).toEqual(intent);
    const result = {
      commandId: intent.commandId,
      clientCommandSeq: intent.clientCommandSeq,
      accepted: true as const,
      serverTick: 1,
    };
    expect(store.applyCommandResult(result)).toMatchObject({ accepted: true, duplicate: false });
    expect(store.applyCommandResult(result)).toMatchObject({ accepted: true, duplicate: true });
    expect(store.applyCommandResult({ ...result, serverTick: 2 })).toMatchObject({
      accepted: false,
      reason: "Completed command result diverges from its first result",
    });
    expect(store.pendingCommandCount).toBe(0);
  });

  it("does not correlate malformed or mismatched command results", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId, () => "command_00000002");
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));
    store.createIntent({ type: "surrender" });

    expect(store.applyCommandResult({
      commandId: "command_00000002",
      clientCommandSeq: 99,
      accepted: true,
      serverTick: 1,
    })).toMatchObject({ accepted: false });
    expect(store.pendingCommandCount).toBe(1);
  });

  it("keeps a rate-limited intent pending so its exact sequence can be retried", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId, () => "command_retry_001");
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));
    const intent = store.createIntent({ type: "surrender" });

    expect(store.applyCommandResult({
      commandId: intent.commandId,
      clientCommandSeq: intent.clientCommandSeq,
      accepted: false,
      code: "RATE_LIMITED",
      serverTick: base.serverTick,
    })).toMatchObject({ accepted: true, duplicate: false });
    expect(store.pendingCommandCount).toBe(1);
    expect(store.retryIntent(intent.commandId)).toEqual(intent);
  });

  it("ignores an identical repeated hello without rewinding the local command sequence", () => {
    const { base } = snapshots();
    const ids = ["command_repeat_01", "command_repeat_02"];
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId, () => ids.shift()!);
    const serverHello = hello(base.matchId, base.recipientPlayerId);
    store.acceptHello(serverHello);
    store.applyFrame(snapshotFrame(base));
    expect(store.createIntent({ type: "surrender" }).clientCommandSeq).toBe(0);

    expect(store.acceptHello(serverHello)).toBe(true);
    expect(store.createIntent({ type: "surrender" }).clientCommandSeq).toBe(1);
  });

  it("applies client-side backpressure at the server reorder-window limit", () => {
    const { base } = snapshots();
    let id = 0;
    const store = new AuthoritativeMatchStore(
      base.matchId,
      base.recipientPlayerId,
      () => `command_limit_${(id += 1).toString().padStart(4, "0")}`,
    );
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));
    for (let index = 0; index < 16; index += 1) store.createIntent({ type: "surrender" });

    expect(() => store.createIntent({ type: "surrender" })).toThrow("Too many authoritative commands");
    expect(store.pendingCommandCount).toBe(16);
  });

  it("recovers only after a changed hello and full snapshot, then replays exact pending intents in sequence", () => {
    const { base, next } = snapshots();
    const ids = [
      "command_recovery_00",
      "command_recovery_01",
      "command_recovery_02",
      "command_recovery_03",
      "command_recovery_04",
    ];
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId, () => ids.shift()!);
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));
    const intents = Array.from({ length: 4 }, () => store.createIntent({ type: "surrender" }));
    expect(store.applyCommandResult({
      commandId: intents[0]!.commandId,
      clientCommandSeq: intents[0]!.clientCommandSeq,
      accepted: true,
      serverTick: base.serverTick,
    })).toMatchObject({ accepted: true });

    expect(store.beginRecovery(7)).toBe(true);
    expect(store.synchronization).toBe("awaitingReconnectHello");
    expect(() => store.createIntent({ type: "surrender" })).toThrow("commands are frozen");
    expect(store.applyFrame(deltaFrame(base, next))).toMatchObject({
      accepted: false,
      requestResync: false,
      reason: "Delta ignored before reconnect hello",
    });

    expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId, 2))).toBe(true);
    expect(store.synchronization).toBe("awaitingRecoverySnapshot");
    expect(store.applyFrame(deltaFrame(base, next))).toMatchObject({
      accepted: false,
      requestResync: true,
      reason: "Delta ignored while awaiting the recovery snapshot",
    });
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: true, duplicate: true });
    expect(store.synchronization).toBe("replayReady");

    const replay = store.pendingIntentsForReplay(7);
    expect(replay).toEqual(intents.slice(1));
    expect(replay.map((intent) => intent.clientCommandSeq)).toEqual([1, 2, 3]);
    (replay[0] as { command: { type: string } }).command.type = "tampered";
    expect(store.retryIntent(intents[1]!.commandId)).toEqual(intents[1]);
    expect(store.finishReplay(7)).toBe(true);
    expect(store.synchronization).toBe("synchronized");
    expect(store.createIntent({ type: "surrender" }).clientCommandSeq).toBe(4);
  });

  it("rejects a recovery sequence gap atomically and keeps failure sticky", () => {
    const { base } = snapshots();
    const ids = ["command_gap_000", "command_gap_001", "command_gap_002"];
    const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId, () => ids.shift()!);
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));
    const intents = Array.from({ length: 3 }, () => store.createIntent({ type: "surrender" }));
    store.applyCommandResult({
      commandId: intents[1]!.commandId,
      clientCommandSeq: intents[1]!.clientCommandSeq,
      accepted: true,
      serverTick: base.serverTick,
    });
    const before = store.current;

    expect(store.beginRecovery(11)).toBe(true);
    expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId, 0))).toBe(false);
    expect(store.synchronization).toBe("failed");
    expect(store.failureReason).toBe("Pending command journal is missing sequence 1");
    expect(store.pendingCommandCount).toBe(2);
    expect(store.current).toEqual(before);
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({
      accepted: false,
      requestResync: false,
      reason: "Pending command journal is missing sequence 1",
    });
    expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId, 3))).toBe(false);
    expect(store.beginRecovery(12)).toBe(false);
    expect(store.finishReplay(11)).toBe(false);
  });

  it("fast-forwards an empty local journal to the server sequence after a full recovery snapshot", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(
      base.matchId,
      base.recipientPlayerId,
      () => "command_after_fast_forward",
    );
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));

    expect(store.beginRecovery(3)).toBe(true);
    expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId, 5))).toBe(true);
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: true });
    expect(store.pendingIntentsForReplay(3)).toEqual([]);
    expect(store.finishReplay(3)).toBe(true);
    expect(store.createIntent({ type: "surrender" }).clientCommandSeq).toBe(5);
  });

  it("can recover a transport drop that happens before the first server hello", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(
      base.matchId,
      base.recipientPlayerId,
      () => "command_after_early_drop",
    );

    expect(store.beginRecovery(1)).toBe(true);
    expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId, 4))).toBe(true);
    expect(store.synchronization).toBe("awaitingRecoverySnapshot");
    expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: true });
    expect(store.synchronization).toBe("replayReady");
    expect(store.finishReplay(1)).toBe(true);
    expect(store.createIntent({ type: "surrender" }).clientCommandSeq).toBe(4);
  });

  it("guards recovery epochs and exposes an explicit sticky failure transition", () => {
    const { base } = snapshots();
    const store = readyStore(base);

    expect(store.beginRecovery(1)).toBe(true);
    expect(store.beginRecovery(1)).toBe(false);
    expect(store.beginRecovery(0)).toBe(false);
    expect(store.beginRecovery(2)).toBe(true);
    expect(store.recoveryEpoch).toBe(2);
    expect(store.failRecovery(1, "stale timer")).toBe(false);
    expect(store.synchronization).toBe("awaitingReconnectHello");
    expect(store.failRecovery(2, "lease expired")).toBe(true);
    expect(store.failureReason).toBe("lease expired");
    expect(store.failRecovery(2, "replacement reason")).toBe(false);
    expect(store.failureReason).toBe("lease expired");
  });

  it("rejects command ID collisions without consuming another sequence", () => {
    const { base } = snapshots();
    const store = new AuthoritativeMatchStore(
      base.matchId,
      base.recipientPlayerId,
      () => "command_collision_01",
    );
    store.acceptHello(hello(base.matchId, base.recipientPlayerId));
    store.applyFrame(snapshotFrame(base));
    const first = store.createIntent({ type: "surrender" });

    expect(() => store.createIntent({ type: "surrender" })).toThrow("Command ID collision");
    expect(store.pendingCommandCount).toBe(1);
    store.applyCommandResult({
      commandId: first.commandId,
      clientCommandSeq: first.clientCommandSeq,
      accepted: true,
      serverTick: base.serverTick,
    });
    expect(() => store.createIntent({ type: "surrender" })).toThrow("Command ID collision");
    expect(store.pendingCommandCount).toBe(0);
  });
});

function hello(matchId: string, playerId: string, nextClientCommandSeq = 0): MatchServerHello {
  return {
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    matchId,
    recipientPlayerId: playerId,
    tickMilliseconds: TICK_MILLISECONDS,
    fullSnapshotIntervalTicks: 50,
    canonicalHashIntervalTicks: 20,
    lastReceivedClientCommandSeq: nextClientCommandSeq - 1,
    nextClientCommandSeq,
  };
}

function readyStore(base: ReturnType<typeof toVisibleSnapshot>): AuthoritativeMatchStore {
  const store = new AuthoritativeMatchStore(base.matchId, base.recipientPlayerId);
  expect(store.acceptHello(hello(base.matchId, base.recipientPlayerId))).toBe(true);
  expect(store.applyFrame(snapshotFrame(base))).toMatchObject({ accepted: true });
  return store;
}

function snapshotFrame(snapshot: ReturnType<typeof toVisibleSnapshot>): MatchSnapshotFrame {
  return {
    kind: "snapshot",
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    matchId: snapshot.matchId,
    recipientPlayerId: snapshot.recipientPlayerId,
    serverTick: snapshot.serverTick,
    events: [],
    snapshot,
  };
}

function deltaFrame(
  base: ReturnType<typeof toVisibleSnapshot>,
  next: ReturnType<typeof toVisibleSnapshot>,
): MatchDeltaFrame {
  return {
    kind: "delta",
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    matchId: next.matchId,
    recipientPlayerId: next.recipientPlayerId,
    serverTick: next.serverTick,
    events: [],
    delta: createVisibleSnapshotDelta(base, next),
  };
}

function snapshots() {
  const state = createInitialState({
    matchId: "client-store-match",
    seed: 19,
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
  const base = toVisibleSnapshot(state, "player-1");
  const ownUnit = state.entities.find((entity) => entity.ownerId === "player-1" && entity.kind === "unit")!;
  ownUnit.position = { x: ownUnit.position.x + 1, y: ownUnit.position.y };
  ownUnit.stateRevision += 1;
  state.tick += 1;
  updateVisibilityState(state);
  return { base, next: toVisibleSnapshot(state, "player-1") };
}

function divergentSnapshotAtSameTick(): ReturnType<typeof toVisibleSnapshot> {
  const state = createInitialState({
    matchId: "client-store-match",
    seed: 19,
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
  const ownUnit = state.entities.find((entity) => entity.ownerId === "player-1" && entity.kind === "unit")!;
  ownUnit.position = { x: ownUnit.position.x + 2, y: ownUnit.position.y };
  ownUnit.stateRevision += 1;
  state.tick += 1;
  updateVisibilityState(state);
  return toVisibleSnapshot(state, "player-1");
}
