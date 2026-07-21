import { describe, expect, it } from "vitest";
import {
  ANIMATED_UNIT_FRAME_ASSETS,
  COMBAT_ANIMATION_MANIFEST,
  frameAssetFiles,
  validateCombatAnimationManifest,
} from "../src/game/combatAnimationManifest.js";
import { FACING_ORDER } from "../src/game/directionalAnimation.js";
import { FRAME_ANIMATED_ACTION_ROWS } from "../src/game/sixRowAnimationManifest.js";

describe("combat animation manifest", () => {
  it("ships warrior as six independently addressed facing sheets", () => {
    const asset = ANIMATED_UNIT_FRAME_ASSETS.find(({ unitId }) => unitId === "warrior");
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
    expect(asset?.manifest.frameWidth).toBe(96);
    expect(asset?.manifest.frameHeight).toBe(112);
    expect(asset?.manifest.artScale).toBe(1);
  });

  it("keeps the complete manifest internally consistent", () => {
    expect(validateCombatAnimationManifest()).toEqual([]);
    expect(COMBAT_ANIMATION_MANIFEST.warrior?.directionalTextureKeys).toBeDefined();
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
