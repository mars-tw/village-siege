import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "apps/client/public");
const definitions = [
  ["assets/original/frontier/buildings.png", "assets/original/frontier/buildings.webp"],
  ["assets/original/frontier/landscape/materials.png", "assets/original/frontier/landscape/materials.webp"],
  ["assets/original/frontier/landscape/nature.png", "assets/original/frontier/landscape/nature.webp"],
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function pixels(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function assertLosslessVisiblePixels(source, output) {
  const [before, after] = await Promise.all([pixels(source), pixels(output)]);
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) {
    throw new Error(`Decode dimensions changed: ${source}`);
  }
  let transparentRgbResetPixels = 0;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    if (before.data[offset + 3] !== after.data[offset + 3]) throw new Error(`Alpha changed at pixel ${offset / 4}: ${source}`);
    if (before.data[offset + 3] > 0) {
      for (let channel = 0; channel < 3; channel += 1) {
        if (before.data[offset + channel] !== after.data[offset + channel]) throw new Error(`Visible RGB changed at pixel ${offset / 4}: ${source}`);
      }
    } else if (before.data[offset] !== after.data[offset] || before.data[offset + 1] !== after.data[offset + 1] || before.data[offset + 2] !== after.data[offset + 2]) {
      transparentRgbResetPixels += 1;
    }
  }
  return { width: before.info.width, height: before.info.height, alphaDiffPixels: 0, visibleRgbDiffPixels: 0, transparentRgbResetPixels };
}

const report = {
  schemaVersion: 1,
  encoder: `sharp ${sharp.versions.sharp}; libwebp ${sharp.versions.webp}`,
  provenance: "Derived only from the checked-in Village Siege frontier PNG atlases; no artwork was regenerated and no frame was removed.",
  assets: [],
};
for (const [sourceRelative, outputRelative] of definitions) {
  const source = path.join(publicRoot, sourceRelative);
  const output = path.join(publicRoot, outputRelative);
  const sourceBuffer = await readFile(source);
  const outputBuffer = await sharp(sourceBuffer).webp({ lossless: true, effort: 6 }).toBuffer();
  await writeFile(output, outputBuffer);
  const verification = await assertLosslessVisiblePixels(source, output);
  report.assets.push({ source: sourceRelative, output: outputRelative, sourceBytes: sourceBuffer.length, outputBytes: outputBuffer.length, savedBytes: sourceBuffer.length - outputBuffer.length, ...verification, outputSha256: sha256(outputBuffer) });
}

const menuSource = path.join(publicRoot, "assets/original/frontier/buildings.png");
const menuOutputRelative = "assets/original/frontier/buildings-menu.webp";
const menuOutput = path.join(publicRoot, menuOutputRelative);
const menuBuffer = await sharp(menuSource)
  .resize(768, 576, { fit: "fill", kernel: "lanczos3" })
  .webp({ quality: 62, alphaQuality: 100, smartSubsample: true, effort: 6 })
  .toBuffer();
await writeFile(menuOutput, menuBuffer);
const menuMetadata = await sharp(menuBuffer).metadata();
if (menuMetadata.width !== 768 || menuMetadata.height !== 576) throw new Error("Menu atlas must decode to an exact 4 × 3 grid of 192 px cells");
report.assets.push({ source: "assets/original/frontier/buildings.png", output: menuOutputRelative, sourceBytes: (await readFile(menuSource)).length, outputBytes: menuBuffer.length, width: 768, height: 576, columns: 4, rows: 3, cellWidth: 192, cellHeight: 192, outputSha256: sha256(menuBuffer), verification: "lossy menu preview; frame order and 4 × 3 positions preserved" });

const lossless = report.assets.slice(0, definitions.length);
const releaseManifest = JSON.parse(await readFile(path.join(repoRoot, "assets/release-asset-manifest.json"), "utf8"));
const releaseRuntimeAfterBytes = releaseManifest.assets.filter((asset) => asset.runtime === true).reduce((sum, asset) => sum + asset.bytes, 0);
const generatedRuntimeBytes = report.assets.reduce((sum, asset) => sum + asset.outputBytes, 0);
const previousRuntimeBytes = releaseRuntimeAfterBytes - generatedRuntimeBytes + lossless.reduce((sum, asset) => sum + asset.sourceBytes, 0);
report.totals = {
  convertedBattleAtlasesBeforeBytes: lossless.reduce((sum, asset) => sum + asset.sourceBytes, 0),
  convertedBattleAtlasesAfterBytes: lossless.reduce((sum, asset) => sum + asset.outputBytes, 0),
  convertedBattleAtlasesSavedBytes: lossless.reduce((sum, asset) => sum + asset.savedBytes, 0),
  releaseRuntimeBeforeBytes: previousRuntimeBytes,
  releaseRuntimeAfterBytes,
  releaseRuntimeSavedBytes: previousRuntimeBytes - releaseRuntimeAfterBytes,
  menuBuildingPreviewBeforeBytes: 2085918,
  menuBuildingPreviewAfterBytes: menuBuffer.length,
};

const reportPath = path.join(repoRoot, "docs/evidence/r26/runtime-art-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
