import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const toolRoot = path.join(scriptDirectory, ".asset-tools");
const toolRequire = createRequire(path.join(toolRoot, "package.json"));

const SOURCE_RELATIVE = "apps/client/public/assets/original/source/combat-lineup-approved.png";
const ALPHA_SOURCE_RELATIVE = "apps/client/public/assets/original/source/combat-lineup-approved-alpha.png";
const OUTPUT_RELATIVE = "apps/client/public/assets/original";
const PADDING = 16;
const FOREGROUND_ALPHA_THRESHOLD = 8;

const CROPS = {
  warrior: { left: 24, top: 43, width: 449, height: 443 },
  shieldBearer: { left: 480, top: 76, width: 397, height: 416 },
  archer: { left: 875, top: 24, width: 388, height: 475 },
  mage: { left: 1238, top: 31, width: 380, height: 462 },
  musketeer: { left: 48, top: 476, width: 514, height: 409 },
  boarRider: { left: 531, top: 505, width: 487, height: 365 },
  heavyCrossbowman: { left: 1042, top: 502, width: 601, height: 382 }
};

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const inputPath = path.resolve(projectRoot, option("input", SOURCE_RELATIVE));
const foregroundInputPath = path.resolve(projectRoot, option("foreground-input", ALPHA_SOURCE_RELATIVE));
const outputRoot = path.resolve(projectRoot, option("output-root", OUTPUT_RELATIVE));

let sharp;
try {
  sharp = toolRequire("sharp");
} catch (error) {
  throw new Error(
    "Missing local asset tools. Run: npm install --prefix scripts/.asset-tools --no-save --package-lock=false sharp@0.32.6",
    { cause: error }
  );
}

const sourceBytes = await readFile(inputPath);
const sourceMetadata = await sharp(sourceBytes).metadata();
if (sourceMetadata.width !== 1717 || sourceMetadata.height !== 916) {
  throw new Error(`Approved source dimensions changed: expected 1717x916, got ${sourceMetadata.width}x${sourceMetadata.height}`);
}

const packageJson = JSON.parse(await readFile(path.join(toolRoot, "node_modules", "sharp", "package.json"), "utf8"));
const foreground = await readFile(foregroundInputPath);
const foregroundMetadata = await sharp(foreground).metadata();
if (foregroundMetadata.width !== sourceMetadata.width || foregroundMetadata.height !== sourceMetadata.height || foregroundMetadata.hasAlpha !== true) {
  throw new Error("Background removal changed source dimensions or did not return alpha PNG");
}

