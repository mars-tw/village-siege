import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { MATCH_PROTOCOL_VERSION, RULES_VERSION } from "@village-siege/shared";
import {
  MatchRecoveryStoreError,
  type MatchRecoveryLease,
  type MatchRecoveryMetadata,
  type MatchRecoveryStoreErrorCode,
} from "../src/recovery/MatchRecoveryStore.js";
import { RedisPostgresMatchRecoveryStore } from "../src/recovery/RedisPostgresMatchRecoveryStore.js";

interface TestPayload {
  readonly serverTick: number;
  readonly canonicalHash: string;
  readonly journal: readonly { readonly order: number; readonly commandId: string }[];
}

interface RecoveryRow {
  match_id: string;
  metadata: unknown;
  revision: number;
  committed_at_ms: number | null;
  payload: unknown | null;
  terminal: unknown | null;
  owner_id: string | null;
  fence: number;
  lease_expires_at_ms: number | null;
}

const REDIS_KEY_PREFIX = "village-siege:match-recovery:";

describe("RedisPostgresMatchRecoveryStore isolated adapter contract", () => {
  it("acquires, commits, loads, renews, releases and reacquires with cloned durable data", async () => {
    const harness = createHarness(1_000);
    const first = await harness.store.acquire(metadata(), "server-a", 120_000);
    expect(first).toEqual({
      matchId: "match-production-01",
      ownerId: "server-a",
      fence: 1,
      expiresAtEpochMs: 121_000,
    });

    const source = payload(1);
    const committed = await harness.store.commit(first, metadata(), source);
    (source.journal[0] as { commandId: string }).commandId = "mutated-source";
    (committed.payload!.journal[0] as { commandId: string }).commandId = "mutated-return";
    const loaded = await harness.store.load(first.matchId);
    expect(loaded).toMatchObject({
      revision: 1,
      committedAtEpochMs: 1_000,
      payload: payload(1),
      lease: first,
      terminal: null,
    });

    harness.clock.now = 2_000;
    const renewed = await harness.store.renew(first, 120_000);
    expect(renewed).toEqual({ ...first, expiresAtEpochMs: 122_000 });
    expect((await harness.store.load(first.matchId))?.lease).toEqual(renewed);

    await harness.store.release(renewed);
    expect((await harness.store.load(first.matchId))?.lease).toBeNull();
    expect(await harness.redis.get(redisKey(first.matchId))).toBeNull();
    const second = await harness.store.acquire(metadata(), "server-b", 120_000);
    expect(second.fence).toBe(2);
    expect(second.ownerId).toBe("server-b");
  });

  it("persists a terminal result, retains the last payload and removes its Redis route", async () => {
    const harness = createHarness(5_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);
    await harness.store.commit(lease, metadata(), payload(5));
    harness.clock.now = 5_500;

    const terminal = await harness.store.markTerminal(lease, metadata(), {
      kind: "completed",
      code: "MATCH_ENDED",
      serverTick: 5,
    });
    expect(terminal).toMatchObject({
      revision: 2,
      payload: payload(5),
      lease: null,
      terminal: {
        kind: "completed",
        code: "MATCH_ENDED",
        serverTick: 5,
        recordedAtEpochMs: 5_500,
      },
    });
    expect(await harness.redis.get(redisKey(lease.matchId))).toBeNull();
    expect(await harness.store.load(lease.matchId)).toMatchObject({
      revision: 2,
      payload: payload(5),
      lease: null,
      terminal: { code: "MATCH_ENDED" },
    });
    await expectStoreError(harness.store.acquire(metadata(), "server-b", 120_000), "MATCH_TERMINAL");
  });

  it("rejects a stale Redis token before PostgreSQL can be mutated", async () => {
    const harness = createHarness(10_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);
    const connectsBefore = harness.postgres.connectCount;
    harness.redis.force(redisKey(lease.matchId), "server-b:99", 999_999);

    await expectStoreError(harness.store.commit(lease, metadata(), payload(10)), "STALE_FENCE");
    expect(harness.postgres.connectCount).toBe(connectsBefore);
    expect((await harness.store.load(lease.matchId))?.revision).toBe(0);
    await expectStoreError(harness.store.renew(lease, 120_000), "STALE_FENCE");
  });

  it("rejects stale PostgreSQL ownership even when Redis still presents the old token", async () => {
    const harness = createHarness(20_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);
    harness.postgres.mutateRow(lease.matchId, (row) => {
      row.owner_id = "server-b";
      row.fence = 2;
      row.lease_expires_at_ms = 200_000;
    });

    await expectStoreError(harness.store.commit(lease, metadata(), payload(20)), "STALE_FENCE");
    expect((await harness.store.load(lease.matchId))?.payload).toBeNull();
  });

  it("keeps the first owner through 119999 ms and raises the fence exactly at 120000 ms", async () => {
    const harness = createHarness(30_000);
    const first = await harness.store.acquire(metadata(), "server-a", 120_000);

    harness.clock.now += 119_999;
    await expectStoreError(harness.store.acquire(metadata(), "server-b", 120_000), "LEASE_HELD");
    harness.clock.now += 1;
    const second = await harness.store.acquire(metadata(), "server-b", 120_000);
    expect(second.fence).toBe(first.fence + 1);
    await expectStoreError(harness.store.commit(first, metadata(), payload(30)), "STALE_FENCE");
  });

  it("enforces the PostgreSQL expiry boundary even if a stale Redis route outlives it", async () => {
    const harness = createHarness(40_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);
    harness.clock.now = lease.expiresAtEpochMs - 1;
    await harness.store.commit(lease, metadata(), payload(39));

    harness.clock.now = lease.expiresAtEpochMs;
    harness.redis.force(redisKey(lease.matchId), `${lease.ownerId}:${lease.fence}`, lease.expiresAtEpochMs + 60_000);
    await expectStoreError(harness.store.commit(lease, metadata(), payload(40)), "LEASE_EXPIRED");
    expect((await harness.store.load(lease.matchId))?.payload).toEqual(payload(39));
  });

  it("rejects metadata drift atomically", async () => {
    const harness = createHarness(50_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);

    await expectStoreError(harness.store.commit(lease, {
      ...metadata(),
      rulesVersion: "village-siege/old",
    }, payload(50)), "METADATA_MISMATCH");
    expect(await harness.store.load(lease.matchId)).toMatchObject({ revision: 0, payload: null });
  });

  it.each([
    ["payload UPDATE", "SET REVISION = $4, COMMITTED_AT_MS"],
    ["transaction COMMIT", "COMMIT"],
  ])("rolls back and fails closed when %s fails", async (_label, failingSql) => {
    const harness = createHarness(60_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);
    await harness.store.commit(lease, metadata(), payload(60));
    harness.postgres.failNext(failingSql, new Error(`forced ${failingSql} failure`));

    await expect(harness.store.commit(lease, metadata(), payload(61))).rejects.toThrow(`forced ${failingSql} failure`);
    expect(await harness.store.load(lease.matchId)).toMatchObject({
      revision: 1,
      committedAtEpochMs: 60_000,
      payload: payload(60),
      lease,
    });
    expect(harness.postgres.rollbackCount).toBeGreaterThan(0);
  });

  it("does not create a durable row when the initial INSERT fails", async () => {
    const harness = createHarness(70_000);
    harness.postgres.failNext("INSERT INTO VILLAGE_SIEGE_MATCH_RECOVERY", new Error("insert unavailable"));

    await expect(harness.store.acquire(metadata(), "server-a", 120_000)).rejects.toThrow("insert unavailable");
    expect(await harness.store.load(metadata().matchId)).toBeNull();
    expect(harness.postgres.rollbackCount).toBe(1);

    const recovered = await harness.store.acquire(metadata(), "server-b", 120_000);
    expect(recovered.fence).toBe(1);
  });

  it("compensates the PostgreSQL owner when Redis lease publication fails", async () => {
    const harness = createHarness(80_000);
    harness.redis.failNext(new Error("redis publish unavailable"));

    await expect(harness.store.acquire(metadata(), "server-a", 120_000)).rejects.toThrow("redis publish unavailable");
    expect(await harness.store.load(metadata().matchId)).toMatchObject({ lease: null, revision: 0, payload: null });
    const recovered = await harness.store.acquire(metadata(), "server-b", 120_000);
    expect(recovered.fence).toBe(2);
  });

  it("restores the prior PostgreSQL expiry when Redis renewal fails", async () => {
    const harness = createHarness(90_000);
    const lease = await harness.store.acquire(metadata(), "server-a", 120_000);
    harness.clock.now += 5_000;
    harness.redis.failNext(new Error("redis renew unavailable"));

    await expect(harness.store.renew(lease, 120_000)).rejects.toThrow("redis renew unavailable");
    expect((await harness.store.load(lease.matchId))?.lease).toEqual(lease);
  });
});

