import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";

const source = "apps/client/public/assets/original/frontier/command-icons-source.png";
const runtime = "apps/client/public/assets/original/frontier/command-icons.png";
if (process.argv[2]) fs.copyFileSync(process.argv[2], source);
if (!fs.existsSync(source)) throw new Error("Provide the original imagegen source path.");
await sharp(source).resize(512, 512, { fit: "fill", kernel: "lanczos3" }).png({ palette: true, colours: 256, dither: 0 }).toFile(runtime);
const record = (file, isRuntime) => {
  const bytes = fs.readFileSync(file);
  return { file, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, runtime: isRuntime };
};
const assets = [record(source, false), record(runtime, true)];
const manifestPath = "assets/release-asset-manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.assets = [...manifest.assets.filter(a => !assets.some(n => n.file === a.file)), ...assets].sort((a,b) => a.file.localeCompare(b.file));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync("apps/client/public/assets/original/frontier/command-icons.metadata.json", JSON.stringify({
  creator: "Village Siege contributors / OpenAI built-in image_gen", license: "MIT", tool: "image_gen.imagegen", returnedModelSlug: null,
  modelNote: "The built-in result did not expose a model slug; project preference is gpt-image-2, which is not asserted as observed.",
  grid: { columns: 4, rows: 4, runtimeCellPixels: 128 }, assets,
  processing: "Original atlas downsampled and PNG palette encoded by repository-pinned sharp; no artwork copied from a commercial game.",
}, null, 2) + "\n");
console.log(JSON.stringify({ assets, grid: "4x4", status: "PREPARED" }));
