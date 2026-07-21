import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  ReplicationError,
  applyVisibleSnapshotDelta,
  isMatchCommandResult,
  isMatchReplicationFrame,
  isMatchServerHello,
  verifyVisibleSnapshotChecksum,
  type GameCommand,
  type MatchCommandIntent,
  type MatchCommandResult,
  type MatchReplicationFrame,
  type MatchServerHello,
  type ReplicatedWorldEvent,
  type VisibleSnapshot,
} from "@village-siege/shared";

export type SynchronizationState =
  | "awaitingHello"
  | "awaitingSnapshot"
  | "synchronized"
  | "resyncing"
  | "awaitingReconnectHello"
  | "awaitingRecoverySnapshot"
  | "replayReady"
  | "failed";

export interface ResolvedMatchFrame {
  readonly kind: MatchReplicationFrame["kind"];
  readonly snapshot: VisibleSnapshot;
  readonly events: readonly ReplicatedWorldEvent[];
}

export type FrameApplication =
  | { readonly accepted: true; readonly duplicate: boolean; readonly frame: ResolvedMatchFrame }
  | { readonly accepted: false; readonly requestResync: boolean; readonly reason: string };

export type CommandResultApplication =
  | { readonly accepted: true; readonly duplicate: boolean; readonly result: MatchCommandResult }
  | { readonly accepted: false; readonly reason: string };

const MAX_COMPLETED_COMMAND_IDS = 512;
const MAX_PENDING_COMMANDS = 16;

/** Pure recipient-side store. It never owns MatchState or advances simulation rules. */
export class AuthoritativeMatchStore {
  private hello?: MatchServerHello;
  private snapshot?: VisibleSnapshot;
  private nextCommandSequence = 0;
  private synchronizationState: SynchronizationState = "awaitingHello";
  private recoveryEpochValue?: number;
  private failureReasonValue?: string;
  private readonly pending = new Map<string, MatchCommandIntent>();
  private readonly completedCommands = new Map<string, MatchCommandResult>();

  constructor(
    readonly matchId: string,
    readonly playerId: string,
    private readonly commandIdFactory: () => string = () => crypto.randomUUID(),
  ) {}

  get synchronization(): SynchronizationState {
    return this.synchronizationState;
  }

  get current(): VisibleSnapshot | undefined {
    return this.snapshot ? cloneWire(this.snapshot) : undefined;
  }

  get pendingCommandCount(): number {
    return this.pending.size;
  }

  get recoveryEpoch(): number | undefined {
    return this.recoveryEpochValue;
  }

  get failureReason(): string | undefined {
    return this.failureReasonValue;
  }

  beginRecovery(epoch: number): boolean {
    if (this.synchronizationState === "failed"
      || !Number.isSafeInteger(epoch)
      || epoch < 0
      || (this.recoveryEpochValue !== undefined && epoch <= this.recoveryEpochValue)) return false;
    this.recoveryEpochValue = epoch;
    this.synchronizationState = "awaitingReconnectHello";
    return true;
  }

  pendingIntentsForReplay(epoch: number): readonly MatchCommandIntent[] {
    if (this.synchronizationState !== "replayReady" || this.recoveryEpochValue !== epoch) {
      throw new Error("Authoritative recovery is not ready to replay this epoch");
    }
    return [...this.pending.values()]
      .sort((left, right) => left.clientCommandSeq - right.clientCommandSeq
        || compareText(left.commandId, right.commandId))
      .map(cloneWire);
  }

  finishReplay(epoch: number): boolean {
    if (this.synchronizationState !== "replayReady" || this.recoveryEpochValue !== epoch) return false;
    this.synchronizationState = "synchronized";
    return true;
  }

  failRecovery(epoch: number, reason: string): boolean {
    if (this.synchronizationState === "failed" || this.recoveryEpochValue !== epoch) return false;
    this.enterFailure(reason);
    return true;
  }

  acceptHello(payload: unknown): boolean {
    if (this.synchronizationState === "failed") return false;
    if (!isMatchServerHello(payload)
      || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
      || payload.rulesVersion !== RULES_VERSION
      || payload.matchId !== this.matchId
      || payload.recipientPlayerId !== this.playerId) {
      if (this.isAwaitingRecoveryHello()) this.enterFailure("Reconnect hello failed protocol, rules or recipient validation");
      return false;
    }
    if (this.isAwaitingRecoveryHello()) {
      const previousHello = this.hello;
      if (previousHello && !sameHelloContract(previousHello, payload)) {
        this.enterFailure("Reconnect hello changed the negotiated match contract");
        return false;
      }
      const sequenceFailure = previousHello
        ? this.recoverySequenceFailure(payload.nextClientCommandSeq)
        : this.pending.size > 0
          ? "Pending command journal exists before the first negotiated hello"
          : undefined;
      if (sequenceFailure) {
        this.enterFailure(sequenceFailure);
        return false;
      }
      this.hello = cloneWire(payload);
      this.nextCommandSequence = previousHello
        ? Math.max(this.nextCommandSequence, payload.nextClientCommandSeq)
        : payload.nextClientCommandSeq;
      this.synchronizationState = "awaitingRecoverySnapshot";
      return true;
    }
    if (this.hello) return canonicalJson(this.hello) === canonicalJson(payload);
    this.hello = cloneWire(payload);
    this.nextCommandSequence = payload.nextClientCommandSeq;
    this.synchronizationState = "awaitingSnapshot";
    return true;
  }

