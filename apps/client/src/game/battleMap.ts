import Phaser from "phaser";
import {
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_WIDTH,
  VILLAGE_ASSAULT_LAYOUT_IDS,
  getVillageAssaultLayout,
  type VillageAssaultLayoutId,
} from "@village-siege/shared";
import {
  HALF_TILE_HEIGHT,
  HALF_TILE_WIDTH,
  gridToWorld,
  type GridPoint,
  type ScreenPoint
} from "./isometric";
import { publicAssetUrl } from "./publicAssetUrl";
import { VILLAGE_ASSAULT_BOUNDS } from "./villageAssaultMap";

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
  readonly terrain: Phaser.GameObjects.Image;
  readonly props: Phaser.GameObjects.Container;
  readonly objectives: Phaser.GameObjects.Graphics;
  destroy(): void;
}

type TileGlyph = "G" | "M" | "S" | "W" | "R" | "T";

const TERRAIN: Readonly<Record<BattleTerrain, TerrainDefinition>> = {
  grass: { kind: "grass", walkable: true, moveCost: 1, cover: 0, fillColor: 0x849463, edgeColor: 0x576646 },
  mud: { kind: "mud", walkable: true, moveCost: 1.55, cover: 0.05, fillColor: 0x98774f, edgeColor: 0x695137 },
  stoneRoad: { kind: "stoneRoad", walkable: true, moveCost: 0.82, cover: 0, fillColor: 0xada084, edgeColor: 0x716b57 },
  shallowWater: { kind: "shallowWater", walkable: false, moveCost: Number.POSITIVE_INFINITY, cover: 0, fillColor: 0x447d87, edgeColor: 0x2b5260 },
  rock: { kind: "rock", walkable: false, moveCost: Number.POSITIVE_INFINITY, cover: 0.8, fillColor: 0x777b6d, edgeColor: 0x494d43 },
  thicket: { kind: "thicket", walkable: true, moveCost: 1.8, cover: 0.45, fillColor: 0x56734c, edgeColor: 0x394e37 }
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
const MAP_TILES_BY_LAYOUT = Object.fromEntries(VILLAGE_ASSAULT_LAYOUT_IDS.map((layoutId) => {
  const rows = getVillageAssaultLayout(layoutId).terrainRows;
  if (rows.length !== BATTLE_MAP_HEIGHT) throw new Error(`Battle map ${layoutId} must contain ${BATTLE_MAP_HEIGHT} rows`);
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== BATTLE_MAP_WIDTH) throw new Error(`Battle map ${layoutId} row ${rowIndex} must contain ${BATTLE_MAP_WIDTH} tiles`);
    for (const glyph of row) if (!(glyph in GLYPH_TERRAIN)) throw new Error(`Unknown battle-map glyph: ${glyph}`);
  }
  const tiles = rows.flatMap((row, y) => [...row].map((glyph, x) => {
    const definition = TERRAIN[GLYPH_TERRAIN[glyph as TileGlyph]];
    return { ...definition, point: { x, y } };
  }));
  return [layoutId, tiles] as const;
})) as unknown as Readonly<Record<VillageAssaultLayoutId, readonly BattleTile[]>>;

const OBJECTIVE_ZONES: readonly ObjectiveZone[] = [
  { id: "central-crossroads", displayName: "中央通道", kind: "centralControl", center: { x: BATTLE_MAP_WIDTH / 2, y: BATTLE_MAP_HEIGHT / 2 }, radiusTiles: 3 },
  { id: "west-beacon", displayName: "西岸烽火台", kind: "beacon", center: { x: Math.round(BATTLE_MAP_WIDTH * 0.35), y: BATTLE_MAP_HEIGHT / 2 }, radiusTiles: 1.15 },
  { id: "east-beacon", displayName: "東岸烽火台", kind: "beacon", center: { x: Math.round(BATTLE_MAP_WIDTH * 0.65), y: BATTLE_MAP_HEIGHT / 2 }, radiusTiles: 1.15 },
  ...getVillageAssaultLayout("pinehold").neutralCamps.map((camp): ObjectiveZone => ({
    id: camp.id, displayName: camp.monsterTypeId, kind: "monsterCamp", center: camp.position, radiusTiles: 1.3, monsterId: camp.monsterTypeId,
  })),
];

