export function normalizeConnectOrigin(value) {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw new Error("PUBLIC_CONNECT_ORIGIN must be an exact HTTPS origin");
  }
  return parsed.origin;
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
