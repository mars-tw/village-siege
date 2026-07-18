const port = Number.parseInt(process.env.SMOKE_PORT ?? "26567", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("SMOKE_PORT must be an integer between 1024 and 65535.");
}

process.env.PORT = String(port);
process.env.COLYSEUS_URL = `http://127.0.0.1:${port}`;

const { server } = await import("../apps/server/dist/index.js");

try {
  const { runMultiplayerSmoke } = await import("./multiplayer-smoke.mjs");
  await runMultiplayerSmoke();
} finally {
  await server.gracefullyShutdown(false);
}
