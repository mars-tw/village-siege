import { MATCH_PROTOCOL_VERSION, RULES_VERSION } from "@village-siege/shared";

export const APPLICATION_VERSION = "0.20.0";

export interface ServiceStatus {
  readonly isDraining: () => boolean;
  readonly checkDependencies?: () => Promise<void>;
}

export function versionDocument(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    name: "village-siege-server",
    version: APPLICATION_VERSION,
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    commit: sanitizeCommit(environment.GIT_COMMIT_SHA),
  } as const;
}

export async function readinessDocument(status: ServiceStatus): Promise<{
  readonly statusCode: 200 | 503;
  readonly body: { readonly status: "ready" | "draining" | "unavailable" };
}> {
  if (status.isDraining()) return { statusCode: 503, body: { status: "draining" } };
  try {
    await status.checkDependencies?.();
    return { statusCode: 200, body: { status: "ready" } };
  } catch {
    return { statusCode: 503, body: { status: "unavailable" } };
  }
}

function sanitizeCommit(value: string | undefined): string {
  return value && /^[a-f0-9]{7,64}$/i.test(value) ? value : "unknown";
}
