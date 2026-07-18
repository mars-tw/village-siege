import Phaser from "phaser";
import type { AiPersonality } from "@village-siege/shared";
import { MAP_SIZE, UNIT_STATS, VILLAGES, getVillage, type UnitKind, type VillageId } from "../game/content";
import { TILE_HEIGHT, TILE_WIDTH, clampGrid, gridDistance, gridToWorld, worldToGrid, type GridPoint, type ScreenPoint } from "../game/isometric";

interface MatchData { villageId?: VillageId; aiPersonality?: AiPersonality }
interface HudApi {
  updateResources(resources: { food: number; wood: number; stone: number }): void;
  updateSelection(selection: unknown | null): void;
  setStatus(message: string, tone?: string): void;
  destroy(): void;
}
type HudFactory = (scene: Phaser.Scene) => HudApi;

interface Actor {
  id: string;
  owner: VillageId;
  kind: "unit" | "building";
  type: UnitKind | "townHall" | "barracks";
  name: string;
  position: GridPoint;
  target?: GridPoint;
  attackTarget?: string;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;
  cooldown: number;
  view: Phaser.GameObjects.Container;
  selection: Phaser.GameObjects.Graphics;
  health: Phaser.GameObjects.Graphics;
}

const ORIGIN: ScreenPoint = { x: 1312, y: 160 };
const WORLD_SIZE = { width: 2800, height: 1600 };

export class MatchScene extends Phaser.Scene {
  private playerVillage: VillageId = "pinehold";
  private aiPersonality: AiPersonality = "balanced";
  private actors: Actor[] = [];
  private selected: Actor | null = null;
  private hud?: HudApi;
  private resources = { food: 420, wood: 360, stone: 240 };
  private draggingCamera = false;
  private lastPointer = { x: 0, y: 0 };
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private economyTimer = 0;

  constructor() { super("MatchScene"); }

  init(data: MatchData): void {
    this.playerVillage = getVillage(data.villageId ?? "pinehold").id;
    this.aiPersonality = data.aiPersonality ?? "balanced";
    this.actors = [];
    this.selected = null;
    this.resources = { food: 420, wood: 360, stone: 240 };
  }

  create(): void {
    this.drawMap();
    for (const village of VILLAGES) this.createVillage(village.id);

    const hudFactory = this.registry.get("createHud") as HudFactory | undefined;
    this.hud = hudFactory?.(this);
    this.hud?.updateResources(this.resources);
    this.hud?.setStatus(`${getVillage(this.playerVillage).name} 已整軍，對手採用${this.aiLabel()}戰術。左鍵選取／移動，右鍵或空白鍵拖曳視野。`, "info");

    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_SIZE.width, WORLD_SIZE.height);
    camera.setZoom(0.82);
    const home = gridToWorld(getVillage(this.playerVillage).spawn, ORIGIN);
    camera.centerOn(home.x, home.y);
    camera.fadeIn(350, 8, 16, 15);

