import { Client, type Room } from "@colyseus/sdk";
import type { GameCommand } from "@village-siege/shared";

export interface LobbyPlayer {
  sessionId: string;
  name: string;
  villageId: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface LobbySnapshot {
  roomCode: string;
  phase: "lobby" | "playing" | "finished";
  seed: number;
  serverTick: number;
  selfId: string;
  players: LobbyPlayer[];
}

interface NetworkPlayer extends LobbyPlayer {}
interface NetworkState {
  roomCode: string;
  phase: LobbySnapshot["phase"];
  seed: number;
  serverTick: number;
  players: { forEach(callback: (player: NetworkPlayer, key: string) => void): void };
}

type ConnectionState = "offline" | "connecting" | "connected" | "reconnecting";
type Dispose = () => void;

const ROOM_NAME = "village_siege";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MultiplayerClient {
  private readonly client = new Client(import.meta.env.VITE_COLYSEUS_URL ?? "http://localhost:2567");
  private room?: Room<NetworkState>;
  private sequence = 0;
  private stateListeners = new Set<(state: LobbySnapshot) => void>();
  private connectionListeners = new Set<(state: ConnectionState) => void>();
  private errorListeners = new Set<(message: string) => void>();

  onState(listener: (state: LobbySnapshot) => void): Dispose {
    this.stateListeners.add(listener);
    if (this.room) listener(this.snapshot(this.room));
    return () => this.stateListeners.delete(listener);
  }

  onConnection(listener: (state: ConnectionState) => void): Dispose {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onError(listener: (message: string) => void): Dispose {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async createRoom(playerName: string, villageId: string): Promise<void> {
    await this.connect("create", this.createRoomCode(), playerName, villageId);
  }

  async joinRoom(roomCode: string, playerName: string, villageId: string): Promise<void> {
    const normalized = roomCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) throw new Error("房碼必須是六碼英數字。");
    await this.connect("join", normalized, playerName, villageId);
  }

  setReady(ready: boolean): void {
    this.requireRoom().send("lobby.ready", { ready });
  }

  startMatch(): void {
    this.requireRoom().send("lobby.start", {});
  }

  submitCommand(command: GameCommand): number {
    const room = this.requireRoom();
    const sequence = ++this.sequence;
    room.send("match.command", {
      matchId: room.roomId,
      playerId: room.sessionId,
      sequence,
      clientTick: room.state.serverTick,
      command,
    });
    return sequence;
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = undefined;
    if (room) await room.leave(true);
    this.emitConnection("offline");
  }

  private async connect(
    mode: "create" | "join",
    roomCode: string,
    playerName: string,
    villageId: string,
  ): Promise<void> {
    await this.leave();
    this.emitConnection("connecting");
    try {
      const options = { roomCode, playerName: playerName.trim().slice(0, 24), villageId };
      const room = mode === "create"
        ? await this.client.create<NetworkState>(ROOM_NAME, options)
        : await this.client.join<NetworkState>(ROOM_NAME, options);
      this.room = room;
      this.sequence = 0;
      room.reconnection.minUptime = 1_000;
      room.reconnection.maxRetries = 20;
      room.reconnection.maxDelay = 5_000;
      room.onStateChange(() => this.emitState(room));
      room.onDrop(() => this.emitConnection("reconnecting"));
      room.onReconnect(() => this.emitConnection("connected"));
      room.onError((_code: number, message?: string) => this.emitError(message ?? "連線發生未預期錯誤。"));
      room.onMessage("match.commandResult", (result: { accepted?: boolean; code?: string }) => {
        if (result.accepted === false) this.emitError(result.code ?? "指令遭伺服器拒絕。");
      });
      room.onMessage("match.started", () => this.emitState(room));
      room.onLeave(() => {
        if (this.room === room) {
          this.room = undefined;
          this.emitConnection("offline");
        }
      });
      this.emitConnection("connected");
      this.emitState(room);
    } catch (error) {
      this.emitConnection("offline");
      const message = error instanceof Error ? error.message : "無法連線至房間。";
      this.emitError(message);
      throw error;
    }
  }

  private snapshot(room: Room<NetworkState>): LobbySnapshot {
    const players: LobbyPlayer[] = [];
    room.state.players.forEach((player: NetworkPlayer, sessionId: string) => {
      players.push({
        sessionId,
        name: player.name,
        villageId: player.villageId,
        ready: player.ready,
        connected: player.connected,
        host: player.host,
      });
    });
    return {
      roomCode: room.state.roomCode,
      phase: room.state.phase,
      seed: room.state.seed,
      serverTick: room.state.serverTick,
      selfId: room.sessionId,
      players,
    };
  }

  private createRoomCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((byte) => ALPHABET[byte & 31]).join("");
  }

  private requireRoom(): Room<NetworkState> {
    if (!this.room) throw new Error("尚未加入多人房間。");
    return this.room;
  }

  private emitState(room: Room<NetworkState>): void {
    const state = this.snapshot(room);
    this.stateListeners.forEach((listener) => listener(state));
  }

  private emitConnection(state: ConnectionState): void {
    this.connectionListeners.forEach((listener) => listener(state));
  }

  private emitError(message: string): void {
    this.errorListeners.forEach((listener) => listener(message));
  }
}
