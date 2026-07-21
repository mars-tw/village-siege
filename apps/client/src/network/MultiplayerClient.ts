import { Client, type Room, type SeatReservation } from "@colyseus/sdk";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  isMatchLifecycleMessage,
  type AiDifficulty,
  type AiPersonality,
  type GameCommand,
  type MatchCommandResult,
  type MatchLifecycleMessage,
  type MatchVersionOffer,
} from "@village-siege/shared";
import {
  AuthoritativeMatchStore,
  type ResolvedMatchFrame,
} from "./AuthoritativeMatchStore.js";
import { multiplayerAvailability } from "./multiplayerAvailability.js";

export interface LobbyPlayer {
  sessionId: string;
  name: string;
  villageId: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface LobbyAiSlot {
  slotId: string;
  personality: AiPersonality;
  difficulty: AiDifficulty;
  villageId: string;
}

export interface LobbySnapshot {
  roomCode: string;
  phase: "lobby" | "starting";
  selfId: string;
  players: LobbyPlayer[];
  aiSlots: LobbyAiSlot[];
}

export type MatchFrame = ResolvedMatchFrame;

interface NetworkPlayer extends LobbyPlayer {}
interface NetworkAiSlot extends LobbyAiSlot {}
interface NetworkState {
  roomCode: string;
  phase: LobbySnapshot["phase"];
  players: { forEach(callback: (player: NetworkPlayer, key: string) => void): void };
  aiSlots?: { forEach(callback: (slot: NetworkAiSlot, key: string) => void): void };
}

interface NetworkMatchState {
  matchId: string;
  phase: "loading" | "playing" | "finished";
  serverTick: number;
}

interface MatchAssignment {
  playerId: string;
  matchId: string;
  reservation: SeatReservation;
}

export type ConnectionState =
  | "offline"
  | "connecting"
  | "negotiating"
  | "synchronizing"
  | "connected"
  | "reconnecting"
  | "transportReconnecting"
  | "recoveringHello"
  | "recoveringSnapshot"
  | "replayingCommands"
  | "failed";

type Dispose = () => void;
type MultiplayerTransport = Pick<Client, "create" | "join" | "consumeSeatReservation">;

const LOBBY_ROOM_NAME = "village_siege_lobby";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VERSION_OFFER: MatchVersionOffer = {
  protocolVersion: MATCH_PROTOCOL_VERSION,
  rulesVersion: RULES_VERSION,
};
const MATCH_RECOVERY_TIMEOUT_MILLISECONDS = 120_000;

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
  private recoveryEpoch = 0;
  private recoveryDeadlineTimer?: ReturnType<typeof globalThis.setTimeout>;

