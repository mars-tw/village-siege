import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");

function positiveIntegerOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

const optionNames = new Set(["--cell-width", "--cell-height", "--edge-padding"]);
const flagNames = new Set(["--reject-cross-sheet-reuse"]);
const files = [];
for (let index = 2; index < process.argv.length; index += 1) {
  if (optionNames.has(process.argv[index])) {
    index += 1;
    continue;
  }
  if (flagNames.has(process.argv[index])) continue;
  files.push(process.argv[index]);
}
if (files.length === 0) {
  throw new Error("Usage: node scripts/validate-directional-action-sheets.mjs <sheet.png> [...]");
}

const cellWidth = positiveIntegerOption("cell-width", 256);
const cellHeight = positiveIntegerOption("cell-height", 256);
const columns = 4;
const rows = 6;
const alphaThreshold = 8;
const edgePadding = positiveIntegerOption("edge-padding", Math.max(1, Math.round(cellWidth * 0.008)));
const expectedWidth = cellWidth * columns;
const expectedHeight = cellHeight * rows;
const failures = [];
const rejectCrossSheetReuse = process.argv.includes("--reject-cross-sheet-reuse");
const inspectedSheets = [];

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
  const frameDigests = [];
  const mirroredFrameDigests = [];
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
      const mirroredHash = createHash("sha256");

      for (let y = 0; y < cellHeight; y += 1) {
        const start = ((top + y) * info.width + left) * info.channels;
        const end = start + cellWidth * info.channels;
        hash.update(data.subarray(start, end));
        for (let x = cellWidth - 1; x >= 0; x -= 1) {
          const pixel = start + x * info.channels;
          mirroredHash.update(data.subarray(pixel, pixel + info.channels));
        }
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
      const mirroredDigest = mirroredHash.digest("hex");
      if (frameHashes.has(digest)) failures.push(`${input} ${frameLabel}: exact duplicate frame`);
      frameHashes.add(digest);
      frameDigests.push(digest);
      mirroredFrameDigests.push(mirroredDigest);
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
  inspectedSheets.push({ input, frameDigests, mirroredFrameDigests });
}

if (rejectCrossSheetReuse) {
  for (let leftIndex = 0; leftIndex < inspectedSheets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < inspectedSheets.length; rightIndex += 1) {
      const left = inspectedSheets[leftIndex];
      const right = inspectedSheets[rightIndex];
      for (let frame = 0; frame < rows * columns; frame += 1) {
        const label = `r${Math.floor(frame / columns) + 1}c${frame % columns + 1}`;
        if (left.frameDigests[frame] === right.frameDigests[frame]) {
          failures.push(`${left.input} and ${right.input} ${label}: exact cross-facing frame reuse`);
        }
        if (left.mirroredFrameDigests[frame] === right.frameDigests[frame] || right.mirroredFrameDigests[frame] === left.frameDigests[frame]) {
          failures.push(`${left.input} and ${right.input} ${label}: exact horizontal-mirror reuse`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Directional action-sheet validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Directional action-sheet validation passed for ${files.length} sheet(s).`);
}
