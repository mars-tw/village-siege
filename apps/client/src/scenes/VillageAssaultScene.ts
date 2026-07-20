import Phaser from "phaser";
import {
  BUILDINGS,
  COMBAT_UNITS,
  findPathToAny,
  getEntityFootprintCells,
  getFootprintCells,
  getFootprintPerimeterCells,
  getOccupiedMapCells,
  getVillageAssaultWalkBlockedCells,
  isBuildLocationAvailable,
  isRallyPointAvailable,
  MAX_TRAINING_QUEUE_DEPTH,
  SETTLEMENT_TIER_ORDER,
  SETTLEMENT_TIERS,
  TECHNOLOGIES,
  TECHNOLOGY_ORDER,
  TICK_MILLISECONDS,
  TICKS_PER_SECOND,
  TOWN_CENTER_REBUILD_GRACE_TICKS,
  UNITS,
  validateCommand,
  type AiPersonality,
  type BuildingEntityState,
  type BuildingType,
  type CombatStance,
  type CombatUnitId,
  type DomainEvent,
  type EntityState,
  type FormationKind,
  type GameCommand,
  type GridPoint,
  type ResourceEntityState,
  type ResourceKind,
  type ResourceWallet,
  type ProductionJobId,
  type SettlementTier,
  type TechnologyType,
  type UnitEntityState,
  type UnitType,
  type VillageId,
} from "@village-siege/shared";
import { drawBattleMap, type BattleMapView } from "../game/battleMap";
import {
  ANIMATED_UNIT_FRAME_ASSETS,
  COMBAT_ANIMATION_MANIFEST,
  assertCombatAnimationManifestValid,
} from "../game/combatAnimationManifest";
import { DEFAULT_TEAM_PALETTES } from "../game/combatArt";
import { launchProjectile, spawnFloatingText, spawnImpactBurst, spawnSkillTelegraph } from "../game/combatEffects";
import type { CombatAction, CombatArtId } from "../game/directionalAnimation";
import { getDeviceViewportProfile } from "../game/deviceViewport";
import {
  createFrameAnimatedCombatActor,
  requireFrameAnimatedManifest,
  validateFrameAnimatedCombatActorManifest,
  type FrameAnimatedCombatActor,
} from "../game/frameAnimatedCombatActor";
import { GAME_FULLSCREEN_FALLBACK_EVENT, fullscreenButtonLabel, toggleGameFullscreen } from "../game/gameFullscreen";
import { gridToWorld, worldToGrid } from "../game/isometric";
import {
  buildingDisplayName,
  createBuildingView,
  createResourceView,
  resourceDisplayName,
  type AssaultEntityView,
} from "../game/villageAssaultArt";
import {
  VILLAGE_ASSAULT_BOUNDS,
  VILLAGE_ASSAULT_ORIGIN,
  drawPlacementFootprint,
  drawSettlementOverlay,
  isSettlementBuildable,
  type SettlementOverlay,
} from "../game/villageAssaultMap";
import {
  VILLAGE_ASSAULT_AI_ID,
  VILLAGE_ASSAULT_PLAYER_ID,
  createVillageAssaultRuntime,
  type VillageAssaultRuntime,
} from "../game/villageAssaultRuntime";
import { createCanvasButton, type CanvasButtonControl } from "../ui/canvasButton";

interface VillageAssaultSceneData {
  readonly villageId?: VillageId;
  readonly aiPersonality?: AiPersonality;
  readonly returnScene?: string;
}

interface UnitView {
  readonly actor: FrameAnimatedCombatActor;
  readonly selection: Phaser.GameObjects.Graphics;
  readonly health: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly cargoPack: Phaser.GameObjects.Graphics;
  readonly cargoLabel: Phaser.GameObjects.Text;
  grid: GridPoint;
  hitPoints: number;
  action: CombatAction;
}

interface ActionSpec {
  readonly glyph: string;
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly enabled?: boolean;
  readonly active?: boolean;
  readonly run: () => void;
}

type ProductionUiMode =
  | { readonly kind: "none" }
  | { readonly kind: "queue"; readonly producerId: string; readonly page: number }
  | { readonly kind: "confirm"; readonly producerId: string; readonly jobId: ProductionJobId; readonly page: number }
  | { readonly kind: "rally"; readonly producerId: string };

type TacticalUiMode =
  | { readonly kind: "none" }
  | { readonly kind: "attackMove"; readonly entityIds: readonly string[] }
  | { readonly kind: "patrol"; readonly entityIds: readonly string[]; readonly firstPoint: GridPoint | null }
  | { readonly kind: "repair"; readonly entityIds: readonly string[] }
  | { readonly kind: "ability"; readonly casterId: string; readonly abilityId: string; readonly targeting: "unit" | "ground" | "direction" };

const UNIT_ART: Readonly<Record<UnitType, CombatArtId>> = {
  villager: "warrior",
  warrior: "warrior",
  shieldBearer: "shieldbearer",
  archer: "archer",
  mage: "mage",
  musketeer: "musketeer",
  boarRider: "boar_rider",
  heavyCrossbowman: "heavy_crossbow",
};

const UNIT_LABELS: Readonly<Record<UnitType, string>> = {
  villager: "拓荒工匠",
  warrior: "邊境戰士",
  shieldBearer: "持盾槍衛",
  archer: "林地弓手",
  mage: "星火法師",
  musketeer: "黑火銃兵",
  boarRider: "野豬騎士",
  heavyCrossbowman: "重弩攻城手",
};

const BUILD_PAGES: readonly (readonly BuildingType[])[] = [
  ["house", "lumberCamp", "farmstead", "barracks"],
  ["archeryRange", "mageSanctum", "gunWorkshop", "beastStable"],
  ["siegeWorkshop", "defenseTower"],
];
const SETTLEMENT_TIER_LABELS: Readonly<Record<SettlementTier, string>> = {
  frontier: "拓荒期",
  stronghold: "城寨期",
  artificer: "工藝期",
};
const SETTLEMENT_TIER_SHORT_LABELS: Readonly<Record<SettlementTier, string>> = {
  frontier: "拓荒",
  stronghold: "城寨",
  artificer: "工藝",
};
const SETTLEMENT_ADVANCEMENT_NOTICES: Readonly<Record<SettlementTier, string>> = {
  frontier: "拓荒旗幟已在村鎮升起",
  stronghold: "城門銅鐘響徹村道｜聚落邁入城寨期",
  artificer: "爐火與齒輪照亮工坊｜聚落邁入工藝期",
};
const UI_WIDTH = 900;
const UI_BUTTON_WIDTH = 118;
const UI_BUTTON_HEIGHT = 118;
const UI_GAP = 6;
const ACTION_PANEL_HEIGHT = 154;

export class VillageAssaultScene extends Phaser.Scene {
  private villageId: VillageId = "pinehold";
  private aiPersonality: AiPersonality = "balanced";
  private returnScene = "VillageSelectScene";
  private runtime!: VillageAssaultRuntime;
  private mapView?: BattleMapView;
  private settlementOverlay?: SettlementOverlay;
  private readonly unitViews = new Map<string, UnitView>();
  private readonly entityViews = new Map<string, AssaultEntityView>();
  private readonly projectileEffects = new Map<string, Phaser.GameObjects.Container>();
  private readonly selectedIds = new Set<string>();
  private buildMenuOpen = false;
  private buildPage = 0;
  private researchMenuOpen = false;
  private researchPage = 0;
  private productionUiMode: ProductionUiMode = { kind: "none" };
  private tacticalUiMode: TacticalUiMode = { kind: "none" };
  private buildingPlacement: BuildingType | null = null;
  private systemPanelOpen = false;
  private hoverGrid: GridPoint | null = null;
  private hoverEntityId: string | null = null;
  private paused = false;
  private ended = false;
  private lastUiTick = -1;
  private notice = "先點工匠，再點資源採集；滿載後會自動送回主城或集散建築";
  private noticeUntil = 0;
  private artLoadFailures: string[] = [];
  private readonly artLoadPromises = new Map<CombatArtId, Promise<void>>();
  private readonly pendingArtIds = new Set<CombatArtId>();
  private readonly failedArtIds = new Set<CombatArtId>();
  private readonly artRetryAt = new Map<CombatArtId, number>();
  private artLoadGeneration = 0;
  private uiScale = 1;
  private compactUi = false;
  private topRoot?: Phaser.GameObjects.Container;
  private actionRoot?: Phaser.GameObjects.Container;
  private rotateRoot?: Phaser.GameObjects.Container;
  private rotateBlocker?: Phaser.GameObjects.Rectangle;
  private orientationBlocked = false;
  private resourceText?: Phaser.GameObjects.Text;
  private objectiveText?: Phaser.GameObjects.Text;
  private selectionText?: Phaser.GameObjects.Text;
  private noticeText?: Phaser.GameObjects.Text;
  private noticeLiveRegion?: HTMLOutputElement;
  private readonly actionButtons: CanvasButtonControl[] = [];
  private currentActions: readonly ActionSpec[] = [];
  private pointerStart?: { x: number; y: number; scrollX: number; scrollY: number };
  private pointerDragged = false;
  private cameraKeys?: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private uiCamera?: Phaser.Cameras.Scene2D.Camera;

  constructor() {
    super({ key: "VillageAssaultScene" });
  }

  init(data: VillageAssaultSceneData): void {
    this.villageId = data.villageId ?? "pinehold";
    this.aiPersonality = data.aiPersonality ?? "balanced";
    this.returnScene = data.returnScene ?? "VillageSelectScene";
    this.unitViews.clear();
    this.entityViews.clear();
    this.projectileEffects.clear();
    this.selectedIds.clear();
    this.buildMenuOpen = false;
    this.buildPage = 0;
    this.researchMenuOpen = false;
    this.researchPage = 0;
    this.productionUiMode = { kind: "none" };
    this.tacticalUiMode = { kind: "none" };
    this.buildingPlacement = null;
    this.systemPanelOpen = false;
    this.hoverGrid = null;
    this.hoverEntityId = null;
    this.paused = false;
    this.ended = false;
    this.lastUiTick = -1;
    this.notice = "先點工匠，再點木材、糧食或石礦開始採集";
    this.noticeUntil = performance.now() + 5_000;
    this.artLoadFailures = [];
    this.artLoadPromises.clear();
    this.pendingArtIds.clear();
    this.failedArtIds.clear();
    this.artRetryAt.clear();
    this.artLoadGeneration += 1;
    this.pointerStart = undefined;
    this.pointerDragged = false;
  }

