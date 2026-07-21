import { describe, expect, it, vi } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  TICK_MILLISECONDS,
  createInitialState,
  toVisibleSnapshot,
  type MatchCommandIntent,
  type MatchLifecycleMessage,
  type MatchServerHello,
  type MatchSnapshotFrame,
  type VisibleSnapshot,
} from "@village-siege/shared";
import { MultiplayerClient } from "../src/network/MultiplayerClient.js";

const MATCH_ID = "match-0123456789abcdef0123456789abcdef";
const SECOND_MATCH_ID = "match-fedcba9876543210fedcba9876543210";

describe("MultiplayerClient lifecycle", () => {
  it("closes a delayed match room when leave cancels the seat handoff", async () => {
    const reservation = deferred<unknown>();
    const lobby = fakeLobbyRoom();
    const match = fakeMatchRoom();
    const transport = {
      create: vi.fn(async () => lobby.room),
      join: vi.fn(async () => lobby.room),
      consumeSeatReservation: vi.fn(() => reservation.promise),
    };
    const client = new MultiplayerClient(transport as never);
    const connectionStates: string[] = [];
    client.onConnection((state) => connectionStates.push(state));

    await client.joinRoom("ABC234", "Tester", "pinehold");
    lobby.deliver("lobby.matchAssigned", assignment());
    await Promise.resolve();
    expect(transport.consumeSeatReservation).toHaveBeenCalledOnce();

    await client.leave();
    reservation.resolve(match.room);
    await flushPromises();

    expect(match.leave).toHaveBeenCalledWith(true);
    expect(connectionStates.at(-1)).toBe("offline");
    expect(() => client.submitCommand({ type: "surrender" })).toThrow("連線尚未同步");
  });

  it("does not let an old delayed lobby connection replace a newer connection", async () => {
    const oldConnection = deferred<unknown>();
    const oldLobby = fakeLobbyRoom("ABC234");
    const currentLobby = fakeLobbyRoom("DEF234");
    const transport = {
      create: vi.fn(async () => currentLobby.room),
      join: vi.fn()
        .mockImplementationOnce(() => oldConnection.promise)
        .mockImplementationOnce(async () => currentLobby.room),
      consumeSeatReservation: vi.fn(),
    };
    const client = new MultiplayerClient(transport as never);
    const first = client.joinRoom("ABC234", "Tester", "pinehold");
    await vi.waitFor(() => expect(transport.join).toHaveBeenCalledTimes(1));
    const second = client.joinRoom("DEF234", "Tester", "pinehold");
    await second;

    oldConnection.resolve(oldLobby.room);
    await first;

    expect(oldLobby.leave).toHaveBeenCalledWith(true);
    expect(currentLobby.leave).not.toHaveBeenCalled();
    client.setReady(true);
    expect(currentLobby.send).toHaveBeenCalledWith("lobby.ready", { ready: true });
  });

  it("freezes commands on drop and renegotiates hello only after transport reconnect", async () => {
    const harness = await connectedMatchHarness();
    harness.match.send.mockClear();

    harness.match.triggerDrop(1006, "network lost");
    expect(harness.connectionStates.at(-1)).toBe("transportReconnecting");
    expect(() => harness.client.submitCommand({ type: "surrender" })).toThrow("連線尚未同步");
    expect(harness.match.send).not.toHaveBeenCalledWith("match.hello", expect.anything());

    harness.match.triggerReconnect();
    expect(harness.connectionStates.at(-1)).toBe("recoveringHello");
    expect(harness.match.send).toHaveBeenLastCalledWith("match.hello", versionOffer());
    await harness.client.leave();
  });

  it("waits for lifecycle, reconnect hello and a full snapshot before replaying pending intents in sequence", async () => {
    const harness = await connectedMatchHarness();
    const first = harness.client.submitCommand({ type: "surrender" });
    const second = harness.client.submitCommand({ type: "surrender" });
    const originals = sentCommandIntents(harness.match).slice(-2);
    expect(originals.map((intent) => intent.clientCommandSeq)).toEqual([first.clientCommandSeq, second.clientCommandSeq]);
    harness.match.send.mockClear();

    harness.match.triggerDrop();
    harness.match.triggerReconnect();
    harness.match.deliver("match.lifecycle", lifecycle("recovering", 1, MATCH_ID));
    harness.match.deliver("match.lifecycle", lifecycle("resumed", 1, MATCH_ID));
    harness.match.deliver("match.hello", serverHello(MATCH_ID, 0));
    expect(harness.connectionStates.at(-1)).toBe("recoveringSnapshot");
    expect(sentCommandIntents(harness.match)).toEqual([]);

    harness.match.deliver("match.frame", snapshotFrame(harness.next));
    expect(harness.connectionStates).toContain("replayingCommands");
    expect(harness.connectionStates.at(-1)).toBe("connected");
    expect(sentCommandIntents(harness.match)).toEqual(originals);
    await harness.client.leave();
  });

  it("completes recovery when the authoritative full snapshot is unchanged at the same tick", async () => {
    const harness = await connectedMatchHarness();
    harness.match.send.mockClear();

    harness.match.triggerDrop();
    harness.match.triggerReconnect();
    harness.match.deliver("match.lifecycle", lifecycle("recovering", 1, MATCH_ID));
    harness.match.deliver("match.lifecycle", lifecycle("resumed", 1, MATCH_ID));
    harness.match.deliver("match.hello", serverHello(MATCH_ID, 0));
    harness.match.deliver("match.frame", snapshotFrame(harness.base));

    expect(harness.connectionStates).toContain("replayingCommands");
    expect(harness.connectionStates.at(-1)).toBe("connected");
    await harness.client.leave();
  });

  it("replays a command the server never received when drop wins the send race", async () => {
    const harness = await connectedMatchHarness();
    const submitted = harness.client.submitCommand({ type: "surrender" });
    const original = sentCommandIntents(harness.match).at(-1)!;
    harness.match.send.mockClear();

    harness.match.triggerDrop();
    harness.match.triggerReconnect();
    harness.match.deliver("match.lifecycle", lifecycle("recovering", 1, MATCH_ID));
    harness.match.deliver("match.lifecycle", lifecycle("resumed", 1, MATCH_ID));
    harness.match.deliver("match.hello", serverHello(MATCH_ID, 0));
    harness.match.deliver("match.frame", snapshotFrame(harness.next));

    expect(sentCommandIntents(harness.match)).toEqual([original]);
    expect(original).toMatchObject(submitted);
    await harness.client.leave();
  });

  it("replays an ack-lost command below serverNext and notifies a duplicate result only once", async () => {
    const harness = await connectedMatchHarness();
    const results: unknown[] = [];
    harness.client.onCommandResult((result) => results.push(result));
    const submitted = harness.client.submitCommand({ type: "surrender" });
    const original = sentCommandIntents(harness.match).at(-1)!;
    harness.match.send.mockClear();

    harness.match.triggerDrop();
    harness.match.triggerReconnect();
    harness.match.deliver("match.lifecycle", lifecycle("recovering", 1, MATCH_ID));
    harness.match.deliver("match.lifecycle", lifecycle("resumed", 1, MATCH_ID));
    harness.match.deliver("match.hello", serverHello(MATCH_ID, 1));
    harness.match.deliver("match.frame", snapshotFrame(harness.next));
    expect(sentCommandIntents(harness.match)).toEqual([original]);

    const result = {
      commandId: submitted.commandId,
      clientCommandSeq: submitted.clientCommandSeq,
      accepted: true as const,
      serverTick: harness.next.serverTick,
    };
    harness.match.deliver("match.commandResult", result);
    harness.match.deliver("match.commandResult", result);
    expect(results).toEqual([result]);
    await harness.client.leave();
  });

  it("fails exactly at the 120000 ms recovery deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    try {
      const harness = await connectedMatchHarness();
      const errors: string[] = [];
      harness.client.onError((message) => errors.push(message));

      harness.match.triggerDrop();
      await vi.advanceTimersByTimeAsync(119_999);
      expect(harness.connectionStates.at(-1)).toBe("transportReconnecting");
      expect(errors).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(harness.connectionStates.at(-1)).toBe("failed");
      expect(errors).toEqual(["RECONNECT_LEASE_EXPIRED"]);
      await harness.client.leave();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an explicit server failure terminal even when a later frame was already in flight", async () => {
    const harness = await connectedMatchHarness();
    const errors: string[] = [];
    harness.client.onError((message) => errors.push(message));

    harness.match.deliver("match.lifecycle", failedLifecycle(0, MATCH_ID, "PERSISTENCE_UNAVAILABLE"));
    expect(harness.connectionStates.at(-1)).toBe("failed");
    expect(errors).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    harness.match.deliver("match.frame", snapshotFrame(harness.next));

    expect(harness.connectionStates.at(-1)).toBe("failed");
    expect(() => harness.client.submitCommand({ type: "surrender" })).toThrow("連線尚未同步");
    await harness.client.leave();
  });

  it("ignores delayed reconnect and hello callbacks after the same room has failed terminally", async () => {
    const harness = await connectedMatchHarness();
    const errors: string[] = [];
    harness.client.onError((message) => errors.push(message));
    harness.match.deliver("match.lifecycle", failedLifecycle(0, MATCH_ID, "PERSISTENCE_UNAVAILABLE"));
    expect(harness.connectionStates.at(-1)).toBe("failed");
    expect(errors).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    harness.match.send.mockClear();
    harness.match.leave.mockClear();
    const statesAtFailure = [...harness.connectionStates];

    harness.match.triggerReconnect();
    harness.match.deliver("match.hello", {});
    await flushPromises();

    expect(harness.connectionStates).toEqual(statesAtFailure);
    expect(harness.connectionStates.at(-1)).toBe("failed");
    expect(errors).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    expect(harness.match.send).not.toHaveBeenCalledWith("match.hello", expect.anything());
    expect(harness.match.leave).not.toHaveBeenCalled();
    expect(() => harness.client.submitCommand({ type: "surrender" })).toThrow("連線尚未同步");
    await harness.client.leave();
  });

  it("turns exhausted transport recovery into an explicit sticky server-unavailable outcome", async () => {
    const harness = await connectedMatchHarness();
    const errors: string[] = [];
    harness.client.onError((message) => errors.push(message));

    harness.match.triggerDrop();
    harness.match.triggerLeave(1006, "server disappeared");

    expect(harness.connectionStates.at(-1)).toBe("failed");
    expect(errors).toEqual(["SERVER_UNAVAILABLE"]);
    expect(() => harness.client.submitCommand({ type: "surrender" })).toThrow();
    await harness.client.leave();
  });

  it("ignores every stale callback from a room replaced by a newer match", async () => {
    const firstLobby = fakeLobbyRoom("ABC234");
    const secondLobby = fakeLobbyRoom("DEF234");
    const firstMatch = fakeMatchRoom("first-match-room");
    const secondMatch = fakeMatchRoom("second-match-room");
    const transport = {
      create: vi.fn(async () => firstLobby.room),
      join: vi.fn()
        .mockResolvedValueOnce(firstLobby.room)
        .mockResolvedValueOnce(secondLobby.room),
      consumeSeatReservation: vi.fn()
        .mockResolvedValueOnce(firstMatch.room)
        .mockResolvedValueOnce(secondMatch.room),
    };
    const client = new MultiplayerClient(transport as never);
    const states: string[] = [];
    const errors: string[] = [];
    client.onConnection((state) => states.push(state));
    client.onError((message) => errors.push(message));

    await client.joinRoom("ABC234", "Tester", "pinehold");
    firstLobby.deliver("lobby.matchAssigned", assignment(MATCH_ID, "first-match-room"));
    await flushPromises();
    firstMatch.deliver("match.hello", serverHello(MATCH_ID));
    firstMatch.deliver("match.frame", snapshotFrame(visibleSnapshots(MATCH_ID).base));

    await client.joinRoom("DEF234", "Tester", "pinehold");
    secondLobby.deliver("lobby.matchAssigned", assignment(SECOND_MATCH_ID, "second-match-room"));
    await flushPromises();
    const secondSnapshots = visibleSnapshots(SECOND_MATCH_ID);
    secondMatch.deliver("match.hello", serverHello(SECOND_MATCH_ID));
    secondMatch.deliver("match.frame", snapshotFrame(secondSnapshots.base));
    expect(states.at(-1)).toBe("connected");
    secondMatch.send.mockClear();
    errors.splice(0);

    firstMatch.triggerDrop();
    firstMatch.triggerReconnect();
    firstMatch.triggerError(1011, "stale error");
    firstMatch.deliver("match.lifecycle", lifecycle("recovering", 9, MATCH_ID));
    firstMatch.deliver("match.hello", serverHello(MATCH_ID, 9));
    firstMatch.deliver("match.frame", snapshotFrame(visibleSnapshots(MATCH_ID).next));
    firstMatch.triggerLeave(1011, "stale leave");

    expect(states.at(-1)).toBe("connected");
    expect(errors).toEqual([]);
    expect(secondMatch.send).not.toHaveBeenCalled();
    client.submitCommand({ type: "surrender" });
    expect(secondMatch.send).toHaveBeenCalledWith("match.command", expect.objectContaining({
      clientCommandSeq: 0,
    }));
    await client.leave();
  });
});

