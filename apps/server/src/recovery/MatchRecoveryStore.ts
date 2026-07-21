export const MATCH_RECOVERY_MAX_LEASE_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;

export interface MatchRecoveryMetadata {
  readonly schemaVersion: number;
  readonly protocolVersion: string;
  readonly rulesVersion: string;
  readonly matchId: string;
}

export interface MatchRecoveryLease {
  readonly matchId: string;
  readonly ownerId: string;
  readonly fence: number;
  readonly expiresAtEpochMs: number;
}

export interface MatchRecoveryTerminalOutcome {
  readonly kind: "completed" | "failed";
  readonly code: string;
  readonly serverTick: number;
}

export interface StoredMatchRecoveryTerminalOutcome extends MatchRecoveryTerminalOutcome {
  readonly recordedAtEpochMs: number;
}

export interface MatchRecoveryRecord<TPayload = unknown> {
  readonly metadata: MatchRecoveryMetadata;
  readonly revision: number;
  readonly committedAtEpochMs: number | null;
  readonly payload: TPayload | null;
  readonly terminal: StoredMatchRecoveryTerminalOutcome | null;
  readonly lease: MatchRecoveryLease | null;
}

export type MatchRecoveryStoreErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "LEASE_HELD"
  | "LEASE_EXPIRED"
  | "STALE_FENCE"
  | "METADATA_MISMATCH"
  | "MATCH_TERMINAL"
  | "CORRUPT_RECORD";

export class MatchRecoveryStoreError extends Error {
  readonly code: MatchRecoveryStoreErrorCode;

  constructor(code: MatchRecoveryStoreErrorCode, message: string) {
    super(message);
    this.name = "MatchRecoveryStoreError";
    this.code = code;
  }
}

export interface MatchRecoveryStore<TPayload = unknown> {
  load(matchId: string): Promise<MatchRecoveryRecord<TPayload> | null>;
  acquire(metadata: MatchRecoveryMetadata, ownerId: string, ttlMilliseconds: number): Promise<MatchRecoveryLease>;
  renew(lease: MatchRecoveryLease, ttlMilliseconds: number): Promise<MatchRecoveryLease>;
  commit(
    lease: MatchRecoveryLease,
    metadata: MatchRecoveryMetadata,
    payload: TPayload,
  ): Promise<MatchRecoveryRecord<TPayload>>;
  markTerminal(
    lease: MatchRecoveryLease,
    metadata: MatchRecoveryMetadata,
    outcome: MatchRecoveryTerminalOutcome,
  ): Promise<MatchRecoveryRecord<TPayload>>;
  release(lease: MatchRecoveryLease): Promise<void>;
}

interface InternalRecoveryRecord<TPayload> extends MatchRecoveryRecord<TPayload> {
  readonly lastFence: number;
}

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_VERSION_LENGTH = 128;
const MAX_TERMINAL_CODE_LENGTH = 64;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const MAX_JSON_STRING_LENGTH = 256 * 1_024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const TERMINAL_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Deterministic in-process implementation of the durable recovery contract.
 * Production adapters may replace its Map with Redis/PostgreSQL, but must keep
 * the same owner/fence/expiry checks on every mutation.
 */
export class MemoryMatchRecoveryStore<TPayload = unknown> implements MatchRecoveryStore<TPayload> {
  private readonly records = new Map<string, InternalRecoveryRecord<TPayload>>();

  constructor(private readonly now: () => number = Date.now) {}

  async load(matchId: string): Promise<MatchRecoveryRecord<TPayload> | null> {
    assertMatchId(matchId);
    const record = this.records.get(matchId);
    if (!record) return null;
    this.assertStoredRecord(record, matchId);
    return clonePublicRecord(record);
  }

  async acquire(
    metadata: MatchRecoveryMetadata,
    ownerId: string,
    ttlMilliseconds: number,
  ): Promise<MatchRecoveryLease> {
    const acceptedMetadata = cloneAndValidateMetadata(metadata);
    assertOwnerId(ownerId);
    const now = this.currentTime();
    const expiresAtEpochMs = leaseExpiry(now, ttlMilliseconds);
    const existing = this.records.get(acceptedMetadata.matchId);

    if (!existing) {
      const lease = { matchId: acceptedMetadata.matchId, ownerId, fence: 1, expiresAtEpochMs };
      this.records.set(acceptedMetadata.matchId, {
        metadata: acceptedMetadata,
        revision: 0,
        committedAtEpochMs: null,
        payload: null,
        terminal: null,
        lease,
        lastFence: 1,
      });
      return { ...lease };
    }

    this.assertStoredRecord(existing, acceptedMetadata.matchId);
    assertSameMetadata(existing.metadata, acceptedMetadata);
    if (existing.terminal) fail("MATCH_TERMINAL", `Match ${acceptedMetadata.matchId} is terminal`);
    if (existing.lease && now < existing.lease.expiresAtEpochMs) {
      fail("LEASE_HELD", `Match ${acceptedMetadata.matchId} already has an active recovery lease`);
    }

    const fence = existing.lastFence + 1;
    if (!Number.isSafeInteger(fence)) fail("CORRUPT_RECORD", "Recovery lease fence overflowed");
    const lease = { matchId: acceptedMetadata.matchId, ownerId, fence, expiresAtEpochMs };
    this.records.set(acceptedMetadata.matchId, { ...existing, lease, lastFence: fence });
    return { ...lease };
  }

