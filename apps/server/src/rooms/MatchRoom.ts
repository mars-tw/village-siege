import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  isMatchCommandIntent,
  isMatchVersionOffer,
  type MatchCommandResult,
  type MatchLifecycleMessage,
  type MatchReplicationFrame,
  type MatchRecoveryFailureCode,
} from "@village-siege/shared";
import {
  AUTHORITY_RECOVERY_SCHEMA_VERSION,
  MatchAuthority,
  TICK_MILLISECONDS,
  type MatchAuthorityRecoveryRecord,
} from "../authority/MatchAuthority.js";
import { consumeMatchLaunch, type AuthorizedMatchParticipant } from "../matchLaunchRegistry.js";
import {
  MemoryMatchRecoveryStore,
  type MatchRecoveryLease,
  type MatchRecoveryMetadata,
  type MatchRecoveryStore,
} from "../recovery/MatchRecoveryStore.js";
import { MatchRoomState } from "../schema/GameState.js";

interface MatchRoomOptions {
  readonly launchToken?: unknown;
}

interface JoinOptions {
  readonly accessToken?: unknown;
  readonly protocolVersion?: unknown;
  readonly rulesVersion?: unknown;
}

const MAX_MESSAGE_BYTES = 8 * 1024;
const JOIN_TIMEOUT_MILLISECONDS = 30_000;
const SYNC_REQUEST_COOLDOWN_MILLISECONDS = 250;
export const PLAYER_RECONNECT_LEASE_MILLISECONDS = 120_000;
export const AUTHORITY_LEASE_TTL_MILLISECONDS = PLAYER_RECONNECT_LEASE_MILLISECONDS;
export const AUTHORITY_LEASE_RENEW_THRESHOLD_MILLISECONDS = 60_000;
const MAX_DEFERRED_CLIENT_OPERATIONS = 128;

interface DisconnectedPlayerLease {
  readonly playerId: string;
  readonly generation: number;
  readonly expiresAtEpochMs: number;
}

interface ReconnectLeaseTimer {
  readonly generation: number;
  clear(): void;
}

export interface MatchRoomRecoveryPayload {
  readonly authority: MatchAuthorityRecoveryRecord;
  readonly disconnectedPlayers: readonly DisconnectedPlayerLease[];
}

let configuredRecoveryStore: MatchRecoveryStore<MatchRoomRecoveryPayload> = new MemoryMatchRecoveryStore();

export function configureMatchRecoveryStore(store: MatchRecoveryStore<MatchRoomRecoveryPayload>): void {
  configuredRecoveryStore = store;
}

export class MatchRoom extends Room<{ state: MatchRoomState }> {
  maxClients = 5;
  maxMessagesPerSecond = 30;
  patchRate = 100;
  autoDispose = false;
  private authority!: MatchAuthority;
  private participants: readonly AuthorizedMatchParticipant[] = [];
  private readonly playerIdBySession = new Map<string, string>();
  private readonly connectedPlayerIds = new Set<string>();
  private readonly claimedPlayerIds = new Set<string>();
  private readonly negotiatedPlayerIds = new Set<string>();
  private readonly lastSyncRequestAt = new Map<string, number>();
  private readonly recoveryEpochByPlayer = new Map<string, number>();
  private readonly disconnectedPlayers = new Map<string, DisconnectedPlayerLease>();
  private readonly reconnectLeaseTimers = new Map<string, ReconnectLeaseTimer>();
  private readonly deferredClientOperations: Array<() => void> = [];
  private recoveryStore: MatchRecoveryStore<MatchRoomRecoveryPayload> = configuredRecoveryStore;
  private recoveryMetadata?: MatchRecoveryMetadata;
  private recoveryLease?: MatchRecoveryLease;
  private mutationTail: Promise<void> = Promise.resolve();
  private pendingMutations = 0;
  private tickInFlight = false;
  private failStopped = false;
  private started = false;

