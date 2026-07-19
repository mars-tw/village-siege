import Phaser from "phaser";
import type {
  BuildingEntityState,
  BuildingType,
  ResourceEntityState,
  ResourceKind,
} from "@village-siege/shared";

export type AssaultSide = "player" | "enemy";

export interface AssaultEntityView {
  readonly container: Phaser.GameObjects.Container;
  update(entity: BuildingEntityState | ResourceEntityState, selected?: boolean): void;
  setCompact(compact: boolean): void;
  destroy(): void;
}

const INK = 0x101917;
const CHALK = 0xf0ebcf;
const TIMBER = 0x4b3428;
const TIMBER_LIGHT = 0x8a6748;
const STONE = 0x7b7b70;
const STONE_LIGHT = 0xb5af96;
const COPPER = 0xe0b866;
const PLAYER = 0x315e4d;
const ENEMY = 0x8f3b3a;

const BUILDING_LABELS: Readonly<Record<BuildingType, string>> = {
  townCenter: "村鎮議事堂",
  house: "拓荒家屋",
  lumberCamp: "木作營",
  farmstead: "糧秣所",
  barracks: "邊軍兵營",
  defenseTower: "守望塔",
};

const RESOURCE_LABELS: Readonly<Record<ResourceKind, string>> = {
  food: "糧食堆",
  wood: "林木",
  stone: "石礦",
};

export function buildingDisplayName(type: BuildingType): string {
  return BUILDING_LABELS[type];
}

export function resourceDisplayName(type: ResourceKind): string {
  return RESOURCE_LABELS[type];
}

export function createBuildingView(
  scene: Phaser.Scene,
  entity: BuildingEntityState,
  side: AssaultSide,
): AssaultEntityView {
  const shadow = scene.add.ellipse(0, 11, footprintWidth(entity.typeId), footprintHeight(entity.typeId), INK, 0.34);
  const selection = scene.add.graphics();
  const art = scene.add.graphics();
  const healthBack = scene.add.rectangle(0, -82, 92, 8, INK, 0.88).setOrigin(0.5);
  const health = scene.add.rectangle(-44, -82, 88, 4, side === "player" ? 0x79b879 : 0xd8725f).setOrigin(0, 0.5);
  const label = scene.add.text(0, 25, BUILDING_LABELS[entity.typeId], {
    color: "#f0ebcf",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "13px",
    fontStyle: "bold",
    backgroundColor: "#101917cc",
    padding: { x: 5, y: 2 },
  }).setOrigin(0.5, 0).setResolution(2);
  const progress = scene.add.text(0, -68, "", {
    color: "#e0b866",
    fontFamily: "Consolas, monospace",
    fontSize: "12px",
    fontStyle: "bold",
    backgroundColor: "#101917cc",
    padding: { x: 4, y: 2 },
  }).setOrigin(0.5).setResolution(2);
  const container = scene.add.container(0, 0, [shadow, selection, art, healthBack, health, label, progress]);
  container.setName(`assault-building:${entity.id}`).setSize(110, 120);
  let lastRevision = -1;
  let lastSelected = false;

  const update = (next: BuildingEntityState | ResourceEntityState, selected = false): void => {
    if (next.kind !== "building") return;
    if (next.stateRevision !== lastRevision) {
      art.clear();
      drawBuilding(art, next.typeId, side, completionRatio(next), next.hitPoints / next.maxHitPoints);
      const ratio = Phaser.Math.Clamp(next.hitPoints / next.maxHitPoints, 0, 1);
      health.setDisplaySize(88 * ratio, 4);
      lastRevision = next.stateRevision;
    }
    const progressLabel = next.complete ? queueText(next.trainingQueue) : `施工 ${Math.floor(completionRatio(next) * 100)}%`;
    if (progress.text !== progressLabel) progress.setText(progressLabel);
    progress.setVisible(!next.complete || next.trainingQueue.length > 0);
    if (selected !== lastSelected) {
      selection.clear();
      if (selected) {
        selection.lineStyle(3, COPPER, 0.95).strokeEllipse(0, 10, footprintWidth(next.typeId) + 12, footprintHeight(next.typeId) + 10);
      }
      lastSelected = selected;
    }
    healthBack.setVisible(next.hitPoints < next.maxHitPoints || selected);
    health.setVisible(next.hitPoints < next.maxHitPoints || selected);
  };
  update(entity);
  return {
    container,
    update,
    setCompact: (compact) => label.setVisible(!compact),
    destroy: () => container.destroy(true),
  };
}

