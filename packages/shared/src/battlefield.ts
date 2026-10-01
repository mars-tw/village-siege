import type { MonsterId } from "./combat.js";
import { getBuildingFootprint } from "./content.js";
import { findPathToAny, getFootprintPerimeterCells } from "./spatial.js";
import type {
  BuildingType,
  GridPoint,
  PlayableVillageId,
  ResourceKind,
  StructureOrientation,
} from "./protocol.js";

export const VILLAGE_ASSAULT_MAP_ID = "villageAssault";
export const VILLAGE_ASSAULT_MAP_WIDTH = 32;
export const VILLAGE_ASSAULT_MAP_HEIGHT = 24;
export const VILLAGE_ASSAULT_CONTROL_OBJECTIVE = {
  point: { x: 16, y: 12 },
  radius: 3,
} as const;

export type VillageAssaultTerrainGlyph = "G" | "M" | "S" | "W" | "R" | "T";
export type VillageAssaultLayoutId = PlayableVillageId;
export type VillageAssaultStartSlotId = "west" | "east";
export type VillageAssaultPlacementRole = "command" | "gate" | "perimeter" | "defense" | "production" | "economy";
export type VillageAssaultCivilianRole = "gatherer" | "porter" | "mason";

export interface VillageAssaultLayoutConstraint {
  readonly id: string;
  readonly description: string;
  readonly reservedBuildCells: readonly GridPoint[];
}

export interface VillageAssaultStructurePlacement {
  readonly id: string;
  readonly buildingType: BuildingType;
  readonly origin: GridPoint;
  readonly orientation: StructureOrientation;
  readonly role: VillageAssaultPlacementRole;
}

export interface VillageAssaultResourceAnchor {
  readonly id: string;
  readonly resourceKind: ResourceKind;
  readonly position: GridPoint;
}

export interface VillageAssaultCivilianActivityAnchor {
  readonly id: string;
  readonly role: VillageAssaultCivilianRole;
  readonly spawn: GridPoint;
  readonly resourceAnchorId: string;
  readonly dropOffPlacementId: string;
  readonly shelterPlacementId: string;
}

export interface VillageAssaultNeutralCampAnchor {
  readonly id: string;
  readonly monsterTypeId: MonsterId;
  readonly position: GridPoint;
  readonly leashRadius: number;
}

export interface VillageAssaultStartSlot {
  readonly id: VillageAssaultStartSlotId;
  readonly placements: readonly VillageAssaultStructurePlacement[];
  readonly resourceAnchors: readonly VillageAssaultResourceAnchor[];
  readonly civilianActivities: readonly VillageAssaultCivilianActivityAnchor[];
}

export interface VillageAssaultLayoutDefinition {
  readonly id: VillageAssaultLayoutId;
  readonly terrainRows: readonly string[];
  readonly constraint: VillageAssaultLayoutConstraint;
  readonly startSlots: readonly VillageAssaultStartSlot[];
  readonly neutralCamps: readonly VillageAssaultNeutralCampAnchor[];
}

export interface VillageAssaultLayoutValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export const VILLAGE_ASSAULT_LAYOUT_IDS = ["pinehold", "riverstead", "highcrag"] as const satisfies readonly VillageAssaultLayoutId[];
const DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID: VillageAssaultLayoutId = "pinehold";

