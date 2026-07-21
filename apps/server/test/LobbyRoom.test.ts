import { describe, expect, it, vi } from "vitest";
import { MATCH_PROTOCOL_VERSION, RULES_VERSION } from "@village-siege/shared";
import type { Client } from "@colyseus/core";
import { LobbyRoom } from "../src/rooms/LobbyRoom.js";
import { LobbyState, PlayerState } from "../src/schema/GameState.js";

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
