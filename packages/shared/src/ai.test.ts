import { describe, expect, it } from "vitest";
import { AI_PROFILES, createAiController, getAiObservation, type AiObservation } from "./ai";
import { MAX_TRAINING_QUEUE_DEPTH } from "./content";
import { isGameCommand, type AiPersonality, type GameCommand, type PublicEntityState } from "./protocol";
import { applyCommand, cloneMatchState, createInitialState, stepSimulation, validateCommand, type MatchState } from "./simulation";

const PERSONALITIES: readonly AiPersonality[] = ["aggressor", "guardian", "prosperer", "balanced", "raider"];

describe("shared AI personalities", () => {
  it("publishes the five fixed profile ids", () => {
    expect(Object.keys(AI_PROFILES).sort()).toEqual([...PERSONALITIES].sort());
  });

  it("replays the same legal decision sequence for the same seed", () => {
    const state = createInitialState({ seed: 77 });
    const base = getAiObservation(state, "player-1");
    for (const personality of PERSONALITIES) {
      const first = createAiController(personality, "player-1", 1234, "veteran");
      const second = createAiController(personality, "player-1", 1234, "veteran");
      const firstSequence = [0, 5, 10, 20, 30].map((serverTick) => first.decide({ ...base, serverTick }, 5));
      const secondSequence = [0, 5, 10, 20, 30].map((serverTick) => second.decide({ ...base, serverTick }, 5));
      expect(firstSequence).toEqual(secondSequence);
      expect(firstSequence.flat().every(isGameCommand)).toBe(true);
      expect(firstSequence.filter((commands) => commands.length > 0)).toHaveLength(4);
    }
  });

  it("gives all five personalities directly testable opening behavior", () => {
    const observation = getAiObservation(createInitialState({ seed: 77 }), "player-1");
    const decide = (personality: AiPersonality) => createAiController(personality, "player-1", 1234).decide(observation, 5)[0];

    expect(decide("aggressor")).toMatchObject({ type: "build", buildingType: "barracks" });
    expect(decide("guardian")).toMatchObject({ type: "build", buildingType: "defenseTower" });
    expect(decide("prosperer")).toMatchObject({ type: "train", unitType: "villager" });
    expect(decide("balanced")).toMatchObject({ type: "gather" });
    expect(decide("raider")).toMatchObject({ type: "build", buildingType: "beastStable" });
  });

  it("uses distinct target and production priorities when enemies are visible", () => {
    const observation = combatObservation();
    const decisions = Object.fromEntries(PERSONALITIES.map((personality) => [
      personality,
      createAiController(personality, "player-1", 91).decide(observation, 5)[0],
    ]));

    expect(decisions.aggressor).toMatchObject({ type: "attack", targetId: "enemy-town-center" });
    expect(decisions.guardian).toMatchObject({ type: "attack", targetId: "enemy-militia" });
    expect(decisions.prosperer).toMatchObject({ type: "train", unitType: "villager" });
    expect(decisions.balanced).toMatchObject({ type: "attack", targetId: "enemy-militia" });
    expect(decisions.raider).toMatchObject({ type: "attack", targetId: "enemy-villager" });
  });

  it("does not expose or react to enemy state outside current vision", () => {
    const state = createInitialState({ seed: 99 });
    const changedHiddenState = cloneMatchState(state);
    const hiddenEnemy = changedHiddenState.entities.find((entity) => entity.ownerId === "player-2" && entity.kind === "building");
    const enemyPlayer = changedHiddenState.players.find((player) => player.id === "player-2");
    expect(hiddenEnemy).toBeDefined();
    expect(enemyPlayer).toBeDefined();
    hiddenEnemy!.hitPoints = 1;
    hiddenEnemy!.stateRevision += 100;
    enemyPlayer!.resources = { food: 9999, wood: 9999, stone: 9999 };

    const baseline = getAiObservation(state, "player-1");
    const afterHiddenChange = getAiObservation(changedHiddenState, "player-1");
    expect(baseline.visibleEnemyEntities).toEqual([]);
    expect(afterHiddenChange).toEqual(baseline);
    expect(baseline.ownEntities.every((entity) => entity.ownerId === "player-1")).toBe(true);
    expect(createAiController("balanced", "player-1", 33).decide(afterHiddenChange, 5))
      .toEqual(createAiController("balanced", "player-1", 33).decide(baseline, 5));
  });

  it("normalizes entity order and rejects invalid remembered sites", () => {
    const state = createInitialState({ seed: 99 });
    const reversed = cloneMatchState(state);
    reversed.entities.reverse();
    const remembered = [
      { entityId: "enemy-2", lastKnownPosition: { x: 12, y: 12 }, observedAtTick: 2 },
      { entityId: "enemy-1", lastKnownPosition: { x: 11, y: 11 }, observedAtTick: 0 },
      { entityId: "enemy-2", lastKnownPosition: { x: 10, y: 10 }, observedAtTick: 1 },
      { entityId: "future", lastKnownPosition: { x: 1, y: 1 }, observedAtTick: 1 },
      { entityId: "outside", lastKnownPosition: { x: -1, y: 1 }, observedAtTick: 0 },
    ] as const;

    const baseline = getAiObservation(state, "player-1", remembered);
    const reordered = getAiObservation(reversed, "player-1", [...remembered].reverse());
    expect(reordered).toEqual(baseline);
    expect(baseline.rememberedEnemySites).toEqual([
      { entityId: "enemy-1", lastKnownPosition: { x: 11, y: 11 }, observedAtTick: 0 },
    ]);
  });

  it("does not train into a saturated town-center queue", () => {
    const state = createInitialState({ seed: 151, matchId: "queue-saturation" });
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    expect(townCenter?.kind).toBe("building");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing player town center");
    townCenter.trainingQueue = Array.from({ length: MAX_TRAINING_QUEUE_DEPTH }, () => ({ unitType: "villager" as const, remainingTicks: 120 }));
    state.players[0]!.population.used += MAX_TRAINING_QUEUE_DEPTH;

    const observation = getAiObservation(state, "player-1");
    const commands = createAiController("prosperer", "player-1", 151).decide(observation, 5);
    expect(observation.ownTrainingQueueDepth[townCenter.id]).toBe(MAX_TRAINING_QUEUE_DEPTH);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "gather" });
    expect(validateCommand(state, envelope(state, 0, commands[0]!))).toEqual({ ok: true });
  });

  it("keeps every personality command legal during a deterministic 10,000-tick run", () => {
    const expectedProduction = {
      aggressor: { building: "barracks", unit: "militia" },
      guardian: { building: "barracks", unit: "spearman" },
      prosperer: { building: "archeryRange", unit: "archer" },
      balanced: { building: "archeryRange", unit: "archer" },
      raider: { building: "beastStable", unit: "scout" },
    } as const;
    for (const personality of PERSONALITIES) {
      const result = runAiForTicks(personality, 10_000);
      const expected = expectedProduction[personality];
      const ownedTypes = result.state.entities.filter((entity) => entity.ownerId === "player-1").map((entity) => entity.typeId).sort();
      expect(result.rejections, `${personality} emitted rejected commands`).toEqual([]);
      expect(result.commandCount, `${personality} should exercise at least one decision`).toBeGreaterThan(0);
      expect(result.state.entities.some((entity) => (
        entity.kind === "building"
        && entity.ownerId === "player-1"
        && entity.typeId === expected.building
        && entity.complete
      )), `${personality} should complete ${expected.building}; owns ${ownedTypes.join(",")}`).toBe(true);
      expect(result.state.entities.some((entity) => (
        entity.kind === "unit"
        && entity.ownerId === "player-1"
        && entity.typeId === expected.unit
      )), `${personality} should train ${expected.unit}`).toBe(true);
    }
  }, 30_000);

  it("takes the balanced profile from economy through barracks, production, and an advance", () => {
    const result = runAiForTicks("balanced", 3_000);
    expect(result.rejections).toEqual([]);
    expect(result.state.entities.some((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "barracks" && entity.complete)).toBe(true);
    expect(result.peakMilitary).toBeGreaterThanOrEqual(3);
    expect(result.advancedBeyondHome).toBe(true);
  });

  it("keeps all personalities legal against village terrain and the reserved breach route", () => {
    for (const personality of PERSONALITIES) {
      const result = runAiForTicks(personality, 4_000, true);
      expect(result.rejections, `${personality} rejected a village-map command`).toEqual([]);
      expect(result.commandCount).toBeGreaterThan(0);
    }
  }, 30_000);

  it("distinguishes damaged completed buildings from active construction", () => {
    const state = createInitialState({ seed: 171, matchId: "damaged-complete-building" });
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    expect(townCenter?.kind).toBe("building");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing town center");
    townCenter.hitPoints -= 25;
    const observation = { ...getAiObservation(state, "player-1"), serverTick: 20 };
    expect(observation.ownIncompleteBuildingIds).toEqual([]);
    expect(createAiController("balanced", "player-1", 171).decide(observation, 5)[0]).toMatchObject({ type: "build", buildingType: "barracks" });
  });

  it("gathers when an aggressor cannot afford another trained unit", () => {
    const state = createInitialState({ seed: 173, matchId: "aggressor-economy-fallback" });
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    expect(townCenter?.kind).toBe("building");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing town center");
    state.entities.push({
      ...townCenter,
      id: "completed-barracks",
      typeId: "barracks",
      hitPoints: 625,
      maxHitPoints: 650,
      trainingQueue: [],
    });
    state.players[0]!.resources = { food: 0, wood: 0, stone: 0 };
    const command = createAiController("aggressor", "player-1", 173).decide(getAiObservation(state, "player-1"), 5)[0];
    expect(command).toMatchObject({ type: "gather" });
    expect(validateCommand(state, envelope(state, 0, command!))).toEqual({ ok: true });
  });

  it("gathers when the balanced profile cannot afford its selected unit", () => {
    const state = createInitialState({ seed: 174, matchId: "balanced-economy-fallback" });
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter");
    expect(townCenter?.kind).toBe("building");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing town center");
    state.entities.push({
      ...townCenter,
      id: "balanced-completed-barracks",
      typeId: "barracks",
      hitPoints: 650,
      maxHitPoints: 650,
      trainingQueue: [],
    });
    state.players[0]!.resources = { food: 0, wood: 0, stone: 0 };
    state.tick = 20;
    const command = createAiController("balanced", "player-1", 174).decide(getAiObservation(state, "player-1"), 5)[0];
    expect(command).toMatchObject({ type: "gather" });
    expect(validateCommand(state, envelope(state, 0, command!))).toEqual({ ok: true });
  });

  it("keeps a trained guardian force patrolling its home when no enemy is visible", () => {
    const observation = combatObservation();
    const guarded: AiObservation = {
      ...observation,
      ownEntities: [...observation.ownEntities, entity("own-tower", "player-1", "building", "defenseTower", 5, 6)],
      ownTrainingQueueDepth: { ...observation.ownTrainingQueueDepth, "own-tower": 0 },
      visibleEnemyEntities: [],
    };
    expect(createAiController("guardian", "player-1", 175).decide(guarded, 5)[0]).toMatchObject({ type: "patrol" });
  });
});

