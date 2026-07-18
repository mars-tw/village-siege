export const BEACON_IDS = ["westBeacon", "eastBeacon"] as const;
export type BeaconId = (typeof BEACON_IDS)[number];

export type SkirmishSide = "player" | "enemy";
export type ObjectiveController = SkirmishSide | "neutral";
export type SkirmishPhase = "preparation" | "engagement" | "reinforcement" | "showdown" | "finished";
export type SkirmishWinner = SkirmishSide;

export interface ForceSnapshot {
  readonly aliveUnits: number;
  readonly activeAttackers: number;
  readonly reserveUnits: number;
}

export interface BeaconPresence {
  readonly playerUnits: number;
  readonly enemyUnits: number;
}

export interface MonsterSnapshot {
  readonly id: string;
  readonly alive: boolean;
  /** A neutral monster may retaliate only against the side that first damaged it. */
  readonly provokedBy: SkirmishSide | null;
}

export interface SkirmishTickSnapshot {
  readonly player: ForceSnapshot;
  readonly enemy: ForceSnapshot;
  readonly beacons: Readonly<Record<BeaconId, BeaconPresence>>;
  readonly monsters: readonly MonsterSnapshot[];
}

export interface ObjectiveState {
  readonly id: BeaconId;
  readonly controller: ObjectiveController;
  /** Signed capture progress: -1 is enemy, 0 is neutral, +1 is player. */
  readonly progress: number;
}

export interface ScoreState {
  readonly player: number;
  readonly enemy: number;
}

export interface SkirmishDirectorState {
  readonly phase: SkirmishPhase;
  readonly elapsedMs: number;
  readonly objectives: Readonly<Record<BeaconId, ObjectiveState>>;
  readonly score: ScoreState;
  readonly enemyPressure: number;
  readonly winner: SkirmishWinner | null;
}

export type SkirmishDirectorEvent =
  | {
      readonly type: "phaseChanged";
      readonly previous: SkirmishPhase;
      readonly current: SkirmishPhase;
      readonly elapsedMs: number;
    }
  | {
      readonly type: "objectiveChanged";
      readonly objectiveId: BeaconId;
      readonly previousController: ObjectiveController;
      readonly controller: ObjectiveController;
      readonly previousProgress: number;
      readonly progress: number;
    }
  | {
      readonly type: "scoreChanged";
      readonly previous: ScoreState;
      readonly current: ScoreState;
      readonly delta: ScoreState;
    }
  | {
      readonly type: "reinforcementRequested";
      readonly side: SkirmishSide;
      readonly count: number;
      readonly pressure: number;
      readonly reason: "scheduled" | "showdown";
    }
  | {
      readonly type: "victory";
      readonly winner: SkirmishWinner;
      readonly reason: "victoryPoints" | "elimination";
      readonly score: ScoreState;
      readonly elapsedMs: number;
    };

export interface SkirmishDirectorConfig {
  readonly preparationDurationMs: number;
  readonly reinforcementPhaseAtMs: number;
  readonly showdownPhaseAtMs: number;
  readonly showdownScoreThreshold: number;
  readonly captureDurationMs: number;
  readonly objectiveReportStep: number;
  readonly victoryScore: number;
  readonly victoryPointsPerBeaconPerSecond: number;
  readonly enemyReinforcementIntervalMs: Readonly<Record<"engagement" | "reinforcement" | "showdown", number>>;
  readonly playerReinforcementIntervalMs: Readonly<Record<"reinforcement" | "showdown", number>>;
  readonly enemyWaveSize: Readonly<Record<"engagement" | "reinforcement" | "showdown", number>>;
  readonly playerWaveSize: Readonly<Record<"reinforcement" | "showdown", number>>;
  readonly maxEnemyActiveAttackers: number;
  readonly maxDeltaMs: number;
  /** Deterministic tie-break when both sides cross 100 during the same sub-step. */
  readonly simultaneousVictoryPriority: SkirmishSide;
}

export const DEFAULT_SKIRMISH_DIRECTOR_CONFIG: SkirmishDirectorConfig = Object.freeze({
  preparationDurationMs: 15_000,
  reinforcementPhaseAtMs: 70_000,
  showdownPhaseAtMs: 165_000,
  showdownScoreThreshold: 70,
  captureDurationMs: 8_000,
  objectiveReportStep: 0.05,
  victoryScore: 100,
  victoryPointsPerBeaconPerSecond: 1,
  enemyReinforcementIntervalMs: Object.freeze({ engagement: 18_000, reinforcement: 14_000, showdown: 10_000 }),
  playerReinforcementIntervalMs: Object.freeze({ reinforcement: 34_000, showdown: 25_000 }),
  enemyWaveSize: Object.freeze({ engagement: 1, reinforcement: 2, showdown: 3 }),
  playerWaveSize: Object.freeze({ reinforcement: 1, showdown: 2 }),
  maxEnemyActiveAttackers: 7,
  maxDeltaMs: 5_000,
  simultaneousVictoryPriority: "player",
});

