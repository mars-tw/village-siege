import { describe, expect, it, vi } from "vitest";
import { LobbyRoom } from "../src/rooms/LobbyRoom.js";
import { LobbyState, PlayerState } from "../src/schema/GameState.js";

describe("LobbyRoom handoff recovery", () => {
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
