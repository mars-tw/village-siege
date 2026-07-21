import {
  TICK_MILLISECONDS,
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ID,
  VILLAGE_ASSAULT_MAP_WIDTH,
  createInitialState,
  isGameCommand,
  projectDomainEventsForPlayer,
  stepSimulation,
  toVisibleSnapshot,
  type CommandEnvelope,
  type CommandRejectCode,
  type DomainEvent,
  type GameCommand,
  type InitialPlayer,
  type MatchState,
  type PlayableVillageId,
  type VisibleSnapshot,
} from "@village-siege/shared";

export { TICK_MILLISECONDS };

export interface MatchParticipant {
  readonly playerId: string;
  readonly teamId: string;
  readonly name: string;
  readonly villageId: PlayableVillageId;
}

export interface CommandIntent {
  readonly sequence: number;
  readonly clientTick: number;
  readonly command: GameCommand;
}

export type IntentSubmission =
  | { readonly queued: true; readonly sequence: number }
  | { readonly queued: false; readonly sequence: number; readonly code: CommandRejectCode };

export interface CommandResult {
  readonly accepted: boolean;
  readonly sequence: number;
  readonly code?: CommandRejectCode;
  readonly serverTick: number;
}

export interface RecipientFrame {
  readonly snapshot: VisibleSnapshot;
  readonly events: readonly DomainEvent[];
  readonly commandResults: readonly CommandResult[];
}

export interface MatchTickResult {
  readonly serverTick: number;
  readonly phase: VisibleSnapshot["phase"];
  readonly frames: ReadonlyMap<string, RecipientFrame>;
}

interface QueuedCommand {
  readonly envelope: CommandEnvelope;
}

const MAX_PENDING_COMMANDS_PER_PLAYER = 16;

/**
 * Owns the canonical online match state. Callers can obtain only recipient-
 * filtered snapshots and events; the complete MatchState never crosses this
 * authority boundary.
 */
export class MatchAuthority {
  readonly matchId: string;
  readonly participants: readonly MatchParticipant[];
  private state: MatchState;
  private pending: QueuedCommand[] = [];
  private readonly lastQueuedSequence = new Map<string, number>();

  constructor(matchId: string, seed: number, participants: readonly MatchParticipant[]) {
    assertParticipants(participants);
    this.matchId = matchId;
    this.participants = participants.map((participant) => ({ ...participant }));
    const players: InitialPlayer[] = participants.map((participant) => ({
      id: participant.playerId,
      teamId: participant.teamId,
      villageId: participant.villageId,
    }));
    this.state = createInitialState({
      matchId,
      seed,
      players,
      map: {
        id: VILLAGE_ASSAULT_MAP_ID,
        width: VILLAGE_ASSAULT_MAP_WIDTH,
        height: VILLAGE_ASSAULT_MAP_HEIGHT,
        layoutId: participants[0]!.villageId,
      },
    });
    for (const player of this.state.players) this.lastQueuedSequence.set(player.id, player.lastSequence);
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

  submitIntent(playerId: string, payload: unknown): IntentSubmission {
    const sequence = extractSequence(payload);
    if (!isCommandIntent(payload)) return { queued: false, sequence, code: "INVALID_PAYLOAD" };
    if (!this.hasPlayer(playerId)) return { queued: false, sequence, code: "NOT_ROOM_MEMBER" };
    if (this.state.phase !== "playing") return { queued: false, sequence, code: "MATCH_NOT_PLAYING" };

    const envelope: CommandEnvelope = {
      matchId: this.matchId,
      playerId,
      sequence: payload.sequence,
      clientTick: payload.clientTick,
      command: payload.command,
    };
    const lastReceived = this.lastQueuedSequence.get(playerId) ?? -1;
    if (envelope.sequence <= lastReceived) {
      return { queued: false, sequence: envelope.sequence, code: "STALE_OR_DUPLICATE_SEQUENCE" };
    }
    if (this.pending.filter((entry) => entry.envelope.playerId === playerId).length >= MAX_PENDING_COMMANDS_PER_PLAYER) {
      return { queued: false, sequence: envelope.sequence, code: "RATE_LIMITED" };
    }
    this.pending.push({ envelope });
    this.lastQueuedSequence.set(playerId, envelope.sequence);
    return { queued: true, sequence: envelope.sequence };
  }

  initialFrames(): ReadonlyMap<string, RecipientFrame> {
    return new Map(this.participants.map((participant) => [
      participant.playerId,
      {
        snapshot: toVisibleSnapshot(this.state, participant.playerId),
        events: [],
        commandResults: [],
      },
    ]));
  }

  step(): MatchTickResult {
    const queued = this.pending;
    this.pending = [];
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
    const acknowledgementsByPlayer = new Map<string, DomainEvent[]>();
    for (const [index, entry] of orderedQueued.entries()) {
      const events = acknowledgementsByPlayer.get(entry.envelope.playerId) ?? [];
      events.push(acknowledgements[index]!);
      acknowledgementsByPlayer.set(entry.envelope.playerId, events);
    }
    const worldEvents = advanced.events.filter((event) => (
      event.type !== "commandAccepted" && event.type !== "commandRejected"
    ));

    const frames = new Map<string, RecipientFrame>();
    for (const participant of this.participants) {
      const projectedWorldEvents = projectDomainEventsForPlayer(
        this.state,
        participant.playerId,
        { serverTick: this.state.tick, events: worldEvents },
      );
      const ownAcknowledgements = acknowledgementsByPlayer.get(participant.playerId) ?? [];
      const events = [...ownAcknowledgements, ...projectedWorldEvents];
      frames.set(participant.playerId, {
        snapshot: toVisibleSnapshot(this.state, participant.playerId),
        events,
        commandResults: commandResults(events, this.state.tick),
      });
    }
    return { serverTick: this.state.tick, phase: this.state.phase, frames };
  }
}

export function isCommandIntent(value: unknown): value is CommandIntent {
  if (!isRecord(value) || !hasOnlyKeys(value, ["sequence", "clientTick", "command"])) return false;
  return Number.isSafeInteger(value.sequence)
    && (value.sequence as number) >= 0
    && Number.isSafeInteger(value.clientTick)
    && (value.clientTick as number) >= 0
    && isGameCommand(value.command);
}

function commandResults(events: readonly DomainEvent[], serverTick: number): CommandResult[] {
  return events.flatMap((event): CommandResult[] => {
    if (event.type === "commandAccepted") {
      return [{ accepted: true, sequence: event.sequence, serverTick }];
    }
    if (event.type === "commandRejected") {
      return [{ accepted: false, sequence: event.sequence, code: event.code, serverTick }];
    }
    return [];
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
}

function extractSequence(value: unknown): number {
  return isRecord(value) && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
    ? value.sequence as number
    : 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
