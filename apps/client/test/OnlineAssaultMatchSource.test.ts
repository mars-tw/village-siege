import { describe, expect, it, vi } from "vitest";
import {
  createInitialState,
  toVisibleSnapshot,
  updateVisibilityState,
  type GameCommand,
  type MatchCommandResult,
  type MatchState,
  type ReplicatedWorldEvent,
  type VisibleSnapshot,
} from "@village-siege/shared";
import type { ConnectionState, MatchFrame } from "../src/network/MultiplayerClient.js";
import {
  OnlineAssaultMatchSource,
  type OnlineAssaultTransport,
} from "../src/match/OnlineAssaultMatchSource.js";

describe("OnlineAssaultMatchSource", () => {
  it("updates authoritative state only from frames, never from commands, results or local time", () => {
    const clock = { now: 0 };
    const transport = fakeTransport("connected");
    const source = new OnlineAssaultMatchSource(transport, { now: () => clock.now });
    const { base, committed } = authoritativeSnapshots();
    transport.emitFrame(frame("snapshot", base));
    const baseline = JSON.stringify(source.current);

    const commands: GameCommand[] = [
      { type: "train", producerId: "producer", unitType: "warrior", count: 1 },
      { type: "attack", entityIds: ["attacker"], targetId: "target" },
      { type: "build", builderIds: ["builder"], buildingType: "house", origin: { x: 7, y: 7 }, orientation: "ne" },
      { type: "surrender" },
    ];
    commands.forEach((command) => source.submitCommand(command));
    expect(transport.submitCommand).toHaveBeenCalledTimes(commands.length);

    for (let index = 0; index < commands.length; index += 1) {
      transport.emitCommandResult({
        commandId: `command-${index}`,
        clientCommandSeq: index,
        accepted: true,
        serverTick: base.serverTick,
      });
    }
    clock.now = 10_000;
    source.samplePresentation();
    expect(JSON.stringify(source.current)).toBe(baseline);

    transport.emitFrame(frame("delta", committed));
    expect(source.current).toEqual(committed);
    expect(source.current).not.toEqual(base);
  });

  it("freezes command submission whenever the connection is not connected", () => {
    const transport = fakeTransport("connected");
    const source = new OnlineAssaultMatchSource(transport, { now: () => 0 });
    expect(() => source.submitCommand({ type: "surrender" })).toThrow("first authoritative frame");
    transport.emitFrame(frame("snapshot", authoritativeSnapshots().base));
    source.submitCommand({ type: "surrender" });
    expect(transport.submitCommand).toHaveBeenCalledOnce();

    for (const state of [
      "transportReconnecting",
      "recoveringHello",
      "recoveringSnapshot",
      "replayingCommands",
      "failed",
      "offline",
    ] satisfies ConnectionState[]) {
      transport.emitConnection(state);
      expect(() => source.submitCommand({ type: "surrender" })).toThrow("commands are frozen");
    }
    expect(transport.submitCommand).toHaveBeenCalledOnce();

    transport.emitConnection("connected");
    source.submitCommand({ type: "surrender" });
    expect(transport.submitCommand).toHaveBeenCalledTimes(2);
  });

  it("exposes cloned frame/events, current player identity and the current numbered-team contract", () => {
    const transport = fakeTransport("connected");
    const source = new OnlineAssaultMatchSource(transport, { now: () => 0 });
    const snapshots = authoritativeSnapshots();
    const target = snapshots.base.entities.find((entity) => entity.ownerId === "player-2")!;
    const events: readonly ReplicatedWorldEvent[] = [{
      type: "entityDamaged",
      sourceId: null,
      targetId: target.id,
      amount: 7,
      hitPoints: target.hitPoints - 7,
    }];
    const delivered: unknown[] = [];
    source.onFrame((received) => delivered.push(received));
    transport.emitFrame({ ...frame("snapshot", snapshots.base), events });

    expect(source.playerId).toBe("player-1");
    expect(source.teamId).toBe("team-1");
    expect(source.latestEvents).toEqual(events);
    expect(delivered).toHaveLength(1);

    const consumerCopy = source.current as { wallet: { food: number } };
    consumerCopy.wallet.food = -1;
    const consumerEvents = source.latestEvents as { amount: number }[];
    consumerEvents[0]!.amount = 999;
    expect(source.current?.wallet.food).toBe(snapshots.base.wallet.food);
    expect(source.latestEvents).toEqual(events);

    const replayed: unknown[] = [];
    source.onFrame((received) => replayed.push(received));
    expect(replayed).toHaveLength(1);
  });

  it("forwards command results without mutating the snapshot", () => {
    const transport = fakeTransport("connected");
    const source = new OnlineAssaultMatchSource(transport, { now: () => 0 });
    const { base } = authoritativeSnapshots();
    transport.emitFrame(frame("snapshot", base));
    const before = source.current;
    const received: MatchCommandResult[] = [];
    source.onCommandResult((result) => received.push(result));
    const rejected: MatchCommandResult = {
      commandId: "command-rejected",
      clientCommandSeq: 3,
      accepted: false,
      code: "INSUFFICIENT_RESOURCES",
      serverTick: base.serverTick,
    };

    transport.emitCommandResult(rejected);
    expect(received).toEqual([rejected]);
    expect(source.current).toEqual(before);
  });

  it("freezes interpolation on recovery and resets on the authoritative recovery snapshot", () => {
    const clock = { now: 0 };
    const transport = fakeTransport("connected");
    const source = new OnlineAssaultMatchSource(transport, { now: () => clock.now });
    const { base, committed, movingEntityId } = authoritativeSnapshots();
    transport.emitFrame(frame("snapshot", base));
    clock.now = 100;
    transport.emitFrame(frame("delta", committed));
    clock.now = 150;
    expect(source.samplePresentation()?.alpha).toBe(0.5);

    transport.emitConnection("recoveringSnapshot");
    expect(source.samplePresentation()?.alpha).toBe(1);
    expect(position(source.samplePresentation()!.entityPositions, movingEntityId)).toEqual(
      committed.entities.find((entity) => entity.id === movingEntityId)?.position,
    );

    clock.now = 200;
    transport.emitFrame(frame("snapshot", committed));
    expect(source.samplePresentation()?.alpha).toBe(1);
  });

  it("unsubscribes on dispose and delegates leave to MultiplayerClient", async () => {
    const transport = fakeTransport("connected");
    const source = new OnlineAssaultMatchSource(transport, { now: () => 0 });
    const frames: unknown[] = [];
    source.onFrame((frame) => frames.push(frame));

    await source.leave();
    expect(transport.leave).toHaveBeenCalledOnce();
    source.dispose();
    transport.emitFrame(frame("snapshot", authoritativeSnapshots().base));
    expect(frames).toEqual([]);
    expect(source.current).toBeUndefined();
    expect(() => source.submitCommand({ type: "surrender" })).toThrow("disposed");
  });

  it("can seed the scene from a lobby handoff firstFrame before later client frames", () => {
    const transport = fakeTransport("connected");
    const { base, committed } = authoritativeSnapshots();
    const source = new OnlineAssaultMatchSource(transport, {
      firstFrame: frame("snapshot", base),
      now: () => 0,
    });

    expect(source.current).toEqual(base);
    expect(source.playerId).toBe(base.recipientPlayerId);
    transport.emitFrame(frame("delta", committed));
    expect(source.current).toEqual(committed);
  });
});

