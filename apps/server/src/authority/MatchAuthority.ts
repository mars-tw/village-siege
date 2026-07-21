import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  TICKS_PER_SECOND,
  TICK_MILLISECONDS,
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ID,
  VILLAGE_ASSAULT_MAP_WIDTH,
  applyDisconnectedTeamDefeats,
  cloneMatchState,
  createInitialState,
  createVisibleSnapshotDelta,
  getAiObservation,
  hashMatchState,
  isCommandEnvelope,
  isMatchCommandIntent,
  isMatchCommandResult,
  projectDomainEventsForPlayer,
  reduceAi,
  stepSimulation,
  toVisibleSnapshot,
  type CanonicalStateHash,
  type AiDifficulty,
  type AiPersonality,
  type CommandEnvelope,
  type CommandRejectCode,
  type MatchCommandIntent,
  type MatchCommandResult,
  type MatchReplicationFrame,
  type MatchServerHello,
  type MatchState,
  type PlayableVillageId,
  type ReplicatedWorldEvent,
  type VisibleSnapshot,
} from "@village-siege/shared";

export { TICK_MILLISECONDS };

export const FULL_SNAPSHOT_INTERVAL_TICKS = 5 * TICKS_PER_SECOND;
export const CANONICAL_HASH_INTERVAL_TICKS = 2 * TICKS_PER_SECOND;
export const AUTHORITY_RECOVERY_CHECKPOINT_INTERVAL_TICKS = 20;
export const AUTHORITY_RECOVERY_SCHEMA_VERSION = 1 as const;

export interface MatchParticipant {
  readonly playerId: string;
  readonly teamId: string;
  readonly name: string;
  readonly villageId: PlayableVillageId;
  /** Server-owned deterministic participant. AI factions never receive a network seat or command acknowledgement. */
  readonly ai?: {
    readonly personality: AiPersonality;
    readonly difficulty: AiDifficulty;
  };
}

export type IntentSubmission =
  | {
      readonly queued: true;
      readonly duplicate: boolean;
      readonly commandId: string;
      readonly clientCommandSeq: number;
    }
  | {
      readonly queued: false;
      readonly replayed: boolean;
      readonly result: MatchCommandResult;
    };

export interface MatchTickResult {
  readonly serverTick: number;
  readonly phase: VisibleSnapshot["phase"];
  readonly frames: ReadonlyMap<string, MatchReplicationFrame>;
  readonly commandResults: ReadonlyMap<string, readonly MatchCommandResult[]>;
  /** Server-private deterministic checkpoint. Never serialize this into a recipient frame. */
  readonly canonicalCheckpoint?: CanonicalStateHash;
}

export type MatchAuthorityJournalEntry =
  | {
      readonly kind: "simulation";
      readonly fromTick: number;
      readonly toTick: number;
      readonly commands: readonly CommandEnvelope[];
      readonly stateHash: string;
    }
  | {
      readonly kind: "disconnect";
      readonly fromTick: number;
      readonly toTick: number;
      readonly teamIds: readonly string[];
      readonly stateHash: string;
    };

export interface MatchAuthorityRecoveryRecord {
  readonly schemaVersion: typeof AUTHORITY_RECOVERY_SCHEMA_VERSION;
  readonly protocolVersion: typeof MATCH_PROTOCOL_VERSION;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly matchId: string;
  readonly participants: readonly MatchParticipant[];
  readonly checkpoint: {
    readonly state: MatchState;
    readonly stateHash: string;
  };
  readonly journal: readonly MatchAuthorityJournalEntry[];
  readonly nextExpectedSequences: readonly {
    readonly playerId: string;
    readonly sequence: number;
  }[];
  readonly commandRecords: readonly {
    readonly playerId: string;
    readonly commandId: string;
    readonly intent: MatchCommandIntent;
    readonly fingerprint: string;
    readonly result?: MatchCommandResult;
  }[];
  readonly pendingCommands: readonly {
    readonly playerId: string;
    readonly sequence: number;
    readonly commandId: string;
  }[];
}

interface CommandRecord {
  readonly intent: MatchCommandIntent;
  readonly fingerprint: string;
  result?: MatchCommandResult;
}

interface QueuedCommand {
  readonly envelope: CommandEnvelope;
  readonly record: CommandRecord;
}

interface AuthorityCommandExecution {
  readonly envelope: CommandEnvelope;
  readonly human?: QueuedCommand;
}

interface AiTickPlan {
  readonly state: MatchState;
  readonly commands: readonly CommandEnvelope[];
}

const MAX_BUFFERED_COMMANDS_PER_PLAYER = 16;
const MAX_COMPLETED_COMMAND_RECORDS_PER_PLAYER = 512;

/**
 * Owns the canonical online match state. Callers can obtain only recipient-
 * filtered snapshots, deltas and world events; complete MatchState stays private.
 */
