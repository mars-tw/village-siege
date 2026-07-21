import { describe, expect, it } from "vitest";
import {
  ANIMATED_MONSTER_FRAME_ASSETS,
  ANIMATED_UNIT_FRAME_ASSETS,
  COMBAT_ANIMATION_MANIFEST,
  frameAssetFiles,
  validateCombatAnimationManifest,
} from "../src/game/combatAnimationManifest.js";
import { FACING_ORDER } from "../src/game/directionalAnimation.js";
import { FRAME_ANIMATED_ACTION_ROWS } from "../src/game/sixRowAnimationManifest.js";

describe("combat animation manifest", () => {
  it("ships approved unit migrations as six independently addressed facing sheets", () => {
    for (const unitId of ["warrior", "archer", "shieldBearer"] as const) {
      const asset = ANIMATED_UNIT_FRAME_ASSETS.find((candidate) => candidate.unitId === unitId);
      expect(asset).toBeDefined();
      expect(asset?.directionalPaths).toBeDefined();
      expect(asset?.manifest.directionalTextureKeys).toBeDefined();

      const files = frameAssetFiles(asset!);
      expect(files).toHaveLength(FACING_ORDER.length);
      expect(new Set(files.map(({ textureKey }) => textureKey)).size).toBe(FACING_ORDER.length);
      expect(new Set(files.map(({ path }) => path)).size).toBe(FACING_ORDER.length);
      expect(files.map(({ path }) => path.split("/").at(-1))).toEqual(
        FACING_ORDER.map((facing) => `${facing}.png`),
      );
      expect(asset?.manifest.frameWidth).toBe(unitId === "shieldBearer" ? 112 : 96);
      expect(asset?.manifest.frameHeight).toBe(112);
      expect(asset?.manifest.anchorX).toBe(unitId === "shieldBearer" ? 56 : 48);
      expect(asset?.manifest.anchorY).toBe(88);
      expect(asset?.manifest.artScale).toBe(1);
    }
  });

  it("keeps unapproved migrations on their single authored sheet", () => {
    const approved = new Set(["warrior", "archer", "shieldBearer"]);
    const remaining = ANIMATED_UNIT_FRAME_ASSETS.filter(({ unitId }) => !approved.has(unitId));
    expect(remaining).toHaveLength(4);
    for (const asset of remaining) {
      expect(asset.directionalPaths).toBeUndefined();
      expect(asset.manifest.directionalTextureKeys).toBeUndefined();
      expect(frameAssetFiles(asset)).toEqual([{ textureKey: asset.textureKey, path: asset.path }]);
      expect(asset.path).toMatch(new RegExp(`/units/${asset.unitId}/sprites/action-sheet\\.png$`));
    }

    for (const asset of ANIMATED_MONSTER_FRAME_ASSETS) {
      expect(asset.directionalPaths).toBeUndefined();
      expect(asset.manifest.directionalTextureKeys).toBeUndefined();
      expect(frameAssetFiles(asset)).toEqual([{ textureKey: asset.textureKey, path: asset.path }]);
      expect(asset.path).toMatch(new RegExp(`/monsters/${asset.monsterId}/sprites/action-sheet\\.png$`));
    }
  });

  it("keeps the complete manifest internally consistent", () => {
    expect(validateCombatAnimationManifest()).toEqual([]);
    expect(COMBAT_ANIMATION_MANIFEST.warrior?.directionalTextureKeys).toBeDefined();
    expect(COMBAT_ANIMATION_MANIFEST.archer?.directionalTextureKeys).toBeDefined();
    expect(COMBAT_ANIMATION_MANIFEST.shieldbearer?.directionalTextureKeys).toBeDefined();
    expect(FRAME_ANIMATED_ACTION_ROWS).toEqual(["idle", "walk", "attack", "hurt", "death", "cast"]);
    expect(COMBAT_ANIMATION_MANIFEST.warrior?.actions).toMatchObject({
      idle: { row: 0 },
      walk: { row: 1 },
      attack: { row: 2 },
      hurt: { row: 3 },
      death: { row: 4 },
      cast: { row: 5 },
    });
  });
});
