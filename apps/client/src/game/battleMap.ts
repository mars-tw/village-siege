import Phaser from "phaser";
import {
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ROWS,
  VILLAGE_ASSAULT_MAP_WIDTH,
} from "@village-siege/shared";
import {
  HALF_TILE_HEIGHT,
  HALF_TILE_WIDTH,
  gridToWorld,
  type GridPoint,
  type ScreenPoint
} from "./isometric";

export const BATTLE_MAP_WIDTH = VILLAGE_ASSAULT_MAP_WIDTH;
export const BATTLE_MAP_HEIGHT = VILLAGE_ASSAULT_MAP_HEIGHT;

export type BattleTerrain = "grass" | "mud" | "stoneRoad" | "shallowWater" | "rock" | "thicket";

export interface TerrainDefinition {
  readonly kind: BattleTerrain;
  readonly walkable: boolean;
  readonly moveCost: number;
  readonly cover: number;
  readonly fillColor: number;
  readonly edgeColor: number;
}

export interface BattleTile extends TerrainDefinition {
  readonly point: GridPoint;
}

export type ObjectiveZoneKind = "centralControl" | "monsterCamp" | "beacon";

export interface ObjectiveZone {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ObjectiveZoneKind;
  readonly center: GridPoint;
  readonly radiusTiles: number;
  readonly monsterId?: "miremaw" | "ashwing" | "rootback";
}

export interface SuggestedSpawns {
  readonly westTeam: readonly GridPoint[];
  readonly eastTeam: readonly GridPoint[];
  readonly monsterCamps: Readonly<Record<"miremaw" | "ashwing" | "rootback", readonly GridPoint[]>>;
}

export interface BattleMapView {
  readonly container: Phaser.GameObjects.Container;
  readonly terrain: Phaser.GameObjects.Graphics;
  readonly props: Phaser.GameObjects.Graphics;
  readonly objectives: Phaser.GameObjects.Graphics;
  destroy(): void;
}

type TileGlyph = "G" | "M" | "S" | "W" | "R" | "T";

const TERRAIN: Readonly<Record<BattleTerrain, TerrainDefinition>> = {
  grass: { kind: "grass", walkable: true, moveCost: 1, cover: 0, fillColor: 0x71805a, edgeColor: 0x4d5d42 },
  mud: { kind: "mud", walkable: true, moveCost: 1.55, cover: 0.05, fillColor: 0x765d43, edgeColor: 0x513f31 },
  stoneRoad: { kind: "stoneRoad", walkable: true, moveCost: 0.82, cover: 0, fillColor: 0x8c8978, edgeColor: 0x5b5b52 },
  shallowWater: { kind: "shallowWater", walkable: false, moveCost: Number.POSITIVE_INFINITY, cover: 0, fillColor: 0x4f8589, edgeColor: 0x315b62 },
  rock: { kind: "rock", walkable: false, moveCost: Number.POSITIVE_INFINITY, cover: 0.8, fillColor: 0x59645f, edgeColor: 0x343d3a },
  thicket: { kind: "thicket", walkable: true, moveCost: 1.8, cover: 0.45, fillColor: 0x4f684b, edgeColor: 0x334634 }
};

const GLYPH_TERRAIN: Readonly<Record<TileGlyph, BattleTerrain>> = {
  G: "grass",
  M: "mud",
  S: "stoneRoad",
  W: "shallowWater",
  R: "rock",
  T: "thicket"
};

// The two horizontal lanes remain readable even without objective overlays:
// the northern assault route is dressed stone, the southern route is churned mud.
const MAP_ROWS = VILLAGE_ASSAULT_MAP_ROWS;

for (const [rowIndex, row] of MAP_ROWS.entries()) {
  if (row.length !== BATTLE_MAP_WIDTH) throw new Error(`Battle map row ${rowIndex} must contain ${BATTLE_MAP_WIDTH} tiles`);
  for (const glyph of row) {
    if (!(glyph in GLYPH_TERRAIN)) throw new Error(`Unknown battle-map glyph: ${glyph}`);
  }
}
if (MAP_ROWS.length !== BATTLE_MAP_HEIGHT) throw new Error(`Battle map must contain ${BATTLE_MAP_HEIGHT} rows`);

