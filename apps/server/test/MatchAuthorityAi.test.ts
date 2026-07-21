import { describe, expect, it } from "vitest";
import {
  applyVisibleSnapshotDelta,
  cloneMatchState,
  hashMatchState,
  stepSimulation,
  type CommandEnvelope,
  type MatchReplicationFrame,
  type MatchState,
  type VisibleSnapshot,
} from "@village-siege/shared";
import {
  MatchAuthority,
  rollbackRejectedAiAuthorities,
  type MatchParticipant,
} from "../src/authority/MatchAuthority.js";

const FIVE_FACTION_ROSTER: readonly MatchParticipant[] = [
  { playerId: "human-west", teamId: "team-west", name: "West", villageId: "pinehold" },
  { playerId: "human-east", teamId: "team-east", name: "East", villageId: "riverstead" },
  {
    playerId: "ai-guardian",
    teamId: "team-highcrag",
    name: "Highcrag AI",
    villageId: "highcrag",
    ai: { personality: "guardian", difficulty: "standard" },
  },
  {
    playerId: "ai-prosperer",
    teamId: "team-marshwatch",
    name: "Marshwatch AI",
    villageId: "pinehold",
    ai: { personality: "prosperer", difficulty: "veteran" },
  },
  {
    playerId: "ai-raider",
    teamId: "team-sunfield",
    name: "Sunfield AI",
    villageId: "riverstead",
    ai: { personality: "raider", difficulty: "novice" },
  },
];

const NETWORK_PLAYER_IDS = ["human-west", "human-east"] as const;
/** Just over one simulated minute at the authoritative 10 Hz tick rate. */
const LONG_RUN_TICKS = 600;

describe("MatchAuthority TASK-022 five-faction AI soak", () => {
  it("rolls back a rejected AI planner transition to the same post-tick hash", () => {
    const authority = new MatchAuthority("ai-rejection-rollback", 220_704, FIVE_FACTION_ROSTER);
    const internals = authority as unknown as {
      state: MatchState;
    };
    const beforePlanning = cloneMatchState(internals.state);
    const plannedState = cloneMatchState(beforePlanning);
    const plannedController = plannedState.aiControllers.find((controller) => controller.playerId === "ai-guardian");
    if (!plannedController) throw new Error("Missing AI controller");
    plannedController.telemetry.decisions += 1;
    plannedController.lastDecisionTick = plannedState.tick;
    const rejectedCommand: CommandEnvelope = {
      matchId: plannedState.matchId,
      playerId: "ai-guardian",
      sequence: 0,
      clientTick: plannedState.tick,
      command: { type: "stop", entityIds: ["missing-ai-entity"] },
    };
    const stepped = stepSimulation(plannedState, [rejectedCommand], 1);
    expect(stepped.events).toContainEqual(expect.objectContaining({ type: "commandRejected" }));

    rollbackRejectedAiAuthorities(
      beforePlanning,
      stepped.state,
      [rejectedCommand],
      stepped.events,
      FIVE_FACTION_ROSTER,
    );

    expect(stepped.state.aiControllers.find((controller) => controller.playerId === "ai-guardian"))
      .toEqual(beforePlanning.aiControllers.find((controller) => controller.playerId === "ai-guardian"));
    const expected = stepSimulation(beforePlanning, [rejectedCommand], 1);
    expect(hashMatchState(stepped.state)).toBe(hashMatchState(expected.state));
  });

  it("fail-stops recovery when a recorded AI command differs from deterministic replanning", () => {
    const authority = new MatchAuthority("ai-recovery-tamper", 220_706, FIVE_FACTION_ROSTER);
    authority.step();
    const record = authority.recoveryRecord();
    const operation = record.journal[0];
    if (!operation || operation.kind !== "simulation") throw new Error("Expected a simulation recovery operation");
    expect(operation.commands.some((command) => command.playerId.startsWith("ai-"))).toBe(true);

    expect(() => MatchAuthority.restore({
      ...record,
      journal: [{
        ...operation,
        commands: operation.commands.filter((command) => !command.playerId.startsWith("ai-")),
      }],
    })).toThrow(/AI command batch diverged/i);
  });

  it("keeps two recipient streams synchronized while three real AIs reach a deterministic recoverable final hash", () => {
    const first = runSoak("five-faction-ai-soak", 220_705, true);

    expect(first.authority.serverTick).toBe(LONG_RUN_TICKS);
    expect(first.snapshotFrames).toBe(NETWORK_PLAYER_IDS.length * Math.floor(LONG_RUN_TICKS / 50));
    expect(first.deltaFrames).toBe(NETWORK_PLAYER_IDS.length * (LONG_RUN_TICKS - Math.floor(LONG_RUN_TICKS / 50)));
    expect(first.finalHash).toMatch(/^[0-9a-f]{8}$/);

    const record = first.authority.recoveryRecord();
    expect(record.checkpoint.state.tick).toBe(600);
    expect(record.journal).toHaveLength(0);
    expect(record.checkpoint.state.aiControllers).toHaveLength(3);
    expect(record.checkpoint.state.aiControllers.every((controller) => controller.telemetry.decisions > 0)).toBe(true);
    for (const player of record.checkpoint.state.players.filter((candidate) => candidate.id.startsWith("ai-"))) {
      const issued = first.aiCommandsIssued.get(player.id) ?? 0;
      expect(issued).toBeGreaterThan(0);
      // Every self-issued AI envelope must advance the canonical sequence. If
      // even one were rejected, issued would exceed lastSequence + 1.
      expect(issued).toBe(player.lastSequence + 1);
    }

    const restored = MatchAuthority.restore(record);
    expect(restored.serverTick).toBe(first.authority.serverTick);
    expect(restored.recoveryRecord()).toEqual(record);
    for (const playerId of NETWORK_PLAYER_IDS) {
      expect(restored.forceSnapshotFrame(playerId)).toEqual(first.authority.forceSnapshotFrame(playerId));
    }

    const secondRestore = MatchAuthority.restore(structuredClone(record));
    expect(secondRestore.recoveryRecord()).toEqual(restored.recoveryRecord());
    expect(finalHashOf(secondRestore)).toBe(first.finalHash);
  }, 90_000);
});

