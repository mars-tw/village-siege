export interface GridPoint { x: number; y: number }
export interface ScreenPoint { x: number; y: number }

export const TILE_WIDTH = 96;
export const TILE_HEIGHT = 48;
export const HALF_TILE_WIDTH = TILE_WIDTH / 2;
export const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;

export function gridToWorld(point: GridPoint, origin: ScreenPoint, elevation = 0): ScreenPoint {
  return {
    x: origin.x + (point.x - point.y) * HALF_TILE_WIDTH,
    y: origin.y + (point.x + point.y) * HALF_TILE_HEIGHT - elevation
  };
}

export function worldToGrid(point: ScreenPoint, origin: ScreenPoint): GridPoint {
  const diagonalX = (point.x - origin.x) / HALF_TILE_WIDTH;
  const diagonalY = (point.y - origin.y) / HALF_TILE_HEIGHT;
  return { x: (diagonalX + diagonalY) / 2, y: (diagonalY - diagonalX) / 2 };
}

export function clampGrid(point: GridPoint, width: number, height: number): GridPoint {
  return {
    x: Math.max(0, Math.min(width - 1, point.x)),
    y: Math.max(0, Math.min(height - 1, point.y))
  };
}

export function gridDistance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
