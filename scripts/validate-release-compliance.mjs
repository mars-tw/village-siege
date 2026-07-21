import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = join(repoRoot, "apps/client/public/assets/original");
const manifestPath = join(repoRoot, "assets/release-asset-manifest.json");
const attributionPath = join(repoRoot, "assets/ATTRIBUTION.md");
const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT"
]);

const toPosix = (value) => value.split(sep).join("/");
const fromRepo = (value) => toPosix(relative(repoRoot, value));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(absolute) : [absolute];
    })
    .sort((left, right) => fromRepo(left).localeCompare(fromRepo(right)));
}

function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function parseAttributionRows(markdown) {
  const rows = [];
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match) continue;
    const [, pattern, kind, author, license, note] = match;
    rows.push({ pattern, kind, author, license, note, line: index + 1, regex: globToRegex(pattern) });
  }
  return rows;
}

function validateAssetsAndAttribution() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert(manifest.schemaVersion === 1, "Asset manifest schemaVersion must be 1");
  assert(Number.isSafeInteger(manifest.runtimeBudgetBytes) && manifest.runtimeBudgetBytes > 0, "Invalid runtime budget");
  assert(Number.isSafeInteger(manifest.perRuntimeAssetBudgetBytes) && manifest.perRuntimeAssetBudgetBytes > 0, "Invalid per-asset budget");
  assert(Number.isSafeInteger(manifest.runtimeBundleBudgetBytes) && manifest.runtimeBundleBudgetBytes > 0, "Invalid runtime bundle budget");
  assert(Number.isSafeInteger(manifest.perRuntimeFileBudgetBytes) && manifest.perRuntimeFileBudgetBytes > 0, "Invalid per-runtime-file budget");
  assert(Array.isArray(manifest.assets) && manifest.assets.length > 0, "Asset manifest is empty");

  const rows = parseAttributionRows(readFileSync(attributionPath, "utf8"));
  assert(rows.length > 0, "ATTRIBUTION.md contains no machine-readable asset rows");
  for (const row of rows) {
    assert(row.pattern.startsWith("apps/client/"), `Attribution line ${row.line} has an out-of-scope path`);
    assert(row.kind.trim() && row.author.trim() && row.note.trim(), `Attribution line ${row.line} has an empty required field`);
    assert(allowedLicenses.has(row.license.trim()), `Attribution line ${row.line} has unsupported license '${row.license.trim()}'`);
  }

  const actualPngs = walkFiles(assetRoot).filter((file) => extname(file).toLowerCase() === ".png").map(fromRepo);
  const declared = new Map();
  for (const entry of manifest.assets) {
    assert(entry && typeof entry === "object", "Asset manifest entry must be an object");
    assert(typeof entry.file === "string" && entry.file.startsWith("apps/client/public/assets/original/"), "Asset path is outside the original asset tree");
    assert(!declared.has(entry.file), `Duplicate asset manifest entry: ${entry.file}`);
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), `Invalid SHA-256 for ${entry.file}`);
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes > 0, `Invalid byte count for ${entry.file}`);
    const expectedRuntime = /\/sprites\/(?:action-sheet|facings\/[^/]+)\.png$/.test(entry.file);
    assert(entry.runtime === expectedRuntime, `Incorrect runtime classification for ${entry.file}`);
    declared.set(entry.file, entry);
  }

  assert(actualPngs.length === declared.size, `Asset file count ${actualPngs.length} does not match manifest count ${declared.size}`);
  for (const file of actualPngs) {
    const entry = declared.get(file);
    assert(entry, `PNG is missing from release manifest: ${file}`);
    const buffer = readFileSync(join(repoRoot, file));
    assert(buffer.length === entry.bytes, `Byte count drift for ${file}`);
    assert(sha256(buffer) === entry.sha256, `SHA-256 drift for ${file}`);
    const matchingRows = rows.filter((row) => row.regex.test(file));
    assert(matchingRows.length === 1, `${file} must match exactly one attribution row; found ${matchingRows.length}`);
  }
  for (const row of rows.filter((candidate) => candidate.pattern.includes("assets/original/"))) {
    assert(actualPngs.some((file) => row.regex.test(file)), `Attribution line ${row.line} matches no shipped PNG`);
  }

  const runtimeAssets = [...declared.values()].filter((entry) => entry.runtime);
  const runtimeBytes = runtimeAssets.reduce((total, entry) => total + entry.bytes, 0);
  assert(runtimeBytes <= manifest.runtimeBudgetBytes, `Runtime art is ${runtimeBytes} bytes; budget is ${manifest.runtimeBudgetBytes}`);
  for (const entry of runtimeAssets) {
    assert(entry.bytes <= manifest.perRuntimeAssetBudgetBytes, `${entry.file} exceeds the per-runtime-asset budget`);
  }

  return { pngs: actualPngs.length, attributionRows: rows.length, runtimeAssets: runtimeAssets.length, runtimeBytes, manifest };
}