interface MutableObjectiveState {
  readonly id: BeaconId;
  controller: ObjectiveController;
  progress: number;
  lastReportedProgress: number;
}

export class SkirmishDirector {
  private readonly config: SkirmishDirectorConfig;
  private phase: SkirmishPhase = "preparation";
  private elapsedMs = 0;
  private readonly objectives: Record<BeaconId, MutableObjectiveState>;
  private exactScore: Record<SkirmishSide, number> = { player: 0, enemy: 0 };
  private score: Record<SkirmishSide, number> = { player: 0, enemy: 0 };
  private enemyPressure = 0;
  private winner: SkirmishWinner | null = null;
  private nextEnemyReinforcementAtMs: number;
  private nextPlayerReinforcementAtMs: number;

  constructor(config: Partial<SkirmishDirectorConfig> = {}) {
    this.config = mergeConfig(config);
    validateConfig(this.config);
    this.objectives = createObjectiveStates();
    this.nextEnemyReinforcementAtMs = this.config.preparationDurationMs;
    this.nextPlayerReinforcementAtMs = this.config.reinforcementPhaseAtMs;
  }

  get state(): SkirmishDirectorState {
    return {
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      objectives: {
        westBeacon: publicObjective(this.objectives.westBeacon),
        eastBeacon: publicObjective(this.objectives.eastBeacon),
      },
      score: { ...this.score },
      enemyPressure: this.enemyPressure,
      winner: this.winner,
    };
  }

  reset(): void {
    this.phase = "preparation";
    this.elapsedMs = 0;
    this.exactScore = { player: 0, enemy: 0 };
    this.score = { player: 0, enemy: 0 };
    this.enemyPressure = 0;
    this.winner = null;
    this.nextEnemyReinforcementAtMs = this.config.preparationDurationMs;
    this.nextPlayerReinforcementAtMs = this.config.reinforcementPhaseAtMs;
    for (const id of BEACON_IDS) {
      const objective = this.objectives[id];
      objective.controller = "neutral";
      objective.progress = 0;
      objective.lastReportedProgress = 0;
    }
  }

  tick(deltaMs: number, snapshot: SkirmishTickSnapshot): readonly SkirmishDirectorEvent[] {
    validateDelta(deltaMs);
    validateSnapshot(snapshot);
    if (this.phase === "finished" || deltaMs === 0) return [];

    const appliedDeltaMs = Math.min(deltaMs, this.config.maxDeltaMs);
    const events: SkirmishDirectorEvent[] = [];
    this.elapsedMs += appliedDeltaMs;
    this.updatePhase(events);
    this.updateObjectives(appliedDeltaMs, snapshot, events);
    this.updateScore(appliedDeltaMs, events);
    this.enemyPressure = calculateEnemyPressure(this.phase, this.elapsedMs, this.config);
    this.requestReinforcements(snapshot, events);
    this.checkVictory(snapshot, events);
    return events;
  }

  /** Ranked, deterministic enemy-AI choices for the current phase and score. */
  rankAiTargets(candidates: readonly AiTargetCandidate[]): readonly AiTargetWeight[] {
    const context: AiTargetContext = {
      phase: this.phase,
      aiScore: this.score.enemy,
      playerScore: this.score.player,
      pressure: this.enemyPressure,
    };
    return calculateAiTargetWeights(candidates, context);
  }

  private updatePhase(events: SkirmishDirectorEvent[]): void {
    const previous = this.phase;
    let next: SkirmishPhase = previous;
    if (previous === "preparation" && this.elapsedMs >= this.config.preparationDurationMs) next = "engagement";
    if (previous === "engagement" && this.elapsedMs >= this.config.reinforcementPhaseAtMs) next = "reinforcement";
    if (
      previous === "reinforcement"
      && (this.elapsedMs >= this.config.showdownPhaseAtMs || Math.max(this.score.player, this.score.enemy) >= this.config.showdownScoreThreshold)
    ) next = "showdown";
    if (next !== previous) {
      this.phase = next;
      events.push({ type: "phaseChanged", previous, current: next, elapsedMs: this.elapsedMs });
    }
  }

