import { matchMaker } from "@colyseus/core";

const DEFAULT_PUBLIC_ORIGINS = ["https://mars-tw.github.io"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeConfiguredOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`ALLOWED_ORIGINS only accepts http/https origins: ${value}`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`ALLOWED_ORIGINS entries must be origins without credentials, paths, queries, or fragments: ${value}`);
  }
  return parsed.origin;
}

export function parseAllowedOrigins(value = process.env.ALLOWED_ORIGINS ?? ""): ReadonlySet<string> {
  const origins = new Set<string>(DEFAULT_PUBLIC_ORIGINS);
  for (const entry of value.split(",")) {
    const candidate = entry.trim();
    if (candidate) origins.add(normalizeConfiguredOrigin(candidate));
  }
  return origins;
}

export function isRequestOriginAllowed(
  origin: string | undefined,
  options: {
    readonly allowedOrigins?: ReadonlySet<string>;
    readonly nodeEnv?: string;
  } = {},
): boolean {
  // Native clients and server-to-server smoke tests do not send a browser Origin.
  // They still need the per-participant access token enforced by the room layer.
  if (!origin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return false;

  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins();
  if (allowedOrigins.has(parsed.origin)) return true;

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  return nodeEnv !== "production"
    && LOOPBACK_HOSTS.has(parsed.hostname)
    && parsed.protocol === "http:";
}

export function configureMatchmakingHttpSecurity(
  allowedOrigins = parseAllowedOrigins(),
  nodeEnv = process.env.NODE_ENV,
): void {
  const defaultHeaders = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
  Object.assign(defaultHeaders, {
    // Colyseus' browser SDK sends matchmaking fetches with credentials=include.
    // This is safe only because Access-Control-Allow-Origin is exact and never '*'.
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Origin, Content-Type, Accept, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": DEFAULT_PUBLIC_ORIGINS[0],
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });

  matchMaker.controller.getCorsHeaders = (headers: Headers): Record<string, string> => {
    const origin = headers.get("origin") ?? undefined;
    return {
      "Access-Control-Allow-Origin": isRequestOriginAllowed(origin, { allowedOrigins, nodeEnv })
        ? origin ?? DEFAULT_PUBLIC_ORIGINS[0]
        : DEFAULT_PUBLIC_ORIGINS[0],
    };
  };
}
