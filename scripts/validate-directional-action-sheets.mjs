import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const toolRoot = path.join(scriptDirectory, ".asset-tools");
const toolRequire = createRequire(path.join(toolRoot, "package.json"));

let sharp;
try {
  sharp = toolRequire("sharp");
} catch (error) {
  throw new Error(
    "Missing local asset tools. Run: npm install --prefix scripts/.asset-tools --no-save --package-lock=false sharp@0.32.6",
    { cause: error },
  );
}

const files = process.argv.slice(2).filter((value) => !value.startsWith("--"));
if (files.length === 0) {
  throw new Error("Usage: node scripts/validate-directional-action-sheets.mjs <sheet.png> [...]");
}

const cellWidth = 256;
const cellHeight = 256;
const columns = 4;
const rows = 6;
const alphaThreshold = 8;
const edgePadding = 2;
const expectedWidth = cellWidth * columns;
const expectedHeight = cellHeight * rows;
const failures = [];

for (const input of files) {
  const absolute = path.resolve(projectRoot, input);
  const source = await readFile(absolute);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight || metadata.hasAlpha !== true) {
    failures.push(`${input}: expected ${expectedWidth}x${expectedHeight} RGBA PNG; received ${metadata.width}x${metadata.height}, alpha=${metadata.hasAlpha}`);
    continue;
  }

  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let partialPixels = 0;
  let nonBlackTransparentPixels = 0;
  const frameHashes = new Set();
  const boxes = [];

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha === 0) {
      transparentPixels += 1;
      if (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0) nonBlackTransparentPixels += 1;
    } else if (alpha < 255) {
      partialPixels += 1;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = column * cellWidth;
      const top = row * cellHeight;
      let minX = cellWidth;
      let minY = cellHeight;
      let maxX = -1;
      let maxY = -1;
      let foreground = 0;
      const hash = createHash("sha256");

      for (let y = 0; y < cellHeight; y += 1) {
        const start = ((top + y) * info.width + left) * info.channels;
        const end = start + cellWidth * info.channels;
        hash.update(data.subarray(start, end));
        for (let x = 0; x < cellWidth; x += 1) {
          const alpha = data[start + x * info.channels + 3];
          if (alpha <= alphaThreshold) continue;
          foreground += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      const frameLabel = `r${row + 1}c${column + 1}`;
      const coverage = foreground / (cellWidth * cellHeight);
      if (foreground === 0) failures.push(`${input} ${frameLabel}: empty frame`);
      if (coverage < 0.015 || coverage > 0.7) failures.push(`${input} ${frameLabel}: implausible foreground coverage ${(coverage * 100).toFixed(1)}%`);
      if (minX < edgePadding || minY < edgePadding || maxX >= cellWidth - edgePadding || maxY >= cellHeight - edgePadding) {
        failures.push(`${input} ${frameLabel}: foreground touches the ${edgePadding}px safety border (${minX},${minY})-(${maxX},${maxY})`);
      }
      const digest = hash.digest("hex");
      if (frameHashes.has(digest)) failures.push(`${input} ${frameLabel}: exact duplicate frame`);
      frameHashes.add(digest);
      boxes.push(`${frameLabel}:${minX},${minY}-${maxX},${maxY}`);
    }
  }

  const pixelCount = info.width * info.height;
  const transparentRatio = transparentPixels / pixelCount;
  if (transparentRatio < 0.35) failures.push(`${input}: insufficient transparent canvas ${(transparentRatio * 100).toFixed(1)}%`);
  if (nonBlackTransparentPixels > 0) failures.push(`${input}: ${nonBlackTransparentPixels} fully transparent pixels retain non-black RGB`);
  console.log(
    `${input}: ${metadata.width}x${metadata.height}; transparent=${(transparentRatio * 100).toFixed(1)}%; partial=${((partialPixels / pixelCount) * 100).toFixed(1)}%; frames=${frameHashes.size}`,
  );
  console.log(`  ${boxes.join(" | ")}`);
}

if (failures.length > 0) {
  console.error(`Directional action-sheet validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Directional action-sheet validation passed for ${files.length} sheet(s).`);
}
