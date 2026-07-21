import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  type MatchCommandResult,
  type MatchReplicationFrame,
} from "@village-siege/shared";
import { MatchAuthority } from "../src/authority/MatchAuthority.js";
import type {
  MatchRecoveryLease,
  MatchRecoveryMetadata,
  MatchRecoveryStore,
} from "../src/recovery/MatchRecoveryStore.js";
import { MatchRoom, PLAYER_RECONNECT_LEASE_MILLISECONDS } from "../src/rooms/MatchRoom.js";
import { MatchRoomState } from "../src/schema/GameState.js";

interface FakeRecoveryPayload {
  readonly authority: unknown;
  readonly disconnectedPlayers: readonly unknown[];
}

interface FakeAuthority {
  readonly matchId: string;
  serverTick: number;
  phase: "playing" | "finished";
  recoveryRecord: ReturnType<typeof vi.fn>;
  serverHello: ReturnType<typeof vi.fn>;
  initialFrames: ReturnType<typeof vi.fn>;
  forceSnapshotFrame: ReturnType<typeof vi.fn>;
  submitIntent: ReturnType<typeof vi.fn>;
  step: ReturnType<typeof vi.fn>;
  expireDisconnectedTeams: ReturnType<typeof vi.fn>;
}

interface RoomInternals {
  authority: FakeAuthority;
  participants: Array<{
    playerId: string;
    teamId: string;
    name: string;
    villageId: "pinehold" | "riverstead" | "highcrag";
    accessToken: string;
  }>;
  playerIdBySession: Map<string, string>;
  connectedPlayerIds: Set<string>;
  claimedPlayerIds: Set<string>;
  negotiatedPlayerIds: Set<string>;
  recoveryEpochByPlayer: Map<string, number>;
  disconnectedPlayers: Map<string, { playerId: string; generation: number; expiresAtEpochMs: number }>;
  reconnectLeaseTimers: Map<string, { generation: number; clear(): void }>;
  recoveryStore: MatchRecoveryStore<FakeRecoveryPayload>;
  recoveryMetadata: MatchRecoveryMetadata;
  recoveryLease: MatchRecoveryLease | undefined;
  started: boolean;
  failStopped: boolean;
  handleHello(client: Client, payload: unknown): void;
  handleCommand(client: Client, payload: unknown): void;
  handleSyncRequest(client: Client, payload: unknown): void;
  expireDueReconnectLeases(playerId: string, generation: number): Promise<void>;
  restoreReconnectLeaseTimers(): void;
  failureCodeFor(error: unknown): string;
  tick(): Promise<void>;
}