const SUGGESTED_SPAWNS: SuggestedSpawns = {
  westTeam: [{ x: 6, y: 11 }, { x: 7, y: 11 }, { x: 6, y: 13 }, { x: 7, y: 13 }],
  eastTeam: [{ x: BATTLE_MAP_WIDTH - 6, y: 11 }, { x: BATTLE_MAP_WIDTH - 7, y: 11 }, { x: BATTLE_MAP_WIDTH - 6, y: 13 }, { x: BATTLE_MAP_WIDTH - 7, y: 13 }],
  monsterCamps: {
    miremaw: [{ x: 13, y: 3 }, { x: 14, y: 3 }],
    ashwing: [{ x: 22, y: 3 }, { x: 23, y: 3 }],
    rootback: [{ x: 17, y: 21 }, { x: 18, y: 21 }]
  }
};

export const ATTACK_ROUTES = {
  north: [{ x: 4, y: 8 }, { x: 12, y: 8 }, { x: 19, y: 8 }, { x: BATTLE_MAP_WIDTH - 5, y: 8 }],
  south: [{ x: 4, y: BATTLE_MAP_HEIGHT - 6 }, { x: 12, y: BATTLE_MAP_HEIGHT - 6 }, { x: 19, y: BATTLE_MAP_HEIGHT - 6 }, { x: BATTLE_MAP_WIDTH - 5, y: BATTLE_MAP_HEIGHT - 6 }]
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

export function getBattleTile(point: GridPoint, layoutId: VillageAssaultLayoutId = "pinehold"): BattleTile | undefined {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (!isInside(x, y)) return undefined;
  return MAP_TILES_BY_LAYOUT[layoutId][toKey(x, y)];
}

export function clampToWalkable(point: GridPoint, layoutId: VillageAssaultLayoutId = "pinehold"): GridPoint {
  const requestedX = Number.isFinite(point.x) ? Math.round(point.x) : 0;
  const requestedY = Number.isFinite(point.y) ? Math.round(point.y) : 0;
  const clampedX = Math.max(0, Math.min(BATTLE_MAP_WIDTH - 1, requestedX));
  const clampedY = Math.max(0, Math.min(BATTLE_MAP_HEIGHT - 1, requestedY));
  const direct = getBattleTile({ x: clampedX, y: clampedY }, layoutId);
  if (direct?.walkable) return { x: clampedX, y: clampedY };

  let best: GridPoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tile of MAP_TILES_BY_LAYOUT[layoutId]) {
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

export function findPath(start: GridPoint, end: GridPoint, layoutId: VillageAssaultLayoutId = "pinehold"): readonly GridPoint[] {
  const origin = clampToWalkable(start, layoutId);
  const destination = clampToWalkable(end, layoutId);
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
      const tile = getBattleTile(next, layoutId);
      if (!tile?.walkable) continue;
      if (offset.diagonal && !canTraverseDiagonal(current.point, offset.x, offset.y, layoutId)) continue;
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

export const FRONTIER_MATERIALS_TEXTURE = "frontier-landscape-materials";
export const FRONTIER_NATURE_TEXTURE = "frontier-landscape-nature";
export const NATURE_FRAMES = ["oakGrove", "pineGrove", "limestoneBoulders", "grainPatch", "cutLogs", "stonePile", "riverbankPebbles", "bushes"] as const;
export type NatureFrame = typeof NATURE_FRAMES[number];
let landscapeTextureSequence = 0;

export function preloadFrontierLandscape(scene: Phaser.Scene): void {
  for (const [key, file] of [
    [FRONTIER_MATERIALS_TEXTURE, "materials.png"],
    [FRONTIER_NATURE_TEXTURE, "nature.png"],
  ] as const) {
    if (!scene.textures.exists(key)) scene.load.image(key, publicAssetUrl(`assets/original/frontier/landscape/${file}`));
  }
}

export function createNatureImage(scene: Phaser.Scene, kind: NatureFrame, width: number, groundY = 20): Phaser.GameObjects.Image | undefined {
  if (!scene.textures.exists(FRONTIER_NATURE_TEXTURE)) return undefined;
  const texture = scene.textures.get(FRONTIER_NATURE_TEXTURE);
  if (!texture.has(kind)) {
    const base = texture.get("__BASE");
    const cellWidth = Math.floor(base.cutWidth / 4);
    const cellHeight = Math.floor(base.cutHeight / 2);
    const index = NATURE_FRAMES.indexOf(kind);
    const topInset = index >= 4 ? Math.floor(cellHeight / 8) : 0;
    texture.add(kind, 0, index % 4 * cellWidth, Math.floor(index / 4) * cellHeight + topInset, cellWidth, cellHeight - topInset);
  }
  const sourceHeight = texture.get("__BASE").cutHeight / 2;
  const frame = texture.get(kind);
  const inset = sourceHeight - frame.cutHeight;
  const image = scene.add.image(0, groundY, FRONTIER_NATURE_TEXTURE, kind).setOrigin(0.5, (sourceHeight * 0.85 - inset) / frame.cutHeight);
  image.setDisplaySize(width, width * image.frame.cutHeight / image.frame.cutWidth);
  return image;
}

export function drawBattleMap(scene: Phaser.Scene, origin: ScreenPoint, layoutId: VillageAssaultLayoutId = "pinehold"): BattleMapView {
  const textureKey = `frontier-landscape-baked-${++landscapeTextureSequence}`;
  const canvas = paintLandscape(scene, origin, layoutId);
  scene.textures.addCanvas(textureKey, canvas);
  const terrain = scene.add.image(-origin.x, -origin.y, textureKey).setOrigin(0);
  const props = scene.add.container(0, 0);
  const objectives = scene.add.graphics();
  const container = scene.add.container(origin.x, origin.y, [terrain, props, objectives]);
  dressLandscape(scene, props, layoutId);
  const center = gridToWorld({ x: BATTLE_MAP_WIDTH / 2, y: BATTLE_MAP_HEIGHT / 2 }, { x: 0, y: 0 });
  // One restrained survey mark identifies the shared control point without a
  // field of giant target rings, fake neutral buildings, or name labels.
  objectives.lineStyle(2, 0xd6c18b, 0.35).strokeEllipse(center.x, center.y, 52, 24);
  objectives.fillStyle(0xe4d7ae, 0.7).fillCircle(center.x, center.y, 3);
  return {
    container, terrain, props, objectives,
    destroy: () => { container.destroy(true); scene.textures.remove(textureKey); },
  };
}

function materialPatterns(scene: Phaser.Scene, context: CanvasRenderingContext2D): readonly (CanvasPattern | null)[] {
  if (!scene.textures.exists(FRONTIER_MATERIALS_TEXTURE)) return [];
  const source = scene.textures.get(FRONTIER_MATERIALS_TEXTURE).getSourceImage() as HTMLImageElement;
  const width = Math.floor(source.width / 2);
  const height = Math.floor(source.height / 2);
  return [0, 1, 2, 3].map((index) => {
    const tile = document.createElement("canvas");
    tile.width = Math.floor(width * 0.6);
    tile.height = Math.floor(height * 0.6);
    tile.getContext("2d")!.drawImage(source, index % 2 * width, Math.floor(index / 2) * height, width, height, 0, 0, tile.width, tile.height);
    return context.createPattern(tile, "repeat");
  });
}

/** A baked raster surface follows the authoritative grid; it is never a scene illustration. */
function paintLandscape(scene: Phaser.Scene, origin: ScreenPoint, layoutId: VillageAssaultLayoutId): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = VILLAGE_ASSAULT_BOUNDS.width;
  canvas.height = VILLAGE_ASSAULT_BOUNDS.height;
  const context = canvas.getContext("2d")!;
  const patterns = materialPatterns(scene, context);
  context.fillStyle = patterns[0] ?? "#88954e";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Diffuse light and vegetation variation merge into continuous meadow. There
  // are no hard polygon patches or a raised miniature-board boundary.
  for (let index = 0; index < 22; index += 1) {
    const seed = detailSeed(index, 319);
    const x = seed % canvas.width;
    const y = Math.floor(seed / 113) % canvas.height;
    const radius = 220 + seed % 270;
    const wash = context.createRadialGradient(x, y, 0, x, y, radius);
    wash.addColorStop(0, index % 3 === 0 ? "rgba(39,65,32,0.14)" : "rgba(239,213,136,0.11)");
    wash.addColorStop(1, "rgba(150,160,100,0)");
    context.fillStyle = wash;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const rows = getVillageAssaultLayout(layoutId).terrainRows;
  const regions: Record<string, Path2D> = { M: new Path2D(), S: new Path2D(), W: new Path2D(), R: new Path2D(), T: new Path2D() };
  for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y]!.length; x += 1) {
    const path = regions[rows[y]![x]!];
    if (!path) continue;
    const center = gridToWorld({ x, y }, origin);
    path.moveTo(center.x, center.y - HALF_TILE_HEIGHT);
    path.lineTo(center.x + HALF_TILE_WIDTH, center.y);
    path.lineTo(center.x, center.y + HALF_TILE_HEIGHT);
    path.lineTo(center.x - HALF_TILE_WIDTH, center.y);
    path.closePath();
  }
  const region = (glyph: string, material: number, fallback: string, alpha = 1, shadow = "rgba(71,72,37,0.2)"): void => {
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = patterns[material] ?? fallback;
    context.shadowColor = shadow;
    context.shadowBlur = glyph === "W" ? 18 : 10;
    context.fill(regions[glyph]!);
    context.restore();
  };
  region("T", 0, "#657b41", 0.3);
  region("R", 2, "#9d9578", 0.78);
  region("W", 3, "#548d91", 1, "rgba(166,151,97,0.65)");
  region("M", 1, "#ad885c", 0.95, "rgba(180,162,102,0.45)");
  // The full legal movement corridor stays three or four cells wide, while
  // its visible route is a narrow, worn dirt path through grass.
  region("S", 1, "#ad885c", 0.12, "rgba(0,0,0,0)");
  const bands = new Map<number, ScreenPoint[]>();
  const bridges = new Path2D();
  for (let x = 0; x < BATTLE_MAP_WIDTH; x += 1) {
    let band = 0;
    const isCrossing = Math.abs(x - (BATTLE_MAP_WIDTH - 1) / 2) <= 1.5
      && rows.some((row) => row[x] === "W" || row[x] === "R");
    for (let y = 0; y < rows.length; y += 1) {
      if (rows[y]![x] !== "S") continue;
      const first = y;
      while (y + 1 < rows.length && rows[y + 1]![x] === "S") y += 1;
      const centerY = (first + y) / 2 + Math.sin(x * 0.47 + first) * 0.28;
      const points = bands.get(band) ?? [];
      points.push(gridToWorld({ x, y: centerY }, origin));
      bands.set(band++, points);
      if (isCrossing) for (let bridgeY = first; bridgeY <= y; bridgeY += 1) {
        const center = gridToWorld({ x, y: bridgeY }, origin);
        bridges.moveTo(center.x, center.y - HALF_TILE_HEIGHT);
        bridges.lineTo(center.x + HALF_TILE_WIDTH, center.y);
        bridges.lineTo(center.x, center.y + HALF_TILE_HEIGHT);
        bridges.lineTo(center.x - HALF_TILE_WIDTH, center.y);
        bridges.closePath();
      }
    }
  }
  context.save();
  context.clip(regions.S!);
  context.strokeStyle = patterns[1] ?? "#ad885c";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = "rgba(141,117,74,0.24)";
  context.shadowBlur = 13;
  for (const points of bands.values()) {
    if (points.length < 2) continue;
    const path = new Path2D();
    path.moveTo(points[0]!.x, points[0]!.y);
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index]!;
      const next = points[index + 1]!;
      path.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    path.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
    context.globalAlpha = 0.35;
    context.lineWidth = 38;
    context.stroke(path);
    context.globalAlpha = 0.22;
    context.lineWidth = 15;
    context.stroke(path);
  }
  context.restore();
  context.save();
  context.fillStyle = patterns[2] ?? "#c5af82";
  context.globalAlpha = 0.68;
  context.shadowColor = "rgba(137,113,71,0.35)";
  context.shadowBlur = 7;
  context.fill(bridges);
  context.restore();

  // Light weathering is placed within each material's exact playable region.
  // Texture detail survives because it is painted after the terrain masks.
  for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y]!.length; x += 1) {
    const glyph = rows[y]![x];
    if (glyph !== "W") continue;
    const center = gridToWorld({ x, y }, origin);
    const seed = detailSeed(x, y);
    context.beginPath();
    context.moveTo(center.x - 18, center.y - 4 + seed % 5);
    context.lineTo(center.x + 17, center.y + 3 + seed % 5);
    context.strokeStyle = "rgba(209,233,213,0.19)";
    context.lineWidth = 1.5;
    context.stroke();
  }
  return canvas;
}