  applyFrame(payload: unknown): FrameApplication {
    if (this.synchronizationState === "failed") {
      return { accepted: false, requestResync: false, reason: this.failureReasonValue ?? "Authoritative recovery failed" };
    }
    if (!this.hello) return this.rejectFrame("Match frame arrived before protocol hello", false);
    if (!isMatchReplicationFrame(payload)
      || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
      || payload.rulesVersion !== RULES_VERSION
      || payload.matchId !== this.matchId
      || payload.recipientPlayerId !== this.playerId) {
      return this.rejectFrame("Match frame failed protocol, rules or recipient validation", true);
    }

    if (payload.kind === "snapshot") {
      if (this.synchronizationState === "awaitingReconnectHello") {
        return this.rejectFrame("Full snapshot arrived before reconnect hello", false);
      }
      if (!verifyVisibleSnapshotChecksum(payload.snapshot)) {
        return this.rejectFrame("Full visible snapshot checksum is invalid", true);
      }
      if (this.snapshot && payload.serverTick < this.snapshot.serverTick) {
        return {
          accepted: false,
          requestResync: this.synchronizationState === "awaitingRecoverySnapshot",
          reason: "Stale full snapshot ignored",
        };
      }
      if (this.snapshot && payload.serverTick === this.snapshot.serverTick) {
        if (payload.snapshot.checksum !== this.snapshot.checksum) {
          return this.rejectFrame("Divergent full snapshot at the same server tick", true);
        }
        this.completeSnapshotSynchronization();
        return {
          accepted: true,
          duplicate: true,
          frame: { kind: "snapshot", snapshot: cloneWire(this.snapshot), events: [] },
        };
      }
      this.snapshot = cloneWire(payload.snapshot);
      this.completeSnapshotSynchronization();
      return {
        accepted: true,
        duplicate: false,
        frame: { kind: "snapshot", snapshot: cloneWire(this.snapshot), events: cloneWire(payload.events) },
      };
    }

    if (this.synchronizationState === "awaitingReconnectHello") {
      return { accepted: false, requestResync: false, reason: "Delta ignored before reconnect hello" };
    }
    if (this.synchronizationState === "awaitingRecoverySnapshot") {
      return { accepted: false, requestResync: true, reason: "Delta ignored while awaiting the recovery snapshot" };
    }
    if (this.synchronizationState === "replayReady") {
      return { accepted: false, requestResync: false, reason: "Delta ignored until pending commands are replayed" };
    }
    if (!this.snapshot) return this.rejectFrame("Delta arrived without a full visible snapshot base", true);
    if (this.synchronizationState === "resyncing") {
      return { accepted: false, requestResync: false, reason: "Delta ignored while awaiting a full snapshot" };
    }
    if (payload.serverTick < this.snapshot.serverTick) {
      return { accepted: false, requestResync: false, reason: "Stale delta ignored" };
    }
    if (payload.serverTick === this.snapshot.serverTick) {
      if (payload.delta.checksum !== this.snapshot.checksum) {
        return this.rejectFrame("Divergent delta at the same server tick", true);
      }
      return { accepted: false, requestResync: false, reason: "Duplicate delta ignored" };
    }
    try {
      const candidate = applyVisibleSnapshotDelta(this.snapshot, payload.delta);
      this.snapshot = candidate;
      this.synchronizationState = "synchronized";
      return {
        accepted: true,
        duplicate: false,
        frame: { kind: "delta", snapshot: cloneWire(candidate), events: cloneWire(payload.events) },
      };
    } catch (error) {
      const reason = error instanceof ReplicationError ? error.message : "Visible delta application failed";
      return this.rejectFrame(reason, true);
    }
  }

  createIntent(command: GameCommand): MatchCommandIntent {
    if (this.synchronizationState !== "synchronized" || !this.snapshot) {
      throw new Error("Authoritative match is not synchronized; commands are frozen");
    }
    if (this.pending.size >= MAX_PENDING_COMMANDS) {
      throw new Error("Too many authoritative commands are awaiting acknowledgement");
    }
    const commandId = this.commandIdFactory();
    if (this.pending.has(commandId) || this.completedCommands.has(commandId)) {
      throw new Error(`Command ID collision: ${commandId}`);
    }
    const intent: MatchCommandIntent = {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      commandId,
      clientCommandSeq: this.nextCommandSequence,
      lastServerTickSeen: this.snapshot.serverTick,
      command: cloneWire(command),
    };
    this.nextCommandSequence += 1;
    this.pending.set(commandId, intent);
    return cloneWire(intent);
  }

