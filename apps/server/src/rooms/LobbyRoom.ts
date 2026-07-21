import { randomBytes, randomInt } from "node:crypto";
import { matchMaker, Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  type AiDifficulty,
  type AiPersonality,
  type PlayableVillageId,
} from "@village-siege/shared";
import { issueMatchLaunch, revokeMatchLaunch, type AuthorizedMatchParticipant } from "../matchLaunchRegistry.js";
import { serverMetrics } from "../observability/serverMetrics.js";
import { createRoomCode, normalizeRoomCode } from "../roomCode.js";
import { AiSlotState, LobbyState, PlayerState } from "../schema/GameState.js";

interface JoinOptions {
  roomCode?: unknown;
  playerName?: unknown;
  villageId?: unknown;
  protocolVersion?: unknown;
  rulesVersion?: unknown;
}

interface MatchAssignment {
  readonly playerId: string;
  readonly accessToken: string;
  readonly reservationSessionId: string;
}

interface AiSlotInput {
  readonly personality: AiPersonality;
  readonly difficulty: AiDifficulty;
  readonly villageId: PlayableVillageId;
}

const MATCH_ROOM_NAME = "village_siege_match";
const VILLAGE_IDS = new Set<PlayableVillageId>(["pinehold", "riverstead", "highcrag"]);
const AI_PERSONALITIES = new Set<AiPersonality>(["aggressor", "guardian", "prosperer", "balanced", "raider"]);
const AI_DIFFICULTIES = new Set<AiDifficulty>(["novice", "standard", "veteran"]);
const MAX_MESSAGE_BYTES = 8 * 1024;
const HANDOFF_RECOVERY_MILLISECONDS = 35_000;

