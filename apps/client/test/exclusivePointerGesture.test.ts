import { describe, expect, it } from "vitest";
import { ExclusivePointerGesture } from "../src/game/exclusivePointerGesture";

const ORIGIN = { x: 100, y: 80, scrollX: 420, scrollY: 260 } as const;

describe("ExclusivePointerGesture", () => {
  it("keeps a short single-pointer gesture eligible for exactly one tap", () => {
    const gesture = new ExclusivePointerGesture();
    expect(gesture.begin(1, ORIGIN)).toBe(true);
    expect(gesture.move(1, 106, 86, 10, 1)).toEqual({ kind: "tracking" });
    expect(gesture.end(1)).toEqual({ owned: true, shouldTap: true });
    expect(gesture.end(1)).toEqual({ owned: false, shouldTap: false });
  });

  it("moves the camera only for the owner after the drag threshold", () => {
    const gesture = new ExclusivePointerGesture();
    gesture.begin(7, ORIGIN);
    expect(gesture.move(7, 120, 90, 10, 2)).toEqual({ kind: "drag", scrollX: 410, scrollY: 255 });
    expect(gesture.end(7)).toEqual({ owned: true, shouldTap: false });
  });

  it("never lets a second pointer replace the owner or end a pinch as a tap", () => {
    const gesture = new ExclusivePointerGesture();
    gesture.begin(3, ORIGIN);
    expect(gesture.begin(9, { x: 220, y: 140, scrollX: 420, scrollY: 260 })).toBe(false);
    expect(gesture.owns(3)).toBe(true);
    expect(gesture.owns(9)).toBe(false);
    expect(gesture.move(3, 160, 120, 10, 1)).toEqual({ kind: "ignored" });
    expect(gesture.end(9)).toEqual({ owned: false, shouldTap: false });
    expect(gesture.end(3)).toEqual({ owned: true, shouldTap: false });
  });

  it("waits for every secondary pointer to end before granting ownership again", () => {
    const gesture = new ExclusivePointerGesture();
    gesture.begin(1, ORIGIN);
    gesture.begin(2, { x: 140, y: 90, scrollX: 420, scrollY: 260 });
    expect(gesture.end(1)).toEqual({ owned: true, shouldTap: false });
    expect(gesture.begin(3, { x: 180, y: 110, scrollX: 420, scrollY: 260 })).toBe(false);
    expect(gesture.end(2)).toEqual({ owned: false, shouldTap: false });
    expect(gesture.end(3)).toEqual({ owned: false, shouldTap: false });
    expect(gesture.begin(4, ORIGIN)).toBe(true);
  });

  it("cancels an invalidated owner without producing a tap", () => {
    const gesture = new ExclusivePointerGesture();
    gesture.begin(5, ORIGIN);
    expect(gesture.cancel(5)).toBe(true);
    expect(gesture.end(5)).toEqual({ owned: false, shouldTap: false });
    expect(gesture.tracking).toBe(false);
  });
});