const MAP_TILES: readonly BattleTile[] = MAP_ROWS.flatMap((row, y) =>
  [...row].map((glyph, x) => {
    const definition = TERRAIN[GLYPH_TERRAIN[glyph as TileGlyph]];
    return { ...definition, point: { x, y } };
  })
);

const OBJECTIVE_ZONES: readonly ObjectiveZone[] = [
  { id: "central-crossroads", displayName: "斷橋十字口", kind: "centralControl", center: { x: 8.5, y: 7.5 }, radiusTiles: 2.25 },
  { id: "west-beacon", displayName: "西岸烽火台", kind: "beacon", center: { x: 5, y: 6 }, radiusTiles: 1.15 },
  { id: "east-beacon", displayName: "東岸烽火台", kind: "beacon", center: { x: 12, y: 9 }, radiusTiles: 1.15 },
  { id: "miremaw-camp", displayName: "泥沼獠口巢", kind: "monsterCamp", center: { x: 3.5, y: 2 }, radiusTiles: 1.3, monsterId: "miremaw" },
  { id: "ashwing-camp", displayName: "灰燼翼巢", kind: "monsterCamp", center: { x: 13, y: 2 }, radiusTiles: 1.3, monsterId: "ashwing" },
  { id: "rootback-camp", displayName: "根甲巨獸窟", kind: "monsterCamp", center: { x: 8, y: 13 }, radiusTiles: 1.45, monsterId: "rootback" }
];

const SUGGESTED_SPAWNS: SuggestedSpawns = {
  westTeam: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 10 }, { x: 2, y: 10 }],
  eastTeam: [{ x: 16, y: 4 }, { x: 15, y: 4 }, { x: 16, y: 10 }, { x: 15, y: 10 }],
  monsterCamps: {
    miremaw: [{ x: 3, y: 2 }, { x: 4, y: 2 }],
    ashwing: [{ x: 12, y: 2 }, { x: 13, y: 2 }],
    rootback: [{ x: 8, y: 13 }, { x: 9, y: 13 }]
  }
};

export const ATTACK_ROUTES = {
  north: [{ x: 1, y: 4 }, { x: 6, y: 4 }, { x: 9, y: 4 }, { x: 16, y: 4 }],
  south: [{ x: 1, y: 10 }, { x: 6, y: 10 }, { x: 9, y: 10 }, { x: 16, y: 10 }]
} as const satisfies Readonly<Record<"north" | "south", readonly GridPoint[]>>;

const NEIGHBOR_OFFSETS = [
  { x: 1, y: 0, diagonal: false },
  { x: 1, y: 1, diagonal: true },
  { x: 0, y: 1, diagonal: false },
  { x: -1, y: 1, diagonal: true },
  { x: -1, y: 0, diagonal: false },
  { x: -1, y: -1, diagonal: true },
  { x: 0, y: -1, diagonal: false },
  { x: 1, y: -1, diagonal: true }
] as const;

const MINIMUM_MOVE_COST = TERRAIN.stoneRoad.moveCost;

export function getBattleTile(point: GridPoint): BattleTile | undefined {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (!isInside(x, y)) return undefined;
  return MAP_TILES[toKey(x, y)];
}

export function clampToWalkable(point: GridPoint): GridPoint {
  const requestedX = Number.isFinite(point.x) ? Math.round(point.x) : 0;
  const requestedY = Number.isFinite(point.y) ? Math.round(point.y) : 0;
  const clampedX = Math.max(0, Math.min(BATTLE_MAP_WIDTH - 1, requestedX));
  const clampedY = Math.max(0, Math.min(BATTLE_MAP_HEIGHT - 1, requestedY));
  const direct = getBattleTile({ x: clampedX, y: clampedY });
  if (direct?.walkable) return { x: clampedX, y: clampedY };

  let best: GridPoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tile of MAP_TILES) {
    if (!tile.walkable) continue;
    const dx = tile.point.x - clampedX;
    const dy = tile.point.y - clampedY;
    const distance = dx * dx + dy * dy;
    if (
      distance < bestDistance
      || (distance === bestDistance && best !== undefined && (tile.point.y < best.y || (tile.point.y === best.y && tile.point.x < best.x)))
    ) {
      bestDistance = distance;
      best = tile.point;
    }
  }
  return best ? { ...best } : { x: 0, y: 0 };
}