  constructor(client?: MultiplayerTransport) {
    // Disabled production builds still instantiate Phaser scenes at startup;
    // use a non-routable HTTPS origin without initiating any connection.
    this.client = client ?? new Client(multiplayerAvailability.endpoint ?? "https://multiplayer.invalid");
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

  configureAiSlots(slots: readonly Omit<LobbyAiSlot, "slotId">[]): void {
    this.requireLobbyRoom().send("lobby.ai.configure", {
      slots: slots.map((slot) => ({ ...slot })),
    });
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
    this.clearRecoveryDeadline();
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
      room.reconnection.maxRetries = 30;
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
      const store = new AuthoritativeMatchStore(assignment.matchId, assignment.playerId);
      this.matchRoom = room;
      this.matchStore = store;
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 30;
      room.reconnection.maxDelay = 5_000;
      room.onDrop(() => {
        if (this.matchRoom !== room || this.matchStore !== store || store.synchronization === "failed") return;
        const epoch = ++this.recoveryEpoch;
        if (!store.beginRecovery(epoch)) return this.failMatchRecovery(room, store, epoch, "RECOVERY_TIMEOUT");
        this.emitConnection("transportReconnecting");
        this.scheduleRecoveryDeadline(room, store, epoch, Date.now() + MATCH_RECOVERY_TIMEOUT_MILLISECONDS);
      });
      room.onReconnect(() => {
        if (this.matchRoom !== room || this.matchStore !== store || store.synchronization === "failed") return;
        this.emitConnection("recoveringHello");
        room.send("match.hello", VERSION_OFFER);
      });
      room.onError((_code: number, message?: string) => {
        if (this.matchRoom === room) this.emitError(message ?? "權威對戰連線失敗");
      });
      room.onMessage("match.protocolError", (payload: { code?: string }) => {
        if (this.matchRoom !== room || this.matchStore !== store) return;
        this.emitError(payload.code ?? "多人協定錯誤");
      });
      room.onMessage("match.lifecycle", (payload: unknown) => {
        if (this.matchRoom !== room || this.matchStore !== store || store.synchronization === "failed") return;
        if (!isMatchLifecycleMessage(payload)
          || payload.matchId !== assignment.matchId
          || payload.recipientPlayerId !== assignment.playerId
          || payload.rulesVersion !== RULES_VERSION) {
          this.failMatchRecovery(room, store, store.recoveryEpoch ?? this.recoveryEpoch, "STATE_CORRUPT");
          return;
        }
        this.handleMatchLifecycle(room, store, payload);
      });
      room.onMessage("match.hello", (payload: unknown) => {
        if (this.matchRoom !== room || this.matchStore !== store || store.synchronization === "failed") return;
        if (!store.acceptHello(payload)) {
          this.emitError("伺服器協定或規則版本不相容");
          void this.abortMatchHandoff(room, store);
          return;
        }
        const recoveryEpoch = store.recoveryEpoch;
        if (store.synchronization === "awaitingRecoverySnapshot") {
          this.emitConnection("recoveringSnapshot");
          room.send("match.syncRequest", VERSION_OFFER);
        } else {
          this.emitConnection("synchronizing");
        }
        const lifecycleGenerationAtHello = this.lifecycleGeneration;
        globalThis.setTimeout(() => {
          if (this.lifecycleGeneration === lifecycleGenerationAtHello
            && this.matchRoom === room
            && this.matchStore === store
            && (store.synchronization === "awaitingSnapshot"
              || store.synchronization === "awaitingRecoverySnapshot"
              || store.synchronization === "resyncing")
            && (recoveryEpoch === undefined || store.recoveryEpoch === recoveryEpoch)) {
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
        if (!applied.duplicate) {
          this.latestFrame = applied.frame;
          this.matchFrameListeners.forEach((listener) => listener(applied.frame));
        }
        if (store.synchronization === "replayReady") {
          const epoch = store.recoveryEpoch;
          if (epoch === undefined) {
            this.failMatchRecovery(room, store, this.recoveryEpoch, "STATE_CORRUPT");
            return;
          }
          this.emitConnection("replayingCommands");
          try {
            for (const intent of store.pendingIntentsForReplay(epoch)) room.send("match.command", intent);
          } catch {
            this.failMatchRecovery(room, store, epoch, "SEQUENCE_DIVERGED");
            return;
          }
          if (!store.finishReplay(epoch)) {
            this.failMatchRecovery(room, store, epoch, "SEQUENCE_DIVERGED");
            return;
          }
          this.clearRecoveryDeadline();
        } else if (applied.duplicate) {
          return;
        }
        this.emitConnection("connected");
        if (this.lobbyRoom === lobbyRoom) {
          this.lobbyRoom = undefined;
          void lobbyRoom.leave(true);
        }
      });
      room.onLeave(() => {
        if (this.matchRoom !== room) return;
        if (store.synchronization === "awaitingReconnectHello"
          || store.synchronization === "awaitingRecoverySnapshot"
          || store.synchronization === "replayReady") {
          this.failMatchRecovery(room, store, store.recoveryEpoch ?? this.recoveryEpoch, "SERVER_UNAVAILABLE");
        }
        this.clearRecoveryDeadline();
        this.matchRoom = undefined;
        this.matchStore = undefined;
        this.latestFrame = undefined;
        if (this.connectionState !== "failed") this.emitConnection(this.lobbyRoom ? "connected" : "offline");
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
    const preserveTerminalFailure = store.synchronization === "failed" || this.connectionState === "failed";
    this.matchRoom = undefined;
    this.matchStore = undefined;
    this.latestFrame = undefined;
    this.clearRecoveryDeadline();
    await room.leave(true).catch(() => undefined);
    if (preserveTerminalFailure || this.connectionState === "failed") return;
    this.emitConnection(this.lobbyRoom ? "connected" : "offline");
  }

  private snapshot(room: Room<NetworkState>): LobbySnapshot {
    const players: LobbyPlayer[] = [];
    room.state.players?.forEach((player: NetworkPlayer, sessionId: string) => {
      players.push({
        sessionId,
        name: player.name,
        villageId: player.villageId,
        ready: player.ready,
        connected: player.connected,
        host: player.host,
      });
    });
    const aiSlots: LobbyAiSlot[] = [];
    room.state.aiSlots?.forEach((slot: NetworkAiSlot, slotId: string) => {
      aiSlots.push({
        slotId,
        personality: slot.personality,
        difficulty: slot.difficulty,
        villageId: slot.villageId,
      });
    });
    return {
      roomCode: room.state.roomCode,
      phase: room.state.phase,
      selfId: room.sessionId,
      players,
      aiSlots,
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
      && typeof value.matchId === "string"
      && /^match-[a-f0-9]{32}$/.test(value.matchId)
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

  private handleMatchLifecycle(
    room: Room<NetworkMatchState>,
    store: AuthoritativeMatchStore,
    message: MatchLifecycleMessage,
  ): void {
    if (message.type === "failed") {
      this.failMatchRecovery(room, store, message.recoveryEpoch, message.code);
      return;
    }
    if (message.recoveryEpoch < (store.recoveryEpoch ?? 0)) return;
    if (store.recoveryEpoch !== message.recoveryEpoch && !store.beginRecovery(message.recoveryEpoch)) {
      this.failMatchRecovery(room, store, store.recoveryEpoch ?? this.recoveryEpoch, "SEQUENCE_DIVERGED");
      return;
    }
    this.recoveryEpoch = Math.max(this.recoveryEpoch, message.recoveryEpoch);
    if (message.type === "recovering") {
      this.scheduleRecoveryDeadline(room, store, message.recoveryEpoch, message.leaseExpiresAtEpochMs);
    }
    this.emitConnection("recoveringHello");
  }

  private scheduleRecoveryDeadline(
    room: Room<NetworkMatchState>,
    store: AuthoritativeMatchStore,
    epoch: number,
    expiresAtEpochMs: number,
  ): void {
    this.clearRecoveryDeadline();
    const delay = Math.max(0, Math.min(MATCH_RECOVERY_TIMEOUT_MILLISECONDS, expiresAtEpochMs - Date.now()));
    this.recoveryDeadlineTimer = globalThis.setTimeout(() => {
      if (this.matchRoom !== room || this.matchStore !== store || store.recoveryEpoch !== epoch) return;
      this.failMatchRecovery(room, store, epoch, "RECONNECT_LEASE_EXPIRED");
    }, delay);
  }

  private clearRecoveryDeadline(): void {
    if (this.recoveryDeadlineTimer !== undefined) globalThis.clearTimeout(this.recoveryDeadlineTimer);
    this.recoveryDeadlineTimer = undefined;
  }

  private failMatchRecovery(
    room: Room<NetworkMatchState>,
    store: AuthoritativeMatchStore,
    epoch: number,
    code: string,
  ): void {
    if (this.matchRoom !== room || this.matchStore !== store) return;
    const currentEpoch = store.recoveryEpoch;
    if (currentEpoch !== undefined && epoch < currentEpoch) return;
    if (store.synchronization !== "failed" && currentEpoch !== epoch && !store.beginRecovery(epoch)) return;
    if (store.synchronization !== "failed" && !store.failRecovery(epoch, code)) return;
    this.clearRecoveryDeadline();
    this.emitConnection("failed");
    this.emitError(code);
  }
}
