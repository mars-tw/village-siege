import { describe, expect, it } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  applyVisibleSnapshotDelta,
  type GameCommand,
  type MatchCommandIntent,
  type MatchReplicationFrame,
  type VisibleSnapshot,
} from "@village-siege/shared";
import {
  AUTHORITY_RECOVERY_CHECKPOINT_INTERVAL_TICKS,
  CANONICAL_HASH_INTERVAL_TICKS,
  FULL_SNAPSHOT_INTERVAL_TICKS,
  MatchAuthority,
  type MatchParticipant,
} from "../src/authority/MatchAuthority.js";

function participants(count = 2): MatchParticipant[] {
  const villages = ["pinehold", "riverstead", "highcrag"] as const;
  return Array.from({ length: count }, (_, index) => ({
    playerId: `player-${index + 1}`,
    teamId: `team-${index + 1}`,
    name: `Player ${index + 1}`,
    villageId: villages[index % villages.length]!,
  }));
}

function initialSnapshot(authority: MatchAuthority, playerId: string): VisibleSnapshot {
  const frame = authority.initialFrames().get(playerId);
  if (!frame || frame.kind !== "snapshot") throw new Error(`Missing initial snapshot for ${playerId}`);
  return frame.snapshot;
}

function ownUnitId(authority: MatchAuthority, playerId: string): string {
  const entity = initialSnapshot(authority, playerId).entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "unit"
  ));
  if (!entity) throw new Error(`Missing visible unit for ${playerId}`);
  return entity.id;
}

function ownTownCenterId(authority: MatchAuthority, playerId: string): string {
  const entity = initialSnapshot(authority, playerId).entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "building" && candidate.typeId === "townCenter"
  ));
  if (!entity) throw new Error(`Missing visible town center for ${playerId}`);
  return entity.id;
}

function intent(
  clientCommandSeq: number,
  command: GameCommand,
  commandId = `command_${clientCommandSeq.toString().padStart(8, "0")}`,
  lastServerTickSeen = 0,
): MatchCommandIntent {
  return {
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    commandId,
    clientCommandSeq,
    lastServerTickSeen,
    command,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function expectStateCorrupt(action: () => unknown, message: RegExp): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "STATE_CORRUPT" });
    expect((error as Error).message).toMatch(message);
    return;
  }
  throw new Error("Expected authority restore to fail-stop with STATE_CORRUPT");
}

