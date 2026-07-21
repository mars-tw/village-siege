export interface MultiplayerAvailability {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly reason?: "disabled" | "missing-endpoint" | "insecure-endpoint";
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

export const multiplayerAvailability = resolveMultiplayerAvailability({
  enabled: import.meta.env.VITE_MULTIPLAYER_ENABLED,
  endpoint: import.meta.env.VITE_COLYSEUS_URL
    ?? (import.meta.env.DEV ? "http://localhost:2567" : undefined),
  development: import.meta.env.DEV,
});