function runSoak(matchId: string, seed: number, trackRecipients: boolean): {
  readonly authority: MatchAuthority;
  readonly finalHash: string;
  readonly snapshotFrames: number;
  readonly deltaFrames: number;
  readonly aiCommandsIssued: ReadonlyMap<string, number>;
} {
  const authority = new MatchAuthority(matchId, seed, FIVE_FACTION_ROSTER);
  const initialFrames = authority.initialFrames();
  expect([...initialFrames.keys()].sort()).toEqual([...NETWORK_PLAYER_IDS].sort());
  expect(authority.hasPlayer("ai-guardian")).toBe(false);
  expect(authority.submitIntent("ai-guardian", {})).toMatchObject({
    queued: false,
    result: { code: "NOT_ROOM_MEMBER" },
  });

  const recipientViews = new Map<string, VisibleSnapshot>();
  for (const playerId of NETWORK_PLAYER_IDS) recipientViews.set(playerId, snapshotOf(initialFrames.get(playerId)!));
  let snapshotFrames = 0;
  let deltaFrames = 0;
  const aiCommandsIssued = new Map<string, number>();

  for (let tick = 1; tick <= LONG_RUN_TICKS; tick += 1) {
    const result = authority.step();
    if (result.serverTick !== tick) throw new Error(`Authority tick diverged at ${tick}`);
    if (result.frames.size !== NETWORK_PLAYER_IDS.length) throw new Error(`Network frame count diverged at ${tick}`);
    if (!trackRecipients) continue;

    for (const playerId of NETWORK_PLAYER_IDS) {
      const frame = result.frames.get(playerId)!;
      const previous = recipientViews.get(playerId)!;
      const next = frame.kind === "snapshot"
        ? frame.snapshot
        : applyVisibleSnapshotDelta(previous, frame.delta);
      if (frame.kind === "snapshot") snapshotFrames += 1;
      else deltaFrames += 1;
      expect(next.serverTick).toBe(tick);
      expect(next.recipientPlayerId).toBe(playerId);
      recipientViews.set(playerId, next);
    }
    // Capture each complete 20-tick recovery window immediately before the
    // authority rolls it into a checkpoint. AI cadences (10/20/40 ticks)
    // issue on 1/11/21... rather than checkpoint ticks, so these windows cover
    // every real AI envelope without retaining an unbounded soak journal.
    if (tick % 20 === 19) {
      for (const operation of authority.recoveryRecord().journal) {
        if (operation.kind !== "simulation") continue;
        for (const command of operation.commands.filter((candidate) => candidate.playerId.startsWith("ai-"))) {
          aiCommandsIssued.set(command.playerId, (aiCommandsIssued.get(command.playerId) ?? 0) + 1);
        }
      }
    }
  }

  if (trackRecipients) {
    for (const playerId of NETWORK_PLAYER_IDS) {
      const finalFrame = authority.forceSnapshotFrame(playerId);
      expect(recipientViews.get(playerId)).toEqual(snapshotOf(finalFrame));
      expect(JSON.stringify(finalFrame)).not.toContain("aiControllers");
      expect(JSON.stringify(finalFrame)).not.toContain("personality");
    }
  }

  const record = authority.recoveryRecord();
  const finalHash = finalHashOf(authority);
  return { authority, finalHash, snapshotFrames, deltaFrames, aiCommandsIssued };
}

function finalHashOf(authority: MatchAuthority): string {
  const record = authority.recoveryRecord();
  return record.journal.at(-1)?.stateHash ?? record.checkpoint.stateHash;
}

function snapshotOf(frame: MatchReplicationFrame): VisibleSnapshot {
  if (frame.kind !== "snapshot") throw new Error("Expected a full recipient snapshot");
  return frame.snapshot;
}
