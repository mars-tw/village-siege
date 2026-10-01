import { describe, expect, it } from "vitest";
import { createAutoSaveStore, type AutoSaveAdapter, type AutoSaveSlots } from "../src/game/autoSave";
import { createVillageAssaultRuntime } from "../src/game/villageAssaultRuntime";

const options = { playerVillageId: "pinehold", aiPersonality: "balanced", aiDifficulty: "novice" } as const;
function archive(seed: number, milliseconds = 0): string {
  const runtime = createVillageAssaultRuntime({ ...options, seed });
  if (milliseconds) runtime.step(milliseconds);
  return runtime.exportSaveJson();
}
function memoryAdapter() {
  let slots: AutoSaveSlots = { latest: null, previous: null };
  let failCommit = false;
  const adapter: AutoSaveAdapter = {
    async load() { return structuredClone(slots); },
    async commit(next) {
      if (failCommit) throw new Error("Quota exceeded");
      slots = structuredClone(next);
    },
  };
  return { adapter, slots: () => slots, failCommit: () => { failCommit = true; }, replace: (next: AutoSaveSlots) => { slots = next; } };
}

describe("private browser autosaves", () => {
  it("keeps the previous match as a backup while updates to a new match retain that backup", async () => {
    const memory = memoryAdapter();
    const store = createAutoSaveStore(memory.adapter, () => 1234);
    const first = archive(10, 200);
    expect((await store.save(first)).ok).toBe(true);
    expect((await store.save(archive(20, 200))).ok).toBe(true);
    expect((await store.save(archive(20, 400))).ok).toBe(true);
    const read = await store.read();
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.latest).toMatchObject({ seed: 20, tick: 4, savedAt: 1234, finished: false });
    expect(read.previous).toMatchObject({ seed: 10, tick: 2 });
    const restored = createVillageAssaultRuntime({ ...options, seed: 999 });
    restored.importSaveJson(read.previous!.saveJson);
    expect(restored.exportSaveJson()).toBe(first);
  });

  it("does not overwrite a valid snapshot with corrupt input or a failed storage transaction", async () => {
    const memory = memoryAdapter();
    const store = createAutoSaveStore(memory.adapter);
    await store.save(archive(30, 500));
    const before = structuredClone(memory.slots());
    expect((await store.save('{"kind":"match-save"}')).ok).toBe(false);
    expect(memory.slots()).toEqual(before);
    memory.failCommit();
    const failure = await store.save(archive(40, 600));
    expect(failure).toMatchObject({ ok: false });
    expect(memory.slots()).toEqual(before);
    expect((await store.read()).ok).toBe(true);
  });

  it("serializes simultaneous writes and refuses a late older snapshot from the same match", async () => {
    const memory = memoryAdapter();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = memory.adapter.commit;
    let commits = 0;
    memory.adapter.commit = async slots => { commits += 1; if (commits === 1) await gate; await original(slots); };
    const store = createAutoSaveStore(memory.adapter);
    const newer = store.save(archive(50, 800));
    const lateOlder = store.save(archive(50, 300));
    release();
    expect((await newer).ok).toBe(true);
    expect((await lateOlder).ok).toBe(false);
    expect(memory.slots().latest).toMatchObject({ seed: 50, tick: 8 });
    expect(commits).toBe(1);
  });

  it("offers a validated backup when the latest stored bytes are corrupt", async () => {
    const memory = memoryAdapter();
    const store = createAutoSaveStore(memory.adapter);
    await store.save(archive(60, 200));
    await store.save(archive(70, 400));
    memory.replace({ ...memory.slots(), latest: { ...memory.slots().latest!, saveJson: "corrupt" } });
    const result = await store.read();
    expect(result).toMatchObject({ ok: true, latest: { seed: 60 }, previous: null });
    if (result.ok) expect(result.warning).toContain("備份");
    const before = structuredClone(memory.slots());
    expect((await store.save(archive(60, 100))).ok).toBe(false);
    expect(memory.slots()).toEqual(before);
    expect((await store.save(archive(60, 500))).ok).toBe(true);
    expect(await store.read()).toMatchObject({ ok: true, latest: { seed: 60, tick: 5 }, previous: null });
    expect((await store.save(archive(90, 700))).ok).toBe(true);
    expect(await store.read()).toMatchObject({ ok: true, latest: { seed: 90, tick: 7 }, previous: { seed: 60, tick: 5 } });
  });

  it("replaces a corrupt backup without losing a valid latest match", async () => {
    const memory = memoryAdapter();
    const store = createAutoSaveStore(memory.adapter);
    await store.save(archive(100, 200));
    await store.save(archive(110, 400));
    memory.replace({ ...memory.slots(), previous: { ...memory.slots().previous!, saveJson: "corrupt" } });
    expect((await store.save(archive(110, 600))).ok).toBe(true);
    expect(await store.read()).toMatchObject({ ok: true, latest: { seed: 110, tick: 6 }, previous: null });
    expect((await store.save(archive(120, 800))).ok).toBe(true);
    expect(await store.read()).toMatchObject({ ok: true, latest: { seed: 120, tick: 8 }, previous: { seed: 110, tick: 6 } });
  });

  it("returns an actionable status when storage is unavailable, without throwing into gameplay", async () => {
    const adapter: AutoSaveAdapter = { async load() { throw new Error("Storage denied"); }, async commit() { throw new Error("Storage denied"); } };
    const store = createAutoSaveStore(adapter);
    await expect(store.read()).resolves.toMatchObject({ ok: false });
    await expect(store.save(archive(80))).resolves.toMatchObject({ ok: false });
  });

  it("can intentionally restore an older valid checkpoint while preserving the newer one and normal stale-write protection", async () => {
    const memory = memoryAdapter();
    const store = createAutoSaveStore(memory.adapter);
    await store.save(archive(150, 1200));
    const before = structuredClone(memory.slots());
    expect((await store.save("corrupt", { restore: true })).ok).toBe(false);
    expect(memory.slots()).toEqual(before);
    expect((await store.save(archive(150, 500), { restore: true })).ok).toBe(true);
    expect(await store.read()).toMatchObject({ ok: true, latest: { seed: 150, tick: 5 }, previous: { seed: 150, tick: 12 } });
    expect((await store.save(archive(150, 600))).ok).toBe(true);
    expect((await store.save(archive(150, 400))).ok).toBe(false);
    expect(await store.read()).toMatchObject({ ok: true, latest: { tick: 6 }, previous: { tick: 12 } });
  });
});
