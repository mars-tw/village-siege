import Phaser from "phaser";
import type { GridPoint as SharedGridPoint } from "@village-siege/shared";
import { BATTLE_MAP_HEIGHT, BATTLE_MAP_WIDTH, getBattleTile } from "./battleMap";
import { gridToWorld, type ScreenPoint } from "./isometric";

export const VILLAGE_ASSAULT_ORIGIN: ScreenPoint = { x: 780, y: 70 };
export const VILLAGE_ASSAULT_BOUNDS = { x: 0, y: 0, width: 1660, height: 920 } as const;

export interface SettlementOverlay {
  readonly container: Phaser.GameObjects.Container;
  readonly placement: Phaser.GameObjects.Graphics;
  destroy(): void;
}

export function drawSettlementOverlay(scene: Phaser.Scene, origin = VILLAGE_ASSAULT_ORIGIN): SettlementOverlay {
  const zones = scene.add.graphics();
  const props = scene.add.graphics();
  const labels: Phaser.GameObjects.Text[] = [];
  const placement = scene.add.graphics();
  const container = scene.add.container(origin.x, origin.y, [zones, props, ...labels, placement]);
  container.setName("village-assault-settlement-overlay");

  drawBaseBoundary(zones, { x: 2, y: 7 }, 0x315e4d);
  drawBaseBoundary(zones, { x: 15, y: 7 }, 0x8f3b3a);
  drawWorksiteProps(props);
  addSign(scene, container, labels, { x: 2, y: 3 }, "西境營造區", "建屋 · 採集 · 徵召", 0x315e4d);
  addSign(scene, container, labels, { x: 15, y: 11 }, "東境敵寨", "截斷補給 · 摧毀主城", 0x8f3b3a);
  return { container, placement, destroy: () => container.destroy(true) };
}

export function isSettlementBuildable(point: SharedGridPoint): boolean {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) return false;
  if (point.x < 0 || point.y < 0 || point.x >= BATTLE_MAP_WIDTH || point.y >= BATTLE_MAP_HEIGHT) return false;
  const tile = getBattleTile(point);
  if (!tile?.walkable || tile.kind === "shallowWater" || tile.kind === "rock") return false;
  return !(point.x >= 7 && point.x <= 10 && point.y >= 3 && point.y <= 12);
}

export function drawPlacementTile(
  graphics: Phaser.GameObjects.Graphics,
  point: SharedGridPoint | null,
  valid: boolean,
): void {
  graphics.clear();
  if (!point) return;
  const world = gridToWorld(point, { x: 0, y: 0 });
  const color = valid ? 0xa9d18e : 0xf27a64;
  graphics.fillStyle(color, 0.28).beginPath()
    .moveTo(world.x, world.y - 24)
    .lineTo(world.x + 48, world.y)
    .lineTo(world.x, world.y + 24)
    .lineTo(world.x - 48, world.y)
    .closePath().fillPath();
  graphics.lineStyle(4, color, 0.96).beginPath()
    .moveTo(world.x, world.y - 24)
    .lineTo(world.x + 48, world.y)
    .lineTo(world.x, world.y + 24)
    .lineTo(world.x - 48, world.y)
    .closePath().strokePath();
}

function drawBaseBoundary(g: Phaser.GameObjects.Graphics, center: SharedGridPoint, color: number): void {
  const points = [
    gridToWorld({ x: center.x - 3.1, y: center.y - 3.1 }, { x: 0, y: 0 }),
    gridToWorld({ x: center.x + 3.1, y: center.y - 3.1 }, { x: 0, y: 0 }),
    gridToWorld({ x: center.x + 3.1, y: center.y + 3.1 }, { x: 0, y: 0 }),
    gridToWorld({ x: center.x - 3.1, y: center.y + 3.1 }, { x: 0, y: 0 }),
  ];
  const first = points[0]!;
  g.fillStyle(color, 0.08).beginPath().moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) g.lineTo(points[index]!.x, points[index]!.y);
  g.closePath().fillPath();
  g.lineStyle(3, color, 0.42).beginPath().moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) g.lineTo(points[index]!.x, points[index]!.y);
  g.closePath().strokePath();
  for (const point of points) {
    g.fillStyle(0x34271e, 1).fillRect(point.x - 4, point.y - 25, 8, 28);
    g.fillStyle(color, 0.95).fillTriangle(point.x, point.y - 24, point.x + 20, point.y - 17, point.x, point.y - 10);
  }
}

function drawWorksiteProps(g: Phaser.GameObjects.Graphics): void {
  const logPoints = [{ x: 4, y: 9 }, { x: 13, y: 6 }];
  for (const point of logPoints) {
    const world = gridToWorld(point, { x: 0, y: 0 });
    for (let index = 0; index < 3; index += 1) {
      g.lineStyle(8, 0x75533b, 1).lineBetween(world.x - 23 + index * 8, world.y + 10, world.x + 8 + index * 8, world.y - 6);
      g.lineStyle(2, 0x2b211b, 0.8).strokeCircle(world.x - 23 + index * 8, world.y + 10, 4);
    }
  }
  for (const point of [{ x: 5, y: 5 }, { x: 12, y: 10 }]) {
    const world = gridToWorld(point, { x: 0, y: 0 });
    g.fillStyle(0x3b2a20, 1).fillRect(world.x - 25, world.y - 11, 50, 17);
    g.fillStyle(0xc29c43, 0.88).fillRect(world.x - 21, world.y - 7, 42, 4);
    g.lineStyle(3, 0x101917, 0.75).strokeRect(world.x - 25, world.y - 11, 50, 17);
  }
  const route = [{ x: 5, y: 7 }, { x: 7, y: 7 }, { x: 9, y: 8 }, { x: 11, y: 8 }, { x: 13, y: 7 }];
  g.lineStyle(4, 0xe0b866, 0.32).beginPath();
  route.forEach((point, index) => {
    const world = gridToWorld(point, { x: 0, y: 0 });
    if (index === 0) g.moveTo(world.x, world.y); else g.lineTo(world.x, world.y);
  });
  g.strokePath();
}

function addSign(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  labels: Phaser.GameObjects.Text[],
  point: SharedGridPoint,
  title: string,
  subtitle: string,
  color: number,
): void {
  const world = gridToWorld(point, { x: 0, y: 0 });
  const titleText = scene.add.text(world.x, world.y - 78, title, {
    color: "#f0ebcf",
    fontFamily: 'Georgia, "Noto Serif TC", serif',
    fontSize: "15px",
    fontStyle: "bold",
    backgroundColor: `#${color.toString(16).padStart(6, "0")}ee`,
    padding: { x: 8, y: 4 },
  }).setOrigin(0.5).setResolution(2);
  const subtitleText = scene.add.text(world.x, world.y - 55, subtitle, {
    color: "#dce9c6",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "10px",
    fontStyle: "bold",
    backgroundColor: "#101917c9",
    padding: { x: 5, y: 2 },
  }).setOrigin(0.5).setResolution(2);
  labels.push(titleText, subtitleText);
  container.add([titleText, subtitleText]);
}