export function findPath(start: GridPoint, end: GridPoint): readonly GridPoint[] {
  const origin = clampToWalkable(start);
  const destination = clampToWalkable(end);
  const startKey = toKey(origin.x, origin.y);
  const destinationKey = toKey(destination.x, destination.y);
  if (startKey === destinationKey) return [origin];

  interface OpenNode {
    readonly key: number;
    readonly point: GridPoint;
    readonly g: number;
    readonly h: number;
    readonly f: number;
  }

  const open: OpenNode[] = [];
  const closed = new Set<number>();
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startKey, 0]]);
  const initialH = octileDistance(origin, destination) * MINIMUM_MOVE_COST;
  open.push({ key: startKey, point: origin, g: 0, h: initialH, f: initialH });

  while (open.length > 0) {
    open.sort(compareOpenNodes);
    const current = open.shift()!;
    if (closed.has(current.key)) continue;
    if (current.key === destinationKey) return reconstructPath(cameFrom, current.key);
    closed.add(current.key);

    for (const offset of NEIGHBOR_OFFSETS) {
      const next = { x: current.point.x + offset.x, y: current.point.y + offset.y };
      const tile = getBattleTile(next);
      if (!tile?.walkable) continue;
      if (offset.diagonal && !canTraverseDiagonal(current.point, offset.x, offset.y)) continue;
      const key = toKey(next.x, next.y);
      if (closed.has(key)) continue;
      const stepCost = tile.moveCost * (offset.diagonal ? Math.SQRT2 : 1);
      const tentativeG = current.g + stepCost;
      if (tentativeG >= (gScore.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(key, current.key);
      gScore.set(key, tentativeG);
      const h = octileDistance(next, destination) * MINIMUM_MOVE_COST;
      open.push({ key, point: next, g: tentativeG, h, f: tentativeG + h });
    }
  }
  return [];
}

export function getObjectiveZones(): readonly ObjectiveZone[] {
  return OBJECTIVE_ZONES.map((zone) => ({ ...zone, center: { ...zone.center } }));
}

export function getSuggestedSpawns(): SuggestedSpawns {
  return {
    westTeam: SUGGESTED_SPAWNS.westTeam.map((point) => ({ ...point })),
    eastTeam: SUGGESTED_SPAWNS.eastTeam.map((point) => ({ ...point })),
    monsterCamps: {
      miremaw: SUGGESTED_SPAWNS.monsterCamps.miremaw.map((point) => ({ ...point })),
      ashwing: SUGGESTED_SPAWNS.monsterCamps.ashwing.map((point) => ({ ...point })),
      rootback: SUGGESTED_SPAWNS.monsterCamps.rootback.map((point) => ({ ...point }))
    }
  };
}

export function drawBattleMap(scene: Phaser.Scene, origin: ScreenPoint): BattleMapView {
  const terrain = scene.add.graphics();
  const props = scene.add.graphics();
  const objectives = scene.add.graphics();
  const container = scene.add.container(origin.x, origin.y, [terrain, props, objectives]);
  drawContinuousGround(terrain);
  drawNaturalProps(props);
  for (const zone of OBJECTIVE_ZONES) drawObjective(objectives, zone);

  return {
    container,
    terrain,
    props,
    objectives,
    destroy: () => container.destroy(true)
  };
}

/** Keep the grid for simulation, but paint one continuous RTS landscape. */
function drawContinuousGround(graphics: Phaser.GameObjects.Graphics): void {
  const boundary = mapBoundary();
  fillPolygon(graphics, boundary.map((point) => ({ x: point.x, y: point.y + 18 })), 0x1f2923, 0.72);
  fillPolygon(graphics, boundary, 0x6f8255, 1);

  drawBlob(graphics, [
    grid(-0.5, 10.4), grid(2.2, 8.8), grid(5.5, 9.7), grid(7.6, 12.2),
    grid(4.5, 16.2), grid(0.2, 15.7)
  ], 0x78885a, 0.78);
  drawBlob(graphics, [
    grid(9.1, -0.4), grid(14.6, -0.2), grid(18.3, 2.9), grid(16.9, 6.3),
    grid(13.5, 5.4), grid(10.2, 3.1)
  ], 0x657a50, 0.72);
  drawBlob(graphics, [
    grid(2.2, 11), grid(5.5, 9.6), grid(9.6, 10.2), grid(13.4, 12.1),
    grid(11.8, 15.7), grid(6.1, 15.9)
  ], 0x806847, 0.55);
  drawBlob(graphics, [
    grid(1.4, 1.2), grid(5.2, 0.3), grid(7.3, 2.5), grid(5.1, 5.3),
    grid(1.4, 4.6), grid(-0.2, 2.8)
  ], 0x82915d, 0.56);

  const river = [
    grid(7.1, -1.2), grid(7.25, 1.2), grid(7.7, 3.5), grid(7.35, 5.7),
    grid(7.9, 7.8), grid(7.5, 10.1), grid(7.75, 12.4), grid(7.35, 14.6), grid(7.55, 17)
  ];
  drawOrganicRibbon(graphics, river, [70, 62, 72, 61, 69, 64, 75, 62, 72], 0x4d533c, 1);
  drawOrganicRibbon(graphics, river, [54, 48, 56, 47, 53, 49, 58, 48, 55], 0x3d7278, 1);
  drawOrganicRibbon(graphics, river, [38, 34, 40, 33, 37, 35, 43, 34, 39], 0x568f91, 0.94);

  const northRoad = [
    grid(-1.1, 4.25), grid(1.6, 4.05), grid(4.2, 4.25), grid(6.4, 4.02),
    grid(9.3, 4.2), grid(11.8, 3.92), grid(14.4, 4.13), grid(18.3, 3.95)
  ];
  const southRoad = [
    grid(-1.1, 10.15), grid(1.5, 9.9), grid(4.1, 10.18), grid(6.3, 9.98),
    grid(9.4, 10.2), grid(12.1, 9.92), grid(14.9, 10.14), grid(18.3, 9.94)
  ];
  drawOrganicRibbon(graphics, northRoad, [54, 47, 51, 45, 50, 46, 52, 48], 0x5b503c, 0.82);
  drawOrganicRibbon(graphics, northRoad, [39, 34, 37, 32, 36, 33, 38, 34], 0x918c78, 0.97);
  drawOrganicRibbon(graphics, southRoad, [58, 49, 55, 47, 54, 48, 56, 50], 0x594733, 0.9);
  drawOrganicRibbon(graphics, southRoad, [43, 36, 40, 34, 39, 35, 42, 36], 0x806143, 0.98);

  drawRiverDetails(graphics, river);
  drawRoadDetails(graphics, northRoad, true);
  drawRoadDetails(graphics, southRoad, false);
  scatterMeadowDetails(graphics);
  graphics.lineStyle(3, 0x344434, 0.7);
  strokePolygon(graphics, boundary);
}

function mapBoundary(): ScreenPoint[] {
  const north = grid(0, 0);
  const east = grid(BATTLE_MAP_WIDTH - 1, 0);
  const south = grid(BATTLE_MAP_WIDTH - 1, BATTLE_MAP_HEIGHT - 1);
  const west = grid(0, BATTLE_MAP_HEIGHT - 1);
  return [
    { x: north.x, y: north.y - HALF_TILE_HEIGHT },
    { x: east.x + HALF_TILE_WIDTH, y: east.y },
    { x: south.x, y: south.y + HALF_TILE_HEIGHT },
    { x: west.x - HALF_TILE_WIDTH, y: west.y }
  ];
}

function grid(x: number, y: number): ScreenPoint {
  return gridToWorld({ x, y }, { x: 0, y: 0 });
}

function fillPolygon(graphics: Phaser.GameObjects.Graphics, points: readonly ScreenPoint[], color: number, alpha: number): void {
  if (points.length < 3) return;
  graphics.fillStyle(color, alpha).beginPath().moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length; index += 1) graphics.lineTo(points[index]!.x, points[index]!.y);
  graphics.closePath().fillPath();
}