  private updateObjectives(
    deltaMs: number,
    snapshot: SkirmishTickSnapshot,
    events: SkirmishDirectorEvent[],
  ): void {
    if (this.phase === "preparation") return;
    for (const id of BEACON_IDS) {
      const objective = this.objectives[id];
      const presence = snapshot.beacons[id];
      const previousProgress = objective.progress;
      const previousController = objective.controller;
      const advantage = PhaserlessClamp(presence.playerUnits - presence.enemyUnits, -2, 2);
      if (advantage !== 0) {
        objective.progress = PhaserlessClamp(
          objective.progress + advantage * deltaMs / this.config.captureDurationMs,
          -1,
          1,
        );
      }
      objective.controller = controllerForProgress(objective.progress, previousController);
      const progressMovedEnough = Math.abs(objective.progress - objective.lastReportedProgress) >= this.config.objectiveReportStep;
      if (objective.controller !== previousController || progressMovedEnough) {
        objective.lastReportedProgress = objective.progress;
        events.push({
          type: "objectiveChanged",
          objectiveId: id,
          previousController,
          controller: objective.controller,
          previousProgress,
          progress: objective.progress,
        });
      }
    }
  }

  private updateScore(deltaMs: number, events: SkirmishDirectorEvent[]): void {
    if (this.phase === "preparation") return;
    const previous = { ...this.score };
    const playerBeacons = controlledBeaconCount(this.objectives, "player");
    const enemyBeacons = controlledBeaconCount(this.objectives, "enemy");
    this.exactScore.player += playerBeacons * this.config.victoryPointsPerBeaconPerSecond * deltaMs / 1000;
    this.exactScore.enemy += enemyBeacons * this.config.victoryPointsPerBeaconPerSecond * deltaMs / 1000;
    this.score.player = Math.min(this.config.victoryScore, Math.floor(this.exactScore.player));
    this.score.enemy = Math.min(this.config.victoryScore, Math.floor(this.exactScore.enemy));
    if (this.score.player !== previous.player || this.score.enemy !== previous.enemy) {
      events.push({
        type: "scoreChanged",
        previous,
        current: { ...this.score },
        delta: { player: this.score.player - previous.player, enemy: this.score.enemy - previous.enemy },
      });
    }
  }

  private requestReinforcements(snapshot: SkirmishTickSnapshot, events: SkirmishDirectorEvent[]): void {
    if (this.phase === "preparation" || this.phase === "finished") return;
    const combatPhase = this.phase as "engagement" | "reinforcement" | "showdown";
    if (this.elapsedMs >= this.nextEnemyReinforcementAtMs && snapshot.enemy.reserveUnits > 0) {
      const targetActive = 1 + Math.floor(this.enemyPressure * (this.config.maxEnemyActiveAttackers - 1));
      const shortage = Math.max(0, targetActive - snapshot.enemy.activeAttackers);
      const count = Math.min(shortage, snapshot.enemy.reserveUnits, this.config.enemyWaveSize[combatPhase]);
      if (count > 0) {
        events.push({
          type: "reinforcementRequested",
          side: "enemy",
          count,
          pressure: this.enemyPressure,
          reason: combatPhase === "showdown" ? "showdown" : "scheduled",
        });
      }
      // Do not catch up missed waves: one bounded request per tick prevents an instant full-army push.
      this.nextEnemyReinforcementAtMs = this.elapsedMs + this.config.enemyReinforcementIntervalMs[combatPhase];
    }

    if (combatPhase === "engagement" || this.elapsedMs < this.nextPlayerReinforcementAtMs || snapshot.player.reserveUnits <= 0) return;
    const count = Math.min(snapshot.player.reserveUnits, this.config.playerWaveSize[combatPhase]);
    if (count > 0) {
      events.push({
        type: "reinforcementRequested",
        side: "player",
        count,
        pressure: this.enemyPressure,
        reason: combatPhase === "showdown" ? "showdown" : "scheduled",
      });
    }
    this.nextPlayerReinforcementAtMs = this.elapsedMs + this.config.playerReinforcementIntervalMs[combatPhase];
  }

