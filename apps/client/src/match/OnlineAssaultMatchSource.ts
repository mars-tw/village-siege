import {
  type GameCommand,
  type MatchCommandResult,
  type ReplicatedWorldEvent,
  type VisibleSnapshot,
} from "@village-siege/shared";
import {
  type ConnectionState,
  type MatchFrame,
  type MultiplayerClient,
} from "../network/MultiplayerClient.js";
import {
  AuthoritativeFrameInterpolator,
  type AuthoritativeFramePresentation,
} from "./AuthoritativeFrameInterpolator.js";

type Dispose = () => void;

export interface OnlineAssaultTransport {
  onConnection(listener: (state: ConnectionState) => void): Dispose;
  onMatchFrame(listener: (frame: MatchFrame) => void): Dispose;
  onCommandResult(listener: (result: MatchCommandResult) => void): Dispose;
  submitCommand(command: GameCommand): { readonly commandId: string; readonly clientCommandSeq: number };
  leave(): Promise<void>;
}

export interface OnlineAssaultFrame {
  readonly kind: MatchFrame["kind"];
  readonly snapshot: VisibleSnapshot;
  readonly events: readonly ReplicatedWorldEvent[];
}

export interface OnlineAssaultMatchSourceOptions {
  readonly firstFrame?: MatchFrame;
  readonly now?: () => number;
}

/**
 * Online scene data source. It has no simulation authority: commands go to the
 * MultiplayerClient and only verified match frames can replace its snapshot.
 */
export class OnlineAssaultMatchSource {
  readonly mode = "online" as const;
  private readonly interpolator = new AuthoritativeFrameInterpolator();
  private readonly disposers: Dispose[] = [];
  private readonly frameListeners = new Set<(frame: OnlineAssaultFrame) => void>();
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>();
  private readonly commandResultListeners = new Set<(result: MatchCommandResult) => void>();
  private connectionState: ConnectionState = "offline";
  private latestFrame?: OnlineAssaultFrame;
  private disposed = false;
  private readonly now: () => number;

  constructor(
    private readonly client: OnlineAssaultTransport | MultiplayerClient,
    options: OnlineAssaultMatchSourceOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.disposers.push(
      client.onConnection((state) => this.acceptConnection(state)),
      client.onMatchFrame((frame) => this.acceptFrame(frame)),
      client.onCommandResult((result) => this.acceptCommandResult(result)),
    );
    if (options.firstFrame && !this.latestFrame) this.acceptFrame(options.firstFrame);
  }

  get connection(): ConnectionState {
    return this.connectionState;
  }

  get current(): VisibleSnapshot | undefined {
    return this.latestFrame ? cloneWire(this.latestFrame.snapshot) : undefined;
  }

  get latestEvents(): readonly ReplicatedWorldEvent[] {
    return this.latestFrame ? cloneWire(this.latestFrame.events) : [];
  }

  get playerId(): string | undefined {
    return this.latestFrame?.snapshot.recipientPlayerId;
  }

  get teamId(): string | undefined {
    return this.latestFrame?.snapshot.recipientTeamId;
  }

  samplePresentation(nowMs = this.now()): AuthoritativeFramePresentation | undefined {
    return this.interpolator.sample(nowMs);
  }

  submitCommand(command: GameCommand): { readonly commandId: string; readonly clientCommandSeq: number } {
    if (this.disposed) throw new Error("Online assault source is disposed");
    if (this.connectionState !== "connected") {
      throw new Error("Online assault commands are frozen while the authoritative connection is not connected");
    }
    if (!this.latestFrame) throw new Error("Online assault commands are frozen until the first authoritative frame");
    return this.client.submitCommand(command);
  }

  onFrame(listener: (frame: OnlineAssaultFrame) => void): Dispose {
    this.frameListeners.add(listener);
    if (this.latestFrame) listener(cloneWire(this.latestFrame));
    return () => this.frameListeners.delete(listener);
  }

  onConnection(listener: (state: ConnectionState) => void): Dispose {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => this.connectionListeners.delete(listener);
  }

  onCommandResult(listener: (result: MatchCommandResult) => void): Dispose {
    this.commandResultListeners.add(listener);
    return () => this.commandResultListeners.delete(listener);
  }

  async leave(): Promise<void> {
    await this.client.leave();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposers.splice(0).forEach((dispose) => dispose());
    this.frameListeners.clear();
    this.connectionListeners.clear();
    this.commandResultListeners.clear();
    this.interpolator.reset();
    this.latestFrame = undefined;
  }

  private acceptFrame(frame: MatchFrame): void {
    if (this.disposed) return;
    const accepted: OnlineAssaultFrame = {
      kind: frame.kind,
      snapshot: cloneWire(frame.snapshot),
      events: cloneWire(frame.events),
    };
    this.latestFrame = accepted;
    this.interpolator.push(frame, this.now());
    this.frameListeners.forEach((listener) => listener(cloneWire(accepted)));
  }

  private acceptConnection(state: ConnectionState): void {
    if (this.disposed) return;
    this.connectionState = state;
    if (state !== "connected") {
      this.interpolator.reset(this.latestFrame?.snapshot, this.now());
    }
    this.connectionListeners.forEach((listener) => listener(state));
  }

  private acceptCommandResult(result: MatchCommandResult): void {
    if (this.disposed) return;
    const cloned = cloneWire(result);
    this.commandResultListeners.forEach((listener) => listener(cloneWire(cloned)));
  }
}

function cloneWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