const VERSION_OFFER = {
  protocolVersion: MATCH_PROTOCOL_VERSION,
  rulesVersion: RULES_VERSION,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MatchRoom negotiation gate", () => {
  it("does not queue commands from an early-negotiated player before the full roster starts", () => {
    const room = new MatchRoom();
    const send = vi.fn();
    const client = { sessionId: "session-1", send } as unknown as Client;
    const internals = room as unknown as RoomInternals;
    internals.playerIdBySession.set(client.sessionId, "player-1");
    internals.negotiatedPlayerIds.add("player-1");

    (internals as unknown as { handleCommand(client: Client, payload: unknown): void }).handleCommand(client, {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      commandId: "prestart_command_01",
      clientCommandSeq: 0,
      lastServerTickSeen: 0,
      command: { type: "surrender" },
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("match.commandResult", {
      commandId: "prestart_command_01",
      clientCommandSeq: 0,
      accepted: false,
      code: "MATCH_NOT_PLAYING",
      serverTick: 0,
    });
  });
});

describe("MatchRoom TASK-020 reconnect lifecycle", () => {
  it("drops connectivity immediately, reserves exactly 120 seconds and cannot start with the player offline", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { room, internals, authority, recoveryStore } = configuredRoom(now);
    const playerOne = fakeClient("session-1");
    const playerTwo = fakeClient("session-2");
    bindPlayer(internals, playerOne, "player-1");
    bindPlayer(internals, playerTwo, "player-2");
    internals.negotiatedPlayerIds.add("player-1");
    internals.negotiatedPlayerIds.add("player-2");

    let rejectReconnection!: () => void;
    const reconnection = new Promise<Client>((_resolve, reject) => {
      rejectReconnection = () => reject(new Error("not reconnected"));
    });
    const allowReconnection = vi.spyOn(room, "allowReconnection").mockReturnValue(reconnection as never);

    const dropping = room.onDrop(playerOne);
    expect(internals.connectedPlayerIds.has("player-1")).toBe(false);
    expect(internals.negotiatedPlayerIds.has("player-1")).toBe(false);
    await vi.waitFor(() => expect(internals.disconnectedPlayers.get("player-1")).toEqual({
        playerId: "player-1",
        generation: 1,
        expiresAtEpochMs: now + PLAYER_RECONNECT_LEASE_MILLISECONDS,
      }));

    internals.handleHello(playerTwo, VERSION_OFFER);
    expect(internals.started).toBe(false);
    expect(authority.initialFrames).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(allowReconnection).toHaveBeenCalledWith(playerOne, 120));
    expect(recoveryStore.commit).toHaveBeenCalledBefore(allowReconnection);

    now = 1_000 + PLAYER_RECONNECT_LEASE_MILLISECONDS;
    room.clock.tick(PLAYER_RECONNECT_LEASE_MILLISECONDS);
    await vi.waitFor(() => expect(internals.disconnectedPlayers.has("player-1")).toBe(false));

    rejectReconnection();
    await dropping;
    expect(authority.expireDisconnectedTeams).not.toHaveBeenCalled();
    now += 1;
  });

  it("does not expire at 119999 ms, expires exactly once at 120000 ms and ignores stale generations", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { internals, authority } = configuredRoom(now);
    internals.started = true;
    internals.connectedPlayerIds.add("player-2");
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 2,
      expiresAtEpochMs: now + PLAYER_RECONNECT_LEASE_MILLISECONDS,
    });

    now += 119_999;
    await internals.expireDueReconnectLeases("player-1", 2);
    expect(authority.expireDisconnectedTeams).not.toHaveBeenCalled();

    now += 1;
    await internals.expireDueReconnectLeases("player-1", 1);
    expect(authority.expireDisconnectedTeams).not.toHaveBeenCalled();

    await internals.expireDueReconnectLeases("player-1", 2);
    await internals.expireDueReconnectLeases("player-1", 2);
    expect(authority.expireDisconnectedTeams).toHaveBeenCalledOnce();
    expect(authority.expireDisconnectedTeams).toHaveBeenCalledWith(["team-1"]);
    expect(internals.disconnectedPlayers.has("player-1")).toBe(false);
  });

  it("persists reconnect cancellation before recovering, resumed, hello and full snapshot messages", async () => {
    let now = 20_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const order: string[] = [];
    const { room, internals, recoveryStore, snapshotFrame, serverHello } = configuredRoom(now);
    const playerOne = fakeClient("session-1", (type, payload) => {
      const lifecycleType = type === "match.lifecycle" && isRecord(payload) ? `:${String(payload.type)}` : "";
      order.push(`${type}${lifecycleType}`);
    });
    bindPlayer(internals, playerOne, "player-1");
    internals.started = true;
    internals.connectedPlayerIds.delete("player-1");
    internals.negotiatedPlayerIds.delete("player-1");
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 3,
      expiresAtEpochMs: now + PLAYER_RECONNECT_LEASE_MILLISECONDS,
    });
    vi.mocked(recoveryStore.commit).mockImplementation(async (...args) => {
      order.push("persist");
      return recoveryRecord(args[1], args[0], args[2]);
    });

    await room.onReconnect(playerOne);

    expect(order).toEqual([
      "persist",
      "match.lifecycle:recovering",
      "match.lifecycle:resumed",
      "match.hello",
      "match.frame",
    ]);
    expect(internals.connectedPlayerIds.has("player-1")).toBe(true);
    expect(internals.negotiatedPlayerIds.has("player-1")).toBe(true);
    expect(internals.disconnectedPlayers.has("player-1")).toBe(false);
    expect(playerOne.send).toHaveBeenNthCalledWith(3, "match.hello", serverHello);
    expect(playerOne.send).toHaveBeenNthCalledWith(4, "match.frame", snapshotFrame);
    expect(vi.mocked(recoveryStore.commit).mock.calls[0]![2]).toMatchObject({ disconnectedPlayers: [] });
  });

  it("sends an explicit terminal lifecycle before closing an expired late reconnect", async () => {
    const now = 25_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals } = configuredRoom(now);
    const playerOne = fakeClient("session-1");
    bindPlayer(internals, playerOne, "player-1");
    internals.connectedPlayerIds.delete("player-1");
    internals.connectedPlayerIds.add("player-2");
    internals.started = true;
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 4,
      expiresAtEpochMs: now,
    });

    await room.onReconnect(playerOne);
    expect(playerOne.send).toHaveBeenCalledWith("match.lifecycle", expect.objectContaining({
      type: "failed",
      code: "RECONNECT_LEASE_EXPIRED",
      recoverable: false,
      recoveryEpoch: 4,
    }));
    room.clock.tick(0);
    expect(playerOne.leave).toHaveBeenCalledWith(4008, "Reconnect lease expired");
  });

  it("commits an authoritative tick before emitting its result and frame", async () => {
    const now = 30_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals, authority, recoveryStore, snapshotFrame } = configuredRoom(now);
    const playerOne = fakeClient("session-1");
    bindPlayer(internals, playerOne, "player-1");
    room.clients.push(playerOne);
    internals.started = true;
    const result: MatchCommandResult = {
      commandId: "command_00000001",
      clientCommandSeq: 1,
      accepted: true,
      serverTick: 1,
    };
    authority.step.mockReturnValue({
      serverTick: 1,
      phase: "playing",
      commandResults: new Map([["player-1", [result]]]),
      frames: new Map([["player-1", snapshotFrame]]),
    });

    let resolveCommit!: () => void;
    vi.mocked(recoveryStore.commit).mockImplementation(() => new Promise((resolve) => {
      resolveCommit = () => resolve(recoveryRecord(internals.recoveryMetadata, internals.recoveryLease!, {
        authority: {},
        disconnectedPlayers: [],
      }));
    }));

    const ticking = internals.tick();
    await vi.waitFor(() => expect(recoveryStore.commit).toHaveBeenCalledOnce());
    expect(playerOne.send).not.toHaveBeenCalled();
    resolveCommit();
    await ticking;

    expect(playerOne.send.mock.calls).toEqual([
      ["match.commandResult", result],
      ["match.frame", snapshotFrame],
    ]);
  });

  it("does not expose an uncommitted tick through a sync request or command retry", async () => {
    const now = 80_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals, authority, recoveryStore, snapshotFrame } = configuredRoom(now);
    const playerOne = fakeClient("session-1");
    bindPlayer(internals, playerOne, "player-1");
    internals.negotiatedPlayerIds.add("player-1");
    room.clients.push(playerOne);
    internals.started = true;
    const tickResult: MatchCommandResult = {
      commandId: "command_00000001",
      clientCommandSeq: 1,
      accepted: true,
      serverTick: 1,
    };
    const retryResult: MatchCommandResult = {
      commandId: "command_00000002",
      clientCommandSeq: 2,
      accepted: true,
      serverTick: 1,
    };
    const syncFrame = { kind: "snapshot", marker: "committed-sync-frame" } as unknown as MatchReplicationFrame;
    authority.step.mockImplementation(() => {
      authority.serverTick = 1;
      return {
        serverTick: 1,
        phase: "playing",
        commandResults: new Map([["player-1", [tickResult]]]),
        frames: new Map([["player-1", snapshotFrame]]),
      };
    });
    authority.forceSnapshotFrame.mockReturnValue(syncFrame);
    authority.submitIntent.mockReturnValue({ queued: false, replayed: true, result: retryResult });

    let resolveCommit!: () => void;
    vi.mocked(recoveryStore.commit).mockImplementation(() => new Promise((resolve) => {
      resolveCommit = () => resolve(recoveryRecord(internals.recoveryMetadata, internals.recoveryLease!, {
        authority: {},
        disconnectedPlayers: [],
      }));
    }));

    const ticking = internals.tick();
    await vi.waitFor(() => expect(recoveryStore.commit).toHaveBeenCalledOnce());
    internals.handleSyncRequest(playerOne, VERSION_OFFER);
    internals.handleCommand(playerOne, {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      commandId: "command_00000002",
      clientCommandSeq: 2,
      lastServerTickSeen: 1,
      command: { type: "surrender" },
    });

    expect(playerOne.send).not.toHaveBeenCalled();
    expect(authority.forceSnapshotFrame).not.toHaveBeenCalled();
    expect(authority.submitIntent).not.toHaveBeenCalled();

    resolveCommit();
    await ticking;

    expect(authority.forceSnapshotFrame).toHaveBeenCalledOnce();
    expect(authority.submitIntent).toHaveBeenCalledOnce();
    expect(playerOne.send.mock.calls).toEqual([
      ["match.commandResult", tickResult],
      ["match.frame", snapshotFrame],
      ["match.frame", syncFrame],
      ["match.commandResult", retryResult],
    ]);
  });

  it("serializes a drop behind an in-flight tick commit so an older payload cannot overwrite it", async () => {
    const now = 90_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals, authority, recoveryStore } = configuredRoom(now);
    const playerOne = fakeClient("session-1");
    bindPlayer(internals, playerOne, "player-1");
    room.clients.push(playerOne);
    internals.started = true;
    authority.step.mockImplementation(() => {
      authority.serverTick = 1;
      return { serverTick: 1, phase: "playing", commandResults: new Map(), frames: new Map() };
    });
    vi.spyOn(room, "allowReconnection").mockRejectedValue(new Error("not reconnected"));
    const persistedDisconnectedPlayers: unknown[][] = [];
    let activeCommits = 0;
    let maxActiveCommits = 0;
    let resolveFirstCommit!: () => void;
    vi.mocked(recoveryStore.commit).mockImplementation(async (lease, metadata, payload) => {
      activeCommits += 1;
      maxActiveCommits = Math.max(maxActiveCommits, activeCommits);
      persistedDisconnectedPlayers.push([...payload.disconnectedPlayers]);
      if (persistedDisconnectedPlayers.length === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstCommit = resolve;
        });
      }
      activeCommits -= 1;
      return recoveryRecord(metadata, lease, payload);
    });

    const ticking = internals.tick();
    await vi.waitFor(() => expect(recoveryStore.commit).toHaveBeenCalledOnce());
    const dropping = room.onDrop(playerOne);
    expect(internals.connectedPlayerIds.has("player-1")).toBe(false);
    await Promise.resolve();
    expect(recoveryStore.commit).toHaveBeenCalledOnce();

    resolveFirstCommit();
    await Promise.all([ticking, dropping]);

    expect(maxActiveCommits).toBe(1);
    expect(recoveryStore.commit).toHaveBeenCalledTimes(2);
    expect(persistedDisconnectedPlayers[0]).toEqual([]);
    expect(persistedDisconnectedPlayers[1]).toEqual([{
      playerId: "player-1",
      generation: 1,
      expiresAtEpochMs: now + PLAYER_RECONNECT_LEASE_MILLISECONDS,
    }]);
  });

  it("rebuilds a restored reconnect timer that drives expiry at its deadline", async () => {
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { room, internals, authority, recoveryStore } = configuredRoom(now);
    internals.started = true;
    internals.connectedPlayerIds.add("player-2");
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 4,
      expiresAtEpochMs: now + 1_000,
    });
    internals.recoveryEpochByPlayer.set("player-1", 4);

    internals.restoreReconnectLeaseTimers();
    now += 999;
    room.clock.tick(999);
    expect(authority.expireDisconnectedTeams).not.toHaveBeenCalled();
    expect(internals.disconnectedPlayers.has("player-1")).toBe(true);

    now += 1;
    room.clock.tick(1);
    await vi.waitFor(() => expect(authority.expireDisconnectedTeams).toHaveBeenCalledOnce());

    expect(authority.expireDisconnectedTeams).toHaveBeenCalledWith(["team-1"]);
    expect(internals.disconnectedPlayers.has("player-1")).toBe(false);
    expect(recoveryStore.commit).toHaveBeenCalledOnce();
    expect(vi.mocked(recoveryStore.commit).mock.calls[0]![2]).toMatchObject({ disconnectedPlayers: [] });
  });

  it("cancels and persists a restored lease before a later drop creates the next epoch", async () => {
    const now = 110_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals, recoveryStore } = configuredRoom(now);
    const playerOne = fakeClient("session-restored-1");
    internals.started = true;
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 4,
      expiresAtEpochMs: now + PLAYER_RECONNECT_LEASE_MILLISECONDS,
    });
    internals.recoveryEpochByPlayer.set("player-1", 4);
    internals.restoreReconnectLeaseTimers();
    const restoredTimer = internals.reconnectLeaseTimers.get("player-1");
    if (!restoredTimer) throw new Error("Expected restored reconnect timer");
    const clearTimer = vi.spyOn(restoredTimer, "clear");

    await room.onJoin(playerOne, {
      accessToken: "token-1",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
    });

    expect(clearTimer).toHaveBeenCalledOnce();
    expect(internals.disconnectedPlayers.has("player-1")).toBe(false);
    expect(internals.recoveryEpochByPlayer.get("player-1")).toBe(4);
    expect(vi.mocked(recoveryStore.commit).mock.calls[0]![2]).toMatchObject({ disconnectedPlayers: [] });

    vi.spyOn(room, "allowReconnection").mockRejectedValue(new Error("not reconnected"));
    await room.onDrop(playerOne);

    expect(internals.recoveryEpochByPlayer.get("player-1")).toBe(5);
    expect(internals.disconnectedPlayers.get("player-1")).toEqual({
      playerId: "player-1",
      generation: 5,
      expiresAtEpochMs: now + PLAYER_RECONNECT_LEASE_MILLISECONDS,
    });
    expect(recoveryStore.commit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recoveryStore.commit).mock.calls[1]![2]).toMatchObject({
      disconnectedPlayers: [{ playerId: "player-1", generation: 5 }],
    });
  });

  it("accepts a restored seat at drop plus 119999 ms and atomically cancels its lease", async () => {
    const droppedAt = 200_000;
    const now = droppedAt + PLAYER_RECONNECT_LEASE_MILLISECONDS - 1;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals, authority, recoveryStore } = configuredRoom(now);
    const playerOne = fakeClient("session-boundary-valid");
    internals.started = true;
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 6,
      expiresAtEpochMs: droppedAt + PLAYER_RECONNECT_LEASE_MILLISECONDS,
    });
    internals.recoveryEpochByPlayer.set("player-1", 6);
    internals.restoreReconnectLeaseTimers();

    await room.onJoin(playerOne, {
      accessToken: "token-1",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
    });

    expect(internals.connectedPlayerIds.has("player-1")).toBe(true);
    expect(internals.playerIdBySession.get(playerOne.sessionId)).toBe("player-1");
    expect(internals.disconnectedPlayers.has("player-1")).toBe(false);
    expect(internals.reconnectLeaseTimers.has("player-1")).toBe(false);
    expect(authority.expireDisconnectedTeams).not.toHaveBeenCalled();
    expect(playerOne.send).not.toHaveBeenCalledWith("match.lifecycle", expect.objectContaining({ type: "failed" }));
    expect(recoveryStore.commit).toHaveBeenCalledOnce();
    expect(vi.mocked(recoveryStore.commit).mock.calls[0]![2]).toMatchObject({ disconnectedPlayers: [] });
  });

  it("rejects a restored seat at drop plus 120000 ms and expires its team without marking it connected", async () => {
    const droppedAt = 300_000;
    const now = droppedAt + PLAYER_RECONNECT_LEASE_MILLISECONDS;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { room, internals, authority, recoveryStore } = configuredRoom(now);
    const playerOne = fakeClient("session-boundary-expired");
    internals.started = true;
    internals.connectedPlayerIds.add("player-2");
    internals.disconnectedPlayers.set("player-1", {
      playerId: "player-1",
      generation: 7,
      expiresAtEpochMs: now,
    });
    internals.recoveryEpochByPlayer.set("player-1", 7);
    internals.restoreReconnectLeaseTimers();

    await room.onJoin(playerOne, {
      accessToken: "token-1",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
    });

    expect(internals.connectedPlayerIds.has("player-1")).toBe(false);
    expect(internals.playerIdBySession.has(playerOne.sessionId)).toBe(false);
    expect(authority.expireDisconnectedTeams).toHaveBeenCalledOnce();
    expect(authority.expireDisconnectedTeams).toHaveBeenCalledWith(["team-1"]);
    expect(playerOne.send).toHaveBeenCalledWith("match.lifecycle", expect.objectContaining({
      type: "failed",
      code: "RECONNECT_LEASE_EXPIRED",
      recoveryEpoch: 7,
      recoverable: false,
    }));
    expect(internals.disconnectedPlayers.has("player-1")).toBe(false);
    expect(internals.reconnectLeaseTimers.has("player-1")).toBe(false);
    expect(recoveryStore.commit).toHaveBeenCalledOnce();
    expect(vi.mocked(recoveryStore.commit).mock.calls[0]![2]).toMatchObject({ disconnectedPlayers: [] });
    room.clock.tick(0);
    expect(playerOne.leave).toHaveBeenCalledWith(4008, "Reconnect lease expired");
  });

  it("preserves STATE_CORRUPT as the client-visible recovery failure code", () => {
    const { internals } = configuredRoom(120_000);
    expect(internals.failureCodeFor(Object.assign(new Error("bad restore"), { code: "STATE_CORRUPT" })))
      .toBe("STATE_CORRUPT");
  });

  it("fails closed on commit failure without emitting the candidate result, frame or winner", async () => {
    const now = 40_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { room, internals, authority, recoveryStore, snapshotFrame } = configuredRoom(now);
    const playerOne = fakeClient("session-1");
    bindPlayer(internals, playerOne, "player-1");
    room.clients.push(playerOne);
    internals.started = true;
    const candidateResult: MatchCommandResult = {
      commandId: "winning_command_01",
      clientCommandSeq: 1,
      accepted: true,
      serverTick: 1,
    };
    authority.step.mockReturnValue({
      serverTick: 1,
      phase: "finished",
      commandResults: new Map([["player-1", [candidateResult]]]),
      frames: new Map([["player-1", {
        ...snapshotFrame,
        snapshot: { victory: { winningTeamIds: ["team-1"] } },
      }]]),
    });
    vi.mocked(recoveryStore.commit).mockRejectedValue(new Error("database unavailable"));
    const restore = vi.spyOn(MatchAuthority, "restore").mockReturnValue(authority as unknown as MatchAuthority);
    const disconnect = vi.spyOn(room, "disconnect").mockResolvedValue();

    await internals.tick();

    expect(restore).toHaveBeenCalledOnce();
    expect(internals.failStopped).toBe(true);
    expect(internals.started).toBe(false);
    expect(room.state.phase).toBe("playing");
    expect(disconnect).toHaveBeenCalledWith(1011);
    expect(playerOne.send).toHaveBeenCalledOnce();
    expect(playerOne.send).toHaveBeenCalledWith("match.lifecycle", expect.objectContaining({
      type: "failed",
      code: "PERSISTENCE_UNAVAILABLE",
      recoverable: false,
    }));
    expect(playerOne.send.mock.calls.some(([type]) => type === "match.commandResult" || type === "match.frame")).toBe(false);
    expect(JSON.stringify(playerOne.send.mock.calls)).not.toContain("winningTeamIds");
    expect(recoveryStore.markTerminal).not.toHaveBeenCalled();

    await internals.tick();
    expect(authority.step).toHaveBeenCalledOnce();
  });
});