  private checkVictory(snapshot: SkirmishTickSnapshot, events: SkirmishDirectorEvent[]): void {
    let winner: SkirmishWinner | null = null;
    let reason: "victoryPoints" | "elimination" = "victoryPoints";
    const playerReached = this.exactScore.player >= this.config.victoryScore;
    const enemyReached = this.exactScore.enemy >= this.config.victoryScore;
    if (playerReached && enemyReached) winner = this.config.simultaneousVictoryPriority;
    else if (playerReached) winner = "player";
    else if (enemyReached) winner = "enemy";
    else if (snapshot.player.aliveUnits <= 0 && snapshot.enemy.aliveUnits > 0) { winner = "enemy"; reason = "elimination"; }
    else if (snapshot.enemy.aliveUnits <= 0 && snapshot.player.aliveUnits > 0) { winner = "player"; reason = "elimination"; }
    if (!winner) return;
    const previous = this.phase;
    this.winner = winner;
    this.phase = "finished";
    events.push({ type: "phaseChanged", previous, current: "finished", elapsedMs: this.elapsedMs });
    events.push({ type: "victory", winner, reason, score: { ...this.score }, elapsedMs: this.elapsedMs });
  }
}

export type AiTargetKind = "player" | "beacon" | "monster";

export interface AiTargetCandidate {
  readonly id: string;
  readonly kind: AiTargetKind;
  readonly distance: number;
  readonly healthRatio: number;
  readonly threat: number;
  readonly objectiveController?: ObjectiveController;
  readonly rewardValue?: number;
  readonly monsterProvokedBy?: SkirmishSide | null;
}

export interface AiTargetContext {
  readonly phase: SkirmishPhase;
  readonly aiScore: number;
  readonly playerScore: number;
  readonly pressure: number;
}

export interface AiTargetWeight {
  readonly id: string;
  readonly kind: AiTargetKind;
  readonly weight: number;
  readonly reason: string;
}

