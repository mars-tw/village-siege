import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { VillageSiegeRoom } from "./rooms/VillageSiegeRoom.js";

export const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 5_000,
    pingMaxRetries: 3,
    maxPayload: 16 * 1024,
  }),
  rooms: {
    village_siege: defineRoom(VillageSiegeRoom).filterBy(["roomCode"]),
  },
});

const port = Number.parseInt(process.env.PORT ?? "2567", 10);
await server.listen(Number.isFinite(port) ? port : 2567);
console.log(`Village Siege server listening on http://localhost:${Number.isFinite(port) ? port : 2567}`);