export function createResourceView(scene: Phaser.Scene, entity: ResourceEntityState): AssaultEntityView {
  const shadow = scene.add.ellipse(0, 9, 74, 27, INK, 0.28);
  const selection = scene.add.graphics();
  const art = scene.add.graphics();
  const label = scene.add.text(0, 29, RESOURCE_LABELS[entity.typeId], {
    color: "#dce9c6",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "12px",
    fontStyle: "bold",
    backgroundColor: "#101917b8",
    padding: { x: 4, y: 2 },
  }).setOrigin(0.5, 0).setResolution(2);
  const amount = scene.add.text(0, -47, "", {
    color: "#f0ebcf",
    fontFamily: "Consolas, monospace",
    fontSize: "11px",
    fontStyle: "bold",
  }).setOrigin(0.5).setResolution(2);
  const container = scene.add.container(0, 0, [shadow, selection, art, label, amount]);
  container.setName(`assault-resource:${entity.id}`).setSize(84, 88);
  let lastRevision = -1;
  let lastSelected = false;
  const update = (next: BuildingEntityState | ResourceEntityState, selected = false): void => {
    if (next.kind !== "resource") return;
    if (next.stateRevision !== lastRevision) {
      art.clear();
      drawResource(art, next.typeId, Phaser.Math.Clamp(next.amount / next.maxHitPoints, 0, 1));
      amount.setText(`${Math.max(0, Math.ceil(next.amount))}`);
      lastRevision = next.stateRevision;
    }
    if (selected !== lastSelected) {
      selection.clear();
      if (selected) selection.lineStyle(3, COPPER, 0.95).strokeEllipse(0, 8, 86, 36);
      lastSelected = selected;
    }
  };
  update(entity);
  return {
    container,
    update,
    setCompact: (compact) => {
      label.setVisible(!compact);
      amount.setVisible(!compact);
    },
    destroy: () => container.destroy(true),
  };
}

export function drawBuildGhost(
  graphics: Phaser.GameObjects.Graphics,
  type: BuildingType,
  valid: boolean,
): void {
  graphics.clear();
  drawIsoDiamond(graphics, footprintWidth(type), footprintHeight(type), valid ? 0x89b879 : 0xc85c4a, 0.28, valid ? 0xb7e4a7 : 0xff9d86);
  graphics.lineStyle(3, valid ? 0xb7e4a7 : 0xff9d86, 0.95).strokeEllipse(0, 5, footprintWidth(type) + 12, footprintHeight(type) + 8);
}

function completionRatio(entity: BuildingEntityState): number {
  if (entity.complete) return 1;
  return Phaser.Math.Clamp(entity.hitPoints / entity.maxHitPoints, 0.08, 0.99);
}

function queueText(queue: BuildingEntityState["trainingQueue"]): string {
  if (queue.length === 0) return "";
  return `訓練 ${queue.length} · ${Math.ceil(queue[0]!.remainingTicks / 10)}s`;
}

function footprintWidth(type: BuildingType): number {
  if (type === "townCenter") return 122;
  if (type === "barracks" || type === "farmstead") return 104;
  return 82;
}

function footprintHeight(type: BuildingType): number {
  return type === "townCenter" ? 47 : type === "barracks" || type === "farmstead" ? 40 : 32;
}

function drawBuilding(
  g: Phaser.GameObjects.Graphics,
  type: BuildingType,
  side: AssaultSide,
  completion: number,
  healthRatio: number,
): void {
  const accent = side === "player" ? PLAYER : ENEMY;
  const width = footprintWidth(type);
  const height = footprintHeight(type);
  drawIsoDiamond(g, width, height, STONE, 1, INK);
  if (completion < 0.34) {
    drawScaffolding(g, width, -2, 35 * completion + 8, accent);
    return;
  }
  if (type === "defenseTower") {
    drawTower(g, accent, completion);
  } else if (type === "townCenter") {
    drawTownCenter(g, accent, completion);
  } else {
    drawHall(g, type, accent, completion);
  }
  if (completion < 1) drawScaffolding(g, width, -6, 55 * completion, accent);
  if (healthRatio < 0.58) drawDamage(g, healthRatio);
}

function drawTownCenter(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const wallHeight = 42 * Math.min(1, (completion - 0.2) / 0.55);
  drawIsoBlock(g, -38, 8, 76, 30, wallHeight, 0xc4b88e, 0x93866b, 0x75684f);
  drawIsoBlock(g, 25, 1, 38, 25, wallHeight + 11, STONE_LIGHT, 0x858478, 0x66635a);
  roof(g, -38, 8 - wallHeight, 84, 37, accent, 0x572d2c);
  roof(g, 25, 1 - wallHeight - 11, 47, 30, accent, 0x572d2c);
  timberFrame(g, -38, 9, 70, wallHeight);
  g.fillStyle(INK, 0.9).fillRect(-7, -23, 14, 31);
  g.fillStyle(COPPER, 1).fillCircle(2, -7, 2.5);
  flag(g, 47, -69, accent);
}

