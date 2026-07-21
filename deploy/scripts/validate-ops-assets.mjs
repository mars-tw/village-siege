import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const relativeFiles = [
  ".gitattributes",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy-pages.yml",
  ".github/workflows/publish-containers.yml",
  ".env.example",
  "Dockerfile",
  "apps/client/Dockerfile",
  "apps/client/public/runtime-config.js",
  "compose.yaml",
  "deploy/backup/backup-postgres.sh",
  "deploy/backup/README.md",
  "deploy/backup/restore-postgres.sh",
  "deploy/monitoring/README.md",
  "deploy/monitoring/prometheus.yml",
  "deploy/monitoring/blackbox.yml",
  "deploy/monitoring/alerts/village-siege.rules.yml",
  "deploy/monitoring/grafana/provisioning/datasources/prometheus.yml",
  "deploy/monitoring/grafana/provisioning/dashboards/dashboards.yml",
  "deploy/monitoring/grafana/dashboards/village-siege-overview.json",
  "deploy/production-compose.sh",
  "deploy/production.env.example",
  "deploy/compose.production.yaml",
  "deploy/runtime-config.mjs",
  "deploy/scripts/validate-ops-assets.mjs",
  "deploy/static-server.mjs",
  "deploy/test/runtime-art-policy.test.mjs",
  "deploy/test/runtime-config.test.mjs",
  "scripts/prune-runtime-art.mjs",
  "scripts/runtime-art-policy.mjs",
];

const contents = new Map();
for (const relativeFile of relativeFiles) {
  const source = await readFile(resolve(root, relativeFile), "utf8");
  if (source.includes("\r")) throw new Error(`${relativeFile} must use LF line endings`);
  if (source.includes("\t")) throw new Error(`${relativeFile} must not contain tab indentation`);
  if (source.split("\n").some((line) => /\s+$/u.test(line))) {
    throw new Error(`${relativeFile} contains trailing whitespace`);
  }
  contents.set(relativeFile, source);
}

JSON.parse(contents.get("deploy/monitoring/grafana/dashboards/village-siege-overview.json"));

const allPublicConfig = [...contents.values()].join("\n");
for (const forbidden of [
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/iu,
  /redis:\/\/[^\s:@]+:[^\s@]+@/iu,
  /(?:password|token|secret)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/iu,
]) {
  if (forbidden.test(allPublicConfig)) throw new Error(`possible embedded credential matched ${forbidden}`);
}

const productionCompose = contents.get("deploy/production-compose.sh");
for (const required of [
  "COMPOSE_REDIS_SECRET_FILE",
  "COMPOSE_POSTGRES_SECRET_FILE",
  "read_base64url_secret",
  "secret directory must have mode 0700",
  "secret file must have mode 0444",
  "exec docker compose",
]) {
  if (!productionCompose.includes(required)) throw new Error(`production Compose wrapper check missing: ${required}`);
}

const runtimeServer = contents.get("deploy/static-server.mjs");
for (const required of [
  '"Cache-Control": "no-store"',
  'pathname === "/runtime-config.js"',
]) {
  if (!runtimeServer.includes(required)) throw new Error(`runtime server safety check missing: ${required}`);
}

const runtimeConfig = contents.get("deploy/runtime-config.mjs");
for (const required of [
  "__VILLAGE_SIEGE_RUNTIME_CONFIG__",
  "multiplayerEnabled",
  "colyseusUrl",
  'parsed.protocol !== "https:"',
  "parsed.origin !== value",
  "PUBLIC_CONNECT_ORIGIN must be an exact HTTPS origin",
  "validatePagesBuildConfig",
  "VILLAGE_SIEGE_COLYSEUS_URL is required when public multiplayer is enabled",
]) {
  if (!runtimeConfig.includes(required)) throw new Error(`runtime config safety check missing: ${required}`);
}

const pagesWorkflow = contents.get(".github/workflows/deploy-pages.yml");
for (const required of [
  "vars.VILLAGE_SIEGE_MULTIPLAYER_ENABLED || 'false'",
  "vars.VILLAGE_SIEGE_COLYSEUS_URL || ''",
  "validatePagesBuildConfig",
]) {
  if (!pagesWorkflow.includes(required)) throw new Error(`Pages multiplayer release gate missing: ${required}`);
}

const runtimeFallback = contents.get("apps/client/public/runtime-config.js").trim();
if (runtimeFallback !== "globalThis.__VILLAGE_SIEGE_RUNTIME_CONFIG__ = Object.freeze({});") {
  throw new Error("public runtime config fallback must remain an empty frozen object");
}

const productionTemplate = contents.get("deploy/compose.production.yaml");
if (!productionTemplate.includes('VITE_MULTIPLAYER_ENABLED: "false"')
  || productionTemplate.includes("VITE_COLYSEUS_URL:")) {
  throw new Error("production client build must remain domain-agnostic and runtime-configured");
}
for (const required of [
  "VILLAGE_SIEGE_TAG:-0.20.0",
  "ghcr.io/mars-tw/village-siege-client",
  "ghcr.io/mars-tw/village-siege-server",
]) {
  if (!productionTemplate.includes(required)) throw new Error(`production release tag check missing: ${required}`);
}
if (!contents.get("deploy/production.env.example").includes("VILLAGE_SIEGE_TAG=0.20.0")) {
  throw new Error("production environment example must select the current release tag");
}

