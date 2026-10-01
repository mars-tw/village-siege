import { describe, expect, it } from "vitest";
import type { VictoryPolicy } from "@village-siege/shared";
import { getBattleModePolicy, idFromPolicy } from "../src/game/battleModes";

describe("battle modes", () => {
  it("keeps siege focused on conquest and elimination", () => {
    expect(getBattleModePolicy("siege")).toEqual({
      commandCenterConquest: expect.objectContaining({ rebuildGraceTicks: expect.any(Number) }),
      elimination: true,
      landmark: null,
      timedControl: null,
    });
  });

  it("keeps all four victory routes in territory mode", () => {
    const policy = getBattleModePolicy("territory");
    expect(policy.commandCenterConquest).not.toBeNull();
    expect(policy.elimination).toBe(true);
    expect(policy.landmark).not.toBeNull();
    expect(policy.timedControl).not.toBeNull();
  });

  it("classifies a saved legacy policy without rewriting it", () => {
    const savedPolicy: VictoryPolicy = {
      commandCenterConquest: { rebuildGraceTicks: 77 },
      elimination: true,
      landmark: { buildingType: "copperLandmark", requiredCount: 2, holdTicks: 321 },
      timedControl: { point: { x: 7, y: 9 }, radius: 3, startsAtTick: 11, targetTicks: 456 },
    };
    const before = structuredClone(savedPolicy);
    expect(idFromPolicy(savedPolicy)).toBe("territory");
    expect(savedPolicy).toEqual(before);
    expect(idFromPolicy(getBattleModePolicy("siege"))).toBe("siege");
  });

  it("returns isolated policy objects for each new battle", () => {
    const first = getBattleModePolicy("territory");
    const second = getBattleModePolicy("territory");
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.landmark).not.toBe(second.landmark);
    expect(first.timedControl?.point).not.toBe(second.timedControl?.point);
  });
});
