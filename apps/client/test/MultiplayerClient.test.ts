import { describe, expect, it, vi } from "vitest";
import { MultiplayerClient } from "../src/network/MultiplayerClient.js";

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
});

function assignment() {
  return {
    playerId: "player-1",
    reservation: {
      roomId: "match-room",
      sessionId: "seat-session",
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

function fakeMatchRoom() {
  return fakeRoom({
    roomId: "match-room",
    state: { matchId: "match-room", phase: "loading", serverTick: 0 },
  });
}

function fakeRoom(options: { roomId: string; state: unknown }) {
  const messageHandlers = new Map<string, (payload: unknown) => void>();
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
    onDrop: vi.fn(),
    onReconnect: vi.fn(),
    onError: vi.fn(),
    onLeave: vi.fn(),
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
  };
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