function createHarness(initialNow: number): {
  readonly clock: { now: number };
  readonly postgres: FakePool;
  readonly redis: FakeRedis;
  readonly store: RedisPostgresMatchRecoveryStore<TestPayload>;
} {
  const clock = { now: initialNow };
  const postgres = new FakePool();
  const redis = new FakeRedis(() => clock.now);
  const store = new RedisPostgresMatchRecoveryStore<TestPayload>(
    postgres as unknown as Pool,
    redis,
    () => clock.now,
  );
  return { clock, postgres, redis, store };
}

function metadata(matchId = "match-production-01"): MatchRecoveryMetadata {
  return {
    schemaVersion: 1,
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    matchId,
  };
}

function payload(serverTick: number): TestPayload {
  return {
    serverTick,
    canonicalHash: `hash_${serverTick}`,
    journal: [{ order: serverTick, commandId: `command_${serverTick.toString().padStart(8, "0")}` }],
  };
}

async function expectStoreError(promise: Promise<unknown>, code: MatchRecoveryStoreErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "MatchRecoveryStoreError",
    code,
  } satisfies Partial<MatchRecoveryStoreError>);
}

function redisKey(matchId: string): string {
  return `${REDIS_KEY_PREFIX}${matchId}`;
}

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAtEpochMs: number }>();
  private failure?: Error;

  constructor(private readonly now: () => number) {}

  async get(key: string): Promise<string | null> {
    const stored = this.values.get(key);
    if (!stored) return null;
    if (this.now() >= stored.expiresAtEpochMs) {
      this.values.delete(key);
      return null;
    }
    return stored.value;
  }

  async set(key: string, value: string, options: { readonly PX: number }): Promise<string> {
    this.maybeFail();
    this.values.set(key, { value, expiresAtEpochMs: this.now() + options.PX });
    return "OK";
  }

  async eval(
    script: string,
    options: { readonly keys: readonly string[]; readonly arguments: readonly string[] },
  ): Promise<number> {
    this.maybeFail();
    const key = options.keys[0]!;
    const expected = options.arguments[0]!;
    if (await this.get(key) !== expected) return 0;
    if (script.includes("PEXPIRE")) {
      const ttl = Number(options.arguments[1]);
      this.values.set(key, { value: expected, expiresAtEpochMs: this.now() + ttl });
      return 1;
    }
    if (script.includes("DEL")) {
      this.values.delete(key);
      return 1;
    }
    throw new Error(`Unsupported fake Redis script: ${script}`);
  }

  async connect(): Promise<void> {}

  async quit(): Promise<void> {}

  force(key: string, value: string, expiresAtEpochMs: number): void {
    this.values.set(key, { value, expiresAtEpochMs });
  }

  failNext(error: Error): void {
    this.failure = error;
  }

  private maybeFail(): void {
    if (!this.failure) return;
    const error = this.failure;
    this.failure = undefined;
    throw error;
  }
}

