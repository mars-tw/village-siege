export interface PresentedWorldPosition {
  readonly x: number;
  readonly y: number;
}

export interface UnitMotionTarget {
  /** Monotonic authoritative tick used only to reject stale presentation updates. */
  readonly serverTick: number;
  readonly position: PresentedWorldPosition;
  /** Observed time between authoritative grid steps; no future position is inferred. */
  readonly observedStepIntervalMs?: number;
  /** Optional authoritative/effective display speed after terrain and unit modifiers. */
  readonly effectiveSpeedPixelsPerSecond?: number;
}

export interface UnitMotionPresentationOptions {
  readonly defaultStepIntervalMs?: number;
  readonly arrivalEpsilonPixels?: number;
}

export type PresentedFacing = "e" | "ne" | "nw" | "w" | "sw" | "se";

/** Horizontal fallback for a single authored perspective; directional sheets bypass it. */
export function singleSheetFlipX(facing: PresentedFacing, authoredFacing: "left" | "right" | undefined): boolean {
  return (facing === "w" || facing === "nw" || facing === "sw") !== (authoredFacing === "left");
}

/**
 * Smooths already-public authoritative positions without changing simulation state.
 * The presenter deliberately trails the newest target and never predicts another cell.
 */
export class UnitMotionPresentation {
  private displayX: number;
  private displayY: number;
  private targetX: number;
  private targetY: number;
  private targetTick: number;
  private speedPixelsPerSecond = 0;
  private readonly defaultStepIntervalMs: number;
  private readonly arrivalEpsilonPixels: number;

  constructor(initial: PresentedWorldPosition, initialServerTick = 0, options: UnitMotionPresentationOptions = {}) {
    assertPosition(initial);
    assertTick(initialServerTick);
    this.displayX = initial.x;
    this.displayY = initial.y;
    this.targetX = initial.x;
    this.targetY = initial.y;
    this.targetTick = initialServerTick;
    this.defaultStepIntervalMs = positive(options.defaultStepIntervalMs ?? 1_000, "defaultStepIntervalMs");
    this.arrivalEpsilonPixels = nonNegative(options.arrivalEpsilonPixels ?? 0.05, "arrivalEpsilonPixels");
  }

  get position(): PresentedWorldPosition {
    return { x: this.displayX, y: this.displayY };
  }

  get targetPosition(): PresentedWorldPosition {
    return { x: this.targetX, y: this.targetY };
  }

  get moving(): boolean {
    return distance(this.displayX, this.displayY, this.targetX, this.targetY) > this.arrivalEpsilonPixels;
  }

  /** Returns false for an older authoritative tick. Same-target refreshes never move the display position. */
  setAuthoritativeTarget(update: UnitMotionTarget): boolean {
    assertTick(update.serverTick);
    assertPosition(update.position);
    if (update.effectiveSpeedPixelsPerSecond !== undefined) positive(update.effectiveSpeedPixelsPerSecond, "effectiveSpeedPixelsPerSecond");
    if (update.observedStepIntervalMs !== undefined) positive(update.observedStepIntervalMs, "observedStepIntervalMs");
    if (update.serverTick < this.targetTick) return false;

    const sameTarget = update.position.x === this.targetX && update.position.y === this.targetY;
    this.targetTick = update.serverTick;
    this.targetX = update.position.x;
    this.targetY = update.position.y;

    const remaining = distance(this.displayX, this.displayY, this.targetX, this.targetY);
    if (remaining <= this.arrivalEpsilonPixels) {
      this.displayX = this.targetX;
      this.displayY = this.targetY;
      this.speedPixelsPerSecond = 0;
      return true;
    }

    if (update.effectiveSpeedPixelsPerSecond !== undefined) {
      this.speedPixelsPerSecond = positive(update.effectiveSpeedPixelsPerSecond, "effectiveSpeedPixelsPerSecond");
    } else if (update.observedStepIntervalMs !== undefined && (!sameTarget || this.speedPixelsPerSecond <= 0)) {
      this.speedPixelsPerSecond = remaining * 1_000 / update.observedStepIntervalMs;
    } else if (!sameTarget || this.speedPixelsPerSecond <= 0) {
      this.speedPixelsPerSecond = remaining * 1_000 / this.defaultStepIntervalMs;
    }
    return true;
  }

  /** Advance once per render frame. Returns the current position for direct actor placement. */
  update(deltaMs: number): PresentedWorldPosition {
    nonNegative(deltaMs, "deltaMs");
    const remaining = distance(this.displayX, this.displayY, this.targetX, this.targetY);
    if (remaining <= this.arrivalEpsilonPixels) return this.arrive();
    const travel = this.speedPixelsPerSecond * deltaMs / 1_000;
    if (travel >= remaining) return this.arrive();
    if (travel <= 0) return this.position;
    const ratio = travel / remaining;
    this.displayX += (this.targetX - this.displayX) * ratio;
    this.displayY += (this.targetY - this.displayY) * ratio;
    return this.position;
  }

  /** Explicit bounded correction for spawn/resync/teleport or a caller-owned stop/attack transition. */
  snapToAuthoritativeTarget(): PresentedWorldPosition {
    return this.arrive();
  }

  private arrive(): PresentedWorldPosition {
    this.displayX = this.targetX;
    this.displayY = this.targetY;
    this.speedPixelsPerSecond = 0;
    return this.position;
  }
}

function distance(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.hypot(toX - fromX, toY - fromY);
}

function assertPosition(position: PresentedWorldPosition): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new RangeError("position must contain finite coordinates");
}

function assertTick(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("serverTick must be a non-negative safe integer");
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
  return value;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative and finite`);
  return value;
}
