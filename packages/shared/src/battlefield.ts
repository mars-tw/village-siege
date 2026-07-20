import type { MonsterId } from "./combat.js";
import { getBuildingFootprint } from "./content.js";
import type {
  BuildingType,
  GridPoint,
  PlayableVillageId,
  ResourceKind,
  StructureOrientation,
} from "./protocol.js";

export const VILLAGE_ASSAULT_MAP_ID = "villageAssault";
export const VILLAGE_ASSAULT_MAP_WIDTH = 18;
export const VILLAGE_ASSAULT_MAP_HEIGHT = 16;

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

const PINEHOLD_TERRAIN_ROWS = [
  "TTGGGGRRRGGGGGGTTT",
  "TGGGGGRRRGGGGGGGGT",
  "GGGMMGGRRGGGMMGGGG",
  "GGGGSSSWWSSSSGGGGG",
  "GSSSSSSWWSSSSSSSSG",
  "GGGGGSSWWSSGGGGGGG",
  "TRGGGGSSSSGGGGRRGT",
  "TGGGGGSSSSSSGGGGGT",
  "TGGGGGSSSSSSGGGGGT",
  "TRGGGGSSSSGGGGRRGT",
  "GMMMMMMWWMMMMMMMMG",
  "GGGGGMMWWMMGGGGGGG",
  "GGTTGGGWWGGGTTGGGG",
  "GGGTTGGMMMGGTTGGGG",
  "TGGGGGGMMGGGGGGGGT",
  "TTTGGGGMMGGGGGGTTT",
] as const;

const RIVERSTEAD_TERRAIN_ROWS = [
  "TTGGGGRRRGGGGGGTTT",
  "TGGGGGRRRGGGGGGGGT",
  "GGGGGGRRRGGGGGGGGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGSSSSSSSSSSSSSSGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGGGGGSSSSGGGGGGGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGSSSSSSSSSSSSSSGG",
  "GGGGGGGWWGGGGGGGGG",
  "GGGGGGGWWGGGGGGGGG",
  "TGGGGGGRRRGGGGGGGT",
  "TTGGGGGRRRGGGGGTTT",
] as const;

const HIGHCRAG_TERRAIN_ROWS = [
  "TTTGGGRRRGGGGGGTTT",
  "TGGGGGRRRGGGGGGGGT",
  "GGGGGGRRRGGGGGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGGSSSSSSSSGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGSSSSSSSSSSGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGGSSSSSSSSGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "GGGGGGGRRRGGGGGGGG",
  "TGGGGGGRRRGGGGGGGT",
  "TTTGGGGRRRGGGGTTTT",
] as const;

export const VILLAGE_ASSAULT_LAYOUTS: Readonly<Record<VillageAssaultLayoutId, VillageAssaultLayoutDefinition>> = {
  pinehold: makeLayout(
    "pinehold",
    PINEHOLD_TERRAIN_ROWS,
    {
      id: "pinehold-caravan-reserve",
      description: "A broad central caravan reserve cannot be sealed by new construction.",
      reservedBuildCells: rectangleCells(7, 3, 4, 10),
    },
    "lumberCamp",
    [
      neutralCamp("pinehold-miremaw", "miremaw", { x: 9, y: 2 }, 4),
      neutralCamp("pinehold-ashwing", "ashwing", { x: 8, y: 7 }, 5),
      neutralCamp("pinehold-rootback", "rootback", { x: 9, y: 13 }, 4),
    ],
  ),
  riverstead: makeLayout(
    "riverstead",
    RIVERSTEAD_TERRAIN_ROWS,
    {
      id: "riverstead-floodplain-reserve",
      description: "The floodplain and its causeways remain free of construction from bank to bank.",
      reservedBuildCells: rectangleCells(7, 2, 4, 12),
    },
    "farmstead",
    [
      neutralCamp("riverstead-miremaw", "miremaw", { x: 9, y: 5 }, 4),
      neutralCamp("riverstead-ashwing", "ashwing", { x: 9, y: 8 }, 5),
      neutralCamp("riverstead-rootback", "rootback", { x: 9, y: 11 }, 4),
    ],
  ),
  highcrag: makeLayout(
    "highcrag",
    HIGHCRAG_TERRAIN_ROWS,
    {
      id: "highcrag-escarpment-reserve",
      description: "The shale escarpment and three crossing shelves reject permanent construction.",
      reservedBuildCells: rectangleCells(7, 1, 4, 14),
    },
    "lumberCamp",
    [
      neutralCamp("highcrag-miremaw", "miremaw", { x: 8, y: 5 }, 4),
      neutralCamp("highcrag-ashwing", "ashwing", { x: 9, y: 8 }, 5),
      neutralCamp("highcrag-rootback", "rootback", { x: 8, y: 11 }, 4),
    ],
  ),
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
  economyBuilding: "farmstead" | "lumberCamp",
  neutralCamps: readonly VillageAssaultNeutralCampAnchor[],
): VillageAssaultLayoutDefinition {
  return {
    id,
    terrainRows,
    constraint,
    startSlots: [
      makeStartSlot("west", economyBuilding),
      makeStartSlot("east", economyBuilding),
    ],
    neutralCamps,
  };
}