class FakePool {
  readonly rows = new Map<string, RecoveryRow>();
  connectCount = 0;
  rollbackCount = 0;
  private failure?: { needle: string; error: Error };

  async query<T extends RecoveryRow = RecoveryRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    const normalized = normalizeSql(sql);
    this.maybeFail(normalized);
    if (normalized.startsWith("CREATE TABLE")) return { rows: [] };
    if (normalized.startsWith("SELECT * FROM") && !normalized.includes("FOR UPDATE")) {
      const row = this.rows.get(String(values?.[0]));
      return { rows: row ? [cloneRow(row) as T] : [] };
    }
    throw new Error(`Unsupported fake pool SQL: ${normalized}`);
  }

  async connect(): Promise<PoolClient> {
    this.connectCount += 1;
    return new FakePoolClient(this) as unknown as PoolClient;
  }

  async end(): Promise<void> {}

  failNext(sqlNeedle: string, error: Error): void {
    this.failure = { needle: normalizeSql(sqlNeedle), error };
  }

  mutateRow(matchId: string, mutation: (row: RecoveryRow) => void): void {
    const row = this.rows.get(matchId);
    if (!row) throw new Error(`Missing fake row ${matchId}`);
    mutation(row);
  }

  consumeFailure(normalizedSql: string): Error | undefined {
    if (!this.failure || !normalizedSql.includes(this.failure.needle)) return undefined;
    const { error } = this.failure;
    this.failure = undefined;
    return error;
  }

  replaceRows(rows: Map<string, RecoveryRow>): void {
    this.rows.clear();
    for (const [matchId, row] of rows) this.rows.set(matchId, cloneRow(row));
  }

  private maybeFail(normalizedSql: string): void {
    const failure = this.consumeFailure(normalizedSql);
    if (failure) throw failure;
  }
}

