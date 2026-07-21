import { randomBytes } from "node:crypto";
import type { MatchParticipant } from "./authority/MatchAuthority.js";

export interface AuthorizedHumanMatchParticipant extends MatchParticipant {
  readonly accessToken: string;
  readonly ai?: undefined;
}

export interface AuthorizedAiMatchParticipant extends MatchParticipant {
  readonly ai: NonNullable<MatchParticipant["ai"]>;
  readonly accessToken?: undefined;
}

export type AuthorizedMatchParticipant = AuthorizedHumanMatchParticipant | AuthorizedAiMatchParticipant;

export function isAuthorizedHumanMatchParticipant(
  participant: AuthorizedMatchParticipant,
): participant is AuthorizedHumanMatchParticipant {
  return typeof participant.accessToken === "string" && participant.ai === undefined;
}

export interface MatchLaunch {
  readonly matchId: string;
  readonly seed: number;
  readonly participants: readonly AuthorizedMatchParticipant[];
}

const launches = new Map<string, MatchLaunch>();
const LAUNCH_LIFETIME_MILLISECONDS = 30_000;

/** Issues a process-private capability so public matchmaking cannot create a battlefield. */
export function issueMatchLaunch(launch: MatchLaunch): string {
  const token = randomBytes(32).toString("base64url");
  launches.set(token, launch);
  const timeout = setTimeout(() => launches.delete(token), LAUNCH_LIFETIME_MILLISECONDS);
  timeout.unref();
  return token;
}

/** Consumes the launch capability exactly once. */
export function consumeMatchLaunch(value: unknown): MatchLaunch {
  if (typeof value !== "string") throw new Error("Authoritative match launch capability is required.");
  const launch = launches.get(value);
  if (!launch) throw new Error("Invalid or expired authoritative match launch capability.");
  launches.delete(value);
  return launch;
}

export function revokeMatchLaunch(token: string): void {
  launches.delete(token);
}
