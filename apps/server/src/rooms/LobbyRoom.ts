import { randomBytes, randomInt } from "node:crypto";
import { matchMaker, Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  type PlayableVillageId,
} from "@village-siege/shared";
import { issueMatchLaunch, revokeMatchLaunch, type AuthorizedMatchParticipant } from "../matchLaunchRegistry.js";
import { createRoomCode, normalizeRoomCode } from "../roomCode.js";
import { LobbyState, PlayerState } from "../schema/GameState.js";

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

const MATCH_ROOM_NAME = "village_siege_match";
const VILLAGE_IDS = new Set<PlayableVillageId>(["pinehold", "riverstead", "highcrag"]);
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

  async onCreate(options: JoinOptions): Promise<void> {
    this.setState(new LobbyState());
    this.state.roomCode = normalizeRoomCode(options.roomCode) ?? createRoomCode();
    this.seed = randomInt(0, 0x1_0000_0000);
    await this.setMetadata({ roomCode: this.state.roomCode });

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
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    await this.allowReconnection(client, 60);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  onLeave(client: Client): void {
    const departing = this.state.players.get(client.sessionId);
    const wasHost = departing?.host === true;
    this.state.players.delete(client.sessionId);
    if (wasHost) {
      const successor = this.state.players.values().next().value as PlayerState | undefined;
      if (successor) successor.host = true;
    }
  }

  private async startMatch(client: Client, payload: unknown): Promise<void> {
    if (!this.isSmallPayload(payload) || !this.isEmptyPayload(payload)) {
      return this.reject(client, "INVALID_PAYLOAD");
    }
    const player = this.state.players.get(client.sessionId);
    const roster = [...this.state.players.values()];
    if (this.state.phase !== "lobby") return this.reject(client, "MATCH_NOT_IN_LOBBY");
    if (!player?.host) return this.reject(client, "HOST_ONLY");
    if (roster.length < 2) return this.reject(client, "NEED_TWO_PLAYERS");
    if (roster.some((entry) => !entry.connected || !entry.ready)) {
      return this.reject(client, "PLAYERS_NOT_READY");
    }

    this.state.phase = "starting";
    await this.lock();
    const assignments = new Map<string, MatchAssignment>();
    const participants: AuthorizedMatchParticipant[] = roster.map((entry, index) => {
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
