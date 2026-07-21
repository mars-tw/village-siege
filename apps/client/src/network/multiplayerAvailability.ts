export interface MultiplayerAvailability {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly reason?: "disabled" | "missing-endpoint" | "insecure-endpoint";
}

export interface VillageSiegeRuntimeConfig {
  readonly multiplayerEnabled?: string;
  readonly colyseusUrl?: string;
}

type VillageSiegeRuntimeGlobal = {
  readonly __VILLAGE_SIEGE_RUNTIME_CONFIG__?: unknown;
};

export function readVillageSiegeRuntimeConfig(
  source: VillageSiegeRuntimeGlobal = globalThis as VillageSiegeRuntimeGlobal,
): VillageSiegeRuntimeConfig {
  const value = source.__VILLAGE_SIEGE_RUNTIME_CONFIG__;
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  return Object.freeze({
    ...(typeof candidate.multiplayerEnabled === "string"
      ? { multiplayerEnabled: candidate.multiplayerEnabled }
      : {}),
    ...(typeof candidate.colyseusUrl === "string"
      ? { colyseusUrl: candidate.colyseusUrl }
      : {}),
  });
}

export function resolveMultiplayerAvailability(options: {
  readonly enabled?: string;
  readonly endpoint?: string;
  readonly development: boolean;
}): MultiplayerAvailability {
  const explicitlyEnabled = options.enabled === "true";
  if (!options.development && !explicitlyEnabled) return { enabled: false, reason: "disabled" };

  const endpoint = options.endpoint?.trim();
  if (!endpoint) {
    return { enabled: false, reason: "missing-endpoint" };
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { enabled: false, reason: "missing-endpoint" };
  }
  if (parsed.origin !== endpoint || (parsed.protocol !== "https:" && !(options.development && parsed.protocol === "http:"))) {
    return { enabled: false, reason: "insecure-endpoint" };
  }
  return { enabled: true, endpoint: parsed.origin };
}

export function resolveConfiguredMultiplayerAvailability(options: {
  readonly runtime?: VillageSiegeRuntimeConfig;
  readonly build?: {
    readonly enabled?: string;
    readonly endpoint?: string;
  };
  readonly development: boolean;
}): MultiplayerAvailability {
  return resolveMultiplayerAvailability({
    enabled: options.runtime?.multiplayerEnabled ?? options.build?.enabled,
    endpoint: options.runtime?.colyseusUrl
      ?? options.build?.endpoint
      ?? (options.development ? "http://localhost:2567" : undefined),
    development: options.development,
  });
}

const runtimeConfig = readVillageSiegeRuntimeConfig();

export const multiplayerAvailability = resolveConfiguredMultiplayerAvailability({
  runtime: runtimeConfig,
  build: {
    enabled: import.meta.env.VITE_MULTIPLAYER_ENABLED,
    endpoint: import.meta.env.VITE_COLYSEUS_URL,
  },
  development: import.meta.env.DEV,
});
