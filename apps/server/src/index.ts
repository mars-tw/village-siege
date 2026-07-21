import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LobbyRoom } from "./rooms/LobbyRoom.js";
import { MatchRoom } from "./rooms/MatchRoom.js";

export const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 5_000,
    pingMaxRetries: 3,
    maxPayload: 16 * 1024,
  }),
  rooms: {
    village_siege_lobby: defineRoom(LobbyRoom).filterBy(["roomCode"]),
    village_siege_match: defineRoom(MatchRoom),
  },
});

const port = Number.parseInt(process.env.PORT ?? "2567", 10);
await server.listen(Number.isFinite(port) ? port : 2567);
console.log(`Village Siege server listening on http://localhost:${Number.isFinite(port) ? port : 2567}`);