  retryIntent(commandId: string): MatchCommandIntent {
    const intent = this.pending.get(commandId);
    if (!intent) throw new Error(`Unknown pending command: ${commandId}`);
    return cloneWire(intent);
  }

  applyCommandResult(payload: unknown): CommandResultApplication {
    if (this.synchronizationState === "failed") {
      return { accepted: false, reason: this.failureReasonValue ?? "Authoritative recovery failed" };
    }
    if (!isMatchCommandResult(payload) || payload.commandId === null) {
      return { accepted: false, reason: "Command result failed its wire guard" };
    }
    const completed = this.completedCommands.get(payload.commandId);
    if (completed) {
      if (canonicalJson(completed) !== canonicalJson(payload)) {
        return { accepted: false, reason: "Completed command result diverges from its first result" };
      }
      return { accepted: true, duplicate: true, result: cloneWire(completed) };
    }
    const pending = this.pending.get(payload.commandId);
    if (!pending || pending.clientCommandSeq !== payload.clientCommandSeq) {
      return { accepted: false, reason: "Command result does not correlate with a pending intent" };
    }
    if (!payload.accepted && payload.code === "RATE_LIMITED") {
      return { accepted: true, duplicate: false, result: cloneWire(payload) };
    }
    this.pending.delete(payload.commandId);
    this.completedCommands.set(payload.commandId, cloneWire(payload));
    while (this.completedCommands.size > MAX_COMPLETED_COMMAND_IDS) {
      const oldest = this.completedCommands.keys().next().value as string | undefined;
      if (!oldest) break;
      this.completedCommands.delete(oldest);
    }
    return { accepted: true, duplicate: false, result: cloneWire(payload) };
  }

  private rejectFrame(reason: string, shouldResync: boolean): FrameApplication {
    if (this.synchronizationState === "failed") {
      return { accepted: false, requestResync: false, reason: this.failureReasonValue ?? reason };
    }
    if (this.synchronizationState === "awaitingReconnectHello") {
      return { accepted: false, requestResync: false, reason };
    }
    if (this.synchronizationState === "awaitingRecoverySnapshot") {
      return { accepted: false, requestResync: shouldResync, reason };
    }
    if (this.synchronizationState === "replayReady") {
      return { accepted: false, requestResync: false, reason };
    }
    const requestResync = shouldResync && this.synchronizationState !== "resyncing";
    if (shouldResync) this.synchronizationState = "resyncing";
    return { accepted: false, requestResync, reason };
  }

  private isAwaitingRecoveryHello(): boolean {
    return this.synchronizationState === "awaitingReconnectHello"
      || this.synchronizationState === "awaitingRecoverySnapshot";
  }

  private recoverySequenceFailure(serverNextSequence: number): string | undefined {
    const pendingBySequence = new Map<number, string>();
    for (const intent of this.pending.values()) {
      if (intent.clientCommandSeq >= this.nextCommandSequence) {
        return "Pending command sequence is outside the local journal";
      }
      if (pendingBySequence.has(intent.clientCommandSeq)) {
        return "Pending command journal contains a duplicate sequence";
      }
      pendingBySequence.set(intent.clientCommandSeq, intent.commandId);
    }
    if (serverNextSequence > this.nextCommandSequence) {
      return this.pending.size === 0
        ? undefined
        : "Server command sequence advanced beyond a non-empty local journal";
    }
    for (let sequence = serverNextSequence; sequence < this.nextCommandSequence; sequence += 1) {
      if (!pendingBySequence.has(sequence)) {
        return `Pending command journal is missing sequence ${sequence}`;
      }
    }
    return undefined;
  }

  private completeSnapshotSynchronization(): void {
    this.synchronizationState = this.synchronizationState === "awaitingRecoverySnapshot"
      || this.synchronizationState === "replayReady"
      ? "replayReady"
      : "synchronized";
  }

  private enterFailure(reason: string): void {
    this.failureReasonValue = reason;
    this.synchronizationState = "failed";
  }
}

function cloneWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sameHelloContract(left: MatchServerHello, right: MatchServerHello): boolean {
  return left.protocolVersion === right.protocolVersion
    && left.rulesVersion === right.rulesVersion
    && left.matchId === right.matchId
    && left.recipientPlayerId === right.recipientPlayerId
    && left.tickMilliseconds === right.tickMilliseconds
    && left.fullSnapshotIntervalTicks === right.fullSnapshotIntervalTicks
    && left.canonicalHashIntervalTicks === right.canonicalHashIntervalTicks;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
