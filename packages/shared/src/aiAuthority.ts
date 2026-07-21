import { normalizeSeed } from "./random.js";
import type { AiAuthorityState, AiDifficulty, AiPersonality, PlayerId } from "./protocol.js";

/** Creates canonical planner state without importing the simulation or renderer. */
export function createAiAuthorityState(
  personality: AiPersonality,
  playerId: PlayerId,
  seed: number,
  difficulty: AiDifficulty = "standard",
): AiAuthorityState {
  return {
    playerId,
    personality,
    difficulty,
    randomState: normalizeSeed(seed ^ hashText(personality) ^ hashText(playerId)),
    lastDecisionTick: -decisionInterval(difficulty),
    phase: "economy",
    phaseStartedTick: 0,
    phaseLockedUntilTick: 0,
    enemyMemory: [],
    desiredCounterUnit: null,
    counterLockedUntilTick: 0,
    repairTargetId: null,
    regroupPoint: null,
    activeWave: null,
    waveIndex: 0,
    nextWaveAtTick: 0,
    nextScoutAtTick: 0,
    scoutIndex: 0,
    telemetry: {
      decisions: 0,
      scoutsSent: 0,
      repairsOrdered: 0,
      retreatsOrdered: 0,
      wavesLaunched: 0,
      counterSwitches: 0,
    },
  };
}

export function decisionInterval(difficulty: AiDifficulty): number {
  return difficulty === "novice" ? 40 : difficulty === "standard" ? 20 : 10;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
