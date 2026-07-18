import Phaser from "phaser";
import {
  COMBAT_UNIT_IDS,
  COMBAT_UNITS,
  MONSTER_IDS,
  MONSTERS,
  calculateDamage,
} from "@village-siege/shared";
import { DEFAULT_TEAM_PALETTES } from "../game/combatArt";
import { createFrameAnimatedCombatActor, requireFrameAnimatedManifest } from "../game/frameAnimatedCombatActor";
import { COMBAT_ANIMATION_MANIFEST } from "../game/combatAnimationManifest";
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
  dead: boolean;
}

interface SceneData { readonly returnScene?: string }

type TouchInteractionMode = "smart" | "move" | "attack" | "box" | "pan";
type TouchControlPanel = "main" | "groups" | "system";

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
  private touchControls?: HTMLElement;
  private touchReadout?: HTMLOutputElement;
  private touchBriefing?: HTMLElement;
  private touchMode: TouchInteractionMode = "smart";
  private touchPanel: TouchControlPanel = "main";
  private touchCameraDrag?: TouchCameraDrag;
  private touchDidPan = false;
  private touchNotice = "";
  private touchNoticeUntil = 0;
  private returnScene = "VillageSelectScene";
  private ended = false;
  private aiElapsedMs = 0;

  constructor() {
    super({ key: "CombatShowcaseScene" });
  }

  init(data: SceneData): void {
    this.returnScene = data.returnScene ?? "VillageSelectScene";
    this.actors = [];
    this.selected = undefined;
    this.squadSelection.clearSelection();
    this.director.reset();
    this.formationKind = "wedge";
    this.dragStart = undefined;
    this.dragClickedId = undefined;
    this.touchMode = "smart";
    this.touchPanel = "main";
    this.touchCameraDrag = undefined;
    this.touchDidPan = false;
    this.touchNotice = "";
    this.touchNoticeUntil = 0;
    this.ended = false;
    this.aiElapsedMs = 0;
  }

  create(): void {
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
    this.input.keyboard?.on("keydown-Q", this.onSkillKey, this);
    this.input.keyboard?.on("keydown-R", this.restartBattle, this);
    this.input.keyboard?.on("keydown-ESC", this.leaveShowcase, this);
    this.input.keyboard?.on("keydown", this.onKeyboardShortcut, this);
    window.addEventListener("resize", this.onViewportResize);
    this.createCameraKeys();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.updateSelectionPanel();
    this.updateSkirmishInterface();
    this.maybeShowTouchBriefing();
  }

  update(_time: number, delta: number): void {
    const deltaMs = Math.min(delta, 60);
    this.updateCamera(deltaMs / 1000);
    this.aiElapsedMs += deltaMs;
    for (const actor of this.actors) {
      actor.visual.update(deltaMs);
      this.tickStatuses(actor, deltaMs);
      actor.attackCooldownMs = Math.max(0, actor.attackCooldownMs - deltaMs);
      actor.skillCooldownMs = Math.max(0, actor.skillCooldownMs - deltaMs);
      actor.actionLockMs = Math.max(0, actor.actionLockMs - deltaMs);
      actor.repathCooldownMs = Math.max(0, actor.repathCooldownMs - deltaMs);
      actor.aiDecisionCooldownMs = Math.max(0, actor.aiDecisionCooldownMs - deltaMs);
      if (!actor.dead) this.updateActor(actor, deltaMs / 1000);
      this.positionActor(actor);
    }
    this.tickSkirmish(deltaMs);
    this.squadSelection.reconcile(this.squadMembers());
    this.syncSelectionVisuals();
    this.updateSelectionPanel();
    this.updateSkirmishInterface();
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
    const host = this.game.canvas.parentElement ?? document.body;
    const controls = document.createElement("nav");
    controls.className = "combat-touch-controls";
    controls.setAttribute("aria-label", "手機戰鬥操作");
    controls.innerHTML = `
      <section class="touch-briefing" role="dialog" aria-modal="true" aria-labelledby="touch-briefing-title" hidden>
        <p>Mobile command briefing</p>
        <h2 id="touch-briefing-title">三步開始指揮</h2>
        <ol>
          <li><strong>1　選部隊</strong><span>點我軍，或按「全軍」。</span></li>
          <li><strong>2　下命令</strong><span>點地移動；點敵軍攻擊。</span></li>
          <li><strong>3　看戰場</strong><span>拖空地移鏡；精準操作用下方模式。</span></li>
        </ol>
        <button type="button" data-touch-action="close-briefing"><span>開始指揮</span></button>
      </section>
      <output class="touch-mode-readout" aria-live="polite"></output>
      <section class="touch-control-panel" data-touch-panel-view="main" aria-label="主要命令">
        <button type="button" data-touch-action="select-all"><span>全</span><small>全軍</small></button>
        <button type="button" data-touch-mode="move" aria-pressed="false"><span>走</span><small>移動</small></button>
        <button type="button" data-touch-mode="attack" aria-pressed="false"><span>攻</span><small>攻擊</small></button>
        <button type="button" data-touch-action="skill"><span>技</span><small>技能</small></button>
        <button type="button" data-touch-action="formation"><span>陣</span><small>隊形</small></button>
        <button type="button" data-touch-mode="box" aria-pressed="false"><span>框</span><small>框選</small></button>
        <button type="button" data-touch-mode="pan" aria-pressed="false"><span>移</span><small>移鏡</small></button>
        <button type="button" data-touch-action="open-system"><span>•••</span><small>更多</small></button>
      </section>
      <section class="touch-control-panel" data-touch-panel-view="groups" aria-label="編隊命令" hidden>
        <button type="button" data-touch-action="store-1"><span>存</span><small>編隊 1</small></button>
        <button type="button" data-touch-action="recall-1"><span>叫</span><small>編隊 1</small></button>
        <button type="button" data-touch-action="store-2"><span>存</span><small>編隊 2</small></button>
        <button type="button" data-touch-action="recall-2"><span>叫</span><small>編隊 2</small></button>
        <button type="button" data-touch-action="store-3"><span>存</span><small>編隊 3</small></button>
        <button type="button" data-touch-action="recall-3"><span>叫</span><small>編隊 3</small></button>
        <button type="button" data-touch-action="open-main"><span>返</span><small>主命令</small></button>
      </section>
      <section class="touch-control-panel" data-touch-panel-view="system" aria-label="其他命令" hidden>
        <button type="button" data-touch-action="clear"><span>消</span><small>取消選取</small></button>
        <button type="button" data-touch-action="open-groups"><span>組</span><small>編隊</small></button>
        <button type="button" data-touch-action="open-briefing"><span>?</span><small>說明</small></button>
        <button type="button" data-touch-action="restart"><span>重</span><small>重開</small></button>
        <button type="button" data-touch-action="leave"><span>退</span><small>離開</small></button>
        <button type="button" data-touch-action="open-main"><span>返</span><small>主命令</small></button>
      </section>`;
    controls.addEventListener("pointerdown", (event) => event.stopPropagation());
    controls.addEventListener("contextmenu", (event) => event.preventDefault());
    controls.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
      if (!button) return;
      const mode = button.dataset.touchMode as TouchInteractionMode | undefined;
      if (mode) this.setTouchMode(this.touchMode === mode ? "smart" : mode);
      else this.handleTouchAction(button.dataset.touchAction ?? "");
    });
    host.append(controls);
    this.touchControls = controls;
    this.touchReadout = controls.querySelector<HTMLOutputElement>(".touch-mode-readout") ?? undefined;
    this.touchBriefing = controls.querySelector<HTMLElement>(".touch-briefing") ?? undefined;
    this.syncTouchControls();
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
      this.spawnActor("player", definition, playerSpawns[index]!, `p-${definition.id}`);
      const enemy = this.spawnActor("enemy", definition, enemySpawns[index]!, `e-${definition.id}`);
      enemy.deployed = index < 2;
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
      teamPalette: team === "player" ? DEFAULT_TEAM_PALETTES.pine : team === "enemy" ? DEFAULT_TEAM_PALETTES.enemy : DEFAULT_TEAM_PALETTES.neutral,
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
      position: { ...position },
      hitPoints: definition.maxHitPoints,
      attackCooldownMs: team === "player" ? 0 : 700 + this.actors.length * 35,
      skillCooldownMs: team === "player" ? 0 : definition.activeAbility.cooldownMs * 0.55,
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

  private updateActor(actor: ShowcaseActor, seconds: number): void {
    if (this.ended) return;
    if (actor.team === "enemy" && (!actor.deployed || this.director.state.phase === "preparation")) {
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
      actor.aiDecisionCooldownMs = 900;
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
    const slow = this.hasStatus(actor, "slow") ? 0.58 : 1;
    const terrainCost = getBattleTile(actor.position)?.moveCost ?? 1;
    const step = Math.min(distance, actor.definition.moveSpeed * slow / Math.max(0.82, terrainCost) * seconds);
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
      const damage = calculateDamage({
        baseDamage: attacker.definition.baseDamage,
        armor: target.definition.armor,
        counterMultiplier,
        skillMultiplier,
        statusMultiplier: (this.hasStatus(target, "guard") || this.hasStatus(target, "shield") ? 0.62 : 1) * coverMultiplier,
        armorBreak: this.hasStatus(target, "break") || this.hasStatus(target, "sunder") ? 10 : 0,
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
        for (const status of ability.statusEffects) actor.statuses.set(String(status), 3_200);
        actor.statuses.set("guard", 3_200);
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
      target.statuses.set(String(status), 2_800);
    }
    const fallback = ({
      archer: "slow",
      mage: "burn",
      musketeer: "armorBreak",
      warrior: "stagger",
      boarRider: "stun",
      heavyCrossbowman: "root",
    } as Readonly<Record<string, string>>)[source.contentId];
    if (fallback) target.statuses.set(fallback, 2_400);
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
    }
  }

  private tickStatuses(actor: ShowcaseActor, deltaMs: number): void {
    for (const [status, remaining] of actor.statuses) {
      const next = remaining - deltaMs;
      if (next <= 0) actor.statuses.delete(status);
      else actor.statuses.set(status, next);
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
    if (this.ended) return;
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
    if (!this.dragStart || !this.selectionBox) return;
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
    if (!this.dragStart || pointer.button !== 0) return;
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
    const event = pointer.event as PointerEvent;
    return event.pointerType === "touch" || this.isCompactLandscape();
  }

  private onKeyboardShortcut(event: KeyboardEvent): void {
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
    this.touchBriefing.hidden = false;
    this.touchControls.classList.add("is-briefing");
    this.input.enabled = false;
  }

  private closeTouchBriefing(): void {
    if (!this.touchBriefing || !this.touchControls) return;
    this.touchBriefing.hidden = true;
    this.touchControls.classList.remove("is-briefing");
    try {
      sessionStorage.setItem("village-siege-touch-briefing-v2", "seen");
    } catch {
      // The game remains playable when session storage is unavailable.
    }
    this.input.enabled = true;
    this.setTouchNotice("點我軍選取，拖空地移鏡");
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
    this.touchControls.querySelectorAll<HTMLElement>("[data-touch-panel-view]").forEach((panel) => {
      panel.hidden = panel.dataset.touchPanelView !== this.touchPanel;
    });
    this.touchControls.querySelectorAll<HTMLButtonElement>("[data-touch-mode]").forEach((button) => {
      const active = button.dataset.touchMode === this.touchMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
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
      if (this.touchReadout.value !== this.touchNotice) this.touchReadout.value = this.touchNotice;
      return;
    }
    this.touchNotice = "";
    const count = this.getSelectedActors().length;
    const label = ({
      smart: count > 0
        ? `智慧指令｜已選 ${count} 人｜點地移動・點敵攻擊・拖地移鏡`
        : "智慧指令｜點我軍選取・拖空地移鏡",
      move: count > 0 ? `移動模式｜點目的地（${count} 人）` : "移動模式｜請先選取部隊",
      attack: count > 0 ? `攻擊模式｜點敵軍或野怪（${count} 人）` : "攻擊模式｜請先選取部隊",
      box: "框選模式｜拖過我軍，放開即完成",
      pan: "移鏡模式｜拖曳戰場；再點一次移鏡可結束",
    } as const)[this.touchMode];
    if (this.touchReadout.value !== label) this.touchReadout.value = label;
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
    return window.matchMedia("(orientation: landscape) and (max-height: 520px)").matches;
  }

  private applyResponsiveInterface(): void {
    const compact = this.isCompactLandscape();
    this.interfacePanel?.clear();
    this.interfacePanel?.fillStyle(0x111a17, 0.94).fillRect(16, 14, 1248, compact ? 92 : 76);
    this.interfacePanel?.lineStyle(2, 0xd2c383, 0.75).strokeRect(16, 14, 1248, compact ? 92 : 76);
    this.instructionText
      ?.setPosition(36, 24)
      .setFontSize(compact ? 21 : 16)
      .setText(compact
        ? "手機指揮：點我軍選取・點地移動・點敵攻擊・拖空地移鏡　需要精準操作可切換下方模式"
        : "框選／Shift 複選　右鍵移動／攻擊　Q 全隊技能　F 切換隊形　Ctrl+1–3 編隊　WASD 移鏡頭");
    this.scoreText?.setPosition(36, compact ? 61 : 52).setFontSize(compact ? 19 : 15);
    this.selectionText
      ?.setPosition(compact ? 288 : 24, compact ? 535 : 640)
      .setFontSize(compact ? 20 : 15)
      .setWordWrapWidth(compact ? 410 : 920)
      .setVisible(!compact);
    this.syncTouchControls();
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
    actor.actionLockMs = 500;
    actor.visual.container.setVisible(true).setActive(true).setAlpha(1).setScale(1);
    actor.visual.container.setInteractive({ useHandCursor: true }).setData("showcaseActorId", actor.instanceId);
    actor.teamMark.setVisible(true);
    actor.visual.play("idle", true);
    this.positionActor(actor);
    spawnFloatingText(this, { x: actor.visual.container.x, y: actor.visual.container.y - 82 }, "我方增援", "#a8efd2");
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
    const choice = this.director.rankAiTargets(candidates)[0];
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
    this.scoreText?.setText(
      `${phase}${state.phase === "preparation" ? ` ${seconds}s` : ""}　勝點 我方 ${state.score.player}：${state.score.enemy} 敵方　` +
      `西台 ${this.controllerLabel(state.objectives.westBeacon.controller)}　東台 ${this.controllerLabel(state.objectives.eastBeacon.controller)}　敵壓 ${Math.round(state.enemyPressure * 100)}%`,
    );
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

  private hasStatus(actor: ShowcaseActor, fragment: string): boolean {
    const needle = fragment.toLowerCase();
    return [...actor.statuses.keys()].some((status) => status.toLowerCase().includes(needle));
  }

  private isRooted(actor: ShowcaseActor): boolean {
    return this.hasStatus(actor, "root") || this.hasStatus(actor, "stun");
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
    this.scene.restart({ returnScene: this.returnScene });
  }

  private leaveShowcase(): void {
    this.scene.start(this.returnScene);
  }

  private cleanup(): void {
    this.input.off("pointerdown", this.onPointerDown, this);
    this.input.off("pointermove", this.onPointerMove, this);
    this.input.off("pointerup", this.onPointerUp, this);
    this.input.keyboard?.off("keydown-Q", this.onSkillKey, this);
    this.input.keyboard?.off("keydown-R", this.restartBattle, this);
    this.input.keyboard?.off("keydown-ESC", this.leaveShowcase, this);
    this.input.keyboard?.off("keydown", this.onKeyboardShortcut, this);
    window.removeEventListener("resize", this.onViewportResize);
    this.touchControls?.remove();
    this.touchControls = undefined;
    this.touchReadout = undefined;
    this.touchBriefing = undefined;
    this.touchCameraDrag = undefined;
    this.touchDidPan = false;
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