export class MatchAuthority {
  readonly matchId: string;
  readonly participants: readonly MatchParticipant[];
  private state: MatchState;
  private readonly pendingByPlayer = new Map<string, Map<number, QueuedCommand>>();
  private readonly recordByPlayer = new Map<string, Map<string, CommandRecord>>();
  private readonly nextExpectedSequence = new Map<string, number>();
  private readonly lastVisibleSnapshot = new Map<string, VisibleSnapshot>();
  private checkpointState: MatchState;
  private checkpointStateHash: string;
  private journal: MatchAuthorityJournalEntry[] = [];

  constructor(matchId: string, seed: number, participants: readonly MatchParticipant[]) {
    assertParticipants(participants);
    this.matchId = matchId;
    this.participants = participants.map((participant) => ({ ...participant }));
    this.state = createInitialState({
      matchId,
      seed,
      players: participants.map((participant) => ({
        id: participant.playerId,
        teamId: participant.teamId,
        villageId: participant.villageId,
        ...(participant.ai ? { ai: { ...participant.ai } } : {}),
      })),
      map: {
        id: VILLAGE_ASSAULT_MAP_ID,
        width: VILLAGE_ASSAULT_MAP_WIDTH,
        height: VILLAGE_ASSAULT_MAP_HEIGHT,
        layoutId: participants[0]!.villageId,
      },
    });
    this.checkpointState = cloneMatchState(this.state);
    this.checkpointStateHash = hashMatchState(this.checkpointState);
    for (const player of this.state.players.filter((candidate) => this.isNetworkPlayer(candidate.id))) {
      this.pendingByPlayer.set(player.id, new Map());
      this.recordByPlayer.set(player.id, new Map());
      this.nextExpectedSequence.set(player.id, player.lastSequence + 1);
    }
  }

  static restore(record: MatchAuthorityRecoveryRecord): MatchAuthority {
    try {
      const parsed = validateRecoveryRecord(record);
      const authority = new MatchAuthority(parsed.matchId, 1, parsed.participants);
      let restoredState = cloneMatchState(parsed.checkpoint.state);
      let previousTick = restoredState.tick;
      for (const operation of parsed.journal) {
        if (operation.fromTick !== previousTick) throw new Error("Authority recovery journal has a tick gap");
        let replayed;
        if (operation.kind === "simulation") {
          const stateBeforeAiPlanning = restoredState;
          const aiPlan = planAiTick(restoredState, parsed.participants);
          const aiPlayerIds = new Set(parsed.participants.filter((participant) => participant.ai).map((participant) => participant.playerId));
          const recordedAiCommands = operation.commands.filter((command) => aiPlayerIds.has(command.playerId));
          if (canonicalJson(recordedAiCommands) !== canonicalJson(aiPlan.commands)) {
            throw new Error("Authority recovery AI command batch diverged from deterministic planning");
          }
          replayed = stepSimulation(aiPlan.state, operation.commands, 1);
          rollbackRejectedAiAuthorities(
            stateBeforeAiPlanning,
            replayed.state,
            operation.commands,
            replayed.events,
            parsed.participants,
          );
        } else {
          replayed = applyDisconnectedTeamDefeats(restoredState, operation.teamIds);
        }
        if (replayed.state.tick !== operation.toTick || hashMatchState(replayed.state) !== operation.stateHash) {
          throw new Error("Authority recovery journal diverged from its committed state hash");
        }
        restoredState = replayed.state;
        previousTick = operation.toTick;
      }
      authority.state = restoredState;
      authority.checkpointState = cloneMatchState(parsed.checkpoint.state);
      authority.checkpointStateHash = parsed.checkpoint.stateHash;
      authority.journal = cloneWire([...parsed.journal]);
      authority.pendingByPlayer.clear();
      authority.recordByPlayer.clear();
      authority.nextExpectedSequence.clear();
      authority.lastVisibleSnapshot.clear();
      for (const participant of authority.networkParticipants()) {
        authority.pendingByPlayer.set(participant.playerId, new Map());
        authority.recordByPlayer.set(participant.playerId, new Map());
      }
      for (const cursor of parsed.nextExpectedSequences) {
        authority.nextExpectedSequence.set(cursor.playerId, cursor.sequence);
      }
      for (const persisted of parsed.commandRecords) {
        const recordMap = authority.recordByPlayer.get(persisted.playerId)!;
        recordMap.set(persisted.commandId, {
          intent: cloneIntent(persisted.intent),
          fingerprint: persisted.fingerprint,
          ...(persisted.result ? { result: cloneResult(persisted.result) } : {}),
        });
      }
      for (const pending of parsed.pendingCommands) {
        const commandRecord = authority.recordByPlayer.get(pending.playerId)!.get(pending.commandId)!;
        authority.pendingByPlayer.get(pending.playerId)!.set(pending.sequence, {
          record: commandRecord,
          envelope: envelopeForIntent(parsed.matchId, pending.playerId, commandRecord.intent),
        });
      }
      return authority;
    } catch (error) {
      if (error instanceof AuthorityRecoveryStateCorruptError) throw error;
      throw new AuthorityRecoveryStateCorruptError(
        error instanceof Error ? error.message : "Authority recovery state is corrupt",
      );
    }
  }

  get serverTick(): number {
    return this.state.tick;
  }

  get phase(): VisibleSnapshot["phase"] {
    return this.state.phase;
  }

