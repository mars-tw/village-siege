import { describe, expect, it } from "vitest";
import {
  decodeExploredTilesRle,
  encodeExploredTilesRle,
  type DomainEvent,
  type VisibleSnapshot,
} from "@village-siege/shared";
import {
  TUTORIAL_STEPS,
  createTutorialProgress,
  currentTutorialStep,
  recordTutorialAcceptedCommand,
  tutorialProgressLabel,
  tutorialProgressSummary,
  updateTutorialProgress,
  type TutorialProgress,
} from "../src/game/tutorialProgress";
import {
  VILLAGE_ASSAULT_AI_ID,
  VILLAGE_ASSAULT_PLAYER_ID,
  createVillageAssaultRuntime,
} from "../src/game/villageAssaultRuntime";

const PLAYER_TEAM_ID = "team-player";

describe("touch tutorial progress", () => {
  it("requires the seven real visible milestones in order and completes on player victory", () => {
    let view = baseView();
    let progress = createTutorialProgress(view);
    expect(currentTutorialStep(progress)?.id).toBe("economy");
    const gatherer = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId === "villager")!;
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "gather", entityIds: [gatherer.id], targetId: "resource-1" },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );

    progress = advance(progress, view, [{
      type: "resourcesDeposited",
      playerId: VILLAGE_ASSAULT_PLAYER_ID,
      unitId: gatherer.id,
      dropOffId: "building-1",
      resourceKind: "wood",
      amount: 10,
    }]);
    expect(currentTutorialStep(progress)?.id).toBe("tier");

    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "advanceSettlement", producerId: "building-1", targetTier: "stronghold" },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    view = { ...view, settlementTier: "stronghold" };
    progress = advance(progress, view);
    expect(currentTutorialStep(progress)?.id).toBe("research");

    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "research", producerId: "building-1", technologyId: "hearthlandAlmanac" },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    view = { ...view, completedTechnologyIds: ["hearthlandAlmanac"] };
    progress = advance(progress, view);
    expect(currentTutorialStep(progress)?.id).toBe("fog");

    view = withOwnMilitary(view);
    const scout = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId !== "villager")!;
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "move", entityIds: [scout.id], target: firstUnexploredPoint(view) },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    view = withAdditionalExploredTiles(view, 10);
    progress = advance(progress, view);
    expect(currentTutorialStep(progress)?.id).toBe("combat");

    const ownUnit = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)!;
    const hostile = { ...ownUnit, id: "tutorial-hostile", ownerId: VILLAGE_ASSAULT_AI_ID };
    view = { ...view, entities: [...view.entities, hostile], visibleEntityIds: [...view.visibleEntityIds, hostile.id] };
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "attack", entityIds: [ownUnit.id], targetId: hostile.id },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    progress = advance(progress, view, [{
      type: "entityDamaged",
      sourceId: ownUnit.id,
      targetId: hostile.id,
      amount: 5,
      hitPoints: Math.max(0, hostile.hitPoints - 5),
    }]);
    expect(currentTutorialStep(progress)?.id).toBe("breach");

    const ownBuilding = view.entities.find((entity) => entity.kind === "building" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)!;
    const enemyGate = { ...ownBuilding, id: "building-enemy-gate", ownerId: VILLAGE_ASSAULT_AI_ID, typeId: "surveyGate" as const };
    view = { ...view, entities: [...view.entities, enemyGate], visibleEntityIds: [...view.visibleEntityIds, enemyGate.id] };
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "attack", entityIds: [ownUnit.id], targetId: enemyGate.id },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    progress = advance(progress, view, [{
      type: "breachCreated",
      structureId: enemyGate.id,
      rubbleId: "rubble-1",
      ownerId: VILLAGE_ASSAULT_AI_ID,
      position: { x: 12, y: 8 },
      createdTick: view.serverTick,
      effectExpiresAtTick: view.serverTick + 20,
    }]);
    expect(currentTutorialStep(progress)?.id).toBe("victory");

    view = {
      ...view,
      phase: "finished",
      victory: {
        ...view.victory,
        outcome: "victory",
        winningTeamIds: [PLAYER_TEAM_ID],
        finishReason: "conquest",
        triggeredReasons: ["conquest"],
        finishedAtTick: view.serverTick,
      },
    };
    progress = advance(progress, view, [{
      type: "matchFinished",
      winningTeamIds: [PLAYER_TEAM_ID],
      outcome: "victory",
      reason: "conquest",
      triggeredReasons: ["conquest"],
      finishedAtTick: view.serverTick,
      teamScores: [],
    }]);

    expect(progress.complete).toBe(true);
    expect(progress.stepIndex).toBe(TUTORIAL_STEPS.length);
    expect(currentTutorialStep(progress)).toBeNull();
    expect(tutorialProgressLabel(progress)).toBe("教學完成 7/7");
    expect(tutorialProgressSummary(progress)).toContain("贏得戰役");
  });

  it("does not count hostile damage, a friendly breach or a draw as player completion", () => {
    const view = baseView();
    const progress = {
      ...createTutorialProgress(view),
      stepIndex: 4,
      accomplishments: {
        economy: true,
        tier: true,
        research: true,
        fog: true,
        combat: false,
        breach: false,
        victory: false,
      },
    } satisfies TutorialProgress;
    const own = view.entities.find((entity) => entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)!;
    const hostile = { ...own, id: "tutorial-hostile", ownerId: VILLAGE_ASSAULT_AI_ID };
    const hostileView = { ...view, entities: [...view.entities, hostile] };
    const events: DomainEvent[] = [
      { type: "entityDamaged", sourceId: hostile.id, targetId: own.id, amount: 3, hitPoints: own.hitPoints - 3 },
      { type: "entityDamaged", sourceId: own.id, targetId: hostile.id, amount: 3, hitPoints: hostile.hitPoints - 3 },
      {
        type: "breachCreated",
        structureId: "friendly-wall",
        rubbleId: "friendly-rubble",
        ownerId: VILLAGE_ASSAULT_PLAYER_ID,
        position: { x: 3, y: 3 },
        createdTick: 1,
        effectExpiresAtTick: 21,
      },
    ];
    const result = updateTutorialProgress(progress, hostileView, events, VILLAGE_ASSAULT_PLAYER_ID, PLAYER_TEAM_ID, VILLAGE_ASSAULT_AI_ID);
    expect(result.progress.stepIndex).toBe(4);
    expect(result.progress.accomplishments.combat).toBe(false);
    expect(result.progress.accomplishments.breach).toBe(false);
    expect(result.progress.accomplishments.victory).toBe(false);
  });

  it("does not count opening auto-gather deposits before the player issues a gather command", () => {
    const view = baseView();
    const gatherer = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId === "villager")!;
    const result = updateTutorialProgress(createTutorialProgress(view), view, [{
      type: "resourcesDeposited",
      playerId: VILLAGE_ASSAULT_PLAYER_ID,
      unitId: gatherer.id,
      dropOffId: "building-1",
      resourceKind: "wood",
      amount: 10,
    }], VILLAGE_ASSAULT_PLAYER_ID, PLAYER_TEAM_ID, VILLAGE_ASSAULT_AI_ID);
    expect(result.progress.stepIndex).toBe(0);
    expect(result.progress.accomplishments.economy).toBe(false);
  });

  it("keeps already-earned later milestones and advances through them when earlier goals catch up", () => {
    const initial = baseView();
    let view = {
      ...initial,
      settlementTier: "stronghold",
      completedTechnologyIds: ["hearthlandAlmanac"],
    } as VisibleSnapshot;
    let progress = createTutorialProgress(initial);
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "advanceSettlement", producerId: "building-1", targetTier: "stronghold" },
      initial,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "research", producerId: "building-1", technologyId: "hearthlandAlmanac" },
      initial,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    view = withOwnMilitary(view);
    const scout = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId !== "villager")!;
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "move", entityIds: [scout.id], target: firstUnexploredPoint(view) },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    view = withAdditionalExploredTiles(view, 10);
    progress = advance(progress, view);
    expect(progress.stepIndex).toBe(0);
    expect(progress.accomplishments.tier).toBe(true);
    expect(progress.accomplishments.research).toBe(true);
    expect(progress.accomplishments.fog).toBe(true);

    const gatherer = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId === "villager")!;
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "gather", entityIds: [gatherer.id], targetId: "resource-1" },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    progress = advance(progress, view, [{
      type: "resourcesDeposited",
      playerId: VILLAGE_ASSAULT_PLAYER_ID,
      unitId: gatherer.id,
      dropOffId: "building-1",
      resourceKind: "food",
      amount: 8,
    }]);
    expect(progress.stepIndex).toBe(4);
    expect(tutorialProgressLabel(progress)).toContain("投入戰鬥");
  });

  it("arms fog progress only from a commanded military move into unexplored terrain", () => {
    let view = withOwnMilitary(baseView());
    const villager = view.entities.find((entity) => entity.kind === "unit" && entity.typeId === "villager" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)!;
    const military = view.entities.find((entity) => entity.kind === "unit" && entity.typeId !== "villager" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)!;
    const exploredIndex = decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle)[0]!;
    const exploredPoint = { x: exploredIndex % view.map.width, y: Math.floor(exploredIndex / view.map.width) };
    const unknownPoint = firstUnexploredPoint(view);
    let progress = createTutorialProgress(view);

    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "move", entityIds: [villager.id], target: unknownPoint },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "move", entityIds: [military.id], target: exploredPoint },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    expect(progress.fogExplorationBaseline).toBeNull();

    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "move", entityIds: [military.id], target: unknownPoint },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    expect(progress.fogExplorationBaseline).toBe(decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle).length);
    view = withAdditionalExploredTiles(view, 9);
    expect(advance(progress, view).accomplishments.fog).toBe(false);
    view = withAdditionalExploredTiles(view, 1);
    expect(advance(progress, view).accomplishments.fog).toBe(true);
  });

  it("counts a commanded visible projectile after its attacker leaves the visible snapshot and the projected damage source is masked", () => {
    let view = withOwnMilitary(baseView());
    const source = view.entities.find((entity) => entity.kind === "unit" && entity.typeId !== "villager" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID)!;
    const hostile = { ...source, id: "tutorial-delayed-target", ownerId: VILLAGE_ASSAULT_AI_ID };
    view = { ...view, entities: [...view.entities, hostile], visibleEntityIds: [...view.visibleEntityIds, hostile.id] };
    let progress = {
      ...createTutorialProgress(view),
      stepIndex: 4,
      accomplishments: { economy: true, tier: true, research: true, fog: true, combat: false, breach: false, victory: false },
    } satisfies TutorialProgress;
    progress = recordTutorialAcceptedCommand(
      progress,
      { type: "attack", entityIds: [source.id], targetId: hostile.id },
      view,
      VILLAGE_ASSAULT_PLAYER_ID,
      VILLAGE_ASSAULT_AI_ID,
    );
    progress = advance(progress, view, [{
      type: "projectileSpawned",
      projectile: {
        id: "tutorial-commanded-projectile",
        ownerId: VILLAGE_ASSAULT_PLAYER_ID,
        sourceId: source.id,
        profileId: "arrow",
        position: { ...source.position },
        targetId: hostile.id,
        targetPoint: { ...hostile.position },
        impactTick: view.serverTick + 3,
      },
    }]);
    const afterSourceRemoved = {
      ...view,
      entities: view.entities.filter((entity) => entity.id !== source.id),
      visibleEntityIds: view.visibleEntityIds.filter((id) => id !== source.id),
    };
    progress = advance(progress, afterSourceRemoved, [
      {
        type: "projectileImpacted",
        projectileId: "tutorial-commanded-projectile",
        position: { ...hostile.position },
        targetIds: [hostile.id],
      },
      {
        type: "entityDamaged",
        sourceId: null,
        targetId: hostile.id,
        amount: 7,
        hitPoints: hostile.hitPoints - 7,
      },
    ]);
    expect(progress.accomplishments.combat).toBe(true);
    expect(progress.stepIndex).toBe(5);
  });

  it("does not finish the victory step on defeat or draw", () => {
    const view = baseView();
    const progress = {
      ...createTutorialProgress(view),
      stepIndex: 6,
      accomplishments: { economy: true, tier: true, research: true, fog: true, combat: true, breach: true, victory: false },
    } satisfies TutorialProgress;
    for (const outcome of ["defeat", "draw"] as const) {
      const result = advance(progress, {
        ...view,
        phase: "finished",
        victory: {
          ...view.victory,
          outcome,
          winningTeamIds: outcome === "defeat" ? ["team-ai"] : [],
          finishReason: "conquest",
          triggeredReasons: ["conquest"],
          finishedAtTick: view.serverTick,
        },
      });
      expect(result.complete).toBe(false);
      expect(result.accomplishments.victory).toBe(false);
    }
  });
});

