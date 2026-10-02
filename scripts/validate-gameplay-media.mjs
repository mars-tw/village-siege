import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(process.env.GAMEPLAY_MEDIA_REPO_ROOT ?? defaultRepoRoot);
const manifestPath = resolve(repoRoot, process.env.GAMEPLAY_MEDIA_MANIFEST ?? "assets/gameplay-media-manifest.json");
const mediaRoot = resolve(repoRoot, "apps/client/public/media/gameplay");
const allowedFormats = new Map([[".mp4", "video/mp4"], [".webp", "image/webp"], [".json", "application/json"]]);
const expectedCounts = new Map([[".mp4", 3], [".webp", 3], [".json", 1]]);
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const toPosix = (value) => value.split(sep).join("/");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function ffprobe(file) {
  const result = spawnSync(process.env.FFPROBE_PATH ?? "ffprobe", [
    "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_name,codec_type,width,height,avg_frame_rate",
    "-of", "json", file,
  ], { encoding: "utf8" });
  assert(result.status === 0, `ffprobe could not decode ${toPosix(relative(repoRoot, file))}: ${result.stderr?.trim() || "unknown error"}`);
  return JSON.parse(result.stdout);
}

export function validateGameplayMedia() {
  assert(existsSync(manifestPath), "Gameplay media manifest is missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert(manifest.schemaVersion === 1, "Gameplay media manifest schemaVersion must be 1");
  assert(manifest.mediaRoot === "apps/client/public/media/gameplay", "Gameplay mediaRoot is invalid");
  assert(manifest.perFileBudgetBytes === 2 * 1024 * 1024, "Gameplay media per-file budget must remain 2 MiB");
  assert(Array.isArray(manifest.assets) && manifest.assets.length === 7, "Gameplay media manifest must contain exactly seven assets");
  const seen = new Set();
  const declared = new Map();
  const probes = new Map();
  const counts = new Map();
  for (const asset of manifest.assets) {
    assert(asset && typeof asset === "object", "Gameplay media entry must be an object");
    assert(typeof asset.file === "string" && /^apps\/client\/public\/media\/gameplay\/[a-z0-9][a-z0-9-]*\.(?:mp4|webp|json)$/.test(asset.file), `Invalid gameplay media path: ${asset.file}`);
    assert(!seen.has(asset.file), `Duplicate gameplay media entry: ${asset.file}`);
    seen.add(asset.file);
    declared.set(asset.file, asset);
    const extension = extname(asset.file).toLowerCase();
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
    assert(asset.format === allowedFormats.get(extension), `Incorrect format for ${asset.file}`);
    assert(asset.kind === ({ ".mp4": "video", ".webp": "poster", ".json": "metadata" })[extension], `Incorrect kind for ${asset.file}`);
    assert(Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= manifest.perFileBudgetBytes, `${asset.file} exceeds the 2 MiB policy or has invalid bytes`);
    assert(/^[a-f0-9]{64}$/.test(asset.sha256), `Invalid SHA-256 for ${asset.file}`);
    assert(asset.source?.type === "original-gameplay-capture" && typeof asset.source.recordedFrom === "string" && asset.source.recordedFrom.trim(), `Missing capture source for ${asset.file}`);
    assert(typeof asset.source.attribution === "string" && asset.source.attribution.trim(), `Missing attribution for ${asset.file}`);
    assert(asset.source.license === "MIT", `Gameplay media license must be MIT for ${asset.file}`);
    const absolute = resolve(repoRoot, asset.file);
    assert(absolute.startsWith(`${mediaRoot}${sep}`) && existsSync(absolute), `Gameplay media file is missing: ${asset.file}`);
    const bytes = readFileSync(absolute);
    assert(statSync(absolute).size === asset.bytes, `Byte count drift for ${asset.file}`);
    assert(digest(bytes) === asset.sha256, `SHA-256 drift for ${asset.file}`);
    if (extension === ".mp4") {
      const probe = ffprobe(absolute);
      assert(probe.format?.format_name?.split(",").includes("mp4"), `${asset.file} is not an MP4 container`);
      assert(Number.parseFloat(probe.format?.duration) > 0, `${asset.file} has no positive duration`);
      const video = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
      assert(video.length === 1 && video[0].codec_name === "h264" && video[0].width > 0 && video[0].height > 0, `${asset.file} must contain one decodable H.264 video stream`);
      assert(!probe.streams?.some((stream) => stream.codec_type === "audio"), `${asset.file} must not contain an undeclared audio stream`);
      probes.set(asset.file, probe);
    } else if (extension === ".webp") {
      const probe = ffprobe(absolute);
      const image = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
      assert(image.length === 1 && image[0].codec_name === "webp" && image[0].width > 0 && image[0].height > 0, `${asset.file} must contain one decodable WebP image`);
    }
  }
  for (const [extension, expected] of expectedCounts) assert(counts.get(extension) === expected, `Expected ${expected} ${extension} gameplay media files`);
  const actualFiles = readdirSync(mediaRoot, { withFileTypes: true });
  assert(actualFiles.every((entry) => entry.isFile()), "Gameplay media directory must not contain subdirectories");
  const actual = actualFiles.map((entry) => `apps/client/public/media/gameplay/${entry.name}`).sort();
  assert(actual.length === seen.size && actual.every((file) => seen.has(file)), "Gameplay media directory must exactly match the manifest allowlist");
  const metadataEntry = manifest.assets.find((asset) => extname(asset.file).toLowerCase() === ".json");
  const metadata = JSON.parse(readFileSync(resolve(repoRoot, metadataEntry.file), "utf8"));
  assert(Array.isArray(metadata.clips) && metadata.clips.length === 3, "Gameplay metadata must describe exactly three clips");
  const expectedClipIds = new Set(["economy", "movement", "battle"]);
  const clipIds = new Set();
  const referenced = new Set();
  for (const clip of metadata.clips) {
    assert(expectedClipIds.has(clip.id), `Unexpected gameplay clip id: ${clip.id}`);
    assert(!clipIds.has(clip.id), `Duplicate gameplay clip id: ${clip.id}`);
    clipIds.add(clip.id);
    assert(typeof clip.title === "string" && clip.title.trim() && typeof clip.description === "string" && clip.description.trim(), `Gameplay clip ${clip.id} needs a title and description`);
    assert(clip.source?.type === "original-gameplay-capture" && typeof clip.source.recordedFrom === "string" && clip.source.recordedFrom.trim(), `Gameplay clip ${clip.id} needs a capture source`);
    assert(typeof clip.source.attribution === "string" && clip.source.attribution.trim() && clip.source.license === "MIT", `Gameplay clip ${clip.id} needs source attribution and an MIT license`);
    for (const field of ["video", "poster"]) {
      const expectedExtension = field === "video" ? ".mp4" : ".webp";
      const expectedKind = field === "video" ? "video" : "poster";
      assert(typeof clip[field] === "string" && new RegExp(`^media/gameplay/[a-z0-9][a-z0-9-]*\\${expectedExtension}$`).test(clip[field]), `Gameplay clip ${clip.id} has an invalid ${field} path`);
      const target = `apps/client/public/${clip[field]}`;
      assert(seen.has(target), `Gameplay clip ${clip.id} references undeclared ${field}: ${clip[field]}`);
      assert(declared.get(target)?.kind === expectedKind, `Gameplay clip ${clip.id} ${field} must reference a ${expectedKind} manifest asset`);
      referenced.add(target);
    }
    assert(Number.isFinite(clip.durationSeconds) && clip.durationSeconds > 0, `Gameplay clip ${clip.id} needs a positive duration`);
    assert(Number.isFinite(clip.fps) && clip.fps > 0 && Number.isSafeInteger(clip.width) && clip.width > 0 && Number.isSafeInteger(clip.height) && clip.height > 0, `Gameplay clip ${clip.id} needs valid video dimensions and fps`);
    assert(Number.isSafeInteger(clip.bytes) && clip.bytes > 0 && /^[a-f0-9]{64}$/.test(clip.sha256), `Gameplay clip ${clip.id} needs video bytes and SHA-256`);
    assert(clip.audio === false, `Gameplay clip ${clip.id} must explicitly declare audio:false`);
    assert(typeof clip.recordedAt === "string" && !Number.isNaN(Date.parse(clip.recordedAt)), `Gameplay clip ${clip.id} needs a valid recordedAt timestamp`);
    const videoAsset = declared.get(`apps/client/public/${clip.video}`);
    assert(clip.bytes === videoAsset.bytes && clip.sha256 === videoAsset.sha256, `Gameplay clip ${clip.id} video bytes/hash drift from manifest`);
    const probe = probes.get(`apps/client/public/${clip.video}`);
    const stream = probe.streams.find((candidate) => candidate.codec_type === "video");
    const [fpsNumerator, fpsDenominator] = String(stream.avg_frame_rate).split("/").map(Number);
    const actualFps = fpsNumerator / fpsDenominator;
    assert(clip.width === stream.width && clip.height === stream.height, `Gameplay clip ${clip.id} dimensions drift from ffprobe`);
    assert(Math.abs(clip.durationSeconds - Number.parseFloat(probe.format.duration)) < 0.1, `Gameplay clip ${clip.id} duration drifts from ffprobe`);
    assert(Number.isFinite(actualFps) && Math.abs(clip.fps - actualFps) < 0.01, `Gameplay clip ${clip.id} fps drifts from ffprobe`);
  }
  assert(clipIds.size === expectedClipIds.size && [...expectedClipIds].every((id) => clipIds.has(id)), "Gameplay metadata must contain economy, movement, and battle exactly once");
  assert(referenced.size === 6, "Every gameplay video and poster must be referenced exactly once by metadata");
  return { assets: seen.size, videos: counts.get(".mp4"), manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = validateGameplayMedia();
    console.log(`[gameplay-media] PASS: ${result.assets} assets, ${result.videos} H.264 videos`);
  } catch (error) {
    console.error(`[gameplay-media] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
