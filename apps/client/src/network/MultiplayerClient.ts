import { Client, type Room, type SeatReservation } from "@colyseus/sdk";
import type { DomainEvent, GameCommand, VisibleSnapshot } from "@village-siege/shared";

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
  phase: "lobby" | "starting";
  seed: number;
  selfId: string;
  players: LobbyPlayer[];
}

export interface MatchFrame {
  snapshot: VisibleSnapshot;
  events: readonly DomainEvent[];
  commandResults: readonly {
    accepted: boolean;
    sequence: number;
    code?: string;
    serverTick: number;
  }[];
}

interface NetworkPlayer extends LobbyPlayer {}
interface NetworkState {
  roomCode: string;
  phase: LobbySnapshot["phase"];
  seed: number;
  players: { forEach(callback: (player: NetworkPlayer, key: string) => void): void };
}

interface NetworkMatchState {
  matchId: string;
  phase: "loading" | "playing" | "finished";
  serverTick: number;
}

interface MatchAssignment {
  playerId: string;
  reservation: SeatReservation;
}

type ConnectionState = "offline" | "connecting" | "connected" | "reconnecting";
type Dispose = () => void;

const LOBBY_ROOM_NAME = "village_siege_lobby";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MultiplayerClient {
  private readonly client = new Client(import.meta.env.VITE_COLYSEUS_URL ?? "http://localhost:2567");
  private lobbyRoom?: Room<NetworkState>;
  private matchRoom?: Room<NetworkMatchState>;
  private latestFrame?: MatchFrame;
  private enteringMatch = false;
  private sequence = 0;
  private stateListeners = new Set<(state: LobbySnapshot) => void>();
  private connectionListeners = new Set<(state: ConnectionState) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private matchFrameListeners = new Set<(frame: MatchFrame) => void>();

  onState(listener: (state: LobbySnapshot) => void): Dispose {
    this.stateListeners.add(listener);
    if (this.lobbyRoom) listener(this.snapshot(this.lobbyRoom));
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

  onMatchFrame(listener: (frame: MatchFrame) => void): Dispose {
    this.matchFrameListeners.add(listener);
    if (this.latestFrame) listener(this.latestFrame);
    return () => this.matchFrameListeners.delete(listener);
  }

  async createRoom(playerName: string, villageId: string): Promise<void> {
    await this.connect("create", this.createRoomCode(), playerName, villageId);
  }

  async joinRoom(roomCode: string, playerName: string, villageId: string): Promise<void> {
    const normalized = roomCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) {
      const error = new Error("房碼必須是六碼英數字。");
      this.emitError(error.message);
      throw error;
    }
    await this.connect("join", normalized, playerName, villageId);
  }

  setReady(ready: boolean): void {
    this.requireLobbyRoom().send("lobby.ready", { ready });
  }

  startMatch(): void {
    this.requireLobbyRoom().send("lobby.start", {});
  }

  submitCommand(command: GameCommand): number {
    const room = this.requireMatchRoom();
    const sequence = ++this.sequence;
    room.send("match.command", {
      sequence,
      clientTick: this.latestFrame?.snapshot.serverTick ?? room.state.serverTick,
      command,
    });
    return sequence;
  }

  async leave(): Promise<void> {
    const lobbyRoom = this.lobbyRoom;
    const matchRoom = this.matchRoom;
    this.lobbyRoom = undefined;
    this.matchRoom = undefined;
    this.latestFrame = undefined;
    this.enteringMatch = false;
    await Promise.all([
      lobbyRoom?.leave(true).catch(() => undefined),
      matchRoom?.leave(true).catch(() => undefined),
    ]);
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
        ? await this.client.create<NetworkState>(LOBBY_ROOM_NAME, options)
        : await this.client.join<NetworkState>(LOBBY_ROOM_NAME, options);
      this.lobbyRoom = room;
      this.sequence = 0;
      room.reconnection.minUptime = 1_000;
      room.reconnection.maxRetries = 20;
      room.reconnection.maxDelay = 5_000;
      room.onStateChange(() => this.emitState(room));
      room.onDrop(() => this.emitConnection("reconnecting"));
      room.onReconnect(() => this.emitConnection("connected"));
      room.onError((_code: number, message?: string) => this.emitError(message ?? "連線發生未預期錯誤。"));
      room.onMessage("lobby.error", (result: { code?: string }) => this.emitError(result.code ?? "大廳操作失敗。"));
      room.onMessage("lobby.matchAssigned", (assignment: MatchAssignment) => {
        void this.enterAuthoritativeMatch(room, assignment);
      });
      room.onLeave(() => {
        if (this.lobbyRoom === room) {
          this.lobbyRoom = undefined;
        }
        if (!this.matchRoom) {
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

  private async enterAuthoritativeMatch(lobbyRoom: Room<NetworkState>, assignment: MatchAssignment): Promise<void> {
    if (this.enteringMatch || this.matchRoom) return;
    if (!this.isAssignment(assignment)) {
      this.emitError("收到無效的戰局席位。");
      return;
    }
    this.enteringMatch = true;
    this.emitConnection("connecting");
    try {
      const room = await this.client.consumeSeatReservation<NetworkMatchState>(assignment.reservation);
      this.matchRoom = room;
      this.sequence = 0;
      room.reconnection.minUptime = 1_000;
      room.reconnection.maxRetries = 20;
      room.reconnection.maxDelay = 5_000;
      room.onDrop(() => this.emitConnection("reconnecting"));
      room.onReconnect(() => this.emitConnection("connected"));
      room.onError((_code: number, message?: string) => this.emitError(message ?? "戰局連線發生未預期錯誤。"));
      room.onMessage("match.commandResult", (result: { accepted?: boolean; code?: string }) => {
        if (result.accepted === false) this.emitError(result.code ?? "指令遭伺服器拒絕。");
      });
      room.onMessage("match.frame", (frame: MatchFrame) => {
        if (!this.isFrameForAssignment(frame, assignment, room)) return;
        if (this.latestFrame && frame.snapshot.serverTick < this.latestFrame.snapshot.serverTick) return;
        this.latestFrame = frame;
        this.matchFrameListeners.forEach((listener) => listener(frame));
        if (this.lobbyRoom === lobbyRoom) {
          this.lobbyRoom = undefined;
          void lobbyRoom.leave(true);
        }
      });
      room.onLeave(() => {
        if (this.matchRoom === room) {
          this.matchRoom = undefined;
          this.emitConnection("offline");
        }
      });
      this.emitConnection("connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "無法進入權威戰局。";
      this.emitError(message);
      this.emitConnection("connected");
    } finally {
      this.enteringMatch = false;
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
      selfId: room.sessionId,
      players,
    };
  }

  private createRoomCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((byte) => ALPHABET[byte & 31]).join("");
  }

  private requireLobbyRoom(): Room<NetworkState> {
    if (!this.lobbyRoom) throw new Error("尚未加入多人房間。");
    return this.lobbyRoom;
  }

  private requireMatchRoom(): Room<NetworkMatchState> {
    if (!this.matchRoom) throw new Error("尚未進入權威戰局。");
    return this.matchRoom;
  }

  private isAssignment(value: MatchAssignment): boolean {
    return typeof value?.playerId === "string"
      && value.playerId.length > 0
      && typeof value.reservation?.roomId === "string"
      && value.reservation.roomId.length > 0
      && typeof value.reservation.sessionId === "string"
      && value.reservation.sessionId.length > 0
      && value.reservation.name === "village_siege_match";
  }

  private isFrameForAssignment(
    frame: MatchFrame,
    assignment: MatchAssignment,
    room: Room<NetworkMatchState>,
  ): boolean {
    const snapshot = frame?.snapshot;
    if (!snapshot || snapshot.matchId !== room.roomId || snapshot.recipientPlayerId !== assignment.playerId) {
      this.emitError("伺服器回傳了不屬於此玩家的戰局資料。");
      return false;
    }
    return Array.isArray(frame.events) && Array.isArray(frame.commandResults);
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
