import { describe, expect, it } from "vitest";
import {
  MatchPersistenceError,
  hashMatchState,
  parseMatchCommandJournalFile,
  parseMatchReplayFile,
  parseMatchSaveFile,
  updateVisibilityState,
  type UnitEntityState,
} from "@village-siege/shared";
import {
  TACTICAL_SIGNAL_PRESENTATION,
  deriveVisibleTacticalSignalRaised,
} from "../src/game/aiTacticalSignals.js";
import {
  VILLAGE_ASSAULT_AI_ID,
  VILLAGE_ASSAULT_VICTORY_POLICY,
  createVillageAssaultRuntime,
} from "../src/game/villageAssaultRuntime.js";

const OPTIONS = {
  playerVillageId: "pinehold",
  aiVillageId: "riverstead",
  aiPersonality: "balanced",
  aiDifficulty: "veteran",
  aiBudgetMs: 5,
  matchId: "runtime-determinism",
  seed: 73,
} as const;

describe("VillageAssaultRuntime authoritative AI", () => {
  it("enables all original victory routes in the playable assault", () => {
    const runtime = createVillageAssaultRuntime(OPTIONS);

    expect(runtime.state.victory.policy).toEqual(VILLAGE_ASSAULT_VICTORY_POLICY);
    expect(runtime.view.victory.policy).toEqual(VILLAGE_ASSAULT_VICTORY_POLICY);
  });

  it("publishes a synchronous command result even though later runtime steps are zero", () => {
    const runtime = createVillageAssaultRuntime(OPTIONS);
    const surrendered = runtime.issuePlayerCommand({ type: "surrender" });

    expect(surrendered.accepted).toBe(true);
    expect(runtime.view).toMatchObject({
      phase: "finished",
      victory: { outcome: "victory", winningTeamIds: ["team-ai"], finishReason: "surrender" },
    });
    expect(runtime.step(100).steps).toBe(0);
    expect(runtime.view.phase).toBe("finished");
  });

  it("creates the AI controller as part of canonical match state", () => {
    const runtime = createVillageAssaultRuntime(OPTIONS);

    expect(runtime.state.aiControllers).toHaveLength(1);
    expect(runtime.state.aiControllers[0]).toMatchObject({
      playerId: VILLAGE_ASSAULT_AI_ID,
      personality: "balanced",
      difficulty: "veteran",
    });
  });

  it("produces identical canonical state for identical seeds and tick input", () => {
    const first = createVillageAssaultRuntime(OPTIONS);
    const second = createVillageAssaultRuntime(OPTIONS);
    const initialAuthority = structuredClone(first.state.aiControllers[0]);

    for (const deltaMs of [100, 900, 50, 50, 1_400, 600, 2_000]) {
      first.step(deltaMs);
      second.step(deltaMs);
    }

    expect(first.state).toEqual(second.state);
    expect(first.state.aiControllers[0]).not.toEqual(initialAuthority);
    expect(first.state.aiControllers[0]?.telemetry.decisions).toBeGreaterThan(0);
  }, 30_000);

  it("derives a minimal signal only from a visible hostile phase-transition anchor", () => {
    const runtime = createVillageAssaultRuntime(OPTIONS);
    const state = runtime.state;
    const authority = state.aiControllers[0]!;
    const observer = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === runtime.playerId)!;
    const enemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === runtime.aiPlayerId)!;
    enemy.position = { x: observer.position.x + 1, y: observer.position.y };
    updateVisibilityState(state);

    const next = { ...authority, phase: "scouting" as const, phaseStartedTick: state.tick };
    const command = { type: "attackMove" as const, entityIds: [enemy.id], target: { x: 10, y: 8 } };
    expect(deriveVisibleTacticalSignalRaised(state, runtime.playerId, authority, next, [command])).toEqual({
      type: "tacticalSignalRaised",
      actingPlayerId: runtime.aiPlayerId,
      signal: "scouting",
      anchorEntityId: enemy.id,
      emittedAtTick: state.tick,
    });

    enemy.position = { x: 17, y: 15 };
    updateVisibilityState(state);
    expect(deriveVisibleTacticalSignalRaised(state, runtime.playerId, authority, next, [command])).toBeNull();
    expect(deriveVisibleTacticalSignalRaised(state, runtime.playerId, next, next, [command])).toBeNull();
  });

  it("projects a committed reducer phase edge through the runtime event flow", () => {
    const runtime = createVillageAssaultRuntime(OPTIONS);
    const state = runtime.state;
    const observer = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === runtime.playerId)!;
    const enemy = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === runtime.aiPlayerId)!;
    observer.position = { x: 2, y: 2 };
    enemy.position = { x: 3, y: 2 };
    enemy.typeId = "warrior";
    const authority = state.aiControllers[0]!;
    state.aiControllers = [{
      ...authority,
      phase: "economy",
      phaseStartedTick: state.tick,
      phaseLockedUntilTick: state.tick,
      nextScoutAtTick: -1,
      nextWaveAtTick: 9_999,
      activeWave: null,
    }];
    updateVisibilityState(state);
    runtime.importSaveJson(runtime.exportSaveJson());

    const result = runtime.step(100);
    expect(result.events).toContainEqual({
      type: "tacticalSignalRaised",
      actingPlayerId: runtime.aiPlayerId,
      signal: "scouting",
      anchorEntityId: enemy.id,
      emittedAtTick: 0,
    });
  });

  it("defines concise presentation for all six signals without adding controls", () => {
    expect(Object.keys(TACTICAL_SIGNAL_PRESENTATION).sort()).toEqual([
      "alarm",
      "assaulting",
      "regrouping",
      "repairing",
      "retreating",
      "scouting",
    ]);
    expect(TACTICAL_SIGNAL_PRESENTATION.alarm.notice).toBe("敵寨鳴鐘，守軍集結");
    expect(TACTICAL_SIGNAL_PRESENTATION.assaulting.notice).toBe("敵軍攻勢逼近");
  });

  it("restores save metadata after rejected input without reusing sequence or accumulator time", () => {
    const live = createVillageAssaultRuntime(OPTIONS);
    const rejected = live.issuePlayerCommand({ type: "move", entityIds: ["missing-unit"], target: { x: 4, y: 4 } });
    expect(rejected.accepted).toBe(false);
    expect(rejected.sequence).toBe(0);
    expect(live.step(35).steps).toBe(0);

    const restored = createVillageAssaultRuntime({ ...OPTIONS, seed: 999 });
    restored.importSaveJson(live.exportSaveJson());
    expect(restored.state).toEqual(live.state);
    expect(restored.step(64).steps).toBe(0);
    expect(live.step(64).steps).toBe(0);
    expect(restored.step(1).state).toEqual(live.step(1).state);

    const ownUnitId = live.state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === live.playerId)!.id;
    const liveCommand = live.issuePlayerCommand({ type: "stop", entityIds: [ownUnitId] });
    const restoredCommand = restored.issuePlayerCommand({ type: "stop", entityIds: [ownUnitId] });
    expect(liveCommand.sequence).toBe(1);
    expect(restoredCommand.sequence).toBe(1);
    expect(restoredCommand.accepted).toBe(liveCommand.accepted);
    expect(restored.state).toEqual(live.state);
  });

  it("reconstructs human commands, private AI authority commits, and fixed ticks from replay", () => {
    const live = createVillageAssaultRuntime(OPTIONS);
    const ownUnitId = live.state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === live.playerId)!.id;
    expect(live.issuePlayerCommand({ type: "stop", entityIds: [ownUnitId] }).accepted).toBe(true);
    live.step(1_300);
    expect(live.issuePlayerCommand({ type: "setStance", entityIds: [ownUnitId], stance: "defensive" }).accepted).toBe(true);
    live.step(700);

    const journal = parseMatchCommandJournalFile(live.exportJournalJson());
    expect(journal.operations.some((operation) => operation.kind === "accepted-command" && operation.source === "human")).toBe(true);
    expect(journal.operations.some((operation) => operation.kind === "ai-authority-commit")).toBe(true);
    expect(journal.operations.some((operation) => operation.kind === "advance")).toBe(true);

    const reconstructed = createVillageAssaultRuntime({ ...OPTIONS, seed: 404 });
    reconstructed.importReplayJson(live.exportReplayJson());
    expect(reconstructed.state).toEqual(live.state);
    expect(hashMatchState(reconstructed.state)).toBe(hashMatchState(live.state));
    expect(reconstructed.state.aiControllers).toEqual(live.state.aiControllers);
    expect(reconstructed.step(100).state).toEqual(live.step(100).state);
  }, 30_000);

  it("continues an imported replay from a fresh checkpoint and preserves final runtime metadata", () => {
    const original = createVillageAssaultRuntime(OPTIONS);
    const originalUnitId = original.state.entities.find(
      (entity) => entity.kind === "unit" && entity.ownerId === original.playerId,
    )!.id;
    expect(original.issuePlayerCommand({ type: "stop", entityIds: [originalUnitId] }).accepted).toBe(true);
    expect(original.issuePlayerCommand({ type: "move", entityIds: ["missing-unit"], target: { x: 4, y: 4 } }).accepted).toBe(false);
    expect(original.step(235).steps).toBe(2);

    const continued = createVillageAssaultRuntime({ ...OPTIONS, seed: 405 });
    continued.importReplayJson(original.exportReplayJson());
    const continuedUnitId = continued.state.entities.find(
      (entity) => entity.kind === "unit" && entity.ownerId === continued.playerId,
    )!.id;
    const continuedCommand = continued.issuePlayerCommand({
      type: "setStance",
      entityIds: [continuedUnitId],
      stance: "defensive",
    });
    expect(continuedCommand).toMatchObject({ accepted: true, sequence: 2 });
    expect(continued.step(137).steps).toBe(1);

    const continuedReplayJson = continued.exportReplayJson();
    const continuedReplay = parseMatchReplayFile(continuedReplayJson);
    const expectedSave = parseMatchSaveFile(continued.exportSaveJson());
    expect(continuedReplay.journal.operations.some(
      (operation) => operation.kind === "accepted-command" && operation.source === "human",
    )).toBe(true);
    expect(continuedReplay.journal.operations.some((operation) => operation.kind === "advance")).toBe(true);
    expect(continuedReplay.runtime).toEqual(expectedSave.runtime);
    expect(expectedSave.runtime).toMatchObject({ nextPlayerSequence: 3, accumulatorMs: 72, aiBudgetMs: 5 });

    const restored = createVillageAssaultRuntime({ ...OPTIONS, seed: 406 });
    restored.importReplayJson(continuedReplayJson);
    const restoredSave = parseMatchSaveFile(restored.exportSaveJson());
    expect(restored.state).toEqual(continued.state);
    expect(hashMatchState(restored.state)).toBe(hashMatchState(continued.state));
    expect(restoredSave.runtime).toEqual(expectedSave.runtime);
  }, 30_000);

  it("rejects incompatible saves atomically", () => {
    const source = createVillageAssaultRuntime(OPTIONS);
    source.step(500);
    const incompatible = JSON.parse(source.exportSaveJson()) as { rulesVersion: string };
    incompatible.rulesVersion = "village-siege/999.0.0";

    const target = createVillageAssaultRuntime({ ...OPTIONS, seed: 991 });
    const beforeHash = hashMatchState(target.state);
    const beforeSave = target.exportSaveJson();
    expect(() => target.importSaveJson(JSON.stringify(incompatible))).toThrowError(MatchPersistenceError);
    expect(hashMatchState(target.state)).toBe(beforeHash);

    const staleSaveContinuation = JSON.parse(source.exportSaveJson()) as any;
    staleSaveContinuation.runtime.nextPlayerSequence += 1;
    expect(() => target.importSaveJson(JSON.stringify(staleSaveContinuation))).toThrowError(MatchPersistenceError);
    expect(target.exportSaveJson()).toBe(beforeSave);

    const staleReplayContinuation = JSON.parse(source.exportReplayJson()) as any;
    staleReplayContinuation.runtime.accumulatorMs = (staleReplayContinuation.runtime.accumulatorMs + 1) % 100;
    expect(() => target.importReplayJson(JSON.stringify(staleReplayContinuation))).toThrowError(MatchPersistenceError);
    expect(target.exportSaveJson()).toBe(beforeSave);
  });
});
