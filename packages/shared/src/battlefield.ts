import type { GridPoint } from "./protocol.js";

export const VILLAGE_ASSAULT_MAP_ID = "villageAssault";
export const VILLAGE_ASSAULT_MAP_WIDTH = 18;
export const VILLAGE_ASSAULT_MAP_HEIGHT = 16;

export type VillageAssaultTerrainGlyph = "G" | "M" | "S" | "W" | "R" | "T";

export const VILLAGE_ASSAULT_MAP_ROWS = [
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

for (const [rowIndex, row] of VILLAGE_ASSAULT_MAP_ROWS.entries()) {
  if (row.length !== VILLAGE_ASSAULT_MAP_WIDTH) throw new Error(`Village assault map row ${rowIndex} must contain ${VILLAGE_ASSAULT_MAP_WIDTH} tiles`);
}
if (VILLAGE_ASSAULT_MAP_ROWS.length !== VILLAGE_ASSAULT_MAP_HEIGHT) throw new Error(`Village assault map must contain ${VILLAGE_ASSAULT_MAP_HEIGHT} rows`);

export function getVillageAssaultTerrainGlyph(point: GridPoint): VillageAssaultTerrainGlyph | undefined {
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) return undefined;
  if (point.x < 0 || point.y < 0 || point.x >= VILLAGE_ASSAULT_MAP_WIDTH || point.y >= VILLAGE_ASSAULT_MAP_HEIGHT) return undefined;
  return VILLAGE_ASSAULT_MAP_ROWS[point.y]![point.x] as VillageAssaultTerrainGlyph;
}

export function isVillageAssaultWalkableCell(point: GridPoint): boolean {
  const glyph = getVillageAssaultTerrainGlyph(point);
  return glyph !== undefined && glyph !== "R" && glyph !== "W";
}

export function isVillageAssaultBuildableCell(point: GridPoint): boolean {
  if (!isVillageAssaultWalkableCell(point)) return false;
  return !(point.x >= 7 && point.x <= 10 && point.y >= 3 && point.y <= 12);
}

export function getVillageAssaultWalkBlockedCells(): readonly GridPoint[] {
  return collectCells((point) => !isVillageAssaultWalkableCell(point));
}

export function getVillageAssaultBuildBlockedCells(): readonly GridPoint[] {
  return collectCells((point) => !isVillageAssaultBuildableCell(point));
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
