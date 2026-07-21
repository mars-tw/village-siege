import Phaser from "phaser";
import { isVillageAssaultBuildableCell, type GridPoint as SharedGridPoint, type VillageAssaultLayoutId } from "@village-siege/shared";
import { gridToWorld, type ScreenPoint } from "./isometric";

export const VILLAGE_ASSAULT_ORIGIN: ScreenPoint = { x: 780, y: 70 };
export const VILLAGE_ASSAULT_BOUNDS = { x: 0, y: 0, width: 1660, height: 920 } as const;

export interface SettlementOverlay {
  readonly container: Phaser.GameObjects.Container;
  readonly placement: Phaser.GameObjects.Graphics;
  destroy(): void;
}

export function drawSettlementOverlay(scene: Phaser.Scene, origin = VILLAGE_ASSAULT_ORIGIN): SettlementOverlay {
  const props = scene.add.graphics();
  const placement = scene.add.graphics();
  const container = scene.add.container(origin.x, origin.y, [props, placement]);
  container.setName("village-assault-settlement-overlay");

  drawWorksiteProps(props);
  return { container, placement, destroy: () => container.destroy(true) };
}

export function isSettlementBuildable(point: SharedGridPoint, layoutId?: VillageAssaultLayoutId): boolean {
  return isVillageAssaultBuildableCell(point, layoutId);
}

export function drawPlacementFootprint(
  graphics: Phaser.GameObjects.Graphics,
  cells: readonly SharedGridPoint[],
  validCells: readonly boolean[],
): void {
  graphics.clear();
  cells.forEach((point, index) => {
    const world = gridToWorld(point, { x: 0, y: 0 });
    const valid = validCells[index] ?? false;
    const color = valid ? 0xa9d18e : 0xf27a64;
    graphics.fillStyle(color, valid ? 0.24 : 0.32).beginPath()
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
    graphics.lineStyle(3, color, 0.96);
    if (valid) {
      graphics.beginPath().moveTo(world.x - 12, world.y).lineTo(world.x - 3, world.y + 8).lineTo(world.x + 14, world.y - 9).strokePath();
    } else {
      graphics.lineBetween(world.x - 11, world.y - 8, world.x + 11, world.y + 8);
      graphics.lineBetween(world.x + 11, world.y - 8, world.x - 11, world.y + 8);
    }
  });
}

export function drawFogOfWar(
  graphics: Phaser.GameObjects.Graphics,
  mapWidth: number,
  mapHeight: number,
  visibleTileIndices: readonly number[],
  exploredTileIndices: readonly number[],
): void {
  const visible = new Set(visibleTileIndices);
  const explored = new Set(exploredTileIndices);
  graphics.clear();
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const index = y * mapWidth + x;
      if (visible.has(index)) continue;
      const world = gridToWorld({ x, y }, { x: 0, y: 0 });
      graphics.fillStyle(explored.has(index) ? 0x13221e : 0x07100e, explored.has(index) ? 0.66 : 0.94).beginPath()
        .moveTo(world.x, world.y - 25)
        .lineTo(world.x + 49, world.y)
        .lineTo(world.x, world.y + 25)
        .lineTo(world.x - 49, world.y)
        .closePath().fillPath();
    }
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
}