  hasPlayer(playerId: string): boolean {
    return this.isNetworkPlayer(playerId);
  }

  serverHello(playerId: string): MatchServerHello {
    if (!this.hasPlayer(playerId)) throw new Error(`Unknown hello recipient: ${playerId}`);
    const next = this.nextExpectedSequence.get(playerId) ?? 0;
    return {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: this.matchId,
      recipientPlayerId: playerId,
      tickMilliseconds: TICK_MILLISECONDS,
      fullSnapshotIntervalTicks: FULL_SNAPSHOT_INTERVAL_TICKS,
      canonicalHashIntervalTicks: CANONICAL_HASH_INTERVAL_TICKS,
      lastReceivedClientCommandSeq: next - 1,
      nextClientCommandSeq: next,
    };
  }

  submitIntent(playerId: string, payload: unknown): IntentSubmission {
    const extracted = extractIntentIdentity(payload);
    if (!this.hasPlayer(playerId)) return rejected(extracted, "NOT_ROOM_MEMBER", this.serverTick);
    if (isRecord(payload) && payload.protocolVersion !== MATCH_PROTOCOL_VERSION) {
      return rejected(extracted, "PROTOCOL_MISMATCH", this.serverTick);
    }
    if (isRecord(payload) && payload.rulesVersion !== RULES_VERSION) {
      return rejected(extracted, "RULES_MISMATCH", this.serverTick);
    }
    if (!isMatchCommandIntent(payload) || payload.lastServerTickSeen > this.serverTick) {
      return rejected(extracted, "INVALID_PAYLOAD", this.serverTick);
    }
    if (this.state.phase !== "playing") {
      return rejected(identityOf(payload), "MATCH_NOT_PLAYING", this.serverTick);
    }

    const records = this.recordByPlayer.get(playerId)!;
    const fingerprint = canonicalJson(payload);
    const existing = records.get(payload.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return rejected(identityOf(payload), "COMMAND_ID_CONFLICT", this.serverTick);
      }
      if (existing.result) return { queued: false, replayed: true, result: cloneResult(existing.result) };
      return {
        queued: true,
        duplicate: true,
        commandId: payload.commandId,
        clientCommandSeq: payload.clientCommandSeq,
      };
    }

    const pending = this.pendingByPlayer.get(playerId)!;
    const nextExpected = this.nextExpectedSequence.get(playerId)!;
    if (payload.clientCommandSeq < nextExpected) {
      return rejected(identityOf(payload), "STALE_OR_DUPLICATE_SEQUENCE", this.serverTick);
    }
    const sequenceCollision = pending.get(payload.clientCommandSeq);
    if (sequenceCollision) {
      return rejected(identityOf(payload), "COMMAND_ID_CONFLICT", this.serverTick);
    }
    if (payload.clientCommandSeq >= nextExpected + MAX_BUFFERED_COMMANDS_PER_PLAYER
      || pending.size >= MAX_BUFFERED_COMMANDS_PER_PLAYER) {
      return rejected(identityOf(payload), "RATE_LIMITED", this.serverTick);
    }