function authoritativeSnapshots() {
  const state = createState();
  const moving = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
  const target = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
  target.position = { x: moving.position.x + 2, y: moving.position.y };
  updateVisibilityState(state);
  const base = toVisibleSnapshot(state, "player-1");

  state.players[0]!.resources.food -= 50;
  moving.position = { x: moving.position.x + 1, y: moving.position.y };
  moving.stateRevision += 1;
  target.hitPoints -= 9;
  target.stateRevision += 1;
  state.tick += 1;
  state.phase = "finished";
  state.victory = {
    ...state.victory,
    outcome: "victory",
    winningTeamIds: ["team-2"],
    finishReason: "surrender",
    triggeredReasons: ["surrender"],
    finishedAtTick: state.tick,
  };
  updateVisibilityState(state);
  const committed = toVisibleSnapshot(state, "player-1");
  return { base, committed, movingEntityId: moving.id };
}

function createState(): MatchState {
  return createInitialState({
    matchId: "match-22222222222222222222222222222222",
    seed: 62,
    map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
    players: [
      { id: "player-1", teamId: "team-1", villageId: "pinehold" },
      { id: "player-2", teamId: "team-2", villageId: "riverstead" },
    ],
    spawnOverrides: {
      "player-1": { x: 3, y: 4 },
      "player-2": { x: 14, y: 11 },
    },
  });
}

function frame(kind: MatchFrame["kind"], snapshot: VisibleSnapshot): MatchFrame {
  return { kind, snapshot, events: [] };
}

function fakeTransport(initialConnection: ConnectionState) {
  const connectionListeners = new Set<(state: ConnectionState) => void>();
  const frameListeners = new Set<(frame: MatchFrame) => void>();
  const commandResultListeners = new Set<(result: MatchCommandResult) => void>();
  let connection = initialConnection;
  let commandSequence = 0;
  const transport = {
    onConnection(listener: (state: ConnectionState) => void) {
      connectionListeners.add(listener);
      listener(connection);
      return () => connectionListeners.delete(listener);
    },
    onMatchFrame(listener: (frame: MatchFrame) => void) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    onCommandResult(listener: (result: MatchCommandResult) => void) {
      commandResultListeners.add(listener);
      return () => commandResultListeners.delete(listener);
    },
    submitCommand: vi.fn((_command: GameCommand) => ({
      commandId: `command-${commandSequence}`,
      clientCommandSeq: commandSequence++,
    })),
    leave: vi.fn(async () => undefined),
    emitConnection(state: ConnectionState) {
      connection = state;
      connectionListeners.forEach((listener) => listener(state));
    },
    emitFrame(authoritativeFrame: MatchFrame) {
      frameListeners.forEach((listener) => listener(authoritativeFrame));
    },
    emitCommandResult(result: MatchCommandResult) {
      commandResultListeners.forEach((listener) => listener(result));
    },
  } satisfies OnlineAssaultTransport & {
    emitConnection(state: ConnectionState): void;
    emitFrame(frame: MatchFrame): void;
    emitCommandResult(result: MatchCommandResult): void;
  };
  return transport;
}

function position(items: readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number } }[], id: string) {
  return items.find((candidate) => candidate.id === id)?.position;
}
