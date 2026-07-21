import { describe, expect, it, vi } from "vitest";
import { MATCH_PROTOCOL_VERSION, RULES_VERSION } from "@village-siege/shared";
import type { Client } from "@colyseus/core";
import { LobbyRoom } from "../src/rooms/LobbyRoom.js";
import { AiSlotState, LobbyState, PlayerState } from "../src/schema/GameState.js";

describe("LobbyRoom handoff recovery", () => {
  it("caps each lobby client's message rate", () => {
    expect(new LobbyRoom().maxMessagesPerSecond).toBe(20);
  });

  it("rejects missing or incompatible network tuples before admitting a lobby client", () => {
    const room = new LobbyRoom();
    const client = {} as Client;
    expect(room.onAuth(client, { roomCode: "ABC234" })).toBe(false);
    expect(room.onAuth(client, {
      roomCode: "ABC234",
      protocolVersion: "village-siege-network/0",
      rulesVersion: RULES_VERSION,
    })).toBe(false);
    expect(room.onAuth(client, {
      roomCode: "ABC234",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: "village-siege/old",
    })).toBe(false);
    expect(room.onAuth(client, {
      roomCode: "ABC234",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
    })).toBe(true);
  });

  it("does not serialize the private match seed in lobby schema", () => {
    const state = new LobbyState();
    expect(state.toJSON()).not.toHaveProperty("seed");
  });

  it("lets only the host configure bounded authoritative AI slots and resets readiness", () => {
    const room = new LobbyRoom();
    room.setState(new LobbyState());
    const host = lobbyPlayer("host", true);
    const guest = lobbyPlayer("guest", false);
    host.ready = true;
    guest.ready = true;
    room.state.players.set(host.sessionId, host);
    room.state.players.set(guest.sessionId, guest);
    const hostClient = { sessionId: host.sessionId, send: vi.fn() } as unknown as Client;
    const guestClient = { sessionId: guest.sessionId, send: vi.fn() } as unknown as Client;
    const configure = (room as unknown as {
      configureAiSlots(client: Client, payload: unknown): void;
    }).configureAiSlots.bind(room);

    configure(guestClient, { slots: [] });
    expect(guestClient.send).toHaveBeenCalledWith("lobby.error", { code: "HOST_ONLY" });

    configure(hostClient, { slots: [
      { personality: "aggressor", difficulty: "standard", villageId: "riverstead" },
      { personality: "guardian", difficulty: "veteran", villageId: "highcrag" },
    ] });
    expect([...room.state.aiSlots.values()].map((slot) => ({
      slotId: slot.slotId,
      personality: slot.personality,
      difficulty: slot.difficulty,
      villageId: slot.villageId,
    }))).toEqual([
      { slotId: "ai-slot-1", personality: "aggressor", difficulty: "standard", villageId: "riverstead" },
      { slotId: "ai-slot-2", personality: "guardian", difficulty: "veteran", villageId: "highcrag" },
    ]);
    expect(host.ready).toBe(false);
    expect(guest.ready).toBe(false);

    configure(hostClient, { slots: [
      { personality: "aggressor", difficulty: "standard", villageId: "pinehold" },
      { personality: "guardian", difficulty: "standard", villageId: "riverstead" },
      { personality: "prosperer", difficulty: "standard", villageId: "highcrag" },
      { personality: "raider", difficulty: "standard", villageId: "pinehold" },
    ] });
    expect(hostClient.send).toHaveBeenCalledWith("lobby.error", { code: "TOO_MANY_FACTIONS" });
    expect(room.state.aiSlots.size).toBe(2);
  });

  it("trims AI slots when a human joins so the lobby never exceeds five factions", () => {
    const room = new LobbyRoom();
    room.setState(new LobbyState());
    room.state.roomCode = "ABC234";
    for (let index = 1; index <= 4; index += 1) {
      const slot = new AiSlotState();
      slot.slotId = `ai-slot-${index}`;
      room.state.aiSlots.set(slot.slotId, slot);
    }
    const first = { sessionId: "human-1" } as Client;
    room.onJoin(first, { roomCode: "ABC234", playerName: "One", villageId: "pinehold" });
    expect(room.state.players.size + room.state.aiSlots.size).toBe(5);
    const second = { sessionId: "human-2" } as Client;
    room.onJoin(second, { roomCode: "ABC234", playerName: "Two", villageId: "riverstead" });
    expect(room.state.players.size).toBe(2);
    expect(room.state.aiSlots.size).toBe(3);
    expect(room.state.players.size + room.state.aiSlots.size).toBe(5);
  });

  it("recovers starting state even while every socket is temporarily dropped", async () => {
    const room = new LobbyRoom();
    room.setState(new LobbyState());
    room.state.phase = "starting";
    const player = new PlayerState();
    player.sessionId = "dropped-player";
    player.ready = true;
    player.connected = false;
    room.state.players.set(player.sessionId, player);
    const unlock = vi.spyOn(room, "unlock").mockResolvedValue();
    const broadcast = vi.spyOn(room, "broadcast").mockImplementation(() => undefined);

    await (room as unknown as { recoverExpiredHandoff(): Promise<void> }).recoverExpiredHandoff();

    expect(room.clients).toHaveLength(0);
    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.get(player.sessionId)?.ready).toBe(false);
    expect(unlock).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith("lobby.error", { code: "MATCH_HANDOFF_EXPIRED" });
  });
});

function lobbyPlayer(sessionId: string, host: boolean): PlayerState {
  const player = new PlayerState();
  player.sessionId = sessionId;
  player.host = host;
  return player;
}
