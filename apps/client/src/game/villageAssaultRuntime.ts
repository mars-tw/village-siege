import {
  LANDMARK_VICTORY_HOLD_TICKS,
  TICK_MILLISECONDS,
  TIMED_CONTROL_START_TICK,
  TIMED_CONTROL_TARGET_TICKS,
  TOWN_CENTER_REBUILD_GRACE_TICKS,
  VILLAGE_ASSAULT_CONTROL_OBJECTIVE,
  VILLAGE_ASSAULT_MAP_ID,
  MatchPersistenceError,
  appendJournalAdvance,
  appendJournalAiAuthority,
  appendJournalCommand,
  applyCommand,
  createMatchCommandJournalFile,
  createMatchReplayFile,
  createMatchSaveFile,
  createInitialState,
  getAiObservation,
  parseMatchReplayFile,
  parseMatchSaveFile,
  projectDomainEventsForPlayer,
  reduceAi,
  replayMatchReplay,
  serializeMatchCommandJournalFile,
  serializeMatchReplayFile,
  serializeMatchSaveFile,
  toVisibleSnapshot,
  type AiDifficulty,
  type AiPersonality,
  type CommandEnvelope,
  type CommandRejectCode,
  type DomainEvent,
  type GameCommand,
  type GridPoint,
  type MatchState,
  type MatchCommandJournalFile,
  type MatchRuntimeSaveMetadata,
  type MatchSaveFile,
  type VisibleSnapshot,
  type VictoryPolicy,
  type VillageId,
} from "@village-siege/shared";
import { deriveVisibleTacticalSignalRaised } from "./aiTacticalSignals";

export const VILLAGE_ASSAULT_PLAYER_ID = "player-1";
export const VILLAGE_ASSAULT_AI_ID = "player-2";
export const VILLAGE_ASSAULT_MAP_SIZE = { id: VILLAGE_ASSAULT_MAP_ID, width: 18, height: 16 } as const;
export const VILLAGE_ASSAULT_SPAWNS = {
  player: { x: 3, y: 8 },
  ai: { x: 14, y: 8 },
} as const satisfies Readonly<Record<"player" | "ai", GridPoint>>;

/** Original multi-route victory policy used by the playable village assault. */
export const VILLAGE_ASSAULT_VICTORY_POLICY = {
  commandCenterConquest: { rebuildGraceTicks: TOWN_CENTER_REBUILD_GRACE_TICKS },
  elimination: true,
  landmark: {
    buildingType: "copperLandmark",
    requiredCount: 1,
    holdTicks: LANDMARK_VICTORY_HOLD_TICKS,
  },
  timedControl: {
    point: { ...VILLAGE_ASSAULT_CONTROL_OBJECTIVE.point },
    radius: VILLAGE_ASSAULT_CONTROL_OBJECTIVE.radius,
    startsAtTick: TIMED_CONTROL_START_TICK,
    targetTicks: TIMED_CONTROL_TARGET_TICKS,
  },
} as const satisfies VictoryPolicy;

const MAX_CATCH_UP_STEPS = 20;
export interface VillageAssaultRuntimeOptions {
  readonly playerVillageId: VillageId;
  readonly aiPersonality: AiPersonality;
  readonly aiVillageId?: VillageId;
  readonly aiDifficulty?: AiDifficulty;
  readonly aiBudgetMs?: number;
  readonly matchId?: string;
  readonly seed?: number;
  readonly victoryPolicy?: Partial<VictoryPolicy>;
}

export interface VillageAssaultRejectedCommand {
  readonly source: "player" | "ai";
  readonly sequence: number;
  readonly code: CommandRejectCode;
}

export interface VillageAssaultCommandResult {
  readonly accepted: boolean;
  readonly sequence: number;
  readonly rejectCode: CommandRejectCode | null;
  readonly events: readonly DomainEvent[];
  readonly state: MatchState;
}

export interface VillageAssaultStepResult {
  readonly steps: number;
  readonly events: readonly DomainEvent[];
  readonly latestRejection: VillageAssaultRejectedCommand | null;
  readonly state: MatchState;
}