    const record: CommandRecord = { intent: cloneIntent(payload), fingerprint };
    const envelope: CommandEnvelope = {
      matchId: this.matchId,
      playerId,
      sequence: payload.clientCommandSeq,
      clientTick: payload.lastServerTickSeen,
      command: payload.command,
    };
    records.set(payload.commandId, record);
    pending.set(payload.clientCommandSeq, { envelope, record });
    return {
      queued: true,
      duplicate: false,
      commandId: payload.commandId,
      clientCommandSeq: payload.clientCommandSeq,
    };
  }

  initialFrames(): ReadonlyMap<string, MatchReplicationFrame> {
    return new Map(this.networkParticipants().map((participant) => [
      participant.playerId,
      this.fullSnapshotFrame(participant.playerId, []),
    ]));
  }

  forceSnapshotFrame(playerId: string): MatchReplicationFrame {
    if (!this.hasPlayer(playerId)) throw new Error(`Unknown snapshot recipient: ${playerId}`);
    return this.fullSnapshotFrame(playerId, []);
  }

  recoveryRecord(): MatchAuthorityRecoveryRecord {
    const commandRecords: MatchAuthorityRecoveryRecord["commandRecords"][number][] = [];
    const pendingCommands: MatchAuthorityRecoveryRecord["pendingCommands"][number][] = [];
    for (const participant of this.networkParticipants()) {
      for (const [commandId, record] of this.recordByPlayer.get(participant.playerId)!) {
        commandRecords.push({
          playerId: participant.playerId,
          commandId,
          intent: cloneIntent(record.intent),
          fingerprint: record.fingerprint,
          ...(record.result ? { result: cloneResult(record.result) } : {}),
        });
      }
      for (const [sequence, queued] of this.pendingByPlayer.get(participant.playerId)!) {
        pendingCommands.push({ playerId: participant.playerId, sequence, commandId: queued.record.intent.commandId });
      }
    }
    commandRecords.sort((left, right) => compareText(left.playerId, right.playerId)
      || left.intent.clientCommandSeq - right.intent.clientCommandSeq
      || compareText(left.commandId, right.commandId));
    pendingCommands.sort((left, right) => compareText(left.playerId, right.playerId)
      || left.sequence - right.sequence
      || compareText(left.commandId, right.commandId));
    return cloneWire({
      schemaVersion: AUTHORITY_RECOVERY_SCHEMA_VERSION,
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: this.matchId,
      participants: this.participants,
      checkpoint: { state: this.checkpointState, stateHash: this.checkpointStateHash },
      journal: this.journal,
      nextExpectedSequences: this.networkParticipants().map((participant) => ({
        playerId: participant.playerId,
        sequence: this.nextExpectedSequence.get(participant.playerId)!,
      })),
      commandRecords,
      pendingCommands,
    });
  }

  step(): MatchTickResult {
    const queued = this.drainContiguousCommands();
    const stateBeforeAiPlanning = this.state;
    const aiPlan = planAiTick(this.state, this.participants);
    this.state = aiPlan.state;
    const executions: AuthorityCommandExecution[] = [
      ...queued.map((human) => ({ envelope: human.envelope, human })),
      ...aiPlan.commands.map((envelope) => ({ envelope })),
    ].sort((left, right) => (
      compareText(left.envelope.playerId, right.envelope.playerId)
      || left.envelope.sequence - right.envelope.sequence
      || compareText(canonicalJson(left.envelope.command), canonicalJson(right.envelope.command))
    ));
    const fromTick = this.state.tick;
    const advanced = stepSimulation(this.state, executions.map((entry) => entry.envelope), 1);
    rollbackRejectedAiAuthorities(
      stateBeforeAiPlanning,
      advanced.state,
      executions.map((entry) => entry.envelope),
      advanced.events,
      this.participants,
    );
    this.state = advanced.state;
    this.recordJournalEntry({
      kind: "simulation",
      fromTick,
      toTick: this.state.tick,
      commands: executions.map((entry) => cloneWire(entry.envelope)),
      stateHash: hashMatchState(this.state),
    });
    const acknowledgements = advanced.events.filter((event) => (
      event.type === "commandAccepted" || event.type === "commandRejected"
    ));
    if (acknowledgements.length !== executions.length) {
      throw new Error("Authoritative command acknowledgement count diverged from the command batch");
    }

    const resultsByPlayer = new Map<string, MatchCommandResult[]>();
    for (const [index, execution] of executions.entries()) {
      const acknowledgement = acknowledgements[index]!;
      const entry = execution.human;
      if (!entry) continue;
      const result: MatchCommandResult = acknowledgement.type === "commandAccepted"
        ? {
            commandId: entry.record.intent.commandId,
            clientCommandSeq: entry.envelope.sequence,
            accepted: true,
            serverTick: this.state.tick,
          }
        : {
            commandId: entry.record.intent.commandId,
            clientCommandSeq: entry.envelope.sequence,
            accepted: false,
            code: acknowledgement.code,
            serverTick: this.state.tick,
          };
      entry.record.result = cloneResult(result);
      const ownResults = resultsByPlayer.get(entry.envelope.playerId) ?? [];
      ownResults.push(result);
      resultsByPlayer.set(entry.envelope.playerId, ownResults);
    }
    for (const participant of this.networkParticipants()) this.trimCompletedRecords(participant.playerId);

    const worldEvents = advanced.events.filter((event): event is ReplicatedWorldEvent => (
      event.type !== "commandAccepted" && event.type !== "commandRejected"
    ));
    const frames = new Map<string, MatchReplicationFrame>();
    for (const participant of this.networkParticipants()) {
      const events = projectDomainEventsForPlayer(
        this.state,
        participant.playerId,
        { serverTick: this.state.tick, events: worldEvents },
      ) as ReplicatedWorldEvent[];
      frames.set(participant.playerId, this.replicationFrame(participant.playerId, events));
    }
    const checkpoint = this.state.tick % CANONICAL_HASH_INTERVAL_TICKS === 0
      ? { algorithm: "fnv1a-32" as const, serverTick: this.state.tick, value: hashMatchState(this.state) }
      : undefined;
    return {
      serverTick: this.state.tick,
      phase: this.state.phase,
      frames,
      commandResults: resultsByPlayer,
      ...(checkpoint ? { canonicalCheckpoint: checkpoint } : {}),
    };
  }

  expireDisconnectedTeams(teamIds: readonly string[]): MatchTickResult {
    const orderedTeamIds = [...new Set(teamIds)].sort(compareText);
    const fromTick = this.state.tick;
    const advanced = applyDisconnectedTeamDefeats(this.state, orderedTeamIds);
    this.state = advanced.state;
    if (this.state.tick !== fromTick) {
      this.recordJournalEntry({
        kind: "disconnect",
        fromTick,
        toTick: this.state.tick,
        teamIds: orderedTeamIds,
        stateHash: hashMatchState(this.state),
      });
    }
    const worldEvents = advanced.events.filter((event): event is ReplicatedWorldEvent => (
      event.type !== "commandAccepted" && event.type !== "commandRejected"
    ));
    const frames = new Map<string, MatchReplicationFrame>();
    for (const participant of this.networkParticipants()) {
      const events = projectDomainEventsForPlayer(
        this.state,
        participant.playerId,
        { serverTick: this.state.tick, events: worldEvents },
      ) as ReplicatedWorldEvent[];
      frames.set(participant.playerId, this.replicationFrame(participant.playerId, events));
    }
    const checkpoint = this.state.tick % CANONICAL_HASH_INTERVAL_TICKS === 0
      ? { algorithm: "fnv1a-32" as const, serverTick: this.state.tick, value: hashMatchState(this.state) }
      : undefined;
    return {
      serverTick: this.state.tick,
      phase: this.state.phase,
      frames,
      commandResults: new Map(),
      ...(checkpoint ? { canonicalCheckpoint: checkpoint } : {}),
    };
  }

  private drainContiguousCommands(): QueuedCommand[] {
    const drained: QueuedCommand[] = [];
    for (const participant of this.networkParticipants()) {
      const pending = this.pendingByPlayer.get(participant.playerId)!;
      let next = this.nextExpectedSequence.get(participant.playerId)!;
      while (pending.has(next)) {
        drained.push(pending.get(next)!);
        pending.delete(next);
        next += 1;
      }
      this.nextExpectedSequence.set(participant.playerId, next);
    }
    return drained;
  }

  private recordJournalEntry(entry: MatchAuthorityJournalEntry): void {
    if (entry.toTick <= entry.fromTick) throw new Error("Authority journal revisions must advance");
    if (this.journal.length > 0 && this.journal[this.journal.length - 1]!.toTick !== entry.fromTick) {
      throw new Error("Authority journal revisions must be contiguous");
    }
    this.journal.push(cloneWire(entry));
    if (this.state.tick % AUTHORITY_RECOVERY_CHECKPOINT_INTERVAL_TICKS === 0 || this.state.phase === "finished") {
      this.checkpointState = cloneMatchState(this.state);
      this.checkpointStateHash = hashMatchState(this.checkpointState);
      this.journal = [];
    }
  }

  private replicationFrame(playerId: string, events: readonly ReplicatedWorldEvent[]): MatchReplicationFrame {
    const snapshot = toVisibleSnapshot(this.state, playerId);
    const previous = this.lastVisibleSnapshot.get(playerId);
    const mustSendFull = !previous
      || snapshot.serverTick % FULL_SNAPSHOT_INTERVAL_TICKS === 0
      || snapshot.phase === "finished";
    if (mustSendFull) return this.rememberSnapshot(snapshot, events);
    const delta = createVisibleSnapshotDelta(previous, snapshot);
    this.lastVisibleSnapshot.set(playerId, snapshot);
    return {
      kind: "delta",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: this.matchId,
      recipientPlayerId: playerId,
      serverTick: snapshot.serverTick,
      events: [...events],
      delta,
    };
  }

  private fullSnapshotFrame(playerId: string, events: readonly ReplicatedWorldEvent[]): MatchReplicationFrame {
    return this.rememberSnapshot(toVisibleSnapshot(this.state, playerId), events);
  }

  private rememberSnapshot(
    snapshot: VisibleSnapshot,
    events: readonly ReplicatedWorldEvent[],
  ): MatchReplicationFrame {
    this.lastVisibleSnapshot.set(snapshot.recipientPlayerId, snapshot);
    return {
      kind: "snapshot",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: this.matchId,
      recipientPlayerId: snapshot.recipientPlayerId,
      serverTick: snapshot.serverTick,
      events: [...events],
      snapshot,
    };
  }

  private trimCompletedRecords(playerId: string): void {
    const records = this.recordByPlayer.get(playerId)!;
    const completed = [...records.entries()].filter(([, record]) => record.result);
    const excess = completed.length - MAX_COMPLETED_COMMAND_RECORDS_PER_PLAYER;
    for (let index = 0; index < excess; index += 1) records.delete(completed[index]![0]);
  }

  private networkParticipants(): readonly MatchParticipant[] {
    return this.participants.filter((participant) => !participant.ai);
  }

  private isNetworkPlayer(playerId: string): boolean {
    return this.participants.some((participant) => participant.playerId === playerId && !participant.ai);
  }
}