function drawHall(g: Phaser.GameObjects.Graphics, type: BuildingType, accent: number, completion: number): void {
  const wallHeight = (type === "barracks" ? 39 : 33) * Math.min(1, (completion - 0.2) / 0.55);
  const width = type === "barracks" || type === "farmstead" ? 78 : 60;
  drawIsoBlock(g, 0, 7, width, type === "barracks" ? 29 : 25, wallHeight, type === "lumberCamp" ? 0xa88b61 : 0xc6b98e, 0x8b775d, 0x6d5e49);
  roof(g, 0, 7 - wallHeight, width + 12, type === "barracks" ? 34 : 30, accent, 0x4d2e2c);
  timberFrame(g, 0, 8, width - 8, wallHeight);
  if (type === "house") {
    g.fillStyle(0x4a241e, 1).fillRect(-6, -18, 12, 26);
    g.fillStyle(COPPER, 0.9).fillRect(15, -20, 10, 10);
  } else if (type === "lumberCamp") {
    for (let i = 0; i < 4; i += 1) {
      g.lineStyle(7, TIMBER_LIGHT, 1).lineBetween(-43 + i * 12, 12 + i * 2, -24 + i * 12, -1 + i * 2);
      g.lineStyle(2, INK, 0.7).strokeCircle(-43 + i * 12, 12 + i * 2, 4);
    }
  } else if (type === "farmstead") {
    g.fillStyle(0xb89543, 1).fillEllipse(-32, 11, 24, 10).fillEllipse(30, 8, 22, 9);
    g.lineStyle(2, 0x6c4b2d, 1).lineBetween(-40, 9, -27, -2).lineBetween(36, 8, 23, -3);
  } else if (type === "barracks") {
    g.fillStyle(INK, 0.92).fillRect(-8, -24, 16, 32);
    g.lineStyle(4, COPPER, 1).lineBetween(27, -34, 38, -3).lineBetween(38, -34, 27, -3);
    flag(g, 39, -56, accent);
  }
}

function drawTower(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const height = 70 * Math.min(1, (completion - 0.15) / 0.7);
  drawIsoBlock(g, 0, 7, 38, 25, height, STONE_LIGHT, 0x797b73, 0x62645d);
  drawIsoDiamondAt(g, 0, 7 - height, 54, 28, accent, 1, INK);
  for (const x of [-21, -7, 7, 21]) g.fillStyle(STONE_LIGHT, 1).fillRect(x - 4, -height - 8, 8, 15);
  g.fillStyle(INK, 0.9).fillRect(-4, -height + 10, 8, 18);
  flag(g, 9, -height - 37, accent);
}

function drawResource(g: Phaser.GameObjects.Graphics, type: ResourceKind, ratio: number): void {
  const count = Math.max(1, Math.ceil(4 * ratio));
  if (type === "wood") {
    for (let index = 0; index < count; index += 1) {
      const x = [-24, -7, 18, 31][index]!;
      const y = [3, -8, 5, -3][index]!;
      g.fillStyle(TIMBER, 1).fillRect(x - 4, y - 32, 8, 35);
      g.fillStyle(0x284b37, 1).fillTriangle(x, y - 68, x - 23, y - 25, x + 23, y - 25);
      g.fillStyle(0x3e6848, 1).fillTriangle(x, y - 57, x - 20, y - 34, x + 21, y - 34);
      g.lineStyle(2, 0x162b22, 0.8).strokeTriangle(x, y - 68, x - 23, y - 25, x + 23, y - 25);
    }
  } else if (type === "stone") {
    for (let index = 0; index < count + 1; index += 1) {
      const x = [-29, -12, 9, 28, 2][index]!;
      const y = [4, -7, 5, -1, -16][index]!;
      g.fillStyle(index % 2 === 0 ? STONE_LIGHT : STONE, 1)
        .fillTriangle(x - 15, y + 10, x + 13, y + 7, x + 5, y - 20);
      g.lineStyle(2, 0x55584f, 0.9).strokeTriangle(x - 15, y + 10, x + 13, y + 7, x + 5, y - 20);
    }
  } else {
    g.fillStyle(0x7f5b32, 1).fillEllipse(0, 8, 68, 24);
    for (let index = 0; index < count * 3; index += 1) {
      const x = -29 + (index % 6) * 12;
      const y = 7 - Math.floor(index / 6) * 12;
      g.lineStyle(3, 0xc29c43, 1).lineBetween(x, y + 4, x + (index % 2 ? 4 : -4), y - 16);
      g.fillStyle(0xe0c56b, 1).fillEllipse(x + (index % 2 ? 3 : -3), y - 12, 7, 12);
    }
    g.fillStyle(0x6b4228, 1).fillRect(-33, -3, 15, 19).fillRect(19, 0, 18, 16);
    g.lineStyle(2, COPPER, 0.8).strokeRect(-33, -3, 15, 19).strokeRect(19, 0, 18, 16);
  }
}