function assignment(matchId = MATCH_ID, roomId = "match-room") {
  return {
    playerId: "player-1",
    matchId,
    reservation: {
      roomId,
      sessionId: `${roomId}-seat-session`,
      name: "village_siege_match",
    },
  };
}

function fakeLobbyRoom(roomCode = "ABC234") {
  return fakeRoom({
    roomId: `lobby-${roomCode}`,
    state: {
      roomCode,
      phase: "lobby",
      players: { forEach: () => undefined },
    },
  });
}

function fakeMatchRoom(roomId = "match-room") {
  return fakeRoom({
    roomId,
    state: { matchId: roomId, phase: "loading", serverTick: 0 },
  });
}

function fakeRoom(options: { roomId: string; state: unknown }) {
  const messageHandlers = new Map<string, (payload: unknown) => void>();
  const dropHandlers = new Set<(code: number, reason?: string) => void>();
  const reconnectHandlers = new Set<() => void>();
  const leaveHandlers = new Set<(code: number, reason?: string) => void>();
  const errorHandlers = new Set<(code: number, message?: string) => void>();
  const leave = vi.fn(async () => undefined);
  const send = vi.fn();
  const room = {
    roomId: options.roomId,
    sessionId: `${options.roomId}-session`,
    state: options.state,
    reconnection: { minUptime: 0, maxRetries: 0, maxDelay: 0 },
    leave,
    send,
    onStateChange: vi.fn(),
    onDrop: vi.fn((handler: (code: number, reason?: string) => void) => {
      dropHandlers.add(handler);
      return () => dropHandlers.delete(handler);
    }),
    onReconnect: vi.fn((handler: () => void) => {
      reconnectHandlers.add(handler);
      return () => reconnectHandlers.delete(handler);
    }),
    onError: vi.fn((handler: (code: number, message?: string) => void) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    }),
    onLeave: vi.fn((handler: (code: number, reason?: string) => void) => {
      leaveHandlers.add(handler);
      return () => leaveHandlers.delete(handler);
    }),
    onMessage: vi.fn((type: string, handler: (payload: unknown) => void) => {
      messageHandlers.set(type, handler);
      return () => messageHandlers.delete(type);
    }),
  };
  return {
    room,
    leave,
    send,
    deliver(type: string, payload: unknown) {
      const handler = messageHandlers.get(type);
      if (!handler) throw new Error(`No handler registered for ${type}`);
      handler(payload);
    },
    triggerDrop(code = 1006, reason = "connection dropped") {
      dropHandlers.forEach((handler) => handler(code, reason));
    },
    triggerReconnect() {
      reconnectHandlers.forEach((handler) => handler());
    },
    triggerLeave(code = 1000, reason = "room left") {
      leaveHandlers.forEach((handler) => handler(code, reason));
    },
    triggerError(code = 1011, message = "room error") {
      errorHandlers.forEach((handler) => handler(code, message));
    },
  };
}