describe("MatchAuthority TASK-019 replication and idempotence", () => {
  it.each([2, 3, 4, 5])("creates an isolated fixed-step battlefield for %i factions", (count) => {
    const authority = new MatchAuthority(`match-${count}`, 1701 + count, participants(count));
    const initial = authority.initialFrames();

    expect(initial.size).toBe(count);
    expect(authority.serverTick).toBe(0);
    const result = authority.step();
    expect(result.serverTick).toBe(1);
    expect(result.frames.size).toBe(count);
    for (const participant of participants(count)) {
      const frame = result.frames.get(participant.playerId)!;
      expect(frame.kind).toBe("delta");
      expect(frame.recipientPlayerId).toBe(participant.playerId);
      expect(frame.matchId).toBe(`match-${count}`);
      expect(JSON.stringify(frame)).not.toContain("aiControllers");
      expect(JSON.stringify(frame)).not.toContain("canonicalCheckpoint");
    }
  });

  it("isolates identical command IDs and sequences between players on one result channel", () => {
    const authority = new MatchAuthority("ack-isolation", 42, participants());
    const sharedId = "shared_command_0001";
    expect(authority.submitIntent("player-1", intent(0, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-1")],
    }, sharedId))).toMatchObject({ queued: true });
    expect(authority.submitIntent("player-2", intent(0, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-2")],
    }, sharedId))).toMatchObject({ queued: true });

    const result = authority.step();
    for (const playerId of ["player-1", "player-2"]) {
      expect(result.commandResults.get(playerId)).toEqual([{
        commandId: sharedId,
        clientCommandSeq: 0,
        accepted: true,
        serverTick: 1,
      }]);
      expect(result.frames.get(playerId)!.events.some((event) => event.type.startsWith("command"))).toBe(false);
    }
  });

  it("buffers out-of-order commands and executes them in contiguous sequence order", () => {
    const authority = new MatchAuthority("reorder", 43, participants());
    const unitId = ownUnitId(authority, "player-1");
    expect(authority.submitIntent("player-1", intent(1, {
      type: "setStance",
      entityIds: [unitId],
      stance: "defensive",
    }))).toMatchObject({ queued: true });
    expect(authority.step().commandResults.get("player-1")).toBeUndefined();

    expect(authority.submitIntent("player-1", intent(0, { type: "stop", entityIds: [unitId] }, "command_00000000", 1)))
      .toMatchObject({ queued: true });
    expect(authority.step().commandResults.get("player-1")?.map((result) => result.clientCommandSeq)).toEqual([0, 1]);
  });

  it("deduplicates pending and completed commands and replays the immutable result", () => {
    const authority = new MatchAuthority("dedup", 44, participants());
    const producerId = ownTownCenterId(authority, "player-1");
    const command = intent(0, { type: "train", producerId, unitType: "villager", count: 1 });
    const foodBefore = initialSnapshot(authority, "player-1").wallet.food;

    expect(authority.submitIntent("player-1", command)).toMatchObject({ queued: true, duplicate: false });
    expect(authority.submitIntent("player-1", command)).toMatchObject({ queued: true, duplicate: true });
    const firstResult = authority.step().commandResults.get("player-1")![0]!;
    expect(firstResult.accepted).toBe(true);
    expect(authority.submitIntent("player-1", command)).toEqual({
      queued: false,
      replayed: true,
      result: firstResult,
    });
    expect(initialSnapshot(authority, "player-1").wallet.food).toBe(foodBefore - 50);
  });

  it("rejects command-ID payload collisions and same-sequence different IDs without mutation", () => {
    const authority = new MatchAuthority("collision", 45, participants());
    const unitId = ownUnitId(authority, "player-1");
    const original = intent(0, { type: "stop", entityIds: [unitId] });
    expect(authority.submitIntent("player-1", original)).toMatchObject({ queued: true });
    expect(authority.submitIntent("player-1", {
      ...original,
      command: { type: "setStance", entityIds: [unitId], stance: "defensive" },
    })).toMatchObject({ queued: false, result: { code: "COMMAND_ID_CONFLICT" } });
    expect(authority.submitIntent("player-1", intent(0, { type: "stop", entityIds: [unitId] }, "different_command_01")))
      .toMatchObject({ queued: false, result: { code: "COMMAND_ID_CONFLICT" } });
    expect(authority.step().commandResults.get("player-1")).toHaveLength(1);
  });

  it("replays semantic rejection without revalidating it against a later world", () => {
    const authority = new MatchAuthority("reject-replay", 46, participants());
    const command = intent(0, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-2")],
    });
    authority.submitIntent("player-1", command);
    const rejected = authority.step().commandResults.get("player-1")![0]!;
    expect(rejected).toMatchObject({ accepted: false, code: "ENTITY_NOT_OWNED" });
    authority.step();
    expect(authority.submitIntent("player-1", command)).toEqual({ queued: false, replayed: true, result: rejected });
  });

  it("replicates a terminal surrender on a strictly newer server tick", () => {
    const authority = new MatchAuthority("terminal-revision", 50, participants());
    const base = initialSnapshot(authority, "player-1");
    expect(authority.submitIntent("player-1", intent(0, { type: "surrender" }))).toMatchObject({ queued: true });

    const result = authority.step();
    const frame = result.frames.get("player-1")!;
    expect(result.serverTick).toBe(base.serverTick + 1);
    expect(result.phase).toBe("finished");
    expect(frame.kind).toBe("snapshot");
    if (frame.kind === "snapshot") {
      expect(frame.snapshot.serverTick).toBe(base.serverTick + 1);
      expect(frame.snapshot.victory).toMatchObject({ finishReason: "surrender", finishedAtTick: 1 });
    }
  });

  it("emits tick deltas, five-second snapshots and server-private two-second hashes", () => {
    const authority = new MatchAuthority("cadence", 47, participants());
    let view = initialSnapshot(authority, "player-1");
    const checkpointTicks: number[] = [];

    for (let tick = 1; tick <= FULL_SNAPSHOT_INTERVAL_TICKS + 1; tick += 1) {
      const result = authority.step();
      const frame = result.frames.get("player-1")!;
      if (tick % CANONICAL_HASH_INTERVAL_TICKS === 0) {
        expect(result.canonicalCheckpoint).toMatchObject({ serverTick: tick, algorithm: "fnv1a-32" });
        checkpointTicks.push(tick);
      } else {
        expect(result.canonicalCheckpoint).toBeUndefined();
      }
      expect(JSON.stringify(frame)).not.toContain("canonical");
      if (tick === FULL_SNAPSHOT_INTERVAL_TICKS) {
        expect(frame.kind).toBe("snapshot");
        if (frame.kind === "snapshot") view = frame.snapshot;
      } else {
        expect(frame.kind).toBe("delta");
        if (frame.kind === "delta") view = applyVisibleSnapshotDelta(view, frame.delta);
      }
      expect(view.serverTick).toBe(tick);
    }
    expect(checkpointTicks).toEqual([20, 40]);
  });

  it("classifies version failures, rejects authority-field injection and bounds the reorder window", () => {
    const authority = new MatchAuthority("bounded", 48, participants());
    const unitId = ownUnitId(authority, "player-1");
    expect(authority.submitIntent("player-1", {
      ...intent(0, { type: "stop", entityIds: [unitId] }),
      protocolVersion: "old-protocol",
    })).toMatchObject({ queued: false, result: { code: "PROTOCOL_MISMATCH" } });
    expect(authority.submitIntent("player-1", {
      ...intent(0, { type: "stop", entityIds: [unitId] }),
      playerId: "player-2",
    })).toMatchObject({ queued: false, result: { code: "INVALID_PAYLOAD" } });
    for (let sequence = 0; sequence < 16; sequence += 1) {
      expect(authority.submitIntent("player-1", intent(sequence, {
        type: "stop",
        entityIds: [unitId],
      }))).toMatchObject({ queued: true });
    }
    const retryable = intent(16, { type: "stop", entityIds: [unitId] });
    expect(authority.submitIntent("player-1", retryable))
      .toMatchObject({ queued: false, result: { code: "RATE_LIMITED" } });
    authority.step();
    expect(authority.submitIntent("player-1", retryable)).toMatchObject({ queued: true });
    expect(authority.step().commandResults.get("player-1")).toEqual([
      expect.objectContaining({ commandId: retryable.commandId, clientCommandSeq: 16, accepted: true }),
    ]);
  });

  it("force-resync always returns only the requested recipient's full filtered snapshot", () => {
    const authority = new MatchAuthority("resync", 49, participants());
    authority.initialFrames();
    authority.step();
    const frame: MatchReplicationFrame = authority.forceSnapshotFrame("player-1");
    expect(frame.kind).toBe("snapshot");
    expect(frame.recipientPlayerId).toBe("player-1");
    expect(JSON.stringify(frame)).not.toContain(ownTownCenterId(authority, "player-2"));
  });

  it("restores a checkpoint plus batch-tick journal with immutable result deduplication", () => {
    const authority = new MatchAuthority("recovery-ledger", 901, participants());
    const unitId = ownUnitId(authority, "player-1");
    const acceptedIntent = intent(0, { type: "stop", entityIds: [unitId] }, "recover_command_0001");
    authority.submitIntent("player-1", acceptedIntent);
    const accepted = authority.step().commandResults.get("player-1")![0]!;
    for (let tick = 1; tick < AUTHORITY_RECOVERY_CHECKPOINT_INTERVAL_TICKS + 7; tick += 1) authority.step();

    const persisted = authority.recoveryRecord();
    expect(persisted.checkpoint.state.tick).toBe(AUTHORITY_RECOVERY_CHECKPOINT_INTERVAL_TICKS);
    expect(persisted.journal).toHaveLength(7);
    const restored = MatchAuthority.restore(persisted);

    expect(restored.serverTick).toBe(authority.serverTick);
    expect(restored.recoveryRecord()).toEqual(persisted);
    expect(restored.forceSnapshotFrame("player-1")).toEqual(authority.forceSnapshotFrame("player-1"));
    expect(restored.submitIntent("player-1", acceptedIntent)).toEqual({
      queued: false,
      replayed: true,
      result: accepted,
    });
  });

  it("restores unresolved reorder entries and drains them only after the missing sequence arrives", () => {
    const authority = new MatchAuthority("recovery-reorder", 902, participants());
    const unitId = ownUnitId(authority, "player-1");
    authority.submitIntent("player-1", intent(1, {
      type: "setStance",
      entityIds: [unitId],
      stance: "defensive",
    }, "recover_command_0002"));
    authority.step();
    const restored = MatchAuthority.restore(authority.recoveryRecord());

    expect(restored.submitIntent("player-1", intent(0, {
      type: "stop",
      entityIds: [unitId],
    }, "recover_command_0001", 1))).toMatchObject({ queued: true });
    expect(restored.step().commandResults.get("player-1")?.map((result) => result.clientCommandSeq)).toEqual([0, 1]);
  });

  it("fail-stops when a pending sequence disagrees with its unresolved ledger intent", () => {
    const authority = new MatchAuthority("recovery-sequence-mismatch", 906, participants());
    const queued = intent(1, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-1")],
    }, "recover_mismatch_01");
    authority.submitIntent("player-1", queued);
    const persisted = authority.recoveryRecord();

    expectStateCorrupt(() => MatchAuthority.restore({
      ...persisted,
      pendingCommands: persisted.pendingCommands.map((pending) => ({ ...pending, sequence: 2 })),
    }), /disagrees with its ledger intent/i);
  });

  it("accepts the last sequence in the reorder window and fail-stops at the first sequence beyond it", () => {
    const authority = new MatchAuthority("recovery-window-boundary", 907, participants());
    const unitId = ownUnitId(authority, "player-1");
    authority.submitIntent("player-1", intent(15, {
      type: "stop",
      entityIds: [unitId],
    }, "recover_boundary_15"));
    expect(() => MatchAuthority.restore(authority.recoveryRecord())).not.toThrow();

    const persisted = authority.recoveryRecord();
    const beyondWindow = intent(16, {
      type: "stop",
      entityIds: [unitId],
    }, "recover_boundary_16");
    expectStateCorrupt(() => MatchAuthority.restore({
      ...persisted,
      commandRecords: [{
        playerId: "player-1",
        commandId: beyondWindow.commandId,
        intent: beyondWindow,
        fingerprint: canonicalJson(beyondWindow),
      }],
      pendingCommands: [{
        playerId: "player-1",
        sequence: beyondWindow.clientCommandSeq,
        commandId: beyondWindow.commandId,
      }],
    }), /outside its per-player reorder window/i);
  });

  it("fail-stops when an unresolved ledger entry has no one-to-one pending entry", () => {
    const authority = new MatchAuthority("recovery-orphan-ledger", 908, participants());
    authority.submitIntent("player-1", intent(1, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-1")],
    }, "recover_orphan_001"));
    const persisted = authority.recoveryRecord();

    expectStateCorrupt(() => MatchAuthority.restore({
      ...persisted,
      pendingCommands: [],
    }), /unresolved ledger entry has no pending command/i);

    expectStateCorrupt(() => MatchAuthority.restore({
      ...persisted,
      pendingCommands: [persisted.pendingCommands[0]!, persisted.pendingCommands[0]!],
    }), /unresolved ledger entry has multiple pending commands/i);
  });

  it("restores semantic rejections and never revalidates an acknowledged command", () => {
    const authority = new MatchAuthority("recovery-rejection", 903, participants());
    const rejectedIntent = intent(0, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-2")],
    }, "recover_rejected_01");
    authority.submitIntent("player-1", rejectedIntent);
    const original = authority.step().commandResults.get("player-1")![0]!;
    expect(original).toMatchObject({ accepted: false, code: "ENTITY_NOT_OWNED" });

    const restored = MatchAuthority.restore(authority.recoveryRecord());
    expect(restored.submitIntent("player-1", rejectedIntent)).toEqual({
      queued: false,
      replayed: true,
      result: original,
    });
  });

  it("rejects corrupted checkpoints and journal hashes atomically", () => {
    const authority = new MatchAuthority("recovery-corrupt", 904, participants());
    authority.step();
    const persisted = authority.recoveryRecord();
    expect(() => MatchAuthority.restore({
      ...persisted,
      checkpoint: { ...persisted.checkpoint, stateHash: "00000000" },
    })).toThrow(/checkpoint hash mismatch/i);
    expect(() => MatchAuthority.restore({
      ...persisted,
      journal: persisted.journal.map((entry) => ({ ...entry, stateHash: "00000000" })),
    })).toThrow(/journal diverged/i);
  });

  it("publishes simultaneous lease expiries once on a newer recoverable revision", () => {
    const authority = new MatchAuthority("recovery-expiry", 905, participants(3));
    const result = authority.expireDisconnectedTeams(["team-3", "team-2", "team-3"]);
    expect(result.serverTick).toBe(1);
    expect(result.phase).toBe("finished");
    expect(result.frames.get("player-1")).toMatchObject({
      kind: "snapshot",
      snapshot: {
        victory: { outcome: "victory", winningTeamIds: ["team-1"], finishReason: "disconnect" },
      },
    });
    const restored = MatchAuthority.restore(authority.recoveryRecord());
    expect(restored.forceSnapshotFrame("player-1")).toEqual(authority.forceSnapshotFrame("player-1"));
  });
});