  async renew(lease: MatchRecoveryLease, ttlMilliseconds: number): Promise<MatchRecoveryLease> {
    const acceptedLease = cloneAndValidateLease(lease);
    const now = this.currentTime();
    const record = this.requireOwnedActiveRecord(acceptedLease, now);
    const renewed = {
      matchId: acceptedLease.matchId,
      ownerId: acceptedLease.ownerId,
      fence: acceptedLease.fence,
      expiresAtEpochMs: leaseExpiry(now, ttlMilliseconds),
    };
    this.records.set(acceptedLease.matchId, { ...record, lease: renewed });
    return { ...renewed };
  }

  async commit(
    lease: MatchRecoveryLease,
    metadata: MatchRecoveryMetadata,
    payload: TPayload,
  ): Promise<MatchRecoveryRecord<TPayload>> {
    const acceptedLease = cloneAndValidateLease(lease);
    const acceptedMetadata = cloneAndValidateMetadata(metadata);
    const acceptedPayload = cloneJsonPayload(payload, "recovery payload");
    const now = this.currentTime();
    const record = this.requireOwnedActiveRecord(acceptedLease, now);
    assertSameMetadata(record.metadata, acceptedMetadata);
    const next: InternalRecoveryRecord<TPayload> = {
      ...record,
      revision: incrementRevision(record.revision),
      committedAtEpochMs: now,
      payload: acceptedPayload,
    };
    this.records.set(acceptedLease.matchId, next);
    return clonePublicRecord(next);
  }

  async markTerminal(
    lease: MatchRecoveryLease,
    metadata: MatchRecoveryMetadata,
    outcome: MatchRecoveryTerminalOutcome,
  ): Promise<MatchRecoveryRecord<TPayload>> {
    const acceptedLease = cloneAndValidateLease(lease);
    const acceptedMetadata = cloneAndValidateMetadata(metadata);
    const acceptedOutcome = cloneAndValidateTerminalOutcome(outcome);
    const now = this.currentTime();
    const record = this.requireOwnedActiveRecord(acceptedLease, now);
    assertSameMetadata(record.metadata, acceptedMetadata);
    const next: InternalRecoveryRecord<TPayload> = {
      ...record,
      revision: incrementRevision(record.revision),
      terminal: { ...acceptedOutcome, recordedAtEpochMs: now },
      lease: null,
    };
    this.records.set(acceptedLease.matchId, next);
    return clonePublicRecord(next);
  }

  async release(lease: MatchRecoveryLease): Promise<void> {
    const acceptedLease = cloneAndValidateLease(lease);
    const now = this.currentTime();
    const record = this.requireOwnedActiveRecord(acceptedLease, now);
    this.records.set(acceptedLease.matchId, { ...record, lease: null });
  }