interface TerrainPatch { readonly glyph: VillageAssaultTerrainGlyph; readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Authored terrain patches use no random noise; broad crossings stay readable. */
function authoredTerrain(patches: readonly TerrainPatch[]): readonly string[] {
  const rows: VillageAssaultTerrainGlyph[][] = Array.from({ length: VILLAGE_ASSAULT_MAP_HEIGHT }, () => Array<VillageAssaultTerrainGlyph>(VILLAGE_ASSAULT_MAP_WIDTH).fill("G"));
  for (const patch of patches) for (let y = patch.y; y < patch.y + patch.height; y += 1) for (let x = patch.x; x < patch.x + patch.width; x += 1) rows[y]![x] = patch.glyph;
  return rows.map(row => row.join(""));
}
const patch = (glyph: VillageAssaultTerrainGlyph, x: number, y: number, width: number, height: number): TerrainPatch => ({ glyph, x, y, width, height });

const PINEHOLD_TERRAIN_ROWS = authoredTerrain([
  patch("T", 0, 0, 32, 2), patch("T", 0, 22, 32, 2), patch("T", 0, 3, 2, 18), patch("T", 30, 3, 2, 18),
  patch("T", 9, 2, 3, 3), patch("T", 20, 19, 5, 3), patch("M", 12, 3, 6, 4), patch("M", 13, 18, 6, 4),
  patch("W", 15, 2, 2, 20), patch("S", 1, 7, 30, 3), patch("S", 1, 11, 30, 3), patch("S", 1, 16, 30, 3),
]);
const RIVERSTEAD_TERRAIN_ROWS = authoredTerrain([
  patch("T", 0, 0, 6, 3), patch("T", 27, 0, 5, 3), patch("T", 0, 21, 7, 3), patch("T", 25, 21, 7, 3),
  patch("M", 12, 0, 8, 24), patch("W", 15, 0, 2, 24),
  patch("S", 1, 7, 30, 3), patch("S", 1, 11, 30, 3), patch("S", 1, 17, 30, 3),
]);
const HIGHCRAG_TERRAIN_ROWS = authoredTerrain([
  patch("T", 0, 0, 8, 2), patch("T", 26, 0, 6, 2), patch("T", 0, 22, 6, 2), patch("T", 26, 22, 6, 2),
  patch("M", 11, 2, 9, 20), patch("R", 15, 0, 2, 24), patch("R", 12, 3, 2, 2), patch("R", 19, 19, 2, 2),
  patch("S", 1, 6, 30, 4), patch("S", 1, 11, 30, 3), patch("S", 1, 16, 30, 4),
  patch("G", 12, 3, 1, 1),
]);

export const VILLAGE_ASSAULT_LAYOUTS: Readonly<Record<VillageAssaultLayoutId, VillageAssaultLayoutDefinition>> = {
  pinehold: makeLayout("pinehold", PINEHOLD_TERRAIN_ROWS, {
    id: "pinehold-trade-crossings", description: "Three broad woodland crossings stay open; homes retain ample construction land.",
    reservedBuildCells: [...rectangleCells(12, 7, 8, 3), ...rectangleCells(12, 11, 8, 3), ...rectangleCells(12, 16, 8, 3)],
  }, [neutralCamp("pinehold-miremaw", "miremaw", { x: 13, y: 3 }, 3), neutralCamp("pinehold-ashwing", "ashwing", { x: 22, y: 3 }, 3), neutralCamp("pinehold-rootback", "rootback", { x: 17, y: 21 }, 3)]),
  riverstead: makeLayout("riverstead", RIVERSTEAD_TERRAIN_ROWS, {
    id: "riverstead-three-fords", description: "Three three-cell-wide river fords offer independent north, center and south attack lanes.",
    reservedBuildCells: [...rectangleCells(13, 7, 6, 3), ...rectangleCells(13, 11, 6, 3), ...rectangleCells(13, 17, 6, 3)],
  }, [neutralCamp("riverstead-miremaw", "miremaw", { x: 11, y: 21 }, 3), neutralCamp("riverstead-ashwing", "ashwing", { x: 21, y: 3 }, 3), neutralCamp("riverstead-rootback", "rootback", { x: 19, y: 2 }, 3)]),
  highcrag: makeLayout("highcrag", HIGHCRAG_TERRAIN_ROWS, {
    id: "highcrag-open-shelves", description: "Wide shale shelves give several approaches without enclosing either settlement.",
    reservedBuildCells: [...rectangleCells(12, 6, 8, 4), ...rectangleCells(12, 11, 8, 3), ...rectangleCells(12, 16, 8, 4)],
  }, [neutralCamp("highcrag-miremaw", "miremaw", { x: 12, y: 3 }, 3), neutralCamp("highcrag-ashwing", "ashwing", { x: 22, y: 20 }, 3), neutralCamp("highcrag-rootback", "rootback", { x: 17, y: 22 }, 3)]),
};
/** Backward-compatible default terrain rows used by the current simulation and client. */
export const VILLAGE_ASSAULT_MAP_ROWS = VILLAGE_ASSAULT_LAYOUTS[DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID].terrainRows;

export function getVillageAssaultLayout(layoutId: VillageAssaultLayoutId): VillageAssaultLayoutDefinition {
  return VILLAGE_ASSAULT_LAYOUTS[layoutId];
}

export function isVillageAssaultLayoutId(value: unknown): value is VillageAssaultLayoutId {
  return typeof value === "string" && VILLAGE_ASSAULT_LAYOUT_IDS.includes(value as VillageAssaultLayoutId);
}

export function getVillageAssaultTerrainGlyph(
  point: GridPoint,
  layoutId: VillageAssaultLayoutId = DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID,
): VillageAssaultTerrainGlyph | undefined {
  if (!isPointInBounds(point)) return undefined;
  return getVillageAssaultLayout(layoutId).terrainRows[point.y]![point.x] as VillageAssaultTerrainGlyph;
}

export function isVillageAssaultWalkableCell(
  point: GridPoint,
  layoutId: VillageAssaultLayoutId = DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID,
): boolean {
  const glyph = getVillageAssaultTerrainGlyph(point, layoutId);
  return glyph !== undefined && glyph !== "R" && glyph !== "W";
}

export function isVillageAssaultBuildableCell(
  point: GridPoint,
  layoutId: VillageAssaultLayoutId = DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID,
): boolean {
  if (!isVillageAssaultWalkableCell(point, layoutId)) return false;
  return !getVillageAssaultLayout(layoutId).constraint.reservedBuildCells.some((cell) => samePoint(cell, point));
}

export function getVillageAssaultWalkBlockedCells(
  layoutId: VillageAssaultLayoutId = DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID,
): readonly GridPoint[] {
  return collectCells((point) => !isVillageAssaultWalkableCell(point, layoutId));
}

export function getVillageAssaultBuildBlockedCells(
  layoutId: VillageAssaultLayoutId = DEFAULT_VILLAGE_ASSAULT_LAYOUT_ID,
): readonly GridPoint[] {
  return collectCells((point) => !isVillageAssaultBuildableCell(point, layoutId));
}

export function validateVillageAssaultLayout(layout: VillageAssaultLayoutDefinition): VillageAssaultLayoutValidationResult {
  const errors: string[] = [];
  const prefix = `layout.${layout.id}`;
  validateTerrainRows(layout, prefix, errors);
  validatePoints(layout.constraint.reservedBuildCells, `${prefix}.constraint.reservedBuildCells`, errors, (point) => isPointInBounds(point));
  if (layout.constraint.id.length === 0 || layout.constraint.description.length === 0) errors.push(`${prefix}.constraint requires id and description`);

  const startSlotIds = layout.startSlots.map((slot) => slot.id);
  if (layout.startSlots.length !== 2 || new Set(startSlotIds).size !== 2 || !sameMembers(startSlotIds, ["west", "east"])) {
    errors.push(`${prefix}.startSlots must contain west and east exactly once`);
  }
  if (layout.neutralCamps.length !== 3) errors.push(`${prefix}.neutralCamps must contain exactly three camps`);
  if (new Set(layout.neutralCamps.map((camp) => camp.monsterTypeId)).size !== layout.neutralCamps.length) {
    errors.push(`${prefix}.neutralCamps must use three distinct monster types`);
  }

  const occupied = new Map<string, string>();
  for (const slot of layout.startSlots) validateStartSlot(layout, slot, occupied, errors);
  for (const camp of layout.neutralCamps) {
    const path = `${prefix}.neutralCamps.${camp.id}`;
    if (!isLayoutWalkableCell(layout, camp.position)) errors.push(`${path}.position must be walkable and in bounds`);
    if (!Number.isSafeInteger(camp.leashRadius) || camp.leashRadius < 1) errors.push(`${path}.leashRadius must be a positive safe integer`);
    reserveCell(occupied, camp.position, path, errors);
  }
  return { ok: errors.length === 0, errors };
}

export function validateVillageAssaultLayouts(
  layouts: Readonly<Record<VillageAssaultLayoutId, VillageAssaultLayoutDefinition>> = VILLAGE_ASSAULT_LAYOUTS,
): VillageAssaultLayoutValidationResult {
  const errors: string[] = [];
  if (!sameMembers(Object.keys(layouts), VILLAGE_ASSAULT_LAYOUT_IDS)) errors.push(`layout registry must contain exactly: ${VILLAGE_ASSAULT_LAYOUT_IDS.join(", ")}`);
  const terrainSignatures = new Set<string>();
  const constraintIds = new Set<string>();
  const constraintSignatures = new Set<string>();
  for (const layoutId of VILLAGE_ASSAULT_LAYOUT_IDS) {
    const layout = layouts[layoutId];
    if (!layout) continue;
    if (layout.id !== layoutId) errors.push(`layout registry key ${layoutId} must match layout.id`);
    const result = validateVillageAssaultLayout(layout);
    errors.push(...result.errors);
    const terrainSignature = layout.terrainRows.join("\n");
    if (terrainSignatures.has(terrainSignature)) errors.push(`layout.${layoutId}.terrainRows must be unique`);
    terrainSignatures.add(terrainSignature);
    if (constraintIds.has(layout.constraint.id)) errors.push(`layout.${layoutId}.constraint.id must be unique`);
    constraintIds.add(layout.constraint.id);
    const constraintSignature = [...layout.constraint.reservedBuildCells]
      .map(pointKey)
      .sort()
      .join("|");
    if (constraintSignatures.has(constraintSignature)) errors.push(`layout.${layoutId}.constraint.reservedBuildCells must be unique`);
    constraintSignatures.add(constraintSignature);
  }
  return { ok: errors.length === 0, errors };
}

function makeLayout(
  id: VillageAssaultLayoutId,
  terrainRows: readonly string[],
  constraint: VillageAssaultLayoutConstraint,
  neutralCamps: readonly VillageAssaultNeutralCampAnchor[],
): VillageAssaultLayoutDefinition {
  return { id, terrainRows, constraint, startSlots: [makeStartSlot("west"), makeStartSlot("east")], neutralCamps };
}

function makeStartSlot(id: VillageAssaultStartSlotId): VillageAssaultStartSlot {
  const west = id === "west";
  const commandOrigin = { x: west ? 4 : 26, y: 11 };
  const placements = [placement(`${id}-town-center`, "townCenter", commandOrigin, "command")];
  const resourceAnchors = west ? [
    resourceAnchor(`${id}-food`, "food", { x: 3, y: 8 }),
    resourceAnchor(`${id}-wood`, "wood", { x: 8, y: 10 }),
    resourceAnchor(`${id}-stone`, "stone", { x: 2, y: 14 }),
  ] : [
    resourceAnchor(`${id}-food`, "food", { x: 28, y: 8 }),
    resourceAnchor(`${id}-wood`, "wood", { x: 23, y: 10 }),
    resourceAnchor(`${id}-stone`, "stone", { x: 29, y: 14 }),
  ];
  const civilianSpawns = west ? [{ x: 4, y: 8 }, { x: 8, y: 11 }, { x: 3, y: 14 }] : [{ x: 27, y: 8 }, { x: 23, y: 11 }, { x: 28, y: 14 }];
  const roles = ["gatherer", "porter", "mason"] as const satisfies readonly VillageAssaultCivilianRole[];
  return {
    id, placements, resourceAnchors,
    civilianActivities: roles.map((role, index) => ({ id: `${id}-${role}`, role, spawn: civilianSpawns[index]!, resourceAnchorId: resourceAnchors[index]!.id, dropOffPlacementId: `${id}-town-center`, shelterPlacementId: `${id}-town-center` })),
  };
}
function placement(
  id: string,
  buildingType: BuildingType,
  origin: GridPoint,
  role: VillageAssaultPlacementRole,
  orientation: StructureOrientation = "ne",
): VillageAssaultStructurePlacement {
  return { id, buildingType, origin, orientation, role };
}

function resourceAnchor(id: string, resourceKind: ResourceKind, position: GridPoint): VillageAssaultResourceAnchor {
  return { id, resourceKind, position };
}

function neutralCamp(id: string, monsterTypeId: MonsterId, position: GridPoint, leashRadius: number): VillageAssaultNeutralCampAnchor {
  return { id, monsterTypeId, position, leashRadius };
}

function validateTerrainRows(layout: VillageAssaultLayoutDefinition, prefix: string, errors: string[]): void {
  if (layout.terrainRows.length !== VILLAGE_ASSAULT_MAP_HEIGHT) errors.push(`${prefix}.terrainRows must contain ${VILLAGE_ASSAULT_MAP_HEIGHT} rows`);
  const validGlyphs = new Set<VillageAssaultTerrainGlyph>(["G", "M", "S", "W", "R", "T"]);
  for (const [rowIndex, row] of layout.terrainRows.entries()) {
    if (row.length !== VILLAGE_ASSAULT_MAP_WIDTH) errors.push(`${prefix}.terrainRows.${rowIndex} must contain ${VILLAGE_ASSAULT_MAP_WIDTH} cells`);
    for (const glyph of row) {
      if (!validGlyphs.has(glyph as VillageAssaultTerrainGlyph)) errors.push(`${prefix}.terrainRows.${rowIndex} contains unknown glyph ${glyph}`);
    }
  }
}

function validateStartSlot(
  layout: VillageAssaultLayoutDefinition,
  slot: VillageAssaultStartSlot,
  occupied: Map<string, string>,
  errors: string[],
): void {
  const prefix = `layout.${layout.id}.startSlots.${slot.id}`;
  const placementById = new Map(slot.placements.map((candidate) => [candidate.id, candidate]));
  if (placementById.size !== slot.placements.length) errors.push(`${prefix}.placements must use unique ids`);
  const roleCount = (role: VillageAssaultPlacementRole): number => slot.placements.filter((candidate) => candidate.role === role).length;
  if (roleCount("command") !== 1 || slot.placements.find((candidate) => candidate.role === "command")?.buildingType !== "townCenter") errors.push(`${prefix} requires exactly one townCenter command placement`);
  if (slot.placements.length !== 1 || roleCount("gate") || roleCount("perimeter") || roleCount("defense") || roleCount("production") || roleCount("economy")) errors.push(`${prefix} must start with one townCenter and open construction land`);

  for (const candidate of slot.placements) {
    const path = `${prefix}.placements.${candidate.id}`;
    for (const offset of getBuildingFootprint(candidate.buildingType, candidate.orientation)) {
      const cell = { x: candidate.origin.x + offset.x, y: candidate.origin.y + offset.y };
      if (!isLayoutBuildableCell(layout, cell)) errors.push(`${path} must occupy buildable in-bounds terrain`);
      reserveCell(occupied, cell, path, errors);
    }
  }

  if (slot.resourceAnchors.length < 3 || new Set(slot.resourceAnchors.map((anchor) => anchor.resourceKind)).size < 3) errors.push(`${prefix}.resourceAnchors must cover food, wood and stone`);
  const resourceById = new Map(slot.resourceAnchors.map((anchor) => [anchor.id, anchor]));
  if (resourceById.size !== slot.resourceAnchors.length) errors.push(`${prefix}.resourceAnchors must use unique ids`);
  for (const anchor of slot.resourceAnchors) {
    const path = `${prefix}.resourceAnchors.${anchor.id}`;
    if (!isLayoutBuildableCell(layout, anchor.position)) errors.push(`${path}.position must be buildable and in bounds`);
    reserveCell(occupied, anchor.position, path, errors);
  }

  if (slot.civilianActivities.length !== 3) errors.push(`${prefix}.civilianActivities requires exactly three activities`);
  if (new Set(slot.civilianActivities.map((activity) => activity.id)).size !== slot.civilianActivities.length) errors.push(`${prefix}.civilianActivities must use unique ids`);
  for (const activity of slot.civilianActivities) {
    const path = `${prefix}.civilianActivities.${activity.id}`;
    if (!resourceById.has(activity.resourceAnchorId)) errors.push(`${path}.resourceAnchorId must reference this slot`);
    if (!placementById.has(activity.dropOffPlacementId)) errors.push(`${path}.dropOffPlacementId must reference this slot`);
    if (!placementById.has(activity.shelterPlacementId)) errors.push(`${path}.shelterPlacementId must reference this slot`);
    if (!isLayoutWalkableCell(layout, activity.spawn)) errors.push(`${path}.spawn must be walkable and in bounds`);
    reserveCell(occupied, activity.spawn, path, errors);
  }
  const blocked = [
    ...collectCells(point => !isLayoutWalkableCell(layout, point)),
    ...slot.placements.flatMap(candidate => getBuildingFootprint(candidate.buildingType, candidate.orientation).map(offset => ({ x: candidate.origin.x + offset.x, y: candidate.origin.y + offset.y }))),
    ...slot.resourceAnchors.map(anchor => anchor.position),
  ];
  const blockedKeys = new Set(blocked.map(pointKey));
  const command = slot.placements.find(candidate => candidate.role === "command");
  if (command) {
    const exits = getFootprintPerimeterCells(command.origin, getBuildingFootprint(command.buildingType, command.orientation)).filter(cell => isLayoutWalkableCell(layout, cell) && !blockedKeys.has(pointKey(cell)));
    if (exits.length < 6) errors.push(`${prefix}.townCenter requires at least six clear approach cells`);
    for (const activity of slot.civilianActivities) {
      if (findPathToAny(activity.spawn, exits, VILLAGE_ASSAULT_MAP_WIDTH, VILLAGE_ASSAULT_MAP_HEIGHT, blocked) === null) errors.push(`${prefix}.${activity.id} must reach the townCenter`);
      if (orthogonalNeighbors(activity.spawn).filter(cell => isLayoutWalkableCell(layout, cell) && !blockedKeys.has(pointKey(cell))).length < 2) errors.push(`${prefix}.${activity.id} requires two open movement directions`);
    }
  }
  for (const anchor of slot.resourceAnchors) {
    const approaches = orthogonalNeighbors(anchor.position).filter(cell => isLayoutWalkableCell(layout, cell) && !blockedKeys.has(pointKey(cell)));
    if (approaches.length < 2 || slot.civilianActivities.some(activity => findPathToAny(activity.spawn, approaches, VILLAGE_ASSAULT_MAP_WIDTH, VILLAGE_ASSAULT_MAP_HEIGHT, blocked) === null)) errors.push(`${prefix}.${anchor.id} requires reachable open resource approaches`);
  }
}

function validatePoints(
  points: readonly GridPoint[],
  path: string,
  errors: string[],
  predicate: (point: GridPoint) => boolean,
): void {
  if (new Set(points.map(pointKey)).size !== points.length) errors.push(`${path} must not contain duplicates`);
  if (points.some((point) => !predicate(point))) errors.push(`${path} contains an invalid point`);
}

function reserveCell(occupied: Map<string, string>, point: GridPoint, path: string, errors: string[]): void {
  const key = pointKey(point);
  const former = occupied.get(key);
  if (former) errors.push(`${path} overlaps ${former} at ${key}`);
  else occupied.set(key, path);
}

function rectangleCells(x: number, y: number, width: number, height: number): readonly GridPoint[] {
  return Array.from({ length: width * height }, (_, index) => ({ x: x + index % width, y: y + Math.floor(index / width) }));
}

function collectCells(predicate: (point: GridPoint) => boolean): readonly GridPoint[] {
  const cells: GridPoint[] = [];
  for (let y = 0; y < VILLAGE_ASSAULT_MAP_HEIGHT; y += 1) {
    for (let x = 0; x < VILLAGE_ASSAULT_MAP_WIDTH; x += 1) {
      const point = { x, y };
      if (predicate(point)) cells.push(point);
    }
  }
  return cells;
}

function isLayoutWalkableCell(layout: VillageAssaultLayoutDefinition, point: GridPoint): boolean {
  if (!isPointInBounds(point)) return false;
  const glyph = layout.terrainRows[point.y]?.[point.x] as VillageAssaultTerrainGlyph | undefined;
  return glyph !== undefined && glyph !== "R" && glyph !== "W";
}

function isLayoutBuildableCell(layout: VillageAssaultLayoutDefinition, point: GridPoint): boolean {
  return isLayoutWalkableCell(layout, point)
    && !layout.constraint.reservedBuildCells.some((cell) => samePoint(cell, point));
}

function isPointInBounds(point: GridPoint): boolean {
  return Number.isSafeInteger(point.x)
    && Number.isSafeInteger(point.y)
    && point.x >= 0
    && point.y >= 0
    && point.x < VILLAGE_ASSAULT_MAP_WIDTH
    && point.y < VILLAGE_ASSAULT_MAP_HEIGHT;
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function orthogonalNeighbors(point: GridPoint): readonly GridPoint[] {
  return [
    { x: point.x, y: point.y - 1 },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x - 1, y: point.y },
  ];
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

const BUILT_IN_LAYOUT_VALIDATION = validateVillageAssaultLayouts();
if (!BUILT_IN_LAYOUT_VALIDATION.ok) {
  throw new Error(`Invalid Village Assault layout registry:\n${BUILT_IN_LAYOUT_VALIDATION.errors.join("\n")}`);
}
