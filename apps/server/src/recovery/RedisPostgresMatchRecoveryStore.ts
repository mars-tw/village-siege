import { Pool, type PoolClient } from "pg";
import { createClient } from "redis";
import {
  MatchRecoveryStoreError,
  type MatchRecoveryLease,
  type MatchRecoveryMetadata,
  type MatchRecoveryRecord,
  type MatchRecoveryStore,
  type MatchRecoveryTerminalOutcome,
} from "./MatchRecoveryStore.js";

const TABLE_NAME = "village_siege_match_recovery";
const REDIS_KEY_PREFIX = "village-siege:match-recovery:";
const MAX_LEASE_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;

interface RecoveryRow {
  readonly match_id: string;
  readonly metadata: unknown;
  readonly revision: string | number;
  readonly committed_at_ms: string | number | null;
  readonly payload: unknown | null;
  readonly terminal: unknown | null;
  readonly owner_id: string | null;
  readonly fence: string | number;
  readonly lease_expires_at_ms: string | number | null;
}

interface RedisLeaseClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { readonly PX: number }): Promise<string | null>;
  eval(script: string, options: { readonly keys: readonly string[]; readonly arguments: readonly string[] }): Promise<unknown>;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export interface ProductionRecoveryStoreOptions {
  readonly redisUrl: string;
  readonly postgresUrl: string;
  readonly now?: () => number;
}

/**
 * Production recovery adapter. PostgreSQL is the durable source of truth and
 * serializes every fenced mutation with SELECT FOR UPDATE. Redis holds the
 * short-lived owner/fence route used to reject stale instances before they can
 * reach the durable write path.
 */
export class RedisPostgresMatchRecoveryStore<TPayload = unknown> implements MatchRecoveryStore<TPayload> {
  private schemaReady?: Promise<void>;

