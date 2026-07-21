import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const input = option("input");
const output = option("out");
const order = (option("order") ?? "0,1,2,3,4,5").split(",").map(Number);

if (!input || !output) {
  throw new Error("Usage: node scripts/reorder-six-row-action-sheet.mjs --input <sheet.png> --out <sheet.png> --order 0,1,2,4,5,3");
}
if (order.length !== 6 || order.some((row) => !Number.isInteger(row) || row < 0 || row > 5) || new Set(order).size !== 6) {
  throw new Error("--order must contain each source row 0..5 exactly once");
}

const source = sharp(input);
const metadata = await source.metadata();
if (!metadata.width || !metadata.height || metadata.height % 6 !== 0) {
  throw new Error(`Expected a six-row image; received ${metadata.width ?? "?"}x${metadata.height ?? "?"}`);
}

const rowHeight = metadata.height / 6;
const transparentBackground = metadata.hasAlpha === true;
const rows = await Promise.all(order.map((sourceRow) => (
  sharp(input)
    .extract({ left: 0, top: sourceRow * rowHeight, width: metadata.width, height: rowHeight })
    .png()
    .toBuffer()
)));

await mkdir(path.dirname(output), { recursive: true });
await sharp({
  create: {
    width: metadata.width,
    height: metadata.height,
    channels: 4,
    background: transparentBackground
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 0, b: 255, alpha: 1 },
  },
})
  .composite(rows.map((row, index) => ({ input: row, left: 0, top: index * rowHeight })))
  .png()
  .toFile(output);

console.log(`Reordered ${input} -> ${output}; rows=${order.join(",")}`);