function planAiTick(state: MatchState, participants: readonly MatchParticipant[]): AiTickPlan {
  const next = cloneMatchState(state);
  const commands: CommandEnvelope[] = [];
  const aiParticipants = participants
    .filter((participant) => participant.ai)
    .sort((left, right) => compareText(left.playerId, right.playerId));

  for (const participant of aiParticipants) {
    const player = next.players.find((candidate) => candidate.id === participant.playerId);
    const authority = next.aiControllers.find((candidate) => candidate.playerId === participant.playerId);
    if (!player || !authority) throw new Error(`Missing canonical AI authority for ${participant.playerId}`);
    if (player.surrendered || player.eliminated || next.phase !== "playing") continue;

    const reduced = reduceAi(authority, getAiObservation(next, participant.playerId), 5);
    next.aiControllers = next.aiControllers
      .map((candidate) => candidate.playerId === participant.playerId ? cloneWire(reduced.authority) : candidate)
      .sort((left, right) => compareText(left.playerId, right.playerId));
    let nextSequence = player.lastSequence + 1;
    for (const command of reduced.commands) {
      commands.push({
        matchId: next.matchId,
        playerId: participant.playerId,
        sequence: nextSequence,
        clientTick: next.tick,
        command: cloneWire(command),
      });
      nextSequence += 1;
    }
  }

  return {
    state: next,
    commands: commands.sort((left, right) => (
      compareText(left.playerId, right.playerId)
      || left.sequence - right.sequence
      || compareText(canonicalJson(left.command), canonicalJson(right.command))
    )),
  };
}

