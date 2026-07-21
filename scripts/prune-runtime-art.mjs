import { readFile, readdir, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvedRuntimePngsFromManifest, shouldPruneRuntimePng } from "./runtime-art-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const runtimeIndex = process.argv.indexOf("--runtime-dir");
const runtimeValue = runtimeIndex >= 0 ? process.argv[runtimeIndex + 1] : undefined;
if (!runtimeValue) throw new Error("Usage: node scripts/prune-runtime-art.mjs --runtime-dir apps/client/dist");

const runtimeRoot = path.resolve(repoRoot, runtimeValue);
const expectedRoot = path.resolve(repoRoot, "apps/client/dist");
if (runtimeRoot !== expectedRoot) {
  throw new Error(`Refusing to prune anything except ${path.relative(repoRoot, expectedRoot).split(path.sep).join("/")}`);
}
const runtimeStats = await stat(runtimeRoot);
if (!runtimeStats.isDirectory()) throw new Error("Runtime target is not a directory");

const originalRoot = path.join(runtimeRoot, "assets", "original");
const removed = [];
const releaseManifest = JSON.parse(await readFile(path.join(repoRoot, "assets", "release-asset-manifest.json"), "utf8"));
const approvedRuntimePngs = approvedRuntimePngsFromManifest(releaseManifest);

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(runtimeRoot, absolute).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Resolved path escaped runtime root: ${absolute}`);
    if (entry.isDirectory()) {
      await visit(absolute);
      continue;
    }
    if (!shouldPruneRuntimePng(relative, approvedRuntimePngs)) continue;
    await unlink(absolute);
    removed.push(relative);
  }
}

await visit(originalRoot);

async function removeEmptyDirectories(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeEmptyDirectories(path.join(directory, entry.name));
  }
  if (directory === originalRoot) return;
  if ((await readdir(directory)).length === 0) await rmdir(directory);
}

await removeEmptyDirectories(originalRoot);
console.log(`Pruned ${removed.length} build-only art file(s) from ${path.relative(repoRoot, runtimeRoot).split(path.sep).join("/")}.`);
