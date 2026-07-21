import { describe, expect, it } from "vitest";
import { MatchAuthority, type MatchParticipant } from "../src/authority/MatchAuthority.js";

function participants(count = 2): MatchParticipant[] {
  const villages = ["pinehold", "riverstead", "highcrag"] as const;
  return Array.from({ length: count }, (_, index) => ({
    playerId: `player-${index + 1}`,
    teamId: `team-${index + 1}`,
    name: `Player ${index + 1}`,
    villageId: villages[index % villages.length]!,
  }));
}

function ownUnitId(authority: MatchAuthority, playerId: string): string {
  const entity = authority.initialFrames().get(playerId)?.snapshot.entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "unit"
  ));
  if (!entity) throw new Error(`Missing visible unit for ${playerId}`);
  return entity.id;
}

function ownTownCenterId(authority: MatchAuthority, playerId: string): string {
  const entity = authority.initialFrames().get(playerId)?.snapshot.entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "building" && candidate.typeId === "townCenter"
  ));
  if (!entity) throw new Error(`Missing visible town center for ${playerId}`);
  return entity.id;
}

describe("MatchAuthority", () => {
  it.each([2, 3, 4, 5])("creates a fixed-step authoritative battlefield for %i factions", (count) => {
    const authority = new MatchAuthority(`match-${count}`, 1701 + count, participants(count));
    const initial = authority.initialFrames();

    expect(initial.size).toBe(count);
    expect(authority.serverTick).toBe(0);
    const result = authority.step();
    expect(result.serverTick).toBe(1);
    expect(result.frames.size).toBe(count);
    for (const participant of participants(count)) {
      const snapshot = result.frames.get(participant.playerId)?.snapshot;
      expect(snapshot?.recipientPlayerId).toBe(participant.playerId);
      expect(snapshot?.matchId).toBe(`match-${count}`);
      expect(snapshot).not.toHaveProperty("aiControllers");
      expect(snapshot).not.toHaveProperty("players");
    }
  });

  it("isolates acknowledgements when two players use the same sequence", () => {
    const authority = new MatchAuthority("ack-isolation", 42, participants());
    expect(authority.submitIntent("player-1", {
      sequence: 0,
      clientTick: 0,
      command: { type: "stop", entityIds: [ownUnitId(authority, "player-1")] },
    })).toMatchObject({ queued: true });
    expect(authority.submitIntent("player-2", {
      sequence: 0,
      clientTick: 0,
      command: { type: "stop", entityIds: [ownUnitId(authority, "player-2")] },
    })).toMatchObject({ queued: true });

    const result = authority.step();
    for (const playerId of ["player-1", "player-2"]) {
      const frame = result.frames.get(playerId)!;
      expect(frame.commandResults).toEqual([{ accepted: true, sequence: 0, serverTick: 1 }]);
      expect(frame.events.filter((event) => event.type === "commandAccepted")).toHaveLength(1);
    }
  });

  it("constructs ownership server-side and rejects forged entity control", () => {
    const authority = new MatchAuthority("ownership", 43, participants());
    const victimId = ownUnitId(authority, "player-2");
    expect(authority.submitIntent("player-1", {
      sequence: 0,
      clientTick: 0,
      command: { type: "stop", entityIds: [victimId] },
    })).toMatchObject({ queued: true });

    const frame = authority.step().frames.get("player-1")!;
    expect(frame.commandResults).toEqual([{
      accepted: false,
      sequence: 0,
      code: "ENTITY_NOT_OWNED",
      serverTick: 1,
    }]);
  });

  it("never reopens a received sequence after a same-tick semantic rejection", () => {
    const authority = new MatchAuthority("monotonic-received", 44, participants());
    const producerId = ownTownCenterId(authority, "player-1");
    expect(authority.submitIntent("player-1", {
      sequence: 1,
      clientTick: 0,
      command: { type: "train", producerId, unitType: "villager", count: 5 },
    })).toMatchObject({ queued: true });
    expect(authority.submitIntent("player-1", {
      sequence: 2,
      clientTick: 0,
      command: { type: "train", producerId, unitType: "villager", count: 3 },
    })).toMatchObject({ queued: true });

    const results = authority.step().frames.get("player-1")!.commandResults;
    expect(results[0]).toMatchObject({ accepted: true, sequence: 1 });
    expect(results[1]).toMatchObject({ accepted: false, sequence: 2 });
    expect(authority.submitIntent("player-1", {
      sequence: 2,
      clientTick: 1,
      command: { type: "stop", entityIds: [ownUnitId(authority, "player-1")] },
    })).toEqual({ queued: false, sequence: 2, code: "STALE_OR_DUPLICATE_SEQUENCE" });
  });

  it("rejects strict payload extras and bounds each player's next-tick queue", () => {
    const authority = new MatchAuthority("bounded", 45, participants());
    const unitId = ownUnitId(authority, "player-1");
    expect(authority.submitIntent("player-1", {
      sequence: 0,
      clientTick: 0,
      command: { type: "stop", entityIds: [unitId] },
      playerId: "player-2",
    })).toEqual({ queued: false, sequence: 0, code: "INVALID_PAYLOAD" });

    for (let sequence = 0; sequence < 16; sequence += 1) {
      expect(authority.submitIntent("player-1", {
        sequence,
        clientTick: 0,
        command: { type: "stop", entityIds: [unitId] },
      })).toMatchObject({ queued: true });
    }
    expect(authority.submitIntent("player-1", {
      sequence: 16,
      clientTick: 0,
      command: { type: "stop", entityIds: [unitId] },
    })).toEqual({ queued: false, sequence: 16, code: "RATE_LIMITED" });
  });
});