const results = {};
for (const [id, crop] of Object.entries(CROPS)) {
  const { data, info } = await sharp(foreground)
    .extract(crop)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const componentCleanup = removeEdgeFragments(data, info.width, info.height, info.channels);
  const originalCrop = await sharp(sourceBytes).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const holeRepair = restoreSmallInteriorHoles(data, originalCrop.data, info.width, info.height, info.channels);
  const bounds = alphaBounds(data, info.width, info.height, info.channels, FOREGROUND_ALPHA_THRESHOLD);
  if (!bounds) throw new Error(`${id}: no foreground pixels inside crop`);

  const extracted = await sharp(data, { raw: info })
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .extend({ top: PADDING, bottom: PADDING, left: PADDING, right: PADDING, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  const unitDirectory = path.join(outputRoot, "units", id);
  const portraitPath = path.join(unitDirectory, "portrait.png");
  await mkdir(unitDirectory, { recursive: true });
  await writeFile(portraitPath, extracted);
  const inspection = await inspectAlpha(sharp, extracted);
  if (inspection.edgeForegroundPixels !== 0 || inspection.cornerMaxAlpha !== 0) {
    throw new Error(`${id}: transparent padding validation failed`);
  }
  if (inspection.foregroundCoverage < 0.08 || inspection.foregroundCoverage > 0.82) {
    throw new Error(`${id}: implausible foreground coverage ${inspection.foregroundCoverage}`);
  }

  results[id] = {
    file: path.relative(projectRoot, portraitPath).replaceAll("\\", "/"),
    sourceCrop: crop,
    componentCleanup,
    holeRepair,
    alphaBoundsInCrop: bounds,
    output: inspection,
    sha256: createHash("sha256").update(extracted).digest("hex")
  };
  console.log(`portrait ${id} ${inspection.width}x${inspection.height} coverage=${inspection.foregroundCoverage.toFixed(4)}`);
}

const metadata = {
  schemaVersion: 1,
  assetSet: "village-siege-combat-portraits-v1",
  generatedAtUtc: new Date().toISOString(),
  source: {
    file: path.relative(projectRoot, inputPath).replaceAll("\\", "/"),
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    provenance: "Project-bound image generated with OpenAI image generation and explicitly approved by the project owner",
    preparedAlpha: {
      file: path.relative(projectRoot, foregroundInputPath).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(foreground).digest("hex"),
      process: "Prepared with the installed imagegen skill remove_chroma_key.py helper; retained as the reproducible crop master"
    }
  },
  process: {
    script: "scripts/extract-combat-portraits.mjs",
    backgroundRemoval: {
      helper: "$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py",
      usage: "local build-time imagegen skill helper; prepared alpha master is checked into the project"
    },
    cropTool: { package: "sharp", version: packageJson.version, license: "Apache-2.0" },
    paddingPx: PADDING,
    foregroundAlphaThreshold: FOREGROUND_ALPHA_THRESHOLD
  },
  portraits: results
};
await writeFile(path.join(outputRoot, "asset-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`metadata ${path.relative(projectRoot, path.join(outputRoot, "asset-metadata.json"))}`);

function alphaBounds(data, width, height, channels, threshold) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + channels - 1];
      if (alpha === undefined || alpha <= threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX || maxY < minY
    ? null
    : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function removeEdgeFragments(data, width, height, channels) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const labels = new Uint16Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  const threshold = 3;
  let label = 0;
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start]) continue;
    const startAlpha = data[start * channels + channels - 1] ?? 0;
    if (startAlpha <= threshold) {
      visited[start] = 1;
      data[start * channels + channels - 1] = 0;
      continue;
    }
    label += 1;
    if (label > 65534) throw new Error("Too many alpha components");
    let head = 0;
    let tail = 0;
    let size = 0;
    let touchesEdge = false;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      labels[index] = label;
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (visited[neighbor]) continue;
          const alpha = data[neighbor * channels + channels - 1] ?? 0;
          if (alpha <= threshold) continue;
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    components.push({ label, size, touchesEdge });
  }

  const largest = components.reduce((best, component) => component.size > best.size ? component : best, { label: 0, size: 0, touchesEdge: false });
  const minimumDetachedSize = Math.max(96, Math.floor(pixelCount * 0.0015));
  const keep = new Set(components
    .filter((component) => component.label === largest.label || (!component.touchesEdge && component.size >= minimumDetachedSize))
    .map((component) => component.label));
  let removedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (keep.has(labels[index] ?? 0)) continue;
    const offset = index * channels;
    if ((data[offset + channels - 1] ?? 0) > 0) removedPixels += 1;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  return {
    detectedComponents: components.length,
    keptComponents: keep.size,
    removedComponents: components.length - keep.size,
    removedPixels,
    minimumDetachedSize
  };
}

function restoreSmallInteriorHoles(data, original, width, height, channels) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const maximumHoleSize = Math.max(120, Math.floor(pixelCount * 0.003));
  let repairedHoles = 0;
  let repairedPixels = 0;
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start]) continue;
    const alpha = data[start * channels + channels - 1] ?? 0;
    if (alpha > FOREGROUND_ALPHA_THRESHOLD) {
      visited[start] = 1;
      continue;
    }
    let head = 0;
    let tail = 0;
    let touchesEdge = false;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= pixelCount || visited[neighbor]) continue;
        const nx = neighbor % width;
        if (Math.abs(nx - x) > 1) continue;
        const neighborAlpha = data[neighbor * channels + channels - 1] ?? 0;
        if (neighborAlpha > FOREGROUND_ALPHA_THRESHOLD) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (touchesEdge || tail > maximumHoleSize) continue;
    repairedHoles += 1;
    repairedPixels += tail;
    for (let offset = 0; offset < tail; offset += 1) {
      const pixel = queue[offset];
      const target = pixel * channels;
      data[target] = original[target] ?? 0;
      data[target + 1] = original[target + 1] ?? 0;
      data[target + 2] = original[target + 2] ?? 0;
      data[target + 3] = 255;
    }
  }
  return { repairedHoles, repairedPixels, maximumHoleSize };
}

async function inspectAlpha(sharpFactory, png) {
  const { data, info } = await sharpFactory(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let partial = 0;
  let opaque = 0;
  let foreground = 0;
  let edgeForegroundPixels = 0;
  let cornerMaxAlpha = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + info.channels - 1] ?? 0;
      if (alpha === 0) transparent += 1;
      else if (alpha === 255) opaque += 1;
      else partial += 1;
      if (alpha > FOREGROUND_ALPHA_THRESHOLD) foreground += 1;
      if ((x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) && alpha > FOREGROUND_ALPHA_THRESHOLD) edgeForegroundPixels += 1;
      if ((x === 0 || x === info.width - 1) && (y === 0 || y === info.height - 1)) cornerMaxAlpha = Math.max(cornerMaxAlpha, alpha);
    }
  }
  const pixels = info.width * info.height;
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    hasAlpha: info.channels === 4,
    transparentPixels: transparent,
    partialAlphaPixels: partial,
    opaquePixels: opaque,
    foregroundCoverage: foreground / pixels,
    edgeForegroundPixels,
    cornerMaxAlpha
  };
}
