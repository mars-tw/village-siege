import Phaser from "phaser";
import { MultiplayerClient, type LobbySnapshot, type MatchFrame } from "../network/MultiplayerClient";

interface LobbyData { villageId?: string }

export class MultiplayerLobbyScene extends Phaser.Scene {
  private root?: HTMLElement;
  private network = new MultiplayerClient();
  private disposers: Array<() => void> = [];
  private state?: LobbySnapshot;
  private matchFrame?: MatchFrame;
  private villageId = "pinehold";

  constructor() {
    super({ key: "MultiplayerLobbyScene" });
  }

  init(data: LobbyData): void {
    this.villageId = data.villageId ?? "pinehold";
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#172d28");
    const host = this.game.canvas.parentElement ?? document.body;
    const root = document.createElement("main");
    root.className = "multiplayer-lobby";
    root.innerHTML = `
      <section class="lobby-card" aria-labelledby="lobby-title">
        <p class="select-kicker">Private multiplayer · 2–5 players</p>
        <h1 id="lobby-title">多人作戰室</h1>
        <p class="lobby-status" data-status>尚未連線</p>
        <label>玩家名稱<input data-name maxlength="24" autocomplete="nickname" value="${this.escape(sessionStorage.getItem("village-siege-name") ?? "Player")}"></label>
        <div class="lobby-connect-actions">
          <button class="primary-action" type="button" data-create>建立房間</button>
          <label>六碼房碼<input data-code maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABC234"></label>
          <button class="secondary-action" type="button" data-join>加入</button>
        </div>
        <p class="lobby-code" data-room-code hidden></p>
        <p class="lobby-error" data-error role="alert"></p>
        <ul class="lobby-roster" data-roster aria-live="polite"><li>建立或加入房間後，玩家會顯示在這裡。</li></ul>
        <div class="lobby-room-actions">
          <button class="secondary-action" type="button" data-ready disabled>準備</button>
          <button class="primary-action" type="button" data-start disabled>開始戰局</button>
          <button class="secondary-action" type="button" data-back>返回</button>
        </div>
      </section>`;
    host.append(root);
    this.root = root;

    root.querySelector<HTMLInputElement>("[data-code]")?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      input.value = input.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
    });
    root.querySelector("[data-create]")?.addEventListener("click", () => void this.connect("create"));
    root.querySelector("[data-join]")?.addEventListener("click", () => void this.connect("join"));
    root.querySelector("[data-ready]")?.addEventListener("click", () => {
      const self = this.state?.players.find((player) => player.sessionId === this.state?.selfId);
      this.network.setReady(!self?.ready);
    });
    root.querySelector("[data-start]")?.addEventListener("click", () => this.network.startMatch());
    root.querySelector("[data-back]")?.addEventListener("click", () => void this.back());

    this.disposers.push(
      this.network.onState((state) => { this.state = state; this.render(); }),
      this.network.onMatchFrame((frame) => { this.matchFrame = frame; this.render(); }),
      this.network.onConnection((status) => this.setText("[data-status]", this.connectionLabel(status))),
      this.network.onError((message) => this.setText("[data-error]", message)),
    );
    this.events.once("shutdown", this.cleanup, this);
    this.events.once("destroy", this.cleanup, this);
  }

  private async connect(mode: "create" | "join"): Promise<void> {
    const name = this.root?.querySelector<HTMLInputElement>("[data-name]")?.value.trim() || "Player";
    const code = this.root?.querySelector<HTMLInputElement>("[data-code]")?.value ?? "";
    sessionStorage.setItem("village-siege-name", name);
    this.setText("[data-error]", "");
    try {
      if (mode === "create") await this.network.createRoom(name, this.villageId);
      else await this.network.joinRoom(code, name, this.villageId);
    } catch {
      // MultiplayerClient already surfaced a recoverable message.
    }
  }

  private render(): void {
    if (!this.root || !this.state) return;
    const state = this.state;
    const self = state.players.find((player) => player.sessionId === state.selfId);
    const code = this.root.querySelector<HTMLElement>("[data-room-code]");
    if (code) { code.hidden = false; code.textContent = `房碼 ${state.roomCode}`; }
    const roster = this.root.querySelector<HTMLElement>("[data-roster]");
    if (roster) roster.innerHTML = state.players.map((player) => `
      <li class="${player.connected ? "" : "is-disconnected"}">
        <strong>${this.escape(player.name)}</strong>
        <span>${this.escape(player.villageId)} · ${player.host ? "房主 · " : ""}${player.connected ? (player.ready ? "已準備" : "未準備") : "重新連線中"}</span>
      </li>`).join("");
    const ready = this.root.querySelector<HTMLButtonElement>("[data-ready]");
    if (ready) { ready.disabled = state.phase !== "lobby"; ready.textContent = self?.ready ? "取消準備" : "準備"; }
    const start = this.root.querySelector<HTMLButtonElement>("[data-start]");
    if (start) {
      start.hidden = !self?.host;
      start.disabled = state.phase !== "lobby" || state.players.length < 2 || state.players.some((player) => !player.ready || !player.connected);
    }
    const status = this.matchFrame
      ? `伺服器權威戰局已連線 · Tick ${this.matchFrame.snapshot.serverTick}`
      : state.phase === "starting"
        ? "正在轉入獨立戰局房…"
        : "已連線，等待所有玩家準備";
    this.setText("[data-status]", status);
  }

  private async back(): Promise<void> {
    await this.network.leave();
    this.scene.start("VillageSelectScene");
  }

  private cleanup(): void {
    this.disposers.splice(0).forEach((dispose) => dispose());
    this.root?.remove();
    this.root = undefined;
  }

  private setText(selector: string, value: string): void {
    const target = this.root?.querySelector<HTMLElement>(selector);
    if (target) target.textContent = value;
  }

  private connectionLabel(status: string): string {
    return ({
      offline: "尚未連線",
      connecting: "連線中…",
      connected: "已連線",
      reconnecting: "連線中斷，120 秒內自動重連…",
      transportReconnecting: "連線中斷，120 秒內自動重連…",
      recoveringHello: "正在重新驗證戰局…",
      recoveringSnapshot: "正在恢復戰場快照…",
      replayingCommands: "正在重播尚未確認的指令…",
      failed: "戰局恢復失敗",
    } as Record<string, string>)[status] ?? status;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  }
}

export default MultiplayerLobbyScene;