function dressLandscape(scene: Phaser.Scene, props: Phaser.GameObjects.Container, layoutId: VillageAssaultLayoutId): void {
  const rows = getVillageAssaultLayout(layoutId).terrainRows;
  const sprites: Phaser.GameObjects.Image[] = [];
  const add = (kind: NatureFrame, point: GridPoint, width: number, alpha = 1): void => {
    const sprite = createNatureImage(scene, kind, width, 0);
    if (!sprite) return;
    const world = gridToWorld(point, { x: 0, y: 0 });
    sprite.setPosition(world.x, world.y + 18).setAlpha(alpha).setName(`landscape:${kind}:${point.x},${point.y}`);
    sprites.push(sprite);
  };
  for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y]!.length; x += 1) {
    const glyph = rows[y]![x];
    const seed = detailSeed(x, y);
    const drift = (seed % 9 - 4) / 24;
    if (glyph === "T") {
      if (seed % 3 === 0) add(layoutId === "pinehold" ? "pineGrove" : "oakGrove", { x: x + drift, y }, 115 + seed % 32);
      else if (seed % 3 === 1) add("bushes", { x, y: y + drift }, 66 + seed % 20, 0.92);
    } else if (glyph === "R" && seed % 3 !== 0) {
      add("limestoneBoulders", { x: x + drift, y }, 82 + seed % 22);
    } else if (glyph === "G" && seed % 41 === 0) {
      // Small flowering vegetation leaves room for buildings and units.
      add("bushes", { x: x + drift, y: y - 0.15 }, 34 + seed % 12, 0.8);
    }
    const besideWater = glyph !== "W" && glyph !== "S" && [rows[y - 1]?.[x], rows[y + 1]?.[x], rows[y]?.[x - 1], rows[y]?.[x + 1]].includes("W");
    if (besideWater && seed % 3 === 0) add("riverbankPebbles", { x: x - 0.1, y: y + drift }, 62 + seed % 12, 0.95);
  }
  sprites.sort((left, right) => left.y - right.y || left.x - right.x);
  props.add(sprites);
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

function canTraverseDiagonal(origin: GridPoint, dx: number, dy: number, layoutId: VillageAssaultLayoutId): boolean {
  return getBattleTile({ x: origin.x + dx, y: origin.y }, layoutId)?.walkable === true
    && getBattleTile({ x: origin.x, y: origin.y + dy }, layoutId)?.walkable === true;
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