  async onCreate(options: MatchRoomOptions): Promise<void> {
    this.seatReservationTimeout = JOIN_TIMEOUT_MILLISECONDS / 1_000;
    this.setState(new MatchRoomState());
    let launch;
    try {
      launch = consumeMatchLaunch(options.launchToken);
    } catch {
      this.maxClients = 0;
      await this.setPrivate(true);
      this.clock.setTimeout(() => void this.disconnect(4003), 1);
      return;
    }
    this.participants = launch.participants;
    this.state.matchId = launch.matchId;
    this.maxClients = this.participants.length;
    this.authority = new MatchAuthority(launch.matchId, launch.seed, this.participants.map((participant) => ({
      playerId: participant.playerId,
      teamId: participant.teamId,
      name: participant.name,
      villageId: participant.villageId,
    })));
    this.recoveryMetadata = {
      schemaVersion: AUTHORITY_RECOVERY_SCHEMA_VERSION,
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: launch.matchId,
    };
    try {
      this.recoveryLease = await this.recoveryStore.acquire(
        this.recoveryMetadata,
        `room-${this.roomId}`,
        AUTHORITY_LEASE_TTL_MILLISECONDS,
      );
      const stored = await this.recoveryStore.load(launch.matchId);
      if (stored?.payload) {
        const restored = MatchAuthority.restore(stored.payload.authority);
        if (restored.participants.length !== this.participants.length
          || restored.participants.some((participant, index) => {
            const expected = this.participants[index];
            return !expected
              || participant.playerId !== expected.playerId
              || participant.teamId !== expected.teamId
              || participant.name !== expected.name
              || participant.villageId !== expected.villageId;
          })) {
          throw new Error("Recovered authority participants do not match the authorized launch roster");
        }
        this.authority = restored;
        this.started = true;
        this.autoDispose = true;
        this.state.serverTick = restored.serverTick;
        this.state.phase = restored.phase === "finished" ? "finished" : "playing";
        for (const disconnected of stored.payload.disconnectedPlayers) {
          if (!this.authority.hasPlayer(disconnected.playerId)
            || !Number.isSafeInteger(disconnected.generation)
            || disconnected.generation < 1
            || !Number.isSafeInteger(disconnected.expiresAtEpochMs)
            || disconnected.expiresAtEpochMs < 0) {
            throw new Error("Recovered reconnect lease is corrupt");
          }
          this.disconnectedPlayers.set(disconnected.playerId, { ...disconnected });
          this.recoveryEpochByPlayer.set(disconnected.playerId, disconnected.generation);
        }
      }
      await this.persistRecoveryState();
      this.restoreReconnectLeaseTimers();
    } catch (error) {
      console.error("Failed to initialize authoritative recovery", error);
      this.maxClients = 0;
      await this.setPrivate(true);
      this.clock.setTimeout(() => void this.disconnect(1011), 1);
      return;
    }
    await this.setPrivate(true);

    this.clock.setTimeout(() => {
      if (!this.started) void this.disconnect(4000);
    }, JOIN_TIMEOUT_MILLISECONDS);
    this.setSimulationInterval(() => void this.tick(), TICK_MILLISECONDS);
    this.onMessage("match.hello", (client, payload: unknown) => this.handleHello(client, payload));
    this.onMessage("match.command", (client, payload: unknown) => this.handleCommand(client, payload));
    this.onMessage("match.syncRequest", (client, payload: unknown) => this.handleSyncRequest(client, payload));
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    const participant = this.participantForToken(options.accessToken);
    return Boolean(
      participant
      && !this.claimedPlayerIds.has(participant.playerId)
      && options.protocolVersion === MATCH_PROTOCOL_VERSION
      && options.rulesVersion === RULES_VERSION,
    );
  }

