import { describe, expect, it } from "vitest";
import { COMBAT_ART_IDS } from "../src/game/directionalAnimation";
import { UNIT_VISUAL_PROFILES, unitVisualProfile } from "../src/game/unitVisualProfile";

describe("house-relative actor presentation", () => {
  it("covers authored actors without changing their contracts and keeps a coherent human envelope", () => {
    for (const id of [...COMBAT_ART_IDS, "villager"] as const) {
      const value = unitVisualProfile(id);
      expect(value.artMultiplier).toBeGreaterThan(0);
      expect(value.artMultiplier).toBeLessThanOrEqual(1);
      expect(Object.isFrozen(value)).toBe(true);
    }
    for (const id of ["villager", "warrior", "shieldbearer", "archer", "mage", "musketeer"] as const) {
      expect(unitVisualProfile(id).bodyHeight).toBeGreaterThanOrEqual(40);
      expect(unitVisualProfile(id).bodyHeight).toBeLessThanOrEqual(44);
    }
    expect(Object.isFrozen(UNIT_VISUAL_PROFILES)).toBe(true);
  });

  it("keeps mounted/siege silhouettes above humans and giant neutrals above those", () => {
    expect(unitVisualProfile("boar_rider").bodyHeight).toBeGreaterThan(unitVisualProfile("warrior").bodyHeight);
    expect(unitVisualProfile("heavy_crossbow").bodyWidth).toBeGreaterThan(unitVisualProfile("archer").bodyWidth);
    expect(unitVisualProfile("rootback").bodyHeight).toBeGreaterThan(unitVisualProfile("boar_rider").bodyHeight);
    expect(unitVisualProfile("rootback").artMultiplier).toBe(1);
    expect(unitVisualProfile("ashwing").artMultiplier).toBe(1);
  });
});