function combatObservation(): AiObservation {
  const ownEntities = [
    entity("own-town-center", "player-1", "building", "townCenter", 6, 6),
    entity("own-barracks", "player-1", "building", "barracks", 7, 6),
    entity("own-villager", "player-1", "unit", "villager", 6, 7),
    entity("own-militia", "player-1", "unit", "militia", 7, 7),
    entity("own-spearman", "player-1", "unit", "spearman", 8, 7),
    entity("own-archer", "player-1", "unit", "archer", 9, 7),
  ];
  return {
    serverTick: 0,
    selfPlayerId: "player-1",
    wallet: { food: 500, wood: 500, stone: 500 },
    population: { used: 4, capacity: 10 },
    map: { id: "open", width: 32, height: 32 },
    ownEntities,
    ownTrainingQueueDepth: { "own-town-center": 0, "own-barracks": 0 },
    ownIncompleteBuildingIds: [],
    visibleEnemyEntities: [
      entity("enemy-town-center", "player-2", "building", "townCenter", 12, 6),
      entity("enemy-villager", "player-2", "unit", "villager", 11, 7),
      entity("enemy-militia", "player-2", "unit", "militia", 8, 6),
    ],
    visibleResourceEntities: [],
    rememberedEnemySites: [],
  };
}

function entity(
  id: string,
  ownerId: string,
  kind: "unit" | "building",
  typeId: PublicEntityState["typeId"],
  x: number,
  y: number,
): PublicEntityState {
  return { id, ownerId, kind, typeId, position: { x, y }, hitPoints: 100, maxHitPoints: 100, stateRevision: 0 };
}

