import { describe, expect, it } from "vitest";
import legacyConstruction from "./fixtures/construction-legacy-0.22.0.json";
import { RESOURCE_NODES, RULES_VERSION } from "./content";
import {
  MatchPersistenceError,
  appendJournalAdvance,
  createMatchCommandJournalFile,
  createMatchReplayFile,
  migrateMatchReplayResultToCurrentRules,
  migrateMatchSaveToCurrentRules,
  parseMatchReplayFile,
  parseMatchSaveFile,
  replayMatchReplay,
  serializeMatchReplayFile,
  serializeMatchSaveFile,
  type MatchSaveFile,
} from "./persistence";
import { cloneMatchState, getEntityFootprintCells, hashMatchState, stepSimulation, type MatchState, type ResourceEntityState } from "./simulation";

describe("verified legacy 0.19 checkpoint migration", () => {
  it("verifies the genuine original hash, preserves owned progress and wallets, and adds only unmined finite stock", () => {
    const originalText = JSON.stringify(legacyConstruction.save);
    const legacy = parseMatchSaveFile(originalText);
    expect(legacy.snapshot.hash).toBe("fbf4d7a8");
    expect(hashMatchState(legacy.snapshot.state)).toBe("fbf4d7a8");
    const migrated = migrateMatchSaveToCurrentRules(legacy);
    expect(migrated.rulesVersion).toBe(RULES_VERSION);
    expect(migrated.snapshot.state.rulesVersion).toBe(RULES_VERSION);
    expect(migrated.runtime).toEqual(legacy.runtime);
    expect(migrated.snapshot.state.players).toEqual(legacy.snapshot.state.players);
    expect(migrated.snapshot.state.entities.filter(entity => entity.kind !== "resource"))
      .toEqual(legacy.snapshot.state.entities.filter(entity => entity.kind !== "resource"));
    expect(migrated.snapshot.state.tick).toBe(140);
    expect(migrated.snapshot.state.seed).toBe(legacy.snapshot.state.seed);
    for (const previous of legacy.snapshot.state.entities.filter((entity): entity is ResourceEntityState => entity.kind === "resource")) {
      const next = migrated.snapshot.state.entities.find(entity => entity.id === previous.id) as ResourceEntityState;
      expect(next.maxHitPoints - next.amount).toBe(previous.maxHitPoints - previous.amount);
      expect(next.maxHitPoints).toBe(previous.typeId === "food" ? previous.maxHitPoints : RESOURCE_NODES[previous.typeId].maxAmount);
      expect(next.hitPoints).toBe(next.amount);
    }
    expect(JSON.stringify(legacyConstruction.save)).toBe(originalText);
    expect(legacy.snapshot.hash).toBe("fbf4d7a8");
    expect(hashMatchState(legacy.snapshot.state)).toBe("fbf4d7a8");
    expect(parseMatchSaveFile(serializeMatchSaveFile(migrated))).toEqual(migrated);
    expect(migrateMatchSaveToCurrentRules(migrated)).toBe(migrated);
  });

  it("rejects a changed legacy snapshot or continuation before granting any migration", () => {
    for (const change of ["resource", "runtime"] as const) {
      const raw = JSON.parse(JSON.stringify(legacyConstruction.save));
      if (change === "resource") {
        const resource = raw.snapshot.state.entities.find((entity: ResourceEntityState) => entity.kind === "resource" && entity.typeId === "wood");
        resource.amount -= 1;
        resource.hitPoints -= 1;
      } else raw.runtime.nextPlayerSequence += 1;
      expect(() => migrateMatchSaveToCurrentRules(parseMatchSaveFile(JSON.stringify(raw))))
        .toThrowError(expect.objectContaining({ code: "HASH_MISMATCH" }));
    }
  });

  it("restores only the extra unmined capacity after a home node was exhausted, avoiding the player's new building", () => {
    const state = cloneMatchState(parseMatchSaveFile(JSON.stringify(legacyConstruction.save)).snapshot.state);
    const depleted = state.entities.find((entity): entity is ResourceEntityState => entity.kind === "resource" && entity.typeId === "wood")!;
    state.entities = state.entities.filter(entity => entity.id !== depleted.id);
    const existingTown = state.entities.find(entity => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    existingTown.position = { ...depleted.position };
    const legacy = legacyCheckpoint(stepSimulation(state, [], 0).state);
    const migrated = migrateMatchSaveToCurrentRules(legacy);
    const additions = migrated.snapshot.state.entities.filter(entity => !legacy.snapshot.state.entities.some(previous => previous.id === entity.id));
    expect(additions).toHaveLength(1);
    const restored = additions[0] as ResourceEntityState;
    expect(restored).toMatchObject({ kind: "resource", typeId: "wood", amount: RESOURCE_NODES.wood.maxAmount - 1_000, maxHitPoints: RESOURCE_NODES.wood.maxAmount });
    const previouslyOccupied = new Set(legacy.snapshot.state.entities.flatMap(getEntityFootprintCells).map(point => `${point.x},${point.y}`));
    expect(previouslyOccupied.has(`${restored.position.x},${restored.position.y}`)).toBe(false);
    expect(migrated.snapshot.state.entities.find(entity => entity.id === existingTown.id)).toEqual(existingTown);
    expect(migrated.snapshot.state.players).toEqual(legacy.snapshot.state.players);
    expect(migrated.snapshot.state.nextEntityNumber).toBe(legacy.snapshot.state.nextEntityNumber + 1);
    expect(parseMatchSaveFile(serializeMatchSaveFile(migrated)).snapshot.hash).toBe(hashMatchState(migrated.snapshot.state));
  });

  it("verifies the genuine old replay exactly before migration and records a valid current-rules continuation", () => {
    const original = JSON.stringify(legacyConstruction.replay);
    const replay = parseMatchReplayFile(original);
    const verified = replayMatchReplay(replay);
    expect(hashMatchState(verified.state)).toBe("b32f0001");
    const migrated = migrateMatchReplayResultToCurrentRules(replay);
    expect(migrated.state.rulesVersion).toBe(RULES_VERSION);
    expect(migrated.state.players).toEqual(verified.state.players);
    expect(migrated.state.entities.filter(entity => entity.kind !== "resource"))
      .toEqual(verified.state.entities.filter(entity => entity.kind !== "resource"));
    expect(JSON.stringify(legacyConstruction.replay)).toBe(original);
    const checkpoint = migrateMatchSaveToCurrentRules(legacyCheckpoint(verified.state, replay.runtime));
    const appended = appendJournalAdvance(createMatchCommandJournalFile(checkpoint.snapshot.state), checkpoint.snapshot.state);
    const nextReplay = createMatchReplayFile(checkpoint, appended.journal, checkpoint.runtime, appended.state);
    const reconstructed = replayMatchReplay(parseMatchReplayFile(serializeMatchReplayFile(nextReplay)));
    expect(hashMatchState(reconstructed.state)).toBe(hashMatchState(appended.state));
  });

  it("rejects unknown or mixed recorded rule versions", () => {
    const raw = JSON.parse(JSON.stringify(legacyConstruction.save));
    raw.rulesVersion = "village-siege/0.18.0";
    expect(() => parseMatchSaveFile(JSON.stringify(raw))).toThrowError(MatchPersistenceError);
    const mixed = JSON.parse(JSON.stringify(legacyConstruction.replay));
    mixed.journal.rulesVersion = RULES_VERSION;
    expect(() => parseMatchReplayFile(JSON.stringify(mixed)))
      .toThrowError(expect.objectContaining({ code: "UNSUPPORTED_RULES_VERSION" }));
  });
});

// Synthetic variants derive from the immutable genuine fixture; no user saves are used.
function legacyCheckpoint(state: MatchState, runtime = legacyConstruction.save.runtime): MatchSaveFile {
  const hash = hashMatchState(state);
  const file = { ...legacyConstruction.save, snapshot: { tick: state.tick, hash, state }, runtime };
  const canonical = stableStringify({ domain: "village-siege/continuation/1", finalStateHash: hash, runtime });
  let continuationHash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) continuationHash = Math.imul(continuationHash ^ canonical.charCodeAt(index), 0x01000193);
  file.continuationHash = (continuationHash >>> 0).toString(16).padStart(8, "0");
  return parseMatchSaveFile(JSON.stringify(file));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