export function rollbackRejectedAiAuthorities(
  stateBeforePlanning: MatchState,
  stateAfterStep: MatchState,
  orderedCommands: readonly CommandEnvelope[],
  events: readonly { readonly type: string }[],
  participants: readonly MatchParticipant[],
): void {
  const acknowledgements = events.filter((event) => (
    event.type === "commandAccepted" || event.type === "commandRejected"
  ));
  if (acknowledgements.length !== orderedCommands.length) return;
  const aiPlayerIds = new Set(participants.filter((participant) => participant.ai).map((participant) => participant.playerId));
  const rejectedAiPlayerIds = new Set<string>();
  orderedCommands.forEach((command, index) => {
    if (aiPlayerIds.has(command.playerId) && acknowledgements[index]?.type === "commandRejected") {
      rejectedAiPlayerIds.add(command.playerId);
    }
  });
  if (rejectedAiPlayerIds.size === 0) return;
  const previousByPlayer = new Map(stateBeforePlanning.aiControllers.map((authority) => [authority.playerId, authority]));
  stateAfterStep.aiControllers = stateAfterStep.aiControllers.map((authority) => {
    if (!rejectedAiPlayerIds.has(authority.playerId)) return authority;
    const previous = previousByPlayer.get(authority.playerId);
    if (!previous) throw new Error(`Missing previous AI authority for rejected command: ${authority.playerId}`);
    return cloneWire(previous);
  });
}

function assertParticipants(participants: readonly MatchParticipant[]): void {
  if (participants.length < 2 || participants.length > 5) throw new RangeError("A match requires two to five participants");
  if (new Set(participants.map((participant) => participant.playerId)).size !== participants.length) {
    throw new Error("Match participant ids must be unique");
  }
  if (new Set(participants.map((participant) => participant.teamId)).size < 2) {
    throw new Error("A match requires at least two opposing teams");
  }
  if (!participants.some((participant) => !participant.ai)) {
    throw new Error("A network match requires at least one human participant");
  }
  for (const participant of participants) {
    if (participant.ai && !isAiConfiguration(participant.ai)) {
      throw new Error(`Invalid AI configuration for ${participant.playerId}`);
    }
  }
}

function isAiConfiguration(value: unknown): value is NonNullable<MatchParticipant["ai"]> {
  return isRecord(value)
    && (value.personality === "aggressor"
      || value.personality === "guardian"
      || value.personality === "prosperer"
      || value.personality === "balanced"
      || value.personality === "raider")
    && (value.difficulty === "novice" || value.difficulty === "standard" || value.difficulty === "veteran")
    && Object.keys(value).every((key) => key === "personality" || key === "difficulty");
}

function rejected(
  identity: { readonly commandId: string | null; readonly clientCommandSeq: number },
  code: Exclude<Extract<MatchCommandResult, { accepted: false }>["code"], never>,
  serverTick: number,
): IntentSubmission {
  return {
    queued: false,
    replayed: false,
    result: {
      commandId: identity.commandId,
      clientCommandSeq: identity.clientCommandSeq,
      accepted: false,
      code,
      serverTick,
    },
  };
}

function extractIntentIdentity(value: unknown): { readonly commandId: string | null; readonly clientCommandSeq: number } {
  if (!isRecord(value)) return { commandId: null, clientCommandSeq: 0 };
  return {
    commandId: typeof value.commandId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value.commandId)
      ? value.commandId
      : null,
    clientCommandSeq: Number.isSafeInteger(value.clientCommandSeq) && (value.clientCommandSeq as number) >= 0
      ? value.clientCommandSeq as number
      : 0,
  };
}

function identityOf(intent: MatchCommandIntent): { readonly commandId: string; readonly clientCommandSeq: number } {
  return { commandId: intent.commandId, clientCommandSeq: intent.clientCommandSeq };
}

function cloneIntent(intent: MatchCommandIntent): MatchCommandIntent {
  return JSON.parse(JSON.stringify(intent)) as MatchCommandIntent;
}

function cloneResult(result: MatchCommandResult): MatchCommandResult {
  return { ...result };
}

function envelopeForIntent(matchId: string, playerId: string, intent: MatchCommandIntent): CommandEnvelope {
  return {
    matchId,
    playerId,
    sequence: intent.clientCommandSeq,
    clientTick: intent.lastServerTickSeen,
    command: cloneWire(intent.command),
  };
}

