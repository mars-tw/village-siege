import { randomInt } from "node:crypto";
import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import type { GameCommand } from "@village-siege/shared";
import { GameState, PlayerState } from "../schema/GameState.js";
import { createRoomCode, normalizeRoomCode } from "../roomCode.js";

interface JoinOptions {
  roomCode?: unknown;
  playerName?: unknown;
  villageId?: unknown;
}

interface CommandEnvelope {
  matchId: string;
  playerId: string;
  sequence: number;
  clientTick: number;
  command: GameCommand;
}

const VILLAGE_IDS = new Set(["pinehold", "riverstead", "highcrag"]);
const MAX_MESSAGE_BYTES = 8 * 1024;

export class VillageSiegeRoom extends Room<{
  state: GameState;
  metadata: { roomCode: string };
}> {
  maxClients = 4;
  patchRate = 100;

  async onCreate(options: JoinOptions): Promise<void> {
    this.setState(new GameState());
    this.state.roomCode = normalizeRoomCode(options.roomCode) ?? createRoomCode();
    this.state.seed = randomInt(0, 0x1_0000_0000);
    await this.setMetadata({ roomCode: this.state.roomCode });
    this.setSimulationInterval(() => {
      if (this.state.phase === "playing") this.state.serverTick += 1;
    }, 100);

    this.onMessage("lobby.ready", (client, payload: unknown) => {
      if (this.state.phase !== "lobby") return this.reject(client, 0, "MATCH_NOT_IN_LOBBY");
      if (!this.isSmallPayload(payload) || !this.isReadyPayload(payload)) {
        return this.reject(client, 0, "INVALID_PAYLOAD");
      }
      const player = this.state.players.get(client.sessionId);
      if (!player) return this.reject(client, 0, "NOT_ROOM_MEMBER");
      player.ready = payload.ready;
    });

    this.onMessage("lobby.start", (client, payload: unknown) => {
      if (!this.isSmallPayload(payload) || !this.isEmptyPayload(payload)) {
        return this.reject(client, 0, "INVALID_PAYLOAD");
      }
      const player = this.state.players.get(client.sessionId);
      const roster = [...this.state.players.values()];
      if (this.state.phase !== "lobby") return this.reject(client, 0, "MATCH_NOT_IN_LOBBY");
      if (!player?.host) return this.reject(client, 0, "HOST_ONLY");
      if (roster.length < 2) return this.reject(client, 0, "NEED_TWO_PLAYERS");
      if (roster.some((entry) => !entry.connected || !entry.ready)) {
        return this.reject(client, 0, "PLAYERS_NOT_READY");
      }
      this.state.phase = "playing";
      this.state.serverTick = 0;
      this.lock();
      this.broadcast("match.started", { seed: this.state.seed, serverTick: 0 });
    });

    this.onMessage("match.command", (client, payload: unknown) => {
      this.handleCommand(client, payload);
    });
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    return normalizeRoomCode(options.roomCode) !== null;
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

  private handleCommand(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (this.state.phase !== "playing") return this.reject(client, 0, "MATCH_NOT_PLAYING");
    if (!player) return this.reject(client, 0, "NOT_ROOM_MEMBER");
    if (!this.isSmallPayload(payload) || !this.isCommandEnvelope(payload)) {
      return this.reject(client, 0, "INVALID_PAYLOAD");
    }
    if (payload.matchId !== this.roomId || payload.playerId !== client.sessionId) {
      return this.reject(client, payload.sequence, "OWNER_MISMATCH");
    }
    if (payload.sequence <= player.lastSequence) {
      return this.reject(client, payload.sequence, "STALE_OR_DUPLICATE_SEQUENCE");
    }
    if (!this.commandOwnershipMatches(payload.command, client.sessionId)) {
      return this.reject(client, payload.sequence, "ENTITY_NOT_OWNED");
    }

    player.lastSequence = payload.sequence;
    client.send("match.commandResult", {
      accepted: true,
      sequence: payload.sequence,
      serverTick: this.state.serverTick,
    });
  }

  private reject(client: Client, sequence: number, code: string): void {
    client.send("match.commandResult", {
      accepted: false,
      sequence,
      code,
      serverTick: this.state.serverTick,
    });
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

  private isCommandEnvelope(payload: unknown): payload is CommandEnvelope {
    if (!this.isRecord(payload) || !this.isRecord(payload.command)) return false;
    return (
      Object.keys(payload).length === 5 &&
      typeof payload.matchId === "string" &&
      typeof payload.playerId === "string" &&
      Number.isSafeInteger(payload.sequence) &&
      (payload.sequence as number) > 0 &&
      Number.isSafeInteger(payload.clientTick) &&
      (payload.clientTick as number) >= 0 &&
      typeof payload.command.type === "string"
    );
  }

  private commandOwnershipMatches(command: GameCommand, sessionId: string): boolean {
    const value = command as unknown as Record<string, unknown>;
    return value.ownerId === undefined || value.ownerId === sessionId;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private normalizePlayerName(value: unknown): string {
    if (typeof value !== "string") return "Player";
    const name = value.trim().replace(/\s+/g, " ").slice(0, 24);
    return name || "Player";
  }

  private normalizeVillageId(value: unknown): string {
    return typeof value === "string" && VILLAGE_IDS.has(value) ? value : "pinehold";
  }
}
