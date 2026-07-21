import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  isMatchCommandIntent,
  isMatchVersionOffer,
  type MatchCommandResult,
  type MatchReplicationFrame,
} from "@village-siege/shared";
import {
  MatchAuthority,
  TICK_MILLISECONDS,
} from "../authority/MatchAuthority.js";
import { consumeMatchLaunch, type AuthorizedMatchParticipant } from "../matchLaunchRegistry.js";
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
  private started = false;

  async onCreate(options: MatchRoomOptions): Promise<void> {
    this.seatReservationTimeout = JOIN_TIMEOUT_MILLISECONDS / 1_000;
    this.setState(new MatchRoomState());
    this.state.matchId = this.roomId;
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
    this.maxClients = this.participants.length;
    this.authority = new MatchAuthority(this.roomId, launch.seed, this.participants.map((participant) => ({
      playerId: participant.playerId,
      teamId: participant.teamId,
      name: participant.name,
      villageId: participant.villageId,
    })));
    await this.setPrivate(true);

    this.clock.setTimeout(() => {
      if (!this.started) void this.disconnect(4000);
    }, JOIN_TIMEOUT_MILLISECONDS);
    this.setSimulationInterval(() => this.tick(), TICK_MILLISECONDS);
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

  onJoin(client: Client, options: JoinOptions): void {
    const participant = this.participantForToken(options.accessToken);
    if (!participant
      || this.claimedPlayerIds.has(participant.playerId)
      || options.protocolVersion !== MATCH_PROTOCOL_VERSION
      || options.rulesVersion !== RULES_VERSION) {
      throw new Error("Invalid, incompatible or already claimed match seat.");
    }
    this.playerIdBySession.set(client.sessionId, participant.playerId);
    this.connectedPlayerIds.add(participant.playerId);
    this.claimedPlayerIds.add(participant.playerId);
  }

  async onDrop(client: Client): Promise<void> {
    await this.allowReconnection(client, 60);
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

  private tick(): void {
    if (!this.started || this.authority.phase !== "playing") return;
    const result = this.authority.step();
    this.state.serverTick = result.serverTick;
    this.state.phase = result.phase === "finished" ? "finished" : "playing";
    this.sendCommandResults(result.commandResults);
    this.sendFrames(result.frames);
  }

  private handleCommand(client: Client, payload: unknown): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId) return this.protocolError(client, "NOT_ROOM_MEMBER");
    if (!this.isSmallPayload(payload)) return this.protocolError(client, "INVALID_PAYLOAD");
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