  private currentTime(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("INVALID_INPUT", "Recovery clock must return a non-negative safe epoch millisecond value");
    }
    return value;
  }

  private requireOwnedActiveRecord(
    lease: MatchRecoveryLease,
    now: number,
  ): InternalRecoveryRecord<TPayload> {
    const record = this.records.get(lease.matchId);
    if (!record) fail("NOT_FOUND", `Unknown recovery match: ${lease.matchId}`);
    this.assertStoredRecord(record, lease.matchId);
    if (record.terminal) fail("MATCH_TERMINAL", `Match ${lease.matchId} is terminal`);
    if (!record.lease
      || record.lease.ownerId !== lease.ownerId
      || record.lease.fence !== lease.fence) {
      fail("STALE_FENCE", `Recovery lease is stale for match ${lease.matchId}`);
    }
    if (now >= record.lease.expiresAtEpochMs) {
      fail("LEASE_EXPIRED", `Recovery lease expired for match ${lease.matchId}`);
    }
    return record;
  }

  private assertStoredRecord(record: unknown, matchId: string): asserts record is InternalRecoveryRecord<TPayload> {
    try {
      if (!isPlainRecord(record)) throw new Error("record is not an object");
      assertExactKeys(record, [
        "metadata", "revision", "committedAtEpochMs", "payload", "terminal", "lease", "lastFence",
      ]);
      const metadata = cloneAndValidateMetadata(record.metadata);
      if (metadata.matchId !== matchId) throw new Error("record key differs from metadata matchId");
      if (!isNonNegativeSafeInteger(record.revision)) throw new Error("revision is invalid");
      if (!(record.committedAtEpochMs === null || isNonNegativeSafeInteger(record.committedAtEpochMs))) {
        throw new Error("commit timestamp is invalid");
      }
      if (!isNonNegativeSafeInteger(record.lastFence)) throw new Error("lastFence is invalid");
      if (record.payload !== null) cloneJsonPayload(record.payload, "stored recovery payload");
      const terminal = record.terminal === null ? null : cloneAndValidateStoredTerminal(record.terminal);
      const lease = record.lease === null ? null : cloneAndValidateLease(record.lease);
      if (lease && lease.matchId !== matchId) throw new Error("lease matchId differs from its record");
      if (lease && lease.fence !== record.lastFence) throw new Error("active lease does not own the latest fence");
      if (terminal && lease) throw new Error("terminal records cannot retain an active lease");
    } catch (error) {
      if (error instanceof MatchRecoveryStoreError && error.code === "CORRUPT_RECORD") throw error;
      const detail = error instanceof Error ? error.message : "unknown corruption";
      fail("CORRUPT_RECORD", `Stored recovery record for ${matchId} is corrupt: ${detail}`);
    }
  }
}

function clonePublicRecord<TPayload>(record: InternalRecoveryRecord<TPayload>): MatchRecoveryRecord<TPayload> {
  return {
    metadata: { ...record.metadata },
    revision: record.revision,
    committedAtEpochMs: record.committedAtEpochMs,
    payload: record.payload === null ? null : cloneJsonPayload(record.payload, "stored recovery payload"),
    terminal: record.terminal ? { ...record.terminal } : null,
    lease: record.lease ? { ...record.lease } : null,
  };
}

function cloneAndValidateMetadata(value: unknown): MatchRecoveryMetadata {
  if (!isPlainRecord(value)) fail("INVALID_INPUT", "Recovery metadata must be a plain object");
  assertInputExactKeys(value, ["schemaVersion", "protocolVersion", "rulesVersion", "matchId"], "recovery metadata");
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    fail("INVALID_INPUT", "Recovery schemaVersion must be a positive safe integer");
  }
  if (!isVersion(value.protocolVersion)) fail("INVALID_INPUT", "Recovery protocolVersion is invalid");
  if (!isVersion(value.rulesVersion)) fail("INVALID_INPUT", "Recovery rulesVersion is invalid");
  assertMatchId(value.matchId);
  return {
    schemaVersion: value.schemaVersion as number,
    protocolVersion: value.protocolVersion as string,
    rulesVersion: value.rulesVersion as string,
    matchId: value.matchId as string,
  };
}

function cloneAndValidateLease(value: unknown): MatchRecoveryLease {
  if (!isPlainRecord(value)) fail("INVALID_INPUT", "Recovery lease must be a plain object");
  assertInputExactKeys(value, ["matchId", "ownerId", "fence", "expiresAtEpochMs"], "recovery lease");
  assertMatchId(value.matchId);
  assertOwnerId(value.ownerId);
  if (!Number.isSafeInteger(value.fence) || (value.fence as number) < 1) {
    fail("INVALID_INPUT", "Recovery fence must be a positive safe integer");
  }
  if (!isNonNegativeSafeInteger(value.expiresAtEpochMs)) {
    fail("INVALID_INPUT", "Recovery lease expiry must be a non-negative safe epoch millisecond value");
  }
  return {
    matchId: value.matchId as string,
    ownerId: value.ownerId as string,
    fence: value.fence as number,
    expiresAtEpochMs: value.expiresAtEpochMs as number,
  };
}

function cloneAndValidateTerminalOutcome(value: unknown): MatchRecoveryTerminalOutcome {
  if (!isPlainRecord(value)) fail("INVALID_INPUT", "Recovery terminal outcome must be a plain object");
  assertInputExactKeys(value, ["kind", "code", "serverTick"], "recovery terminal outcome");
  if (value.kind !== "completed" && value.kind !== "failed") {
    fail("INVALID_INPUT", "Recovery terminal kind must be completed or failed");
  }
  if (typeof value.code !== "string"
    || value.code.length > MAX_TERMINAL_CODE_LENGTH
    || !TERMINAL_CODE_PATTERN.test(value.code)) {
    fail("INVALID_INPUT", "Recovery terminal code is invalid");
  }
  if (!isNonNegativeSafeInteger(value.serverTick)) {
    fail("INVALID_INPUT", "Recovery terminal serverTick must be a non-negative safe integer");
  }
  return { kind: value.kind, code: value.code, serverTick: value.serverTick as number };
}

