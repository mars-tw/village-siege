import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { approvedRuntimePngsFromManifest, shouldPruneRuntimePng } from "../../scripts/runtime-art-policy.mjs";

const manifest = JSON.parse(await readFile(new URL("../../assets/release-asset-manifest.json", import.meta.url), "utf8"));

test("prunes stale or build-only PNGs with a release-manifest allowlist", () => {
  const approved = approvedRuntimePngsFromManifest(manifest);
  assert.equal(approved.size, 25);
  assert.equal(approved.has("assets/original/units/shieldBearer/sprites/facings/e.png"), true);
  assert.equal(shouldPruneRuntimePng("assets/original/units/shieldBearer/sprites/facings/e.png", approved), false);
  assert.equal(shouldPruneRuntimePng("assets/original/units/shieldBearer/sprites/action-sheet.png", approved), true);
  assert.equal(shouldPruneRuntimePng("assets/original/units/shieldBearer/sprites/action-sheet-source.png", approved), true);
  assert.equal(shouldPruneRuntimePng("assets/index.js", approved), false);
});
