import Phaser from "phaser";
import {
  COMBAT_UNIT_IDS,
  COMBAT_UNITS,
  MONSTER_IDS,
  MONSTERS,
  STATUS_EFFECTS,
  calculateDamage,
  type AiPersonality,
} from "@village-siege/shared";
import { DEFAULT_TEAM_PALETTES } from "../game/combatArt";
import { createFrameAnimatedCombatActor, requireFrameAnimatedManifest } from "../game/frameAnimatedCombatActor";
import {
  ANIMATED_MONSTER_FRAME_ASSETS,
  ANIMATED_UNIT_FRAME_ASSETS,
  COMBAT_ANIMATION_MANIFEST,
  assertCombatAnimationManifestValid,
} from "../game/combatAnimationManifest";
import type { CombatAction, CombatArtId } from "../game/directionalAnimation";
import { gridDistance, gridToWorld, worldToGrid, type GridPoint, type ScreenPoint } from "../game/isometric";
import {
  BATTLE_MAP_HEIGHT,
  BATTLE_MAP_WIDTH,
  clampToWalkable,
  drawBattleMap,
  findPath,
  getBattleTile,
  getObjectiveZones,
  getSuggestedSpawns,
  type BattleMapView,
  type ObjectiveZone,
} from "../game/battleMap";
import {
  SquadSelectionController,
  assignFormationDestinations,
  createPointerRectangle,
  type FormationKind,
  type ScreenGridAdapter,
  type SquadMember,
} from "../game/squadControls";
import {
  BEACON_IDS,
  SkirmishDirector,
  type BeaconId,
  type SkirmishDirectorEvent,
  type SkirmishSide,
} from "../game/skirmishDirector";
import {
  launchProjectile,
  spawnDeathDust,
  spawnFloatingText,
  spawnImpactBurst,
  spawnSkillTelegraph,
  type ProjectileVisualKind,
} from "../game/combatEffects";
import { getDeviceViewportProfile } from "../game/deviceViewport";
import { GAME_FULLSCREEN_FALLBACK_EVENT, fullscreenButtonLabel, toggleGameFullscreen } from "../game/gameFullscreen";
import { createCanvasButton, type CanvasButtonControl } from "../ui/canvasButton";
import type { VillageId } from "../game/content";

type Team = "player" | "enemy" | "monster";

interface CombatDefinitionView {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly maxHitPoints: number;
  readonly armor: number;
  readonly baseDamage: number;
  readonly attackIntervalMs: number;
  readonly attackRange: number;
  readonly moveSpeed: number;
  readonly projectileProfileId?: string;
  readonly animationProfileId: string;
  readonly activeAbility: {
    readonly id: string;
    readonly displayName: string;
    readonly cooldownMs: number;
    readonly windupMs: number;
    readonly recoveryMs: number;
    readonly targeting: "self" | "unit" | "ground" | "direction";
    readonly description: string;
    readonly statusEffects: readonly string[];
    readonly damageMultiplier?: number;
  };
  readonly counterModifiers?: Readonly<Record<string, number>>;
}

interface CombatVisual {
  readonly container: Phaser.GameObjects.Container;
  play(action: CombatAction, restart?: boolean): unknown;
  faceVector(gridDx: number, gridDy: number): unknown;
  update(deltaMs: number): unknown;
  destroy(): void;
}

interface ShowcaseActor {
  readonly instanceId: string;
  readonly contentId: string;
  readonly artId: CombatArtId;
  readonly team: Team;
  readonly definition: CombatDefinitionView;
  readonly visual: CombatVisual;
  readonly selectionRing: Phaser.GameObjects.Graphics;
  readonly healthBar: Phaser.GameObjects.Graphics;
  readonly teamMark: Phaser.GameObjects.Text;
  readonly statuses: Map<string, number>;
  readonly statusTicks: Map<string, number>;
  position: GridPoint;
  destination?: GridPoint;
  targetId?: string;
  hitPoints: number;
  attackCooldownMs: number;
  skillCooldownMs: number;
  actionLockMs: number;
  repathCooldownMs: number;
  aiDecisionCooldownMs: number;
  route: GridPoint[];
  deployed: boolean;
  provokedBy: SkirmishSide | null;
  objectiveId?: BeaconId;
  lastDamagedBy?: string;
  dead: boolean;
}

interface SceneData {
  readonly villageId?: VillageId;
  readonly aiPersonality?: AiPersonality;
  readonly returnScene?: string;
}

interface BattleRewardLedger {
  food: number;
  wood: number;
  stone: number;
}

type TouchInteractionMode = "smart" | "move" | "attack" | "box" | "pan";
type TouchControlPanel = "main" | "groups" | "system";

interface TouchButtonSpec {
  readonly glyph: string;
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly action?: string;
  readonly mode?: TouchInteractionMode;
}

interface TouchCameraDrag {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

const ORIGIN: ScreenPoint = { x: 780, y: 70 };
const WORLD_BOUNDS = { x: 0, y: 0, width: 1660, height: 920 } as const;
const PLAYER_COLOR = 0x65c9a4;
const ENEMY_COLOR = 0xe06f55;
const MONSTER_COLOR = 0xc59b59;

const TOUCH_PANEL_BUTTONS: Readonly<Record<TouchControlPanel, readonly TouchButtonSpec[]>> = {
  main: [
    { glyph: "全", label: "全軍", action: "select-all" },
    { glyph: "走", label: "移動", mode: "move" },
    { glyph: "攻", label: "攻擊", mode: "attack" },
    { glyph: "技", label: "技能", action: "skill" },
    { glyph: "陣", label: "隊形", action: "formation" },
    { glyph: "框", label: "框選", mode: "box" },
    { glyph: "移", label: "移鏡", mode: "pan" },
    { glyph: "•••", label: "更多", action: "open-system" },
  ],
  groups: [
    { glyph: "存", label: "存編 1", accessibleLabel: "儲存編隊 1", action: "store-1" },
    { glyph: "叫", label: "叫編 1", accessibleLabel: "選取編隊 1", action: "recall-1" },
    { glyph: "存", label: "存編 2", accessibleLabel: "儲存編隊 2", action: "store-2" },
    { glyph: "叫", label: "叫編 2", accessibleLabel: "選取編隊 2", action: "recall-2" },
    { glyph: "存", label: "存編 3", accessibleLabel: "儲存編隊 3", action: "store-3" },
    { glyph: "叫", label: "叫編 3", accessibleLabel: "選取編隊 3", action: "recall-3" },
    { glyph: "返", label: "主命令", action: "open-main" },
  ],
  system: [
    { glyph: "消", label: "取消", action: "clear" },
    { glyph: "組", label: "編隊", action: "open-groups" },
    { glyph: "＋", label: "拉近", action: "zoom-in" },
    { glyph: "－", label: "拉遠", action: "zoom-out" },
    { glyph: "Ⅱ", label: "暫停", action: "pause" },
    { glyph: "?", label: "說明", action: "open-briefing" },
    { glyph: "重", label: "重開", action: "restart" },
    { glyph: "退", label: "離開", action: "leave" },
    { glyph: "返", label: "主命令", action: "open-main" },
  ],
};

const UNIT_ART_IDS: Readonly<Record<string, CombatArtId>> = {
  warrior: "warrior",
  shieldBearer: "shieldbearer",
  archer: "archer",
  mage: "mage",
  musketeer: "musketeer",
  boarRider: "boar_rider",
  heavyCrossbowman: "heavy_crossbow",
};

const PROJECTILE_KIND: Readonly<Record<string, ProjectileVisualKind>> = {
  archer: "arrow",
  mage: "arcane",
  musketeer: "musket",
  heavyCrossbowman: "bolt",
  ashwing: "ember",
  miremaw: "spore",
};

export class CombatShowcaseScene extends Phaser.Scene {
  private actors: ShowcaseActor[] = [];
  private selected?: ShowcaseActor;
  private readonly squadSelection = new SquadSelectionController<SquadMember>("player");
  private readonly director = new SkirmishDirector({
    preparationDurationMs: 10_000,
    reinforcementPhaseAtMs: 55_000,
    showdownPhaseAtMs: 115_000,
    captureDurationMs: 5_500,
    victoryPointsPerBeaconPerSecond: 0.4,
  });
  private formationKind: FormationKind = "wedge";
  private mapView?: BattleMapView;
  private dragStart?: ScreenPoint;
  private dragClickedId?: string;
  private dragAdditive = false;
  private selectionBox?: Phaser.GameObjects.Graphics;
  private scoreText?: Phaser.GameObjects.Text;
  private readonly objectiveMarkers = new Map<BeaconId, { graphics: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
  private cameraKeys?: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private instructionText?: Phaser.GameObjects.Text;
  private selectionText?: Phaser.GameObjects.Text;
  private resultText?: Phaser.GameObjects.Text;
  private interfacePanel?: Phaser.GameObjects.Graphics;
  private touchControls?: Phaser.GameObjects.Container;
  private touchReadout?: Phaser.GameObjects.Text;
  private touchReadoutPanel?: Phaser.GameObjects.Graphics;
  private touchBriefing?: Phaser.GameObjects.Container;
  private touchBriefingOpen = false;
  private readonly touchPanels = new Map<TouchControlPanel, Phaser.GameObjects.Container>();
  private readonly touchButtons = new Map<string, CanvasButtonControl>();
  private fullscreenButton?: CanvasButtonControl;
  private rotatePrompt?: Phaser.GameObjects.Container;
  private touchMode: TouchInteractionMode = "smart";
  private touchPanel: TouchControlPanel = "main";
  private touchCameraDrag?: TouchCameraDrag;
  private touchDidPan = false;
  private touchNotice = "";
  private touchNoticeUntil = 0;
  private villageId: VillageId = "pinehold";
  private aiPersonality: AiPersonality = "balanced";
  private returnScene = "VillageSelectScene";
  private battleRewards: Record<SkirmishSide, BattleRewardLedger> = {
    player: { food: 0, wood: 0, stone: 0 },
    enemy: { food: 0, wood: 0, stone: 0 },
  };
  private ended = false;
  private battlePaused = false;
  private simulationAccumulatorMs = 0;
  private uiRefreshElapsedMs = 0;
  private artLoadFailures: string[] = [];
  private loadingUi?: Phaser.GameObjects.Container;
  private loadingBar?: Phaser.GameObjects.Graphics;
  private loadingPercent?: Phaser.GameObjects.Text;
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;

  constructor() {
    super({ key: "CombatShowcaseScene" });
  }

  init(data: SceneData): void {
    this.villageId = data.villageId ?? "pinehold";
    this.aiPersonality = data.aiPersonality ?? "balanced";
    this.returnScene = data.returnScene ?? "VillageSelectScene";
    this.battleRewards = {
      player: { food: 0, wood: 0, stone: 0 },
      enemy: { food: 0, wood: 0, stone: 0 },
    };
    this.actors = [];
    this.selected = undefined;
    this.squadSelection.clearSelection();
    this.director.reset();
    this.formationKind = "wedge";
    this.dragStart = undefined;
    this.dragClickedId = undefined;
    this.touchMode = "smart";
    this.touchPanel = "main";
    this.touchBriefingOpen = false;
    this.touchCameraDrag = undefined;
    this.touchDidPan = false;
    this.touchNotice = "";
    this.touchNoticeUntil = 0;
    this.ended = false;
    this.battlePaused = false;
    this.simulationAccumulatorMs = 0;
    this.uiRefreshElapsedMs = 0;
    this.artLoadFailures = [];
    this.pinchStartDistance = 0;
    this.pinchStartZoom = 1;
  }

  preload(): void {
    assertCombatAnimationManifestValid();
    const assets = [...ANIMATED_UNIT_FRAME_ASSETS, ...ANIMATED_MONSTER_FRAME_ASSETS]
      .filter((asset) => !this.textures.exists(asset.textureKey));
    if (assets.length === 0) return;

    this.cameras.main.setBackgroundColor("#101917");
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    const panel = this.add.graphics();
    panel.fillStyle(0x0a100e, 0.97).fillRect(-360, -138, 720, 276);
    panel.fillStyle(0xd9cca0, 1).fillRect(-348, -126, 696, 252);
    panel.lineStyle(5, 0x101917, 1).strokeRect(-348, -126, 696, 252);
    panel.lineStyle(3, 0x356b78, 0.78).strokeRect(-337, -115, 674, 230);
    const kicker = this.add.text(-304, -91, "BATTLEFIELD QUARTERMASTER", {
      color: "#356b78",
      fontFamily: "Consolas, monospace",
      fontSize: "16px",
      fontStyle: "bold",
      letterSpacing: 2,
    });
    const title = this.add.text(-304, -53, "正在展開戰場素材", {
      color: "#101917",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "36px",
      fontStyle: "bold",
    });
    const copy = this.add.text(-304, 2, `${this.villageDoctrineLabel()}｜敵策：${this.aiPersonalityLabel()}`, {
      color: "#25483c",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "19px",
      fontStyle: "bold",
    });
    this.loadingBar = this.add.graphics();
    this.loadingPercent = this.add.text(304, 74, "0%", {
      color: "#101917",
      fontFamily: "Consolas, monospace",
      fontSize: "18px",
      fontStyle: "bold",
    }).setOrigin(1, 0.5);
    this.loadingUi = this.add.container(width / 2, height / 2, [panel, kicker, title, copy, this.loadingBar, this.loadingPercent]);
    this.onCombatLoadProgress(0);

    this.load.on(Phaser.Loader.Events.PROGRESS, this.onCombatLoadProgress, this);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onCombatArtLoadError, this);
    for (const asset of assets) this.load.image(asset.textureKey, asset.path);
  }