function drawIsoDiamond(g: Phaser.GameObjects.Graphics, width: number, height: number, fill: number, alpha: number, stroke: number): void {
  drawIsoDiamondAt(g, 0, 8, width, height, fill, alpha, stroke);
}

function drawIsoDiamondAt(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, fill: number, alpha: number, stroke: number): void {
  g.fillStyle(fill, alpha).beginPath().moveTo(x, y - height / 2).lineTo(x + width / 2, y).lineTo(x, y + height / 2).lineTo(x - width / 2, y).closePath().fillPath();
  g.lineStyle(2, stroke, 0.85).beginPath().moveTo(x, y - height / 2).lineTo(x + width / 2, y).lineTo(x, y + height / 2).lineTo(x - width / 2, y).closePath().strokePath();
}

function drawIsoBlock(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, depth: number, height: number, front: number, right: number, left: number): void {
  const halfW = width / 2;
  const halfD = depth / 2;
  polygon(g, left, [[x - halfW, y], [x, y + halfD], [x, y + halfD - height], [x - halfW, y - height]]);
  polygon(g, right, [[x, y + halfD], [x + halfW, y], [x + halfW, y - height], [x, y + halfD - height]]);
  polygon(g, front, [[x, y - halfD - height], [x + halfW, y - height], [x, y + halfD - height], [x - halfW, y - height]]);
  g.lineStyle(2, INK, 0.72).lineBetween(x - halfW, y, x, y + halfD).lineBetween(x, y + halfD, x + halfW, y);
}

function roof(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, depth: number, color: number, shade: number): void {
  const ridgeY = y - depth * 0.72;
  polygon(g, color, [[x, ridgeY], [x + width / 2, y], [x, y + depth / 2], [x - width / 2, y]]);
  polygon(g, shade, [[x, ridgeY], [x + width / 2, y], [x, y + depth / 2]]);
  g.lineStyle(2, INK, 0.85).lineBetween(x, ridgeY, x - width / 2, y).lineBetween(x, ridgeY, x + width / 2, y);
}

function timberFrame(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
  if (height < 8) return;
  g.lineStyle(4, TIMBER, 1)
    .lineBetween(x - width / 2 + 8, y - height + 4, x - width / 2 + 8, y - 1)
    .lineBetween(x + width / 2 - 8, y - height + 4, x + width / 2 - 8, y - 1)
    .lineBetween(x - width / 2 + 8, y - height + 7, x + width / 2 - 8, y - 1)
    .lineBetween(x + width / 2 - 8, y - height + 7, x - width / 2 + 8, y - 1);
}

function drawScaffolding(g: Phaser.GameObjects.Graphics, width: number, y: number, height: number, accent: number): void {
  g.lineStyle(4, TIMBER_LIGHT, 0.95);
  for (const x of [-width / 2 + 6, width / 2 - 6]) g.lineBetween(x, y + 13, x, y - height);
  g.lineBetween(-width / 2 + 3, y - height * 0.55, width / 2 - 3, y - height * 0.55);
  g.lineBetween(-width / 2 + 3, y, width / 2 - 3, y - height);
  g.fillStyle(accent, 0.92).fillRect(-17, y - height - 7, 34, 9);
}

function drawDamage(g: Phaser.GameObjects.Graphics, healthRatio: number): void {
  g.lineStyle(3, 0x37251d, 0.95).lineBetween(-15, -46, -4, -35).lineBetween(-4, -35, -12, -23);
  g.fillStyle(0x2b302d, 0.35 + (0.58 - healthRatio)).fillCircle(18, -58, 13).fillCircle(27, -73, 8);
}

function flag(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.lineStyle(3, INK, 1).lineBetween(x, y + 28, x, y);
  g.fillStyle(color, 1).fillTriangle(x, y, x + 25, y + 8, x, y + 16);
  g.lineStyle(1, COPPER, 0.9).lineBetween(x + 3, y + 4, x + 18, y + 8);
}

function polygon(g: Phaser.GameObjects.Graphics, color: number, points: readonly [number, number][]): void {
  const first = points[0];
  if (!first) return;
  g.fillStyle(color, 1).beginPath().moveTo(first[0], first[1]);
  for (let index = 1; index < points.length; index += 1) g.lineTo(points[index]![0], points[index]![1]);
  g.closePath().fillPath();
}
