export interface PointerGestureOrigin {
  readonly x: number;
  readonly y: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

export type PointerGestureMove =
  | { readonly kind: "ignored" }
  | { readonly kind: "tracking" }
  | { readonly kind: "drag"; readonly scrollX: number; readonly scrollY: number };

export interface PointerGestureEnd {
  readonly owned: boolean;
  readonly shouldTap: boolean;
}

interface OwnedPointerGesture extends PointerGestureOrigin {
  readonly pointerId: number;
  dragged: boolean;
  suppressTap: boolean;
}

/**
 * Gives one pointer exclusive ownership of a world gesture. A second pointer
 * permanently suppresses that gesture so ending a pinch cannot emit a tap.
 */
export class ExclusivePointerGesture {
  private readonly activePointerIds = new Set<number>();
  private owner?: OwnedPointerGesture;

  begin(pointerId: number, origin: PointerGestureOrigin): boolean {
    if (this.activePointerIds.has(pointerId)) return this.owner?.pointerId === pointerId;
    const canOwn = this.activePointerIds.size === 0 && this.owner === undefined;
    this.activePointerIds.add(pointerId);
    if (canOwn) {
      this.owner = { pointerId, ...origin, dragged: false, suppressTap: false };
      return true;
    }
    if (this.owner) this.owner.suppressTap = true;
    return false;
  }

  move(pointerId: number, x: number, y: number, threshold: number, zoom: number): PointerGestureMove {
    const owner = this.owner;
    if (!owner || owner.pointerId !== pointerId || owner.suppressTap) return { kind: "ignored" };
    const dx = x - owner.x;
    const dy = y - owner.y;
    if (!owner.dragged && Math.hypot(dx, dy) < threshold) return { kind: "tracking" };
    owner.dragged = true;
    const safeZoom = Math.max(0.01, zoom);
    return {
      kind: "drag",
      scrollX: owner.scrollX - dx / safeZoom,
      scrollY: owner.scrollY - dy / safeZoom,
    };
  }

  end(pointerId: number): PointerGestureEnd {
    const owner = this.owner;
    const owned = owner?.pointerId === pointerId;
    this.activePointerIds.delete(pointerId);
    if (!owned || !owner) return { owned: false, shouldTap: false };
    this.owner = undefined;
    return {
      owned: true,
      shouldTap: !owner.dragged && !owner.suppressTap && this.activePointerIds.size === 0,
    };
  }

  cancel(pointerId: number): boolean {
    const owned = this.owner?.pointerId === pointerId;
    this.activePointerIds.delete(pointerId);
    if (owned) this.owner = undefined;
    return owned;
  }

  owns(pointerId: number): boolean {
    return this.owner?.pointerId === pointerId;
  }

  get tracking(): boolean {
    return this.activePointerIds.size > 0;
  }

  reset(): void {
    this.activePointerIds.clear();
    this.owner = undefined;
  }
}