function packageLicense(manifest, rootLicense) {
  if (typeof manifest.license === "string") return manifest.license.trim();
  if (Array.isArray(manifest.licenses) && manifest.licenses.length === 1) {
    const only = manifest.licenses[0];
    return (typeof only === "string" ? only : only?.type)?.trim();
  }
  if (typeof manifest.name === "string" && manifest.name.startsWith("@village-siege/")) return rootLicense;
  return "";
}

function validateProductionLicenses() {
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert(allowedLicenses.has(rootPackage.license), `Root package uses unsupported license '${rootPackage.license ?? "missing"}'`);
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  assert(lock.lockfileVersion === 3, "Release license gate requires package-lock v3");
  let checked = 0;
  let unavailableOptional = 0;
  const denied = [];
  for (const [packagePath, locked] of Object.entries(lock.packages ?? {})) {
    if (!packagePath.startsWith("node_modules/") || locked.dev === true) continue;
    const installedManifestPath = join(repoRoot, packagePath, "package.json");
    if (!existsSync(installedManifestPath)) {
      if (locked.optional === true) {
        unavailableOptional += 1;
        continue;
      }
      fail(`Production package is not installed: ${packagePath}`);
    }
    const installed = JSON.parse(readFileSync(installedManifestPath, "utf8"));
    const license = packageLicense(installed, rootPackage.license);
    checked += 1;
    if (!allowedLicenses.has(license)) denied.push(`${installed.name ?? packagePath}@${installed.version ?? locked.version}: ${license || "UNKNOWN"}`);
  }
  assert(denied.length === 0, `Unsupported production dependency licenses:\n${denied.join("\n")}`);
  assert(checked > 0, "No installed production dependency licenses were checked");
  return { checked, unavailableOptional };
}

function listRepositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  assert(result.status === 0, `git ls-files failed: ${result.stderr?.trim() ?? "unknown error"}`);
  return result.stdout.split("\0").filter(Boolean).sort();
}

function isTextCandidate(file) {
  const normalized = toPosix(file);
  if (normalized === "scripts/validate-release-compliance.mjs") return false;
  if (normalized.startsWith("output/") || normalized.includes("/dist/")) return false;
  const basename = normalized.split("/").at(-1);
  if (basename === "Dockerfile" || basename.startsWith(".env")) return true;
  return new Set([".cjs", ".css", ".env", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ps1", ".sh", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"]).has(extname(normalized).toLowerCase());
}