function strokePolygon(graphics: Phaser.GameObjects.Graphics, points: readonly ScreenPoint[]): void {
  if (points.length < 2) return;
  graphics.beginPath().moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length; index += 1) graphics.lineTo(points[index]!.x, points[index]!.y);
  graphics.closePath().strokePath();
}

function drawBlob(graphics: Phaser.GameObjects.Graphics, points: readonly ScreenPoint[], color: number, alpha: number): void {
  fillPolygon(graphics, points, color, alpha);
}

function drawOrganicRibbon(
  graphics: Phaser.GameObjects.Graphics,
  centerline: readonly ScreenPoint[],
  halfWidths: readonly number[],
  color: number,
  alpha: number
): void {
  if (centerline.length < 2 || centerline.length !== halfWidths.length) return;
  const left: ScreenPoint[] = [];
  const right: ScreenPoint[] = [];
  for (let index = 0; index < centerline.length; index += 1) {
    const previous = centerline[Math.max(0, index - 1)]!;
    const next = centerline[Math.min(centerline.length - 1, index + 1)]!;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const center = centerline[index]!;
    const halfWidth = halfWidths[index]!;
    left.push({ x: center.x + normalX * halfWidth, y: center.y + normalY * halfWidth });
    right.unshift({ x: center.x - normalX * halfWidth, y: center.y - normalY * halfWidth });
  }
  fillPolygon(graphics, [...left, ...right], color, alpha);
}

