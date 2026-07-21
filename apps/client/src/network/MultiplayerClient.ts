import { Client, type Room, type SeatReservation } from "@colyseus/sdk";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  type GameCommand,
  type MatchCommandResult,
  type MatchVersionOffer,
} from "@village-siege/shared";
import {
  AuthoritativeMatchStore,
  type ResolvedMatchFrame,
} from "./AuthoritativeMatchStore.js";

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
  selfId: string;
  players: LobbyPlayer[];
}

export type MatchFrame = ResolvedMatchFrame;

interface NetworkPlayer extends LobbyPlayer {}
interface NetworkState {
  roomCode: string;
  phase: LobbySnapshot["phase"];
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

export type ConnectionState =
  | "offline"
  | "connecting"
  | "negotiating"
  | "synchronizing"
  | "connected"
  | "reconnecting";

type Dispose = () => void;
type MultiplayerTransport = Pick<Client, "create" | "join" | "consumeSeatReservation">;

const LOBBY_ROOM_NAME = "village_siege_lobby";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VERSION_OFFER: MatchVersionOffer = {
  protocolVersion: MATCH_PROTOCOL_VERSION,
  rulesVersion: RULES_VERSION,
};

export class MultiplayerClient {
  private readonly client: MultiplayerTransport;
  private lobbyRoom?: Room<NetworkState>;
  private matchRoom?: Room<NetworkMatchState>;
  private matchStore?: AuthoritativeMatchStore;
  private latestFrame?: MatchFrame;
  private enteringMatch = false;
  private connectionState: ConnectionState = "offline";
  private stateListeners = new Set<(state: LobbySnapshot) => void>();
  private connectionListeners = new Set<(state: ConnectionState) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private matchFrameListeners = new Set<(frame: MatchFrame) => void>();
  private commandResultListeners = new Set<(result: MatchCommandResult) => void>();
  private lifecycleGeneration = 0;

  constructor(client?: MultiplayerTransport) {
    this.client = client ?? new Client(import.meta.env.VITE_COLYSEUS_URL ?? "http://localhost:2567");
  }

  onState(listener: (state: LobbySnapshot) => void): Dispose {
    this.stateListeners.add(listener);
    if (this.lobbyRoom) listener(this.snapshot(this.lobbyRoom));
    return () => this.stateListeners.delete(listener);
  }