function validateNoCommittedSecrets() {
  const fingerprints = [
    ["private key", new RegExp("-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", "g")],
    ["AWS access key", new RegExp("AKIA[0-9A-Z]{16}", "g")],
    ["GitHub token", new RegExp("(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})", "g")],
    ["OpenAI-style key", new RegExp("sk-(?:proj-)?[A-Za-z0-9_-]{32,}", "g")],
    ["Slack token", new RegExp("xox[baprs]-[A-Za-z0-9-]{20,}", "g")],
    ["GitLab token", new RegExp("glpat-[A-Za-z0-9_-]{20,}", "g")]
  ];
  const assignment = /\b([A-Za-z][A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd))\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi;
  const environmentAssignment = /^\s*([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD))\s*=\s*([^\s#]{12,})\s*$/gim;
  const credentialUrl = /(?:postgres(?:ql)?|redis):\/\/[^:\s/@]+:([^@\s/]{8,})@/gi;
  const placeholder = /(?:example|placeholder|replace|change[-_ ]?me|dummy|sample|operator|process\.env|import\.meta\.env|\$\{|\$\(|<[^>]+>|\*{3,})/i;
  const findings = [];
  let checked = 0;
  for (const file of listRepositoryFiles().filter(isTextCandidate)) {
    const absolute = join(repoRoot, file);
    if (!existsSync(absolute) || statSync(absolute).size > 2 * 1024 * 1024) continue;
    const content = readFileSync(absolute, "utf8");
    checked += 1;
    for (const [name, pattern] of fingerprints) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) findings.push(`${file}: ${name}`);
    }
    assignment.lastIndex = 0;
    for (const match of content.matchAll(assignment)) {
      if (!placeholder.test(match[2])) findings.push(`${file}: suspicious hard-coded ${match[1]}`);
    }
    environmentAssignment.lastIndex = 0;
    for (const match of content.matchAll(environmentAssignment)) {
      if (!placeholder.test(match[2])) findings.push(`${file}: suspicious environment secret assignment for ${match[1]}`);
    }
    credentialUrl.lastIndex = 0;
    for (const match of content.matchAll(credentialUrl)) {
      if (!placeholder.test(match[1])) findings.push(`${file}: credential-bearing database URL`);
    }
  }
  assert(findings.length === 0, `Secret-pattern findings:\n${[...new Set(findings)].join("\n")}`);
  return { checked, findings: findings.length };
}

function validateRuntimeDirectory(directory, manifest) {
  const absoluteDirectory = resolve(repoRoot, directory);
  assert(existsSync(absoluteDirectory), `Runtime directory does not exist: ${directory}`);
  const publicPrefix = "apps/client/public/";
  const expected = new Map(manifest.assets.filter((entry) => entry.runtime).map((entry) => [entry.file.slice(publicPrefix.length), entry]));
  const files = walkFiles(absoluteDirectory);
  for (const file of files) {
    const bytes = statSync(file).size;
    assert(bytes <= manifest.perRuntimeFileBudgetBytes, `Runtime file exceeds ${manifest.perRuntimeFileBudgetBytes} bytes: ${toPosix(relative(absoluteDirectory, file))}`);
  }
  const runtimePngs = files.filter((file) => extname(file).toLowerCase() === ".png");
  for (const file of runtimePngs) {
    const pathWithinRuntime = toPosix(relative(absoluteDirectory, file));
    const entry = expected.get(pathWithinRuntime);
    assert(entry, `Runtime bundle includes an unapproved or source PNG: ${pathWithinRuntime}`);
    assert(sha256(readFileSync(file)) === entry.sha256, `Runtime bundle hash drift: ${pathWithinRuntime}`);
    expected.delete(pathWithinRuntime);
  }
  assert(expected.size === 0, `Runtime bundle is missing approved PNGs: ${[...expected.keys()].join(", ")}`);
  const totalBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  assert(totalBytes <= manifest.runtimeBundleBudgetBytes, `Runtime bundle is ${totalBytes} bytes; budget is ${manifest.runtimeBundleBudgetBytes}`);
  return { pngs: runtimePngs.length, files: files.length, totalBytes };
}

try {
  const assetResult = validateAssetsAndAttribution();
  const licenseResult = validateProductionLicenses();
  const secretResult = validateNoCommittedSecrets();
  console.log(`[release-compliance] assets ${assetResult.pngs}/${assetResult.pngs} hashed; attribution rows ${assetResult.attributionRows}`);
  console.log(`[release-compliance] runtime art ${assetResult.runtimeAssets} files, ${assetResult.runtimeBytes}/${assetResult.manifest.runtimeBudgetBytes} bytes`);
  console.log(`[release-compliance] production dependency licenses ${licenseResult.checked} allowed; optional unavailable ${licenseResult.unavailableOptional}`);
  console.log(`[release-compliance] secret scan ${secretResult.checked} text files; findings ${secretResult.findings}`);
  const runtimeIndex = process.argv.indexOf("--runtime-dir");
  if (runtimeIndex !== -1) {
    const runtimeDirectory = process.argv[runtimeIndex + 1];
    assert(runtimeDirectory, "--runtime-dir requires a directory");
    const runtimeResult = validateRuntimeDirectory(runtimeDirectory, assetResult.manifest);
    console.log(`[release-compliance] runtime bundle ${runtimeResult.files} files, ${runtimeResult.pngs} approved PNGs, ${runtimeResult.totalBytes} bytes`);
  }
  console.log("[release-compliance] PASS");
} catch (error) {
  console.error(`[release-compliance] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