async function connectedMatchHarness() {
  const lobby = fakeLobbyRoom();
  const match = fakeMatchRoom();
  const transport = {
    create: vi.fn(async () => lobby.room),
    join: vi.fn(async () => lobby.room),
    consumeSeatReservation: vi.fn(async () => match.room),
  };
  const client = new MultiplayerClient(transport as never);
  const connectionStates: string[] = [];
  client.onConnection((state) => connectionStates.push(state));
  const snapshots = visibleSnapshots(MATCH_ID);

  await client.joinRoom("ABC234", "Tester", "pinehold");
  lobby.deliver("lobby.matchAssigned", assignment());
  await flushPromises();
  match.deliver("match.hello", serverHello(MATCH_ID));
  match.deliver("match.frame", snapshotFrame(snapshots.base));
  expect(connectionStates.at(-1)).toBe("connected");
  return { client, lobby, match, connectionStates, ...snapshots };
}

function versionOffer() {
  return { protocolVersion: MATCH_PROTOCOL_VERSION, rulesVersion: RULES_VERSION };
}

function serverHello(matchId: string, nextClientCommandSeq = 0): MatchServerHello {
  return {
    ...versionOffer(),
    matchId,
    recipientPlayerId: "player-1",
    tickMilliseconds: TICK_MILLISECONDS,
    fullSnapshotIntervalTicks: 50,
    canonicalHashIntervalTicks: 20,
    lastReceivedClientCommandSeq: nextClientCommandSeq - 1,
    nextClientCommandSeq,
  };
}

