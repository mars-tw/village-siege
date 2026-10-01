import type Phaser from "phaser";
import {
  decodeExploredTilesRle,
  getVillageAssaultLayout,
  type PublicEntityState,
  type VisibleSnapshot,
} from "@village-siege/shared";
import { worldToGrid, type GridPoint, type ScreenPoint } from "./isometric";

export type TacticalMinimapSnapshot = Pick<VisibleSnapshot,
  "map" | "recipientPlayerId" | "recipientTeamId" | "participants" | "entities"
  | "visibleEntityIds" | "visibleTileIndices" | "exploredTilesRle"
>;

type MinimapRelation = "own" | "ally" | "enemy" | "neutral";
export interface TacticalMinimapProjection {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly { readonly index: number; readonly visibility: "visible" | "explored" | "unknown"; readonly glyph: string | null }[];
  readonly markers: readonly { readonly id: string; readonly kind: PublicEntityState["kind"]; readonly position: GridPoint; readonly relation: MinimapRelation }[];
}

/** Public presentation data is the sole source. Remembered enemies never become live markers. */
export function projectTacticalMinimap(snapshot: TacticalMinimapSnapshot): TacticalMinimapProjection {
  const { width, height } = snapshot.map;
  const visible = new Set(snapshot.visibleTileIndices);
  const explored = new Set(decodeExploredTilesRle(width, height, snapshot.exploredTilesRle));
  const visibleIds = new Set(snapshot.visibleEntityIds);
  const rows = getVillageAssaultLayout(snapshot.map.layoutId ?? "pinehold").terrainRows;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const visibility = visible.has(index) ? "visible" : explored.has(index) ? "explored" : "unknown";
    return {
      index,
      visibility,
      glyph: visibility === "unknown" ? null : rows[Math.floor(index / width)]?.[index % width] ?? "G",
    } as const;
  });
  const markers: TacticalMinimapProjection["markers"][number][] = [];
  for (const entity of snapshot.entities) {
    const x = Math.round(entity.position.x);
    const y = Math.round(entity.position.y);
    if (!visibleIds.has(entity.id) || entity.hitPoints <= 0 || x < 0 || y < 0 || x >= width || y >= height || !visible.has(y * width + x)) continue;
    const participant = snapshot.participants.find((candidate) => candidate.id === entity.ownerId);
    const relation: MinimapRelation = entity.ownerId === snapshot.recipientPlayerId ? "own"
      : participant?.teamId === snapshot.recipientTeamId ? "ally"
        : participant ? "enemy" : "neutral";
    markers.push({ id: entity.id, kind: entity.kind, position: { ...entity.position }, relation });
  }
  return { width, height, tiles, markers };
}

export function minimapPointToGrid(x: number, y: number, pixelWidth: number, pixelHeight: number, mapWidth: number, mapHeight: number): GridPoint {
  return {
    x: Math.max(0, Math.min(mapWidth - 1, Math.floor(x / pixelWidth * mapWidth))),
    y: Math.max(0, Math.min(mapHeight - 1, Math.floor(y / pixelHeight * mapHeight))),
  };
}

const WIDTH = 220;
const HEIGHT = 218;
const MAP_LEFT = 12;
const MAP_TOP = 34;
const MAP_WIDTH = WIDTH - MAP_LEFT * 2;
const MAP_HEIGHT = 164;
const TERRAIN_COLORS: Readonly<Record<string, number>> = {
  G: 0x73845a, M: 0x98774f, S: 0xb1a286, W: 0x447d87, R: 0x777b6d, T: 0x49613e,
};
const MARKER_COLORS: Readonly<Record<MinimapRelation, number>> = {
  own: 0xb0d4a9, ally: 0x8dc6d4, enemy: 0xf58b70, neutral: 0xe2c37d,
};

export interface TacticalMinimapView {
  readonly container: Phaser.GameObjects.Container;
  readonly width: number;
  readonly height: number;
  update(time: number, snapshot: TacticalMinimapSnapshot): void;
  layout(x: number, y: number, scale: number, visible: boolean): void;
  destroy(): void;
}

