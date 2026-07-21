import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const relativeFiles = [
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
  "deploy/scripts/validate-ops-assets.mjs",
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