function drawRiverDetails(graphics: Phaser.GameObjects.Graphics, river: readonly ScreenPoint[]): void {
  for (let index = 0; index < 15; index += 1) {
    const center = samplePolyline(river, (index + 0.45) / 15);
    const drift = detailSeed(index, 71) % 31 - 15;
    const length = 18 + detailSeed(index, 83) % 29;
    graphics.lineStyle(2, index % 3 === 0 ? 0x9bc0b7 : 0x75aaa5, 0.38)
      .lineBetween(center.x - length / 2 + drift, center.y - 3, center.x + length / 2 + drift, center.y + 3);
  }
}

function drawRoadDetails(graphics: Phaser.GameObjects.Graphics, road: readonly ScreenPoint[], stone: boolean): void {
  for (let index = 0; index < 22; index += 1) {
    const center = samplePolyline(road, (index + 0.35) / 22);
    const seed = detailSeed(index, stone ? 137 : 173);
    const driftX = seed % 25 - 12;
    const driftY = Math.floor(seed / 25) % 13 - 6;
    if (stone) {
      graphics.lineStyle(1, index % 2 === 0 ? 0xc0b8a0 : 0x5d5b50, 0.42)
        .lineBetween(center.x + driftX - 10, center.y + driftY - 4, center.x + driftX + 10, center.y + driftY + 4);
    } else {
      graphics.fillStyle(index % 3 === 0 ? 0x493828 : 0xa07951, 0.3)
        .fillEllipse(center.x + driftX, center.y + driftY, 19 + seed % 14, 5);
    }
  }
}

function scatterMeadowDetails(graphics: Phaser.GameObjects.Graphics): void {
  for (let index = 0; index < 72; index += 1) {
    const seed = detailSeed(index, 211);
    const x = (seed % 1700) / 100;
    const y = (Math.floor(seed / 1700) % 1500) / 100;
    const tile = getBattleTile({ x, y });
    if (!tile || tile.kind !== "grass") continue;
    const center = grid(x, y);
    graphics.lineStyle(1, index % 4 === 0 ? 0xb0b67a : 0x4e6846, 0.54)
      .lineBetween(center.x, center.y + 2, center.x - 2, center.y - 4)
      .lineBetween(center.x, center.y + 2, center.x + 3, center.y - 3);
  }
}