function validateRecoveryRecord(input: MatchAuthorityRecoveryRecord): MatchAuthorityRecoveryRecord {
  const value = cloneWire(input) as unknown;
  if (!isRecord(value)
    || value.schemaVersion !== AUTHORITY_RECOVERY_SCHEMA_VERSION
    || value.protocolVersion !== MATCH_PROTOCOL_VERSION
    || value.rulesVersion !== RULES_VERSION
    || typeof value.matchId !== "string"
    || value.matchId.length === 0
    || value.matchId.length > 128
    || !Array.isArray(value.participants)
    || !isRecord(value.checkpoint)
    || !Array.isArray(value.journal)
    || !Array.isArray(value.nextExpectedSequences)
    || !Array.isArray(value.commandRecords)
    || !Array.isArray(value.pendingCommands)) {
    throw new Error("Invalid authority recovery record header");
  }
  const participants = value.participants as unknown[];
  if (!participants.every((participant) => isRecord(participant)
    && typeof participant.playerId === "string"
    && typeof participant.teamId === "string"
    && typeof participant.name === "string"
    && (participant.villageId === "pinehold"
      || participant.villageId === "riverstead"
      || participant.villageId === "highcrag")
    && (participant.ai === undefined || isAiConfiguration(participant.ai)))) {
    throw new Error("Invalid authority recovery participants");
  }
  assertParticipants(participants as unknown as MatchParticipant[]);
  const participantIds = new Set((participants as unknown as MatchParticipant[]).map((participant) => participant.playerId));
  const networkParticipantIds = new Set((participants as unknown as MatchParticipant[])
    .filter((participant) => !participant.ai)
    .map((participant) => participant.playerId));
  const aiParticipantIds = new Set((participants as unknown as MatchParticipant[])
    .filter((participant) => participant.ai)
    .map((participant) => participant.playerId));
  const checkpoint = value.checkpoint;
  if (!isRecord(checkpoint.state)
    || checkpoint.state.matchId !== value.matchId
    || !Number.isSafeInteger(checkpoint.state.tick)
    || (checkpoint.state.tick as number) < 0
    || typeof checkpoint.stateHash !== "string") {
    throw new Error("Invalid authority recovery checkpoint");
  }
  let checkpointHash: string;
  try {
    checkpointHash = hashMatchState(checkpoint.state as unknown as MatchState);
  } catch {
    throw new Error("Authority recovery checkpoint is corrupt");
  }
  if (checkpointHash !== checkpoint.stateHash) throw new Error("Authority recovery checkpoint hash mismatch");
  const checkpointAiControllers = Array.isArray(checkpoint.state.aiControllers)
    ? checkpoint.state.aiControllers
    : [];
  const checkpointAiControllerIds = new Set(checkpointAiControllers.flatMap((authority) => (
    isRecord(authority) && typeof authority.playerId === "string" ? [authority.playerId] : []
  )));
  if (checkpointAiControllers.length !== aiParticipantIds.size
    || checkpointAiControllerIds.size !== aiParticipantIds.size
    || checkpointAiControllers.some((authority) => (
      !isRecord(authority)
      || typeof authority.playerId !== "string"
      || !aiParticipantIds.has(authority.playerId)
    ))) {
    throw new Error("Authority recovery checkpoint AI roster mismatch");
  }
  for (const participant of participants as unknown as MatchParticipant[]) {
    if (!participant.ai) continue;
    const authority = checkpointAiControllers.find((candidate) => (
      isRecord(candidate) && candidate.playerId === participant.playerId
    ));
    if (!isRecord(authority)
      || authority.personality !== participant.ai.personality
      || authority.difficulty !== participant.ai.difficulty) {
      throw new Error("Authority recovery checkpoint AI configuration mismatch");
    }
  }
  if (value.journal.length >= AUTHORITY_RECOVERY_CHECKPOINT_INTERVAL_TICKS) {
    throw new Error("Authority recovery journal exceeds its checkpoint window");
  }
  for (const operation of value.journal) {
    if (!isRecord(operation)
      || !Number.isSafeInteger(operation.fromTick)
      || !Number.isSafeInteger(operation.toTick)
      || (operation.fromTick as number) < 0
      || (operation.toTick as number) <= (operation.fromTick as number)
      || typeof operation.stateHash !== "string") {
      throw new Error("Invalid authority recovery journal operation");
    }
    if (operation.kind === "simulation") {
      if (!Array.isArray(operation.commands)
        || !operation.commands.every((command) => isCommandEnvelope(command)
          && command.matchId === value.matchId
          && participantIds.has(command.playerId))) {
        throw new Error("Invalid authority recovery command batch");
      }
    } else if (operation.kind === "disconnect") {
      if (!Array.isArray(operation.teamIds)
        || !operation.teamIds.every((teamId) => typeof teamId === "string")
        || new Set(operation.teamIds).size !== operation.teamIds.length) {
        throw new Error("Invalid authority recovery disconnect batch");
      }
    } else {
      throw new Error("Unknown authority recovery journal operation");
    }
  }

  const cursorByPlayer = new Map<string, number>();
  for (const cursor of value.nextExpectedSequences) {
    if (!isRecord(cursor)
      || typeof cursor.playerId !== "string"
      || !networkParticipantIds.has(cursor.playerId)
      || !Number.isSafeInteger(cursor.sequence)
      || (cursor.sequence as number) < 0
      || cursorByPlayer.has(cursor.playerId)) {
      throw new Error("Invalid authority recovery sequence cursor");
    }
    cursorByPlayer.set(cursor.playerId, cursor.sequence as number);
  }
  if (cursorByPlayer.size !== networkParticipantIds.size) throw new Error("Authority recovery sequence cursor is incomplete");

  const recordByIdentity = new Map<string, {
    readonly intentSequence: number;
    readonly result?: MatchCommandResult;
  }>();
  const recordCountByPlayer = new Map<string, number>();
  for (const persisted of value.commandRecords) {
    if (!isRecord(persisted)
      || typeof persisted.playerId !== "string"
      || !networkParticipantIds.has(persisted.playerId)
      || typeof persisted.commandId !== "string"
      || typeof persisted.fingerprint !== "string"
      || !isMatchCommandIntent(persisted.intent)
      || persisted.intent.commandId !== persisted.commandId
      || canonicalJson(persisted.intent) !== persisted.fingerprint
      || (persisted.result !== undefined && (!isMatchCommandResult(persisted.result)
        || persisted.result.commandId !== persisted.commandId
        || persisted.result.clientCommandSeq !== persisted.intent.clientCommandSeq))) {
      throw new Error("Invalid authority recovery command record");
    }
    const identity = `${persisted.playerId}\u0000${persisted.commandId}`;
    if (recordByIdentity.has(identity)) throw new Error("Duplicate authority recovery command record");
    recordByIdentity.set(identity, {
      intentSequence: persisted.intent.clientCommandSeq,
      ...(persisted.result === undefined ? {} : { result: persisted.result }),
    });
    const count = (recordCountByPlayer.get(persisted.playerId) ?? 0) + 1;
    if (count > MAX_COMPLETED_COMMAND_RECORDS_PER_PLAYER + MAX_BUFFERED_COMMANDS_PER_PLAYER) {
      throw new Error("Authority recovery command ledger exceeds its bound");
    }
    recordCountByPlayer.set(persisted.playerId, count);
  }

  const pendingSequences = new Set<string>();
  const pendingRecordIdentities = new Set<string>();
  const pendingCountByPlayer = new Map<string, number>();
  for (const pending of value.pendingCommands) {
    if (!isRecord(pending)
      || typeof pending.playerId !== "string"
      || !networkParticipantIds.has(pending.playerId)
      || typeof pending.commandId !== "string"
      || !Number.isSafeInteger(pending.sequence)
      || (pending.sequence as number) < 0) {
      throw new Error("Invalid authority recovery pending command");
    }
    const cursor = cursorByPlayer.get(pending.playerId)!;
    const sequence = pending.sequence as number;
    if (sequence < cursor || sequence - cursor >= MAX_BUFFERED_COMMANDS_PER_PLAYER) {
      throw new AuthorityRecoveryStateCorruptError(
        "Authority recovery pending sequence is outside its per-player reorder window",
      );
    }
    const recordIdentity = `${pending.playerId}\u0000${pending.commandId}`;
    const record = recordByIdentity.get(recordIdentity);
    if (!record || record.result) {
      throw new AuthorityRecoveryStateCorruptError(
        "Authority recovery pending command has no unresolved ledger entry",
      );
    }
    if (record.intentSequence !== sequence) {
      throw new AuthorityRecoveryStateCorruptError(
        "Authority recovery pending sequence disagrees with its ledger intent",
      );
    }
    if (pendingRecordIdentities.has(recordIdentity)) {
      throw new AuthorityRecoveryStateCorruptError(
        "Authority recovery unresolved ledger entry has multiple pending commands",
      );
    }
    const sequenceIdentity = `${pending.playerId}\u0000${pending.sequence}`;
    if (pendingSequences.has(sequenceIdentity)) throw new Error("Duplicate authority recovery pending sequence");
    pendingSequences.add(sequenceIdentity);
    pendingRecordIdentities.add(recordIdentity);
    const pendingCount = (pendingCountByPlayer.get(pending.playerId) ?? 0) + 1;
    if (pendingCount > MAX_BUFFERED_COMMANDS_PER_PLAYER) {
      throw new AuthorityRecoveryStateCorruptError(
        "Authority recovery pending buffer exceeds its per-player bound",
      );
    }
    pendingCountByPlayer.set(pending.playerId, pendingCount);
  }
  for (const [recordIdentity, record] of recordByIdentity) {
    if (!record.result && !pendingRecordIdentities.has(recordIdentity)) {
      throw new AuthorityRecoveryStateCorruptError(
        "Authority recovery unresolved ledger entry has no pending command",
      );
    }
  }
  return value as unknown as MatchAuthorityRecoveryRecord;
}

class AuthorityRecoveryStateCorruptError extends Error {
  readonly code = "STATE_CORRUPT" as const;

  constructor(message: string) {
    super(message);
    this.name = "AuthorityRecoveryStateCorruptError";
  }
}

function cloneWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