  async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const participant = this.participantForToken(options.accessToken);
    if (!participant
      || this.claimedPlayerIds.has(participant.playerId)
      || options.protocolVersion !== MATCH_PROTOCOL_VERSION
      || options.rulesVersion !== RULES_VERSION) {
      throw new Error("Invalid, incompatible or already claimed match seat.");
    }
    this.claimedPlayerIds.add(participant.playerId);
    if (!this.recoveryEpochByPlayer.has(participant.playerId)) {
      this.recoveryEpochByPlayer.set(participant.playerId, 0);
    }
    const recoveredLease = this.disconnectedPlayers.get(participant.playerId);
    if (!recoveredLease) {
      this.playerIdBySession.set(client.sessionId, participant.playerId);
      this.connectedPlayerIds.add(participant.playerId);
      return;
    }
    try {
      await this.serializeMutation(async () => {
        if (this.failStopped) return;
        const current = this.disconnectedPlayers.get(participant.playerId);
        if (!current
          || current.generation !== recoveredLease.generation
          || Date.now() >= current.expiresAtEpochMs) {
          const recoveryEpoch = current?.generation
            ?? this.recoveryEpochByPlayer.get(participant.playerId)
            ?? recoveredLease.generation;
          client.send("match.lifecycle", {
            type: "failed",
            protocolVersion: MATCH_PROTOCOL_VERSION,
            rulesVersion: RULES_VERSION,
            matchId: this.authority.matchId,
            recipientPlayerId: participant.playerId,
            serverTick: this.authority.serverTick,
            recoveryEpoch,
            code: "RECONNECT_LEASE_EXPIRED",
            recoverable: false,
          } satisfies MatchLifecycleMessage);
          if (current?.generation === recoveredLease.generation) {
            await this.expireDueReconnectLeasesUnlocked(participant.playerId, current.generation);
          }
          this.clock.setTimeout(() => client.leave(4008, "Reconnect lease expired"), 0);
          return;
        }
        this.playerIdBySession.set(client.sessionId, participant.playerId);
        this.connectedPlayerIds.add(participant.playerId);
        this.disconnectedPlayers.delete(participant.playerId);
        this.clearReconnectLeaseTimer(participant.playerId, current.generation);
        await this.persistRecoveryState();
      });
    } catch (error) {
      await this.failStop(this.failureCodeFor(error), error);
    }
  }

  async onDrop(client: Client): Promise<void> {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId || this.failStopped) return;
    this.connectedPlayerIds.delete(playerId);
    this.negotiatedPlayerIds.delete(playerId);
    let reconnectLease: DisconnectedPlayerLease | undefined;
    try {
      reconnectLease = await this.serializeMutation(async () => {
        if (this.failStopped || this.authority.phase !== "playing") return undefined;
        const current = this.disconnectedPlayers.get(playerId);
        if (current) return current;
        const generation = (this.recoveryEpochByPlayer.get(playerId) ?? 0) + 1;
        this.recoveryEpochByPlayer.set(playerId, generation);
        const created = {
          playerId,
          generation,
          expiresAtEpochMs: Date.now() + PLAYER_RECONNECT_LEASE_MILLISECONDS,
        };
        this.disconnectedPlayers.set(playerId, created);
        await this.persistRecoveryState();
        this.scheduleReconnectLeaseExpiration(created);
        return created;
      });
    } catch (error) {
      await this.failStop("PERSISTENCE_UNAVAILABLE", error);
      return;
    }
    if (!reconnectLease) return;
    try {
      const remainingSeconds = Math.max(1, Math.ceil((reconnectLease.expiresAtEpochMs - Date.now()) / 1_000));
      await this.allowReconnection(client, remainingSeconds);
    } catch {
      await this.expireDueReconnectLeases(playerId, reconnectLease.generation);
    }
  }

  async onReconnect(client: Client): Promise<void> {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId || this.failStopped) return;
    try {
      await this.serializeMutation(async () => {
        if (this.failStopped) return;
        const lease = this.disconnectedPlayers.get(playerId);
        if (!lease || Date.now() >= lease.expiresAtEpochMs) {
          const recoveryEpoch = lease?.generation ?? this.recoveryEpochByPlayer.get(playerId) ?? 0;
          client.send("match.lifecycle", {
            type: "failed",
            protocolVersion: MATCH_PROTOCOL_VERSION,
            rulesVersion: RULES_VERSION,
            matchId: this.authority.matchId,
            recipientPlayerId: playerId,
            serverTick: this.authority.serverTick,
            recoveryEpoch,
            code: "RECONNECT_LEASE_EXPIRED",
            recoverable: false,
          } satisfies MatchLifecycleMessage);
          await this.expireDueReconnectLeasesUnlocked(playerId, recoveryEpoch);
          this.clock.setTimeout(() => client.leave(4008, "Reconnect lease expired"), 0);
          return;
        }
        this.connectedPlayerIds.add(playerId);
        this.negotiatedPlayerIds.add(playerId);
        this.disconnectedPlayers.delete(playerId);
        this.clearReconnectLeaseTimer(playerId, lease.generation);
        await this.persistRecoveryState();
        client.send("match.lifecycle", this.lifecycleMessage(playerId, "recovering", lease.generation, {
          leaseExpiresAtEpochMs: lease.expiresAtEpochMs,
        }));
        client.send("match.lifecycle", this.lifecycleMessage(playerId, "resumed", lease.generation));
        client.send("match.hello", this.authority.serverHello(playerId));
        if (this.started) client.send("match.frame", this.authority.forceSnapshotFrame(playerId));
      });
    } catch (error) {
      await this.failStop("PERSISTENCE_UNAVAILABLE", error);
    }
  }

  onLeave(client: Client): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    this.playerIdBySession.delete(client.sessionId);
    if (playerId) {
      this.connectedPlayerIds.delete(playerId);
      this.negotiatedPlayerIds.delete(playerId);
      this.lastSyncRequestAt.delete(playerId);
    }
  }

  async onDispose(): Promise<void> {
    for (const timer of this.reconnectLeaseTimers.values()) timer.clear();
    this.reconnectLeaseTimers.clear();
    const lease = this.recoveryLease;
    this.recoveryLease = undefined;
    if (lease) await this.recoveryStore.release(lease).catch(() => undefined);
  }

  private handleHello(client: Client, payload: unknown): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId) return this.protocolError(client, "NOT_ROOM_MEMBER");
    if (!this.isSmallPayload(payload) || !isMatchVersionOffer(payload)) {
      return this.protocolError(client, "INVALID_PAYLOAD");
    }
    if (payload.protocolVersion !== MATCH_PROTOCOL_VERSION) {
      return this.protocolError(client, "PROTOCOL_MISMATCH");
    }
    if (payload.rulesVersion !== RULES_VERSION) return this.protocolError(client, "RULES_MISMATCH");
    if (this.deferClientOperation(client, () => this.handleHello(client, payload))) return;

    this.negotiatedPlayerIds.add(playerId);
    client.send("match.hello", this.authority.serverHello(playerId));
    if (!this.started
      && this.connectedPlayerIds.size === this.participants.length
      && this.negotiatedPlayerIds.size === this.participants.length) {
      this.started = true;
      this.autoDispose = true;
      void this.lock();
      this.state.phase = "playing";
      this.sendFrames(this.authority.initialFrames());
    }
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight || this.failStopped || !this.started || this.authority.phase !== "playing") return;
    this.tickInFlight = true;
    try {
      await this.serializeMutation(async () => {
        const previous = this.authority.recoveryRecord();
        const result = this.authority.step();
        try {
          await this.persistRecoveryState(result.phase === "finished" ? "MATCH_ENDED" : undefined);
          this.state.serverTick = result.serverTick;
          this.state.phase = result.phase === "finished" ? "finished" : "playing";
          this.sendCommandResults(result.commandResults);
          this.sendFrames(result.frames);
        } catch (error) {
          this.authority = MatchAuthority.restore(previous);
          await this.failStop(this.failureCodeFor(error), error);
        }
      });
    } finally {
      this.tickInFlight = false;
    }
  }

  private handleCommand(client: Client, payload: unknown): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId) return this.protocolError(client, "NOT_ROOM_MEMBER");
    if (!this.isSmallPayload(payload)) return this.protocolError(client, "INVALID_PAYLOAD");
    if (this.deferClientOperation(client, () => this.handleCommand(client, payload))) return;
    if (!this.negotiatedPlayerIds.has(playerId) || !this.started) {
      if (!isMatchCommandIntent(payload)) return this.protocolError(client, "INVALID_PAYLOAD");
      return client.send("match.commandResult", {
        commandId: payload.commandId,
        clientCommandSeq: payload.clientCommandSeq,
        accepted: false,
        code: "MATCH_NOT_PLAYING",
        serverTick: this.authority?.serverTick ?? 0,
      } satisfies MatchCommandResult);
    }
    const result = this.authority.submitIntent(playerId, payload);
    if (!result.queued) client.send("match.commandResult", result.result);
  }

  private handleSyncRequest(client: Client, payload: unknown): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId || !this.started) return;
    if (!this.isSmallPayload(payload) || !isMatchVersionOffer(payload)) {
      return this.protocolError(client, "INVALID_PAYLOAD");
    }
    if (payload.protocolVersion !== MATCH_PROTOCOL_VERSION || payload.rulesVersion !== RULES_VERSION) {
      return this.protocolError(client, "VERSION_MISMATCH");
    }
    if (this.deferClientOperation(client, () => this.handleSyncRequest(client, payload))) return;
    const now = Date.now();
    const previous = this.lastSyncRequestAt.get(playerId) ?? 0;
    if (now - previous < SYNC_REQUEST_COOLDOWN_MILLISECONDS) return;
    this.lastSyncRequestAt.set(playerId, now);
    client.send("match.frame", this.authority.forceSnapshotFrame(playerId));
  }

  private sendFrames(frames: ReadonlyMap<string, MatchReplicationFrame>): void {
    for (const client of this.clients) {
      const playerId = this.playerIdBySession.get(client.sessionId);
      const frame = playerId ? frames.get(playerId) : undefined;
      if (frame) client.send("match.frame", frame);
    }
  }

  private sendCommandResults(results: ReadonlyMap<string, readonly MatchCommandResult[]>): void {
    for (const client of this.clients) {
      const playerId = this.playerIdBySession.get(client.sessionId);
      if (!playerId) continue;
      for (const result of results.get(playerId) ?? []) client.send("match.commandResult", result);
    }
  }

  private async persistRecoveryState(terminalCode?: string): Promise<void> {
    const metadata = this.recoveryMetadata;
    let lease = this.recoveryLease;
    if (!metadata || !lease) throw new Error("Authoritative recovery lease is unavailable");
    if (lease.expiresAtEpochMs - Date.now() <= AUTHORITY_LEASE_RENEW_THRESHOLD_MILLISECONDS) {
      lease = await this.recoveryStore.renew(lease, AUTHORITY_LEASE_TTL_MILLISECONDS);
      this.recoveryLease = lease;
    }
    await this.recoveryStore.commit(lease, metadata, {
      authority: this.authority.recoveryRecord(),
      disconnectedPlayers: [...this.disconnectedPlayers.values()]
        .sort((left, right) => left.expiresAtEpochMs - right.expiresAtEpochMs
          || left.playerId.localeCompare(right.playerId)),
    });
    if (terminalCode) {
      await this.recoveryStore.markTerminal(lease, metadata, {
        kind: "completed",
        code: terminalCode,
        serverTick: this.authority.serverTick,
      });
      this.recoveryLease = undefined;
    }
  }

  private async expireDueReconnectLeases(playerId: string, generation: number): Promise<void> {
    await this.serializeMutation(() => this.expireDueReconnectLeasesUnlocked(playerId, generation));
  }

  private async expireDueReconnectLeasesUnlocked(playerId: string, generation: number): Promise<void> {
    const current = this.disconnectedPlayers.get(playerId);
    if (!current || current.generation !== generation || Date.now() < current.expiresAtEpochMs || this.failStopped) return;
    const now = Date.now();
    const duePlayerIds = new Set([...this.disconnectedPlayers.values()]
      .filter((entry) => entry.expiresAtEpochMs <= now)
      .map((entry) => entry.playerId));
    const teamIds = [...new Set(this.participants
      .filter((participant) => {
        const teammates = this.participants.filter((candidate) => candidate.teamId === participant.teamId);
        return teammates.every((teammate) => !this.connectedPlayerIds.has(teammate.playerId)
          && duePlayerIds.has(teammate.playerId));
      })
      .map((participant) => participant.teamId))].sort();
    for (const duePlayerId of duePlayerIds) {
      const due = this.disconnectedPlayers.get(duePlayerId);
      this.disconnectedPlayers.delete(duePlayerId);
      if (due) this.clearReconnectLeaseTimer(duePlayerId, due.generation);
    }
    if (!this.started || teamIds.length === 0) {
      try {
        await this.persistRecoveryState();
      } catch (error) {
        await this.failStop("PERSISTENCE_UNAVAILABLE", error);
      }
      return;
    }

    const previous = this.authority.recoveryRecord();
    const result = this.authority.expireDisconnectedTeams(teamIds);
    try {
      await this.persistRecoveryState(result.phase === "finished" ? "MATCH_ENDED" : undefined);
      this.state.serverTick = result.serverTick;
      this.state.phase = result.phase === "finished" ? "finished" : "playing";
      this.sendFrames(result.frames);
    } catch (error) {
      this.authority = MatchAuthority.restore(previous);
      await this.failStop(this.failureCodeFor(error), error);
    }
  }

  private restoreReconnectLeaseTimers(): void {
    for (const lease of this.disconnectedPlayers.values()) this.scheduleReconnectLeaseExpiration(lease);
  }

  private scheduleReconnectLeaseExpiration(lease: DisconnectedPlayerLease): void {
    this.clearReconnectLeaseTimer(lease.playerId);
    const delayed = this.clock.setTimeout(
      () => void this.expireDueReconnectLeases(lease.playerId, lease.generation),
      Math.max(0, lease.expiresAtEpochMs - Date.now()),
    );
    this.reconnectLeaseTimers.set(lease.playerId, {
      generation: lease.generation,
      clear: () => delayed.clear(),
    });
  }

  private clearReconnectLeaseTimer(playerId: string, generation?: number): void {
    const timer = this.reconnectLeaseTimers.get(playerId);
    if (!timer || (generation !== undefined && timer.generation !== generation)) return;
    timer.clear();
    this.reconnectLeaseTimers.delete(playerId);
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingMutations += 1;
    const result = this.mutationTail.then(operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result.finally(() => {
      this.pendingMutations -= 1;
      if (this.pendingMutations === 0) this.flushDeferredClientOperations();
    });
  }

  private deferClientOperation(client: Client, operation: () => void): boolean {
    if (this.pendingMutations === 0) return false;
    if (this.deferredClientOperations.length >= MAX_DEFERRED_CLIENT_OPERATIONS) {
      this.protocolError(client, "RATE_LIMITED");
      return true;
    }
    this.deferredClientOperations.push(operation);
    return true;
  }

  private flushDeferredClientOperations(): void {
    if (this.failStopped) {
      this.deferredClientOperations.length = 0;
      return;
    }
    const deferred = this.deferredClientOperations.splice(0);
    for (const operation of deferred) operation();
  }

  private lifecycleMessage(
    playerId: string,
    type: "recovering" | "resumed",
    recoveryEpoch: number,
    extra?: { readonly leaseExpiresAtEpochMs: number },
  ): MatchLifecycleMessage {
    const base = {
      type,
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: this.authority.matchId,
      recipientPlayerId: playerId,
      serverTick: this.authority.serverTick,
      recoveryEpoch,
    } as const;
    return type === "recovering"
      ? { ...base, type, leaseExpiresAtEpochMs: extra!.leaseExpiresAtEpochMs }
      : { ...base, type };
  }

  private async failStop(code: MatchRecoveryFailureCode, error: unknown): Promise<void> {
    if (this.failStopped) return;
    this.failStopped = true;
    this.started = false;
    this.deferredClientOperations.length = 0;
    for (const timer of this.reconnectLeaseTimers.values()) timer.clear();
    this.reconnectLeaseTimers.clear();
    console.error(`Authoritative match fail-stop: ${code}`, error);
    for (const client of this.clients) {
      const playerId = this.playerIdBySession.get(client.sessionId);
      if (!playerId) continue;
      client.send("match.lifecycle", {
        type: "failed",
        protocolVersion: MATCH_PROTOCOL_VERSION,
        rulesVersion: RULES_VERSION,
        matchId: this.authority.matchId,
        recipientPlayerId: playerId,
        serverTick: this.authority.serverTick,
        recoveryEpoch: this.recoveryEpochByPlayer.get(playerId) ?? 0,
        code,
        recoverable: false,
      } satisfies MatchLifecycleMessage);
    }
    await this.disconnect(1011).catch(() => undefined);
  }

  private failureCodeFor(error: unknown): MatchRecoveryFailureCode {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
    if (code === "STATE_CORRUPT") return "STATE_CORRUPT";
    return code === "STALE_FENCE" || code === "LEASE_EXPIRED" ? "LEASE_LOST" : "PERSISTENCE_UNAVAILABLE";
  }

  private protocolError(client: Client, code: string): void {
    client.send("match.protocolError", { code });
  }

  private participantForToken(value: unknown): AuthorizedMatchParticipant | undefined {
    if (typeof value !== "string") return undefined;
    return this.participants.find((participant) => participant.accessToken === value);
  }

  private isSmallPayload(payload: unknown): boolean {
    try {
      return Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_MESSAGE_BYTES;
    } catch {
      return false;
    }
  }
}