function samplePolyline(points: readonly ScreenPoint[], t: number): ScreenPoint {
  if (points.length < 2) throw new Error("Polyline requires at least two points");
  const scaled = Math.max(0, Math.min(0.999999, t)) * (points.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const left = points[index]!;
  const right = points[index + 1]!;
  return { x: left.x + (right.x - left.x) * local, y: left.y + (right.y - left.y) * local };
}

function drawNaturalProps(graphics: Phaser.GameObjects.Graphics): void {
  const clusters: Array<{ readonly kind: "rock" | "thicket"; readonly point: GridPoint; readonly size: number }> = [
    { kind: "thicket", point: { x: 0.4, y: 0.6 }, size: 4 },
    { kind: "thicket", point: { x: 16.4, y: 0.8 }, size: 4 },
    { kind: "thicket", point: { x: 0.5, y: 14.4 }, size: 4 },
    { kind: "thicket", point: { x: 15.8, y: 14.5 }, size: 5 },
    { kind: "thicket", point: { x: 3.2, y: 12.4 }, size: 3 },
    { kind: "thicket", point: { x: 12.7, y: 12.1 }, size: 3 },
    { kind: "rock", point: { x: 6.5, y: 0.7 }, size: 4 },
    { kind: "rock", point: { x: 7.2, y: 2.2 }, size: 3 },
    { kind: "rock", point: { x: 1.1, y: 6.3 }, size: 2 },
    { kind: "rock", point: { x: 1.3, y: 9.1 }, size: 2 },
    { kind: "rock", point: { x: 14.2, y: 6.2 }, size: 3 },
    { kind: "rock", point: { x: 14.4, y: 9.2 }, size: 3 }
  ];
  clusters.sort((left, right) => left.point.x + left.point.y - right.point.x - right.point.y);
  for (const cluster of clusters) {
    const center = grid(cluster.point.x, cluster.point.y);
    if (cluster.kind === "rock") drawRockCluster(graphics, center.x, center.y, cluster.point, cluster.size);
    else drawThicketCluster(graphics, center.x, center.y, cluster.point, cluster.size);
  }
}

function drawRockCluster(graphics: Phaser.GameObjects.Graphics, x: number, y: number, point: GridPoint, size: number): void {
  graphics.fillStyle(0x252d2b, 0.24).fillEllipse(x, y + 7, 42 + size * 18, 14 + size * 2);
  for (let index = 0; index < size; index += 1) {
    const seed = detailSeed(Math.round(point.x * 10) + index, Math.round(point.y * 10));
    const offsetX = index * 17 - (size - 1) * 8 + seed % 9 - 4;
    const offsetY = seed % 13 - 4;
    const scale = 0.62 + (seed % 5) * 0.09;
    drawRock(graphics, x + offsetX, y + offsetY, scale, seed % 7 - 3);
  }
}

function drawRock(graphics: Phaser.GameObjects.Graphics, x: number, y: number, scale: number, lean: number): void {
  graphics.fillStyle(0x394340).beginPath()
    .moveTo(x - 18 * scale, y + 4)
    .lineTo(x + (-11 + lean) * scale, y - 24 * scale)
    .lineTo(x + 5 * scale, y - 31 * scale)
    .lineTo(x + 21 * scale, y - 8 * scale)
    .lineTo(x + 17 * scale, y + 6)
    .closePath().fillPath();
  graphics.fillStyle(0x707a73).beginPath()
    .moveTo(x + (-10 + lean) * scale, y - 22 * scale)
    .lineTo(x + 5 * scale, y - 29 * scale)
    .lineTo(x + 15 * scale, y - 11 * scale)
    .lineTo(x - 2 * scale, y - 7 * scale)
    .closePath().fillPath();
}

function drawThicketCluster(graphics: Phaser.GameObjects.Graphics, x: number, y: number, point: GridPoint, size: number): void {
  graphics.fillStyle(0x263629, 0.26).fillEllipse(x, y + 8, 52 + size * 20, 18);
  for (let index = 0; index < size; index += 1) {
    const seed = detailSeed(Math.round(point.x * 10) + index, Math.round(point.y * 10));
    const offsetX = index * 19 - (size - 1) * 10 + seed % 11 - 5;
    const offsetY = seed % 13 - 6;
    const height = 32 + seed % 18;
    graphics.lineStyle(3, 0x493a2d, 0.9).lineBetween(x + offsetX, y + offsetY + 4, x + offsetX, y + offsetY - height * 0.55);
    graphics.fillStyle(index % 2 === 0 ? 0x304a35 : 0x3f5b3d)
      .fillTriangle(x + offsetX, y + offsetY - height, x + offsetX - 17, y + offsetY - 8, x + offsetX + 17, y + offsetY - 8);
    graphics.fillStyle(0x58734a, 0.9)
      .fillTriangle(x + offsetX + 3, y + offsetY - height * 0.82, x + offsetX - 11, y + offsetY - 14, x + offsetX + 19, y + offsetY - 14);
  }
  graphics.fillStyle(0x425f43).fillCircle(x - size * 8, y - 3, 10).fillCircle(x + size * 9, y - 2, 9);
}

function drawObjective(graphics: Phaser.GameObjects.Graphics, zone: ObjectiveZone): void {
  const center = gridToWorld(zone.center, { x: 0, y: 0 });
  if (zone.kind === "centralControl") {
    graphics.fillStyle(0xb47a36, 0.08).fillEllipse(center.x, center.y, 196, 82);
    graphics.lineStyle(3, 0xe0b866, 0.7).strokeEllipse(center.x, center.y, 196, 82);
    graphics.lineStyle(2, 0x356b78, 0.8).strokeEllipse(center.x, center.y, 30, 13);
    return;
  }
  if (zone.kind === "beacon") {
    graphics.fillStyle(0x2b3432, 0.35).fillEllipse(center.x, center.y + 5, 52, 17);
    graphics.fillStyle(0x777569).fillEllipse(center.x, center.y, 42, 18);
    graphics.lineStyle(2, 0x3f4441, 0.9).strokeEllipse(center.x, center.y, 42, 18);
    graphics.lineStyle(5, 0x47423a).lineBetween(center.x, center.y - 2, center.x, center.y - 34);
    graphics.fillStyle(0xb47a36).fillTriangle(center.x, center.y - 48, center.x - 8, center.y - 32, center.x + 8, center.y - 32);
    graphics.fillStyle(0xe0b866).fillTriangle(center.x, center.y - 44, center.x - 4, center.y - 34, center.x + 4, center.y - 34);
    graphics.lineStyle(2, 0xf0ebcf, 0.8).strokeEllipse(center.x, center.y - 3, 42, 17);
    return;
  }

  const campColor = zone.monsterId === "miremaw" ? 0x87925c : zone.monsterId === "ashwing" ? 0xa45b45 : 0x71807b;
  graphics.lineStyle(3, campColor, 0.72).strokeEllipse(center.x, center.y, zone.radiusTiles * 42, zone.radiusTiles * 18);
  graphics.fillStyle(0x2b2520, 0.45).fillEllipse(center.x, center.y + 5, 43, 13);
  graphics.lineStyle(3, 0xc2b38f, 0.85)
    .lineBetween(center.x - 13, center.y + 7, center.x + 12, center.y - 8)
    .lineBetween(center.x - 10, center.y - 8, center.x + 14, center.y + 7);
  graphics.fillStyle(campColor, 0.9).fillCircle(center.x, center.y - 12, 5);
}

function detailSeed(x: number, y: number): number {
  return Math.abs(((x + 11) * 73856093) ^ ((y + 17) * 19349663));
}

function isInside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < BATTLE_MAP_WIDTH && y < BATTLE_MAP_HEIGHT;
}