const rootDockerfile = contents.get("Dockerfile");
const clientDockerfile = contents.get("apps/client/Dockerfile");
const nodeImageDigest = "sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d";
for (const [name, dockerfile] of [["server", rootDockerfile], ["client", clientDockerfile]]) {
  if (!dockerfile.includes(`ARG NODE_IMAGE_DIGEST=${nodeImageDigest}`)
    || !dockerfile.includes("@${NODE_IMAGE_DIGEST}")) {
    throw new Error(`${name} Dockerfile must pin the Node base image by multi-architecture digest`);
  }
}
for (const required of [
  "COPY scripts/runtime-art-policy.mjs scripts/runtime-art-policy.mjs",
  "COPY assets/release-asset-manifest.json assets/release-asset-manifest.json",
]) {
  if (!clientDockerfile.includes(required)) throw new Error(`client Dockerfile runtime-art dependency missing: ${required}`);
}

const verificationWorkflow = contents.get(".github/workflows/ci.yml");
for (const required of [
  'expected_version="$(node -p "require(\'./package.json\').version")"',
  "v.version!==expected",
]) {
  if (!verificationWorkflow.includes(required)) throw new Error(`CI dynamic version gate missing: ${required}`);
}
for (const pinnedImage of [
  "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648",
  "redis:7.4-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99",
  "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193",
]) {
  if (!productionTemplate.includes(pinnedImage)) {
    throw new Error(`production dependency image must be digest-pinned: ${pinnedImage}`);
  }
}

const localTemplate = contents.get("compose.yaml");
for (const pinnedImage of [
  "redis:7.4-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99",
  "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193",
]) {
  if (!localTemplate.includes(pinnedImage)) {
    throw new Error(`local dependency image must be digest-pinned: ${pinnedImage}`);
  }
}

const attributes = contents.get(".gitattributes");
if (!attributes.includes("* text=auto eol=lf")) {
  throw new Error(".gitattributes must enforce LF for cross-platform source builds");
}

const containerWorkflow = contents.get(".github/workflows/publish-containers.yml");
for (const required of [
  "packages: write",
  "attestations: write",
  "id-token: write",
  "linux/amd64,linux/arm64",
  "org.opencontainers.image.source",
  "org.opencontainers.image.licenses=MIT",
  "sbom: true",
  "push-to-registry: true",
]) {
  if (!containerWorkflow.includes(required)) throw new Error(`container publication check missing: ${required}`);
}
const actionUses = [...containerWorkflow.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gmu)];
if (actionUses.length === 0) throw new Error("container publication workflow contains no actions");
for (const [, action, reference] of actionUses) {
  if (!/^[0-9a-f]{40}$/u.test(reference)) {
    throw new Error(`container publication action is not pinned to a full commit SHA: ${action}@${reference}`);
  }
}

const backup = contents.get("deploy/backup/backup-postgres.sh");
for (const required of [
  "AGE_RECIPIENT",
  "BACKUP_TMPDIR",
  "mktemp -d",
  "mktemp \"$BACKUP_DIR/.village-siege-backup.XXXXXX\"",
  "pg_restore --list",
  "age --encrypt",
  "rm -f \"$plain_file\"",
  "mv \"$encrypted_file\" \"$final_file\"",
  "RETENTION_DAYS",
  ".dump.age",
]) {
  if (!backup.includes(required)) throw new Error(`backup safety check missing: ${required}`);
}

const restore = contents.get("deploy/backup/restore-postgres.sh");
for (const required of [
  "DATABASE_URL is forbidden for restore",
  "PGHOST is required for restore",
  "AGE_IDENTITY_FILE",
  "age --decrypt",
  "rm -f \"$plain_file\"",
  "umask 077",
  "[ -t 0 ]",
  "first_confirmation",
  "second_confirmation",
  "--single-transaction",
]) {
  if (!restore.includes(required)) throw new Error(`restore safety check missing: ${required}`);
}

const prometheus = contents.get("deploy/monitoring/prometheus.yml");
for (const required of ["job_name: village-siege-server", "metrics_path: /metrics", "server:2567"]) {
  if (!prometheus.includes(required)) throw new Error(`Prometheus server scrape check missing: ${required}`);
}

const alerts = contents.get("deploy/monitoring/alerts/village-siege.rules.yml");
for (const required of [
  "village_siege_recovery_fail_stops_total",
  "village_siege_persistence_failures_total",
  "village_siege_tick_duration_seconds_sum",
  "village_siege_persistence_duration_seconds_sum",
]) {
  if (!alerts.includes(required)) throw new Error(`Prometheus authority alert check missing: ${required}`);
}

console.log(`Validated ${relativeFiles.length} secret-free operations assets.`);
