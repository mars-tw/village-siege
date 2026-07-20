import { describe, expect, it } from "vitest";
import { createAiAuthorityState } from "./aiAuthority";
import { getAiObservation, reduceAi, type AiObservation } from "./ai";
import { createInitialState, hashMatchState, toVisibleSnapshot, validateCommand } from "./simulation";
import type { AiAuthorityState, GameCommand, PublicEntityState, UnitType } from "./protocol";

describe("authoritative strategic AI", () => {
  it("stores canonical private planner state in the match and excludes it from player snapshots", () => {
    const state = createInitialState({
      seed: 301,
      players: [
        { id: "player-1", teamId: "team-1", villageId: "pinehold" },
        { id: "player-2", teamId: "team-2", villageId: "riverstead", ai: { personality: "raider", difficulty: "veteran" } },
      ],
    });
    expect(state.aiControllers).toHaveLength(1);
    expect(state.aiControllers[0]).toMatchObject({ playerId: "player-2", personality: "raider", difficulty: "veteran", waveIndex: 0 });
    expect(toVisibleSnapshot(state, "player-1")).not.toHaveProperty("aiControllers");
    const changed = structuredClone(state);
    changed.aiControllers[0] = { ...changed.aiControllers[0]!, waveIndex: 1 };
    expect(hashMatchState(changed)).not.toBe(hashMatchState(state));
  });

  it("is pure and resumes identically from a JSON-restored planner snapshot", () => {
    const observation = strategicObservation(0, [unit("enemy-archer", "player-2", "archer", 12, 6)]);
    const initial = createAiAuthorityState("balanced", "player-1", 302, "veteran");
    const before = JSON.stringify(initial);
    const first = reduceAi(initial, observation, 5);
    expect(JSON.stringify(initial)).toBe(before);
    const restored = JSON.parse(JSON.stringify(first.authority)) as AiAuthorityState;
    const nextObservation = { ...observation, serverTick: 10 } satisfies AiObservation;
    expect(reduceAi(restored, nextObservation, 5)).toEqual(reduceAi(first.authority, nextObservation, 5));
  });

  it("remembers only observed enemies and holds its selected counter through short-lived composition noise", () => {
    let authority = createAiAuthorityState("balanced", "player-1", 303, "veteran");
    const first = reduceAi(authority, strategicObservation(0, [unit("enemy-archer", "player-2", "archer", 12, 6)]), 5);
    authority = first.authority;
    const lockedCounter = authority.desiredCounterUnit;
    expect(lockedCounter).not.toBeNull();
    expect(authority.enemyMemory).toHaveLength(1);

    const noisy = reduceAi(authority, strategicObservation(10, [unit("enemy-warrior", "player-2", "warrior", 12, 6)]), 5);
    expect(noisy.authority.desiredCounterUnit).toBe(lockedCounter);
    expect(noisy.authority.counterLockedUntilTick).toBeGreaterThan(10);

    const hiddenMutation = strategicObservation(20, []);
    expect(reduceAi(noisy.authority, hiddenMutation, 5))
      .toEqual(reduceAi(JSON.parse(JSON.stringify(noisy.authority)) as AiAuthorityState, hiddenMutation, 5));
  });

  it("orders a legal priority repair with an unloaded idle villager", () => {
    const state = createInitialState({ seed: 304, matchId: "ai-priority-repair" });
    const gateLikeTarget = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    expect(gateLikeTarget?.kind).toBe("building");
    if (!gateLikeTarget || gateLikeTarget.kind !== "building") throw new Error("missing repair target");
    gateLikeTarget.hitPoints = Math.floor(gateLikeTarget.maxHitPoints / 2);
    state.players[0]!.resources.wood = 100;
    const result = reduceAi(
      createAiAuthorityState("guardian", "player-1", 304, "veteran"),
      getAiObservation(state, "player-1"),
      5,
    );
    expect(result.commands[0]).toMatchObject({ type: "repair", targetId: gateLikeTarget.id });
    expect(result.authority.phase).toBe("repairing");
    expect(validateCommand(state, envelope(state.matchId, state.tick, 0, result.commands[0]!))).toEqual({ ok: true });
  });

  it("retreats an inferior defense once, keeps the phase lock, and then regroups", () => {
    const enemies = Array.from({ length: 8 }, (_, index) => unit(`enemy-heavy-${index}`, "player-2", "heavyCrossbowman", 8 + index % 2, 6 + Math.floor(index / 2) % 2));
    let observation = strategicObservation(0, enemies);
    let authority = createAiAuthorityState("balanced", "player-1", 305, "veteran");
    const retreat = reduceAi(authority, observation, 5);
    authority = retreat.authority;
    expect(retreat.commands[0]).toMatchObject({ type: "move" });
    expect(authority.phase).toBe("retreating");
    expect(authority.telemetry.retreatsOrdered).toBe(1);

    observation = { ...observation, serverTick: 10, visibleEnemyEntities: [] };
    const locked = reduceAi(authority, observation, 5);
    expect(locked.authority.phase).toBe("retreating");
    expect(locked.authority.telemetry.retreatsOrdered).toBe(1);

    observation = {
      ...observation,
      serverTick: locked.authority.phaseLockedUntilTick,
      ownEntities: observation.ownEntities.map((entity) => entity.kind === "unit" && entity.typeId !== "villager"
        ? { ...entity, position: { x: 6, y: 6 } }
        : entity),
    };
    const regroup = reduceAi(locked.authority, observation, 5);
    expect(regroup.authority.phase).toBe("regrouping");
  });

  it("launches deterministic reinforced waves separated by retreat and regroup cooldowns", () => {
    let authority = createAiAuthorityState("balanced", "player-1", 306, "veteran");
    let observation = strategicObservation(0, []);
    const firstWave = reduceAi(authority, observation, 5);
    authority = firstWave.authority;
    expect(firstWave.commands[0]).toMatchObject({ type: "attackMove" });
    expect(authority.waveIndex).toBe(1);
    expect(authority.telemetry.wavesLaunched).toBe(1);

    observation = { ...observation, serverTick: authority.nextWaveAtTick };
    const returnHome = reduceAi(authority, observation, 5);
    authority = returnHome.authority;
    expect(returnHome.commands[0]).toMatchObject({ type: "move" });
    expect(authority.phase).toBe("retreating");

    observation = {
      ...observation,
      serverTick: authority.phaseLockedUntilTick,
      ownEntities: [
        ...observation.ownEntities.map((entity) => entity.kind === "unit" && entity.typeId !== "villager"
          ? { ...entity, position: { x: 6, y: 6 } }
          : entity),
        unit("reinforcement", "player-1", "musketeer", 6, 6),
      ],
    };
    const regroup = reduceAi(authority, observation, 5);
    authority = regroup.authority;
    expect(authority.phase).toBe("regrouping");

    observation = { ...observation, serverTick: Math.max(authority.phaseLockedUntilTick, authority.nextWaveAtTick) };
    const secondWave = reduceAi(authority, observation, 5);
    expect(secondWave.commands[0]).toMatchObject({ type: "attackMove" });
    expect(secondWave.authority.waveIndex).toBe(2);
    expect(secondWave.authority.telemetry.wavesLaunched).toBe(2);
  });
});

