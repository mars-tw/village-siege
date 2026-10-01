import Phaser from "phaser";
import { VILLAGE_ASSAULT_MAP_HEIGHT, VILLAGE_ASSAULT_MAP_WIDTH, isVillageAssaultBuildableCell, type GridPoint as SharedGridPoint, type VillageAssaultLayoutId } from "@village-siege/shared";
import { HALF_TILE_HEIGHT, HALF_TILE_WIDTH, gridToWorld, type ScreenPoint } from "./isometric";

const LANDSCAPE_MARGIN = 192;
export const VILLAGE_ASSAULT_ORIGIN: ScreenPoint = { x: VILLAGE_ASSAULT_MAP_HEIGHT * HALF_TILE_WIDTH + LANDSCAPE_MARGIN, y: LANDSCAPE_MARGIN };
export const VILLAGE_ASSAULT_BOUNDS = {
  x: 0, y: 0,
  width: (VILLAGE_ASSAULT_MAP_WIDTH + VILLAGE_ASSAULT_MAP_HEIGHT) * HALF_TILE_WIDTH + LANDSCAPE_MARGIN * 2,
  height: (VILLAGE_ASSAULT_MAP_WIDTH + VILLAGE_ASSAULT_MAP_HEIGHT) * HALF_TILE_HEIGHT + LANDSCAPE_MARGIN * 2,
} as const;

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
  // Extend unknown land into the surrounding meadow rather than exposing a
  // raised board edge around the simulation's isometric footprint.
  const north = { x: 0, y: -HALF_TILE_HEIGHT };
  const east = { x: mapWidth * HALF_TILE_WIDTH, y: (mapWidth - 1) * HALF_TILE_HEIGHT };
  const south = { x: (mapWidth - mapHeight) * HALF_TILE_WIDTH, y: (mapWidth + mapHeight - 1) * HALF_TILE_HEIGHT };
  const west = { x: -mapHeight * HALF_TILE_WIDTH, y: (mapHeight - 1) * HALF_TILE_HEIGHT };
  const left = -VILLAGE_ASSAULT_ORIGIN.x;
  const top = -VILLAGE_ASSAULT_ORIGIN.y;
  const right = VILLAGE_ASSAULT_BOUNDS.width + left;
  const bottom = VILLAGE_ASSAULT_BOUNDS.height + top;
  for (const points of [
    [{ x: left, y: top }, { x: north.x, y: top }, north, west, { x: left, y: west.y }],
    [{ x: north.x, y: top }, { x: right, y: top }, { x: right, y: east.y }, east, north],
    [{ x: right, y: east.y }, { x: right, y: bottom }, { x: south.x, y: bottom }, south, east],
    [{ x: south.x, y: bottom }, { x: left, y: bottom }, { x: left, y: west.y }, west, south],
  ]) graphics.fillStyle(0x142b24, 0.88).fillPoints(points.map((point) => new Phaser.Math.Vector2(point.x, point.y)), true);
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const index = y * mapWidth + x;
      if (visible.has(index)) continue;
      const world = gridToWorld({ x, y }, { x: 0, y: 0 });
      graphics.fillStyle(explored.has(index) ? 0x172b24 : 0x142b24, explored.has(index) ? 0.64 : 0.88).beginPath()
        .moveTo(world.x, world.y - HALF_TILE_HEIGHT)
        .lineTo(world.x + HALF_TILE_WIDTH, world.y)
        .lineTo(world.x, world.y + HALF_TILE_HEIGHT)
        .lineTo(world.x - HALF_TILE_WIDTH, world.y)
        .closePath().fillPath();
    }
  }
}
