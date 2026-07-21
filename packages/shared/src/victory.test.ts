import { describe, expect, it } from "vitest";
import { BUILDINGS, TOWN_CENTER_REBUILD_GRACE_TICKS } from "./content";
import {
  applyCommand,
  applyDisconnectedTeamDefeat,
  applyDisconnectedTeamDefeats,
  cloneMatchState,
  createInitialState,
  hashMatchState,
  projectDomainEventsForPlayer,
  stepSimulation,
  toVisibleSnapshot,
  type BuildingEntityState,
  type MatchState,
  type UnitEntityState,
} from "./simulation";
import type { CommandEnvelope, GameCommand } from "./protocol";

const NO_CONQUEST = { commandCenterConquest: null, elimination: false, landmark: null, timedControl: null } as const;

describe("deterministic victory policies", () => {
  it("creates a canonical default policy and rejects invalid teams or objectives", () => {
    const state = createInitialState({ seed: 801 });
    expect(state.victory.policy).toEqual({
      commandCenterConquest: { rebuildGraceTicks: TOWN_CENTER_REBUILD_GRACE_TICKS },
      elimination: true,
      landmark: null,
      timedControl: null,
    });
    expect(state.victory.teams.map((team) => team.teamId)).toEqual(["team-1", "team-2"]);
    expect(() => createInitialState({
      players: [
        { id: "ally-1", teamId: "same", villageId: "pinehold" },
        { id: "ally-2", teamId: "same", villageId: "riverstead" },
      ],
    })).toThrow("at least two opposing teams");
    expect(() => createInitialState({ victoryPolicy: { timedControl: { point: { x: 32, y: 0 }, radius: 2, startsAtTick: 0, targetTicks: 10 } } })).toThrow(RangeError);
    expect(() => createInitialState({ victoryPolicy: { landmark: { buildingType: "copperLandmark", requiredCount: 0, holdTicks: 10 } } })).toThrow(RangeError);
  });

  it("resolves conquest on the exact grace tick and only a completed rebuild clears the timer", () => {
    let state = createInitialState({
      seed: 802,
      victoryPolicy: { ...NO_CONQUEST, commandCenterConquest: { rebuildGraceTicks: 3 } },
    });
    destroyTeamTownCenters(state, "team-2");
    state = stepSimulation(state, [], 1).state;
    expect(state.teamTownCenterLostAt).toEqual([{ teamId: "team-2", tick: 0 }]);
    const enemyTemplate = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    state.entities.push({ ...enemyTemplate, id: "enemy-rebuild-site", ownerId: "player-2", complete: false, constructionRemainingTicks: 50 });
    state = stepSimulation(state, [], 1).state;
    expect(state.phase).toBe("playing");
    state = stepSimulation(state, [], 1).state;
    expect(state.phase).toBe("finished");
    expect(state.finishReason).toBe("conquest");
    expect(state.victory.finishedAtTick).toBe(3);

    let rebuilt = createInitialState({
      seed: 803,
      victoryPolicy: { ...NO_CONQUEST, commandCenterConquest: { rebuildGraceTicks: 3 } },
    });
    const center = rebuilt.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    center.hitPoints = 0;
    rebuilt = stepSimulation(rebuilt, [], 1).state;
    rebuilt.entities.push({ ...center, id: "completed-rebuild", hitPoints: center.maxHitPoints, complete: true, constructionRemainingTicks: 0 });
    rebuilt = stepSimulation(rebuilt, [], 3).state;
    expect(rebuilt.phase).toBe("playing");
    expect(rebuilt.teamTownCenterLostAt).toEqual([]);
  });

  it("eliminates a team without active strategic presence and ignores orphan sites, walls and gates", () => {
    let state = createInitialState({ seed: 804, victoryPolicy: { ...NO_CONQUEST, elimination: true } });
    const enemyTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    state.entities = state.entities.filter((entity) => entity.ownerId !== "player-2");
    state.entities.push(
      { ...enemyTown, id: "orphan-site", typeId: "house", complete: false, constructionRemainingTicks: 100, hitPoints: 1 },
      { ...enemyTown, id: "last-wall", typeId: "resinPalisade", complete: true, constructionRemainingTicks: 0, hitPoints: 1 },
      { ...enemyTown, id: "last-gate", typeId: "surveyGate", complete: true, constructionRemainingTicks: 0, hitPoints: 1 },
    );
    const result = stepSimulation(state, [], 0);
    expect(result.state.phase).toBe("finished");
    expect(result.state.finishReason).toBe("elimination");
    expect(result.events).toContainEqual({ type: "teamEliminated", teamId: "team-2", reason: "elimination", eliminatedAtTick: 0 });
  });

  it("requires a continuous completed copper-landmark hold and reports simultaneous completion as a draw", () => {
    let state = createInitialState({
      seed: 805,
      victoryPolicy: { ...NO_CONQUEST, landmark: { buildingType: "copperLandmark", requiredCount: 1, holdTicks: 3 } },
    });
    addCompletedLandmark(state, "player-1", "landmark-a");
    state = stepSimulation(state, [], 2).state;
    expect(teamProgress(state, "team-1").landmarkHoldTicks).toBe(2);
    state.entities.find((entity) => entity.id === "landmark-a")!.hitPoints = 0;
    state = stepSimulation(state, [], 1).state;
    expect(teamProgress(state, "team-1").landmarkHoldTicks).toBe(0);
    addCompletedLandmark(state, "player-1", "landmark-a2");
    addCompletedLandmark(state, "player-2", "landmark-b");
    const result = stepSimulation(state, [], 3);
    expect(result.state.phase).toBe("finished");
    expect(result.state.victory).toMatchObject({ outcome: "draw", winningTeamIds: ["team-1", "team-2"], finishReason: "landmark", triggeredReasons: ["landmark"] });
    expect(result.events.filter((event) => event.type === "matchFinished")).toHaveLength(1);
  });

  it("scores timed control exactly once per fixed tick and pauses while any hostile team contests", () => {
    let state = createInitialState({
      seed: 806,
      victoryPolicy: { ...NO_CONQUEST, timedControl: { point: { x: 10, y: 10 }, radius: 2, startsAtTick: 1, targetTicks: 3 } },
    });
    const playerUnit = firstUnit(state, "player-1");
    const enemyUnit = firstUnit(state, "player-2");
    playerUnit.position = { x: 10, y: 10 };
    enemyUnit.position = { x: 20, y: 20 };
    state = stepSimulation(state, [], 2).state;
    expect(teamProgress(state, "team-1").timedControlScoreTicks).toBe(2);
    enemyUnitIn(state).position = { x: 11, y: 10 };
    state = stepSimulation(state, [], 1).state;
    expect(state.victory.control).toEqual({ controllerTeamId: null, contested: true });
    expect(teamProgress(state, "team-1").timedControlScoreTicks).toBe(2);
    enemyUnitIn(state).position = { x: 20, y: 20 };
    const result = stepSimulation(state, [], 1);
    expect(result.state.phase).toBe("finished");
    expect(result.state.victory).toMatchObject({ outcome: "victory", winningTeamIds: ["team-1"], finishReason: "timedControl", finishedAtTick: 4 });
    expect(result.events).toContainEqual({ type: "victoryProgressChanged", teamId: "team-1", objective: "timedControl", progressTicks: 3, targetTicks: 3 });
  });

  it("handles same-batch opposing surrenders as a canonical draw independent of input order", () => {
    const initial = createInitialState({ seed: 807 });
    const commands = [
      envelope(initial, "player-2", 0, { type: "surrender" }),
      envelope(initial, "player-1", 0, { type: "surrender" }),
    ];
    const first = stepSimulation(initial, commands, 0);
    const second = stepSimulation(initial, [...commands].reverse(), 0);
    expect(first.state).toEqual(second.state);
    expect(first.state.victory).toMatchObject({ outcome: "draw", winningTeamIds: [], finishReason: "surrender", finishedAtTick: 0 });
    expect(first.events.filter((event) => event.type === "matchFinished")).toHaveLength(1);
    expect(hashMatchState(first.state)).toBe(hashMatchState(second.state));
  });

  it("consumes one authoritative tick when a surrender finishes a stepped match", () => {
    const initial = createInitialState({ seed: 817 });
    const result = stepSimulation(initial, [envelope(initial, "player-1", 0, { type: "surrender" })], 1);

    expect(result.state.tick).toBe(1);
    expect(result.state.victory.finishedAtTick).toBe(1);
    expect(result.state.victory.teams.find((team) => team.teamId === "team-1")?.eliminatedAtTick).toBe(1);
    expect(result.events).toContainEqual(expect.objectContaining({ type: "matchFinished", finishedAtTick: 1 }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: "teamEliminated", eliminatedAtTick: 1 }));
  });

  it("keeps a surrendered ally's units, towers, queues and projectiles inactive while the team continues", () => {
    let state = createInitialState({
      seed: 808,
      players: [
        { id: "player-1", teamId: "allies", villageId: "pinehold" },
        { id: "player-2", teamId: "enemy", villageId: "riverstead" },
        { id: "player-3", teamId: "allies", villageId: "highcrag" },
      ],
      victoryPolicy: { timedControl: { point: { x: 10, y: 10 }, radius: 1, startsAtTick: 0, targetTicks: 100 } },
    });
    const town = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    state.players.find((player) => player.id === "player-1")!.resources = { food: 5_000, wood: 5_000, stone: 5_000 };
    state = applyCommand(state, envelope(state, "player-1", 0, { type: "train", producerId: town.id, unitType: "villager", count: 1 })).state;
    const queueBefore = (state.entities.find((entity) => entity.id === town.id) as BuildingEntityState).productionQueue[0]!.remainingTicks;
    const ownUnit = firstUnit(state, "player-1");
    const enemyUnit = firstUnit(state, "player-2");
    ownUnit.position = { x: 10, y: 10 };
    ownUnit.order = { type: "move", target: { x: ownUnit.position.x + 4, y: ownUnit.position.y } };
    const origin = { ...ownUnit.position };
    state.entities.push({
      ...town,
      id: "surrendered-tower",
      typeId: "defenseTower",
      position: { x: enemyUnit.position.x - 1, y: enemyUnit.position.y },
      hitPoints: BUILDINGS.defenseTower.maxHitPoints,
      maxHitPoints: BUILDINGS.defenseTower.maxHitPoints,
      attackCooldownTicks: 0,
      productionQueue: [],
    });
    state.projectiles.push({
      id: "surrendered-projectile",
      ownerId: "player-1",
      sourceId: ownUnit.id,
      profileId: "arrow",
      origin: { ...ownUnit.position },
      position: { ...ownUnit.position },
      targetId: enemyUnit.id,
      targetPoint: { ...enemyUnit.position },
      fixedImpact: true,
      launchTick: state.tick,
      impactTick: state.tick + 1,
      damage: 10,
      statusEffects: [],
      resolution: null,
    });
    const enemyHitPoints = enemyUnit.hitPoints;
    state = applyCommand(state, envelope(state, "player-1", 1, { type: "surrender" })).state;
    expect(state.projectiles.some((projectile) => projectile.ownerId === "player-1")).toBe(false);
    expect(state.phase).toBe("playing");
    state = stepSimulation(state, [], 20).state;
    const frozenTown = state.entities.find((entity) => entity.id === town.id) as BuildingEntityState;
    expect(firstUnit(state, "player-1").position).toEqual(origin);
    expect(frozenTown.productionQueue[0]!.remainingTicks).toBe(queueBefore);
    expect(firstUnit(state, "player-2").hitPoints).toBe(enemyHitPoints);
    expect(state.projectiles.some((projectile) => projectile.ownerId === "player-1")).toBe(false);
    expect(state.victory.control.controllerTeamId).not.toBe("allies");
  });

  it("persists public terminal results and projects exact disconnect outcomes", () => {
    const initial = createInitialState({ seed: 809 });
    const result = applyDisconnectedTeamDefeat(initial, "team-2");
    const view = toVisibleSnapshot(result.state, "player-1");
    expect(view.victory).toMatchObject({ outcome: "victory", winningTeamIds: ["team-1"], finishReason: "disconnect", finishedAtTick: 1 });
    expect(view.victory.teams.map((team) => team.teamId)).toEqual(["team-1", "team-2"]);
    expect(projectDomainEventsForPlayer(result.state, "player-1", { serverTick: 1, events: result.events })).toEqual(result.events);
    const changed = cloneMatchState(result.state);
    changed.victory = { ...changed.victory, finishedAtTick: 2 };
    expect(hashMatchState(changed)).not.toBe(hashMatchState(result.state));
  });

  it("batches simultaneous reconnect expiries independently of callback order", () => {
    const initial = createInitialState({
      seed: 815,
      players: [
        { id: "player-1", teamId: "survivor", villageId: "pinehold" },
        { id: "player-2", teamId: "expired-b", villageId: "riverstead" },
        { id: "player-3", teamId: "expired-a", villageId: "highcrag" },
      ],
    });
    const left = applyDisconnectedTeamDefeats(initial, ["expired-b", "expired-a"]);
    const right = applyDisconnectedTeamDefeats(initial, ["expired-a", "expired-b", "expired-a"]);

    expect(left.state).toEqual(right.state);
    expect(left.events).toEqual(right.events);
    expect(left.state.tick).toBe(1);
    expect(left.state.victory).toMatchObject({
      outcome: "victory",
      winningTeamIds: ["survivor"],
      finishReason: "disconnect",
      finishedAtTick: 1,
    });
    expect(left.events.filter((event) => event.type === "matchFinished")).toHaveLength(1);
  });

  it("records every same-tick objective trigger and draws when different teams complete them", () => {
    let state = createInitialState({
      seed: 810,
      victoryPolicy: {
        ...NO_CONQUEST,
        landmark: { buildingType: "copperLandmark", requiredCount: 1, holdTicks: 1 },
        timedControl: { point: { x: 10, y: 10 }, radius: 1, startsAtTick: 0, targetTicks: 1 },
      },
    });
    addCompletedLandmark(state, "player-1", "landmark-team-1");
    for (const entity of state.entities) {
      if (entity.kind !== "unit") continue;
      entity.position = entity.ownerId === "player-2" ? { x: 10, y: 10 } : { x: 20, y: 20 };
    }

    const result = stepSimulation(state, [], 1);
    expect(result.state.victory).toMatchObject({
      outcome: "draw",
      winningTeamIds: ["team-1", "team-2"],
      finishReason: "landmark",
      triggeredReasons: ["landmark", "timedControl"],
      finishedAtTick: 1,
    });
    expect(result.events.filter((event) => event.type === "matchFinished")).toHaveLength(1);
  });

  it("keeps the current causal finish reason after an allied historical surrender", () => {
    let state = createInitialState({
      seed: 811,
      players: [
        { id: "player-1", teamId: "allies", villageId: "pinehold" },
        { id: "player-2", teamId: "enemy", villageId: "riverstead" },
        { id: "player-3", teamId: "allies", villageId: "highcrag" },
      ],
      victoryPolicy: { ...NO_CONQUEST, commandCenterConquest: { rebuildGraceTicks: 0 } },
    });
    state = applyCommand(state, envelope(state, "player-1", 0, { type: "surrender" })).state;
    expect(state.phase).toBe("playing");
    destroyTeamTownCenters(state, "enemy");

    const result = stepSimulation(state, [], 0);
    expect(result.state.victory).toMatchObject({
      outcome: "victory",
      winningTeamIds: ["allies"],
      finishReason: "conquest",
      triggeredReasons: ["conquest"],
      finishedAtTick: 0,
    });
  });

  it("preserves every simultaneous team-defeat cause in deterministic priority order", () => {
    const state = createInitialState({
      seed: 814,
      players: [
        { id: "player-1", teamId: "survivor", villageId: "pinehold" },
        { id: "player-2", teamId: "conquered", villageId: "riverstead" },
        { id: "player-3", teamId: "yielded", villageId: "highcrag" },
      ],
      victoryPolicy: { ...NO_CONQUEST, commandCenterConquest: { rebuildGraceTicks: 0 } },
    });
    destroyTeamTownCenters(state, "conquered");

    const result = stepSimulation(state, [envelope(state, "player-3", 0, { type: "surrender" })], 0);
    expect(result.state.victory).toMatchObject({
      outcome: "victory",
      winningTeamIds: ["survivor"],
      finishReason: "surrender",
      triggeredReasons: ["surrender", "conquest"],
      finishedAtTick: 0,
    });
    expect(result.events.filter((event) => event.type === "matchFinished")).toHaveLength(1);
  });

  it("locks terminal state, emits the result once and keeps compatibility fields atomic", () => {
    const terminal = applyDisconnectedTeamDefeat(createInitialState({ seed: 812 }), "team-2");
    expect(terminal.state.winningTeamIds).toEqual(terminal.state.victory.winningTeamIds);
    expect(terminal.state.finishReason).toBe(terminal.state.victory.finishReason);
    expect(terminal.state.phase).toBe("finished");

    const command = applyCommand(terminal.state, envelope(terminal.state, "player-1", 0, {
      type: "move",
      entityIds: [firstUnit(terminal.state, "player-1").id],
      target: { x: 8, y: 8 },
    }));
    expect(command.validation).toEqual({ ok: false, code: "MATCH_NOT_PLAYING" });
    expect(command.events.filter((event) => event.type === "matchFinished")).toHaveLength(0);
    const afterTicks = stepSimulation(command.state, [], 10);
    expect(afterTicks.state).toEqual(terminal.state);
    expect(afterTicks.events).toEqual([]);
  });

  it("produces the same canonical hash after ten thousand fixed ticks regardless of chunking", () => {
    const initial = createInitialState({ seed: 813, victoryPolicy: NO_CONQUEST });
    const single = stepSimulation(initial, [], 10_000).state;
    let chunked = cloneMatchState(initial);
    for (let index = 0; index < 100; index += 1) chunked = stepSimulation(chunked, [], 100).state;
    expect(hashMatchState(chunked)).toBe(hashMatchState(single));
    expect(chunked).toEqual(single);
  });
});