function cloneAndValidateStoredTerminal(value: unknown): StoredMatchRecoveryTerminalOutcome {
  if (!isPlainRecord(value)) fail("INVALID_INPUT", "Stored recovery terminal outcome must be a plain object");
  assertInputExactKeys(value, ["kind", "code", "serverTick", "recordedAtEpochMs"], "stored recovery terminal outcome");
  const outcome = cloneAndValidateTerminalOutcome({
    kind: value.kind,
    code: value.code,
    serverTick: value.serverTick,
  });
  if (!isNonNegativeSafeInteger(value.recordedAtEpochMs)) {
    fail("INVALID_INPUT", "Stored recovery terminal timestamp is invalid");
  }
  return { ...outcome, recordedAtEpochMs: value.recordedAtEpochMs as number };
}

function assertSameMetadata(expected: MatchRecoveryMetadata, actual: MatchRecoveryMetadata): void {
  if (expected.schemaVersion !== actual.schemaVersion
    || expected.protocolVersion !== actual.protocolVersion
    || expected.rulesVersion !== actual.rulesVersion
    || expected.matchId !== actual.matchId) {
    fail("METADATA_MISMATCH", `Recovery metadata does not match ${expected.matchId}`);
  }
}

function leaseExpiry(now: number, ttlMilliseconds: number): number {
  if (!Number.isSafeInteger(ttlMilliseconds)
    || ttlMilliseconds <= 0
    || ttlMilliseconds > MATCH_RECOVERY_MAX_LEASE_TTL_MILLISECONDS) {
    fail("INVALID_INPUT", `Recovery lease TTL must be within 1..${MATCH_RECOVERY_MAX_LEASE_TTL_MILLISECONDS} ms`);
  }
  const expiry = now + ttlMilliseconds;
  if (!Number.isSafeInteger(expiry)) fail("INVALID_INPUT", "Recovery lease expiry exceeds safe epoch range");
  return expiry;
}

function incrementRevision(revision: number): number {
  const next = revision + 1;
  if (!Number.isSafeInteger(next)) fail("CORRUPT_RECORD", "Recovery record revision overflowed");
  return next;
}

function assertMatchId(value: unknown): asserts value is string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > MAX_IDENTIFIER_LENGTH
    || !MATCH_ID_PATTERN.test(value)) {
    fail("INVALID_INPUT", "Recovery matchId is invalid");
  }
}

function assertOwnerId(value: unknown): asserts value is string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > MAX_IDENTIFIER_LENGTH
    || !IDENTIFIER_PATTERN.test(value)) {
    fail("INVALID_INPUT", "Recovery ownerId is invalid");
  }
}

function isVersion(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_VERSION_LENGTH
    && VERSION_PATTERN.test(value);
}

function cloneJsonPayload<T>(value: T, label: string): T {
  const seen = new Set<object>();
  const budget = { nodes: 0 };
  return cloneJsonValue(value, label, 0, seen, budget) as T;
}

function cloneJsonValue(
  value: unknown,
  label: string,
  depth: number,
  seen: Set<object>,
  budget: { nodes: number },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) fail("INVALID_INPUT", `${label} exceeds the JSON node limit`);
  if (depth > MAX_JSON_DEPTH) fail("INVALID_INPUT", `${label} exceeds the JSON depth limit`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH) fail("INVALID_INPUT", `${label} contains an oversized string`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_INPUT", `${label} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") fail("INVALID_INPUT", `${label} must contain JSON-safe values only`);
  if (seen.has(value)) fail("INVALID_INPUT", `${label} contains a cyclic reference`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const clone = value.map((entry) => cloneJsonValue(entry, label, depth + 1, seen, budget));
      return clone;
    }
    if (!isPlainRecord(value)) fail("INVALID_INPUT", `${label} contains a non-plain object`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      fail("INVALID_INPUT", `${label} contains a symbol key`);
    }
    const clone: Record<string, unknown> = {};
    for (const key of ownKeys as string[]) {
      if (FORBIDDEN_JSON_KEYS.has(key)) fail("INVALID_INPUT", `${label} contains a forbidden key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        fail("INVALID_INPUT", `${label} contains an accessor or non-enumerable property`);
      }
      clone[key] = cloneJsonValue(descriptor.value, label, depth + 1, seen, budget);
    }
    return clone;
  } finally {
    seen.delete(value);
  }
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error("record keys are invalid");
  }
}

function assertInputExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  try {
    assertExactKeys(record, expected);
  } catch {
    fail("INVALID_INPUT", `${label} contains missing or unexpected fields`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function fail(code: MatchRecoveryStoreErrorCode, message: string): never {
  throw new MatchRecoveryStoreError(code, message);
}
