import { describe, expect, it } from "vitest";
import { MATCH_PROTOCOL_VERSION, RULES_VERSION } from "@village-siege/shared";
import {
  MATCH_RECOVERY_MAX_LEASE_TTL_MILLISECONDS,
  MatchRecoveryStoreError,
  MemoryMatchRecoveryStore,
  type MatchRecoveryMetadata,
  type MatchRecoveryStoreErrorCode,
} from "../src/recovery/MatchRecoveryStore.js";

interface RecoveryPayload {
  checkpoint: {
    serverTick: number;
    canonicalHash: string;
    wallet: { food: number; wood: number; stone: number };
  };
  journal: Array<{ order: number; commandId: string }>;
}

function metadata(matchId = "match-recovery-01"): MatchRecoveryMetadata {
  return {
    schemaVersion: 1,
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    matchId,
  };
}

async function expectStoreError(promise: Promise<unknown>, code: MatchRecoveryStoreErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "MatchRecoveryStoreError",
    code,
  } satisfies Partial<MatchRecoveryStoreError>);
}

describe("MemoryMatchRecoveryStore fencing and durable-record contract", () => {
  it("treats 119999 ms as leased and exactly 120000 ms as expired", async () => {
    let now = 1_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const first = await store.acquire(metadata(), "server-a", 120_000);

    expect(first).toEqual({
      matchId: "match-recovery-01",
      ownerId: "server-a",
      fence: 1,
      expiresAtEpochMs: 121_000,
    });
    now += 119_999;
    await expectStoreError(store.acquire(metadata(), "server-b", 120_000), "LEASE_HELD");

    now += 1;
    const second = await store.acquire(metadata(), "server-b", 120_000);
    expect(second.fence).toBe(2);
    expect(second.expiresAtEpochMs).toBe(241_000);
    await expectStoreError(store.renew(first, 120_000), "STALE_FENCE");
    await expectStoreError(store.commit(first, metadata(), payload(1)), "STALE_FENCE");
  });

  it("rejects renew, commit and release at the exact authoritative expiry boundary", async () => {
    let now = 5_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const lease = await store.acquire(metadata(), "server-a", 120_000);

    now = lease.expiresAtEpochMs;
    await expectStoreError(store.renew(lease, 120_000), "LEASE_EXPIRED");
    await expectStoreError(store.commit(lease, metadata(), payload(2)), "LEASE_EXPIRED");
    await expectStoreError(store.release(lease), "LEASE_EXPIRED");
  });

  it("renews only the current owner and preserves its fence", async () => {
    let now = 10_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const original = await store.acquire(metadata(), "server-a", 120_000);
    now += 30_000;

    const renewed = await store.renew(original, 120_000);
    expect(renewed).toEqual({ ...original, expiresAtEpochMs: 160_000 });
    await expectStoreError(store.renew({ ...original, ownerId: "server-b" }, 120_000), "STALE_FENCE");
    expect((await store.load(original.matchId))?.lease).toEqual(renewed);
  });

  it("increments the fence after an authorized release and rejects the released owner", async () => {
    let now = 20_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const first = await store.acquire(metadata(), "server-a", 120_000);
    await store.release(first);

    const second = await store.acquire(metadata(), "server-b", 120_000);
    expect(second.fence).toBe(first.fence + 1);
    await expectStoreError(store.commit(first, metadata(), payload(3)), "STALE_FENCE");
  });

  it("deep-clones commits and every load result", async () => {
    let now = 30_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const lease = await store.acquire(metadata(), "server-a", 120_000);
    const source = payload(7);
    const committed = await store.commit(lease, metadata(), source);

    source.checkpoint.wallet.food = 0;
    source.journal[0]!.commandId = "mutated-source";
    (committed.payload as RecoveryPayload).checkpoint.wallet.wood = 0;
    (committed.metadata as { matchId: string }).matchId = "mutated-return";
    (committed.lease as { ownerId: string }).ownerId = "mutated-return";

    const firstLoad = await store.load("match-recovery-01");
    expect(firstLoad).toMatchObject({
      revision: 1,
      committedAtEpochMs: now,
      metadata: { matchId: "match-recovery-01" },
      lease: { ownerId: "server-a", fence: 1 },
      payload: {
        checkpoint: { wallet: { food: 507, wood: 300, stone: 200 } },
        journal: [{ order: 7, commandId: "command_00000007" }],
      },
    });

    (firstLoad!.payload as RecoveryPayload).checkpoint.wallet.stone = 0;
    const secondLoad = await store.load("match-recovery-01");
    expect((secondLoad!.payload as RecoveryPayload).checkpoint.wallet.stone).toBe(200);
  });

  it("records an immutable terminal outcome and refuses every later owner mutation", async () => {
    let now = 40_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const lease = await store.acquire(metadata(), "server-a", 120_000);
    await store.commit(lease, metadata(), payload(9));
    now += 500;

    const terminal = await store.markTerminal(lease, metadata(), {
      kind: "failed",
      code: "RECOVERY_TIMEOUT",
      serverTick: 9,
    });
    expect(terminal).toMatchObject({
      revision: 2,
      lease: null,
      terminal: {
        kind: "failed",
        code: "RECOVERY_TIMEOUT",
        serverTick: 9,
        recordedAtEpochMs: 40_500,
      },
    });

    (terminal.terminal as { code: string }).code = "MUTATED";
    expect((await store.load(lease.matchId))?.terminal?.code).toBe("RECOVERY_TIMEOUT");
    await expectStoreError(store.acquire(metadata(), "server-b", 120_000), "MATCH_TERMINAL");
    await expectStoreError(store.commit(lease, metadata(), payload(10)), "MATCH_TERMINAL");
    await expectStoreError(store.release(lease), "MATCH_TERMINAL");
  });

  it("rejects mixed metadata without changing the last valid commit", async () => {
    let now = 50_000;
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => now);
    const lease = await store.acquire(metadata(), "server-a", 120_000);
    await store.commit(lease, metadata(), payload(11));

    await expectStoreError(store.commit(lease, {
      ...metadata(),
      rulesVersion: "village-siege/old",
    }, payload(12)), "METADATA_MISMATCH");
    expect((await store.load(lease.matchId))?.revision).toBe(1);
    expect((await store.load(lease.matchId))?.metadata.rulesVersion).toBe(RULES_VERSION);
  });

  it("strictly rejects invalid leases, metadata, clock values and JSON payloads", async () => {
    let now = 60_000;
    const store = new MemoryMatchRecoveryStore<unknown>(() => now);

    await expectStoreError(store.acquire({ ...metadata(), schemaVersion: 0 }, "server-a", 120_000), "INVALID_INPUT");
    await expectStoreError(store.acquire({ ...metadata(), matchId: "../escape" }, "server-a", 120_000), "INVALID_INPUT");
    await expectStoreError(store.acquire(metadata(), "bad owner", 120_000), "INVALID_INPUT");
    await expectStoreError(store.acquire(metadata(), "server-a", 0), "INVALID_INPUT");
    await expectStoreError(
      store.acquire(metadata(), "server-a", MATCH_RECOVERY_MAX_LEASE_TTL_MILLISECONDS + 1),
      "INVALID_INPUT",
    );

    const lease = await store.acquire(metadata(), "server-a", 120_000);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expectStoreError(store.commit(lease, metadata(), cyclic), "INVALID_INPUT");
    await expectStoreError(store.commit(lease, metadata(), { value: Number.NaN }), "INVALID_INPUT");
    await expectStoreError(store.commit(lease, metadata(), { constructor: "pollution" }), "INVALID_INPUT");
    await expectStoreError(store.commit(lease, metadata(), new Date()), "INVALID_INPUT");
    await expectStoreError(store.markTerminal(lease, metadata(), {
      kind: "failed",
      code: "invalid-code",
      serverTick: 0,
    }), "INVALID_INPUT");

    now = Number.NaN;
    await expectStoreError(store.load(lease.matchId).then(async () => store.renew(lease, 1)), "INVALID_INPUT");
  });

  it("detects corrupted internal records instead of returning partial recovery data", async () => {
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => 70_000);
    const internals = store as unknown as { records: Map<string, unknown> };
    internals.records.set("match-corrupt", {
      metadata: metadata("match-corrupt"),
      revision: -1,
    });

    await expectStoreError(store.load("match-corrupt"), "CORRUPT_RECORD");
  });

  it("returns null for a valid unknown match and typed NOT_FOUND for forged mutation leases", async () => {
    const store = new MemoryMatchRecoveryStore<RecoveryPayload>(() => 80_000);
    expect(await store.load("match-unknown")).toBeNull();
    await expectStoreError(store.commit({
      matchId: "match-unknown",
      ownerId: "server-a",
      fence: 1,
      expiresAtEpochMs: 200_000,
    }, metadata("match-unknown"), payload(1)), "NOT_FOUND");
  });
});

function payload(serverTick: number): RecoveryPayload {
  return {
    checkpoint: {
      serverTick,
      canonicalHash: `hash_${serverTick}`,
      wallet: { food: 500 + serverTick, wood: 300, stone: 200 },
    },
    journal: [{ order: serverTick, commandId: `command_${serverTick.toString().padStart(8, "0")}` }],
  };
}