export function createTacticalMinimap(
  scene: Phaser.Scene,
  worldCamera: Phaser.Cameras.Scene2D.Camera,
  origin: ScreenPoint,
  onNavigate: (point: GridPoint) => void,
): TacticalMinimapView {
  const frame = scene.add.graphics();
  frame.fillStyle(0x172c27, 0.96).fillRoundedRect(0, 0, WIDTH, HEIGHT, 6);
  frame.lineStyle(1.5, 0xb99b67, 0.8).strokeRoundedRect(0, 0, WIDTH, HEIGHT, 6);
  frame.fillStyle(0x07110f, 1).fillRect(MAP_LEFT, MAP_TOP, MAP_WIDTH, MAP_HEIGHT);
  const title = scene.add.text(12, 10, "戰場 · 點選移動鏡頭", {
    color: "#d8d5b5", fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif', fontSize: "12px",
  }).setResolution(2);
  const legend = scene.add.text(12, HEIGHT - 16, "● 我方　● 敵方　◆ 資源", {
    color: "#a6b59c", fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif', fontSize: "9px",
  }).setResolution(2);
  const art = scene.add.graphics();
  const hit = scene.add.rectangle(MAP_LEFT, MAP_TOP, MAP_WIDTH, MAP_HEIGHT, 0xffffff, 0.001)
    .setOrigin(0).setInteractive({ useHandCursor: true });
  const container = scene.add.container(0, 0, [frame, title, legend, art, hit])
    .setName("assault-tactical-minimap").setScrollFactor(0).setDepth(110_000);
  let mapWidth = 18;
  let mapHeight = 16;
  let lastPaintAt = Number.NEGATIVE_INFINITY;
  const stop = (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData): void => event.stopPropagation();
  hit.on("pointerdown", (_pointer: Phaser.Input.Pointer, localX: number, localY: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    onNavigate(minimapPointToGrid(localX, localY, MAP_WIDTH, MAP_HEIGHT, mapWidth, mapHeight));
  });
  hit.on("pointerup", stop);
  hit.on("pointermove", stop);

  return {
    container, width: WIDTH, height: HEIGHT,
    update: (time, snapshot) => {
      if (!container.visible || time - lastPaintAt < 100) return;
      lastPaintAt = time;
      const projection = projectTacticalMinimap(snapshot);
      mapWidth = projection.width;
      mapHeight = projection.height;
      const tileWidth = MAP_WIDTH / mapWidth;
      const tileHeight = MAP_HEIGHT / mapHeight;
      art.clear();
      for (const tile of projection.tiles) {
        if (tile.glyph === null) continue;
        art.fillStyle(TERRAIN_COLORS[tile.glyph] ?? TERRAIN_COLORS.G!, tile.visibility === "visible" ? 1 : 0.32)
          .fillRect(MAP_LEFT + tile.index % mapWidth * tileWidth, MAP_TOP + Math.floor(tile.index / mapWidth) * tileHeight, tileWidth + 0.2, tileHeight + 0.2);
      }
      for (const marker of projection.markers) {
        const x = MAP_LEFT + (marker.position.x + 0.5) * tileWidth;
        const y = MAP_TOP + (marker.position.y + 0.5) * tileHeight;
        const radius = marker.kind === "building" ? 2.7 : marker.kind === "monster" ? 3 : 2;
        art.fillStyle(0x101917, 0.92).fillCircle(x, y, radius + 1);
        art.fillStyle(MARKER_COLORS[marker.relation], 1);
        if (marker.kind === "resource") art.fillRect(x - 1.8, y - 1.8, 3.6, 3.6);
        else art.fillCircle(x, y, radius);
      }
      const view = worldCamera.worldView;
      const corners = [
        { x: view.left, y: view.top }, { x: view.right, y: view.top },
        { x: view.right, y: view.bottom }, { x: view.left, y: view.bottom },
      ].map((point) => {
        const grid = worldToGrid(point, origin);
        return { x: MAP_LEFT + Math.max(0, Math.min(mapWidth, grid.x + 0.5)) * tileWidth, y: MAP_TOP + Math.max(0, Math.min(mapHeight, grid.y + 0.5)) * tileHeight };
      });
      art.lineStyle(1.4, 0xf2dfaf, 0.9).beginPath().moveTo(corners[0]!.x, corners[0]!.y);
      for (const point of corners.slice(1)) art.lineTo(point.x, point.y);
      art.closePath().strokePath();
    },
    layout: (x, y, scale, visible) => {
      container.setPosition(x, y).setScale(scale).setVisible(visible).setActive(visible);
      if (hit.input) hit.input.enabled = visible;
      lastPaintAt = Number.NEGATIVE_INFINITY;
    },
    destroy: () => container.destroy(true),
  };
}
