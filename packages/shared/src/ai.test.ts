import { describe, expect, it } from "vitest";
import { AI_PROFILES, createAiController, getAiObservation, type AiObservation } from "./ai";
import { MAX_TRAINING_QUEUE_DEPTH, TECHNOLOGIES } from "./content";
import { isGameCommand, type AiPersonality, type GameCommand, type PublicEntityState, type UnitType } from "./protocol";
import { applyCommand, cloneMatchState, createInitialState, stepSimulation, validateCommand, type MatchState } from "./simulation";

const PERSONALITIES: readonly AiPersonality[] = ["aggressor", "guardian", "prosperer", "balanced", "raider"];

describe("shared AI personalities", () => {
  it("publishes the five fixed profile ids", () => {
    expect(Object.keys(AI_PROFILES).sort()).toEqual([...PERSONALITIES].sort());
    expect(new Set(PERSONALITIES.map((personality) => AI_PROFILES[personality].advanceAfterTick.stronghold)).size).toBe(5);
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
    expect(decide("guardian")).toMatchObject({ type: "gather" });
    expect(decide("prosperer")).toMatchObject({ type: "train", unitType: "villager" });
    expect(decide("balanced")).toMatchObject({ type: "gather" });
    expect(decide("raider")).toMatchObject({ type: "gather" });
  });

  it("uses distinct, legal, data-driven research priorities for all five personalities", () => {
    const base = createInitialState({ seed: 75, matchId: "ai-research-priorities" });
    const player = base.players[0]!;
    const townCenter = base.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing town center");
    player.settlementTier = "artificer";
    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    base.tick = 15_000;
    for (const [index, typeId] of (["farmstead", "lumberCamp", "barracks", "beastStable"] as const).entries()) {
      base.entities.push({
        ...townCenter,
        id: `research-producer-${typeId}`,
        typeId,
        position: { x: 9 + index * 2, y: 10 },
        hitPoints: 500,
        maxHitPoints: 500,
        productionQueue: [],
      });
    }
    const expected = {
      aggressor: "layeredHarness",
      guardian: "surveyedFoundations",
      prosperer: "hearthlandAlmanac",
      balanced: "resinboundKits",
      raider: "windspurRigging",
    } as const;

    for (const personality of PERSONALITIES) {
      const state = cloneMatchState(base);
      const command = createAiController(personality, player.id, 750 + PERSONALITIES.indexOf(personality), "veteran")
        .decide(getAiObservation(state, player.id), 5)[0];
      expect(command).toMatchObject({ type: "research", technologyId: expected[personality] });
      expect(validateCommand(state, envelope(state, 0, command!)), `${personality} research must be authoritative-valid`).toEqual({ ok: true });

      const queued = applyCommand(state, envelope(state, 0, command!)).state;
      const next = createAiController(personality, player.id, 850 + PERSONALITIES.indexOf(personality), "veteran")
        .decide({ ...getAiObservation(queued, player.id), serverTick: queued.tick + 10 }, 5)[0];
      if (next?.type === "research") expect(next.technologyId).not.toBe(expected[personality]);
      if (next) expect(validateCommand(queued, envelope(queued, 1, next))).toEqual({ ok: true });
    }
  });

  it("continues strategic research under visible pressure after fielding a defensive force", () => {
    const state = createInitialState({ seed: 751, matchId: "ai-research-under-pressure" });
    const player = state.players[0]!;
    const townCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === player.id && entity.typeId === "townCenter");
    if (!townCenter || townCenter.kind !== "building") throw new Error("missing town center");
    state.entities.push({
      ...townCenter,
      id: "pressure-lumber-camp",
      typeId: "lumberCamp",
      position: { x: 9, y: 10 },
      hitPoints: 500,
      maxHitPoints: 500,
      productionQueue: [],
    });
    player.settlementTier = "artificer";
    player.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    state.tick = 15_000;
    const observation = getAiObservation(state, player.id);
    const pressured: AiObservation = {
      ...observation,
      ownEntities: [
        ...observation.ownEntities,
        entity("pressure-militia", player.id, "unit", "militia", 8, 8),
        entity("pressure-spearman", player.id, "unit", "spearman", 9, 8),
        entity("pressure-archer", player.id, "unit", "archer", 10, 8),
      ],
      visibleEnemyEntities: [entity("pressure-enemy", "player-2", "unit", "militia", 12, 8)],
    };
    const command = createAiController("balanced", player.id, 751, "veteran").decide(pressured, 5)[0];
    expect(command).toMatchObject({ type: "research", producerId: "pressure-lumber-camp", technologyId: "resinboundKits" });
    expect(validateCommand(state, envelope(state, 0, command!))).toEqual({ ok: true });
  });

  it("never interrupts a loaded villager to construct an AI building", () => {
    const state = createInitialState({ seed: 76, matchId: "ai-unloaded-builder" });
    const villagers = state.entities
      .filter((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")
      .sort((left, right) => left.id.localeCompare(right.id));
    villagers[0]!.cargo = { kind: "wood", amount: 10 };
    const command = createAiController("aggressor", "player-1", 76).decide(getAiObservation(state, "player-1"), 5)[0];
    expect(command).toMatchObject({ type: "build", buildingType: "barracks", builderIds: [villagers[1]!.id] });

    for (const villager of villagers) villager.cargo = { kind: "wood", amount: 10 };
    expect(createAiController("aggressor", "player-1", 77).decide(getAiObservation(state, "player-1"), 5)).toEqual([]);
  });

  it("builds legal prerequisites before advancing toward a locked raider unit", () => {
    const base = getAiObservation(createInitialState({ seed: 78 }), "player-1");
    const ready = {
      ...base,
      serverTick: AI_PROFILES.raider.advanceAfterTick.stronghold,
      wallet: { food: 2_000, wood: 2_000, stone: 2_000 },
    } satisfies AiObservation;
    expect(createAiController("raider", "player-1", 78).decide(ready, 5)[0])
      .toMatchObject({ type: "build", buildingType: "barracks" });

    const prerequisites = [
      entity("ready-barracks", "player-1", "building", "barracks", 8, 8),
      entity("ready-lumber", "player-1", "building", "lumberCamp", 10, 8),
    ];
    const withPrerequisites: AiObservation = {
      ...ready,
      ownEntities: [...ready.ownEntities, ...prerequisites],
      ownTrainingQueueDepth: { ...ready.ownTrainingQueueDepth, "ready-barracks": 0, "ready-lumber": 0 },
    };
    expect(createAiController("raider", "player-1", 79).decide(withPrerequisites, 5)[0])
      .toMatchObject({ type: "advanceSettlement", targetTier: "stronghold" });
  });

  it("keeps gathering or adds population capacity while an advancement is active", () => {
    const base = getAiObservation(createInitialState({ seed: 79 }), "player-1");
    const advancing: AiObservation = {
      ...base,
      advancement: { producerId: base.ownEntities.find((candidate) => candidate.typeId === "townCenter")!.id, targetTier: "stronghold", remainingTicks: 300 },
    };
    expect(createAiController("balanced", "player-1", 79).decide(advancing, 5)[0]).toMatchObject({ type: "gather" });
    const capped = { ...advancing, population: { used: 9, capacity: 10 } } satisfies AiObservation;
    expect(createAiController("balanced", "player-1", 80).decide(capped, 5)[0]).toMatchObject({ type: "build", buildingType: "house" });
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
    enemyPlayer!.completedTechnologyIds = ["surveyedFoundations"];
    if (hiddenEnemy?.kind === "building") hiddenEnemy.productionQueue = [{ kind: "research", technologyId: "starfireBores", remainingTicks: TECHNOLOGIES.starfireBores.researchTicks }];

    const baseline = getAiObservation(state, "player-1");
    const afterHiddenChange = getAiObservation(changedHiddenState, "player-1");
    expect(baseline.visibleEnemyEntities).toEqual([]);
    expect(afterHiddenChange).toEqual(baseline);
    expect(baseline.ownEntities.every((entity) => entity.ownerId === "player-1")).toBe(true);
    expect(createAiController("balanced", "player-1", 33).decide(afterHiddenChange, 5))
      .toEqual(createAiController("balanced", "player-1", 33).decide(baseline, 5));
    expect(afterHiddenChange.settlementTier).toBe(state.players[0]!.settlementTier);
    expect(afterHiddenChange.advancement).toEqual(state.players[0]!.advancement);
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
    townCenter.productionQueue = Array.from({ length: MAX_TRAINING_QUEUE_DEPTH }, () => ({ kind: "train" as const, unitType: "villager" as const, remainingTicks: 120 }));
    state.players[0]!.population.used += MAX_TRAINING_QUEUE_DEPTH;

    const observation = getAiObservation(state, "player-1");
    const commands = createAiController("prosperer", "player-1", 151).decide(observation, 5);
    expect(observation.ownTrainingQueueDepth[townCenter.id]).toBe(MAX_TRAINING_QUEUE_DEPTH);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "gather" });
    expect(validateCommand(state, envelope(state, 0, commands[0]!))).toEqual({ ok: true });
  });

  it("keeps every personality command legal until advancement or a legitimate victory", () => {
    const expectedProduction = {
      aggressor: { building: "barracks", unit: "militia" },
      guardian: { building: "barracks", unit: "spearman" },
      prosperer: { building: "archeryRange", unit: "archer" },
      balanced: { building: "barracks", unit: "spearman" },
      raider: { building: "beastStable", unit: "scout" },
    } as const;
    for (const personality of PERSONALITIES) {
      const result = runAiForTicks(personality, 10_000);
      const expected = expectedProduction[personality];
      const ownedTypes = result.state.entities.filter((entity) => entity.ownerId === "player-1").map((entity) => entity.typeId).sort();
      const wonByConquest = result.state.phase === "finished"
        && result.state.finishReason === "conquest"
        && result.state.winningTeamIds.includes("team-1");
      const progressionDebug = `tick=${result.state.tick} phase=${result.state.phase} reason=${result.state.finishReason} winners=${result.state.winningTeamIds.join(",")} wallet=${JSON.stringify(result.state.players[0]!.resources)} owns=${ownedTypes.join(",")} deposits=${result.depositCount} advancement=${JSON.stringify(result.state.players[0]!.advancement)}`;
      expect(result.rejections, `${personality} emitted rejected commands`).toEqual([]);
      expect(result.commandCount, `${personality} should exercise at least one decision`).toBeGreaterThan(0);
      expect(result.depositCount, `${personality} should complete at least one carry and drop-off cycle`).toBeGreaterThan(0);
      expect(result.strongholdReachedAt !== null || wonByConquest, `${personality} should reach stronghold or win by conquest; ${progressionDebug}`).toBe(true);
      if (result.strongholdReachedAt !== null) {
        expect(result.strongholdReachedAt, `${personality} should reach stronghold in a reasonable time`).toBeLessThanOrEqual(6_000);
      } else {
        expect(result.state.tick, `${personality} should win by conquest in a reasonable time`).toBeLessThanOrEqual(6_000);
      }
      expect(result.state.entities.some((entity) => (
        entity.kind === "building"
        && entity.ownerId === "player-1"
        && entity.typeId === expected.building
        && entity.complete
      )), `${personality} should complete ${expected.building}; owns ${ownedTypes.join(",")}`).toBe(true);
      expect(result.producedUnitTypes, `${personality} should train ${expected.unit}`).toContain(expected.unit);
    }
  }, 300_000);

  it("takes the balanced profile from economy through barracks, production, and an advance", () => {
    const result = runAiForTicks("balanced", 7_000);
    expect(result.rejections).toEqual([]);
    expect(result.state.entities.some((entity) => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "barracks" && entity.complete)).toBe(true);
    expect(result.peakMilitary).toBeGreaterThanOrEqual(3);
    expect(result.advancedBeyondHome).toBe(true);
  }, 60_000);

  it("keeps all personalities legal against village terrain and the reserved breach route", () => {
    for (const personality of PERSONALITIES) {
      const result = runAiForTicks(personality, 4_000, true);
      expect(result.rejections, `${personality} rejected a village-map command`).toEqual([]);
      expect(result.commandCount).toBeGreaterThan(0);
    }
  }, 300_000);

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
      productionQueue: [],
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
      productionQueue: [],
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
    settlementTier: "artificer",
    advancement: null,
    map: { id: "open", width: 32, height: 32 },
    ownEntities,
    ownTrainingQueueDepth: { "own-town-center": 0, "own-barracks": 0 },
    ownProductionQueues: { "own-town-center": [], "own-barracks": [] },
    completedTechnologyIds: [],
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
  readonly strongholdReachedAt: number | null;
  readonly producedUnitTypes: readonly UnitType[];
  readonly depositCount: number;
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
  let strongholdReachedAt: number | null = null;
  let depositCount = 0;
  const producedUnitTypes = new Set<UnitType>();

  for (let index = 0; index < ticks; index += 1) {
    if (state.phase !== "playing") break;
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
    const stepped = stepSimulation(state, [], 1);
    state = stepped.state;
    depositCount += stepped.events.filter((event) => event.type === "resourcesDeposited" && event.playerId === "player-1").length;
    if (strongholdReachedAt === null && state.players[0]!.settlementTier !== "frontier") strongholdReachedAt = state.tick;
    const military = state.entities.filter((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId !== "villager");
    for (const unit of military) producedUnitTypes.add(unit.typeId);
    peakMilitary = Math.max(peakMilitary, military.length);
    advancedBeyondHome ||= military.some((unit) => unit.position.x > 10);
  }

  return { commandCount, rejections, state, peakMilitary, advancedBeyondHome, strongholdReachedAt, producedUnitTypes: [...producedUnitTypes].sort(), depositCount };
}

function envelope(state: MatchState, sequence: number, command: GameCommand) {
  return { matchId: state.matchId, playerId: "player-1", sequence, clientTick: state.tick, command };
}