function makeStartSlot(
  id: VillageAssaultStartSlotId,
  economyBuilding: "farmstead" | "lumberCamp",
): VillageAssaultStartSlot {
  const west = id === "west";
  const bounds = west
    ? { minimumX: 2, maximumX: 6, minimumY: 3, maximumY: 12 }
    : { minimumX: 11, maximumX: 16, minimumY: 3, maximumY: 12 };
  const gateOrigin = { x: west ? bounds.maximumX : bounds.minimumX, y: 7 };
  const commandOrigin = { x: west ? 3 : 14, y: 7 };
  const placements: VillageAssaultStructurePlacement[] = [
    placement(`${id}-town-center`, "townCenter", commandOrigin, "command"),
    placement(`${id}-gate`, "surveyGate", gateOrigin, "gate", "se"),
    ...perimeterWalls(id, bounds, gateOrigin),
    placement(`${id}-tower-north`, "defenseTower", { x: west ? 3 : 15, y: 4 }, "defense"),
    placement(`${id}-tower-south`, "defenseTower", { x: west ? 3 : 15, y: 11 }, "defense"),
    placement(`${id}-barracks`, "barracks", { x: west ? 4 : 12, y: 4 }, "production"),
    placement(`${id}-economy`, economyBuilding, { x: west ? 4 : 12, y: 10 }, "economy"),
  ];
  const resourceAnchors: readonly VillageAssaultResourceAnchor[] = west
    ? [
        resourceAnchor(`${id}-food`, "food", { x: 3, y: 6 }),
        resourceAnchor(`${id}-wood`, "wood", { x: 5, y: 7 }),
        resourceAnchor(`${id}-stone`, "stone", { x: 5, y: 9 }),
      ]
    : [
        resourceAnchor(`${id}-food`, "food", { x: 12, y: 6 }),
        resourceAnchor(`${id}-wood`, "wood", { x: 13, y: 7 }),
        resourceAnchor(`${id}-stone`, "stone", { x: 12, y: 9 }),
      ];
  const civilianSpawns = west
    ? [{ x: 3, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 9 }]
    : [{ x: 13, y: 6 }, { x: 12, y: 7 }, { x: 13, y: 9 }];
  const civilianRoles = ["gatherer", "porter", "mason"] as const satisfies readonly VillageAssaultCivilianRole[];
  return {
    id,
    placements,
    resourceAnchors,
    civilianActivities: civilianRoles.map((role, index) => ({
      id: `${id}-${role}`,
      role,
      spawn: civilianSpawns[index]!,
      resourceAnchorId: resourceAnchors[index]!.id,
      dropOffPlacementId: `${id}-town-center`,
      shelterPlacementId: `${id}-town-center`,
    })),
  };
}