function runAiForTicks(personality: AiPersonality, ticks: number, villageMap = false): {
  readonly commandCount: number;
  readonly rejections: readonly string[];
  readonly state: MatchState;
  readonly peakMilitary: number;
  readonly advancedBeyondHome: boolean;
} {
  let state = createInitialState({
    seed: 20260717,
    matchId: `long-run-${personality}`,
    ...(villageMap ? {
      map: { id: "villageAssault" as const, width: 18, height: 16 },
      spawnOverrides: { "player-1": { x: 3, y: 8 }, "player-2": { x: 14, y: 8 } },
    } : {}),
  });
  const controller = createAiController(personality, "player-1", 20260717, "standard");
  const rejections: string[] = [];
  let sequence = 0;
  let commandCount = 0;
  let peakMilitary = 0;
  let advancedBeyondHome = false;

  for (let index = 0; index < ticks; index += 1) {
    const commands = controller.decide(getAiObservation(state, "player-1"), 5);
    for (const command of commands) {
      const commandEnvelope = envelope(state, sequence, command);
      const validation = validateCommand(state, commandEnvelope);
      if (!validation.ok) {
        rejections.push(`${state.tick}:${validation.code}:${JSON.stringify(command)}`);
      } else {
        state = applyCommand(state, commandEnvelope).state;
      }
      sequence += 1;
      commandCount += 1;
    }
    state = stepSimulation(state, [], 1).state;
    const military = state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId !== "villager");
    peakMilitary = Math.max(peakMilitary, military.length);
    advancedBeyondHome ||= military.some((unit) => unit.position.x > 10);
  }

  return { commandCount, rejections, state, peakMilitary, advancedBeyondHome };
}

function envelope(state: MatchState, sequence: number, command: GameCommand) {
  return { matchId: state.matchId, playerId: "player-1", sequence, clientTick: state.tick, command };
}