function baseView(): VisibleSnapshot {
  return createVillageAssaultRuntime({
    playerVillageId: "pinehold",
    aiPersonality: "balanced",
    seed: 20260721,
  }).view;
}

function advance(progress: TutorialProgress, view: VisibleSnapshot, events: readonly DomainEvent[] = []): TutorialProgress {
  return updateTutorialProgress(
    progress,
    view,
    events,
    VILLAGE_ASSAULT_PLAYER_ID,
    PLAYER_TEAM_ID,
    VILLAGE_ASSAULT_AI_ID,
  ).progress;
}

function withAdditionalExploredTiles(view: VisibleSnapshot, count: number): VisibleSnapshot {
  const explored = new Set(decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle));
  for (let index = 0; index < view.map.width * view.map.height && explored.size < decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle).length + count; index += 1) {
    explored.add(index);
  }
  return {
    ...view,
    exploredTilesRle: encodeExploredTilesRle(view.map.width, view.map.height, [...explored]),
  };
}

function firstUnexploredPoint(view: VisibleSnapshot): { x: number; y: number } {
  const explored = new Set(decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle));
  for (let index = 0; index < view.map.width * view.map.height; index += 1) {
    if (!explored.has(index)) return { x: index % view.map.width, y: Math.floor(index / view.map.width) };
  }
  throw new Error("Expected an unexplored tutorial tile");
}

function withOwnMilitary(view: VisibleSnapshot): VisibleSnapshot {
  if (view.entities.some((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId !== "villager")) return view;
  const villager = view.entities.find((entity) => entity.kind === "unit" && entity.ownerId === VILLAGE_ASSAULT_PLAYER_ID && entity.typeId === "villager");
  if (!villager) throw new Error("Expected an opening villager for the tutorial fixture");
  const warrior = { ...villager, id: "tutorial-warrior", typeId: "warrior" as const };
  return {
    ...view,
    entities: [...view.entities, warrior],
    visibleEntityIds: [...view.visibleEntityIds, warrior.id],
  };
}
