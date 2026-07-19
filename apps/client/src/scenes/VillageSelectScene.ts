import Phaser from "phaser";
import { getDeviceViewportProfile } from "../game/deviceViewport";
import { GAME_FULLSCREEN_FALLBACK_EVENT, fullscreenButtonLabel, toggleGameFullscreen } from "../game/gameFullscreen";

export type VillageId = "pinehold" | "riverstead" | "highcrag";
export type AiPersonality = "aggressor" | "guardian" | "prosperer" | "balanced" | "raider";

const VILLAGES: ReadonlyArray<{ id: VillageId; mark: string; name: string; subtitle: string }> = [
  { id: "pinehold", mark: "松", name: "松林堡", subtitle: "林地資源與防禦兼備" },
  { id: "riverstead", mark: "河", name: "河谷鎮", subtitle: "沿河展開、採集快速" },
  { id: "highcrag", mark: "岩", name: "高地寨", subtitle: "高地要塞、石材充足" },
];

const AI_PROFILES: ReadonlyArray<{ id: AiPersonality; mark: string; name: string; detail: string }> = [
  { id: "aggressor", mark: "攻", name: "侵略者", detail: "迅速集結進攻" },
  { id: "guardian", mark: "守", name: "守城者", detail: "重視城防與反擊" },
  { id: "prosperer", mark: "豐", name: "繁榮者", detail: "先擴張經濟" },
  { id: "balanced", mark: "衡", name: "均衡者", detail: "穩健應對局勢" },
  { id: "raider", mark: "襲", name: "掠襲者", detail: "騷擾薄弱據點" },
];

export class VillageSelectScene extends Phaser.Scene {
  private root?: HTMLElement;
  private villageId: VillageId = "pinehold";
  private aiPersonality: AiPersonality = "balanced";

  constructor() { super({ key: "VillageSelectScene" }); }

  create(): void {
    this.cameras.main.setBackgroundColor("#1c211f");
    const host = this.game.canvas.parentElement ?? document.body;
    host.classList.add("village-siege-host");
    host.classList.add("selection-active");
    const root = document.createElement("main");
    root.className = "village-select-shell";
    root.innerHTML = `
      <div class="map-scrim" aria-hidden="true"><span></span><span></span><span></span></div>
      <header class="select-masthead"><p class="select-kicker">Village Siege · 戰前會議</p><h1>選擇你的村莊</h1><p>挑選地形與對手風格，開始單機戰役或進入私人多人房間。</p></header>
      <section class="village-route"><div class="section-heading"><span>01</span><div><h2>村莊</h2><p>每座聚落有不同的作戰節奏。</p></div></div><div class="village-options">
        ${VILLAGES.map((village) => `<button type="button" class="village-choice" data-village="${village.id}" aria-pressed="false"><span class="choice-mark">${village.mark}</span><span class="choice-copy"><strong>${village.name}</strong><small>${village.subtitle}</small></span><span class="choice-state">選擇</span></button>`).join("")}
      </div></section>
      <section class="ai-roster"><div class="section-heading"><span>02</span><div><h2>電腦對手</h2><p>只套用於單機模式。</p></div></div><div class="ai-options">
        ${AI_PROFILES.map((profile) => `<button type="button" class="ai-choice" data-ai="${profile.id}" aria-pressed="false"><span class="ai-mark">${profile.mark}</span><strong>${profile.name}</strong><small>${profile.detail}</small><span class="choice-state">選擇</span></button>`).join("")}
      </div></section>
      <footer class="march-actions"><p class="selection-readout" role="status"></p><div><button type="button" class="secondary-action" data-fullscreen>⛶ 全螢幕</button><button type="button" class="secondary-action" data-multiplayer>多人連線 <small>2–4 人</small></button><button type="button" class="primary-action" data-start>開始單機戰役</button></div></footer>`;
    host.append(root);
    this.root = root;
    root.querySelectorAll<HTMLButtonElement>("[data-village]").forEach((button) => button.addEventListener("click", () => { this.villageId = button.dataset.village as VillageId; this.syncSelection(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-ai]").forEach((button) => button.addEventListener("click", () => { this.aiPersonality = button.dataset.ai as AiPersonality; this.syncSelection(); }));
    root.querySelector("[data-start]")?.addEventListener("click", () => {
      const profile = getDeviceViewportProfile();
      if (profile.mobile && !this.scale.isFullscreen) toggleGameFullscreen(this);
      this.scene.start("VillageAssaultScene", {
        villageId: this.villageId,
        aiPersonality: this.aiPersonality,
        returnScene: "VillageSelectScene",
      });
    });
    root.querySelector("[data-fullscreen]")?.addEventListener("click", () => {
      toggleGameFullscreen(this);
      this.syncFullscreenButton();
    });
    root.querySelector("[data-multiplayer]")?.addEventListener("click", () => this.scene.start("MultiplayerLobbyScene", { villageId: this.villageId }));
    this.syncSelection();
    this.syncFullscreenButton();
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, this.syncFullscreenButton, this);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.syncFullscreenButton, this);
    this.events.on(GAME_FULLSCREEN_FALLBACK_EVENT, this.syncFullscreenButton, this);
    this.events.once("shutdown", this.destroySelector, this);
    this.events.once("destroy", this.destroySelector, this);
  }

  private syncSelection(): void {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLButtonElement>("[data-village]").forEach((button) => this.selectButton(button, button.dataset.village === this.villageId));
    this.root.querySelectorAll<HTMLButtonElement>("[data-ai]").forEach((button) => this.selectButton(button, button.dataset.ai === this.aiPersonality));
    const village = VILLAGES.find(({ id }) => id === this.villageId);
    const profile = AI_PROFILES.find(({ id }) => id === this.aiPersonality);
    const readout = this.root.querySelector<HTMLElement>(".selection-readout");
    if (readout) readout.textContent = `${village?.name ?? ""} · ${profile?.name ?? ""}`;
  }

  private syncFullscreenButton(): void {
    const button = this.root?.querySelector<HTMLButtonElement>("[data-fullscreen]");
    if (!button) return;
    const label = fullscreenButtonLabel(this);
    button.textContent = `${label.glyph} ${label.label}`;
  }

  private selectButton(button: HTMLButtonElement, selected: boolean): void {
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const label = button.querySelector<HTMLElement>(".choice-state");
    if (label) label.textContent = selected ? "已選" : "選擇";
  }

  private destroySelector(): void {
    this.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, this.syncFullscreenButton, this);
    this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.syncFullscreenButton, this);
    this.events.off(GAME_FULLSCREEN_FALLBACK_EVENT, this.syncFullscreenButton, this);
    this.root?.remove();
    (this.game.canvas.parentElement ?? document.body).classList.remove("selection-active");
    this.root = undefined;
  }
}

export default VillageSelectScene;