  create(): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.load.off(Phaser.Loader.Events.PROGRESS, this.onCombatLoadProgress, this);
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onCombatArtLoadError, this);
    this.loadingUi?.destroy(true);
    this.loadingUi = undefined;
    this.loadingBar = undefined;
    this.loadingPercent = undefined;
    if (this.artLoadFailures.length > 0) {
      this.showCombatArtLoadFailure();
      return;
    }
    this.cameras.main.setBackgroundColor("#17241f");
    this.cameras.main.setBounds(WORLD_BOUNDS.x, WORLD_BOUNDS.y, WORLD_BOUNDS.width, WORLD_BOUNDS.height);
    const center = gridToWorld({ x: (BATTLE_MAP_WIDTH - 1) / 2, y: (BATTLE_MAP_HEIGHT - 1) / 2 }, ORIGIN);
    this.cameras.main.centerOn(center.x, center.y);
    this.mapView = drawBattleMap(this, ORIGIN);
    this.createInterface();
    this.createTouchControls();
    this.createObjectiveMarkers();
    this.spawnCombatants();
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.input.addPointer(2);
    this.input.keyboard?.on("keydown-Q", this.onSkillKey, this);
    this.input.keyboard?.on("keydown-R", this.restartBattle, this);
    this.input.keyboard?.on("keydown-ESC", this.leaveShowcase, this);
    this.input.keyboard?.on("keydown-P", this.toggleBattlePause, this);
    this.input.keyboard?.on("keydown", this.onKeyboardShortcut, this);
    window.addEventListener("resize", this.onViewportResize);
    this.createCameraKeys();
    this.updateSelectionPanel();
    this.updateSkirmishInterface();
    this.maybeShowTouchBriefing();
  }

  update(_time: number, delta: number): void {
    const frameDeltaMs = Math.min(delta, 200);
    this.updateCamera(frameDeltaMs / 1000);
    if (this.battlePaused) return;
    const stepMs = 1000 / 30;
    this.simulationAccumulatorMs += frameDeltaMs;
    let steps = 0;
    while (this.simulationAccumulatorMs >= stepMs && steps < 6) {
      this.stepCombatSimulation(stepMs);
      this.simulationAccumulatorMs -= stepMs;
      steps += 1;
    }
    if (steps === 6) this.simulationAccumulatorMs = 0;
    if (steps === 0) return;
    for (const actor of this.actors) {
      this.positionActor(actor);
    }
    this.uiRefreshElapsedMs += steps * stepMs;
    if (this.uiRefreshElapsedMs >= 100) {
      this.uiRefreshElapsedMs %= 100;
      this.updateSelectionPanel();
      this.updateSkirmishInterface();
    }
  }

  private stepCombatSimulation(deltaMs: number): void {
    const preparation = this.director.state.phase === "preparation";
    for (const actor of this.actors) {
      actor.visual.update(deltaMs);
      this.tickStatuses(actor, deltaMs);
      actor.attackCooldownMs = Math.max(0, actor.attackCooldownMs - deltaMs);
      actor.skillCooldownMs = Math.max(0, actor.skillCooldownMs - deltaMs);
      actor.actionLockMs = Math.max(0, actor.actionLockMs - deltaMs);
      actor.repathCooldownMs = Math.max(0, actor.repathCooldownMs - deltaMs);
      actor.aiDecisionCooldownMs = Math.max(0, actor.aiDecisionCooldownMs - deltaMs);
      if (!actor.dead) this.updateActor(actor, deltaMs / 1000, preparation);
    }
    this.tickSkirmish(deltaMs);
  }

  private readonly onCombatLoadProgress = (progress: number): void => {
    const clamped = Phaser.Math.Clamp(progress, 0, 1);
    this.loadingBar?.clear();
    this.loadingBar?.fillStyle(0x101917, 1).fillRect(-304, 58, 608, 34);
    this.loadingBar?.fillStyle(0x25483c, 1).fillRect(-298, 64, 596 * clamped, 22);
    this.loadingBar?.lineStyle(3, 0xe0b866, 1).strokeRect(-304, 58, 608, 34);
    this.loadingPercent?.setText(`${Math.round(clamped * 100)}%`);
  };

  private readonly onCombatArtLoadError = (file: { readonly key?: unknown }): void => {
    const key = typeof file.key === "string" ? file.key : "unknown-combat-art";
    if ((key.startsWith("unit-action-sheet-") || key.startsWith("monster-action-sheet-")) && !this.artLoadFailures.includes(key)) {
      this.artLoadFailures.push(key);
    }
  };

  private showCombatArtLoadFailure(): void {
    this.cameras.main.setBackgroundColor("#171c1a");
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    this.add.text(width / 2, height / 2 - 55, "戰場美術載入失敗", {
      color: "#ffb09c",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "38px",
      fontStyle: "bold",
    }).setOrigin(0.5).setScrollFactor(0);
    this.add.text(width / 2, height / 2 + 30, `缺少：${this.artLoadFailures.join("、")}\n請檢查網路後點畫面返回戰前會議。`, {
      align: "center",
      color: "#f0ebcf",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "20px",
      lineSpacing: 9,
    }).setOrigin(0.5).setScrollFactor(0);
    this.input.once("pointerup", this.leaveShowcase, this);
    this.input.keyboard?.once("keydown-ESC", this.leaveShowcase, this);
  }

  private villageDoctrineLabel(): string {
    return ({
      pinehold: "松林堡・森衛射界",
      riverstead: "河谷鎮・急行軍",
      highcrag: "高地寨・石甲前線",
    } satisfies Record<VillageId, string>)[this.villageId];
  }

  private aiPersonalityLabel(): string {
    return ({
      aggressor: "侵略者",
      guardian: "守城者",
      prosperer: "繁榮者",
      balanced: "均衡者",
      raider: "掠襲者",
    } satisfies Record<AiPersonality, string>)[this.aiPersonality];
  }

  private createInterface(): void {
    this.interfacePanel = this.add.graphics().setScrollFactor(0).setDepth(40_000);
    this.interfacePanel.fillStyle(0x111a17, 0.94).fillRect(16, 14, 1248, 76);
    this.interfacePanel.lineStyle(2, 0xd2c383, 0.75).strokeRect(16, 14, 1248, 76);
    this.instructionText = this.add.text(
      36,
      24,
      "框選／Shift 複選　右鍵移動／攻擊　Q 全隊技能　F 切換隊形　Ctrl+1–3 編隊　WASD 移鏡頭",
      { color: "#f1e6b3", fontFamily: "Segoe UI, Noto Sans TC, sans-serif", fontSize: "16px", fontStyle: "bold" },
    ).setScrollFactor(0).setDepth(40_001);
    this.scoreText = this.add.text(36, 52, "", {
      color: "#dce9c6",
      fontFamily: "Segoe UI, Noto Sans TC, sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
    }).setScrollFactor(0).setDepth(40_001);
    this.selectionText = this.add.text(24, 640, "", {
      color: "#f3edcf",
      backgroundColor: "#14211ddd",
      fontFamily: "Segoe UI, Noto Sans TC, sans-serif",
      fontSize: "15px",
      padding: { x: 14, y: 10 },
      wordWrap: { width: 920 },
    }).setScrollFactor(0).setDepth(40_001);
    this.selectionBox = this.add.graphics().setScrollFactor(0).setDepth(45_000).setVisible(false);
    this.applyResponsiveInterface();
  }

  private createTouchControls(): void {
    const controls = this.add.container(0, 0).setScrollFactor(0).setDepth(50_000).setName("combat-canvas-controls");
    this.touchControls = controls;
    this.touchReadoutPanel = this.add.graphics();
    this.touchReadout = this.add.text(0, 0, "", {
      align: "center",
      color: "#f0ebcf",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "27px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    controls.add([this.touchReadoutPanel, this.touchReadout]);

    for (const panel of ["main", "groups", "system"] as const) {
      this.createTouchPanel(panel, TOUCH_PANEL_BUTTONS[panel]);
    }
    this.touchBriefing = this.createTouchBriefing();
    controls.add(this.touchBriefing);

    const fullscreen = fullscreenButtonLabel(this);
    this.fullscreenButton = createCanvasButton(this, {
      width: 200,
      height: 88,
      glyph: fullscreen.glyph,
      label: fullscreen.label,
      name: "combat-fullscreen",
      compact: true,
      accent: true,
    }, () => {
      const result = toggleGameFullscreen(this);
      this.setTouchNotice(result === "expanded" ? "已填滿瀏覽器可用畫面" : result === "exited" ? "已離開全螢幕" : "正在進入全螢幕");
      this.syncFullscreenButton();
    });
    this.fullscreenButton.container.setScrollFactor(0).setDepth(80_000);
    this.rotatePrompt = this.createRotatePrompt();
    this.rotatePrompt.setScrollFactor(0).setDepth(70_000);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyResponsiveInterface, this);
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, this.syncFullscreenButton, this);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.syncFullscreenButton, this);
    this.events.on(GAME_FULLSCREEN_FALLBACK_EVENT, this.onFullscreenFallback, this);
    this.syncTouchControls();
  }

  private createTouchPanel(panelName: TouchControlPanel, specs: readonly TouchButtonSpec[]): void {
    if (!this.touchControls) return;
    const buttonWidth = 104;
    const buttonHeight = 108;
    const gap = 8;
    const panelWidth = specs.length * buttonWidth + Math.max(0, specs.length - 1) * gap + 24;
    const panel = this.add.container(0, 0).setName(`touch-panel-${panelName}`).setSize(panelWidth, 128);
    const frame = this.add.graphics();
    frame.fillStyle(0x101917, 0.9).fillRect(-panelWidth / 2 + 7, -64 + 9, panelWidth, 128);
    frame.fillStyle(0x25483c, 0.98).fillRect(-panelWidth / 2, -64, panelWidth - 7, 119);
    frame.lineStyle(4, 0xe0b866, 0.96).strokeRect(-panelWidth / 2, -64, panelWidth - 7, 119);
    frame.lineStyle(2, 0x101917, 0.9).strokeRect(-panelWidth / 2 + 7, -57, panelWidth - 21, 105);
    panel.add(frame);
    specs.forEach((spec, index) => {
      const key = spec.mode ? `mode:${spec.mode}` : `action:${spec.action ?? "unknown"}`;
      const controlKey = `${panelName}:${key}`;
      const button = createCanvasButton(this, {
        width: buttonWidth,
        height: buttonHeight,
        glyph: spec.glyph,
        label: spec.label,
        ...(spec.accessibleLabel ? { accessibleLabel: spec.accessibleLabel } : {}),
        name: `combat-${panelName}-${key}`,
      }, () => {
        if (spec.mode) this.setTouchMode(this.touchMode === spec.mode ? "smart" : spec.mode);
        else this.handleTouchAction(spec.action ?? "");
      });
      button.container.setPosition(-panelWidth / 2 + 12 + buttonWidth / 2 + index * (buttonWidth + gap), -1);
      panel.add(button.container);
      this.touchButtons.set(controlKey, button);
    });
    this.touchPanels.set(panelName, panel);
    this.touchControls.add(panel);
  }

  private createTouchBriefing(): Phaser.GameObjects.Container {
    const briefing = this.add.container(0, 0).setName("touch-briefing").setVisible(false);
    const blocker = this.add.graphics().setName("touch-briefing-blocker");
    const dialog = this.add.container(0, 0).setName("touch-briefing-dialog");
    const paper = this.add.graphics();
    paper.fillStyle(0x050807, 0.78).fillRect(-524, -174, 1060, 360);
    paper.fillStyle(0xd9cca0, 1).fillRect(-536, -186, 1060, 360);
    paper.lineStyle(5, 0x101917, 1).strokeRect(-536, -186, 1060, 360);
    paper.lineStyle(3, 0x356b78, 0.72).strokeRect(-526, -176, 1040, 340);
    const kicker = this.add.text(-500, -154, "MOBILE COMMAND BRIEFING", {
      color: "#356b78",
      fontFamily: "Consolas, monospace",
      fontSize: "17px",
      fontStyle: "bold",
      letterSpacing: 2,
    });
    const title = this.add.text(-500, -122, "三步開始指揮", {
      color: "#101917",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "43px",
      fontStyle: "bold",
    });
    const steps = [
      ["1　選部隊", "點我軍，或按「全軍」。"],
      ["2　下命令", "點地移動；點敵軍攻擊。"],
      ["3　看戰場", "拖空地移鏡；精準操作切換模式。"],
    ] as const;
    const stepObjects: Phaser.GameObjects.GameObject[] = [];
    steps.forEach(([heading, copy], index) => {
      const x = -500 + index * 334;
      const panel = this.add.graphics();
      panel.fillStyle(0xf0ebcf, 0.82).fillRect(x, -48, 310, 94);
      panel.fillStyle(0x25483c, 1).fillRect(x, -48, 9, 94);
      const headingText = this.add.text(x + 22, -38, heading, {
        color: "#101917",
        fontFamily: 'Georgia, "Noto Serif TC", serif',
        fontSize: "21px",
        fontStyle: "bold",
      });
      const copyText = this.add.text(x + 22, -6, copy, {
        color: "#101917",
        fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
        fontSize: "17px",
        fontStyle: "bold",
        wordWrap: { width: 276 },
      });
      stepObjects.push(panel, headingText, copyText);
    });
    const startButton = createCanvasButton(this, {
      width: 330,
      height: 82,
      glyph: "⚔",
      label: "開始指揮",
      name: "combat-action:close-briefing",
      compact: true,
      accent: true,
    }, () => this.closeTouchBriefing());
    startButton.container.setPosition(346, 112);
    this.touchButtons.set("action:close-briefing", startButton);
    dialog.add([paper, kicker, title, ...stepObjects, startButton.container]);
    briefing.add([blocker, dialog]);
    return briefing;
  }

  private createRotatePrompt(): Phaser.GameObjects.Container {
    const prompt = this.add.container(0, 0).setName("rotate-device-prompt").setVisible(false);
    const blocker = this.add.graphics().setName("rotate-device-blocker").setScrollFactor(0);
    blocker.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1280, 720), Phaser.Geom.Rectangle.Contains);
    blocker.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    blocker.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    const phone = this.add.graphics().setName("rotate-phone-art");
    phone.lineStyle(9, 0xe0b866, 1).strokeRoundedRect(-76, -116, 152, 232, 24);
    phone.fillStyle(0xe0b866, 1).fillCircle(0, 90, 8);
    const title = this.add.text(0, 154, "請將手機橫放", {
      align: "center",
      color: "#f0ebcf",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "48px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    const copy = this.add.text(0, 212, "畫面會自動放大並重新排列\n右上角可切換全螢幕", {
      align: "center",
      color: "#d9cca0",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "40px",
      fontStyle: "bold",
      lineSpacing: 8,
    }).setOrigin(0.5, 0);
    prompt.add([blocker, phone, title, copy]);
    return prompt;
  }

  private applyVillageDoctrine(definition: CombatDefinitionView): CombatDefinitionView {
    if (this.villageId === "pinehold" && ["archer", "musketeer", "heavyCrossbowman"].includes(definition.id)) {
      return { ...definition, attackRange: definition.attackRange + 0.75 };
    }
    if (this.villageId === "riverstead") {
      return { ...definition, moveSpeed: definition.moveSpeed * 1.1 };
    }
    if (this.villageId === "highcrag" && ["warrior", "shieldBearer"].includes(definition.id)) {
      return { ...definition, maxHitPoints: Math.round(definition.maxHitPoints * 1.12), armor: definition.armor + 4 };
    }
    return definition;
  }

  private playerPalette() {
    return this.villageId === "riverstead"
      ? DEFAULT_TEAM_PALETTES.river
      : this.villageId === "highcrag"
        ? DEFAULT_TEAM_PALETTES.crag
        : DEFAULT_TEAM_PALETTES.pine;
  }

  private initialEnemyDeploymentCount(): number {
    return ({ aggressor: 4, guardian: 2, prosperer: 1, balanced: 2, raider: 3 } satisfies Record<AiPersonality, number>)[this.aiPersonality];
  }

  private enemyOpeningSkillCooldownRatio(): number {
    return ({ aggressor: 0.38, guardian: 0.62, prosperer: 0.72, balanced: 0.55, raider: 0.45 } satisfies Record<AiPersonality, number>)[this.aiPersonality];
  }

  private spawnCombatants(): void {
    const unitDefinitions = COMBAT_UNIT_IDS.map((id) => COMBAT_UNITS[id]);
    const suggested = getSuggestedSpawns();
    const playerSpawns: readonly GridPoint[] = [
      { x: 0, y: 7 }, { x: 2, y: 7 }, { x: 1, y: 9 }, { x: 3, y: 9 },
      { x: 0, y: 11 }, { x: 2, y: 11 }, { x: 3, y: 13 },
    ].map(clampToWalkable);
    const enemySpawns: readonly GridPoint[] = [
      { x: 17, y: 5 }, { x: 15, y: 5 }, { x: 16, y: 7 }, { x: 14, y: 7 },
      { x: 17, y: 9 }, { x: 15, y: 9 }, { x: 14, y: 11 },
    ].map(clampToWalkable);
    unitDefinitions.forEach((definition, index) => {
      this.spawnActor("player", this.applyVillageDoctrine(definition), playerSpawns[index]!, `p-${definition.id}`);
      const enemy = this.spawnActor("enemy", definition, enemySpawns[index]!, `e-${definition.id}`);
      enemy.deployed = index < this.initialEnemyDeploymentCount();
    });

    MONSTER_IDS.forEach((id, index) => {
      const definition = MONSTERS[id];
      const camp = suggested.monsterCamps[id];
      this.spawnActor("monster", definition, camp[index % camp.length]!, `m-${definition.id}`);
    });
    const initial = this.actors.find((actor) => actor.team === "player");
    if (initial) this.squadSelection.selectMember(this.toSquadMember(initial));
    this.syncSelectionVisuals();
  }

  private spawnActor(team: Team, definition: CombatDefinitionView, position: GridPoint, instanceId: string): ShowcaseActor {
    const unitArtId = team === "monster" ? undefined : UNIT_ART_IDS[definition.id];
    if (team !== "monster" && !unitArtId) {
      throw new Error(`No illustrated art mapping for combat unit: ${definition.id}`);
    }
    const artId = team === "monster" ? definition.id as CombatArtId : unitArtId!;
    const initialPoint = gridToWorld(position, ORIGIN);
    const visualOptions = {
      id: artId,
      x: initialPoint.x,
      y: initialPoint.y,
      teamPalette: team === "player" ? this.playerPalette() : team === "enemy" ? DEFAULT_TEAM_PALETTES.enemy : DEFAULT_TEAM_PALETTES.neutral,
      facing: team === "player" ? "ne" : "sw",
      action: "idle",
    } as const;
    const visual: CombatVisual = createFrameAnimatedCombatActor(
      this,
      visualOptions,
      requireFrameAnimatedManifest(COMBAT_ANIMATION_MANIFEST, artId),
    );
    const color = this.teamColor(team);
    const selectionRing = this.add.graphics()
      .lineStyle(3, 0xffe69a, 1)
      .strokeEllipse(0, 2, artId === "boar_rider" || team === "monster" ? 58 : 43, artId === "boar_rider" ? 24 : 18)
      .setVisible(false);
    const healthBar = this.add.graphics();
    const teamMark = this.add.text(0, 8, team === "player" ? "Ⅰ" : team === "enemy" ? "Ⅱ" : "◆", {
      color: `#${color.toString(16).padStart(6, "0")}`,
      fontFamily: "Consolas, monospace",
      fontSize: "12px",
      fontStyle: "bold",
      stroke: "#12201b",
      strokeThickness: 3,
    }).setOrigin(0.5, 0);
    visual.container.addAt(selectionRing, 0);
    visual.container.add([healthBar, teamMark]);
    const touchHitWidth = artId === "boar_rider" || team === "monster" ? 132 : 112;
    const touchHitHeight = artId === "boar_rider" || team === "monster" ? 148 : 132;
    visual.container
      .setSize(touchHitWidth, touchHitHeight)
      .setInteractive({ useHandCursor: true })
      .setData("showcaseActorId", instanceId);
    const actor: ShowcaseActor = {
      instanceId,
      contentId: definition.id,
      artId,
      team,
      definition,
      visual,
      selectionRing,
      healthBar,
      teamMark,
      statuses: new Map(),
      statusTicks: new Map(),
      position: { ...position },
      hitPoints: definition.maxHitPoints,
      attackCooldownMs: team === "player" ? 0 : 700 + this.actors.length * 35,
      skillCooldownMs: team === "player" ? 0 : definition.activeAbility.cooldownMs * this.enemyOpeningSkillCooldownRatio(),
      actionLockMs: 0,
      repathCooldownMs: 0,
      aiDecisionCooldownMs: team === "enemy" ? 250 + this.actors.length * 80 : 0,
      route: [],
      deployed: team !== "enemy",
      provokedBy: null,
      dead: false,
    };
    this.actors.push(actor);
    this.positionActor(actor);
    visual.play("idle");
    return actor;
  }

  private updateActor(actor: ShowcaseActor, seconds: number, preparation: boolean): void {
    if (this.ended) return;
    if (actor.team === "enemy" && (!actor.deployed || preparation)) {
      actor.destination = undefined;
      actor.route = [];
      if (actor.actionLockMs <= 0) actor.visual.play("idle", false);
      return;
    }
    const target = actor.targetId ? this.findLivingActor(actor.targetId) : undefined;
    if (actor.team === "monster" && !target) {
      actor.destination = undefined;
      actor.route = [];
      if (actor.actionLockMs <= 0) actor.visual.play("idle", false);
      return;
    }
    if (actor.team === "enemy" && !target && actor.aiDecisionCooldownMs <= 0) {
      this.chooseEnemyIntent(actor);
      actor.aiDecisionCooldownMs = this.enemyDecisionIntervalMs();
    }
    const currentTarget = actor.targetId ? this.findLivingActor(actor.targetId) : undefined;
    if (currentTarget) {
      const distance = gridDistance(actor.position, currentTarget.position);
      if (distance <= actor.definition.attackRange) {
        actor.destination = undefined;
        if (actor.skillCooldownMs <= 0 && actor.team !== "player" && actor.hitPoints / actor.definition.maxHitPoints < 0.72) {
          this.castSkill(actor, currentTarget);
        } else {
          this.tryAttack(actor, currentTarget);
        }
        return;
      }
      if (actor.repathCooldownMs <= 0 || !actor.destination) {
        this.setActorDestination(actor, currentTarget.position);
        actor.repathCooldownMs = 650;
      }
    } else if (actor.objectiveId) {
      const zone = this.getBeaconZone(actor.objectiveId);
      if (zone && gridDistance(actor.position, zone.center) <= zone.radiusTiles * 0.65) {
        const nearbyPlayer = this.actors
          .filter((candidate) => candidate.team === "player" && !candidate.dead && gridDistance(candidate.position, actor.position) <= 3.2)
          .sort((left, right) => gridDistance(left.position, actor.position) - gridDistance(right.position, actor.position))[0];
        if (nearbyPlayer) {
          actor.targetId = nearbyPlayer.instanceId;
          actor.objectiveId = undefined;
          return;
        }
        actor.destination = undefined;
        actor.route = [];
        if (actor.actionLockMs <= 0) actor.visual.play("idle", false);
        return;
      }
    }
    if (actor.destination) this.moveActor(actor, actor.destination, seconds);
    else if (actor.actionLockMs <= 0) actor.visual.play("idle", false);
  }

  private moveActor(actor: ShowcaseActor, destination: GridPoint, seconds: number): void {
    if (actor.actionLockMs > 0 || this.isRooted(actor)) return;
    const dx = destination.x - actor.position.x;
    const dy = destination.y - actor.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.08) {
      actor.destination = actor.route.shift();
      if (!actor.destination) actor.visual.play("idle", false);
      return;
    }
    actor.visual.faceVector(dx, dy);
    actor.visual.play("walk", false);
    const slow = this.hasStatus(actor, "slow") ? 1 - STATUS_EFFECTS.slow.magnitude : 1;
    const terrainCost = getBattleTile(actor.position)?.moveCost ?? 1;
    const momentum = this.hasStatus(actor, "slayerMomentum") ? 1.08 : 1;
    const step = Math.min(distance, actor.definition.moveSpeed * slow * momentum / Math.max(0.82, terrainCost) * seconds);
    actor.position.x += dx / distance * step;
    actor.position.y += dy / distance * step;
  }

  private tryAttack(attacker: ShowcaseActor, target: ShowcaseActor): void {
    if (attacker.attackCooldownMs > 0 || attacker.actionLockMs > 0 || target.dead) return;
    attacker.attackCooldownMs = attacker.definition.attackIntervalMs;
    attacker.actionLockMs = Math.min(620, attacker.definition.attackIntervalMs * 0.65);
    attacker.visual.faceVector(target.position.x - attacker.position.x, target.position.y - attacker.position.y);
    attacker.visual.play("attack");
    this.commitHit(attacker, target, 1, false);
  }

  private commitHit(attacker: ShowcaseActor, target: ShowcaseActor, skillMultiplier: number, isSkill: boolean): void {
    const ranged = Boolean(attacker.definition.projectileProfileId) || attacker.definition.attackRange >= 3;
    const apply = () => {
      if (target.dead) return;
      if (!target.targetId) target.targetId = attacker.instanceId;
      if (target.team === "monster" && attacker.team !== "monster") target.provokedBy = attacker.team;
      const counterMultiplier = attacker.definition.counterModifiers?.[target.contentId] ?? 1;
      const coverMultiplier = 1 - (getBattleTile(target.position)?.cover ?? 0) * 0.28;
      target.lastDamagedBy = attacker.instanceId;
      const damage = calculateDamage({
        baseDamage: attacker.definition.baseDamage,
        armor: target.definition.armor,
        counterMultiplier,
        skillMultiplier,
        statusMultiplier: (ranged && attacker.contentId !== "mage" && this.hasStatus(target, "shieldWall") ? STATUS_EFFECTS.shieldWall.magnitude : 1)
          * coverMultiplier
          * (this.hasStatus(attacker, "slayerMomentum") ? 1.12 : 1),
        armorBreak: this.hasStatus(target, "armorBreak") ? STATUS_EFFECTS.armorBreak.magnitude : 0,
        armorIgnore: attacker.contentId === "mage"
          ? 0.35
          : isSkill && attacker.contentId === "musketeer"
            ? 0.6
            : 0,
      });
      this.applyDamage(target, damage);
      if (isSkill) this.applyAbilityStatuses(attacker, target);
    };

    const from = { x: attacker.visual.container.x, y: attacker.visual.container.y - 38 };
    const to = { x: target.visual.container.x, y: target.visual.container.y - 34 };
    if (ranged) {
      launchProjectile(this, {
        from,
        to,
        kind: PROJECTILE_KIND[attacker.contentId] ?? (isSkill ? "arcane" : "arrow"),
        tint: this.teamColor(attacker.team),
        onImpact: apply,
      });
    } else {
      this.time.delayedCall(isSkill ? 260 : 150, () => {
        spawnImpactBurst(this, to, this.teamColor(attacker.team), isSkill ? 17 : 9);
        apply();
      });
    }
  }

  private castSkill(actor: ShowcaseActor, preferredTarget?: ShowcaseActor): void {
    if (actor.dead || actor.skillCooldownMs > 0 || actor.actionLockMs > 0 || this.ended) return;
    const ability = actor.definition.activeAbility;
    let target = preferredTarget ?? (actor.targetId ? this.findLivingActor(actor.targetId) : undefined) ?? this.nearestOpponent(actor);
    if (ability.targeting !== "self" && !target) return;
    if (target && ability.targeting !== "self") {
      const skillRange = actor.contentId === "boarRider"
        ? 6
        : actor.definition.attackRange + (ability.targeting === "ground" ? 1.5 : 0.5);
      if (gridDistance(actor.position, target.position) > skillRange) {
        actor.targetId = target.instanceId;
        this.setActorDestination(actor, this.pointBeforeTarget(actor.position, target.position, Math.max(0.8, actor.definition.attackRange * 0.82)));
        if (actor.team === "player") this.setTouchNotice(`${actor.definition.displayName}正在接近技能射程`);
        return;
      }
    }
    if (target && ability.targeting !== "self") {
      actor.targetId = target.instanceId;
      actor.visual.faceVector(target.position.x - actor.position.x, target.position.y - actor.position.y);
    }
    actor.skillCooldownMs = ability.cooldownMs;
    actor.actionLockMs = ability.windupMs + ability.recoveryMs;
    actor.visual.play("cast");
    const focus = ability.targeting === "self" || !target ? actor : target;
    spawnSkillTelegraph(this, { x: focus.visual.container.x, y: focus.visual.container.y }, this.teamColor(actor.team), actor.contentId === "mage" ? 58 : 38, ability.windupMs);
    spawnFloatingText(this, { x: actor.visual.container.x, y: actor.visual.container.y - 78 }, ability.displayName, "#ffe7a2");

    this.time.delayedCall(Math.max(80, ability.windupMs), () => {
      if (actor.dead) return;
      if (ability.targeting === "self" || actor.contentId === "shieldBearer") {
        for (const status of ability.statusEffects) this.applyStatus(actor, String(status));
        this.applyStatus(actor, "guard", 3_200);
        spawnImpactBurst(this, { x: actor.visual.container.x, y: actor.visual.container.y - 20 }, PLAYER_COLOR, 22);
        return;
      }
      target = target && !target.dead ? target : this.nearestOpponent(actor);
      if (!target) return;
      if (actor.contentId === "mage" || actor.contentId === "rootback") {
        const victims = this.opponentsOf(actor).filter((candidate) => gridDistance(candidate.position, target!.position) <= 1.8);
        victims.forEach((victim) => this.commitHit(actor, victim, ability.damageMultiplier ?? 1.45, true));
      } else if (actor.contentId === "musketeer") {
        const victims = this.opponentsOf(actor)
          .filter((candidate) => gridDistance(candidate.position, target!.position) <= 1.25)
          .slice(0, 3);
        victims.forEach((victim) => this.commitHit(actor, victim, ability.damageMultiplier ?? 1.55, true));
      } else if (actor.contentId === "boarRider") {
        actor.position = this.pointBeforeTarget(actor.position, target.position, 0.75);
        actor.visual.play("walk");
        this.commitHit(actor, target, ability.damageMultiplier ?? 1.65, true);
      } else {
        this.commitHit(actor, target, ability.damageMultiplier ?? 1.4, true);
      }
    });
  }

  private applyAbilityStatuses(source: ShowcaseActor, target: ShowcaseActor): void {
    for (const status of source.definition.activeAbility.statusEffects) {
      this.applyStatus(target, String(status));
    }
  }

  private applyStatus(target: ShowcaseActor, status: string, fallbackDurationMs?: number): void {
    if (status === "stagger" && this.hasStatus(target, "tenacity")) return;
    const definition = STATUS_EFFECTS[status as keyof typeof STATUS_EFFECTS];
    const duration = definition?.durationMs && definition.durationMs > 0 ? definition.durationMs : fallbackDurationMs ?? 2_800;
    target.statuses.set(status, duration);
    if (definition && "tickIntervalMs" in definition && definition.tickIntervalMs) {
      target.statusTicks.set(status, definition.tickIntervalMs);
    }
    if (status === "stagger") target.statuses.set("tenacity", STATUS_EFFECTS.tenacity.durationMs);
  }

  private applyDamage(target: ShowcaseActor, amount: number): void {
    if (target.dead || amount <= 0) return;
    target.hitPoints = Math.max(0, target.hitPoints - amount);
    target.actionLockMs = Math.max(target.actionLockMs, 230);
    target.visual.play(target.hitPoints > 0 ? "hurt" : "death");
    spawnFloatingText(
      this,
      { x: target.visual.container.x, y: target.visual.container.y - 60 },
      `-${amount}`,
      target.team === "player" ? "#ff9d8c" : "#fff0ac",
    );
    if (target.hitPoints === 0) {
      target.dead = true;
      target.destination = undefined;
      target.route = [];
      target.targetId = undefined;
      target.visual.container.disableInteractive();
      target.teamMark.setVisible(false);
      target.selectionRing.setVisible(false);
      spawnDeathDust(this, { x: target.visual.container.x, y: target.visual.container.y });
      this.squadSelection.reconcile(this.squadMembers());
      this.syncSelectionVisuals();
      for (const actor of this.actors) if (actor.targetId === target.instanceId) actor.targetId = undefined;
      if (target.team === "monster") this.awardMonsterReward(target);
    }
  }

  private awardMonsterReward(monster: ShowcaseActor): void {
    const killer = monster.lastDamagedBy ? this.findLivingActor(monster.lastDamagedBy) : undefined;
    if (!killer || killer.team === "monster" || !(monster.contentId in MONSTERS)) return;
    const reward = MONSTERS[monster.contentId as keyof typeof MONSTERS].reward;
    const durationMs = reward.buffDurationMs ?? 30_000;
    const ledger = this.battleRewards[killer.team];
    ledger.food += reward.food;
    ledger.wood += reward.wood;
    ledger.stone += reward.stone;
    for (const ally of this.actors.filter((actor) => actor.team === killer.team && !actor.dead)) {
      this.applyStatus(ally, "slayerMomentum", durationMs);
    }
    spawnFloatingText(
      this,
      { x: monster.visual.container.x, y: monster.visual.container.y - 94 },
      `戰利 ${reward.food}糧・${reward.wood}木・${reward.stone}石｜全軍士氣提升`,
      killer.team === "player" ? "#dff0b4" : "#ffbd82",
    );
  }

  private tickStatuses(actor: ShowcaseActor, deltaMs: number): void {
    for (const [status, remaining] of actor.statuses) {
      const next = remaining - deltaMs;
      if (status === "burn" && !actor.dead) {
        let untilTick = (actor.statusTicks.get(status) ?? STATUS_EFFECTS.burn.tickIntervalMs ?? 1_000) - deltaMs;
        if (untilTick <= 0) {
          this.applyDamage(actor, STATUS_EFFECTS.burn.magnitude);
          untilTick += STATUS_EFFECTS.burn.tickIntervalMs ?? 1_000;
        }
        actor.statusTicks.set(status, untilTick);
      }
      if (next <= 0) {
        actor.statuses.delete(status);
        actor.statusTicks.delete(status);
      } else {
        actor.statuses.set(status, next);
      }
    }
  }

  private actorAtPointer(
    over: readonly Phaser.GameObjects.GameObject[],
    screenPoint: ScreenPoint,
    teamFilter?: (team: Team) => boolean,
  ): ShowcaseActor | undefined {
    const direct = over
      .map((object) => this.findLivingActor(String(object.getData("showcaseActorId") ?? "")))
      .filter((actor): actor is ShowcaseActor => Boolean(actor && (!teamFilter || teamFilter(actor.team))));
    const candidates = direct.length > 0
      ? direct
      : this.actors.filter((actor) => !actor.dead && (!teamFilter || teamFilter(actor.team)));
    const camera = this.cameras.main;
    return candidates
      .map((actor) => {
        const x = actor.visual.container.x - camera.scrollX;
        const y = actor.visual.container.y - camera.scrollY - 34;
        return { actor, distance: Math.hypot(x - screenPoint.x, y - screenPoint.y) };
      })
      .filter(({ distance }) => direct.length > 0 || distance <= 104)
      .sort((left, right) => left.distance - right.distance || right.actor.visual.container.depth - left.actor.visual.container.depth)[0]
      ?.actor;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.ended || this.touchBriefingOpen) return;
    if (this.isTouchPointer(pointer)) {
      const activeTouches = this.activeTouchPointers();
      if (activeTouches.length >= 2) {
        this.beginPinch(activeTouches[0]!, activeTouches[1]!);
        return;
      }
    }
    const screenPoint = { x: pointer.x, y: pointer.y };
    const clicked = this.actorAtPointer(over, screenPoint);
    if (pointer.button === 0) {
      this.dragStart = screenPoint;
      this.dragClickedId = clicked?.instanceId;
      this.dragAdditive = pointer.event.shiftKey;
      this.touchDidPan = false;
      if (this.isTouchCommandPointer(pointer)) {
        this.selectionBox?.clear().setVisible(this.touchMode === "box");
        this.touchCameraDrag = this.touchMode === "pan" || (this.touchMode === "smart" && !clicked)
          ? { pointerX: pointer.x, pointerY: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY }
          : undefined;
      } else {
        this.selectionBox?.clear().setVisible(true);
      }
      return;
    }
    const selectedActors = this.getSelectedActors();
    if (pointer.button !== 2 || selectedActors.length === 0) return;
    this.issueSelectedCommand(clicked, { x: pointer.x, y: pointer.y });
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.pinchStartDistance > 0 && this.isTouchPointer(pointer)) {
      this.updatePinch();
      return;
    }
    if (this.touchBriefingOpen || !this.dragStart || !this.selectionBox) return;
    const rectangle = createPointerRectangle(this.dragStart, { x: pointer.x, y: pointer.y });
    if (this.isTouchCommandPointer(pointer) && this.touchCameraDrag) {
      if (rectangle.width <= 11 && rectangle.height <= 11) return;
      this.touchDidPan = true;
      this.selectionBox.clear().setVisible(false);
      this.cameras.main.scrollX = this.touchCameraDrag.scrollX - (pointer.x - this.touchCameraDrag.pointerX);
      this.cameras.main.scrollY = this.touchCameraDrag.scrollY - (pointer.y - this.touchCameraDrag.pointerY);
      return;
    }
    if (this.isTouchCommandPointer(pointer) && this.touchMode !== "box") return;
    this.selectionBox.clear();
    if (rectangle.width < 3 && rectangle.height < 3) return;
    this.selectionBox.fillStyle(0x65c9a4, 0.12).fillRect(rectangle.left, rectangle.top, rectangle.width, rectangle.height);
    this.selectionBox.lineStyle(2, 0xa8efd2, 0.9).strokeRect(rectangle.left, rectangle.top, rectangle.width, rectangle.height);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[] = []): void {
    if (this.pinchStartDistance > 0) {
      this.endPinch();
      return;
    }
    if (this.touchBriefingOpen || !this.dragStart || pointer.button !== 0) return;
    const start = this.dragStart;
    const end = { x: pointer.x, y: pointer.y };
    const rectangle = createPointerRectangle(start, end);
    const members = this.squadMembers();
    if (this.isTouchCommandPointer(pointer)) {
      if (this.touchDidPan) {
        this.resetPointerGesture();
        return;
      }
      const actor = this.actorAtPointer(over, end)
        ?? (this.dragClickedId ? this.findLivingActor(this.dragClickedId) : undefined);
      if (this.touchMode === "box") {
        if (rectangle.width > 12 || rectangle.height > 12) {
          this.squadSelection.selectByPointerRectangle(start, end, members, this.squadAdapter(), false, 28);
        } else {
          const friendly = this.actorAtPointer(over, end, (team) => team === "player");
          this.squadSelection.selectMember(friendly ? this.toSquadMember(friendly) : undefined);
        }
        this.setTouchMode("smart");
      } else if (this.touchMode === "move") {
        if (this.getSelectedActors().length > 0) {
          this.issueSelectedCommand(undefined, end);
          this.setTouchMode("smart");
        } else {
          this.setTouchNotice("先選取部隊");
        }
      } else if (this.touchMode === "attack") {
        const target = this.actorAtPointer(over, end, (team) => team !== "player");
        if (target && this.getSelectedActors().length > 0) {
          this.issueSelectedCommand(target, end);
          this.setTouchMode("smart");
        } else {
          this.setTouchNotice(target ? "先選取部隊" : "請點敵軍或野怪");
        }
      } else if (this.touchMode === "smart") {
        if (actor?.team === "player") {
          this.squadSelection.selectMember(this.toSquadMember(actor), false);
        } else if (actor && this.getSelectedActors().length > 0) {
          this.issueSelectedCommand(actor, end);
        } else if (!actor && this.getSelectedActors().length > 0) {
          this.issueSelectedCommand(undefined, end);
        }
      }
    } else if (rectangle.width <= 7 && rectangle.height <= 7) {
      const actor = this.dragClickedId ? this.findLivingActor(this.dragClickedId) : undefined;
      this.squadSelection.selectMember(actor?.team === "player" ? this.toSquadMember(actor) : undefined, this.dragAdditive);
    } else {
      this.squadSelection.selectByPointerRectangle(start, end, members, this.squadAdapter(), this.dragAdditive, 16);
    }
    this.resetPointerGesture();
    this.syncSelectionVisuals();
  }

  private resetPointerGesture(): void {
    this.dragStart = undefined;
    this.dragClickedId = undefined;
    this.touchCameraDrag = undefined;
    this.touchDidPan = false;
    this.selectionBox?.clear().setVisible(false);
  }

  private onSkillKey(): void {
    for (const actor of this.getSelectedActors()) this.castSkill(actor);
  }

  private issueSelectedCommand(clicked: ShowcaseActor | undefined, screenPoint: ScreenPoint): void {
    const selectedActors = this.getSelectedActors();
    if (selectedActors.length === 0) return;
    if (clicked && clicked.team !== "player") {
      for (const actor of selectedActors) {
        actor.targetId = clicked.instanceId;
        actor.objectiveId = undefined;
        this.setActorDestination(actor, clicked.position);
      }
      spawnFloatingText(this, { x: clicked.visual.container.x, y: clicked.visual.container.y - 72 }, "攻擊目標", "#ffbd82");
      return;
    }
    const world = this.cameras.main.getWorldPoint(screenPoint.x, screenPoint.y);
    const target = clampToWalkable(worldToGrid(world, ORIGIN));
    const assignments = assignFormationDestinations(
      selectedActors.map((actor) => ({ id: actor.instanceId, position: actor.position })),
      target,
      { kind: this.formationKind, spacing: 0.82 },
    );
    for (const assignment of assignments) {
      const actor = this.findLivingActor(assignment.memberId);
      if (!actor) continue;
      actor.targetId = undefined;
      actor.objectiveId = this.beaconAt(assignment.destination)?.id;
      this.setActorDestination(actor, assignment.destination);
    }
    spawnSkillTelegraph(this, gridToWorld(target, ORIGIN), PLAYER_COLOR, 18, 280);
  }

  private isTouchCommandPointer(pointer: Phaser.Input.Pointer): boolean {
    return this.isTouchPointer(pointer) || this.isCompactLandscape();
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    return (pointer.event as PointerEvent | undefined)?.pointerType === "touch";
  }

  private activeTouchPointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((pointer) => pointer.isDown && this.isTouchPointer(pointer));
  }

  private beginPinch(first: Phaser.Input.Pointer, second: Phaser.Input.Pointer): void {
    this.resetPointerGesture();
    this.pinchStartDistance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
    this.pinchStartZoom = this.cameras.main.zoom;
  }

  private updatePinch(): void {
    const touches = this.activeTouchPointers();
    if (touches.length < 2 || this.pinchStartDistance <= 0) return;
    const [first, second] = touches;
    const distance = Phaser.Math.Distance.Between(first!.x, first!.y, second!.x, second!.y);
    const anchor = { x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 };
    this.setCameraZoom(this.pinchStartZoom * distance / this.pinchStartDistance, anchor);
  }

  private endPinch(): void {
    this.pinchStartDistance = 0;
    this.pinchStartZoom = this.cameras.main.zoom;
    this.resetPointerGesture();
    this.setTouchNotice(`鏡頭 ${Math.round(this.cameras.main.zoom * 100)}%`);
  }

  private onKeyboardShortcut(event: KeyboardEvent): void {
    if (this.touchBriefingOpen) return;
    const key = event.key.toLowerCase();
    if (key === "f" && !event.ctrlKey) {
      this.toggleFormation();
      event.preventDefault();
      return;
    }
    if (this.squadSelection.handleShortcut({ key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey }, this.squadMembers())) {
      this.syncSelectionVisuals();
      event.preventDefault();
    }
  }

  private toggleFormation(): void {
    this.formationKind = this.formationKind === "wedge" ? "line" : "wedge";
    this.announceTouchCommand(this.formationKind === "wedge" ? "楔形隊形" : "橫列隊形");
    this.updateSelectionPanel();
  }

  private maybeShowTouchBriefing(): void {
    if (!this.isCompactLandscape()) return;
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem("village-siege-touch-briefing-v2") === "seen";
    } catch {
      // Storage may be disabled; showing the briefing is the safer fallback.
    }
    if (!alreadySeen) this.showTouchBriefing();
  }

  private showTouchBriefing(): void {
    if (!this.isCompactLandscape() || !this.touchBriefing || !this.touchControls) return;
    this.touchBriefingOpen = true;
    this.touchBriefing.setVisible(true).setActive(true);
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.syncTouchControls();
  }

  private closeTouchBriefing(): void {
    if (!this.touchBriefing || !this.touchControls) return;
    this.touchBriefingOpen = false;
    this.touchBriefing.setVisible(false).setActive(false);
    try {
      sessionStorage.setItem("village-siege-touch-briefing-v2", "seen");
    } catch {
      // The game remains playable when session storage is unavailable.
    }
    if (this.input.keyboard) this.input.keyboard.enabled = true;
    this.setTouchNotice("點我軍選取，拖空地移鏡");
    this.syncTouchControls();
  }

  private setTouchMode(mode: TouchInteractionMode): void {
    this.touchMode = mode;
    this.touchPanel = "main";
    this.resetPointerGesture();
    this.syncTouchControls();
  }

  private setTouchPanel(panel: TouchControlPanel): void {
    this.touchPanel = panel;
    this.touchMode = "smart";
    this.resetPointerGesture();
    this.syncTouchControls();
  }

  private syncTouchControls(): void {
    if (!this.touchControls) return;
    const compact = this.isCompactLandscape();
    this.touchControls.setVisible(compact).setActive(compact);
    for (const [panelName, panel] of this.touchPanels) {
      const visible = compact && !this.touchBriefingOpen && panelName === this.touchPanel;
      panel.setVisible(visible).setActive(visible);
      for (const spec of TOUCH_PANEL_BUTTONS[panelName]) {
        const key = spec.mode ? `mode:${spec.mode}` : `action:${spec.action ?? "unknown"}`;
        this.touchButtons.get(`${panelName}:${key}`)?.setVisible(visible);
      }
    }
    this.touchReadout?.setVisible(compact && !this.touchBriefingOpen);
    this.touchReadoutPanel?.setVisible(compact && !this.touchBriefingOpen);
    for (const mode of ["move", "attack", "box", "pan"] as const) {
      this.touchButtons.get(`main:mode:${mode}`)?.setActive(mode === this.touchMode);
    }
    this.touchButtons.get("system:action:pause")?.setLabel(this.battlePaused ? "▶" : "Ⅱ", this.battlePaused ? "繼續" : "暫停");
    this.touchBriefing?.setVisible(compact && this.touchBriefingOpen).setActive(compact && this.touchBriefingOpen);
    this.touchButtons.get("action:close-briefing")?.setVisible(compact && this.touchBriefingOpen);
    this.layoutCanvasControls();
    this.updateTouchReadout();
  }

  private setTouchNotice(label: string): void {
    this.touchNotice = label;
    this.touchNoticeUntil = performance.now() + 1_600;
    this.updateTouchReadout();
  }

  private updateTouchReadout(): void {
    if (!this.touchReadout) return;
    if (this.touchNotice && performance.now() < this.touchNoticeUntil) {
      if (this.touchReadout.text !== this.touchNotice) this.touchReadout.setText(this.touchNotice);
      return;
    }
    this.touchNotice = "";
    const count = this.getSelectedActors().length;
    const label = ({
      smart: count > 0
        ? `智慧指令｜${count} 人｜點地移動・點敵攻擊・雙指縮放`
        : "智慧指令｜點我軍選取・拖空地移鏡・雙指縮放",
      move: count > 0 ? `移動模式｜點目的地（${count} 人）` : "移動模式｜請先選取部隊",
      attack: count > 0 ? `攻擊模式｜點敵軍或野怪（${count} 人）` : "攻擊模式｜請先選取部隊",
      box: "框選模式｜拖過我軍，放開即完成",
      pan: "移鏡模式｜拖曳戰場；再點一次移鏡可結束",
    } as const)[this.touchMode];
    if (this.touchReadout.text !== label) this.touchReadout.setText(label);
  }

  private handleTouchAction(action: string): void {
    if (action === "open-briefing") {
      this.showTouchBriefing();
      return;
    }
    if (action === "close-briefing") {
      this.closeTouchBriefing();
      return;
    }
    if (action === "open-main") {
      this.setTouchPanel("main");
      return;
    }
    if (action === "open-groups") {
      this.setTouchPanel("groups");
      return;
    }
    if (action === "open-system") {
      this.setTouchPanel("system");
      return;
    }
    if (action === "zoom-in") {
      this.zoomCameraBy(0.16);
      this.setTouchNotice(`鏡頭 ${Math.round(this.cameras.main.zoom * 100)}%`);
      return;
    }
    if (action === "zoom-out") {
      this.zoomCameraBy(-0.16);
      this.setTouchNotice(`鏡頭 ${Math.round(this.cameras.main.zoom * 100)}%`);
      return;
    }
    if (action === "pause") {
      this.toggleBattlePause();
      return;
    }
    if (action === "restart") {
      this.restartBattle();
      return;
    }
    if (action === "leave") {
      this.leaveShowcase();
      return;
    }
    if (this.ended) return;
    if (action === "select-all") {
      this.squadSelection.selectAllFriendly(this.squadMembers());
      this.syncSelectionVisuals();
      this.announceTouchCommand("已選取全軍");
      return;
    }
    if (action === "clear") {
      this.squadSelection.clearSelection();
      this.syncSelectionVisuals();
      this.setTouchPanel("main");
      this.setTouchNotice("已取消選取");
      return;
    }
    if (action === "skill") {
      if (this.getSelectedActors().length === 0) {
        this.setTouchNotice("先選取部隊");
        return;
      }
      this.onSkillKey();
      this.setTouchNotice("已下達技能命令");
      return;
    }
    if (action === "formation") {
      this.toggleFormation();
      return;
    }
    const group = /^(store|recall)-([123])$/.exec(action);
    if (!group) return;
    const slot = Number(group[2]) as 1 | 2 | 3;
    if (group[1] === "store") {
      if (this.squadSelection.selectedIds.length === 0) {
        this.announceTouchCommand("請先選取單位", "#ffbd82");
        return;
      }
      this.squadSelection.storeControlGroup(slot);
      this.announceTouchCommand(`已儲存編隊 ${slot}`);
      this.setTouchPanel("main");
      return;
    }
    this.squadSelection.recallControlGroup(slot, this.squadMembers());
    this.syncSelectionVisuals();
    this.announceTouchCommand(this.squadSelection.selectedIds.length > 0 ? `已叫回編隊 ${slot}` : `編隊 ${slot} 尚未儲存`, this.squadSelection.selectedIds.length > 0 ? "#dce9c6" : "#ffbd82");
    this.setTouchPanel("main");
  }

  private announceTouchCommand(label: string, color = "#dce9c6"): void {
    this.setTouchNotice(label);
    spawnFloatingText(this, {
      x: 640 + this.cameras.main.scrollX,
      y: 116 + this.cameras.main.scrollY,
    }, label, color);
  }

  private readonly onViewportResize = (): void => {
    this.applyResponsiveInterface();
    this.updateSelectionPanel();
  };

  private isCompactLandscape(): boolean {
    const profile = getDeviceViewportProfile();
    return profile.landscape && (profile.touch || profile.coarsePointer || profile.height <= 520);
  }

  private applyResponsiveInterface(): void {
    const compact = this.isCompactLandscape();
    const viewportWidth = this.scale.gameSize.width;
    const viewportHeight = this.scale.gameSize.height;
    const profile = getDeviceViewportProfile();
    const safeLeft = profile.safeArea.left * viewportWidth / Math.max(1, profile.width);
    const safeRight = profile.safeArea.right * viewportWidth / Math.max(1, profile.width);
    const safeTop = profile.safeArea.top * viewportHeight / Math.max(1, profile.height);
    const panelX = safeLeft + 16;
    const panelY = safeTop + 14;
    const panelWidth = Math.max(320, viewportWidth - safeLeft - safeRight - 32);
    this.interfacePanel?.clear();
    this.interfacePanel?.fillStyle(0x111a17, 0.94).fillRect(panelX, panelY, panelWidth, compact ? 108 : 76);
    this.interfacePanel?.lineStyle(2, 0xd2c383, 0.75).strokeRect(panelX, panelY, panelWidth, compact ? 108 : 76);
    this.instructionText
      ?.setPosition(safeLeft + 36, safeTop + 24)
      .setFontSize(compact ? 27 : 16)
      .setWordWrapWidth(Math.max(360, viewportWidth - safeLeft - safeRight - 310))
      .setText(compact
        ? "手機指揮：點選・點地移動・點敵攻擊・拖曳移鏡・雙指縮放"
        : "框選／Shift 複選　右鍵移動／攻擊　Q 全隊技能　F 切換隊形　Ctrl+1–3 編隊　WASD 移鏡頭");
    this.scoreText
      ?.setPosition(safeLeft + 36, safeTop + (compact ? 72 : 52))
      .setFontSize(compact ? 24 : 15)
      .setWordWrapWidth(Math.max(360, viewportWidth - safeLeft - safeRight - 310));
    this.selectionText
      ?.setPosition(compact ? 288 : 24, compact ? 535 : 640)
      .setFontSize(compact ? 20 : 15)
      .setWordWrapWidth(compact ? 410 : 920)
      .setVisible(!compact);
    this.syncTouchControls();
    this.syncFullscreenButton();
  }

  private layoutCanvasControls(): void {
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    const profile = getDeviceViewportProfile();
    const compact = this.isCompactLandscape();
    const touchDevice = profile.touch || profile.coarsePointer;
    const unitsPerCssX = width / Math.max(1, profile.width);
    const unitsPerCssY = height / Math.max(1, profile.height);
    const safeTop = profile.safeArea.top * unitsPerCssY;
    const safeRight = profile.safeArea.right * unitsPerCssX;
    const safeBottom = profile.safeArea.bottom * unitsPerCssY;
    const bottomInset = touchDevice ? Math.max(48, safeBottom + 22) : 24;
    const dockScale = touchDevice && profile.height >= 760 ? 0.82 : 1;
    const panelY = height - bottomInset - 54 * dockScale;
    for (const panel of this.touchPanels.values()) {
      const availableScale = Math.max(0.72, (width - 40) / Math.max(1, panel.width));
      panel.setScale(Math.min(dockScale, availableScale)).setPosition(width / 2, panelY);
    }

    const readoutWidth = Math.min(820, Math.max(460, width - 140));
    const readoutY = panelY - 84 * dockScale;
    this.touchReadoutPanel?.clear();
    this.touchReadoutPanel?.fillStyle(0x050807, 0.7).fillRect(width / 2 - readoutWidth / 2 + 5, readoutY - 27 + 6, readoutWidth, 54);
    this.touchReadoutPanel?.fillStyle(0x111a17, 0.96).fillRect(width / 2 - readoutWidth / 2, readoutY - 27, readoutWidth - 5, 48);
    this.touchReadoutPanel?.lineStyle(3, 0xe0b866, 0.9).strokeRect(width / 2 - readoutWidth / 2, readoutY - 27, readoutWidth - 5, 48);
    this.touchReadout?.setPosition(width / 2 - 2, readoutY - 3).setWordWrapWidth(readoutWidth - 30);

    const rightInset = touchDevice ? Math.max(40, safeRight + 24) : 30;
    const fullscreenScale = touchDevice && !profile.landscape ? 1.75 : 1;
    const fullscreenY = Math.max(66 * fullscreenScale, safeTop + 44 * fullscreenScale + 16);
    this.fullscreenButton?.container
      .setScale(fullscreenScale)
      .setPosition(width - rightInset - 100 * fullscreenScale, fullscreenY)
      .setVisible(true)
      .setActive(true);

    if (this.touchBriefing) {
      const blocker = this.touchBriefing.getByName("touch-briefing-blocker") as Phaser.GameObjects.Graphics | null;
      const dialog = this.touchBriefing.getByName("touch-briefing-dialog") as Phaser.GameObjects.Container | null;
      blocker?.clear().fillStyle(0x07110e, 0.76).fillRect(0, 0, width, height);
      dialog?.setPosition(width / 2, height / 2);
    }

    if (this.rotatePrompt) {
      const shouldRotate = profile.mobile && !profile.landscape;
      this.rotatePrompt.setVisible(shouldRotate).setActive(shouldRotate);
      const blocker = this.rotatePrompt.getByName("rotate-device-blocker") as Phaser.GameObjects.Graphics | null;
      const phone = this.rotatePrompt.getByName("rotate-phone-art") as Phaser.GameObjects.Graphics | null;
      blocker?.clear().fillStyle(0x101917, 0.97).fillRect(0, 0, width, height);
      if (blocker?.input?.hitArea instanceof Phaser.Geom.Rectangle) blocker.input.hitArea.setTo(0, 0, width, height);
      phone?.setPosition(width / 2, height / 2 - 190);
      const title = this.rotatePrompt.list.find((item) => item instanceof Phaser.GameObjects.Text && item.text === "請將手機橫放") as Phaser.GameObjects.Text | undefined;
      const copy = this.rotatePrompt.list.find((item) => item instanceof Phaser.GameObjects.Text && item.text.startsWith("畫面會自動放大")) as Phaser.GameObjects.Text | undefined;
      title?.setPosition(width / 2, height / 2 + 42);
      copy?.setPosition(width / 2, height / 2 + 104);
    }

    if (!compact) {
      for (const panel of this.touchPanels.values()) panel.setVisible(false).setActive(false);
      this.touchReadout?.setVisible(false);
      this.touchReadoutPanel?.setVisible(false);
    }
  }

  private syncFullscreenButton(): void {
    const label = fullscreenButtonLabel(this);
    this.fullscreenButton?.setLabel(label.glyph, label.label);
    this.layoutCanvasControls();
  }

  private onFullscreenFallback(): void {
    this.setTouchNotice("瀏覽器拒絕全螢幕，已改用最大可用畫面");
    this.syncFullscreenButton();
  }

  private updateSelectionPanel(): void {
    if (!this.selectionText) return;
    const selectedActors = this.getSelectedActors();
    if (selectedActors.length === 0) {
      this.selectionText.setText(this.isCompactLandscape()
        ? "未選取｜點選或框選我軍"
        : "拖曳框選我軍，前往兩座烽火台累積 100 勝點；野怪保持中立，遭攻擊後才會反擊。R 重開，Esc 返回。");
      this.updateTouchReadout();
      return;
    }
    const actor = selectedActors[0]!;
    const ability = actor.definition.activeAbility;
    const cooldown = actor.skillCooldownMs <= 0 ? "就緒" : `${(actor.skillCooldownMs / 1000).toFixed(1)}s`;
    const statuses = [...actor.statuses.keys()].join("、") || "無";
    this.selectionText.setText(this.isCompactLandscape()
      ? `${selectedActors.length}人｜${this.formationKind === "wedge" ? "楔形" : "橫列"}｜${actor.definition.displayName} ${Math.ceil(actor.hitPoints)}/${actor.definition.maxHitPoints}｜${ability.displayName} ${cooldown}`
      : `已選 ${selectedActors.length} 人｜${this.formationKind === "wedge" ? "楔形" : "橫列"}　主選：${actor.definition.displayName} ${Math.ceil(actor.hitPoints)}/${actor.definition.maxHitPoints}\n` +
        `Q ${ability.displayName}（${cooldown}）— ${ability.description}　狀態：${statuses}`);
    this.updateTouchReadout();
  }

  private finishBattle(winner: SkirmishSide, reason: "victoryPoints" | "elimination"): void {
    if (this.ended) return;
    this.ended = true;
    const victory = winner === "player";
    const reasonText = reason === "victoryPoints" ? "戰略勝點達成" : victory ? "敵軍主力瓦解" : "我軍主力瓦解";
    const replayHint = this.isCompactLandscape() ? "點下方「重開」再戰" : "按 R 再戰";
    this.resultText = this.add.text(640, 330, victory ? `戰役勝利\n${reasonText}\n${replayHint}` : `防線失守\n${reasonText}\n${replayHint}`, {
      align: "center",
      color: victory ? "#dff0b4" : "#ffb09c",
      backgroundColor: "#101916e8",
      fontFamily: "Georgia, Noto Serif TC, serif",
      fontSize: "38px",
      fontStyle: "bold",
      padding: { x: 34, y: 24 },
      stroke: "#1c211f",
      strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(50_000);
  }

  private createObjectiveMarkers(): void {
    for (const id of BEACON_IDS) {
      const zone = this.getBeaconZone(id);
      if (!zone) continue;
      const point = gridToWorld(zone.center, ORIGIN);
      const graphics = this.add.graphics().setDepth(Math.floor(point.y * 10 - 4));
      const label = this.add.text(point.x, point.y - 78, "", {
        align: "center",
        color: "#f3edcf",
        backgroundColor: "#111a17cc",
        fontFamily: "Segoe UI, Noto Sans TC, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        padding: { x: 7, y: 4 },
      }).setOrigin(0.5).setDepth(Math.floor(point.y * 10 + 6));
      this.objectiveMarkers.set(id, { graphics, label });
    }
  }

  private tickSkirmish(deltaMs: number): void {
    if (this.ended) return;
    const snapshot = {
      player: {
        aliveUnits: this.actors.filter((actor) => actor.team === "player" && !actor.dead).length,
        activeAttackers: this.actors.filter((actor) => actor.team === "player" && !actor.dead).length,
        reserveUnits: this.actors.filter((actor) => actor.team === "player" && actor.dead).length,
      },
      enemy: {
        aliveUnits: this.actors.filter((actor) => actor.team === "enemy" && !actor.dead).length,
        activeAttackers: this.actors.filter((actor) => actor.team === "enemy" && !actor.dead && actor.deployed).length,
        reserveUnits: this.actors.filter((actor) => actor.team === "enemy" && !actor.dead && !actor.deployed).length,
      },
      beacons: {
        westBeacon: this.beaconPresence("westBeacon"),
        eastBeacon: this.beaconPresence("eastBeacon"),
      },
      monsters: this.actors
        .filter((actor) => actor.team === "monster")
        .map((actor) => ({ id: actor.instanceId, alive: !actor.dead, provokedBy: actor.provokedBy })),
    } as const;
    for (const event of this.director.tick(deltaMs, snapshot)) this.handleSkirmishEvent(event);
  }

  private handleSkirmishEvent(event: SkirmishDirectorEvent): void {
    if (event.type === "phaseChanged" && event.current !== "finished") {
      const label = ({ preparation: "部署階段", engagement: "交戰開始", reinforcement: "增援抵達", showdown: "最終決戰" } as const)[event.current];
      spawnFloatingText(this, { x: 640 + this.cameras.main.scrollX, y: 135 + this.cameras.main.scrollY }, label, "#ffe39a");
      return;
    }
    if (event.type === "reinforcementRequested") {
      this.deployReinforcements(event.side, event.count);
      return;
    }
    if (event.type === "victory") this.finishBattle(event.winner, event.reason);
  }

  private deployReinforcements(side: SkirmishSide, count: number): void {
    if (side === "enemy") {
      const reinforcements = this.actors.filter((actor) => actor.team === "enemy" && !actor.dead && !actor.deployed).slice(0, count);
      for (const actor of reinforcements) {
        actor.deployed = true;
        actor.aiDecisionCooldownMs = 0;
        spawnFloatingText(this, { x: actor.visual.container.x, y: actor.visual.container.y - 78 }, "敵軍增援", "#ff9f87");
      }
      return;
    }
    const fallen = this.actors.filter((actor) => actor.team === "player" && actor.dead).slice(0, count);
    const spawns = getSuggestedSpawns().westTeam;
    for (const [index, actor] of fallen.entries()) this.reviveActor(actor, spawns[index % spawns.length]!);
  }

  private reviveActor(actor: ShowcaseActor, position: GridPoint): void {
    actor.dead = false;
    actor.hitPoints = Math.ceil(actor.definition.maxHitPoints * 0.62);
    actor.position = clampToWalkable(position);
    actor.destination = undefined;
    actor.route = [];
    actor.targetId = undefined;
    actor.objectiveId = undefined;
    actor.statuses.clear();
    actor.statusTicks.clear();
    actor.lastDamagedBy = undefined;
    actor.actionLockMs = 500;
    actor.visual.container.setVisible(true).setActive(true).setAlpha(1).setScale(1);
    actor.visual.container.setInteractive({ useHandCursor: true }).setData("showcaseActorId", actor.instanceId);
    actor.teamMark.setVisible(true);
    actor.visual.play("idle", true);
    this.positionActor(actor);
    spawnFloatingText(this, { x: actor.visual.container.x, y: actor.visual.container.y - 82 }, "我方增援", "#a8efd2");
  }

  private enemyDecisionIntervalMs(): number {
    return ({ aggressor: 520, guardian: 820, prosperer: 1_050, balanced: 760, raider: 480 } satisfies Record<AiPersonality, number>)[this.aiPersonality];
  }

  private aiPersonalityTargetBias(id: string, kind: "player" | "beacon" | "monster"): number {
    if (this.aiPersonality === "aggressor") return kind === "player" ? 34 : kind === "beacon" ? -10 : -18;
    if (this.aiPersonality === "guardian") return kind === "beacon" ? 38 : kind === "player" ? 8 : -20;
    if (this.aiPersonality === "prosperer") return kind === "beacon" ? 26 : kind === "monster" ? 16 : -18;
    if (this.aiPersonality === "raider" && kind === "player") {
      const target = this.findLivingActor(id);
      if (!target) return 18;
      const vulnerable = (1 - target.hitPoints / target.definition.maxHitPoints) * 44;
      const backline = target.definition.attackRange >= 3 ? 24 : 0;
      return vulnerable + backline;
    }
    return kind === "monster" ? -8 : 0;
  }

  private chooseEnemyIntent(actor: ShowcaseActor): void {
    const candidates = [
      ...this.actors.filter((target) => target.team === "player" && !target.dead).map((target) => ({
        id: target.instanceId,
        kind: "player" as const,
        distance: gridDistance(actor.position, target.position),
        healthRatio: target.hitPoints / target.definition.maxHitPoints,
        threat: Phaser.Math.Clamp(target.definition.baseDamage / 60, 0, 1),
      })),
      ...BEACON_IDS.map((id) => {
        const zone = this.getBeaconZone(id)!;
        return {
          id: `beacon:${id}`,
          kind: "beacon" as const,
          distance: gridDistance(actor.position, zone.center),
          healthRatio: 1,
          threat: 0,
          objectiveController: this.director.state.objectives[id].controller,
        };
      }),
      ...this.actors.filter((target) => target.team === "monster" && !target.dead && target.provokedBy === "enemy").map((target) => ({
        id: target.instanceId,
        kind: "monster" as const,
        distance: gridDistance(actor.position, target.position),
        healthRatio: target.hitPoints / target.definition.maxHitPoints,
        threat: Phaser.Math.Clamp(target.definition.baseDamage / 70, 0, 1),
        rewardValue: 8,
        monsterProvokedBy: target.provokedBy,
      })),
    ];
    const choice = this.director.rankAiTargets(candidates)
      .map((entry) => ({ ...entry, weight: entry.weight + this.aiPersonalityTargetBias(entry.id, entry.kind) }))
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))[0];
    if (!choice) return;
    if (choice.kind === "beacon") {
      const id = choice.id.replace("beacon:", "") as BeaconId;
      const zone = this.getBeaconZone(id);
      if (!zone) return;
      actor.targetId = undefined;
      actor.objectiveId = id;
      this.setActorDestination(actor, zone.center);
      return;
    }
    actor.objectiveId = undefined;
    actor.targetId = choice.id;
  }

  private setActorDestination(actor: ShowcaseActor, destination: GridPoint): void {
    const target = clampToWalkable(destination);
    const path = [...findPath(actor.position, target)];
    const route = path.length > 1 ? path.slice(1) : [target];
    actor.destination = route.shift();
    actor.route = route;
  }

  private beaconPresence(id: BeaconId): { playerUnits: number; enemyUnits: number } {
    const zone = this.getBeaconZone(id);
    if (!zone) return { playerUnits: 0, enemyUnits: 0 };
    const inside = this.actors.filter((actor) => !actor.dead && actor.team !== "monster" && gridDistance(actor.position, zone.center) <= zone.radiusTiles);
    return {
      playerUnits: inside.filter((actor) => actor.team === "player").length,
      enemyUnits: inside.filter((actor) => actor.team === "enemy" && actor.deployed).length,
    };
  }

  private getBeaconZone(id: BeaconId): ObjectiveZone | undefined {
    const prefix = id === "westBeacon" ? "west" : "east";
    return getObjectiveZones().find((zone) => zone.kind === "beacon" && zone.id.startsWith(prefix));
  }

  private beaconAt(point: GridPoint): { id: BeaconId; zone: ObjectiveZone } | undefined {
    for (const id of BEACON_IDS) {
      const zone = this.getBeaconZone(id);
      if (zone && gridDistance(point, zone.center) <= zone.radiusTiles) return { id, zone };
    }
    return undefined;
  }

  private updateSkirmishInterface(): void {
    const state = this.director.state;
    const phase = ({ preparation: "部署", engagement: "交戰", reinforcement: "增援", showdown: "決戰", finished: "結束" } as const)[state.phase];
    const seconds = Math.ceil(Math.max(0, 10_000 - state.elapsedMs) / 1000);
    const matchup = `${this.villageDoctrineLabel().split("・")[0]} vs ${this.aiPersonalityLabel()}`;
    const playerRewards = this.battleRewards.player;
    const enemyRewards = this.battleRewards.enemy;
    const phaseLabel = `${phase}${state.phase === "preparation" ? ` ${seconds}s` : ""}`;
    this.scoreText?.setText(this.isCompactLandscape()
      ? `${matchup}｜${phaseLabel}　勝 ${state.score.player}:${state.score.enemy}　戰利 ${playerRewards.food}/${playerRewards.wood}/${playerRewards.stone}　敵壓 ${Math.round(state.enemyPressure * 100)}%`
      : `${matchup}｜${phaseLabel}　勝點 我方 ${state.score.player}：${state.score.enemy} 敵方　西台 ${this.controllerLabel(state.objectives.westBeacon.controller)}　` +
        `東台 ${this.controllerLabel(state.objectives.eastBeacon.controller)}　戰利 我 ${playerRewards.food}/${playerRewards.wood}/${playerRewards.stone}・敵 ${enemyRewards.food}/${enemyRewards.wood}/${enemyRewards.stone}　` +
        `敵壓 ${Math.round(state.enemyPressure * 100)}%`);
    for (const id of BEACON_IDS) {
      const marker = this.objectiveMarkers.get(id);
      const zone = this.getBeaconZone(id);
      if (!marker || !zone) continue;
      const objective = state.objectives[id];
      const point = gridToWorld(zone.center, ORIGIN);
      const color = objective.controller === "player" ? PLAYER_COLOR : objective.controller === "enemy" ? ENEMY_COLOR : 0xe0c783;
      marker.graphics.clear();
      marker.graphics.fillStyle(color, 0.12).fillCircle(point.x, point.y, 39);
      marker.graphics.lineStyle(4, color, 0.92).strokeCircle(point.x, point.y, 27 + Math.abs(objective.progress) * 9);
      marker.label.setText(`${id === "westBeacon" ? "西" : "東"}烽火｜${this.controllerLabel(objective.controller)} ${Math.round(Math.abs(objective.progress) * 100)}%`);
    }
  }

  private controllerLabel(controller: "player" | "enemy" | "neutral"): string {
    return controller === "player" ? "我方" : controller === "enemy" ? "敵方" : "中立";
  }

  private squadMembers(): SquadMember[] {
    return this.actors.map((actor) => this.toSquadMember(actor));
  }

  private toSquadMember(actor: ShowcaseActor): SquadMember {
    return { id: actor.instanceId, teamId: actor.team, position: actor.position, alive: !actor.dead, selectable: actor.team === "player" };
  }

  private squadAdapter(): ScreenGridAdapter<SquadMember> {
    return {
      screenToGrid: (point) => clampToWalkable(worldToGrid(this.cameras.main.getWorldPoint(point.x, point.y), ORIGIN)),
      gridToScreen: (point) => {
        const world = gridToWorld(point, ORIGIN);
        return { x: world.x - this.cameras.main.scrollX, y: world.y - this.cameras.main.scrollY };
      },
      memberScreenPoint: (member) => {
        const actor = this.findLivingActor(member.id);
        const world = actor ? { x: actor.visual.container.x, y: actor.visual.container.y - 36 } : gridToWorld(member.position, ORIGIN);
        return { x: world.x - this.cameras.main.scrollX, y: world.y - this.cameras.main.scrollY };
      },
    };
  }

  private getSelectedActors(): ShowcaseActor[] {
    return this.squadSelection.selectedIds
      .map((id) => this.findLivingActor(id))
      .filter((actor): actor is ShowcaseActor => Boolean(actor?.team === "player"));
  }

  private syncSelectionVisuals(): void {
    const selectedIds = new Set(this.squadSelection.selectedIds);
    for (const actor of this.actors) actor.selectionRing.setVisible(!actor.dead && selectedIds.has(actor.instanceId));
    this.selected = this.getSelectedActors()[0];
    this.updateSelectionPanel();
  }

  private createCameraKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.cameraKeys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  private updateCamera(seconds: number): void {
    if (!this.cameraKeys) return;
    const horizontal = Number(this.cameraKeys.right.isDown || this.cameraKeys.d.isDown) - Number(this.cameraKeys.left.isDown || this.cameraKeys.a.isDown);
    const vertical = Number(this.cameraKeys.down.isDown || this.cameraKeys.s.isDown) - Number(this.cameraKeys.up.isDown || this.cameraKeys.w.isDown);
    if (horizontal === 0 && vertical === 0) return;
    this.cameras.main.scrollX += horizontal * 430 * seconds;
    this.cameras.main.scrollY += vertical * 330 * seconds;
  }

  private onWheel(pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number): void {
    this.setCameraZoom(this.cameras.main.zoom - deltaY * 0.001, { x: pointer.x, y: pointer.y });
  }

  private zoomCameraBy(amount: number): void {
    this.setCameraZoom(this.cameras.main.zoom + amount, {
      x: this.scale.gameSize.width / 2,
      y: this.scale.gameSize.height / 2,
    });
  }

  private setCameraZoom(zoom: number, anchor: ScreenPoint): void {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(anchor.x, anchor.y);
    camera.setZoom(Phaser.Math.Clamp(zoom, 0.72, 1.38));
    const after = camera.getWorldPoint(anchor.x, anchor.y);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
  }

  private toggleBattlePause(): void {
    if (this.ended) return;
    this.battlePaused = !this.battlePaused;
    this.time.paused = this.battlePaused;
    if (this.battlePaused) this.tweens.pauseAll();
    else this.tweens.resumeAll();
    this.setTouchNotice(this.battlePaused ? "戰鬥已暫停｜仍可移動鏡頭" : "戰鬥繼續");
    this.syncTouchControls();
  }

  private positionActor(actor: ShowcaseActor): void {
    const point = gridToWorld(actor.position, ORIGIN);
    actor.visual.container.setPosition(point.x, point.y).setDepth(Math.floor(point.y * 10 + actor.position.x));
    actor.healthBar.clear();
    if (actor.dead) return;
    const ratio = actor.hitPoints / actor.definition.maxHitPoints;
    const width = actor.artId === "boar_rider" || actor.team === "monster" ? 48 : 38;
    actor.healthBar.fillStyle(0x17201d, 0.9).fillRect(-width / 2, -82, width, 5);
    actor.healthBar.fillStyle(ratio > 0.4 ? this.teamColor(actor.team) : 0xd75043, 1).fillRect(-width / 2 + 1, -81, Math.max(0, (width - 2) * ratio), 3);
  }

  private nearestOpponent(actor: ShowcaseActor): ShowcaseActor | undefined {
    return this.opponentsOf(actor)
      .sort((left, right) => gridDistance(actor.position, left.position) - gridDistance(actor.position, right.position) || left.instanceId.localeCompare(right.instanceId))[0];
  }

  private opponentsOf(actor: ShowcaseActor): ShowcaseActor[] {
    return this.actors.filter((candidate) => {
      if (candidate.dead || candidate === actor) return false;
      if (actor.team === "player") return candidate.team !== "player";
      if (actor.team === "enemy") return candidate.team === "player";
      return actor.provokedBy ? candidate.team === actor.provokedBy : false;
    });
  }

  private findLivingActor(instanceId: string): ShowcaseActor | undefined {
    return this.actors.find((actor) => actor.instanceId === instanceId && !actor.dead);
  }

  private hasStatus(actor: ShowcaseActor, status: string): boolean {
    return actor.statuses.has(status);
  }

  private isRooted(actor: ShowcaseActor): boolean {
    return this.hasStatus(actor, "stagger");
  }

  private pointBeforeTarget(from: GridPoint, target: GridPoint, distance: number): GridPoint {
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { x: target.x - dx / length * distance, y: target.y - dy / length * distance };
  }

  private teamColor(team: Team): number {
    return team === "player" ? PLAYER_COLOR : team === "enemy" ? ENEMY_COLOR : MONSTER_COLOR;
  }

  private restartBattle(): void {
    this.scene.restart({
      villageId: this.villageId,
      aiPersonality: this.aiPersonality,
      returnScene: this.returnScene,
    });
  }

  private leaveShowcase(): void {
    this.scene.start(this.returnScene);
  }

  private cleanup(): void {
    this.load.off(Phaser.Loader.Events.PROGRESS, this.onCombatLoadProgress, this);
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onCombatArtLoadError, this);
    this.input.off("pointerdown", this.onPointerDown, this);
    this.input.off("pointermove", this.onPointerMove, this);
    this.input.off("pointerup", this.onPointerUp, this);
    this.input.off("wheel", this.onWheel, this);
    this.input.keyboard?.off("keydown-Q", this.onSkillKey, this);
    this.input.keyboard?.off("keydown-R", this.restartBattle, this);
    this.input.keyboard?.off("keydown-ESC", this.leaveShowcase, this);
    this.input.keyboard?.off("keydown-P", this.toggleBattlePause, this);
    this.input.keyboard?.off("keydown", this.onKeyboardShortcut, this);
    window.removeEventListener("resize", this.onViewportResize);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.applyResponsiveInterface, this);
    this.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, this.syncFullscreenButton, this);
    this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.syncFullscreenButton, this);
    this.events.off(GAME_FULLSCREEN_FALLBACK_EVENT, this.onFullscreenFallback, this);
    this.time.paused = false;
    this.tweens.resumeAll();
    for (const button of this.touchButtons.values()) button.destroy();
    this.touchButtons.clear();
    this.touchControls?.destroy(true);
    this.touchControls = undefined;
    this.touchReadout = undefined;
    this.touchReadoutPanel = undefined;
    this.touchBriefing = undefined;
    this.touchBriefingOpen = false;
    this.touchPanels.clear();
    this.fullscreenButton?.destroy();
    this.fullscreenButton = undefined;
    this.rotatePrompt?.destroy(true);
    this.rotatePrompt = undefined;
    this.touchCameraDrag = undefined;
    this.touchDidPan = false;
    this.pinchStartDistance = 0;
    this.loadingUi?.destroy(true);
    this.loadingUi = undefined;
    for (const actor of this.actors) actor.visual.destroy();
    this.actors = [];
    this.squadSelection.clearSelection();
    this.mapView?.destroy();
    this.mapView = undefined;
    this.objectiveMarkers.clear();
    this.cameraKeys = undefined;
    this.selected = undefined;
    this.resultText = undefined;
    this.interfacePanel = undefined;
  }
}

export default CombatShowcaseScene;