  preload(): void {
    assertCombatAnimationManifestValid();
    const assets = ANIMATED_UNIT_FRAME_ASSETS.filter((asset) => asset.artId === "warrior" && !this.textures.exists(asset.textureKey));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onArtLoadError, this);
    for (const asset of assets) this.load.image(asset.textureKey, asset.path);
  }

  create(): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onArtLoadError, this);
    if (this.artLoadFailures.length > 0) {
      this.showLoadFailure();
      return;
    }
    validateFrameAnimatedCombatActorManifest(this, requireFrameAnimatedManifest(COMBAT_ANIMATION_MANIFEST, "warrior"), "warrior");
    this.runtime = createVillageAssaultRuntime({
      playerVillageId: this.villageId,
      aiPersonality: this.aiPersonality,
      aiDifficulty: "standard",
      seed: 20260719,
    });
    this.cameras.main.setBackgroundColor("#17241f");
    this.cameras.main.setBounds(VILLAGE_ASSAULT_BOUNDS.x, VILLAGE_ASSAULT_BOUNDS.y, VILLAGE_ASSAULT_BOUNDS.width, VILLAGE_ASSAULT_BOUNDS.height);
    this.mapView = drawBattleMap(this, VILLAGE_ASSAULT_ORIGIN);
    this.mapView.container.setDepth(-10_000);
    this.settlementOverlay = drawSettlementOverlay(this, VILLAGE_ASSAULT_ORIGIN);
    this.settlementOverlay.container.setDepth(-2_000);
    this.uiCamera = this.cameras.add(0, 0, this.scale.gameSize.width, this.scale.gameSize.height, false, "assault-ui");
    this.uiCamera.ignore([this.mapView.container, this.settlementOverlay.container]);
    this.createInterface();
    this.syncEntityViews(true);
    this.centerCameraOn({ x: 5, y: 8 });
    this.input.mouse?.disableContextMenu();
    this.input.addPointer(2);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.input.keyboard?.on("keydown-B", this.openBuildMenu, this);
    this.input.keyboard?.on("keydown-ESC", this.handleEscape, this);
    this.input.keyboard?.on("keydown-P", this.togglePause, this);
    this.input.keyboard?.on("keydown-R", this.restartBattle, this);
    this.cameraKeys = this.input.keyboard ? {
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    } : undefined;
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layoutInterface, this);
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, this.layoutInterface, this);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.layoutInterface, this);
    this.events.on(GAME_FULLSCREEN_FALLBACK_EVENT, this.layoutInterface, this);
    window.addEventListener("resize", this.layoutInterface);
    this.layoutInterface();
    this.refreshInterface(true);
  }

  update(_time: number, delta: number): void {
    this.updateCamera(delta);
    if (this.paused || this.ended || this.orientationBlocked || !this.runtime) return;
    const result = this.runtime.step(Math.min(delta, 250));
    if (result.steps === 0) return;
    const advancement = result.events.find((event) => (
      event.type === "settlementAdvanced" && event.playerId === VILLAGE_ASSAULT_PLAYER_ID
    ));
    if (advancement?.type === "settlementAdvanced") {
      this.setNotice(SETTLEMENT_ADVANCEMENT_NOTICES[advancement.settlementTier], "success");
    }
    const completedResearch = result.events.find((event) => (
      event.type === "technologyResearched" && event.playerId === VILLAGE_ASSAULT_PLAYER_ID
    ));
    if (completedResearch?.type === "technologyResearched") {
      this.setNotice(`${TECHNOLOGIES[completedResearch.technologyId].displayName}研究完成`, "success");
    }
    this.renderCombatEvents(result.events);
    this.prefetchQueuedUnitArt();
    this.syncEntityViews(false);
    this.updateUnitAnimations(result.steps * 100);
    if (result.latestRejection?.source === "ai") {
      // AI rejection is kept for audit telemetry; player-facing UI stays focused on their own command.
    }
    if (this.runtime.state.phase === "finished") this.finishBattle();
    this.refreshInterface(false);
  }

  private syncEntityViews(initial: boolean): void {
    const alive = new Set(this.runtime.state.entities.map((entity) => entity.id));
    for (const [id, view] of this.unitViews) {
      if (alive.has(id)) continue;
      view.actor.play("death");
      this.tweens.add({ targets: view.actor.container, alpha: 0, duration: 380, onComplete: () => view.actor.destroy() });
      this.unitViews.delete(id);
      this.selectedIds.delete(id);
    }
    for (const [id, view] of this.entityViews) {
      if (alive.has(id)) continue;
      view.destroy();
      this.entityViews.delete(id);
      this.selectedIds.delete(id);
    }
    for (const entity of this.runtime.state.entities) {
      if (entity.kind === "unit") this.syncUnitView(entity, initial);
      else this.syncStaticView(entity);
    }
    this.sanitizeSelection();
  }

  private syncUnitView(entity: UnitEntityState, initial: boolean): void {
    let view = this.unitViews.get(entity.id);
    if (!view) {
      const artId = UNIT_ART[entity.typeId];
      if (this.failedArtIds.has(artId)) {
        if (performance.now() < (this.artRetryAt.get(artId) ?? Number.POSITIVE_INFINITY)) return;
        this.failedArtIds.delete(artId);
      }
      if (!this.isArtReady(artId)) {
        void this.ensureArtLoaded(artId)
          .then(() => {
            if (this.sys.isActive()) this.syncEntityViews(false);
          })
          .catch((error: unknown) => this.handleDynamicArtFailure(artId, error));
        return;
      }
      view = this.createUnitView(entity);
      this.unitViews.set(entity.id, view);
    }
    const target = gridToWorld(entity.position, VILLAGE_ASSAULT_ORIGIN);
    if (!initial && (view.grid.x !== entity.position.x || view.grid.y !== entity.position.y)) {
      view.actor.faceVector(entity.position.x - view.grid.x, entity.position.y - view.grid.y);
      this.tweens.killTweensOf(view.actor.container);
      this.tweens.add({ targets: view.actor.container, x: target.x, y: target.y, duration: 170, ease: "Sine.Out" });
    } else {
      view.actor.setPosition(target.x, target.y);
    }
    const action = this.actionForUnit(entity, view);
    if (action !== view.action) {
      view.actor.play(action, action !== "idle" && action !== "walk");
      view.action = action;
    }
    view.grid = { ...entity.position };
    view.hitPoints = entity.hitPoints;
    view.selection.setVisible(this.selectedIds.has(entity.id));
    this.drawUnitHealth(view.health, entity);
    const cargoGlyph = entity.cargo.kind ? ({ food: "糧", wood: "木", stone: "石" } as const)[entity.cargo.kind] : "";
    this.drawCargoPack(view.cargoPack, entity.cargo.kind, entity.cargo.amount, UNITS[entity.typeId].carryCapacity);
    view.cargoLabel.setText(entity.cargo.amount > 0 ? `${cargoGlyph}${entity.cargo.amount}/${UNITS[entity.typeId].carryCapacity}` : "").setVisible(entity.cargo.amount > 0);
    view.actor.container.setDepth(target.y + 100);
  }

  private syncStaticView(entity: BuildingEntityState | ResourceEntityState): void {
    let view = this.entityViews.get(entity.id);
    if (!view) {
      view = entity.kind === "building"
        ? createBuildingView(this, entity, entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID ? "player" : "enemy")
        : createResourceView(this, entity);
      this.entityViews.set(entity.id, view);
      view.setCompact(this.compactUi);
      this.uiCamera?.ignore(view.container);
      view.container.setInteractive({ useHandCursor: true }).setData("entityId", entity.id);
      view.container.on("pointerover", () => this.previewTacticalEntity(entity.id));
      view.container.on("pointermove", () => this.previewTacticalEntity(entity.id));
      view.container.on("pointerdown", (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.beginPointerGesture(pointer);
      });
      view.container.on("pointerup", (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.completeEntityGesture(entity.id, pointer);
      });
    }
    const cells = getEntityFootprintCells(entity);
    const center = cells.reduce((sum, cell) => ({ x: sum.x + cell.x, y: sum.y + cell.y }), { x: 0, y: 0 });
    const world = gridToWorld({ x: center.x / cells.length, y: center.y / cells.length }, VILLAGE_ASSAULT_ORIGIN);
    view.container.setPosition(world.x, world.y).setDepth(world.y + (entity.kind === "building" ? 80 : 20));
    view.update(entity, this.selectedIds.has(entity.id));
  }

  private createUnitView(entity: UnitEntityState): UnitView {
    const artId = UNIT_ART[entity.typeId];
    const world = gridToWorld(entity.position, VILLAGE_ASSAULT_ORIGIN);
    const actor = createFrameAnimatedCombatActor(this, {
      id: artId,
      x: world.x,
      y: world.y,
      facing: entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID ? "ne" : "sw",
      action: "idle",
      teamPalette: entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID ? this.playerPalette() : DEFAULT_TEAM_PALETTES.enemy,
    }, requireFrameAnimatedManifest(COMBAT_ANIMATION_MANIFEST, artId));
    const selection = this.add.graphics().lineStyle(3, 0xffdf83, 1).strokeEllipse(0, 2, artId === "boar_rider" ? 64 : 48, artId === "boar_rider" ? 26 : 20).setVisible(false);
    const health = this.add.graphics();
    const cargoPack = this.add.graphics().setPosition(23, -25).setVisible(false);
    const roleMark = entity.typeId === "villager" ? "⚒" : entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID ? "Ⅰ" : "Ⅱ";
    const label = this.add.text(0, 11, `${roleMark} ${UNIT_LABELS[entity.typeId]}`, {
      color: entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID ? "#e4efce" : "#ffd2c3",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "11px",
      fontStyle: "bold",
      stroke: "#101917",
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setResolution(2);
    label.setVisible(!this.compactUi);
    const cargoLabel = this.add.text(23, -44, "", {
      color: "#fff0b3",
      fontFamily: 'Consolas, "Noto Sans TC", monospace',
      fontSize: "10px",
      fontStyle: "bold",
      backgroundColor: "#101917d8",
      padding: { x: 3, y: 1 },
    }).setOrigin(0.5).setResolution(2).setVisible(false);
    actor.container.addAt(selection, 0);
    actor.container.add([health, cargoPack, label, cargoLabel]);
    actor.container.setSize(112, 136).setInteractive({ useHandCursor: true }).setData("entityId", entity.id);
    actor.container.on("pointerover", () => this.previewTacticalEntity(entity.id));
    actor.container.on("pointermove", () => this.previewTacticalEntity(entity.id));
    actor.container.on("pointerdown", (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.beginPointerGesture(pointer);
    });
    actor.container.on("pointerup", (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.completeEntityGesture(entity.id, pointer);
    });
    this.uiCamera?.ignore(actor.container);
    return { actor, selection, health, label, cargoPack, cargoLabel, grid: { ...entity.position }, hitPoints: entity.hitPoints, action: "idle" };
  }

  private actionForUnit(entity: UnitEntityState, view: UnitView): CombatAction {
    if (entity.hitPoints < view.hitPoints) return "hurt";
    if (entity.combat.phase === "windup" && entity.combat.action === "ability") return "cast";
    if (entity.combat.phase === "windup" && entity.combat.action === "attack") return "attack";
    if (entity.order.type === "attack") return "attack";
    if (entity.order.type === "construct") return "cast";
    if (entity.order.type === "gather") {
      if (entity.order.phase === "toDropOff") return "walk";
      const target = this.entityById(entity.order.targetId);
      if (target?.kind === "resource" && target.amount <= 0) return "idle";
      return target && this.isAdjacentToEntity(entity.position, target) ? "attack" : "walk";
    }
    if (entity.order.type === "deliver" || entity.order.type === "move" || entity.order.type === "attackMove" || entity.order.type === "patrol" || entity.order.type === "repair") return "walk";
    return "idle";
  }

  private updateUnitAnimations(deltaMs: number): void {
    for (const view of this.unitViews.values()) view.actor.update(deltaMs);
  }

  private renderCombatEvents(events: readonly DomainEvent[]): void {
    for (const event of events) {
      if (event.type === "projectileSpawned") {
        const from = gridToWorld(event.projectile.position, VILLAGE_ASSAULT_ORIGIN);
        const to = gridToWorld(event.projectile.targetPoint, VILLAGE_ASSAULT_ORIGIN);
        const kind = event.projectile.profileId.includes("musket") ? "musket"
          : event.projectile.profileId.includes("arcane") ? "arcane"
            : event.projectile.profileId.toLowerCase().includes("bolt") ? "bolt" : "arrow";
        const durationMs = Math.max(40, (event.projectile.impactTick - this.runtime.state.tick) * TICK_MILLISECONDS);
        let effect!: Phaser.GameObjects.Container;
        effect = launchProjectile(this, {
          from,
          to,
          kind,
          durationMs,
          spawnImpactOnComplete: false,
          onImpact: () => this.projectileEffects.delete(event.projectile.id),
        });
        this.projectileEffects.set(event.projectile.id, effect);
        this.uiCamera?.ignore(effect);
      } else if (event.type === "projectileImpacted") {
        const effect = this.projectileEffects.get(event.projectileId);
        if (effect) {
          this.tweens.killTweensOf(effect);
          effect.destroy();
          this.projectileEffects.delete(event.projectileId);
        }
        const world = gridToWorld(event.position, VILLAGE_ASSAULT_ORIGIN);
        spawnImpactBurst(this, world);
      } else if (event.type === "entityDamaged") {
        const target = this.entityById(event.targetId);
        if (!target) continue;
        const world = gridToWorld(target.position, VILLAGE_ASSAULT_ORIGIN);
        const text = spawnFloatingText(this, { x: world.x, y: world.y - 42 }, `-${event.amount}`, "#ffd0ad");
        this.uiCamera?.ignore(text);
      } else if (event.type === "statusApplied") {
        const target = this.entityById(event.targetId);
        if (!target) continue;
        const world = gridToWorld(target.position, VILLAGE_ASSAULT_ORIGIN);
        const telegraph = spawnSkillTelegraph(this, world, 0xe0b866, 30, 360);
        this.uiCamera?.ignore(telegraph);
      }
    }
  }

  private handleEntityTap(id: string, pointer: Phaser.Input.Pointer): void {
    if (this.ended || this.paused) return;
    const entity = this.entityById(id);
    if (!entity) return;
    if (this.tacticalUiMode.kind !== "none") {
      this.commitTacticalTarget(entity.position, entity);
      return;
    }
    if (this.productionUiMode.kind === "rally") {
      this.setNotice("集結點必須設在可通行的空地；目前仍在選點模式。", "warning");
      return;
    }
    if (this.productionUiMode.kind !== "none" && this.productionUiMode.producerId !== entity.id) {
      this.productionUiMode = { kind: "none" };
    }
    if (this.buildingPlacement) {
      this.setNotice("建造位置被單位或資源占用", "warning");
      return;
    }
    const selectedUnits = this.selectedUnits();
    const selectedVillagers = selectedUnits.filter((unit) => unit.typeId === "villager");
    const selectedMilitary = selectedUnits.filter((unit) => unit.typeId !== "villager");
    if (entity.kind === "building" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.complete) {
      const accepted = BUILDINGS[entity.typeId].dropOffResources ?? [];
      const carriers = selectedVillagers.filter((unit) => (
        unit.cargo.kind !== null
        && unit.cargo.amount > 0
        && accepted.includes(unit.cargo.kind)
        && this.approachDistance(unit.position, entity) !== null
      ));
      if (carriers.length > 0) {
        this.issue({ type: "dropOff", entityIds: carriers.map((unit) => unit.id), targetId: entity.id }, `將材料送往${buildingDisplayName(entity.typeId)}`);
        return;
      }
    }
    if (entity.kind === "resource" && entity.amount <= 0 && entity.renewAtTick !== null) {
      this.selectedIds.clear();
      this.selectedIds.add(entity.id);
      this.refreshSelectionViews();
      this.refreshInterface(true);
      this.setNotice("糧田正在休耕，選取資訊會顯示復育倒數", "warning");
      return;
    }
    if (entity.kind === "resource" && selectedVillagers.length > 0) {
      const gatherers = selectedVillagers.filter((unit) => {
        const capacity = UNITS[unit.typeId].carryCapacity;
        const depositKind = unit.cargo.amount > 0 && (unit.cargo.kind !== entity.typeId || unit.cargo.amount >= capacity)
          ? unit.cargo.kind
          : entity.typeId;
        return this.approachDistance(unit.position, entity) !== null
          && depositKind !== null
          && this.nearestDropOff(unit.position, depositKind) !== null;
      });
      if (gatherers.length === 0) {
        this.setNotice("所選工匠目前無法到達資源或合法卸貨點", "warning");
        return;
      }
      const skipped = selectedVillagers.length - gatherers.length;
      this.issue(
        { type: "gather", entityIds: gatherers.map((unit) => unit.id), targetId: entity.id },
        skipped > 0
          ? `${gatherers.length} 名工匠前往採集；${skipped} 名因路線受阻保留原指令`
          : `工匠前往採集${resourceDisplayName(entity.typeId)}`,
      );
      return;
    }
    if (entity.ownerId === VILLAGE_ASSAULT_AI_ID && selectedMilitary.length > 0) {
      this.issue({ type: "attack", entityIds: selectedMilitary.map((unit) => unit.id), targetId: entity.id }, `進攻 ${this.entityDisplayName(entity)}`);
      return;
    }
    if (entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID) {
      const additive = pointer.event.shiftKey;
      if (!additive) this.selectedIds.clear();
      if (additive && this.selectedIds.has(entity.id)) this.selectedIds.delete(entity.id);
      else this.selectedIds.add(entity.id);
      this.buildMenuOpen = false;
      this.researchMenuOpen = false;
      this.researchPage = 0;
      this.productionUiMode = { kind: "none" };
      this.buildingPlacement = null;
      this.systemPanelOpen = false;
      this.refreshSelectionViews();
      this.refreshInterface(true);
      return;
    }
    this.selectedIds.clear();
    this.selectedIds.add(entity.id);
    this.refreshSelectionViews();
    this.refreshInterface(true);
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.rightButtonDown()) {
      this.handleGroundCommand(pointer);
      return;
    }
    this.beginPointerGesture(pointer);
  };

  private beginPointerGesture(pointer: Phaser.Input.Pointer): void {
    this.pointerStart = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
    this.pointerDragged = false;
  }

  private completeEntityGesture(entityId: string, pointer: Phaser.Input.Pointer): void {
    if (!this.pointerDragged) this.handleEntityTap(entityId, pointer);
    this.pointerStart = undefined;
    this.pointerDragged = false;
  }

  private previewTacticalEntity(entityId: string): void {
    if (this.tacticalUiMode.kind === "none") return;
    const entity = this.entityById(entityId);
    if (!entity) return;
    this.hoverEntityId = entityId;
    this.hoverGrid = { ...entity.position };
    this.drawTacticalMarker(this.hoverGrid, this.isTacticalTargetValid(this.hoverGrid, entity));
  }

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[] = []): void => {
    if (this.tacticalUiMode.kind !== "none") {
      this.hoverGrid = this.pointerGrid(pointer);
      this.hoverEntityId = currentlyOver
        .map((object) => object.getData?.("entityId") as string | undefined)
        .find((entityId): entityId is string => Boolean(entityId)) ?? null;
      const hoverEntity = this.hoverEntityId ? this.entityById(this.hoverEntityId) ?? null : null;
      this.drawTacticalMarker(this.hoverGrid, this.isTacticalTargetValid(this.hoverGrid, hoverEntity));
    } else if (this.productionUiMode.kind === "rally") {
      this.hoverGrid = this.pointerGrid(pointer);
      this.drawRallyMarker(this.hoverGrid, isRallyPointAvailable(this.runtime.state, this.productionUiMode.producerId, this.hoverGrid), true);
    } else if (this.buildingPlacement) {
      this.hoverGrid = this.pointerGrid(pointer);
      const cells = getFootprintCells(this.hoverGrid, BUILDINGS[this.buildingPlacement].footprint);
      const occupied = new Set(getOccupiedMapCells(this.runtime.state).map((cell) => `${cell.x},${cell.y}`));
      const validCells = cells.map((cell) => isSettlementBuildable(cell) && !occupied.has(`${cell.x},${cell.y}`));
      drawPlacementFootprint(this.settlementOverlay?.placement ?? this.add.graphics(), cells, validCells);
    }
    if (!pointer.isDown || !this.pointerStart) return;
    const dx = pointer.x - this.pointerStart.x;
    const dy = pointer.y - this.pointerStart.y;
    if (!this.pointerDragged && Math.hypot(dx, dy) < 10) return;
    this.pointerDragged = true;
    const camera = this.cameras.main;
    camera.scrollX = this.pointerStart.scrollX - dx / camera.zoom;
    camera.scrollY = this.pointerStart.scrollY - dy / camera.zoom;
  };

  private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.rightButtonReleased()) return;
    if (!this.pointerStart) {
      this.pointerDragged = false;
      return;
    }
    if (!this.pointerDragged) this.handleGroundCommand(pointer);
    this.pointerStart = undefined;
    this.pointerDragged = false;
  };

  private handleGroundCommand(pointer: Phaser.Input.Pointer): void {
    if (this.ended || this.paused) return;
    const point = this.pointerGrid(pointer);
    if (this.tacticalUiMode.kind !== "none") {
      this.commitTacticalTarget(point, null);
      return;
    }
    if (this.productionUiMode.kind === "rally") {
      const producerId = this.productionUiMode.producerId;
      if (!isRallyPointAvailable(this.runtime.state, producerId, point)) {
        this.setNotice("此處無法作為集結點；請選擇可通行且可抵達的空地。", "warning");
        this.drawRallyMarker(point, false, true);
        return;
      }
      if (this.issue({ type: "setRallyPoint", producerId, target: point }, `集結旗已設於 ${point.x},${point.y}`)) {
        this.productionUiMode = { kind: "none" };
        this.hoverGrid = null;
        this.refreshRallyOverlay();
      }
      return;
    }
    if (this.buildingPlacement) {
      const villagers = this.selectedUnits().filter((unit) => unit.typeId === "villager");
      if (villagers.length === 0) {
        this.cancelBuildPlacement("需要先選取工匠");
        return;
      }
      if (!this.canBuildAt(point)) {
        this.setNotice("此處不可建造：避開河道、岩地與既有物件", "warning");
        return;
      }
      const buildingType = this.buildingPlacement;
      const result = this.issue({ type: "build", builderIds: villagers.map((unit) => unit.id), buildingType, origin: point }, `開始建造 ${buildingDisplayName(buildingType)}`);
      if (result) this.cancelBuildPlacement();
      return;
    }
    const units = this.selectedUnits();
    if (units.length > 0) {
      this.issue({ type: "move", entityIds: units.map((unit) => unit.id), target: point }, `移動 ${units.length} 個單位`);
    } else {
      this.selectedIds.clear();
      this.refreshSelectionViews();
      this.refreshInterface(true);
    }
  }

  private issue(command: GameCommand, success: string): boolean {
    const result = this.runtime.issuePlayerCommand(command);
    if (!result.accepted) {
      this.setNotice(this.rejectMessage(result.rejectCode), "warning");
      this.refreshInterface(true);
      return false;
    }
    this.setNotice(success, "success");
    this.syncEntityViews(false);
    this.refreshInterface(true);
    return true;
  }

  private createInterface(): void {
    this.noticeLiveRegion = document.createElement("output");
    this.noticeLiveRegion.className = "canvas-control-proxy";
    this.noticeLiveRegion.setAttribute("role", "status");
    this.noticeLiveRegion.setAttribute("aria-live", "polite");
    (this.game.canvas.parentElement ?? document.body).append(this.noticeLiveRegion);
    const topPanel = this.add.graphics();
    topPanel.fillStyle(0x0b1311, 0.94).fillRect(0, 0, UI_WIDTH, 80);
    topPanel.fillStyle(0x25483c, 0.98).fillRect(6, 6, UI_WIDTH - 12, 68);
    topPanel.lineStyle(3, 0xe0b866, 0.92).strokeRect(0, 0, UI_WIDTH, 80);
    this.resourceText = this.add.text(24, 15, "", {
      color: "#f0ebcf",
      fontFamily: "Consolas, monospace",
      fontSize: "22px",
      fontStyle: "bold",
    }).setResolution(2);
    this.objectiveText = this.add.text(330, 13, "", {
      color: "#dce9c6",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "20px",
      fontStyle: "bold",
      wordWrap: { width: 300 },
    }).setResolution(2);
    this.noticeText = this.add.text(UI_WIDTH - 24, 14, "", {
      align: "right",
      color: "#e0b866",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "18px",
      fontStyle: "bold",
      wordWrap: { width: 220 },
    }).setOrigin(1, 0).setResolution(2);
    this.topRoot = this.add.container(0, 0, [topPanel, this.resourceText, this.objectiveText, this.noticeText]).setScrollFactor(0).setDepth(100_000);

    const actionPanel = this.add.graphics();
    actionPanel.fillStyle(0x0a100e, 0.96).fillRect(0, 0, UI_WIDTH, ACTION_PANEL_HEIGHT);
    actionPanel.fillStyle(0x172d28, 0.98).fillRect(7, 7, UI_WIDTH - 14, ACTION_PANEL_HEIGHT - 14);
    actionPanel.lineStyle(3, 0xd2c383, 0.9).strokeRect(0, 0, UI_WIDTH, ACTION_PANEL_HEIGHT);
    this.selectionText = this.add.text(22, 10, "未選取｜點我方工匠或建築", {
      color: "#f0ebcf",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "20px",
      fontStyle: "bold",
    }).setResolution(2);
    this.actionRoot = this.add.container(0, 0, [actionPanel, this.selectionText]).setScrollFactor(0).setDepth(100_000);
    for (let index = 0; index < 7; index += 1) {
      const button = createCanvasButton(this, {
        width: UI_BUTTON_WIDTH,
        height: UI_BUTTON_HEIGHT,
        glyph: "·",
        label: "—",
        name: `assault-action-${index + 1}`,
        compact: true,
      }, () => this.currentActions[index]?.run());
      button.container.setPosition(22 + UI_BUTTON_WIDTH / 2 + index * (UI_BUTTON_WIDTH + UI_GAP), 94).setScrollFactor(0);
      this.actionRoot.add(button.container);
      this.actionButtons.push(button);
    }
    this.rotateRoot = this.createRotatePrompt();
    this.cameras.main.ignore([this.topRoot, this.actionRoot, this.rotateRoot]);
  }

  private refreshInterface(force: boolean): void {
    if (!this.runtime) return;
    if (!force && this.lastUiTick === this.runtime.state.tick) return;
    this.lastUiTick = this.runtime.state.tick;
    this.sanitizeProductionMode();
    const player = this.playerState();
    const tierLabel = SETTLEMENT_TIER_LABELS[player.settlementTier];
    this.resourceText?.setFontSize(this.compactUi ? 20 : 22).setText(this.compactUi
      ? `${tierLabel}｜糧${Math.floor(player.resources.food)} 木${Math.floor(player.resources.wood)}\n石${Math.floor(player.resources.stone)} 人${player.population.used}/${player.population.capacity}`
      : `${tierLabel}  糧 ${Math.floor(player.resources.food)}   木 ${Math.floor(player.resources.wood)}   石 ${Math.floor(player.resources.stone)}   人口 ${player.population.used}/${player.population.capacity}`);
    const enemyTown = this.runtime.state.entities.find((entity) => entity.kind === "building" && entity.ownerId === VILLAGE_ASSAULT_AI_ID && entity.typeId === "townCenter");
    const rebuild = this.runtime.state.teamTownCenterLostAt.find((entry) => entry.teamId === "team-ai");
    this.objectiveText?.setText(enemyTown
      ? this.compactUi
        ? `敵城 ${Math.ceil(enemyTown.hitPoints / enemyTown.maxHitPoints * 100)}%`
        : `目標｜建立經濟與軍隊，摧毀東境議事堂　敵城 ${enemyTown.hitPoints}/${enemyTown.maxHitPoints}`
      : `敵方主城已毀｜撐過重建期限 ${Math.max(0, Math.ceil((TOWN_CENTER_REBUILD_GRACE_TICKS - (this.runtime.state.tick - (rebuild?.tick ?? this.runtime.state.tick))) / TICKS_PER_SECOND))} 秒`);
    if (performance.now() > this.noticeUntil) this.notice = "點空地移動｜點資源採集｜滿載自動卸貨｜點敵軍攻擊";
    this.noticeText?.setText(this.compactUi ? "" : this.paused ? "戰局暫停" : this.notice);
    const selected = this.selectedEntities();
    const selectionLabel = this.selectionLabel(selected);
    this.selectionText?.setText(this.compactUi && performance.now() <= this.noticeUntil ? this.compactNotice(this.notice) : selectionLabel);
    this.currentActions = this.actionsForSelection(selected);
    this.actionButtons.forEach((button, index) => {
      const spec = this.currentActions[index];
      button.setVisible(Boolean(spec));
      button.setActive(spec?.active ?? null);
      if (!spec) return;
      button.setLabel(spec.glyph, spec.label, spec.accessibleLabel);
      button.setEnabled(spec.enabled ?? true);
    });
    this.refreshRallyOverlay();
  }

  private actionsForSelection(selected: readonly EntityState[]): readonly ActionSpec[] {
    if (this.ended) return [
      { glyph: "↻", label: "再戰", run: () => this.restartBattle() },
      { glyph: "⌂", label: "返回", run: () => this.leaveBattle() },
    ];
    if (this.systemPanelOpen) {
      return [
        { glyph: "↻", label: "重新開始", run: () => this.restartBattle() },
        { glyph: this.paused ? "▶" : "Ⅱ", label: this.paused ? "繼續" : "暫停", run: () => this.togglePause() },
        this.zoomAction(-0.12),
        this.zoomAction(0.12),
        this.fullscreenAction(),
        { glyph: "⌂", label: "離開戰役", run: () => this.leaveBattle() },
        { glyph: "←", label: "返回", run: () => { this.systemPanelOpen = false; this.refreshInterface(true); } },
      ];
    }
    const ownUnits = selected.filter((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID);
    const ownBuilding = selected.length === 1 && selected[0]?.kind === "building" && selected[0].ownerId === VILLAGE_ASSAULT_PLAYER_ID ? selected[0] : undefined;
    if (this.productionUiMode.kind === "confirm") return this.productionConfirmActions(this.productionUiMode);
    if (this.productionUiMode.kind === "queue") return this.productionQueueActions(this.productionUiMode);
    if (this.productionUiMode.kind === "rally") return this.rallyPlacementActions(this.productionUiMode.producerId);
    if (this.buildingPlacement) {
      return [
        { glyph: "✓", label: "點地圖放置", enabled: false, run: () => undefined },
        { glyph: "←", label: "返回建築表", run: () => this.cancelBuildPlacement("請重新選擇建築", true) },
        this.zoomAction(-0.12),
        this.zoomAction(0.12),
        this.systemAction(),
      ];
    }
    if (this.buildMenuOpen) {
      const entries = [...(BUILD_PAGES[this.buildPage] ?? BUILD_PAGES[0]!).map((type) => this.buildAction(type))];
      while (entries.length < 4) entries.push({ glyph: "·", label: "預留工位", enabled: false, run: () => undefined });
      return [
        ...entries,
        { glyph: "←", label: "返回指令", run: () => this.closeBuildMenu() },
        this.buildPage < BUILD_PAGES.length - 1
          ? { glyph: "→", label: `下一頁 ${this.buildPage + 2}/3`, run: () => { this.buildPage += 1; this.refreshInterface(true); } }
          : { glyph: "⌂", label: "回首頁 1/3", run: () => { this.buildPage = 0; this.refreshInterface(true); } },
        this.systemAction(),
      ];
    }
    if (this.researchMenuOpen && ownBuilding) {
      const technologies = TECHNOLOGY_ORDER.filter((technologyId) => TECHNOLOGIES[technologyId].producer === ownBuilding.typeId);
      const pageCount = Math.max(1, Math.ceil(technologies.length / 4));
      this.researchPage = Math.min(this.researchPage, pageCount - 1);
      const entries: ActionSpec[] = technologies
        .slice(this.researchPage * 4, this.researchPage * 4 + 4)
        .map((technologyId) => this.researchAction(ownBuilding, technologyId));
      while (entries.length < 4) entries.push({ glyph: "·", label: "無研究", enabled: false, run: () => undefined });
      return [
        ...entries,
        { glyph: "←", label: "返回指令", run: () => this.closeResearchMenu() },
        pageCount > 1
          ? { glyph: "→", label: `下一頁 ${(this.researchPage + 1) % pageCount + 1}/${pageCount}`, run: () => { this.researchPage = (this.researchPage + 1) % pageCount; this.refreshInterface(true); } }
          : { glyph: "頁", label: "研究 1/1", enabled: false, run: () => undefined },
        this.systemAction(),
      ];
    }
    if (this.researchMenuOpen) {
      this.researchMenuOpen = false;
      this.researchPage = 0;
    }
    if (ownBuilding) {
      const trainable = (Object.keys(UNITS) as UnitType[]).filter((type) => UNITS[type].producers.includes(ownBuilding.typeId));
      const researchable = TECHNOLOGY_ORDER.filter((technologyId) => TECHNOLOGIES[technologyId].producer === ownBuilding.typeId);
      const primary: ActionSpec[] = [
        ...trainable.map((type) => this.trainAction(ownBuilding, type)),
        ...(ownBuilding.typeId === "townCenter" ? [this.advanceSettlementAction(ownBuilding)] : []),
        ...(researchable.length > 0 ? [this.openResearchAction(ownBuilding, researchable)] : []),
        this.selectWorkersAction(),
        this.selectArmyAction(),
        { glyph: "⌖", label: "置中建築", run: () => this.centerCameraOn(ownBuilding.position) },
        this.zoomAction(-0.12),
      ];
      const primaryActionCount = trainable.length + (ownBuilding.typeId === "townCenter" ? 1 : 0) + (researchable.length > 0 ? 1 : 0);
      primary.splice(primaryActionCount);
      while (primary.length < 4) primary.push({ glyph: "·", label: "空欄", enabled: false, run: () => undefined });
      const canManageQueue = trainable.length > 0 || researchable.length > 0 || ownBuilding.productionQueue.length > 0;
      return [
        ...primary.slice(0, 4),
        canManageQueue
          ? {
              glyph: "列",
              label: `佇列 ${ownBuilding.productionQueue.length}/${MAX_TRAINING_QUEUE_DEPTH}`,
              accessibleLabel: `${buildingDisplayName(ownBuilding.typeId)}生產佇列，共${ownBuilding.productionQueue.length}項`,
              run: () => this.openProductionQueue(ownBuilding.id),
            }
          : { glyph: "◎", label: "置中", run: () => this.centerCameraOn(ownBuilding.position) },
        trainable.length > 0
          ? {
              glyph: "⚑",
              label: ownBuilding.rallyPoint ? "改集結" : "設集結",
              accessibleLabel: ownBuilding.rallyPoint
                ? `變更集結點，目前${ownBuilding.rallyPoint.x},${ownBuilding.rallyPoint.y}`
                : `設定${buildingDisplayName(ownBuilding.typeId)}集結點`,
              run: () => this.openRallyPlacement(ownBuilding.id),
            }
          : { glyph: "◎", label: "置中", run: () => this.centerCameraOn(ownBuilding.position) },
        this.systemAction(),
      ];
    }
    if (ownUnits.length > 0) {
      const military = ownUnits.filter((unit): unit is UnitEntityState & { typeId: CombatUnitId } => unit.typeId !== "villager");
      if (military.length === ownUnits.length) {
        const entityIds = military.map((unit) => unit.id);
        return [
          { glyph: "⚔", label: "攻擊移動", active: this.tacticalUiMode.kind === "attackMove", run: () => this.tacticalUiMode.kind === "attackMove" ? this.cancelTacticalMode("已取消攻擊移動選點") : this.openTacticalMode({ kind: "attackMove", entityIds }) },
          { glyph: "巡", label: "巡邏", active: this.tacticalUiMode.kind === "patrol", run: () => this.tacticalUiMode.kind === "patrol" ? this.cancelTacticalMode("已取消巡邏選點") : this.openTacticalMode({ kind: "patrol", entityIds, firstPoint: null }) },
          this.formationAction(military),
          this.stanceAction(military),
          this.abilityAction(military),
          { glyph: "■", label: "停止", run: () => { this.cancelTacticalMode(); this.issue({ type: "stop", entityIds }, "單位停止目前命令"); } },
          this.systemAction(),
        ];
      }
      const hasVillager = ownUnits.some((unit) => unit.typeId === "villager");
      const unload = this.dropOffAction(ownUnits);
      const contextual: ActionSpec[] = [
        ...(hasVillager ? [{ glyph: "⌂", label: "建造", run: () => this.openBuildMenu() } satisfies ActionSpec] : []),
        ...(unload ? [unload] : []),
        ...(hasVillager ? [{ glyph: "修", label: "修復", active: this.tacticalUiMode.kind === "repair", run: () => this.tacticalUiMode.kind === "repair" ? this.cancelTacticalMode("已取消修復選取") : this.openTacticalMode({ kind: "repair", entityIds: ownUnits.filter((unit) => unit.typeId === "villager").map((unit) => unit.id) }) } satisfies ActionSpec] : []),
        { glyph: "■", label: "停止", run: () => { this.cancelTacticalMode(); this.issue({ type: "stop", entityIds: ownUnits.map((unit) => unit.id) }, "單位停止目前工作"); } },
        this.selectWorkersAction(),
        this.selectArmyAction(),
        { glyph: "Ⅱ", label: this.paused ? "繼續" : "暫停", run: () => this.togglePause() },
        this.zoomAction(-0.12),
      ];
      return [...contextual.slice(0, 6), this.systemAction()];
    }
    return [
      this.selectWorkersAction(),
      this.selectArmyAction(),
      { glyph: "⌖", label: "回主城", run: () => this.centerCameraOn({ x: 3, y: 8 }) },
      { glyph: "Ⅱ", label: this.paused ? "繼續" : "暫停", run: () => this.togglePause() },
      this.zoomAction(-0.12),
      this.zoomAction(0.12),
      this.systemAction(),
    ];
  }

  private openProductionQueue(producerId: string): void {
    this.tacticalUiMode = { kind: "none" };
    this.productionUiMode = { kind: "queue", producerId, page: 0 };
    this.buildMenuOpen = false;
    this.researchMenuOpen = false;
    this.buildingPlacement = null;
    this.hoverGrid = null;
    this.setNotice("已開啟生產佇列；選取工作後再確認取消。", "normal");
    this.refreshInterface(true);
  }

  private openRallyPlacement(producerId: string): void {
    this.tacticalUiMode = { kind: "none" };
    this.productionUiMode = { kind: "rally", producerId };
    this.buildMenuOpen = false;
    this.researchMenuOpen = false;
    this.buildingPlacement = null;
    this.hoverGrid = null;
    this.setNotice("點選地圖空地設定集結旗；拖曳地圖不會送出指令。", "normal");
    this.refreshInterface(true);
  }

  private productionQueueActions(mode: Extract<ProductionUiMode, { kind: "queue" }>): readonly ActionSpec[] {
    const producer = this.entityById(mode.producerId);
    if (!producer || producer.kind !== "building") return [];
    const pageCount = Math.max(1, Math.ceil(producer.productionQueue.length / 4));
    const page = Math.min(mode.page, pageCount - 1);
    const entries: ActionSpec[] = producer.productionQueue.slice(page * 4, page * 4 + 4).map((job, localIndex) => {
      const queueIndex = page * 4 + localIndex;
      const name = this.productionJobName(job);
      const progress = queueIndex === 0 ? Math.floor((1 - job.remainingTicks / Math.max(1, job.totalTicks)) * 100) : 0;
      return {
        glyph: job.kind === "train" ? "兵" : "研",
        label: queueIndex === 0 ? `${queueIndex + 1}.${name} ${progress}%` : `${queueIndex + 1}.${name} 等待`,
        accessibleLabel: `生產佇列第${queueIndex + 1}項，${name}，${queueIndex === 0 ? `完成${progress}%` : "等待中"}；選取以取消`,
        run: () => {
          this.productionUiMode = { kind: "confirm", producerId: producer.id, jobId: { ...job.jobId }, page };
          this.refreshInterface(true);
        },
      };
    });
    while (entries.length < 4) entries.push({ glyph: "·", label: "空佇列", enabled: false, run: () => undefined });
    return [
      ...entries,
      { glyph: "↩", label: "返回指令", run: () => { this.productionUiMode = { kind: "none" }; this.refreshInterface(true); } },
      pageCount > 1
        ? { glyph: "頁", label: `${page + 1}/${pageCount} 下一頁`, run: () => { this.productionUiMode = { kind: "queue", producerId: producer.id, page: (page + 1) % pageCount }; this.refreshInterface(true); } }
        : { glyph: "頁", label: "1/1", enabled: false, run: () => undefined },
      this.systemAction(),
    ];
  }

  private productionConfirmActions(mode: Extract<ProductionUiMode, { kind: "confirm" }>): readonly ActionSpec[] {
    const producer = this.entityById(mode.producerId);
    if (!producer || producer.kind !== "building") return [];
    const job = producer.productionQueue.find((candidate) => this.sameProductionJobId(candidate.jobId, mode.jobId));
    if (!job) return this.productionQueueActions({ kind: "queue", producerId: producer.id, page: mode.page });
    const queueIndex = producer.productionQueue.indexOf(job);
    const refund = this.productionRefund(job);
    const name = this.productionJobName(job);
    return [
      {
        glyph: job.kind === "train" ? "兵" : "研",
        label: `第${queueIndex + 1}項 ${name}`,
        accessibleLabel: `已選取生產佇列第${queueIndex + 1}項，${name}`,
        enabled: false,
        run: () => undefined,
      },
      {
        glyph: "退",
        label: `確認取消 ${this.shortCost(refund) || "不退款"}`,
        accessibleLabel: `確認取消${name}，返還${this.spokenCost(refund) || "零資源"}`,
        run: () => {
          this.productionUiMode = { kind: "queue", producerId: producer.id, page: mode.page };
          this.issue({ type: "cancelProduction", producerId: producer.id, jobId: { ...job.jobId } }, `已取消 ${name}`);
        },
      },
      { glyph: "留", label: "保留工作", run: () => { this.productionUiMode = { kind: "queue", producerId: producer.id, page: mode.page }; this.refreshInterface(true); } },
      { glyph: "·", label: "先確認再取消", enabled: false, run: () => undefined },
      { glyph: "↩", label: "返回佇列", run: () => { this.productionUiMode = { kind: "queue", producerId: producer.id, page: mode.page }; this.refreshInterface(true); } },
      { glyph: "頁", label: `${mode.page + 1}/${Math.max(1, Math.ceil(producer.productionQueue.length / 4))}`, enabled: false, run: () => undefined },
      this.systemAction(),
    ];
  }

  private rallyPlacementActions(producerId: string): readonly ActionSpec[] {
    const producer = this.entityById(producerId);
    if (!producer || producer.kind !== "building") return [];
    return [
      { glyph: "☝", label: "點地圖設定", enabled: false, run: () => undefined },
      {
        glyph: "清",
        label: "清除集結",
        enabled: producer.rallyPoint !== null,
        run: () => {
          if (this.issue({ type: "setRallyPoint", producerId, target: null }, "已清除集結點")) {
            this.productionUiMode = { kind: "none" };
            this.hoverGrid = null;
          }
        },
      },
      { glyph: "◎", label: "置中建築", run: () => this.centerCameraOn(producer.position) },
      { glyph: "座", label: producer.rallyPoint ? `${producer.rallyPoint.x},${producer.rallyPoint.y}` : "尚未設定", enabled: false, run: () => undefined },
      { glyph: "↩", label: "返回指令", run: () => { this.productionUiMode = { kind: "none" }; this.hoverGrid = null; this.refreshInterface(true); } },
      { glyph: "⚑", label: "設定中", enabled: false, run: () => undefined },
      this.systemAction(),
    ];
  }

  private productionJobName(job: BuildingEntityState["productionQueue"][number]): string {
    return job.kind === "train" ? this.shortUnitName(job.unitType) : TECHNOLOGIES[job.technologyId].displayName;
  }

  private productionRefund(job: BuildingEntityState["productionQueue"][number]): ResourceWallet {
    const remaining = Math.max(0, Math.min(job.totalTicks, job.remainingTicks));
    const refund = (amount: number): number => Math.floor(amount * remaining / Math.max(1, job.totalTicks));
    return { food: refund(job.paidCost.food), wood: refund(job.paidCost.wood), stone: refund(job.paidCost.stone) };
  }

  private sameProductionJobId(left: ProductionJobId, right: ProductionJobId): boolean {
    return left.commandSequence === right.commandSequence && left.itemIndex === right.itemIndex;
  }

  private buildAction(type: BuildingType): ActionSpec {
    const definition = BUILDINGS[type];
    const unlocked = this.hasReachedTier(definition.requiredTier);
    const affordable = this.canAfford(definition.cost);
    return {
      glyph: unlocked ? ({
        townCenter: "城", house: "屋", lumberCamp: "木", farmstead: "糧", barracks: "兵", defenseTower: "塔",
        archeryRange: "弓", mageSanctum: "法", gunWorkshop: "銃", beastStable: "獸", siegeWorkshop: "械",
      } satisfies Record<BuildingType, string>)[type] : "鎖",
      label: unlocked
        ? `${this.shortBuildingName(type)} ${this.shortCost(definition.cost)}`
        : `${this.shortBuildingName(type)} 需${SETTLEMENT_TIER_SHORT_LABELS[definition.requiredTier]}期`,
      accessibleLabel: unlocked
        ? `建造 ${buildingDisplayName(type)}`
        : `${buildingDisplayName(type)}尚未解鎖，需要${SETTLEMENT_TIER_LABELS[definition.requiredTier]}`,
      enabled: unlocked && affordable,
      run: () => {
        this.productionUiMode = { kind: "none" };
        this.buildingPlacement = type;
        this.buildMenuOpen = false;
        this.setNotice(`選擇 ${buildingDisplayName(type)} 的建造位置`, "success");
        this.refreshInterface(true);
      },
    };
  }

  private trainAction(producer: BuildingEntityState, type: UnitType): ActionSpec {
    const definition = UNITS[type];
    const player = this.playerState();
    const artId = UNIT_ART[type];
    const loading = this.pendingArtIds.has(artId);
    const unlocked = this.hasReachedTier(definition.requiredTier);
    const enabled = unlocked && !loading && producer.complete && player.advancement?.producerId !== producer.id && producer.productionQueue.length < MAX_TRAINING_QUEUE_DEPTH && this.canAfford(definition.cost) && player.population.used + definition.population <= player.population.capacity;
    return {
      glyph: unlocked ? ({ villager: "工", warrior: "劍", shieldBearer: "盾", archer: "弓", mage: "法", musketeer: "銃", boarRider: "豬", heavyCrossbowman: "弩" } satisfies Record<UnitType, string>)[type] : "鎖",
      label: !unlocked
        ? `${this.shortUnitName(type)} 需${SETTLEMENT_TIER_SHORT_LABELS[definition.requiredTier]}期`
        : loading ? `${this.shortUnitName(type)} 載入中` : `${this.shortUnitName(type)} ${this.shortCost(definition.cost)}`,
      accessibleLabel: unlocked
        ? `訓練${UNIT_LABELS[type]}`
        : `${UNIT_LABELS[type]}尚未解鎖，需要${SETTLEMENT_TIER_LABELS[definition.requiredTier]}`,
      enabled,
      run: () => this.queueTrainAfterArt(producer.id, type),
    };
  }

  private openResearchAction(producer: BuildingEntityState, technologyIds: readonly TechnologyType[]): ActionSpec {
    const completed = technologyIds.filter((technologyId) => this.playerState().completedTechnologyIds.includes(technologyId)).length;
    const queuedIndex = producer.productionQueue.findIndex((job) => job.kind === "research" && technologyIds.includes(job.technologyId));
    const queued = queuedIndex >= 0 ? producer.productionQueue[queuedIndex] : undefined;
    const queuedTechnology = queued?.kind === "research" ? TECHNOLOGIES[queued.technologyId] : undefined;
    const progress = queuedIndex === 0 && queued?.kind === "research" && queuedTechnology
      ? Math.round(Phaser.Math.Clamp(1 - queued.remainingTicks / queuedTechnology.researchTicks, 0, 1) * 100)
      : null;
    return {
      glyph: queuedTechnology ? queuedIndex === 0 ? "◴" : `${queuedIndex + 1}` : completed === technologyIds.length ? "✓" : "研",
      label: queuedTechnology ? queuedIndex === 0 ? `研究 ${progress}%` : `研究 佇列${queuedIndex + 1}` : `研究 ${completed}/${technologyIds.length}`,
      accessibleLabel: queuedTechnology
        ? queuedIndex === 0
          ? `${queuedTechnology.displayName}研究進度百分之${progress}`
          : `${queuedTechnology.displayName}位於生產佇列第${queuedIndex + 1}項`
        : `開啟研究選單，已完成${completed}項，共${technologyIds.length}項`,
      run: () => {
        this.productionUiMode = { kind: "none" };
        this.researchMenuOpen = true;
        this.researchPage = 0;
        this.buildMenuOpen = false;
        this.systemPanelOpen = false;
        this.refreshInterface(true);
      },
    };
  }

  private researchAction(producer: BuildingEntityState, technologyId: TechnologyType): ActionSpec {
    const definition = TECHNOLOGIES[technologyId];
    const player = this.playerState();
    const queued = this.runtime.state.entities
      .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)
      .flatMap((entity) => entity.productionQueue.map((job, index) => ({ entity, job, index })))
      .find((entry) => entry.job.kind === "research" && entry.job.technologyId === technologyId);
    const completed = player.completedTechnologyIds.includes(technologyId);
    const missingPrerequisites = definition.prerequisites.filter((prerequisite) => !player.completedTechnologyIds.includes(prerequisite));
    const unlocked = this.hasReachedTier(definition.requiredTier);
    const affordable = this.canAfford(definition.cost);
    const queueAvailable = producer.productionQueue.length < MAX_TRAINING_QUEUE_DEPTH;

    if (completed) return this.researchInfoAction("✓", `${definition.shortName} 已完成`, `${definition.displayName}已完成`);
    if (queued) {
      const queuedDefinition = TECHNOLOGIES[technologyId];
      const progress = queued.index === 0
        ? Math.round(Phaser.Math.Clamp(1 - queued.job.remainingTicks / queuedDefinition.researchTicks, 0, 1) * 100)
        : null;
      return this.researchInfoAction(
        progress === null ? `${queued.index + 1}` : "◴",
        progress === null ? `${definition.shortName} 佇列${queued.index + 1}` : `${definition.shortName} ${progress}%`,
        progress === null ? `${definition.displayName}位於生產佇列第${queued.index + 1}項` : `${definition.displayName}研究進度百分之${progress}`,
      );
    }
    if (!producer.complete || producer.hitPoints <= 0) return this.researchInfoAction("鎖", `${definition.shortName} 建築未完`, `${definition.displayName}需要完整可用的${buildingDisplayName(definition.producer)}`);
    if (player.advancement?.producerId === producer.id) return this.researchInfoAction("忙", `${definition.shortName} 升階中`, `${buildingDisplayName(producer.typeId)}正在提升聚落階段`);
    if (!unlocked) return this.researchInfoAction("鎖", `${definition.shortName} 缺${SETTLEMENT_TIER_SHORT_LABELS[definition.requiredTier]}`, `${definition.displayName}需要${SETTLEMENT_TIER_LABELS[definition.requiredTier]}`);
    if (missingPrerequisites.length > 0) return this.researchInfoAction("鎖", `${definition.shortName} 缺前置`, `${definition.displayName}需要先完成${missingPrerequisites.map((id) => TECHNOLOGIES[id].displayName).join("、")}`);
    if (!queueAvailable) return this.researchInfoAction("滿", `${definition.shortName} 佇列滿`, `${buildingDisplayName(producer.typeId)}的生產佇列已滿`);
    if (!affordable) return this.researchInfoAction("缺", `${definition.shortName} 缺資源`, `${definition.displayName}資源不足，需要${this.spokenCost(definition.cost)}`);
    return {
      glyph: "研",
      label: `${definition.shortName} 可研究`,
      accessibleLabel: `研究${definition.displayName}，需要${this.spokenCost(definition.cost)}`,
      run: () => this.issue(
        { type: "research", producerId: producer.id, technologyId },
        `${definition.displayName}已加入生產佇列`,
      ),
    };
  }

  private researchInfoAction(glyph: string, label: string, accessibleLabel: string): ActionSpec {
    return {
      glyph,
      label,
      accessibleLabel,
      run: () => this.setNotice(accessibleLabel, "normal"),
    };
  }

  private advanceSettlementAction(producer: BuildingEntityState): ActionSpec {
    const player = this.playerState();
    const advancement = player.advancement;
    if (advancement) {
      const definition = SETTLEMENT_TIERS[advancement.targetTier];
      const progress = Math.round(Phaser.Math.Clamp(1 - advancement.remainingTicks / definition.advanceTicks, 0, 1) * 100);
      return {
        glyph: "時",
        label: `${SETTLEMENT_TIER_SHORT_LABELS[advancement.targetTier]}期 ${progress}%`,
        accessibleLabel: `聚落正在升級至${SETTLEMENT_TIER_LABELS[advancement.targetTier]}，已完成百分之${progress}`,
        enabled: false,
        run: () => undefined,
      };
    }
    const targetTier = this.nextSettlementTier(player.settlementTier);
    if (!targetTier) {
      return {
        glyph: "◆",
        label: "聚落已完備",
        accessibleLabel: `聚落已達最高階段${SETTLEMENT_TIER_LABELS[player.settlementTier]}`,
        enabled: false,
        run: () => undefined,
      };
    }
    const definition = SETTLEMENT_TIERS[targetTier];
    const completedBuildings = new Set(this.runtime.state.entities
      .filter((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.complete && entity.hitPoints > 0)
      .map((entity) => entity.typeId));
    const missingPrerequisites = definition.prerequisites.filter((type) => !completedBuildings.has(type));
    const prerequisitesReady = missingPrerequisites.length === 0;
    const enabled = producer.complete && producer.productionQueue.length === 0 && prerequisitesReady && this.canAfford(definition.cost);
    return {
      glyph: prerequisitesReady ? "升" : "鎖",
      label: prerequisitesReady
        ? `升${SETTLEMENT_TIER_SHORT_LABELS[targetTier]} ${this.shortCost(definition.cost)}`
        : `升${SETTLEMENT_TIER_SHORT_LABELS[targetTier]} 缺前置`,
      accessibleLabel: prerequisitesReady
        ? `升級聚落至${SETTLEMENT_TIER_LABELS[targetTier]}，需要${this.spokenCost(definition.cost)}`
        : `尚不能升級至${SETTLEMENT_TIER_LABELS[targetTier]}，需要先完成${missingPrerequisites.map(buildingDisplayName).join("、")}`,
      enabled,
      run: () => this.issue(
        { type: "advanceSettlement", producerId: producer.id, targetTier },
        `聚落升級開始｜目標 ${SETTLEMENT_TIER_LABELS[targetTier]}`,
      ),
    };
  }

  private queueTrainAfterArt(producerId: string, type: UnitType): void {
    const artId = UNIT_ART[type];
    if (this.isArtReady(artId)) {
      this.issue({ type: "train", producerId, unitType: type, count: 1 }, `${UNIT_LABELS[type]} 已加入訓練佇列`);
      return;
    }
    this.failedArtIds.delete(artId);
    this.artRetryAt.delete(artId);
    this.pendingArtIds.add(artId);
    this.setNotice(`正在整備 ${UNIT_LABELS[type]} 的完整動作素材`, "normal");
    this.refreshInterface(true);
    void this.ensureArtLoaded(artId)
      .then(() => {
        if (!this.sys.isActive()) return;
        const currentProducer = this.entityById(producerId);
        if (currentProducer?.kind === "building") {
          this.issue({ type: "train", producerId, unitType: type, count: 1 }, `${UNIT_LABELS[type]} 已加入訓練佇列`);
        }
      })
      .catch((error: unknown) => this.handleDynamicArtFailure(artId, error))
      .finally(() => {
        this.pendingArtIds.delete(artId);
        if (this.sys.isActive()) this.refreshInterface(true);
      });
  }

  private prefetchQueuedUnitArt(): void {
    for (const entity of this.runtime.state.entities) {
      if (entity.kind !== "building") continue;
      const job = entity.productionQueue[0];
      const type = job?.kind === "train" ? job.unitType : undefined;
      if (!type) continue;
      const artId = UNIT_ART[type];
      if (this.isArtReady(artId)) continue;
      if (this.failedArtIds.has(artId)) {
        if (performance.now() < (this.artRetryAt.get(artId) ?? Number.POSITIVE_INFINITY)) continue;
        this.failedArtIds.delete(artId);
      }
      void this.ensureArtLoaded(artId).catch((error: unknown) => this.handleDynamicArtFailure(artId, error));
    }
  }

  private isArtReady(artId: CombatArtId): boolean {
    const manifest = requireFrameAnimatedManifest(COMBAT_ANIMATION_MANIFEST, artId);
    if (!this.textures.exists(manifest.textureKey)) return false;
    try {
      validateFrameAnimatedCombatActorManifest(this, manifest, artId);
      return true;
    } catch {
      return false;
    }
  }

  private ensureArtLoaded(artId: CombatArtId): Promise<void> {
    if (this.isArtReady(artId)) return Promise.resolve();
    const pending = this.artLoadPromises.get(artId);
    if (pending) return pending;
    const asset = ANIMATED_UNIT_FRAME_ASSETS.find((candidate) => candidate.artId === artId);
    if (!asset) return Promise.reject(new Error(`Missing unit art asset for ${artId}`));
    if (this.textures.exists(asset.textureKey)) this.textures.remove(asset.textureKey);
    const generation = this.artLoadGeneration;
    const promise = new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.load.off(Phaser.Loader.Events.FILE_COMPLETE, onComplete);
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        this.artLoadPromises.delete(artId);
      };
      const onComplete = (key: string): void => {
        if (key !== asset.textureKey) return;
        cleanup();
        if (generation !== this.artLoadGeneration) {
          reject(new Error(`Scene changed while loading ${artId}`));
          return;
        }
        try {
          validateFrameAnimatedCombatActorManifest(this, asset.manifest, artId);
          this.failedArtIds.delete(artId);
          this.artRetryAt.delete(artId);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      const onError = (file: { readonly key?: unknown }): void => {
        if (file.key !== asset.textureKey) return;
        cleanup();
        reject(new Error(`Failed to load ${asset.textureKey}`));
      };
      this.load.on(Phaser.Loader.Events.FILE_COMPLETE, onComplete);
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      this.load.image(asset.textureKey, asset.path);
      if (!this.load.isLoading()) this.load.start();
    });
    this.artLoadPromises.set(artId, promise);
    return promise;
  }

  private handleDynamicArtFailure(artId: CombatArtId, error: unknown): void {
    if (!this.sys.isActive() || this.failedArtIds.has(artId)) return;
    this.failedArtIds.add(artId);
    this.artRetryAt.set(artId, performance.now() + 5_000);
    this.pendingArtIds.delete(artId);
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Unit art load failed for ${artId}: ${detail}`);
    this.setNotice("角色完整動作載入失敗；5 秒後自動重試", "warning");
    this.refreshInterface(true);
  }

  private selectWorkersAction(): ActionSpec {
    return { glyph: "⚒", label: "全選工匠", run: () => this.selectUnitGroup("villager") };
  }

  private selectArmyAction(): ActionSpec {
    const military = this.runtime.state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId !== "villager");
    return { glyph: "⚔", label: "全選軍隊", enabled: military.length > 0, run: () => this.selectUnitGroup("military") };
  }

  private formationAction(units: readonly (UnitEntityState & { typeId: CombatUnitId })[]): ActionSpec {
    const order: readonly FormationKind[] = ["line", "wedge", "box"];
    const current = units[0]?.formation ?? "line";
    const next = order[(order.indexOf(current) + 1) % order.length]!;
    const labels: Record<FormationKind, string> = { line: "橫列", wedge: "楔形", box: "方陣" };
    return {
      glyph: current === "line" ? "一" : current === "wedge" ? "Λ" : "▦",
      label: labels[current],
      accessibleLabel: `目前${labels[current]}，切換為${labels[next]}`,
      run: () => this.issue({ type: "setFormation", entityIds: units.map((unit) => unit.id), formation: next }, `部隊改為${labels[next]}`),
    };
  }

  private stanceAction(units: readonly (UnitEntityState & { typeId: CombatUnitId })[]): ActionSpec {
    const order: readonly CombatStance[] = ["aggressive", "defensive", "holdGround"];
    const current = units[0]?.stance ?? "aggressive";
    const next = order[(order.indexOf(current) + 1) % order.length]!;
    const labels: Record<CombatStance, string> = { aggressive: "主動", defensive: "守備", holdGround: "堅守" };
    return {
      glyph: current === "aggressive" ? "猛" : current === "defensive" ? "守" : "止",
      label: labels[current],
      accessibleLabel: `目前${labels[current]}站姿，切換為${labels[next]}`,
      run: () => this.issue({ type: "setStance", entityIds: units.map((unit) => unit.id), stance: next }, `部隊站姿：${labels[next]}`),
    };
  }

  private abilityAction(units: readonly (UnitEntityState & { typeId: CombatUnitId })[]): ActionSpec {
    const caster = [...units].sort((left, right) => left.id.localeCompare(right.id))[0]!;
    const ability = COMBAT_UNITS[caster.typeId].activeAbility;
    const ready = caster.combat.phase === "ready" && caster.abilityReadyTick <= this.runtime.state.tick;
    const targeting: "unit" | "ground" | "direction" = ability.targeting === "unit" ? "unit" : ability.targeting === "ground" ? "ground" : "direction";
    return {
      glyph: "技",
      label: ready ? ability.displayName : `冷卻 ${Math.max(0, Math.ceil((caster.abilityReadyTick - this.runtime.state.tick) / TICKS_PER_SECOND))}s`,
      accessibleLabel: `${UNIT_LABELS[caster.typeId]}技能${ability.displayName}${ready ? "已就緒" : "冷卻中"}`,
      enabled: ready,
      active: ability.targeting === "self" ? undefined : this.tacticalUiMode.kind === "ability" && this.tacticalUiMode.casterId === caster.id,
      run: () => {
        if (ability.targeting === "self") {
          if (this.issue({ type: "castAbility", casterId: caster.id, abilityId: ability.id, target: { kind: "self" } }, `${ability.displayName}已啟動`)) this.cancelTacticalMode();
          return;
        }
        if (this.tacticalUiMode.kind === "ability" && this.tacticalUiMode.casterId === caster.id) this.cancelTacticalMode("已取消技能瞄準");
        else this.openTacticalMode({ kind: "ability", casterId: caster.id, abilityId: ability.id, targeting });
      },
    };
  }

  private openTacticalMode(mode: Exclude<TacticalUiMode, { kind: "none" }>): void {
    this.tacticalUiMode = mode;
    this.productionUiMode = { kind: "none" };
    this.buildMenuOpen = false;
    this.researchMenuOpen = false;
    this.buildingPlacement = null;
    this.systemPanelOpen = false;
    this.hoverGrid = null;
    this.hoverEntityId = null;
    const message = mode.kind === "attackMove" ? "點地圖下達攻擊移動" : mode.kind === "patrol" ? "依序點選兩個巡邏點" : mode.kind === "repair" ? "點選受損友方建築" : "選擇技能目標";
    this.setNotice(message, "normal");
    this.refreshInterface(true);
  }

  private cancelTacticalMode(message?: string): void {
    this.tacticalUiMode = { kind: "none" };
    this.hoverGrid = null;
    this.hoverEntityId = null;
    if (!this.buildingPlacement && this.productionUiMode.kind !== "rally") this.settlementOverlay?.placement.clear();
    if (message) this.setNotice(message, "normal");
    this.refreshInterface(true);
  }

  private commitTacticalTarget(point: GridPoint, entity: EntityState | null): void {
    const mode = this.tacticalUiMode;
    if (mode.kind === "none") return;
    if (mode.kind === "attackMove") {
      const command: GameCommand = entity && this.isHostileTarget(entity)
        ? { type: "attack", entityIds: mode.entityIds, targetId: entity.id }
        : { type: "attackMove", entityIds: mode.entityIds, target: point };
      const notice = command.type === "attack" ? `集中攻擊 ${this.entityDisplayName(entity!)}` : `攻擊移動至 ${point.x},${point.y}`;
      if (this.issue(command, notice)) this.cancelTacticalMode();
      return;
    }
    if (mode.kind === "patrol") {
      if (!mode.firstPoint) {
        if (!this.isTacticalTargetValid(point, entity)) {
          this.drawTacticalMarker(point, false);
          this.setNotice("巡邏點必須設在可通行空地", "warning");
          return;
        }
        this.tacticalUiMode = { ...mode, firstPoint: { ...point } };
        this.setNotice("第一巡邏點已設定，請點第二點", "normal");
        this.refreshInterface(true);
        return;
      }
      if (this.issue({ type: "patrol", entityIds: mode.entityIds, waypoints: [mode.firstPoint, point] }, "開始雙點巡邏")) this.cancelTacticalMode();
      return;
    }
    if (mode.kind === "repair") {
      if (!entity || entity.kind !== "building") {
        this.setNotice("修復必須點選受損友方建築", "warning");
        return;
      }
      if (this.issue({ type: "repair", entityIds: mode.entityIds, targetId: entity.id }, `開始修復 ${buildingDisplayName(entity.typeId)}`)) this.cancelTacticalMode();
      return;
    }
    const caster = this.entityById(mode.casterId);
    if (!caster || caster.kind !== "unit") {
      this.cancelTacticalMode("施法者已失效");
      return;
    }
    const target = mode.targeting === "unit"
      ? entity ? { kind: "entity" as const, entityId: entity.id } : null
      : mode.targeting === "ground"
        ? { kind: "ground" as const, point: { ...point } }
        : { kind: "direction" as const, vector: { x: point.x - caster.position.x, y: point.y - caster.position.y } };
    if (!target || (target.kind === "direction" && target.vector.x === 0 && target.vector.y === 0)) {
      this.setNotice("技能目標無效，請重新選擇", "warning");
      return;
    }
    if (this.issue({ type: "castAbility", casterId: caster.id, abilityId: mode.abilityId, target }, `${mode.abilityId} 已施放`)) this.cancelTacticalMode();
  }

  private drawTacticalMarker(point: GridPoint, valid: boolean): void {
    const graphics = this.settlementOverlay?.placement;
    if (!graphics) return;
    const world = gridToWorld(point, { x: 0, y: 0 });
    const color = valid ? 0xf0c86d : 0xef735f;
    graphics.clear().fillStyle(color, 0.2).beginPath()
      .moveTo(world.x, world.y - 22).lineTo(world.x + 44, world.y).lineTo(world.x, world.y + 22).lineTo(world.x - 44, world.y).closePath().fillPath();
    graphics.lineStyle(4, color, 0.95).strokePath();
    graphics.lineStyle(4, color, 0.95).lineBetween(world.x - 14, world.y, world.x + 16, world.y).lineBetween(world.x + 16, world.y, world.x + 7, world.y - 8).lineBetween(world.x + 16, world.y, world.x + 7, world.y + 8);
    if (this.tacticalUiMode.kind === "patrol" && this.tacticalUiMode.firstPoint) {
      const first = gridToWorld(this.tacticalUiMode.firstPoint, { x: 0, y: 0 });
      graphics.lineStyle(3, 0x9ed486, 0.9).lineBetween(first.x, first.y, world.x, world.y).strokeCircle(first.x, first.y, 12);
    }
  }

  private isTacticalTargetValid(point: GridPoint, entity: EntityState | null): boolean {
    const mode = this.tacticalUiMode;
    let command: GameCommand | null = null;
    if (mode.kind === "attackMove") {
      command = entity && this.isHostileTarget(entity)
        ? { type: "attack", entityIds: mode.entityIds, targetId: entity.id }
        : { type: "attackMove", entityIds: mode.entityIds, target: point };
    } else if (mode.kind === "patrol") {
      command = { type: "patrol", entityIds: mode.entityIds, waypoints: [mode.firstPoint ?? point, point] };
    } else if (mode.kind === "repair" && entity?.kind === "building") {
      command = { type: "repair", entityIds: mode.entityIds, targetId: entity.id };
    } else if (mode.kind === "ability") {
      const caster = this.entityById(mode.casterId);
      if (!caster || caster.kind !== "unit") return false;
      const target = mode.targeting === "unit"
        ? entity ? { kind: "entity" as const, entityId: entity.id } : null
        : mode.targeting === "ground"
          ? { kind: "ground" as const, point }
          : { kind: "direction" as const, vector: { x: point.x - caster.position.x, y: point.y - caster.position.y } };
      if (target && (target.kind !== "direction" || target.vector.x !== 0 || target.vector.y !== 0)) {
        command = { type: "castAbility", casterId: mode.casterId, abilityId: mode.abilityId, target };
      }
    }
    if (!command) return false;
    const player = this.runtime.state.players.find((candidate) => candidate.id === VILLAGE_ASSAULT_PLAYER_ID);
    if (!player) return false;
    return validateCommand(this.runtime.state, {
      matchId: this.runtime.state.matchId,
      playerId: VILLAGE_ASSAULT_PLAYER_ID,
      sequence: player.lastSequence + 1,
      clientTick: this.runtime.state.tick,
      command,
    }).ok;
  }

  private isHostileTarget(entity: EntityState): boolean {
    if (entity.kind === "resource" || entity.ownerId === null) return false;
    const player = this.runtime.state.players.find((candidate) => candidate.id === VILLAGE_ASSAULT_PLAYER_ID);
    const owner = this.runtime.state.players.find((candidate) => candidate.id === entity.ownerId);
    return Boolean(player && owner && player.teamId !== owner.teamId);
  }

  private zoomAction(amount: number): ActionSpec {
    return { glyph: amount > 0 ? "+" : "−", label: amount > 0 ? "放大" : "縮小", run: () => this.zoomCamera(amount) };
  }

  private fullscreenAction(): ActionSpec {
    const label = fullscreenButtonLabel(this);
    return { glyph: label.glyph, label: label.label, run: () => { toggleGameFullscreen(this); this.layoutInterface(); } };
  }

  private systemAction(): ActionSpec {
    return {
      glyph: "⋯",
      label: "系統",
      run: () => {
        if (this.tacticalUiMode.kind !== "none") this.cancelTacticalMode();
        this.systemPanelOpen = true;
        this.refreshInterface(true);
      },
    };
  }

  private openBuildMenu(): void {
    const villagers = this.selectedUnits().filter((unit) => unit.typeId === "villager");
    if (villagers.length === 0) {
      this.setNotice("先選取至少一名工匠再建造", "warning");
      return;
    }
    this.buildMenuOpen = true;
    this.tacticalUiMode = { kind: "none" };
    this.buildPage = 0;
    this.researchMenuOpen = false;
    this.researchPage = 0;
    this.productionUiMode = { kind: "none" };
    this.buildingPlacement = null;
    this.systemPanelOpen = false;
    this.setNotice("建造模式：先選建築，再點地圖位置", "success");
    this.refreshInterface(true);
  }

  private closeBuildMenu(): void {
    this.buildMenuOpen = false;
    this.buildPage = 0;
    this.refreshInterface(true);
  }

  private closeResearchMenu(): void {
    this.researchMenuOpen = false;
    this.researchPage = 0;
    this.refreshInterface(true);
  }

  private cancelBuildPlacement(message?: string, reopenMenu = false): void {
    this.buildingPlacement = null;
    this.buildMenuOpen = reopenMenu;
    this.hoverGrid = null;
    this.settlementOverlay?.placement.clear();
    if (message) this.setNotice(message, "normal");
    this.refreshInterface(true);
  }

  private canBuildAt(point: GridPoint | null): boolean {
    if (!point || !this.buildingPlacement) return false;
    const cells = getFootprintCells(point, BUILDINGS[this.buildingPlacement].footprint);
    return cells.every(isSettlementBuildable) && isBuildLocationAvailable(this.runtime.state, this.buildingPlacement, point);
  }

  private selectUnitGroup(group: "villager" | "military"): void {
    this.selectedIds.clear();
    for (const entity of this.runtime.state.entities) {
      if (entity.kind !== "unit" || entity.ownerId !== VILLAGE_ASSAULT_PLAYER_ID) continue;
      if (group === "villager" ? entity.typeId === "villager" : entity.typeId !== "villager") this.selectedIds.add(entity.id);
    }
    this.refreshSelectionViews();
    this.refreshInterface(true);
    this.setNotice(group === "villager" ? "已選取全部工匠" : "已選取全部軍隊", "success");
  }

  private refreshSelectionViews(): void {
    for (const [id, view] of this.unitViews) view.selection.setVisible(this.selectedIds.has(id));
    for (const entity of this.runtime.state.entities) {
      if (entity.kind === "unit") continue;
      this.entityViews.get(entity.id)?.update(entity, this.selectedIds.has(entity.id));
    }
  }

  private sanitizeSelection(): void {
    const ids = new Set(this.runtime.state.entities.map((entity) => entity.id));
    for (const id of this.selectedIds) if (!ids.has(id)) this.selectedIds.delete(id);
    if (this.researchMenuOpen && !this.selectedEntities().some((entity) => entity.kind === "building" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)) {
      this.researchMenuOpen = false;
      this.researchPage = 0;
    }
    this.sanitizeProductionMode();
    this.sanitizeTacticalMode();
  }

  private sanitizeTacticalMode(): void {
    const mode = this.tacticalUiMode;
    if (mode.kind === "none") return;
    if (mode.kind === "ability") {
      const caster = this.entityById(mode.casterId);
      if (caster?.kind === "unit" && caster.ownerId === VILLAGE_ASSAULT_PLAYER_ID && caster.typeId !== "villager" && COMBAT_UNITS[caster.typeId].activeAbility.id === mode.abilityId) return;
      this.tacticalUiMode = { kind: "none" };
      this.hoverGrid = null;
      this.hoverEntityId = null;
      return;
    }
    const requiredType = mode.kind === "repair" ? "villager" : "military";
    const entityIds = mode.entityIds.filter((id) => {
      const unit = this.entityById(id);
      return unit?.kind === "unit"
        && unit.ownerId === VILLAGE_ASSAULT_PLAYER_ID
        && (requiredType === "villager" ? unit.typeId === "villager" : unit.typeId !== "villager");
    });
    if (entityIds.length === 0) {
      this.tacticalUiMode = { kind: "none" };
      this.hoverGrid = null;
      this.hoverEntityId = null;
    } else if (mode.kind === "attackMove") {
      this.tacticalUiMode = { ...mode, entityIds };
    } else if (mode.kind === "patrol") {
      this.tacticalUiMode = { ...mode, entityIds };
    } else {
      this.tacticalUiMode = { ...mode, entityIds };
    }
  }

  private sanitizeProductionMode(): void {
    const mode = this.productionUiMode;
    if (mode.kind === "none") return;
    const producer = this.entityById(mode.producerId);
    if (!producer || producer.kind !== "building" || producer.ownerId !== VILLAGE_ASSAULT_PLAYER_ID || !producer.complete || producer.hitPoints <= 0 || !this.selectedIds.has(producer.id)) {
      this.productionUiMode = { kind: "none" };
      this.hoverGrid = null;
      return;
    }
    if (mode.kind === "queue") {
      const pageCount = Math.max(1, Math.ceil(producer.productionQueue.length / 4));
      if (mode.page >= pageCount) this.productionUiMode = { ...mode, page: pageCount - 1 };
      return;
    }
    if (mode.kind === "confirm" && !producer.productionQueue.some((job) => this.sameProductionJobId(job.jobId, mode.jobId))) {
      this.productionUiMode = { kind: "queue", producerId: producer.id, page: Math.min(mode.page, Math.max(0, Math.ceil(producer.productionQueue.length / 4) - 1)) };
      this.setNotice("該工作已完成或已取消，沒有取消其他項目。", "warning");
    }
  }

  private refreshRallyOverlay(): void {
    const graphics = this.settlementOverlay?.placement;
    if (!graphics || this.buildingPlacement) return;
    if (this.tacticalUiMode.kind !== "none") {
      const hoverEntity = this.hoverEntityId ? this.entityById(this.hoverEntityId) ?? null : null;
      if (this.hoverGrid) this.drawTacticalMarker(this.hoverGrid, this.isTacticalTargetValid(this.hoverGrid, hoverEntity));
      else graphics.clear();
      return;
    }
    if (this.productionUiMode.kind === "rally" && this.hoverGrid) {
      this.drawRallyMarker(this.hoverGrid, isRallyPointAvailable(this.runtime.state, this.productionUiMode.producerId, this.hoverGrid), true);
      return;
    }
    const selected = this.selectedEntities();
    const building = selected.length === 1 && selected[0]?.kind === "building" && selected[0].ownerId === VILLAGE_ASSAULT_PLAYER_ID ? selected[0] : undefined;
    if (building?.rallyPoint) this.drawRallyMarker(building.rallyPoint, true, false);
    else graphics.clear();
  }

  private drawRallyMarker(point: GridPoint, valid: boolean, preview: boolean): void {
    const graphics = this.settlementOverlay?.placement;
    if (!graphics) return;
    const world = gridToWorld(point, { x: 0, y: 0 });
    const color = preview ? (valid ? 0x9ed486 : 0xef735f) : 0xe0b866;
    graphics.clear();
    graphics.fillStyle(color, preview ? 0.22 : 0.16).beginPath()
      .moveTo(world.x, world.y - 22)
      .lineTo(world.x + 44, world.y)
      .lineTo(world.x, world.y + 22)
      .lineTo(world.x - 44, world.y)
      .closePath().fillPath();
    graphics.lineStyle(4, color, 0.95).strokePath();
    graphics.lineStyle(6, 0x4b3424, 1).lineBetween(world.x - 4, world.y - 52, world.x - 4, world.y + 3);
    graphics.fillStyle(color, 1).fillTriangle(world.x, world.y - 50, world.x + 28, world.y - 40, world.x, world.y - 29);
    graphics.lineStyle(3, color, 1);
    if (valid) {
      graphics.beginPath().moveTo(world.x - 15, world.y + 2).lineTo(world.x - 5, world.y + 11).lineTo(world.x + 16, world.y - 10).strokePath();
    } else {
      graphics.lineBetween(world.x - 13, world.y - 10, world.x + 13, world.y + 10);
      graphics.lineBetween(world.x + 13, world.y - 10, world.x - 13, world.y + 10);
    }
  }

  private selectedEntities(): EntityState[] {
    return this.runtime.state.entities.filter((entity) => this.selectedIds.has(entity.id));
  }

  private selectedUnits(): UnitEntityState[] {
    return this.runtime.state.entities.filter((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && this.selectedIds.has(entity.id));
  }

  private entityById(id: string): EntityState | undefined {
    return this.runtime.state.entities.find((entity) => entity.id === id);
  }

  private entityDisplayName(entity: EntityState): string {
    if (entity.kind === "unit") return UNIT_LABELS[entity.typeId];
    if (entity.kind === "building") return buildingDisplayName(entity.typeId);
    return resourceDisplayName(entity.typeId);
  }

  private playerState() {
    const player = this.runtime.state.players.find((candidate) => candidate.id === VILLAGE_ASSAULT_PLAYER_ID);
    if (!player) throw new Error("Local player is missing from VillageAssaultRuntime");
    return player;
  }

  private canAfford(cost: ResourceWallet): boolean {
    const wallet = this.playerState().resources;
    return wallet.food >= cost.food && wallet.wood >= cost.wood && wallet.stone >= cost.stone;
  }

  private selectionLabel(selected: readonly EntityState[]): string {
    if (selected.length === 0) return "未選取｜點我方工匠或建築";
    if (selected.length === 1) {
      const entity = selected[0]!;
      if (entity.kind === "resource") {
        if (entity.amount <= 0 && entity.renewAtTick !== null) {
          const seconds = Math.max(0, Math.ceil((entity.renewAtTick - this.runtime.state.tick) / TICKS_PER_SECOND));
          return `${this.entityDisplayName(entity)}｜休耕中，${seconds} 秒後復育`;
        }
        return `${this.entityDisplayName(entity)}｜存量 ${entity.amount}/${entity.maxHitPoints}`;
      }
      if (entity.kind === "unit" && entity.cargo.kind && entity.cargo.amount > 0) {
        return `${this.entityDisplayName(entity)}｜生命 ${entity.hitPoints}/${entity.maxHitPoints}｜攜帶${this.resourceKindName(entity.cargo.kind)} ${entity.cargo.amount}/${UNITS[entity.typeId].carryCapacity}`;
      }
      return `${this.entityDisplayName(entity)}｜生命 ${entity.hitPoints}/${entity.maxHitPoints}`;
    }
    const carriers = selected.filter((entity): entity is UnitEntityState => entity.kind === "unit" && entity.cargo.kind !== null && entity.cargo.amount > 0);
    const cargo = (["food", "wood", "stone"] satisfies ResourceKind[])
      .map((kind) => ({ kind, amount: carriers.reduce((sum, unit) => sum + (unit.cargo.kind === kind ? unit.cargo.amount : 0), 0) }))
      .filter((entry) => entry.amount > 0)
      .map((entry) => `${this.resourceKindName(entry.kind)}${entry.amount}`)
      .join(" ");
    return `已選取 ${selected.length} 個單位${cargo ? `｜攜帶 ${cargo}` : "｜智慧指令已啟用"}`;
  }

  private dropOffAction(units: readonly UnitEntityState[]): ActionSpec | null {
    const grouped = new Map<string, { resourceKind: ResourceKind; carriers: UnitEntityState[]; dropOff: BuildingEntityState }>();
    for (const carrier of units) {
      if (carrier.typeId !== "villager" || !carrier.cargo.kind || carrier.cargo.amount <= 0) continue;
      const dropOff = this.nearestDropOff(carrier.position, carrier.cargo.kind);
      if (!dropOff) continue;
      const key = `${carrier.cargo.kind}:${dropOff.id}`;
      const existing = grouped.get(key);
      if (existing) existing.carriers.push(carrier);
      else grouped.set(key, { resourceKind: carrier.cargo.kind, carriers: [carrier], dropOff });
    }
    const resourceOrder = { food: 0, wood: 1, stone: 2 } satisfies Record<ResourceKind, number>;
    const deliveries = [...grouped.values()].sort((left, right) => (
      resourceOrder[left.resourceKind] - resourceOrder[right.resourceKind]
      || left.dropOff.id.localeCompare(right.dropOff.id)
    ));
    if (deliveries.length === 0) return null;
    const splitRoute = deliveries.length > 1;
    const delivery = deliveries[0]!;
    return {
      glyph: "⇩",
      label: splitRoute ? "卸全部" : `卸${this.resourceKindName(delivery.resourceKind)}`,
      accessibleLabel: splitRoute
        ? "將所有工匠攜帶的材料分送到最近的合法卸貨建築"
        : `將攜帶的${this.resourceKindName(delivery.resourceKind)}送往${buildingDisplayName(delivery.dropOff.typeId)}`,
      run: () => {
        for (const current of deliveries) {
          this.issue(
            { type: "dropOff", entityIds: current.carriers.map((unit) => unit.id), targetId: current.dropOff.id },
            splitRoute ? "正在分送全部材料" : `將${this.resourceKindName(current.resourceKind)}送往${buildingDisplayName(current.dropOff.typeId)}`,
          );
        }
      },
    };
  }

  private nearestDropOff(position: GridPoint, resourceKind: ResourceKind): BuildingEntityState | null {
    return this.runtime.state.entities
      .filter((entity): entity is BuildingEntityState => (
        entity.kind === "building"
        && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID
        && entity.complete
        && entity.hitPoints > 0
        && (BUILDINGS[entity.typeId].dropOffResources?.includes(resourceKind) ?? false)
      ))
      .map((entity) => ({ entity, distance: this.approachDistance(position, entity) }))
      .filter((candidate): candidate is { entity: BuildingEntityState; distance: number } => candidate.distance !== null)
      .sort((left, right) => left.distance - right.distance || left.entity.id.localeCompare(right.entity.id))[0]?.entity ?? null;
  }

  private isAdjacentToEntity(point: GridPoint, entity: EntityState): boolean {
    return getEntityFootprintCells(entity).some((cell) => Math.abs(point.x - cell.x) + Math.abs(point.y - cell.y) === 1);
  }

  private approachDistance(position: GridPoint, entity: BuildingEntityState | ResourceEntityState): number | null {
    const blockedCells = [
      ...getOccupiedMapCells(this.runtime.state),
      ...(this.runtime.state.map.id === "villageAssault" ? getVillageAssaultWalkBlockedCells() : []),
    ];
    const blocked = new Set(blockedCells.map((cell) => `${cell.x},${cell.y}`));
    const targets = (entity.kind === "building"
      ? getFootprintPerimeterCells(entity.position, BUILDINGS[entity.typeId].footprint)
      : [
          { x: entity.position.x + 1, y: entity.position.y },
          { x: entity.position.x - 1, y: entity.position.y },
          { x: entity.position.x, y: entity.position.y + 1 },
          { x: entity.position.x, y: entity.position.y - 1 },
        ])
      .filter((target) => (
        target.x >= 0
        && target.y >= 0
        && target.x < this.runtime.state.map.width
        && target.y < this.runtime.state.map.height
        && !blocked.has(`${target.x},${target.y}`)
      ));
    return findPathToAny(position, targets, this.runtime.state.map.width, this.runtime.state.map.height, blockedCells)?.distance ?? null;
  }

  private resourceKindName(kind: ResourceKind): string {
    return ({ food: "糧", wood: "木", stone: "石" } satisfies Record<ResourceKind, string>)[kind];
  }

  private hasReachedTier(requiredTier: SettlementTier): boolean {
    return SETTLEMENT_TIER_ORDER.indexOf(this.playerState().settlementTier) >= SETTLEMENT_TIER_ORDER.indexOf(requiredTier);
  }

  private nextSettlementTier(currentTier: SettlementTier): SettlementTier | null {
    const next = SETTLEMENT_TIER_ORDER[SETTLEMENT_TIER_ORDER.indexOf(currentTier) + 1];
    return next ?? null;
  }

  private shortCost(cost: ResourceWallet): string {
    return [cost.food ? `糧${cost.food}` : "", cost.wood ? `木${cost.wood}` : "", cost.stone ? `石${cost.stone}` : ""].filter(Boolean).join("/");
  }

  private spokenCost(cost: ResourceWallet): string {
    return [cost.food ? `糧食${cost.food}` : "", cost.wood ? `木材${cost.wood}` : "", cost.stone ? `石材${cost.stone}` : ""].filter(Boolean).join("、");
  }

  private shortBuildingName(type: BuildingType): string {
    return ({
      townCenter: "主城", house: "家屋", lumberCamp: "木作", farmstead: "糧所", barracks: "兵營", defenseTower: "守塔",
      archeryRange: "射箭場", mageSanctum: "法師所", gunWorkshop: "火器坊", beastStable: "獸欄", siegeWorkshop: "攻城坊",
    } satisfies Record<BuildingType, string>)[type];
  }

  private shortUnitName(type: UnitType): string {
    return ({ villager: "工匠", warrior: "戰士", shieldBearer: "盾牌手", archer: "弓箭手", mage: "法師", musketeer: "火槍兵", boarRider: "野豬騎士", heavyCrossbowman: "重弩攻手" } satisfies Record<UnitType, string>)[type];
  }

  private compactNotice(value: string): string {
    return value.length > 13 ? `${value.slice(0, 12)}…` : value;
  }

  private rejectMessage(code: string | null): string {
    if (code === "PRODUCTION_JOB_NOT_FOUND") return "該生產工作已完成或取消，未變更其他佇列項目。";
    return ({
      INSUFFICIENT_RESOURCES: "材料不足，先派工匠採集",
      ACTION_ON_COOLDOWN: "人口／佇列已滿、建築未完成，或聚落正在升級",
      TARGET_NOT_VISIBLE: "目標不在視野內，先派部隊靠近偵查",
      TARGET_NOT_REACHABLE: "目的地無法到達或已被占用",
      ENTITY_NOT_OWNED: "只能指揮自己的單位",
      INVALID_PAYLOAD: "此建築無法生產該單位，或指令不適用",
      DUPLICATE_RESEARCH: "這項科技已完成或已在研究佇列中",
      PREREQUISITE_NOT_MET: "聚落階段或前置建築尚未達成",
      MATCH_NOT_PLAYING: "戰局目前沒有進行",
      NOT_ROOM_MEMBER: "玩家不在這場戰局",
      STALE_OR_DUPLICATE_SEQUENCE: "指令序號已失效",
      RATE_LIMITED: "指令太密集，請稍候",
    } as Record<string, string>)[code ?? ""] ?? "指令未被接受";
  }

  private setNotice(message: string, tone: "normal" | "success" | "warning" = "normal"): void {
    this.notice = message;
    this.noticeUntil = performance.now() + 3_200;
    this.noticeText?.setColor(tone === "warning" ? "#ffb09c" : tone === "success" ? "#dce9c6" : "#e0b866");
    this.noticeText?.setText(message);
    if (this.noticeLiveRegion) this.noticeLiveRegion.textContent = message;
  }

  private drawUnitHealth(graphics: Phaser.GameObjects.Graphics, entity: UnitEntityState): void {
    graphics.clear();
    if (entity.hitPoints === entity.maxHitPoints && !this.selectedIds.has(entity.id)) return;
    const ratio = Phaser.Math.Clamp(entity.hitPoints / entity.maxHitPoints, 0, 1);
    graphics.fillStyle(0x101917, 0.9).fillRect(-27, -80, 54, 7);
    graphics.fillStyle(entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID ? 0x79b879 : 0xd8725f, 1).fillRect(-25, -78, 50 * ratio, 3);
  }

  private drawCargoPack(
    graphics: Phaser.GameObjects.Graphics,
    kind: ResourceKind | null,
    amount: number,
    capacity: number,
  ): void {
    graphics.clear().setVisible(kind !== null && amount > 0);
    if (!kind || amount <= 0) return;
    const fullness = Phaser.Math.Clamp(amount / Math.max(1, capacity), 0.25, 1);
    graphics.fillStyle(0x08100f, 0.52).fillEllipse(0, 11, 30, 10);
    graphics.setScale(0.82 + fullness * 0.18);

    if (kind === "food") {
      graphics.fillStyle(0x5a351d, 1).fillRoundedRect(-11, -8, 22, 22, 6);
      graphics.lineStyle(2, 0x2a1710, 1).strokeRoundedRect(-11, -8, 22, 22, 6);
      graphics.fillStyle(0xd2a85b, 1).fillRoundedRect(-9, -6, 18, 17, 5);
      graphics.fillStyle(0x3b2012, 1).fillRect(-7, -10, 14, 4);
      graphics.lineStyle(2, 0xe2c176, 1).lineBetween(-8, -8, 8, -8);
      graphics.fillStyle(0x7f5524, 1).fillCircle(-4, 2, 1.4).fillCircle(2, 0, 1.4).fillCircle(5, 5, 1.4);
      return;
    }

    if (kind === "wood") {
      for (const y of [-7, 0, 7]) {
        graphics.fillStyle(0x2a1710, 1).fillRoundedRect(-13, y - 4, 26, 8, 3);
        graphics.fillStyle(y === 0 ? 0x8d5128 : 0x70401f, 1).fillRoundedRect(-11, y - 3, 22, 6, 2);
        graphics.fillStyle(0xd09a5d, 1).fillCircle(11, y, 3);
        graphics.lineStyle(1, 0x6a3b21, 1).strokeCircle(11, y, 1.5);
      }
      graphics.lineStyle(2, 0xd2aa59, 1).lineBetween(-3, -12, -3, 12).lineBetween(4, -12, 4, 12);
      return;
    }

    const rock = (x: number, y: number, scale: number, color: number): void => {
      graphics.fillStyle(0x202728, 1);
      graphics.fillPoints([
        new Phaser.Math.Vector2(x - 7 * scale, y + 4 * scale),
        new Phaser.Math.Vector2(x - 5 * scale, y - 5 * scale),
        new Phaser.Math.Vector2(x + 2 * scale, y - 8 * scale),
        new Phaser.Math.Vector2(x + 8 * scale, y - 1 * scale),
        new Phaser.Math.Vector2(x + 5 * scale, y + 6 * scale),
      ], true);
      graphics.fillStyle(color, 1).fillPoints([
        new Phaser.Math.Vector2(x - 5 * scale, y + 2 * scale),
        new Phaser.Math.Vector2(x - 3 * scale, y - 4 * scale),
        new Phaser.Math.Vector2(x + 2 * scale, y - 6 * scale),
        new Phaser.Math.Vector2(x + 6 * scale, y - 1 * scale),
        new Phaser.Math.Vector2(x + 3 * scale, y + 4 * scale),
      ], true);
      graphics.lineStyle(1, 0xa8b2ad, 0.8).lineBetween(x - 2 * scale, y - 3 * scale, x + 2 * scale, y - 5 * scale);
    };
    rock(-5, 3, 1, 0x687574);
    rock(6, 4, 0.85, 0x52605f);
    rock(1, -5, 0.75, 0x7c8985);
  }

  private playerPalette() {
    if (this.villageId === "riverstead") return DEFAULT_TEAM_PALETTES.river;
    if (this.villageId === "highcrag") return DEFAULT_TEAM_PALETTES.crag;
    return DEFAULT_TEAM_PALETTES.pine;
  }

  private pointerGrid(pointer: Phaser.Input.Pointer): GridPoint {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const point = worldToGrid(world, VILLAGE_ASSAULT_ORIGIN);
    return {
      x: Phaser.Math.Clamp(Math.round(point.x), 0, 17),
      y: Phaser.Math.Clamp(Math.round(point.y), 0, 15),
    };
  }

  private centerCameraOn(point: GridPoint): void {
    const world = gridToWorld(point, VILLAGE_ASSAULT_ORIGIN);
    this.cameras.main.centerOn(world.x, world.y);
  }

  private zoomCamera(amount: number): void {
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom + amount, 0.42, 1.25));
    this.setNotice(`鏡頭 ${Math.round(this.cameras.main.zoom * 100)}%`);
  }

  private readonly onWheel = (_pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number): void => {
    this.zoomCamera(deltaY > 0 ? -0.08 : 0.08);
  };

  private updateCamera(delta: number): void {
    if (!this.cameraKeys) return;
    const speed = 620 * (delta / 1000) / this.cameras.main.zoom;
    if (this.cameraKeys.left.isDown) this.cameras.main.scrollX -= speed;
    if (this.cameraKeys.right.isDown) this.cameras.main.scrollX += speed;
    if (this.cameraKeys.up.isDown) this.cameras.main.scrollY -= speed;
    if (this.cameraKeys.down.isDown) this.cameras.main.scrollY += speed;
  }

  private readonly layoutInterface = (): void => {
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    const profile = getDeviceViewportProfile();
    const unitsPerCssX = width / Math.max(1, profile.width);
    const unitsPerCssY = height / Math.max(1, profile.height);
    const safeLeft = profile.safeArea.left * unitsPerCssX;
    const safeRight = profile.safeArea.right * unitsPerCssX;
    const safeTop = profile.safeArea.top * unitsPerCssY;
    const safeBottom = profile.safeArea.bottom * unitsPerCssY;
    const availableWidth = Math.max(320, width - safeLeft - safeRight - 24);
    this.uiCamera?.setViewport(0, 0, width, height).setZoom(1).setScroll(0, 0);
    const compact = profile.landscape && (profile.mobile || profile.height <= 520);
    this.compactUi = compact;
    this.uiScale = Math.min(1, availableWidth / UI_WIDTH);
    this.topRoot?.setScale(this.uiScale).setPosition(safeLeft + (availableWidth - UI_WIDTH * this.uiScale) / 2 + 12, safeTop + 10);
    this.actionRoot?.setScale(this.uiScale).setPosition(safeLeft + (availableWidth - UI_WIDTH * this.uiScale) / 2 + 12, height - safeBottom - 10 - ACTION_PANEL_HEIGHT * this.uiScale);
    this.objectiveText?.setPosition(compact ? 500 : 330, 13).setWordWrapWidth(compact ? 180 : 300);
    this.noticeText?.setVisible(!compact);
    for (const view of this.unitViews.values()) view.label.setVisible(!compact);
    for (const view of this.entityViews.values()) view.setCompact(compact);
    this.cameras.main.setZoom(compact ? Phaser.Math.Clamp(0.55 + width / 2500, 0.55, 0.78) : Phaser.Math.Clamp(width / 1500, 0.72, 1));
    this.orientationBlocked = profile.mobile && !profile.landscape;
    this.rotateBlocker?.setSize(width * 2, height * 2).setDisplaySize(width * 2, height * 2);
    this.rotateRoot?.setPosition(width / 2, height / 2).setVisible(this.orientationBlocked).setActive(this.orientationBlocked);
    this.refreshInterface(true);
  };

  private createRotatePrompt(): Phaser.GameObjects.Container {
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    const blocker = this.add.rectangle(0, 0, Math.max(1600, width * 2), Math.max(1200, height * 2), 0x080c0b, 1).setInteractive();
    this.rotateBlocker = blocker;
    const frame = this.add.graphics();
    frame.lineStyle(8, 0xe0b866, 1).strokeRoundedRect(-58, -96, 116, 192, 20);
    frame.fillStyle(0xe0b866, 1).fillCircle(0, 73, 7);
    const title = this.add.text(0, 132, "請橫向轉動手機", {
      color: "#f0ebcf",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "38px",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    const copy = this.add.text(0, 184, "橫向後會自動重排資源列與建造按鈕", {
      color: "#dce9c6",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "18px",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    return this.add.container(width / 2, height / 2, [blocker, frame, title, copy]).setScrollFactor(0).setDepth(200_000).setVisible(false);
  }

  private togglePause(): void {
    if (this.ended) return;
    this.paused = !this.paused;
    this.setNotice(this.paused ? "戰局暫停" : "戰局繼續", "normal");
    this.refreshInterface(true);
  }

  private finishBattle(): void {
    this.ended = true;
    const victory = this.runtime.state.winningTeamIds.includes("team-player");
    this.setNotice(victory ? "征服成功｜東境敵寨已失守" : "戰役失敗｜你的村鎮已被攻陷", victory ? "success" : "warning");
    this.refreshInterface(true);
  }

  private handleEscape(): void {
    if (!this.systemPanelOpen && this.tacticalUiMode.kind !== "none") {
      this.cancelTacticalMode("已取消戰術目標模式");
      return;
    }
    if (!this.systemPanelOpen && this.productionUiMode.kind === "confirm") {
      this.productionUiMode = { kind: "queue", producerId: this.productionUiMode.producerId, page: this.productionUiMode.page };
      this.refreshInterface(true);
      return;
    }
    if (!this.systemPanelOpen && (this.productionUiMode.kind === "queue" || this.productionUiMode.kind === "rally")) {
      this.productionUiMode = { kind: "none" };
      this.hoverGrid = null;
      this.refreshInterface(true);
      return;
    }
    if (this.systemPanelOpen) {
      this.systemPanelOpen = false;
      this.refreshInterface(true);
    } else if (this.buildingPlacement) this.cancelBuildPlacement("已取消建造", true);
    else if (this.buildMenuOpen) this.closeBuildMenu();
    else if (this.researchMenuOpen) this.closeResearchMenu();
    else this.leaveBattle();
  }

  private restartBattle(): void {
    this.scene.restart({ villageId: this.villageId, aiPersonality: this.aiPersonality, returnScene: this.returnScene });
  }

  private leaveBattle(): void {
    this.scene.start(this.returnScene);
  }

  private readonly onArtLoadError = (file: { readonly key?: unknown }): void => {
    const key = typeof file.key === "string" ? file.key : "unknown-unit-art";
    if (key.startsWith("unit-action-sheet-") && !this.artLoadFailures.includes(key)) this.artLoadFailures.push(key);
  };

  private showLoadFailure(): void {
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    this.cameras.main.setBackgroundColor("#171c1a");
    this.add.text(width / 2, height / 2 - 45, "角色動作素材載入失敗", {
      color: "#ffb09c",
      fontFamily: 'Georgia, "Noto Serif TC", serif',
      fontSize: "36px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 28, `${this.artLoadFailures.join("、")}\n點一下返回村莊選擇`, {
      align: "center",
      color: "#f0ebcf",
      fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
      fontSize: "18px",
    }).setOrigin(0.5);
    this.input.once("pointerup", () => this.scene.start(this.returnScene));
  }

  private cleanup(): void {
    this.artLoadGeneration += 1;
    this.input.off("pointerdown", this.onPointerDown, this);
    this.input.off("pointermove", this.onPointerMove, this);
    this.input.off("pointerup", this.onPointerUp, this);
    this.input.off("wheel", this.onWheel, this);
    this.input.keyboard?.off("keydown-B", this.openBuildMenu, this);
    this.input.keyboard?.off("keydown-ESC", this.handleEscape, this);
    this.input.keyboard?.off("keydown-P", this.togglePause, this);
    this.input.keyboard?.off("keydown-R", this.restartBattle, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layoutInterface, this);
    this.scale.off(Phaser.Scale.Events.ENTER_FULLSCREEN, this.layoutInterface, this);
    this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, this.layoutInterface, this);
    this.events.off(GAME_FULLSCREEN_FALLBACK_EVENT, this.layoutInterface, this);
    window.removeEventListener("resize", this.layoutInterface);
    for (const button of this.actionButtons) button.destroy();
    this.noticeLiveRegion?.remove();
    this.noticeLiveRegion = undefined;
    this.actionButtons.length = 0;
    for (const view of this.unitViews.values()) view.actor.destroy();
    for (const view of this.entityViews.values()) view.destroy();
    for (const effect of this.projectileEffects.values()) {
      this.tweens.killTweensOf(effect);
      effect.destroy();
    }
    this.unitViews.clear();
    this.entityViews.clear();
    this.projectileEffects.clear();
    this.selectedIds.clear();
    this.mapView?.destroy();
    this.settlementOverlay?.destroy();
    this.mapView = undefined;
    this.settlementOverlay = undefined;
  }
}

export default VillageAssaultScene;
