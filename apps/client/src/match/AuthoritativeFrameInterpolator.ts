import {
  TICK_MILLISECONDS,
  type GridPoint,
  type VisibleSnapshot,
} from "@village-siege/shared";
import type { ResolvedMatchFrame } from "../network/AuthoritativeMatchStore.js";

export interface PresentationPosition {
  readonly id: string;
  readonly position: GridPoint;
}

/**
 * Presentation-only positions sampled between two consecutive authoritative
 * frames. Gameplay values deliberately stay outside this type: callers must
 * read wallet, health, queues and victory from the latest verified snapshot.
 */
export interface AuthoritativeFramePresentation {
  readonly fromServerTick: number;
  readonly toServerTick: number;
  readonly alpha: number;
  readonly entityPositions: readonly PresentationPosition[];
  readonly projectilePositions: readonly PresentationPosition[];
}

/**
 * Buffers verified recipient frames for visual interpolation only.
 *
 * It never extrapolates, never edits an input snapshot and never produces a
 * checksum-bearing synthetic snapshot. Full snapshots and tick gaps reset the
 * interpolation base so reconnect/resync cannot blend unrelated worlds.
 */
export class AuthoritativeFrameInterpolator {
  private previous?: VisibleSnapshot;
  private latest?: VisibleSnapshot;
  private interpolationStartedAtMs = 0;
  private interpolationDurationMs = TICK_MILLISECONDS;

  get current(): VisibleSnapshot | undefined {
    return this.latest ? cloneWire(this.latest) : undefined;
  }

  push(frame: ResolvedMatchFrame, receivedAtMs: number): void {
    assertFiniteTime(receivedAtMs);
    const next = cloneWire(frame.snapshot);
    const current = this.latest;
    const consecutive = current
      && sameStream(current, next)
      && next.serverTick === current.serverTick + 1;

    if (frame.kind === "snapshot" || !consecutive) {
      this.reset(next, receivedAtMs);
      return;
    }

    this.previous = current;
    this.latest = next;
    this.interpolationStartedAtMs = receivedAtMs;
    this.interpolationDurationMs = Math.max(
      TICK_MILLISECONDS,
      (next.serverTick - current.serverTick) * TICK_MILLISECONDS,
    );
  }

  /** Freezes presentation at a safe authoritative snapshot. */
  reset(snapshot?: VisibleSnapshot, receivedAtMs = 0): void {
    assertFiniteTime(receivedAtMs);
    this.previous = undefined;
    this.latest = snapshot ? cloneWire(snapshot) : undefined;
    this.interpolationStartedAtMs = receivedAtMs;
    this.interpolationDurationMs = TICK_MILLISECONDS;
  }

  sample(nowMs: number): AuthoritativeFramePresentation | undefined {
    assertFiniteTime(nowMs);
    const latest = this.latest;
    if (!latest) return undefined;

    const previous = this.previous;
    const alpha = previous
      ? clamp01((nowMs - this.interpolationStartedAtMs) / this.interpolationDurationMs)
      : 1;
    const previousEntities = new Map(previous?.entities.map((entity) => [entity.id, entity]));
    const previousProjectiles = new Map(previous?.projectiles.map((projectile) => [projectile.id, projectile]));
    const visibleIds = new Set(latest.visibleEntityIds);

    return {
      fromServerTick: previous?.serverTick ?? latest.serverTick,
      toServerTick: latest.serverTick,
      alpha,
      entityPositions: latest.entities
        .filter((entity) => visibleIds.has(entity.id))
        .map((entity) => ({
          id: entity.id,
          position: interpolatePosition(
            previousEntities.get(entity.id)?.position,
            entity.position,
            alpha,
          ),
        })),
      projectilePositions: latest.projectiles.map((projectile) => ({
        id: projectile.id,
        position: interpolatePosition(
          previousProjectiles.get(projectile.id)?.position,
          projectile.position,
          alpha,
        ),
      })),
    };
  }
}

function interpolatePosition(previous: GridPoint | undefined, latest: GridPoint, alpha: number): GridPoint {
  if (!previous) return { ...latest };
  return {
    x: previous.x + (latest.x - previous.x) * alpha,
    y: previous.y + (latest.y - previous.y) * alpha,
  };
}

function sameStream(left: VisibleSnapshot, right: VisibleSnapshot): boolean {
  return left.matchId === right.matchId
    && left.rulesVersion === right.rulesVersion
    && left.recipientPlayerId === right.recipientPlayerId
    && left.map.id === right.map.id
    && left.map.width === right.map.width
    && left.map.height === right.map.height
    && left.map.layoutId === right.map.layoutId;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function assertFiniteTime(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError("Interpolation time must be finite");
}

function cloneWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