  onConnection(listener: (state: ConnectionState) => void): Dispose {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
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

  onCommandResult(listener: (result: MatchCommandResult) => void): Dispose {
    this.commandResultListeners.add(listener);
    return () => this.commandResultListeners.delete(listener);
  }

  async createRoom(playerName: string, villageId: string): Promise<void> {
    await this.connect("create", this.createRoomCode(), playerName, villageId);
  }

  async joinRoom(roomCode: string, playerName: string, villageId: string): Promise<void> {
    const normalized = roomCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) {
      const error = new Error("房間代碼格式不正確");
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

  submitCommand(command: GameCommand): { readonly commandId: string; readonly clientCommandSeq: number } {
    if (this.connectionState !== "connected") throw new Error("連線尚未同步，暫停送出指令");
    const room = this.requireMatchRoom();
    const intent = this.requireMatchStore().createIntent(command);
    room.send("match.command", intent);
    return { commandId: intent.commandId, clientCommandSeq: intent.clientCommandSeq };
  }

  retryCommand(commandId: string): void {
    if (this.connectionState !== "connected") throw new Error("連線尚未同步，暫停重送指令");
    this.requireMatchRoom().send("match.command", this.requireMatchStore().retryIntent(commandId));
  }

  async leave(): Promise<void> {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    await this.closeCurrentRooms(lifecycleGeneration);
  }

  private async closeCurrentRooms(lifecycleGeneration: number): Promise<void> {
    const lobbyRoom = this.lobbyRoom;
    const matchRoom = this.matchRoom;
    this.lobbyRoom = undefined;
    this.matchRoom = undefined;
    this.matchStore = undefined;
    this.latestFrame = undefined;
    this.enteringMatch = false;
    await Promise.all([
      lobbyRoom?.leave(true).catch(() => undefined),
      matchRoom?.leave(true).catch(() => undefined),
    ]);
    if (this.lifecycleGeneration === lifecycleGeneration) this.emitConnection("offline");
  }

  private async connect(
    mode: "create" | "join",
    roomCode: string,
    playerName: string,
    villageId: string,
  ): Promise<void> {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    await this.closeCurrentRooms(lifecycleGeneration);
    if (this.lifecycleGeneration !== lifecycleGeneration) return;
    this.emitConnection("connecting");
    try {
      const options = {
        roomCode,
        playerName: playerName.trim().slice(0, 24),
        villageId,
        ...VERSION_OFFER,
      };
      const room = mode === "create"
        ? await this.client.create<NetworkState>(LOBBY_ROOM_NAME, options)
        : await this.client.join<NetworkState>(LOBBY_ROOM_NAME, options);
      if (this.lifecycleGeneration !== lifecycleGeneration) {
        await room.leave(true).catch(() => undefined);
        return;
      }
      this.lobbyRoom = room;
      room.reconnection.minUptime = 1_000;
      room.reconnection.maxRetries = 20;
      room.reconnection.maxDelay = 5_000;
      room.onStateChange(() => {
        if (this.lobbyRoom === room) this.emitState(room);
      });
      room.onDrop(() => {
        if (this.lobbyRoom === room) this.emitConnection("reconnecting");
      });
      room.onReconnect(() => {
        if (this.lobbyRoom === room) this.emitConnection("connected");
      });
      room.onError((_code: number, message?: string) => {
        if (this.lobbyRoom === room) this.emitError(message ?? "多人遊戲連線失敗");
      });
      room.onMessage("lobby.error", (result: { code?: string }) => {
        if (this.lobbyRoom === room) this.emitError(result.code ?? "大廳操作失敗");
      });
      room.onMessage("lobby.matchAssigned", (assignment: MatchAssignment) => {
        if (this.lobbyRoom === room) void this.enterAuthoritativeMatch(room, assignment);
      });
      room.onLeave(() => {
        if (this.lobbyRoom === room) this.lobbyRoom = undefined;
        if (!this.matchRoom) this.emitConnection("offline");
      });
      this.emitConnection("connected");
      this.emitState(room);
    } catch (error) {
      if (this.lifecycleGeneration !== lifecycleGeneration) return;
      this.emitConnection("offline");
      const message = error instanceof Error ? error.message : "無法連線多人遊戲";
      this.emitError(message);
      throw error;
    }
  }

  private async enterAuthoritativeMatch(lobbyRoom: Room<NetworkState>, assignment: MatchAssignment): Promise<void> {
    if (this.enteringMatch || this.matchRoom) return;
    if (!this.isAssignment(assignment)) {
      this.emitError("收到無效的對戰席位");
      return;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    this.enteringMatch = true;
    this.emitConnection("connecting");
    try {
      const room = await this.client.consumeSeatReservation<NetworkMatchState>(assignment.reservation);
      if (this.lifecycleGeneration !== lifecycleGeneration || this.lobbyRoom !== lobbyRoom) {
        await room.leave(true).catch(() => undefined);
        return;
      }
      const store = new AuthoritativeMatchStore(room.roomId, assignment.playerId);
      this.matchRoom = room;
      this.matchStore = store;
      room.reconnection.minUptime = 1_000;
      room.reconnection.maxRetries = 20;
      room.reconnection.maxDelay = 5_000;
      room.onDrop(() => {
        if (this.matchRoom === room) this.emitConnection("reconnecting");
      });
      room.onReconnect(() => {
        if (this.matchRoom === room) {
          this.emitConnection("synchronizing");
          room.send("match.syncRequest", VERSION_OFFER);
        }
      });
      room.onError((_code: number, message?: string) => {
        if (this.matchRoom === room) this.emitError(message ?? "權威對戰連線失敗");
      });
      room.onMessage("match.protocolError", (payload: { code?: string }) => {
        if (this.matchRoom !== room || this.matchStore !== store) return;
        this.emitError(payload.code ?? "多人協定錯誤");
      });
      room.onMessage("match.hello", (payload: unknown) => {
        if (this.matchRoom !== room || this.matchStore !== store) return;
        if (!store.acceptHello(payload)) {
          this.emitError("伺服器協定或規則版本不相容");
          void this.abortMatchHandoff(room, store);
          return;
        }
        this.emitConnection("synchronizing");
        globalThis.setTimeout(() => {
          if (this.matchRoom === room && this.matchStore === store && store.synchronization !== "synchronized") {
            room.send("match.syncRequest", VERSION_OFFER);
          }
        }, 1_500);
      });
      room.onMessage("match.commandResult", (payload: unknown) => {
        if (this.matchRoom !== room || this.matchStore !== store) return;
        const applied = store.applyCommandResult(payload);
        if (!applied.accepted) {
          this.emitError(applied.reason);
          return;
        }
        if (applied.duplicate) return;
        this.commandResultListeners.forEach((listener) => listener(applied.result));
        if (!applied.result.accepted) this.emitError(applied.result.code);
      });
      room.onMessage("match.frame", (payload: unknown) => {
        if (this.matchRoom !== room || this.matchStore !== store) return;
        const applied = store.applyFrame(payload);
        if (!applied.accepted) {
          if (applied.requestResync) room.send("match.syncRequest", VERSION_OFFER);
          return;
        }
        if (applied.duplicate) return;
        this.latestFrame = applied.frame;
        this.matchFrameListeners.forEach((listener) => listener(applied.frame));
        this.emitConnection("connected");
        if (this.lobbyRoom === lobbyRoom) {
          this.lobbyRoom = undefined;
          void lobbyRoom.leave(true);
        }
      });
      room.onLeave(() => {
        if (this.matchRoom !== room) return;
        this.matchRoom = undefined;
        this.matchStore = undefined;
        this.latestFrame = undefined;
        this.emitConnection(this.lobbyRoom ? "connected" : "offline");
      });
      this.emitConnection("negotiating");
      room.send("match.hello", VERSION_OFFER);
    } catch (error) {
      if (this.lifecycleGeneration !== lifecycleGeneration || this.lobbyRoom !== lobbyRoom) return;
      const message = error instanceof Error ? error.message : "無法進入權威對戰";
      this.emitError(message);
      this.emitConnection(this.lobbyRoom ? "connected" : "offline");
    } finally {
      if (this.lifecycleGeneration === lifecycleGeneration) this.enteringMatch = false;
    }
  }

  private async abortMatchHandoff(
    room: Room<NetworkMatchState>,
    store: AuthoritativeMatchStore,
  ): Promise<void> {
    if (this.matchRoom !== room || this.matchStore !== store) return;
    this.matchRoom = undefined;
    this.matchStore = undefined;
    this.latestFrame = undefined;
    await room.leave(true).catch(() => undefined);
    this.emitConnection(this.lobbyRoom ? "connected" : "offline");
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
      selfId: room.sessionId,
      players,
    };
  }

  private createRoomCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((byte) => ALPHABET[byte & 31]).join("");
  }

  private requireLobbyRoom(): Room<NetworkState> {
    if (!this.lobbyRoom) throw new Error("尚未進入多人遊戲大廳");
    return this.lobbyRoom;
  }

  private requireMatchRoom(): Room<NetworkMatchState> {
    if (!this.matchRoom) throw new Error("尚未進入權威對戰");
    return this.matchRoom;
  }

  private requireMatchStore(): AuthoritativeMatchStore {
    if (!this.matchStore) throw new Error("權威對戰狀態尚未建立");
    return this.matchStore;
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

  private emitState(room: Room<NetworkState>): void {
    const state = this.snapshot(room);
    this.stateListeners.forEach((listener) => listener(state));
  }

  private emitConnection(state: ConnectionState): void {
    this.connectionState = state;
    this.connectionListeners.forEach((listener) => listener(state));
  }

  private emitError(message: string): void {
    this.errorListeners.forEach((listener) => listener(message));
  }
}