function lifecycle(
  type: "recovering" | "resumed",
  recoveryEpoch: number,
  matchId: string,
): MatchLifecycleMessage {
  const base = {
    type,
    ...versionOffer(),
    matchId,
    recipientPlayerId: "player-1",
    serverTick: 1,
    recoveryEpoch,
  } as const;
  return type === "recovering"
    ? { ...base, type, leaseExpiresAtEpochMs: Date.now() + 120_000 }
    : { ...base, type };
}

function failedLifecycle(
  recoveryEpoch: number,
  matchId: string,
  code: "PERSISTENCE_UNAVAILABLE",
): MatchLifecycleMessage {
  return {
    type: "failed",
    ...versionOffer(),
    matchId,
    recipientPlayerId: "player-1",
    serverTick: 1,
    recoveryEpoch,
    code,
    recoverable: false,
  };
}

function visibleSnapshots(matchId: string): { base: VisibleSnapshot; next: VisibleSnapshot } {
  const state = createInitialState({
    matchId,
    seed: 41,
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
  state.tick += 1;
  return { base, next: toVisibleSnapshot(state, "player-1") };
}

function snapshotFrame(snapshot: VisibleSnapshot): MatchSnapshotFrame {
  return {
    kind: "snapshot",
    ...versionOffer(),
    matchId: snapshot.matchId,
    recipientPlayerId: snapshot.recipientPlayerId,
    serverTick: snapshot.serverTick,
    events: [],
    snapshot,
  };
}

function sentCommandIntents(room: ReturnType<typeof fakeMatchRoom>): MatchCommandIntent[] {
  return room.send.mock.calls
    .filter(([type]) => type === "match.command")
    .map(([, payload]) => payload as MatchCommandIntent);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
