import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LobbyRoom } from "./rooms/LobbyRoom.js";
import { MatchRoom, configureMatchRecoveryStore, type MatchRoomRecoveryPayload } from "./rooms/MatchRoom.js";
import { createProductionRecoveryStore } from "./recovery/RedisPostgresMatchRecoveryStore.js";
import { resolveRecoveryConfiguration } from "./config/productionConfig.js";
import { readinessDocument, versionDocument } from "./http/serviceStatus.js";
import { serverMetrics } from "./observability/serverMetrics.js";
import {
  configureMatchmakingHttpSecurity,
  isRequestOriginAllowed,
  parseAllowedOrigins,
} from "./security/originPolicy.js";

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): JsonResponse;
}

interface TextResponse extends JsonResponse {
  status(code: number): TextResponse;
  type(contentType: string): TextResponse;
  send(body: string): TextResponse;
}

const allowedOrigins = parseAllowedOrigins();
configureMatchmakingHttpSecurity(allowedOrigins);

const recoveryConfiguration = resolveRecoveryConfiguration();
const productionRecovery = recoveryConfiguration.durable
  ? await createProductionRecoveryStore<MatchRoomRecoveryPayload>({
    redisUrl: recoveryConfiguration.redisUrl!,
    postgresUrl: recoveryConfiguration.postgresUrl!,
  })
  : undefined;
if (productionRecovery) configureMatchRecoveryStore(productionRecovery.store);

let draining = false;

export const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 5_000,
    pingMaxRetries: 3,
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }: { origin: string | undefined }) => {
      const allowed = isRequestOriginAllowed(origin, { allowedOrigins });
      if (!allowed) serverMetrics.webSocketOriginRejected();
      return allowed;
    },
  }),
  express: (app) => {
    app.get("/health/live", (_request: unknown, response: JsonResponse) => response.status(200).json({ status: "live" }));
    app.get("/health/ready", async (_request: unknown, response: JsonResponse) => {
      const result = await readinessDocument({
        isDraining: () => draining,
        checkDependencies: productionRecovery?.check,
      });
      response.status(result.statusCode).json(result.body);
    });
    app.get("/version", (_request: unknown, response: JsonResponse) => response.status(200).json(versionDocument()));
    // Production edge configuration must keep this route on the internal network.
    app.get("/metrics", (_request: unknown, response: TextResponse) => response
      .status(200)
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(serverMetrics.render()));
  },
  rooms: {
    village_siege_lobby: defineRoom(LobbyRoom).filterBy(["roomCode"]),
    village_siege_match: defineRoom(MatchRoom),
  },
});
server.onBeforeShutdown(() => { draining = true; });
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
