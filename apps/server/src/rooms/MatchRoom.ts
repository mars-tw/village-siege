import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  MatchAuthority,
  TICK_MILLISECONDS,
  type RecipientFrame,
} from "../authority/MatchAuthority.js";
import { consumeMatchLaunch, type AuthorizedMatchParticipant } from "../matchLaunchRegistry.js";
import { MatchRoomState } from "../schema/GameState.js";

interface MatchRoomOptions {
  readonly launchToken?: unknown;
}

interface JoinOptions {
  readonly accessToken?: unknown;
}

const MAX_MESSAGE_BYTES = 8 * 1024;
const JOIN_TIMEOUT_MILLISECONDS = 30_000;

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
    this.onMessage("match.command", (client, payload: unknown) => this.handleCommand(client, payload));
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    const participant = this.participantForToken(options.accessToken);
    return Boolean(participant && !this.claimedPlayerIds.has(participant.playerId));
  }

  onJoin(client: Client, options: JoinOptions): void {
    const participant = this.participantForToken(options.accessToken);
    if (!participant || this.claimedPlayerIds.has(participant.playerId)) {
      throw new Error("Invalid or already claimed match seat.");
    }
    this.playerIdBySession.set(client.sessionId, participant.playerId);
    this.connectedPlayerIds.add(participant.playerId);
    this.claimedPlayerIds.add(participant.playerId);

    if (this.connectedPlayerIds.size === this.participants.length) {
      this.started = true;
      this.autoDispose = true;
      void this.lock();
      this.state.phase = "playing";
      this.sendFrames(this.authority.initialFrames());
    }
  }

  async onDrop(client: Client): Promise<void> {
    await this.allowReconnection(client, 60);
  }

  onLeave(client: Client): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    this.playerIdBySession.delete(client.sessionId);
    if (playerId) this.connectedPlayerIds.delete(playerId);
  }

  private tick(): void {
    if (!this.started || this.authority.phase !== "playing") return;
    const result = this.authority.step();
    this.state.serverTick = result.serverTick;
    this.state.phase = result.phase === "finished" ? "finished" : "playing";
    this.sendFrames(result.frames);
  }

  private handleCommand(client: Client, payload: unknown): void {
    const playerId = this.playerIdBySession.get(client.sessionId);
    if (!playerId) return this.reject(client, 0, "NOT_ROOM_MEMBER");
    if (!this.isSmallPayload(payload)) return this.reject(client, this.extractSequence(payload), "INVALID_PAYLOAD");
    const result = this.authority.submitIntent(playerId, payload);
    if (!result.queued) this.reject(client, result.sequence, result.code);
  }

  private sendFrames(frames: ReadonlyMap<string, RecipientFrame>): void {
    for (const client of this.clients) {
      const playerId = this.playerIdBySession.get(client.sessionId);
      const frame = playerId ? frames.get(playerId) : undefined;
      if (!frame) continue;
      for (const result of frame.commandResults) client.send("match.commandResult", result);
      client.send("match.frame", frame);
    }
  }

  private reject(client: Client, sequence: number, code: string): void {
    client.send("match.commandResult", {
      accepted: false,
      sequence,
      code,
      serverTick: this.authority.serverTick,
    });
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

  private extractSequence(value: unknown): number {
    return this.isRecord(value) && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
      ? value.sequence as number
      : 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