function perimeterWalls(
  slotId: VillageAssaultStartSlotId,
  bounds: { readonly minimumX: number; readonly maximumX: number; readonly minimumY: number; readonly maximumY: number },
  gateOrigin: GridPoint,
): readonly VillageAssaultStructurePlacement[] {
  const boundary: GridPoint[] = [];
  for (let y = bounds.minimumY; y <= bounds.maximumY; y += 1) {
    for (let x = bounds.minimumX; x <= bounds.maximumX; x += 1) {
      if (x === bounds.minimumX || x === bounds.maximumX || y === bounds.minimumY || y === bounds.maximumY) boundary.push({ x, y });
    }
  }
  const gateCells = new Set([pointKey(gateOrigin), pointKey({ x: gateOrigin.x, y: gateOrigin.y + 1 })]);
  return boundary
    .filter((cell) => !gateCells.has(pointKey(cell)))
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((origin) => placement(`${slotId}-wall-${origin.x}-${origin.y}`, "resinPalisade", origin, "perimeter"));
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
  if (roleCount("gate") < 1 || slot.placements.some((candidate) => candidate.role === "gate" && candidate.buildingType !== "surveyGate")) errors.push(`${prefix} requires at least one surveyGate placement`);
  if (roleCount("perimeter") < 8 || slot.placements.some((candidate) => candidate.role === "perimeter" && candidate.buildingType !== "resinPalisade")) errors.push(`${prefix} requires a resinPalisade perimeter`);
  if (roleCount("defense") < 2 || slot.placements.some((candidate) => candidate.role === "defense" && candidate.buildingType !== "defenseTower")) errors.push(`${prefix} requires at least two defenseTower placements`);
  if (roleCount("production") < 1) errors.push(`${prefix} requires a production placement`);
  if (roleCount("economy") < 1) errors.push(`${prefix} requires an economy placement`);

  for (const candidate of slot.placements) {
    const path = `${prefix}.placements.${candidate.id}`;
    for (const offset of getBuildingFootprint(candidate.buildingType, candidate.orientation)) {
      const cell = { x: candidate.origin.x + offset.x, y: candidate.origin.y + offset.y };
      if (!isLayoutBuildableCell(layout, cell)) errors.push(`${path} must occupy buildable in-bounds terrain`);
      reserveCell(occupied, cell, path, errors);
    }
  }
  validateClosedPerimeter(layout, slot, errors);

  if (slot.resourceAnchors.length < 3 || new Set(slot.resourceAnchors.map((anchor) => anchor.resourceKind)).size < 3) errors.push(`${prefix}.resourceAnchors must cover food, wood and stone`);
  const resourceById = new Map(slot.resourceAnchors.map((anchor) => [anchor.id, anchor]));
  if (resourceById.size !== slot.resourceAnchors.length) errors.push(`${prefix}.resourceAnchors must use unique ids`);
  for (const anchor of slot.resourceAnchors) {
    const path = `${prefix}.resourceAnchors.${anchor.id}`;
    if (!isLayoutBuildableCell(layout, anchor.position)) errors.push(`${path}.position must be buildable and in bounds`);
    reserveCell(occupied, anchor.position, path, errors);
  }

  if (slot.civilianActivities.length < 3) errors.push(`${prefix}.civilianActivities requires at least three activities`);
  if (new Set(slot.civilianActivities.map((activity) => activity.id)).size !== slot.civilianActivities.length) errors.push(`${prefix}.civilianActivities must use unique ids`);
  for (const activity of slot.civilianActivities) {
    const path = `${prefix}.civilianActivities.${activity.id}`;
    if (!resourceById.has(activity.resourceAnchorId)) errors.push(`${path}.resourceAnchorId must reference this slot`);
    if (!placementById.has(activity.dropOffPlacementId)) errors.push(`${path}.dropOffPlacementId must reference this slot`);
    if (!placementById.has(activity.shelterPlacementId)) errors.push(`${path}.shelterPlacementId must reference this slot`);
    if (!isLayoutWalkableCell(layout, activity.spawn)) errors.push(`${path}.spawn must be walkable and in bounds`);
    reserveCell(occupied, activity.spawn, path, errors);
  }
}

function validateClosedPerimeter(layout: VillageAssaultLayoutDefinition, slot: VillageAssaultStartSlot, errors: string[]): void {
  const perimeterCells = slot.placements
    .filter((candidate) => candidate.role === "perimeter" || candidate.role === "gate")
    .flatMap((candidate) => getBuildingFootprint(candidate.buildingType, candidate.orientation).map((offset) => ({
      x: candidate.origin.x + offset.x,
      y: candidate.origin.y + offset.y,
    })));
  const keys = new Set(perimeterCells.map(pointKey));
  if (keys.size !== perimeterCells.length) {
    errors.push(`layout.${layout.id}.startSlots.${slot.id}.perimeter cells must not overlap`);
    return;
  }
  if (perimeterCells.some((cell) => orthogonalNeighbors(cell).filter((neighbor) => keys.has(pointKey(neighbor))).length !== 2)) {
    errors.push(`layout.${layout.id}.startSlots.${slot.id}.perimeter must form one continuous closed ring`);
    return;
  }
  const remaining = new Set(keys);
  const pending = [perimeterCells[0]!];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!remaining.delete(pointKey(current))) continue;
    pending.push(...orthogonalNeighbors(current).filter((neighbor) => remaining.has(pointKey(neighbor))));
  }
  if (remaining.size > 0) errors.push(`layout.${layout.id}.startSlots.${slot.id}.perimeter must be connected`);
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
