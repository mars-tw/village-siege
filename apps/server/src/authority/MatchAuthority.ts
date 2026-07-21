import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  TICKS_PER_SECOND,
  TICK_MILLISECONDS,
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ID,
  VILLAGE_ASSAULT_MAP_WIDTH,
  createInitialState,
  createVisibleSnapshotDelta,
  hashMatchState,
  isMatchCommandIntent,
  projectDomainEventsForPlayer,
  stepSimulation,
  toVisibleSnapshot,
  type CanonicalStateHash,
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

export interface MatchParticipant {
  readonly playerId: string;
  readonly teamId: string;
  readonly name: string;
  readonly villageId: PlayableVillageId;
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

interface CommandRecord {
  readonly intent: MatchCommandIntent;
  readonly fingerprint: string;
  result?: MatchCommandResult;
}

interface QueuedCommand {
  readonly envelope: CommandEnvelope;
  readonly record: CommandRecord;
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
      })),
      map: {
        id: VILLAGE_ASSAULT_MAP_ID,
        width: VILLAGE_ASSAULT_MAP_WIDTH,
        height: VILLAGE_ASSAULT_MAP_HEIGHT,
        layoutId: participants[0]!.villageId,
      },
    });
    for (const player of this.state.players) {
      this.pendingByPlayer.set(player.id, new Map());
      this.recordByPlayer.set(player.id, new Map());
      this.nextExpectedSequence.set(player.id, player.lastSequence + 1);
    }
  }

  get serverTick(): number {
    return this.state.tick;
  }

  get phase(): VisibleSnapshot["phase"] {
    return this.state.phase;
  }

  hasPlayer(playerId: string): boolean {
    return this.state.players.some((player) => player.id === playerId);
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
    return new Map(this.participants.map((participant) => [
      participant.playerId,
      this.fullSnapshotFrame(participant.playerId, []),
    ]));
  }

  forceSnapshotFrame(playerId: string): MatchReplicationFrame {
    if (!this.hasPlayer(playerId)) throw new Error(`Unknown snapshot recipient: ${playerId}`);
    return this.fullSnapshotFrame(playerId, []);
  }

  step(): MatchTickResult {
    const queued = this.drainContiguousCommands();
    const advanced = stepSimulation(this.state, queued.map((entry) => entry.envelope), 1);
    this.state = advanced.state;
    const orderedQueued = [...queued].sort((left, right) => (
      compareText(left.envelope.playerId, right.envelope.playerId)
      || left.envelope.sequence - right.envelope.sequence
    ));
    const acknowledgements = advanced.events.filter((event) => (
      event.type === "commandAccepted" || event.type === "commandRejected"
    ));
    if (acknowledgements.length !== orderedQueued.length) {
      throw new Error("Authoritative command acknowledgement count diverged from the command batch");
    }

    const resultsByPlayer = new Map<string, MatchCommandResult[]>();
    for (const [index, entry] of orderedQueued.entries()) {
      const acknowledgement = acknowledgements[index]!;
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
    for (const participant of this.participants) this.trimCompletedRecords(participant.playerId);

    const worldEvents = advanced.events.filter((event): event is ReplicatedWorldEvent => (
      event.type !== "commandAccepted" && event.type !== "commandRejected"
    ));
    const frames = new Map<string, MatchReplicationFrame>();
    for (const participant of this.participants) {
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

  private drainContiguousCommands(): QueuedCommand[] {
    const drained: QueuedCommand[] = [];
    for (const participant of this.participants) {
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
}

function assertParticipants(participants: readonly MatchParticipant[]): void {
  if (participants.length < 2 || participants.length > 5) throw new RangeError("A match requires two to five participants");
  if (new Set(participants.map((participant) => participant.playerId)).size !== participants.length) {
    throw new Error("Match participant ids must be unique");
  }
  if (new Set(participants.map((participant) => participant.teamId)).size < 2) {
    throw new Error("A match requires at least two opposing teams");
  }
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
