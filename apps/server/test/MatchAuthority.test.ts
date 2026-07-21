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
});