export function calculateAiTargetWeights(
  candidates: readonly AiTargetCandidate[],
  context: AiTargetContext,
): readonly AiTargetWeight[] {
  return candidates.map((candidate) => {
    validateAiCandidate(candidate);
    const distancePenalty = Math.min(40, candidate.distance * 2.2);
    let weight = 0;
    let reason = "";
    if (candidate.kind === "player") {
      weight = 55 + candidate.threat * 24 + (1 - candidate.healthRatio) * 18 + context.pressure * 12 - distancePenalty;
      reason = "combat threat and vulnerable player unit";
    } else if (candidate.kind === "beacon") {
      const denied = candidate.objectiveController === "player" ? 26 : candidate.objectiveController === "neutral" ? 13 : -8;
      const scoreDeficit = Math.max(0, context.playerScore - context.aiScore) * 0.4;
      const phaseBonus = context.phase === "showdown" ? 25 : context.phase === "reinforcement" ? 15 : 6;
      weight = 62 + denied + scoreDeficit + phaseBonus - distancePenalty;
      reason = "victory-point objective pressure";
    } else {
      const retaliation = candidate.monsterProvokedBy === "enemy" ? 42 : 0;
      const reward = Math.min(24, Math.max(0, candidate.rewardValue ?? 0));
      const safetyPenalty = context.pressure > 0.65 ? 18 : 0;
      weight = 8 + retaliation + reward - safetyPenalty - distancePenalty;
      reason = retaliation > 0 ? "provoked monster retaliation" : "optional neutral reward";
    }
    return { id: candidate.id, kind: candidate.kind, weight: Math.round(weight * 100) / 100, reason };
  }).sort((left, right) => right.weight - left.weight || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

/** Neutral monsters never proactively retaliate against an unrecorded side. */
export function monsterMayRetaliate(monster: MonsterSnapshot, targetSide: SkirmishSide): boolean {
  return monster.alive && monster.provokedBy === targetSide;
}

function mergeConfig(config: Partial<SkirmishDirectorConfig>): SkirmishDirectorConfig {
  return {
    ...DEFAULT_SKIRMISH_DIRECTOR_CONFIG,
    ...config,
    enemyReinforcementIntervalMs: {
      ...DEFAULT_SKIRMISH_DIRECTOR_CONFIG.enemyReinforcementIntervalMs,
      ...config.enemyReinforcementIntervalMs,
    },
    playerReinforcementIntervalMs: {
      ...DEFAULT_SKIRMISH_DIRECTOR_CONFIG.playerReinforcementIntervalMs,
      ...config.playerReinforcementIntervalMs,
    },
    enemyWaveSize: { ...DEFAULT_SKIRMISH_DIRECTOR_CONFIG.enemyWaveSize, ...config.enemyWaveSize },
    playerWaveSize: { ...DEFAULT_SKIRMISH_DIRECTOR_CONFIG.playerWaveSize, ...config.playerWaveSize },
  };
}

function createObjectiveStates(): Record<BeaconId, MutableObjectiveState> {
  return {
    westBeacon: { id: "westBeacon", controller: "neutral", progress: 0, lastReportedProgress: 0 },
    eastBeacon: { id: "eastBeacon", controller: "neutral", progress: 0, lastReportedProgress: 0 },
  };
}

function publicObjective(objective: MutableObjectiveState): ObjectiveState {
  return { id: objective.id, controller: objective.controller, progress: objective.progress };
}

function controllerForProgress(progress: number, previous: ObjectiveController): ObjectiveController {
  if (progress >= 1) return "player";
  if (progress <= -1) return "enemy";
  if (previous === "player" && progress > 0) return "player";
  if (previous === "enemy" && progress < 0) return "enemy";
  return "neutral";
}

function controlledBeaconCount(
  objectives: Readonly<Record<BeaconId, ObjectiveState>>,
  side: SkirmishSide,
): number {
  return BEACON_IDS.reduce((total, id) => total + (objectives[id].controller === side ? 1 : 0), 0);
}

function calculateEnemyPressure(phase: SkirmishPhase, elapsedMs: number, config: SkirmishDirectorConfig): number {
  if (phase === "preparation" || phase === "finished") return phase === "finished" ? 1 : 0;
  if (phase === "engagement") {
    const span = Math.max(1, config.reinforcementPhaseAtMs - config.preparationDurationMs);
    return PhaserlessClamp(0.18 + (elapsedMs - config.preparationDurationMs) / span * 0.22, 0.18, 0.4);
  }
  if (phase === "reinforcement") {
    const span = Math.max(1, config.showdownPhaseAtMs - config.reinforcementPhaseAtMs);
    return PhaserlessClamp(0.48 + (elapsedMs - config.reinforcementPhaseAtMs) / span * 0.27, 0.48, 0.75);
  }
  return PhaserlessClamp(0.8 + (elapsedMs - config.showdownPhaseAtMs) / 120_000 * 0.2, 0.8, 1);
}

function validateConfig(config: SkirmishDirectorConfig): void {
  const positive = [
    config.preparationDurationMs,
    config.reinforcementPhaseAtMs,
    config.showdownPhaseAtMs,
    config.captureDurationMs,
    config.victoryScore,
    config.victoryPointsPerBeaconPerSecond,
    config.maxEnemyActiveAttackers,
    config.maxDeltaMs,
  ];
  if (positive.some((value) => !Number.isFinite(value) || value <= 0)) throw new RangeError("skirmish config values must be positive and finite");
  if (!(config.preparationDurationMs < config.reinforcementPhaseAtMs && config.reinforcementPhaseAtMs < config.showdownPhaseAtMs)) {
    throw new RangeError("skirmish phase thresholds must be strictly increasing");
  }
  if (config.showdownScoreThreshold <= 0 || config.showdownScoreThreshold >= config.victoryScore) throw new RangeError("showdownScoreThreshold must be between zero and victoryScore");
  if (config.objectiveReportStep <= 0 || config.objectiveReportStep > 1) throw new RangeError("objectiveReportStep must be within 0..1");
}

function validateDelta(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("deltaMs must be non-negative and finite");
}

function validateSnapshot(snapshot: SkirmishTickSnapshot): void {
  for (const force of [snapshot.player, snapshot.enemy]) {
    for (const value of [force.aliveUnits, force.activeAttackers, force.reserveUnits]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("force counts must be non-negative safe integers");
    }
  }
  for (const id of BEACON_IDS) {
    const presence = snapshot.beacons[id];
    if (!presence || !Number.isSafeInteger(presence.playerUnits) || presence.playerUnits < 0 || !Number.isSafeInteger(presence.enemyUnits) || presence.enemyUnits < 0) {
      throw new RangeError(`invalid beacon presence for ${id}`);
    }
  }
}

function validateAiCandidate(candidate: AiTargetCandidate): void {
  if (!candidate.id) throw new RangeError("AI target id is required");
  if (!Number.isFinite(candidate.distance) || candidate.distance < 0) throw new RangeError("AI target distance must be non-negative and finite");
  if (!Number.isFinite(candidate.healthRatio) || candidate.healthRatio < 0 || candidate.healthRatio > 1) throw new RangeError("AI target healthRatio must be within 0..1");
  if (!Number.isFinite(candidate.threat) || candidate.threat < 0 || candidate.threat > 1) throw new RangeError("AI target threat must be within 0..1");
}

function PhaserlessClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
