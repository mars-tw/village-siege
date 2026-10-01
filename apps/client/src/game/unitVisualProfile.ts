import type { FrameAnimatedActorId } from "./sixRowAnimationManifest";

export interface UnitVisualProfile {
  /** Multiplies authored image scale; never the actor's world/input container. */
  readonly artMultiplier: number;
  /** Opaque idle body envelope plus pose margin in world pixels, for UI anchors. */
  readonly bodyHeight: number;
  readonly bodyWidth: number;
}

const profile = (artMultiplier: number, bodyHeight: number, bodyWidth: number): UnitVisualProfile =>
  Object.freeze({ artMultiplier, bodyHeight, bodyWidth });

/** Authored cells/anchors stay unchanged. Humans share house-relative scale;
 * mounted, siege and neutral creatures retain their larger silhouettes. */
export const UNIT_VISUAL_PROFILES: Readonly<Record<FrameAnimatedActorId, UnitVisualProfile>> = Object.freeze({
  villager: profile(0.50, 40, 28),
  warrior: profile(0.50, 40, 27),
  shieldbearer: profile(0.50, 44, 32),
  archer: profile(0.52, 41, 28),
  mage: profile(0.62, 40, 29),
  musketeer: profile(0.62, 44, 36),
  boar_rider: profile(0.78, 55, 44),
  heavy_crossbow: profile(0.76, 52, 44),
  miremaw: profile(0.90, 66, 85),
  ashwing: profile(1, 67, 80),
  rootback: profile(1, 80, 82),
});

export function unitVisualProfile(id: FrameAnimatedActorId): UnitVisualProfile {
  return UNIT_VISUAL_PROFILES[id];
}
