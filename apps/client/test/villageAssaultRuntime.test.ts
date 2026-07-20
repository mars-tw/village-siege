import { describe, expect, it } from "vitest";
import { updateVisibilityState, type UnitEntityState } from "@village-siege/shared";
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
  });

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
});