    this.input.mouse?.disableContextMenu();
    this.spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.hud?.destroy());

  }

  update(_time: number, delta: number): void {
    const seconds = Math.min(delta, 50) / 1000;
    for (const actor of [...this.actors]) {
      actor.cooldown = Math.max(0, actor.cooldown - seconds);
      if (actor.kind === "unit") this.updateUnit(actor, seconds);
      else this.updateDefense(actor);
      this.positionActor(actor);
    }

    this.economyTimer += seconds;
    if (this.economyTimer >= 2.5) {
      this.economyTimer = 0;
      this.resources.food += 8;
      this.resources.wood += 6;
      this.resources.stone += 3;
      this.hud?.updateResources(this.resources);
    }
  }

  private drawMap(): void {
    const map = this.add.graphics().setDepth(-10000);
    for (let y = 0; y < MAP_SIZE.height; y += 1) {
      for (let x = 0; x < MAP_SIZE.width; x += 1) {
        const center = gridToWorld({ x, y }, ORIGIN);
        const variation = (x * 19 + y * 31 + x * y * 7) % 11;
        const road = Math.abs(x - y) <= 1 || Math.abs(x + y - 23) <= 1;
        const color = road ? (variation < 4 ? 0x9a8d67 : 0xa79870) : (variation < 3 ? 0x537c55 : variation < 7 ? 0x5f895c : 0x6c9462);
        map.fillStyle(color, 1);
        map.lineStyle(1, 0x294a3b, 0.34);
        map.beginPath();
        map.moveTo(center.x, center.y - TILE_HEIGHT / 2);
        map.lineTo(center.x + TILE_WIDTH / 2, center.y);
        map.lineTo(center.x, center.y + TILE_HEIGHT / 2);
        map.lineTo(center.x - TILE_WIDTH / 2, center.y);
        map.closePath();
        map.fillPath();
        map.strokePath();
        if (!road && variation === 0) {
          map.fillStyle(0x315f46, 0.8).fillCircle(center.x - 8, center.y - 3, 3);
          map.fillStyle(0xd6c67a, 0.75).fillCircle(center.x + 4, center.y + 5, 2);
        }
      }
    }

    for (const village of VILLAGES) {
      const center = gridToWorld(village.spawn, ORIGIN);
      map.lineStyle(5, village.primary, 0.55).strokeEllipse(center.x, center.y, 610, 290);
      map.lineStyle(1, village.secondary, 0.5).strokeEllipse(center.x, center.y, 630, 304);
    }
  }

  private createVillage(owner: VillageId): void {
    const village = getVillage(owner);
    this.addBuilding(owner, "townHall", village.spawn, `${village.name}議事堂`);
    this.addBuilding(owner, "barracks", { x: village.spawn.x + 1.4, y: village.spawn.y + 0.3 }, "守備營");
    const offsets: readonly GridPoint[] = [
      { x: -1.2, y: 0.4 }, { x: -0.5, y: 1.25 }, { x: 0.55, y: 1.15 },
      { x: 1.15, y: -0.8 }, { x: -0.8, y: -1.1 }, { x: 0.3, y: -1.25 }
    ];
    offsets.forEach((offset, index) => {
      const type: UnitKind = index % 3 === 0 ? "archer" : index % 2 === 0 ? "scout" : "guard";
      this.addUnit(owner, type, { x: village.spawn.x + offset.x, y: village.spawn.y + offset.y }, index);
    });
  }

  private addBuilding(owner: VillageId, type: "townHall" | "barracks", position: GridPoint, name: string): void {
    const village = getVillage(owner);
    const selection = this.add.graphics().lineStyle(3, 0xffe69a, 0.95).strokeEllipse(0, 0, type === "townHall" ? 112 : 84, 48).setVisible(false);
    const art = this.add.graphics();
    const width = type === "townHall" ? 74 : 55;
    const height = type === "townHall" ? 58 : 42;
    art.fillStyle(0x10241e, 0.3).fillEllipse(0, 4, width + 38, 30);
    art.fillStyle(village.secondary).fillRect(-width / 2, -height, width, height);
    art.lineStyle(2, 0x493a2c, 0.8).strokeRect(-width / 2, -height, width, height);
    art.fillStyle(village.roof).beginPath();
    art.moveTo(-width / 2 - 12, -height + 4).lineTo(0, -height - 35).lineTo(width / 2 + 12, -height + 4).closePath().fillPath();
    art.fillStyle(0x3b2a22).fillRect(-8, -24, 16, 24);
    if (type === "townHall") {
      art.lineStyle(3, 0xd9c997).lineBetween(0, -height - 34, 0, -height - 65);
      art.fillStyle(village.primary).fillTriangle(1, -height - 64, 28, -height - 54, 1, -height - 44);
      art.fillStyle(0xf2d89c).fillCircle(-20, -height / 2, 5).fillCircle(20, -height / 2, 5);
    }
    const health = this.add.graphics();
    const view = this.add.container(0, 0, [selection, art, health]).setSize(width + 30, height + 60).setInteractive({ useHandCursor: true });
    const maxHp = type === "townHall" ? 1000 : 520;
    const actor: Actor = { id: `${owner}-${type}`, owner, kind: "building", type, name, position: { ...position }, hp: maxHp, maxHp, damage: type === "townHall" ? 19 : 9, range: type === "townHall" ? 4 : 3, speed: 0, cooldown: 0, view, selection, health };
    view.setData("actorId", actor.id);
    this.actors.push(actor);
    this.positionActor(actor);
  }

  private addUnit(owner: VillageId, type: UnitKind, position: GridPoint, index: number): void {
    const village = getVillage(owner);
    const stats = UNIT_STATS[type];
    const selection = this.add.graphics().lineStyle(3, 0xffe69a, 1).strokeEllipse(0, 1, 38, 17).setVisible(false);
    const art = this.add.graphics();
    art.fillStyle(0x10241e, 0.35).fillEllipse(0, 3, 31, 13);
    art.fillStyle(village.primary).fillCircle(0, -18, type === "guard" ? 10 : 8);
    art.fillStyle(village.secondary).fillTriangle(-10, -8, 10, -8, 0, -29);
    art.fillStyle(0xe7cba0).fillCircle(0, -31, 6);
    art.lineStyle(3, type === "archer" ? 0xe6d190 : 0xbfcbd1).lineBetween(8, -25, type === "archer" ? 13 : 8, type === "archer" ? -2 : -48);
    const health = this.add.graphics();
    const view = this.add.container(0, 0, [selection, art, health]).setSize(38, 52).setInteractive({ useHandCursor: true });
    const actor: Actor = { id: `${owner}-${type}-${index}`, owner, kind: "unit", type, name: stats.name, position: { ...position }, hp: stats.hp, maxHp: stats.hp, damage: stats.attack, range: stats.range, speed: stats.speed, cooldown: index * 0.08, view, selection, health };
    view.setData("actorId", actor.id);
    this.actors.push(actor);
    this.positionActor(actor);
  }

  private updateUnit(actor: Actor, seconds: number): void {
    const assigned = actor.attackTarget ? this.findActor(actor.attackTarget) : undefined;
    const nearby = this.nearestEnemy(actor, actor.range + 0.2);
    const combatTarget = nearby ?? assigned;

    if (combatTarget) {
      const distance = gridDistance(actor.position, combatTarget.position);
      if (distance <= actor.range) {
        actor.target = undefined;
        this.attack(actor, combatTarget);
        return;
      }
      if (actor.owner !== this.playerVillage || actor.attackTarget) actor.target = { ...combatTarget.position };
    } else if (actor.owner !== this.playerVillage) {
      const objective = this.aiObjective(actor);
      if (objective) actor.target = { ...objective.position };
    }

    if (!actor.target) return;
    const dx = actor.target.x - actor.position.x;
    const dy = actor.target.y - actor.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.06) { actor.target = undefined; return; }
    const step = Math.min(distance, actor.speed * seconds);
    actor.position.x += (dx / distance) * step;
    actor.position.y += (dy / distance) * step;
  }

  private updateDefense(actor: Actor): void {
    if (actor.cooldown > 0) return;
    const target = this.nearestEnemy(actor, actor.range, true);
    if (target) this.attack(actor, target);
  }

  private attack(attacker: Actor, target: Actor): void {
    if (attacker.cooldown > 0 || target.hp <= 0) return;
    attacker.cooldown = attacker.kind === "building" ? 1.2 : 0.85;
    const village = getVillage(attacker.owner);
    const shot = this.add.circle(attacker.view.x, attacker.view.y - 28, 4, village.secondary).setDepth(9999);
    this.tweens.add({ targets: shot, x: target.view.x, y: target.view.y - 22, duration: 180, onComplete: () => shot.destroy() });
    target.hp = Math.max(0, target.hp - attacker.damage);
    this.drawHealth(target);
    if (this.selected === target) this.showSelection(target);
    if (target.hp === 0) this.removeActor(target, attacker.owner);
  }

  private removeActor(actor: Actor, winner: VillageId): void {
    actor.view.destroy();
    this.actors = this.actors.filter((candidate) => candidate !== actor);
    if (this.selected === actor) this.select(null);
    if (actor.type === "townHall") {
      this.hud?.setStatus(`${actor.name} 已陷落！${getVillage(winner).name}取得戰場優勢。`, winner === this.playerVillage ? "success" : "danger");
    }
  }

  private nearestEnemy(actor: Actor, range: number, unitsOnly = false): Actor | undefined {
    let best: Actor | undefined;
    let bestDistance = range;
    for (const candidate of this.actors) {
      if (candidate.owner === actor.owner || (unitsOnly && candidate.kind !== "unit")) continue;
      const distance = gridDistance(actor.position, candidate.position);
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    return best;
  }

  private nearestEnemyTown(actor: Actor): Actor | undefined {
    return this.actors.filter((candidate) => candidate.type === "townHall" && candidate.owner !== actor.owner)
      .sort((a, b) => gridDistance(actor.position, a.position) - gridDistance(actor.position, b.position))[0];
  }

  private aiObjective(actor: Actor): Actor | undefined {
    const elapsed = this.time.now;
    if (this.aiPersonality === "guardian") {
      const home = this.actors.find((candidate) => candidate.owner === actor.owner && candidate.type === "townHall");
      if (!home) return this.nearestEnemyTown(actor);
      return this.actors
        .filter((candidate) => candidate.owner !== actor.owner && gridDistance(home.position, candidate.position) <= 6)
        .sort((left, right) => gridDistance(actor.position, left.position) - gridDistance(actor.position, right.position))[0];
    }
    if (this.aiPersonality === "prosperer" && elapsed < 25_000) return undefined;
    if (this.aiPersonality === "balanced" && elapsed < 12_000) return undefined;
    if (this.aiPersonality === "raider") {
      const exposedUnit = this.actors
        .filter((candidate) => candidate.owner !== actor.owner && candidate.kind === "unit")
        .sort((left, right) => gridDistance(actor.position, left.position) - gridDistance(actor.position, right.position))[0];
      return exposedUnit ?? this.nearestEnemyTown(actor);
    }
    return this.nearestEnemyTown(actor);
  }

  private aiLabel(): string {
    return ({
      aggressor: "快速進攻",
      guardian: "據點守備",
      prosperer: "先經濟後進攻",
      balanced: "穩健發展",
      raider: "機動襲擾",
    } satisfies Record<AiPersonality, string>)[this.aiPersonality];
  }

  private findActor(id: string): Actor | undefined { return this.actors.find((actor) => actor.id === id); }

  private positionActor(actor: Actor): void {
    const world = gridToWorld(actor.position, ORIGIN);
    actor.view.setPosition(world.x, world.y).setDepth(Math.floor(world.y * 10 + actor.position.x));
    this.drawHealth(actor);
  }

  private drawHealth(actor: Actor): void {
    actor.health.clear();
    if (actor.hp >= actor.maxHp) return;
    const width = actor.kind === "building" ? 62 : 32;
    const y = actor.kind === "building" ? -88 : -46;
    actor.health.fillStyle(0x251b18, 0.9).fillRect(-width / 2, y, width, 5);
    actor.health.fillStyle(actor.hp / actor.maxHp > 0.35 ? 0x75c56d : 0xd75b4c, 1).fillRect(-width / 2 + 1, y + 1, (width - 2) * actor.hp / actor.maxHp, 3);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (pointer.button !== 0 || this.spaceKey?.isDown) {
      this.draggingCamera = true;
      this.lastPointer = { x: pointer.x, y: pointer.y };
      return;
    }
    if (pointer.y < 112) return;
    const clicked = over.map((object) => this.findActor(String(object.getData("actorId") ?? ""))).find(Boolean);
    if (clicked) {
      if (clicked.owner === this.playerVillage) this.select(clicked);
      else if (this.selected?.kind === "unit") {
        this.selected.attackTarget = clicked.id;
        this.selected.target = { ...clicked.position };
        this.hud?.setStatus(`命令 ${this.selected.name} 攻擊 ${clicked.name}`, "warning");
      }
      return;
    }
    if (!this.selected || this.selected.kind !== "unit") return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.selected.target = clampGrid(worldToGrid(world, ORIGIN), MAP_SIZE.width, MAP_SIZE.height);
    this.selected.attackTarget = undefined;
    this.hud?.setStatus(`${this.selected.name} 正在前往指定位置。`, "info");
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.draggingCamera || !pointer.isDown) return;
    const camera = this.cameras.main;
    camera.scrollX -= (pointer.x - this.lastPointer.x) / camera.zoom;
    camera.scrollY -= (pointer.y - this.lastPointer.y) / camera.zoom;
    this.lastPointer = { x: pointer.x, y: pointer.y };
  }

  private onPointerUp(): void { this.draggingCamera = false; }

  private onWheel(pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number): void {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(pointer.x, pointer.y);
    camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.001, 0.55, 1.35));
    const after = camera.getWorldPoint(pointer.x, pointer.y);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
  }

  private select(actor: Actor | null): void {
    if (this.selected) this.selected.selection.setVisible(false);
    this.selected = actor;
    if (actor) actor.selection.setVisible(true);
    this.showSelection(actor);
  }

  private showSelection(actor: Actor | null): void {
    this.hud?.updateSelection(actor ? {
      id: actor.id, name: actor.name, owner: getVillage(actor.owner).name,
      kind: actor.kind === "unit" ? "單位" : "建築", hitPoints: actor.hp,
      maxHitPoints: actor.maxHp, attack: actor.damage, range: actor.range
    } : null);
  }
}