function toKey(x: number, y: number): number {
  return y * BATTLE_MAP_WIDTH + x;
}

function keyToPoint(key: number): GridPoint {
  return { x: key % BATTLE_MAP_WIDTH, y: Math.floor(key / BATTLE_MAP_WIDTH) };
}

function canTraverseDiagonal(origin: GridPoint, dx: number, dy: number): boolean {
  return getBattleTile({ x: origin.x + dx, y: origin.y })?.walkable === true
    && getBattleTile({ x: origin.x, y: origin.y + dy })?.walkable === true;
}

function octileDistance(left: GridPoint, right: GridPoint): number {
  const dx = Math.abs(left.x - right.x);
  const dy = Math.abs(left.y - right.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function compareOpenNodes(
  left: { readonly point: GridPoint; readonly f: number; readonly h: number; readonly g: number },
  right: { readonly point: GridPoint; readonly f: number; readonly h: number; readonly g: number }
): number {
  return left.f - right.f
    || left.h - right.h
    || right.g - left.g
    || left.point.y - right.point.y
    || left.point.x - right.point.x;
}

function reconstructPath(cameFrom: ReadonlyMap<number, number>, destinationKey: number): readonly GridPoint[] {
  const path: GridPoint[] = [keyToPoint(destinationKey)];
  let current = destinationKey;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.push(keyToPoint(current));
  }
  path.reverse();
  return path;
}
