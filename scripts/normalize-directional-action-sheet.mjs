import { readFile, writeFile } from "node:fs/promises";
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

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputValue = option("input");
const outputValue = option("out");
if (!inputValue || !outputValue) {
  throw new Error("Usage: node scripts/normalize-directional-action-sheet.mjs --input <rgba-sheet.png> --out <normalized.png>");
}

const inputPath = path.resolve(projectRoot, inputValue);
const outputPath = path.resolve(projectRoot, outputValue);
const source = await readFile(inputPath);
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const columns = 4;
const rows = 6;
const cellWidth = 256;
const cellHeight = 256;
const expectedWidth = columns * cellWidth;
const expectedHeight = rows * cellHeight;
if (info.width !== expectedWidth || info.height !== expectedHeight || info.channels !== 4) {
  throw new Error(`Expected ${expectedWidth}x${expectedHeight} RGBA input, received ${info.width}x${info.height} with ${info.channels} channels`);
}

const pixelCount = info.width * info.height;
const labels = new Int32Array(pixelCount);
const queue = new Int32Array(pixelCount);
const components = [];
const alphaThreshold = 8;

for (let seed = 0; seed < pixelCount; seed += 1) {
  if (labels[seed] !== 0 || data[seed * 4 + 3] <= alphaThreshold) continue;
  const label = components.length + 1;
  let head = 0;
  let tail = 0;
  let area = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  queue[tail++] = seed;
  labels[seed] = label;

  while (head < tail) {
    const index = queue[head++];
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    area += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;

    const neighbours = [
      x > 0 ? index - 1 : -1,
      x + 1 < info.width ? index + 1 : -1,
      y > 0 ? index - info.width : -1,
      y + 1 < info.height ? index + info.width : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || labels[neighbour] !== 0 || data[neighbour * 4 + 3] <= alphaThreshold) continue;
      labels[neighbour] = label;
      queue[tail++] = neighbour;
    }
  }

  components.push({ label, area, minX, minY, maxX, maxY, centerX: sumX / area, centerY: sumY / area });
}

const slots = Array.from({ length: rows * columns }, (_, index) => ({
  index,
  row: Math.floor(index / columns),
  column: index % columns,
  labels: new Set(),
  area: 0,
  minX: info.width,
  minY: info.height,
  maxX: -1,
  maxY: -1,
}));

for (const component of components) {
  if (component.area < 16) continue;
  let bestSlot = slots[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const centerX = (slot.column + 0.5) * cellWidth;
    const centerY = (slot.row + 0.5) * cellHeight;
    const dx = (component.centerX - centerX) / cellWidth;
    const dy = (component.centerY - centerY) / cellHeight;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlot = slot;
    }
  }
  bestSlot.labels.add(component.label);
  bestSlot.area += component.area;
  bestSlot.minX = Math.min(bestSlot.minX, component.minX);
  bestSlot.minY = Math.min(bestSlot.minY, component.minY);
  bestSlot.maxX = Math.max(bestSlot.maxX, component.maxX);
  bestSlot.maxY = Math.max(bestSlot.maxY, component.maxY);
}

const output = sharp({
  create: {
    width: expectedWidth,
    height: expectedHeight,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
});
const composites = [];
const safetyPadding = 12;
const anchorY = 224;
const maxFrameWidth = cellWidth - safetyPadding * 2;
const maxFrameHeight = anchorY - safetyPadding;

for (const slot of slots) {
  if (slot.area < 500 || slot.maxX < slot.minX || slot.maxY < slot.minY) {
    throw new Error(`Slot r${slot.row + 1}c${slot.column + 1} has no credible foreground component (${slot.area} pixels)`);
  }
  const width = slot.maxX - slot.minX + 1;
  const height = slot.maxY - slot.minY + 1;
  const isolated = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = slot.minX + x;
      const sourceY = slot.minY + y;
      const sourcePixel = sourceY * info.width + sourceX;
      if (!slot.labels.has(labels[sourcePixel])) continue;
      const sourceOffset = sourcePixel * 4;
      const targetOffset = (y * width + x) * 4;
      isolated[targetOffset] = data[sourceOffset];
      isolated[targetOffset + 1] = data[sourceOffset + 1];
      isolated[targetOffset + 2] = data[sourceOffset + 2];
      isolated[targetOffset + 3] = data[sourceOffset + 3];
    }
  }

  const scale = Math.min(1, maxFrameWidth / width, maxFrameHeight / height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  const frame = await sharp(isolated, { raw: { width, height, channels: 4 } })
    .resize(resizedWidth, resizedHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const left = slot.column * cellWidth + Math.round((cellWidth - resizedWidth) / 2);
  const top = slot.row * cellHeight + anchorY - resizedHeight;
  composites.push({ input: frame, left, top });
  console.log(
    `r${slot.row + 1}c${slot.column + 1}: components=${slot.labels.size}; source=${width}x${height}; scale=${scale.toFixed(3)}; placed=${left % cellWidth},${top % cellHeight}`,
  );
}

await writeFile(outputPath, await output.composite(composites).png().toBuffer());
console.log(`Wrote normalized directional action sheet: ${path.relative(projectRoot, outputPath).split(path.sep).join("/")}`);