function strategicObservation(serverTick: number, visibleEnemyEntities: readonly PublicEntityState[]): AiObservation {
  const state = createInitialState({ seed: 900, matchId: "strategic-observation" });
  const base = getAiObservation(state, "player-1");
  return {
    ...base,
    serverTick,
    settlementTier: "artificer",
    wallet: { food: 5_000, wood: 5_000, stone: 5_000 },
    population: { used: 7, capacity: 30 },
    ownEntities: [
      ...base.ownEntities,
      unit("own-warrior", "player-1", "warrior", 7, 7),
      unit("own-shield", "player-1", "shieldBearer", 8, 7),
      unit("own-archer", "player-1", "archer", 9, 7),
      unit("own-mage", "player-1", "mage", 9, 8),
    ],
    visibleEnemyEntities,
  };
}

function unit(id: string, ownerId: string, typeId: UnitType, x: number, y: number): PublicEntityState {
  const maxHitPoints = typeId === "heavyCrossbowman" ? 200 : 150;
  return { id, ownerId, kind: "unit", typeId, position: { x, y }, hitPoints: maxHitPoints, maxHitPoints, stateRevision: 0 };
}

function envelope(matchId: string, clientTick: number, sequence: number, command: GameCommand) {
  return { matchId, playerId: "player-1", sequence, clientTick, command };
}