function destroyTeamTownCenters(state: MatchState, teamId: string): void {
  const playerIds = new Set(state.players.filter((player) => player.teamId === teamId).map((player) => player.id));
  for (const entity of state.entities) if (entity.kind === "building" && entity.typeId === "townCenter" && playerIds.has(entity.ownerId)) entity.hitPoints = 0;
}

function addCompletedLandmark(state: MatchState, playerId: string, id: string): void {
  const template = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === playerId && entity.typeId === "townCenter")!;
  state.entities.push({
    ...template,
    id,
    typeId: "copperLandmark",
    hitPoints: BUILDINGS.copperLandmark.maxHitPoints,
    maxHitPoints: BUILDINGS.copperLandmark.maxHitPoints,
    complete: true,
    constructionRemainingTicks: 0,
    productionQueue: [],
  });
}

function firstUnit(state: MatchState, playerId: string): UnitEntityState {
  return state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === playerId)!;
}

function enemyUnitIn(state: MatchState): UnitEntityState {
  return firstUnit(state, "player-2");
}

function teamProgress(state: MatchState, teamId: string) {
  return state.victory.teams.find((team) => team.teamId === teamId)!;
}

function envelope(state: MatchState, playerId: string, sequence: number, command: GameCommand): CommandEnvelope {
  return { matchId: state.matchId, playerId, sequence, clientTick: state.tick, command };
}