export class LobbyRoom extends Room<{
  state: LobbyState;
  metadata: { roomCode: string };
}> {
  maxClients = 5;
  maxMessagesPerSecond = 20;
  patchRate = 100;
  private seed = 0;
  private metricsRegistered = false;
  private readonly metricsConnectedSessions = new Set<string>();

  async onCreate(options: JoinOptions): Promise<void> {
    this.setState(new LobbyState());
    this.state.roomCode = normalizeRoomCode(options.roomCode) ?? createRoomCode();
    this.seed = randomInt(0, 0x1_0000_0000);
    await this.setMetadata({ roomCode: this.state.roomCode });
    serverMetrics.lobbyOpened();
    this.metricsRegistered = true;

    this.onMessage("lobby.ready", (client, payload: unknown) => {
      if (this.state.phase !== "lobby") return this.reject(client, "MATCH_NOT_IN_LOBBY");
      if (!this.isSmallPayload(payload) || !this.isReadyPayload(payload)) {
        return this.reject(client, "INVALID_PAYLOAD");
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return this.reject(client, "NOT_ROOM_MEMBER");
      player.ready = payload.ready;
    });

    this.onMessage("lobby.start", (client, payload: unknown) => {
      void this.startMatch(client, payload);
    });
    this.onMessage("lobby.ai.configure", (client, payload: unknown) => {
      this.configureAiSlots(client, payload);
    });
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    return normalizeRoomCode(options.roomCode) !== null
      && options.protocolVersion === MATCH_PROTOCOL_VERSION
      && options.rulesVersion === RULES_VERSION;
  }

  onJoin(client: Client, options: JoinOptions): void {
    const requestedCode = normalizeRoomCode(options.roomCode);
    if (this.state.phase !== "lobby" || requestedCode !== this.state.roomCode) {
      throw new Error("Room is unavailable.");
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = this.normalizePlayerName(options.playerName);
    player.villageId = this.normalizeVillageId(options.villageId);
    player.host = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);
    this.markMetricsConnected(client.sessionId);
    this.trimAiSlotsToCapacity();
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.markMetricsDisconnected(client.sessionId);
    await this.allowReconnection(client, 60);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    if (player) this.markMetricsConnected(client.sessionId);
  }

  onLeave(client: Client): void {
    const departing = this.state.players.get(client.sessionId);
    const wasHost = departing?.host === true;
    this.state.players.delete(client.sessionId);
    this.markMetricsDisconnected(client.sessionId);
    if (wasHost) {
      const successor = this.state.players.values().next().value as PlayerState | undefined;
      if (successor) successor.host = true;
    }
  }

  onDispose(): void {
    for (const sessionId of [...this.metricsConnectedSessions]) this.markMetricsDisconnected(sessionId);
    if (this.metricsRegistered) {
      serverMetrics.lobbyClosed();
      this.metricsRegistered = false;
    }
  }

  private markMetricsConnected(sessionId: string): void {
    if (this.metricsConnectedSessions.has(sessionId)) return;
    this.metricsConnectedSessions.add(sessionId);
    serverMetrics.lobbyPlayerConnected();
  }

  private markMetricsDisconnected(sessionId: string): void {
    if (!this.metricsConnectedSessions.delete(sessionId)) return;
    serverMetrics.lobbyPlayerDisconnected();
  }

  private async startMatch(client: Client, payload: unknown): Promise<void> {
    if (!this.isSmallPayload(payload) || !this.isEmptyPayload(payload)) {
      return this.reject(client, "INVALID_PAYLOAD");
    }
    const player = this.state.players.get(client.sessionId);
    const roster = [...this.state.players.values()];
    const aiRoster = [...this.state.aiSlots.values()];
    if (this.state.phase !== "lobby") return this.reject(client, "MATCH_NOT_IN_LOBBY");
    if (!player?.host) return this.reject(client, "HOST_ONLY");
    if (roster.length < 2) return this.reject(client, "NEED_TWO_PLAYERS");
    if (roster.some((entry) => !entry.connected || !entry.ready)) {
      return this.reject(client, "PLAYERS_NOT_READY");
    }

    this.state.phase = "starting";
    await this.lock();
    const assignments = new Map<string, MatchAssignment>();
    const humanParticipants: AuthorizedMatchParticipant[] = roster.map((entry, index) => {
      const assignment = {
        playerId: `player-${index + 1}`,
        accessToken: randomBytes(32).toString("base64url"),
        reservationSessionId: randomBytes(16).toString("base64url"),
      };
      assignments.set(entry.sessionId, assignment);
      return {
        playerId: assignment.playerId,
        teamId: `team-${index + 1}`,
        name: entry.name,
        villageId: entry.villageId as PlayableVillageId,
        accessToken: assignment.accessToken,
      };
    });
    const aiParticipants: AuthorizedMatchParticipant[] = aiRoster.map((entry, index) => ({
      playerId: `ai-${index + 1}`,
      teamId: `team-${roster.length + index + 1}`,
      name: `AI ${entry.personality}`,
      villageId: entry.villageId as PlayableVillageId,
      ai: {
        personality: entry.personality as AiPersonality,
        difficulty: entry.difficulty as AiDifficulty,
      },
    }));
    const participants = [...humanParticipants, ...aiParticipants];

    try {
      const matchId = `match-${randomBytes(16).toString("hex")}`;
      const launchToken = issueMatchLaunch({ matchId, seed: this.seed, participants });
      let matchRoom;
      try {
        matchRoom = await matchMaker.createRoom(MATCH_ROOM_NAME, { launchToken });
      } catch (error) {
        revokeMatchLaunch(launchToken);
        throw error;
      }
      const reservationResults = await matchMaker.reserveMultipleSeatsFor(
        matchRoom,
        [...assignments.values()].map((assignment) => ({
          sessionId: assignment.reservationSessionId,
          options: {
            accessToken: assignment.accessToken,
            protocolVersion: MATCH_PROTOCOL_VERSION,
            rulesVersion: RULES_VERSION,
          },
          auth: null,
        })),
      );
      if (reservationResults.some((reserved) => !reserved)) {
        await matchMaker.remoteRoomCall(matchRoom.roomId, "disconnect", [4000]).catch(() => undefined);
        throw new Error("Failed to reserve every authoritative match seat.");
      }
      for (const [sessionId, assignment] of assignments) {
        const recipient = this.clients.find((candidate) => candidate.sessionId === sessionId);
        if (recipient) {
          recipient.send("lobby.matchAssigned", {
            playerId: assignment.playerId,
            matchId,
            reservation: matchMaker.buildSeatReservation(matchRoom, assignment.reservationSessionId),
          });
        }
      }
      this.clock.setTimeout(() => void this.recoverExpiredHandoff(), HANDOFF_RECOVERY_MILLISECONDS);
    } catch (error) {
      console.error("Failed to create authoritative match room", error);
      this.state.phase = "lobby";
      await this.unlock();
      this.reject(client, "MATCH_CREATE_FAILED");
    }
  }

  private async recoverExpiredHandoff(): Promise<void> {
    if (this.state.phase !== "starting") return;
    this.state.phase = "lobby";
    for (const player of this.state.players.values()) player.ready = false;
    await this.unlock();
    this.broadcast("lobby.error", { code: "MATCH_HANDOFF_EXPIRED" });
  }

  private configureAiSlots(client: Client, payload: unknown): void {
    if (this.state.phase !== "lobby") return this.reject(client, "MATCH_NOT_IN_LOBBY");
    const player = this.state.players.get(client.sessionId);
    if (!player?.host) return this.reject(client, "HOST_ONLY");
    if (!this.isSmallPayload(payload) || !this.isAiSlotsPayload(payload)) {
      return this.reject(client, "INVALID_PAYLOAD");
    }
    if (payload.slots.length > 5 - this.state.players.size) {
      return this.reject(client, "TOO_MANY_FACTIONS");
    }
    this.state.aiSlots.clear();
    payload.slots.forEach((slot, index) => {
      const state = new AiSlotState();
      state.slotId = `ai-slot-${index + 1}`;
      state.personality = slot.personality;
      state.difficulty = slot.difficulty;
      state.villageId = slot.villageId;
      this.state.aiSlots.set(state.slotId, state);
    });
    for (const entry of this.state.players.values()) entry.ready = false;
  }

  private trimAiSlotsToCapacity(): void {
    const capacity = Math.max(0, 5 - this.state.players.size);
    for (const key of [...this.state.aiSlots.keys()].slice(capacity)) this.state.aiSlots.delete(key);
  }

  private reject(client: Client, code: string): void {
    client.send("lobby.error", { code });
  }

  private isSmallPayload(payload: unknown): boolean {
    try {
      return Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_MESSAGE_BYTES;
    } catch {
      return false;
    }
  }

  private isReadyPayload(payload: unknown): payload is { ready: boolean } {
    return this.isRecord(payload) && Object.keys(payload).length === 1 && typeof payload.ready === "boolean";
  }

  private isAiSlotsPayload(payload: unknown): payload is { slots: readonly AiSlotInput[] } {
    if (!this.isRecord(payload) || Object.keys(payload).length !== 1 || !Array.isArray(payload.slots)) return false;
    return payload.slots.every((slot) => this.isRecord(slot)
      && Object.keys(slot).length === 3
      && typeof slot.personality === "string"
      && AI_PERSONALITIES.has(slot.personality as AiPersonality)
      && typeof slot.difficulty === "string"
      && AI_DIFFICULTIES.has(slot.difficulty as AiDifficulty)
      && typeof slot.villageId === "string"
      && VILLAGE_IDS.has(slot.villageId as PlayableVillageId));
  }

  private isEmptyPayload(payload: unknown): boolean {
    return this.isRecord(payload) && Object.keys(payload).length === 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private normalizePlayerName(value: unknown): string {
    if (typeof value !== "string") return "Player";
    const name = value.trim().replace(/\s+/g, " ").slice(0, 24);
    return name || "Player";
  }

  private normalizeVillageId(value: unknown): PlayableVillageId {
    return typeof value === "string" && VILLAGE_IDS.has(value as PlayableVillageId)
      ? value as PlayableVillageId
      : "pinehold";
  }
}
