export function normalizeConnectOrigin(value) {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw new Error("PUBLIC_CONNECT_ORIGIN must be an exact HTTPS origin");
  }
  return parsed.origin;
}

export function validatePagesBuildConfig(enabled, endpoint) {
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("VILLAGE_SIEGE_MULTIPLAYER_ENABLED must be true or false");
  }
  const normalizedEndpoint = normalizeConnectOrigin(endpoint);
  if (enabled === "true" && !normalizedEndpoint) {
    throw new Error("VILLAGE_SIEGE_COLYSEUS_URL is required when public multiplayer is enabled");
  }
  return Object.freeze({ enabled, endpoint: normalizedEndpoint });
}

export function createRuntimeConfig(connectOrigin) {
  return Object.freeze({
    multiplayerEnabled: connectOrigin ? "true" : "false",
    ...(connectOrigin ? { colyseusUrl: connectOrigin } : {}),
  });
}

export function createRuntimeConfigBody(connectOrigin) {
  return `globalThis.__VILLAGE_SIEGE_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(
    createRuntimeConfig(connectOrigin),
  )});\n`;
}
