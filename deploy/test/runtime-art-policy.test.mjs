import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { approvedRuntimeArtFromManifest, shouldPruneRuntimeArt } from "../../scripts/runtime-art-policy.mjs";

const manifest = JSON.parse(await readFile(new URL("../../assets/release-asset-manifest.json", import.meta.url), "utf8"));

test("prunes stale or build-only raster art with a release-manifest allowlist", () => {
  const approved = approvedRuntimeArtFromManifest(manifest);
  assert.equal(approved.size, 37);
  assert.equal(shouldPruneRuntimeArt("assets/original/frontier/buildings.png", approved), true);
  assert.equal(approved.has("assets/original/frontier/buildings.webp"), true);
  assert.equal(approved.has("assets/original/frontier/buildings-menu.webp"), true);
  assert.equal(shouldPruneRuntimeArt("assets/original/frontier/buildings-source.png", approved), true);
  assert.equal(shouldPruneRuntimeArt("assets/original/frontier/buildings-preview.webp", approved), true);
  assert.equal(shouldPruneRuntimeArt("assets/original/frontier/command-icons.png", approved), false);
  assert.equal(shouldPruneRuntimeArt("assets/original/frontier/command-icons-source.png", approved), true);
  assert.equal(approved.has("assets/original/frontier/characters/shieldBearer/facings/e.png"), true);
  assert.equal(shouldPruneRuntimeArt("assets/original/frontier/characters/villager/facings/nw.png", approved), false);
  assert.equal(shouldPruneRuntimeArt("assets/original/units/shieldBearer/sprites/facings/e.png", approved), true);
  assert.equal(shouldPruneRuntimeArt("assets/original/units/shieldBearer/sprites/action-sheet.png", approved), true);
  assert.equal(shouldPruneRuntimeArt("assets/original/units/shieldBearer/sprites/action-sheet-source.png", approved), true);
  assert.equal(shouldPruneRuntimeArt("assets/index.js", approved), false);
});
