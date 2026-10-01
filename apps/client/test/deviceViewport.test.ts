import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {} }));

import { getDeviceViewportProfile } from "../src/game/deviceViewport.js";

function viewport(width: number, height: number, coarse: boolean, maxTouchPoints: number, touchEvent = false): void {
  vi.stubGlobal("window", {
    innerWidth: width,
    innerHeight: height,
    visualViewport: { width, height },
    ...(touchEvent ? { ontouchstart: null } : {}),
    matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }),
  });
  vi.stubGlobal("navigator", { maxTouchPoints });
}

afterEach(() => vi.unstubAllGlobals());

describe("device viewport primary pointer classification", () => {
  it("keeps a mouse-driven touchscreen desktop out of mandatory mobile behavior", () => {
    viewport(1440, 900, false, 256, true);
    expect(getDeviceViewportProfile()).toMatchObject({
      touch: true, coarsePointer: false, mobileSized: true, mobile: false, landscape: true,
    });
  });

  it("does not require rotating a narrow desktop window solely because touch events exist", () => {
    viewport(800, 900, false, 0, true);
    expect(getDeviceViewportProfile()).toMatchObject({
      touch: true, coarsePointer: false, mobileSized: true, mobile: false, landscape: false,
    });
  });

  it("retains the mobile profile for a real portrait phone with a coarse primary pointer", () => {
    viewport(375, 667, true, 5, true);
    expect(getDeviceViewportProfile()).toMatchObject({
      touch: true, coarsePointer: true, mobileSized: true, mobile: true, landscape: false,
    });
  });

  it("retains the mobile profile for a landscape tablet", () => {
    viewport(1024, 768, true, 5, true);
    expect(getDeviceViewportProfile()).toMatchObject({
      touch: true, coarsePointer: true, mobileSized: true, mobile: true, landscape: true,
    });
  });

  it("uses the primary pointer even when a browser reports no touch points", () => {
    viewport(667, 375, true, 0);
    expect(getDeviceViewportProfile()).toMatchObject({
      touch: false, coarsePointer: true, mobileSized: true, mobile: true, landscape: true,
    });
  });

  it("preserves the size threshold and ordinary desktop touch capability fields", () => {
    viewport(1920, 1080, true, 5);
    expect(getDeviceViewportProfile()).toMatchObject({ touch: true, coarsePointer: true, mobileSized: false, mobile: false });
    viewport(1366, 768, false, 0);
    expect(getDeviceViewportProfile()).toMatchObject({ touch: false, coarsePointer: false, mobileSized: true, mobile: false });
  });
});
