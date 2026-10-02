import { describe, expect, it } from "vitest";
import { singleSheetFlipX, UnitMotionPresentation } from "../src/game/unitMotionPresentation";

describe("UnitMotionPresentation", () => {
  it("moves linearly for the observed authoritative step interval", () => {
    const motion = new UnitMotionPresentation({ x: 0, y: 0 });
    motion.setAuthoritativeTarget({ serverTick: 10, position: { x: 48, y: 24 }, observedStepIntervalMs: 1_000 });
    expect(motion.update(250)).toEqual({ x: 12, y: 6 });
    expect(motion.moving).toBe(true);
    expect(motion.update(750)).toEqual({ x: 48, y: 24 });
    expect(motion.moving).toBe(false);
  });

  it("does not snap or restart when the same target is refreshed", () => {
    const motion = new UnitMotionPresentation({ x: 0, y: 0 });
    motion.setAuthoritativeTarget({ serverTick: 10, position: { x: 100, y: 0 }, observedStepIntervalMs: 1_000 });
    expect(motion.update(400).x).toBe(40);
    motion.setAuthoritativeTarget({ serverTick: 11, position: { x: 100, y: 0 }, observedStepIntervalMs: 1_000 });
    expect(motion.position.x).toBe(40);
    expect(motion.update(100).x).toBe(50);
  });

  it("continues from the displayed position when the authoritative target changes", () => {
    const motion = new UnitMotionPresentation({ x: 0, y: 0 });
    motion.setAuthoritativeTarget({ serverTick: 10, position: { x: 100, y: 0 }, observedStepIntervalMs: 1_000 });
    motion.update(500);
    motion.setAuthoritativeTarget({ serverTick: 20, position: { x: 100, y: 50 }, observedStepIntervalMs: 1_000 });
    expect(motion.position).toEqual({ x: 50, y: 0 });
    const next = motion.update(500);
    expect(next.x).toBeCloseTo(75);
    expect(next.y).toBeCloseTo(25);
  });

  it("uses an explicit effective speed and clamps only upon arrival", () => {
    const motion = new UnitMotionPresentation({ x: 0, y: 0 });
    motion.setAuthoritativeTarget({ serverTick: 1, position: { x: 90, y: 0 }, effectiveSpeedPixelsPerSecond: 60 });
    expect(motion.update(1_000).x).toBe(60);
    expect(motion.moving).toBe(true);
    expect(motion.update(500).x).toBe(90);
    expect(motion.moving).toBe(false);
  });

  it("rejects stale targets and exposes an explicit correction snap", () => {
    const motion = new UnitMotionPresentation({ x: 10, y: 20 }, 5);
    expect(motion.setAuthoritativeTarget({ serverTick: 4, position: { x: 999, y: 999 } })).toBe(false);
    expect(motion.position).toEqual({ x: 10, y: 20 });
    motion.setAuthoritativeTarget({ serverTick: 6, position: { x: 58, y: 44 } });
    expect(motion.snapToAuthoritativeTarget()).toEqual({ x: 58, y: 44 });
    expect(motion.moving).toBe(false);
  });

  it("validates timing inputs instead of producing invalid presentation state", () => {
    const motion = new UnitMotionPresentation({ x: 0, y: 0 });
    expect(() => motion.update(Number.NaN)).toThrow(RangeError);
    expect(() => motion.setAuthoritativeTarget({ serverTick: 1, position: { x: 1, y: 0 }, observedStepIntervalMs: 0 })).toThrow(RangeError);
  });
});

describe("single-perspective actor facing", () => {
  it("mirrors only the west half-plane for an authored-right sheet", () => {
    for (const facing of ["w", "nw", "sw"] as const) expect(singleSheetFlipX(facing, "right")).toBe(true);
    for (const facing of ["e", "ne", "se"] as const) expect(singleSheetFlipX(facing, "right")).toBe(false);
  });

  it("keeps independently authored directional sheets outside this fallback", () => {
    // FrameAnimatedCombatActor.renderFacing bypasses this helper whenever directionalTextureKeys exist.
    expect(singleSheetFlipX("w", "left")).toBe(false);
    expect(singleSheetFlipX("e", "left")).toBe(true);
  });
});