/**
 * Client-side bridge for the deterministic shared rules engine.
 *
 * MatchState is the only gameplay source of truth. Phaser scenes should issue
 * commands here and render the returned state/events instead of mutating unit,
 * economy, construction, or training state themselves.
 */
export class VillageAssaultRuntime {
  readonly playerId = VILLAGE_ASSAULT_PLAYER_ID;
  readonly aiPlayerId = VILLAGE_ASSAULT_AI_ID;

  private matchState: MatchState;
  private aiBudgetMs: number;
  private playerSequence = 0;
  private accumulatorMs = 0;
  private replayBaseSave: MatchSaveFile;
  private commandJournal: MatchCommandJournalFile;
  private latestEvents: readonly DomainEvent[] = [];
  private rejectedCommand: VillageAssaultRejectedCommand | null = null;
  private cachedViewState?: MatchState;
  private cachedView?: VisibleSnapshot;

  constructor(options: VillageAssaultRuntimeOptions) {
    const aiVillageId = resolveAiVillage(options.playerVillageId, options.aiVillageId);
    const victoryPolicy: VictoryPolicy = {
      ...VILLAGE_ASSAULT_VICTORY_POLICY,
      ...options.victoryPolicy,
    };
    this.matchState = createInitialState({
      matchId: options.matchId ?? "village-assault-local",
      seed: options.seed ?? 1,
      map: { ...VILLAGE_ASSAULT_MAP_SIZE, layoutId: getPlayableLayoutId(options.playerVillageId) },
      players: [
        { id: this.playerId, teamId: "team-player", villageId: options.playerVillageId },
        {
          id: this.aiPlayerId,
          teamId: "team-ai",
          villageId: aiVillageId,
          ai: {
            personality: options.aiPersonality,
            difficulty: options.aiDifficulty ?? "standard",
          },
        },
      ],
      victoryPolicy,
    });
    this.aiBudgetMs = normalizeAiBudget(options.aiBudgetMs);
    this.replayBaseSave = createMatchSaveFile(this.matchState, this.runtimeSaveMetadata());
    this.matchState = this.replayBaseSave.snapshot.state;
    this.commandJournal = createMatchCommandJournalFile(this.matchState);
  }

  get state(): MatchState {
    return this.matchState;
  }

  get view(): VisibleSnapshot {
    if (this.cachedViewState !== this.matchState || !this.cachedView) {
      this.cachedViewState = this.matchState;
      this.cachedView = toVisibleSnapshot(this.matchState, this.playerId);
    }
    return this.cachedView;
  }

  get recentEvents(): readonly DomainEvent[] {
    return this.latestEvents;
  }

  get latestRejection(): VillageAssaultRejectedCommand | null {
    return this.rejectedCommand;
  }

  /** Owner-private authoritative save. It includes hidden fog and AI state. */
  exportSaveJson(): string {
    return serializeMatchSaveFile(createMatchSaveFile(this.matchState, this.runtimeSaveMetadata()));
  }

  /** Ordered operation journal rooted at the latest new-game/import checkpoint. */
  exportJournalJson(): string {
    return serializeMatchCommandJournalFile(this.commandJournal);
  }

  /** Owner-private replay. It is not a recipient-filtered share-safe snapshot. */
  exportReplayJson(): string {
    return serializeMatchReplayFile(createMatchReplayFile(
      this.replayBaseSave,
      this.commandJournal,
      this.runtimeSaveMetadata(),
      this.matchState,
    ));
  }

  /** Transactional restore: parsing and validation finish before runtime mutation. */
  importSaveJson(serialized: string): void {
    const save = parseMatchSaveFile(serialized);
    this.restoreRuntime(save.snapshot.state, save.runtime);
    this.replayBaseSave = save;
    this.commandJournal = createMatchCommandJournalFile(this.matchState);
  }

  /** Transactional verified replay reconstruction. */
  importReplayJson(serialized: string): void {
    const replay = parseMatchReplayFile(serialized);
    const reconstructed = replayMatchReplay(replay);
    this.restoreRuntime(reconstructed.state, reconstructed.runtime);
    // Import verifies the complete historical chain. Continuing play starts a
    // fresh checkpoint at the reconstructed final state so the imported file
    // remains immutable and the next local operation owns a clean cursor.
    this.replayBaseSave = createMatchSaveFile(this.matchState, this.runtimeSaveMetadata());
    this.commandJournal = createMatchCommandJournalFile(this.matchState);
  }

