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

export interface PathRoute {
  readonly firstStep: GridPoint;
  readonly distance: number;
}

export interface PathToAnyRoute extends PathRoute {
  readonly target: GridPoint;
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
  return findPathRoute(start, target, mapWidth, mapHeight, blockedCells)?.firstStep ?? null;
}

/** Finds the deterministic first step and total shortest-path distance. */
export function findPathRoute(
  start: GridPoint,
  target: GridPoint,
  mapWidth: number,
  mapHeight: number,
  blockedCells: readonly GridPoint[],
): PathRoute | null {
  if (!isWithinBounds(start, mapWidth, mapHeight) || !isWithinBounds(target, mapWidth, mapHeight)) {
    return null;
  }

  const cellCount = mapWidth * mapHeight;
  const blocked = new Uint8Array(cellCount);
  for (const cell of blockedCells) {
    if (isWithinBounds(cell, mapWidth, mapHeight)) blocked[toIndex(cell, mapWidth)] = 1;
  }
  const targetIndex = toIndex(target, mapWidth);
  const goals = blocked[targetIndex] === 1
    ? CARDINAL_NEIGHBORS
      .map((offset) => addPoints(target, offset))
      .filter((candidate) => isWithinBounds(candidate, mapWidth, mapHeight) && blocked[toIndex(candidate, mapWidth)] === 0)
    : [target];

  if (goals.length === 0) return null;
  const goalMask = new Uint8Array(cellCount);
  for (const goal of goals) goalMask[toIndex(goal, mapWidth)] = 1;
  const startIndex = toIndex(start, mapWidth);
  if (goalMask[startIndex] === 1) return { firstStep: { ...start }, distance: 0 };

  const visited = new Uint8Array(cellCount);
  visited[startIndex] = 1;
  const queue = new Int32Array(cellCount);
  const firstSteps = new Int32Array(cellCount);
  const distances = new Int32Array(cellCount);
  let head = 0;
  let tail = 0;

  for (const offset of CARDINAL_NEIGHBORS) {
    const candidate = addPoints(start, offset);
    if (!isWithinBounds(candidate, mapWidth, mapHeight)) continue;
    const candidateIndex = toIndex(candidate, mapWidth);
    if (blocked[candidateIndex] === 1 || visited[candidateIndex] === 1) continue;
    if (goalMask[candidateIndex] === 1) return { firstStep: candidate, distance: 1 };
    visited[candidateIndex] = 1;
    queue[tail] = candidateIndex;
    firstSteps[tail] = candidateIndex;
    distances[tail] = 1;
    tail += 1;
  }

  while (head < tail) {
    const currentIndex = queue[head]!;
    const firstStepIndex = firstSteps[head]!;
    const currentDistance = distances[head]!;
    head += 1;
    const current = fromIndex(currentIndex, mapWidth);
    for (const offset of CARDINAL_NEIGHBORS) {
      const candidate = addPoints(current, offset);
      if (!isWithinBounds(candidate, mapWidth, mapHeight)) continue;
      const candidateIndex = toIndex(candidate, mapWidth);
      if (blocked[candidateIndex] === 1 || visited[candidateIndex] === 1) continue;
      if (goalMask[candidateIndex] === 1) {
        return { firstStep: fromIndex(firstStepIndex, mapWidth), distance: currentDistance + 1 };
      }
      visited[candidateIndex] = 1;
      queue[tail] = candidateIndex;
      firstSteps[tail] = firstStepIndex;
      distances[tail] = currentDistance + 1;
      tail += 1;
    }
  }

  return null;
}

/** Finds one shortest route to any supplied walkable target in one BFS pass. */
export function findPathToAny(
  start: GridPoint,
  targets: readonly GridPoint[],
  mapWidth: number,
  mapHeight: number,
  blockedCells: readonly GridPoint[],
): PathToAnyRoute | null {
  if (!isWithinBounds(start, mapWidth, mapHeight)) return null;
  const cellCount = mapWidth * mapHeight;
  const blocked = new Uint8Array(cellCount);
  for (const cell of blockedCells) {
    if (isWithinBounds(cell, mapWidth, mapHeight)) blocked[toIndex(cell, mapWidth)] = 1;
  }
  const targetMask = new Uint8Array(cellCount);
  for (const target of targets) {
    if (isWithinBounds(target, mapWidth, mapHeight) && blocked[toIndex(target, mapWidth)] === 0) targetMask[toIndex(target, mapWidth)] = 1;
  }
  const startIndex = toIndex(start, mapWidth);
  if (targetMask[startIndex] === 1) return { target: { ...start }, firstStep: { ...start }, distance: 0 };

  const visited = new Uint8Array(cellCount);
  visited[startIndex] = 1;
  const queue = new Int32Array(cellCount);
  const firstSteps = new Int32Array(cellCount);
  const distances = new Int32Array(cellCount);
  let head = 0;
  let tail = 0;

  for (const offset of CARDINAL_NEIGHBORS) {
    const candidate = addPoints(start, offset);
    if (!isWithinBounds(candidate, mapWidth, mapHeight)) continue;
    const candidateIndex = toIndex(candidate, mapWidth);
    if (blocked[candidateIndex] === 1 || visited[candidateIndex] === 1) continue;
    if (targetMask[candidateIndex] === 1) return { target: candidate, firstStep: candidate, distance: 1 };
    visited[candidateIndex] = 1;
    queue[tail] = candidateIndex;
    firstSteps[tail] = candidateIndex;
    distances[tail] = 1;
    tail += 1;
  }

  while (head < tail) {
    const currentIndex = queue[head]!;
    const firstStepIndex = firstSteps[head]!;
    const currentDistance = distances[head]!;
    head += 1;
    const current = fromIndex(currentIndex, mapWidth);
    for (const offset of CARDINAL_NEIGHBORS) {
      const candidate = addPoints(current, offset);
      if (!isWithinBounds(candidate, mapWidth, mapHeight)) continue;
      const candidateIndex = toIndex(candidate, mapWidth);
      if (blocked[candidateIndex] === 1 || visited[candidateIndex] === 1) continue;
      if (targetMask[candidateIndex] === 1) {
        return { target: candidate, firstStep: fromIndex(firstStepIndex, mapWidth), distance: currentDistance + 1 };
      }
      visited[candidateIndex] = 1;
      queue[tail] = candidateIndex;
      firstSteps[tail] = firstStepIndex;
      distances[tail] = currentDistance + 1;
      tail += 1;
    }
  }

  return null;
}

function toIndex(point: GridPoint, mapWidth: number): number {
  return point.y * mapWidth + point.x;
}

function fromIndex(index: number, mapWidth: number): GridPoint {
  return { x: index % mapWidth, y: Math.floor(index / mapWidth) };
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