  constructor(
    private readonly postgres: Pool,
    private readonly redis: RedisLeaseClient,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    this.schemaReady ??= this.postgres.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        match_id TEXT PRIMARY KEY,
        metadata JSONB NOT NULL,
        revision BIGINT NOT NULL DEFAULT 0,
        committed_at_ms BIGINT NULL,
        payload JSONB NULL,
        terminal JSONB NULL,
        owner_id TEXT NULL,
        fence BIGINT NOT NULL DEFAULT 0,
        lease_expires_at_ms BIGINT NULL
      )
    `).then(() => undefined);
    await this.schemaReady;
  }

  async load(matchId: string): Promise<MatchRecoveryRecord<TPayload> | null> {
    assertIdentifier(matchId, "matchId");
    await this.initialize();
    const result = await this.postgres.query<RecoveryRow>(
      `SELECT * FROM ${TABLE_NAME} WHERE match_id = $1`,
      [matchId],
    );
    return result.rows[0] ? rowToRecord<TPayload>(result.rows[0]) : null;
  }

  async acquire(
    metadata: MatchRecoveryMetadata,
    ownerId: string,
    ttlMilliseconds: number,
  ): Promise<MatchRecoveryLease> {
    validateMetadata(metadata);
    assertIdentifier(ownerId, "ownerId");
    validateTtl(ttlMilliseconds);
    await this.initialize();
    const lease = await this.transaction(async (client) => {
      const now = this.currentTime();
      const row = await this.lockRow(client, metadata.matchId);
      let fence = 1;
      if (row) {
        assertMetadataEqual(row.metadata, metadata);
        if (row.terminal !== null) fail("MATCH_TERMINAL", `Match ${metadata.matchId} is terminal`);
        const expiry = nullableInteger(row.lease_expires_at_ms, "lease expiry");
        if (row.owner_id && expiry !== null && now < expiry) {
          fail("LEASE_HELD", `Match ${metadata.matchId} already has an active recovery lease`);
        }
        fence = integer(row.fence, "fence") + 1;
        if (!Number.isSafeInteger(fence)) fail("CORRUPT_RECORD", "Recovery fence overflowed");
      }
      const lease = { matchId: metadata.matchId, ownerId, fence, expiresAtEpochMs: safeAdd(now, ttlMilliseconds) };
      if (row) {
        await client.query(
          `UPDATE ${TABLE_NAME} SET owner_id = $2, fence = $3, lease_expires_at_ms = $4 WHERE match_id = $1`,
          [metadata.matchId, ownerId, fence, lease.expiresAtEpochMs],
        );
      } else {
        await client.query(
          `INSERT INTO ${TABLE_NAME}
            (match_id, metadata, revision, owner_id, fence, lease_expires_at_ms)
           VALUES ($1, $2::jsonb, 0, $3, $4, $5)`,
          [metadata.matchId, JSON.stringify(metadata), ownerId, fence, lease.expiresAtEpochMs],
        );
      }
      return lease;
    });
    try {
      const redisResult = await this.redis.set(redisKey(metadata.matchId), leaseToken(lease), { PX: ttlMilliseconds });
      // PostgreSQL has already awarded this monotonically fenced owner. Redis
      // is the fast route cache, so replacing an older token is intentional.
      if (redisResult !== "OK") throw new Error(`Redis failed to publish recovery lease ${metadata.matchId}`);
      return lease;
    } catch (error) {
      await this.compensateAcquire(lease).catch((compensationError) => {
        throw new AggregateError([error, compensationError], "Recovery acquire failed and PostgreSQL compensation failed");
      });
      throw error;
    }
  }

  async renew(lease: MatchRecoveryLease, ttlMilliseconds: number): Promise<MatchRecoveryLease> {
    validateLease(lease);
    validateTtl(ttlMilliseconds);
    await this.initialize();
    const now = this.currentTime();
    const renewed = { ...lease, expiresAtEpochMs: safeAdd(now, ttlMilliseconds) };
    await this.transaction(async (client) => {
      const row = await this.requireOwnedRow(client, lease, now);
      if (row.terminal !== null) fail("MATCH_TERMINAL", `Match ${lease.matchId} is terminal`);
      await client.query(
        `UPDATE ${TABLE_NAME} SET lease_expires_at_ms = $4
         WHERE match_id = $1 AND owner_id = $2 AND fence = $3`,
        [lease.matchId, lease.ownerId, lease.fence, renewed.expiresAtEpochMs],
      );
    });
    try {
      const renewedRedis = await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [redisKey(lease.matchId)], arguments: [leaseToken(lease), String(ttlMilliseconds)] },
      );
      if (Number(renewedRedis) !== 1) throw new MatchRecoveryStoreError(
        "STALE_FENCE",
        `Redis recovery lease is stale for ${lease.matchId}`,
      );
      return renewed;
    } catch (error) {
      await this.compensateRenewal(lease, renewed.expiresAtEpochMs).catch((compensationError) => {
        throw new AggregateError([error, compensationError], "Recovery renewal failed and PostgreSQL compensation failed");
      });
      throw error;
    }
  }

  async commit(
    lease: MatchRecoveryLease,
    metadata: MatchRecoveryMetadata,
    payload: TPayload,
  ): Promise<MatchRecoveryRecord<TPayload>> {
    validateLease(lease);
    validateMetadata(metadata);
    const json = jsonClone(payload, "recovery payload");
    await this.requireRedisFence(lease);
    return this.transaction(async (client) => {
      const now = this.currentTime();
      const row = await this.requireOwnedRow(client, lease, now);
      assertMetadataEqual(row.metadata, metadata);
      if (row.terminal !== null) fail("MATCH_TERMINAL", `Match ${lease.matchId} is terminal`);
      const revision = integer(row.revision, "revision") + 1;
      await client.query(
        `UPDATE ${TABLE_NAME}
         SET revision = $4, committed_at_ms = $5, payload = $6::jsonb
         WHERE match_id = $1 AND owner_id = $2 AND fence = $3`,
        [lease.matchId, lease.ownerId, lease.fence, revision, now, JSON.stringify(json)],
      );
      return {
        metadata: { ...metadata }, revision, committedAtEpochMs: now, payload: json,
        terminal: null, lease: { ...lease },
      };
    });
  }

  async markTerminal(
    lease: MatchRecoveryLease,
    metadata: MatchRecoveryMetadata,
    outcome: MatchRecoveryTerminalOutcome,
  ): Promise<MatchRecoveryRecord<TPayload>> {
    validateLease(lease);
    validateMetadata(metadata);
    validateTerminal(outcome);
    await this.requireRedisFence(lease);
    const result = await this.transaction(async (client) => {
      const now = this.currentTime();
      const row = await this.requireOwnedRow(client, lease, now);
      assertMetadataEqual(row.metadata, metadata);
      if (row.terminal !== null) fail("MATCH_TERMINAL", `Match ${lease.matchId} is terminal`);
      const revision = integer(row.revision, "revision") + 1;
      const terminal = { ...outcome, recordedAtEpochMs: now };
      await client.query(
        `UPDATE ${TABLE_NAME}
         SET revision = $4, terminal = $5::jsonb, owner_id = NULL, lease_expires_at_ms = NULL
         WHERE match_id = $1 AND owner_id = $2 AND fence = $3`,
        [lease.matchId, lease.ownerId, lease.fence, revision, JSON.stringify(terminal)],
      );
      const current = rowToRecord<TPayload>(row);
      return { ...current, revision, terminal, lease: null };
    });
    await this.deleteRedisFence(lease);
    return result;
  }

  async release(lease: MatchRecoveryLease): Promise<void> {
    validateLease(lease);
    await this.requireRedisFence(lease);
    await this.transaction(async (client) => {
      const row = await this.requireOwnedRow(client, lease, this.currentTime());
      if (row.terminal !== null) fail("MATCH_TERMINAL", `Match ${lease.matchId} is terminal`);
      await client.query(
        `UPDATE ${TABLE_NAME} SET owner_id = NULL, lease_expires_at_ms = NULL
         WHERE match_id = $1 AND owner_id = $2 AND fence = $3`,
        [lease.matchId, lease.ownerId, lease.fence],
      );
    });
    await this.deleteRedisFence(lease);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.postgres.connect();
    try {
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async compensateAcquire(lease: MatchRecoveryLease): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE ${TABLE_NAME} SET owner_id = NULL, lease_expires_at_ms = NULL
         WHERE match_id = $1 AND owner_id = $2 AND fence = $3 AND lease_expires_at_ms = $4`,
        [lease.matchId, lease.ownerId, lease.fence, lease.expiresAtEpochMs],
      );
    });
  }

  private async compensateRenewal(lease: MatchRecoveryLease, failedExpiry: number): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE ${TABLE_NAME} SET lease_expires_at_ms = $4
         WHERE match_id = $1 AND owner_id = $2 AND fence = $3 AND lease_expires_at_ms = $5`,
        [lease.matchId, lease.ownerId, lease.fence, lease.expiresAtEpochMs, failedExpiry],
      );
    });
  }

  private async lockRow(client: PoolClient, matchId: string): Promise<RecoveryRow | null> {
    const result = await client.query<RecoveryRow>(
      `SELECT * FROM ${TABLE_NAME} WHERE match_id = $1 FOR UPDATE`,
      [matchId],
    );
    return result.rows[0] ?? null;
  }

  private async requireOwnedRow(client: PoolClient, lease: MatchRecoveryLease, now: number): Promise<RecoveryRow> {
    const row = await this.lockRow(client, lease.matchId);
    if (!row) fail("NOT_FOUND", `Unknown recovery match: ${lease.matchId}`);
    if (row.owner_id !== lease.ownerId || integer(row.fence, "fence") !== lease.fence) {
      fail("STALE_FENCE", `PostgreSQL recovery fence is stale for ${lease.matchId}`);
    }
    const expiry = nullableInteger(row.lease_expires_at_ms, "lease expiry");
    if (expiry === null || now >= expiry) fail("LEASE_EXPIRED", `Recovery lease expired for ${lease.matchId}`);
    return row;
  }

  private async requireRedisFence(lease: MatchRecoveryLease): Promise<void> {
    if (await this.redis.get(redisKey(lease.matchId)) !== leaseToken(lease)) {
      fail("STALE_FENCE", `Redis recovery fence is stale for ${lease.matchId}`);
    }
  }

  private async deleteRedisFence(lease: MatchRecoveryLease): Promise<void> {
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      { keys: [redisKey(lease.matchId)], arguments: [leaseToken(lease)] },
    );
  }

  private currentTime(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_INPUT", "Recovery clock is invalid");
    return value;
  }
}

export async function createProductionRecoveryStore<TPayload = unknown>(
  options: ProductionRecoveryStoreOptions,
): Promise<{
  readonly store: RedisPostgresMatchRecoveryStore<TPayload>;
  readonly check: () => Promise<void>;
  readonly close: () => Promise<void>;
}> {
  if (!options.redisUrl || !options.postgresUrl) throw new Error("REDIS_URL and DATABASE_URL are required together");
  const postgres = new Pool({ connectionString: options.postgresUrl, max: 10 });
  const redis = createClient({ url: options.redisUrl }) as unknown as RedisLeaseClient;
  await redis.connect();
  const store = new RedisPostgresMatchRecoveryStore<TPayload>(postgres, redis, options.now);
  try {
    await store.initialize();
  } catch (error) {
    await Promise.allSettled([redis.quit(), postgres.end()]);
    throw error;
  }
  return {
    store,
    check: async () => {
      const [postgresResult, redisResult] = await Promise.all([
        postgres.query("SELECT 1 AS ready"),
        redis.ping(),
      ]);
      if (postgresResult.rowCount !== 1 || redisResult !== "PONG") {
        throw new Error("Durable recovery dependencies are not ready");
      }
    },
    close: async () => { await Promise.all([redis.quit(), postgres.end()]); },
  };
}

function rowToRecord<TPayload>(row: RecoveryRow): MatchRecoveryRecord<TPayload> {
  const metadata = jsonClone(row.metadata, "stored metadata") as MatchRecoveryMetadata;
  validateMetadata(metadata);
  const terminal = row.terminal === null ? null : jsonClone(row.terminal, "stored terminal") as MatchRecoveryRecord["terminal"];
  if (terminal) validateTerminal(terminal);
  const expiry = nullableInteger(row.lease_expires_at_ms, "lease expiry");
  const fence = integer(row.fence, "fence");
  const lease = row.owner_id && expiry !== null
    ? { matchId: row.match_id, ownerId: row.owner_id, fence, expiresAtEpochMs: expiry }
    : null;
  return {
    metadata,
    revision: integer(row.revision, "revision"),
    committedAtEpochMs: nullableInteger(row.committed_at_ms, "commit timestamp"),
    payload: row.payload === null ? null : jsonClone(row.payload, "stored payload") as TPayload,
    terminal,
    lease,
  };
}

function validateMetadata(metadata: MatchRecoveryMetadata): void {
  if (!metadata || !Number.isSafeInteger(metadata.schemaVersion) || metadata.schemaVersion < 1) fail("INVALID_INPUT", "Invalid recovery metadata schema");
  assertIdentifier(metadata.matchId, "matchId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(metadata.protocolVersion)
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(metadata.rulesVersion)) {
    fail("INVALID_INPUT", "Invalid recovery metadata version");
  }
}

function validateLease(lease: MatchRecoveryLease): void {
  assertIdentifier(lease.matchId, "matchId");
  assertIdentifier(lease.ownerId, "ownerId");
  if (!Number.isSafeInteger(lease.fence) || lease.fence < 1
    || !Number.isSafeInteger(lease.expiresAtEpochMs) || lease.expiresAtEpochMs < 0) {
    fail("INVALID_INPUT", "Invalid recovery lease");
  }
}

function validateTerminal(outcome: MatchRecoveryTerminalOutcome): void {
  if ((outcome.kind !== "completed" && outcome.kind !== "failed")
    || !/^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.code)
    || !Number.isSafeInteger(outcome.serverTick) || outcome.serverTick < 0) {
    fail("INVALID_INPUT", "Invalid recovery terminal outcome");
  }
}

function validateTtl(ttl: number): void {
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_LEASE_TTL_MILLISECONDS) fail("INVALID_INPUT", "Invalid recovery lease TTL");
}

function assertMetadataEqual(raw: unknown, expected: MatchRecoveryMetadata): void {
  const actual = jsonClone(raw, "stored metadata") as MatchRecoveryMetadata;
  validateMetadata(actual);
  if (actual.schemaVersion !== expected.schemaVersion
    || actual.protocolVersion !== expected.protocolVersion
    || actual.rulesVersion !== expected.rulesVersion
    || actual.matchId !== expected.matchId) {
    fail("METADATA_MISMATCH", `Recovery metadata does not match ${expected.matchId}`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) fail("INVALID_INPUT", `Invalid ${label}`);
}

function integer(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("CORRUPT_RECORD", `Invalid ${label}`);
  return parsed;
}

function nullableInteger(value: string | number | null, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail("INVALID_INPUT", "Recovery lease expiry overflowed");
  return result;
}

function leaseToken(lease: MatchRecoveryLease): string {
  return `${lease.ownerId}:${lease.fence}`;
}

function redisKey(matchId: string): string {
  return `${REDIS_KEY_PREFIX}${matchId}`;
}

function jsonClone<T>(value: T, label: string): T {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 8 * 1024 * 1024) fail("INVALID_INPUT", `${label} is not bounded JSON`);
    return JSON.parse(serialized) as T;
  } catch (error) {
    if (error instanceof MatchRecoveryStoreError) throw error;
    fail("INVALID_INPUT", `${label} is not JSON-safe`);
  }
}

function fail(code: ConstructorParameters<typeof MatchRecoveryStoreError>[0], message: string): never {
  throw new MatchRecoveryStoreError(code, message);
}
