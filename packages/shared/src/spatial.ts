import type { GridPoint } from "./protocol.js";

/** Cardinal order is part of the replay contract. Do not reorder casually. */
const CARDINAL_NEIGHBORS: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export interface FootprintValidation {
  readonly ok: boolean;
  readonly reason: "OUT_OF_BOUNDS" | "OCCUPIED" | null;
  readonly cells: readonly GridPoint[];
}

/** Resolves footprint-local offsets into absolute map cells. */
export function getFootprintCells(origin: GridPoint, offsets: readonly GridPoint[]): readonly GridPoint[] {
  return offsets.map((offset) => ({
    x: origin.x + offset.x,
    y: origin.y + offset.y,
  }));
}

/** Returns unique cardinal cells immediately outside a footprint in stable order. */
export function getFootprintPerimeterCells(origin: GridPoint, offsets: readonly GridPoint[]): readonly GridPoint[] {
  const cells = getFootprintCells(origin, offsets);
  const footprint = new Set(cells.map(pointKey));
  const seen = new Set<string>();
  const perimeter: GridPoint[] = [];
  for (const cell of cells) {
    for (const offset of CARDINAL_NEIGHBORS) {
      const candidate = addPoints(cell, offset);
      const key = pointKey(candidate);
      if (footprint.has(key) || seen.has(key)) continue;
      seen.add(key);
      perimeter.push(candidate);
    }
  }
  return perimeter;
}

/** True when every footprint cell is inside the half-open map bounds. */
export function isFootprintWithinBounds(cells: readonly GridPoint[], mapWidth: number, mapHeight: number): boolean {
  return cells.every((cell) => isWithinBounds(cell, mapWidth, mapHeight));
}

/** True when any footprint cell shares a coordinate with an occupied cell. */
export function doesFootprintOverlap(cells: readonly GridPoint[], occupiedCells: readonly GridPoint[]): boolean {
  const occupied = new Set(occupiedCells.map(pointKey));
  return cells.some((cell) => occupied.has(pointKey(cell)));
}

/**
 * Resolves and validates a footprint in one operation. Occupancy may combine
 * resource cells, building cells, or any other caller-defined obstruction.
 */
export function validateFootprintPlacement(
  origin: GridPoint,
  offsets: readonly GridPoint[],
  mapWidth: number,
  mapHeight: number,
  occupiedCells: readonly GridPoint[],
): FootprintValidation {
  const cells = getFootprintCells(origin, offsets);
  if (!isFootprintWithinBounds(cells, mapWidth, mapHeight)) {
    return { ok: false, reason: "OUT_OF_BOUNDS", cells };
  }
  if (doesFootprintOverlap(cells, occupiedCells)) {
    return { ok: false, reason: "OCCUPIED", cells };
  }
  return { ok: true, reason: null, cells };
}

/**
 * Finds one deterministic four-way step along a shortest path.
 *
 * When the target is blocked, its walkable cardinal neighbors become the goal
 * set. The start cell remains legal even if callers include it in blockedCells,
 * which lets an entity path out of its own occupied cell.
 */
export function findNextPathStep(
  start: GridPoint,
  target: GridPoint,
  mapWidth: number,
  mapHeight: number,
  blockedCells: readonly GridPoint[],
): GridPoint | null {
  if (!isWithinBounds(start, mapWidth, mapHeight) || !isWithinBounds(target, mapWidth, mapHeight)) {
    return null;
  }

  const blocked = new Set(blockedCells.map(pointKey));
  const targetKey = pointKey(target);
  const goals = blocked.has(targetKey)
    ? CARDINAL_NEIGHBORS
      .map((offset) => addPoints(target, offset))
      .filter((candidate) => isWithinBounds(candidate, mapWidth, mapHeight) && !blocked.has(pointKey(candidate)))
    : [target];

  if (goals.length === 0) return null;
  const goalKeys = new Set(goals.map(pointKey));
  const startKey = pointKey(start);
  if (goalKeys.has(startKey)) return { ...start };

  interface SearchNode {
    readonly position: GridPoint;
    readonly firstStep: GridPoint;
  }

  const visited = new Set<string>([startKey]);
  const queue: SearchNode[] = [];
  let head = 0;

  for (const offset of CARDINAL_NEIGHBORS) {
    const candidate = addPoints(start, offset);
    const candidateKey = pointKey(candidate);
    if (!isWithinBounds(candidate, mapWidth, mapHeight) || blocked.has(candidateKey) || visited.has(candidateKey)) continue;
    if (goalKeys.has(candidateKey)) return candidate;
    visited.add(candidateKey);
    queue.push({ position: candidate, firstStep: candidate });
  }

  while (head < queue.length) {
    const current = queue[head++];
    if (!current) break;
    for (const offset of CARDINAL_NEIGHBORS) {
      const candidate = addPoints(current.position, offset);
      const candidateKey = pointKey(candidate);
      if (!isWithinBounds(candidate, mapWidth, mapHeight) || blocked.has(candidateKey) || visited.has(candidateKey)) continue;
      if (goalKeys.has(candidateKey)) return current.firstStep;
      visited.add(candidateKey);
      queue.push({ position: candidate, firstStep: current.firstStep });
    }
  }

  return null;
}

function isWithinBounds(point: GridPoint, mapWidth: number, mapHeight: number): boolean {
  return Number.isSafeInteger(point.x)
    && Number.isSafeInteger(point.y)
    && Number.isSafeInteger(mapWidth)
    && Number.isSafeInteger(mapHeight)
    && mapWidth > 0
    && mapHeight > 0
    && point.x >= 0
    && point.y >= 0
    && point.x < mapWidth
    && point.y < mapHeight;
}

function addPoints(left: GridPoint, right: GridPoint): GridPoint {
  return { x: left.x + right.x, y: left.y + right.y };
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}
