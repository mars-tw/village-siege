import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LobbyRoom } from "./rooms/LobbyRoom.js";
import { MatchRoom, configureMatchRecoveryStore, type MatchRoomRecoveryPayload } from "./rooms/MatchRoom.js";
import { createProductionRecoveryStore } from "./recovery/RedisPostgresMatchRecoveryStore.js";
import {
  configureMatchmakingHttpSecurity,
  isRequestOriginAllowed,
  parseAllowedOrigins,
} from "./security/originPolicy.js";

const allowedOrigins = parseAllowedOrigins();
configureMatchmakingHttpSecurity(allowedOrigins);

const redisUrl = process.env.REDIS_URL;
const postgresUrl = process.env.DATABASE_URL;
if (Boolean(redisUrl) !== Boolean(postgresUrl)) {
  throw new Error("REDIS_URL and DATABASE_URL must be configured together for durable match recovery");
}
const productionRecovery = redisUrl && postgresUrl
  ? await createProductionRecoveryStore<MatchRoomRecoveryPayload>({ redisUrl, postgresUrl })
  : undefined;
if (productionRecovery) configureMatchRecoveryStore(productionRecovery.store);

export const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 5_000,
    pingMaxRetries: 3,
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }: { origin: string | undefined }) => isRequestOriginAllowed(origin, { allowedOrigins }),
  }),
  rooms: {
    village_siege_lobby: defineRoom(LobbyRoom).filterBy(["roomCode"]),
    village_siege_match: defineRoom(MatchRoom),
  },
});
if (productionRecovery) server.onShutdown(productionRecovery.close);

const httpServer = server.transport.server;
if (httpServer) {
  httpServer.requestTimeout = 15_000;
  httpServer.headersTimeout = 10_000;
  httpServer.keepAliveTimeout = 5_000;
}

const port = Number.parseInt(process.env.PORT ?? "2567", 10);
await server.listen(Number.isFinite(port) ? port : 2567);
console.log(`Village Siege server listening on http://localhost:${Number.isFinite(port) ? port : 2567}`);