function configuredRoom(now: number): {
  room: MatchRoom;
  internals: RoomInternals;
  authority: FakeAuthority;
  recoveryStore: MatchRecoveryStore<FakeRecoveryPayload> & Record<"commit" | "markTerminal", ReturnType<typeof vi.fn>>;
  snapshotFrame: MatchReplicationFrame;
  serverHello: object;
} {
  const room = new MatchRoom();
  room.setState(new MatchRoomState());
  room.state.matchId = "match-room-recovery";
  room.state.phase = "playing";
  const snapshotFrame = { kind: "snapshot", marker: "full-player-snapshot" } as unknown as MatchReplicationFrame;
  const serverHello = { marker: "server-hello" };
  const authority: FakeAuthority = {
    matchId: "match-room-recovery",
    serverTick: 0,
    phase: "playing",
    recoveryRecord: vi.fn(() => ({ marker: "authority-recovery" })),
    serverHello: vi.fn(() => serverHello),
    initialFrames: vi.fn(() => new Map()),
    forceSnapshotFrame: vi.fn(() => snapshotFrame),
    submitIntent: vi.fn(() => ({ queued: true })),
    step: vi.fn(() => ({ serverTick: 1, phase: "playing", commandResults: new Map(), frames: new Map() })),
    expireDisconnectedTeams: vi.fn(() => ({ serverTick: 1, phase: "playing", commandResults: new Map(), frames: new Map() })),
  };
  const recoveryMetadata: MatchRecoveryMetadata = {
    schemaVersion: 1,
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    matchId: authority.matchId,
  };
  const recoveryLease: MatchRecoveryLease = {
    matchId: authority.matchId,
    ownerId: "room-test",
    fence: 1,
    expiresAtEpochMs: now + 15_000,
  };
  const recoveryStore = {
    load: vi.fn(async () => null),
    acquire: vi.fn(async () => recoveryLease),
    renew: vi.fn(async () => recoveryLease),
    commit: vi.fn(async (_lease, metadata, payload) => recoveryRecord(metadata, recoveryLease, payload)),
    markTerminal: vi.fn(async (_lease, metadata, outcome) => ({
      ...recoveryRecord(metadata, null, null),
      terminal: { ...outcome, recordedAtEpochMs: now },
    })),
    release: vi.fn(async () => undefined),
  } as unknown as MatchRecoveryStore<FakeRecoveryPayload> & Record<"commit" | "markTerminal", ReturnType<typeof vi.fn>>;
  const internals = room as unknown as RoomInternals;
  internals.authority = authority;
  internals.participants = [
    { playerId: "player-1", teamId: "team-1", name: "Player 1", villageId: "pinehold", accessToken: "token-1" },
    { playerId: "player-2", teamId: "team-2", name: "Player 2", villageId: "riverstead", accessToken: "token-2" },
  ];
  internals.recoveryStore = recoveryStore;
  internals.recoveryMetadata = recoveryMetadata;
  internals.recoveryLease = recoveryLease;
  return { room, internals, authority, recoveryStore, snapshotFrame, serverHello };
}

function bindPlayer(internals: RoomInternals, client: Client, playerId: string): void {
  internals.playerIdBySession.set(client.sessionId, playerId);
  internals.connectedPlayerIds.add(playerId);
  internals.claimedPlayerIds.add(playerId);
  internals.recoveryEpochByPlayer.set(playerId, 0);
}

function fakeClient(
  sessionId: string,
  onSend?: (type: string, payload: unknown) => void,
): Client & { send: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> } {
  const send = vi.fn((type: string, payload: unknown) => onSend?.(type, payload));
  const leave = vi.fn();
  return { sessionId, send, leave } as unknown as Client & {
    send: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
  };
}

function recoveryRecord(
  metadata: MatchRecoveryMetadata,
  lease: MatchRecoveryLease | null,
  payload: unknown,
): {
  metadata: MatchRecoveryMetadata;
  revision: number;
  committedAtEpochMs: number;
  payload: unknown;
  terminal: null;
  lease: MatchRecoveryLease | null;
} {
  return {
    metadata,
    revision: 1,
    committedAtEpochMs: Date.now(),
    payload,
    terminal: null,
    lease,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