class FakePoolClient {
  private transactionRows?: Map<string, RecoveryRow>;

  constructor(private readonly pool: FakePool) {}

  async query<T extends RecoveryRow = RecoveryRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    const normalized = normalizeSql(sql);
    const forced = this.pool.consumeFailure(normalized);
    if (forced) throw forced;
    if (normalized === "BEGIN") {
      this.transactionRows = cloneRows(this.pool.rows);
      return { rows: [] };
    }
    if (normalized === "COMMIT") {
      if (!this.transactionRows) throw new Error("Fake COMMIT without BEGIN");
      this.pool.replaceRows(this.transactionRows);
      this.transactionRows = undefined;
      return { rows: [] };
    }
    if (normalized === "ROLLBACK") {
      this.pool.rollbackCount += 1;
      this.transactionRows = undefined;
      return { rows: [] };
    }
    const rows = this.requireTransaction();
    const matchId = String(values?.[0]);
    if (normalized.startsWith("SELECT * FROM") && normalized.includes("FOR UPDATE")) {
      const row = rows.get(matchId);
      return { rows: row ? [cloneRow(row) as T] : [] };
    }
    if (normalized.startsWith("INSERT INTO VILLAGE_SIEGE_MATCH_RECOVERY")) {
      rows.set(matchId, {
        match_id: matchId,
        metadata: JSON.parse(String(values?.[1])),
        revision: 0,
        committed_at_ms: null,
        payload: null,
        terminal: null,
        owner_id: String(values?.[2]),
        fence: Number(values?.[3]),
        lease_expires_at_ms: Number(values?.[4]),
      });
      return { rows: [] };
    }
    const row = rows.get(matchId);
    if (!row) throw new Error(`Fake UPDATE missing row ${matchId}`);
    if (normalized.includes("SET OWNER_ID = $2, FENCE = $3")) {
      row.owner_id = String(values?.[1]);
      row.fence = Number(values?.[2]);
      row.lease_expires_at_ms = Number(values?.[3]);
      return { rows: [] };
    }
    if (normalized.includes("SET LEASE_EXPIRES_AT_MS = $4")) {
      row.lease_expires_at_ms = Number(values?.[3]);
      return { rows: [] };
    }
    if (normalized.includes("SET REVISION = $4, COMMITTED_AT_MS")) {
      row.revision = Number(values?.[3]);
      row.committed_at_ms = Number(values?.[4]);
      row.payload = JSON.parse(String(values?.[5]));
      return { rows: [] };
    }
    if (normalized.includes("SET REVISION = $4, TERMINAL")) {
      row.revision = Number(values?.[3]);
      row.terminal = JSON.parse(String(values?.[4]));
      row.owner_id = null;
      row.lease_expires_at_ms = null;
      return { rows: [] };
    }
    if (normalized.includes("SET OWNER_ID = NULL, LEASE_EXPIRES_AT_MS = NULL")) {
      row.owner_id = null;
      row.lease_expires_at_ms = null;
      return { rows: [] };
    }
    throw new Error(`Unsupported fake client SQL: ${normalized}`);
  }

  release(): void {}

  private requireTransaction(): Map<string, RecoveryRow> {
    if (!this.transactionRows) throw new Error("Fake SQL mutation outside a transaction");
    return this.transactionRows;
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toUpperCase();
}

function cloneRows(rows: Map<string, RecoveryRow>): Map<string, RecoveryRow> {
  return new Map([...rows].map(([matchId, row]) => [matchId, cloneRow(row)]));
}

function cloneRow(row: RecoveryRow): RecoveryRow {
  return JSON.parse(JSON.stringify(row)) as RecoveryRow;
}