  issuePlayerCommand(command: GameCommand): VillageAssaultCommandResult {
    const sequence = this.playerSequence;
    this.playerSequence += 1;
    const envelope = this.createEnvelope(this.playerId, sequence, command);
    const before = this.matchState;
    const applied = applyCommand(before, envelope);
    let domainEvents = applied.events;
    if (applied.validation.ok) {
      const journaled = appendJournalCommand(this.commandJournal, before, envelope, "human");
      this.commandJournal = journaled.journal;
      this.matchState = journaled.state;
      domainEvents = journaled.events;
    } else {
      this.matchState = before;
    }
    const visibleEvents = projectDomainEventsForPlayer(
      this.matchState,
      this.playerId,
      { serverTick: this.matchState.tick, events: domainEvents },
      [sequence],
    );
    this.latestEvents = visibleEvents;
    const rejectCode = applied.validation.ok ? null : applied.validation.code;
    if (rejectCode) {
      this.rejectedCommand = { source: "player", sequence, code: rejectCode };
    }
    return {
      accepted: applied.validation.ok,
      sequence,
      rejectCode,
      events: visibleEvents,
      state: this.matchState,
    };
  }

  step(deltaMs: number): VillageAssaultStepResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError("deltaMs must be a finite non-negative number");
    }
    if (this.matchState.phase !== "playing") {
      this.accumulatorMs = 0;
      this.latestEvents = [];
      return this.stepResult(0, []);
    }

    this.accumulatorMs += deltaMs;
    const visibleEvents: DomainEvent[] = [];
    let steps = 0;
    while (
      this.accumulatorMs >= TICK_MILLISECONDS
      && steps < MAX_CATCH_UP_STEPS
      && this.matchState.phase === "playing"
    ) {
      const tickEvents: DomainEvent[] = [];
      this.runAiDecision(tickEvents);
      if (this.matchState.phase === "playing") {
        const advanced = appendJournalAdvance(this.commandJournal, this.matchState);
        this.commandJournal = advanced.journal;
        this.matchState = advanced.state;
        tickEvents.push(...advanced.events);
      }
      visibleEvents.push(...projectDomainEventsForPlayer(
        this.matchState,
        this.playerId,
        { serverTick: this.matchState.tick, events: tickEvents },
      ));
      this.accumulatorMs -= TICK_MILLISECONDS;
      steps += 1;
    }
    if (steps === MAX_CATCH_UP_STEPS && this.accumulatorMs >= TICK_MILLISECONDS) {
      this.accumulatorMs %= TICK_MILLISECONDS;
    }
    this.latestEvents = visibleEvents;
    return this.stepResult(steps, visibleEvents);
  }

  private runAiDecision(events: DomainEvent[]): void {
    const aiPlayerIds = this.matchState.aiControllers
      .map((authority) => authority.playerId)
      .sort(compareText);

    for (const playerId of aiPlayerIds) {
      const authority = this.matchState.aiControllers.find((candidate) => candidate.playerId === playerId);
      const player = this.matchState.players.find((candidate) => candidate.id === playerId);
      if (!authority || !player || player.surrendered || player.eliminated) continue;

      const reduced = reduceAi(
        authority,
        getAiObservation(this.matchState, playerId),
        this.aiBudgetMs,
      );
      const tacticalSignal = deriveVisibleTacticalSignalRaised(
        this.matchState,
        this.playerId,
        authority,
        reduced.authority,
        reduced.commands,
      );
      let phaseActionCommitted = reduced.commands.length === 0;
      const acceptedCommandSequences: number[] = [];

      for (const command of reduced.commands) {
        const player = this.matchState.players.find((candidate) => candidate.id === playerId);
        if (!player) break;
        const sequence = player.lastSequence + 1;
        const before = this.matchState;
        const envelope = this.createEnvelope(playerId, sequence, command);
        const applied = applyCommand(before, envelope);
        if (applied.validation.ok) {
          const journaled = appendJournalCommand(this.commandJournal, before, envelope, "ai");
          this.commandJournal = journaled.journal;
          this.matchState = journaled.state;
          events.push(...journaled.events);
          acceptedCommandSequences.push(sequence);
          phaseActionCommitted = true;
        } else {
          this.matchState = before;
          events.push(...applied.events);
        }
        if (!applied.validation.ok) {
          this.rejectedCommand = {
            source: "ai",
            sequence,
            code: applied.validation.code,
          };
        }
      }
      const authorityChanged = stableJsonString(authority) !== stableJsonString(reduced.authority);
      if (phaseActionCommitted && authorityChanged) {
        const committed = appendJournalAiAuthority(
          this.commandJournal,
          this.matchState,
          reduced.authority,
          reduced.commands.length === 0 ? "commandless" : "accepted-command",
          acceptedCommandSequences,
        );
        this.commandJournal = committed.journal;
        this.matchState = committed.state;
        if (tacticalSignal) events.push(tacticalSignal);
      }
    }
  }

  private runtimeSaveMetadata(): MatchRuntimeSaveMetadata {
    return {
      humanPlayerId: this.playerId,
      nextPlayerSequence: this.playerSequence,
      accumulatorMs: this.accumulatorMs,
      aiBudgetMs: this.aiBudgetMs,
    };
  }

  private restoreRuntime(state: MatchState, runtime: MatchRuntimeSaveMetadata): void {
    if (runtime.humanPlayerId !== this.playerId) {
      throw new MatchPersistenceError("INVALID_SCHEMA", "Village Assault save belongs to a different local player");
    }
    if (state.map.id !== VILLAGE_ASSAULT_MAP_ID
      || state.map.width !== VILLAGE_ASSAULT_MAP_SIZE.width
      || state.map.height !== VILLAGE_ASSAULT_MAP_SIZE.height
      || !state.map.layoutId) {
      throw new MatchPersistenceError("INVALID_SCHEMA", "Save does not use a supported Village Assault map");
    }
    if (!state.players.some((player) => player.id === this.aiPlayerId)
      || !state.aiControllers.some((authority) => authority.playerId === this.aiPlayerId)) {
      throw new MatchPersistenceError("INVALID_SCHEMA", "Save is missing the Village Assault opponent authority");
    }
    const validated = createMatchSaveFile(state, runtime);
    this.matchState = validated.snapshot.state;
    this.playerSequence = runtime.nextPlayerSequence;
    this.accumulatorMs = runtime.accumulatorMs;
    this.aiBudgetMs = normalizeAiBudget(runtime.aiBudgetMs);
    this.latestEvents = [];
    this.rejectedCommand = null;
    this.cachedViewState = undefined;
    this.cachedView = undefined;
  }

  private createEnvelope(playerId: string, sequence: number, command: GameCommand): CommandEnvelope {
    return {
      matchId: this.matchState.matchId,
      playerId,
      sequence,
      clientTick: this.matchState.tick,
      command,
    };
  }

  private stepResult(steps: number, events: readonly DomainEvent[]): VillageAssaultStepResult {
    return {
      steps,
      events,
      latestRejection: this.rejectedCommand,
      state: this.matchState,
    };
  }
}

function getPlayableLayoutId(villageId: VillageId): "pinehold" | "riverstead" | "highcrag" {
  return villageId === "riverstead" || villageId === "highcrag" ? villageId : "pinehold";
}

export function createVillageAssaultRuntime(options: VillageAssaultRuntimeOptions): VillageAssaultRuntime {
  return new VillageAssaultRuntime(options);
}

function resolveAiVillage(playerVillageId: VillageId, requestedAiVillageId?: VillageId): VillageId {
  if (requestedAiVillageId && requestedAiVillageId !== playerVillageId) return requestedAiVillageId;
  const cycle: readonly VillageId[] = ["pinehold", "riverstead", "highcrag", "marshwatch", "sunfield"];
  const index = cycle.indexOf(playerVillageId);
  return cycle[(index + 1 + cycle.length) % cycle.length]!;
}

function normalizeAiBudget(value: number | undefined): number {
  if (value === undefined) return 5;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("aiBudgetMs must be a finite positive number");
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonString(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonString).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJsonString(record[key])}`).join(",")}}`;
}
