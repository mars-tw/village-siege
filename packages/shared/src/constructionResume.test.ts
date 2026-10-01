import { describe, expect, it } from "vitest";
import legacyConstruction from "./fixtures/construction-legacy-0.22.0.json";
import { BUILDINGS, RULES_VERSION, STARTING_RESOURCES, getBuildingFootprint } from "./content";
import { MATCH_PROTOCOL_VERSION, type CommandEnvelope, type GameCommand } from "./protocol";
import { getFootprintPerimeterCells } from "./spatial";
import {
  appendJournalAdvance,
  appendJournalCommand,
  createMatchCommandJournalFile,
  createMatchReplayFile,
  parseMatchReplayFile,
  parseMatchSaveFile,
  replayMatchReplay,
  serializeMatchReplayFile,
} from "./persistence";
import {
  applyCommand,
  cloneMatchState,
  createInitialState,
  hashMatchState,
  stepSimulation,
  validateCommand,
  type BuildingEntityState,
  type MatchState,
  type UnitEntityState,
} from "./simulation";

function envelope(state: MatchState, sequence: number, command: GameCommand): CommandEnvelope {
  return { matchId: state.matchId, playerId: "player-1", sequence, clientTick: state.tick, command };
}

function issue(state: MatchState, sequence: number, command: GameCommand): MatchState {
  const applied = applyCommand(state, envelope(state, sequence, command));
  expect(applied.validation).toEqual({ ok: true });
  return applied.state;
}

function building(state: MatchState, id: string): BuildingEntityState {
  return state.entities.find((entity): entity is BuildingEntityState => entity.id === id && entity.kind === "building")!;
}

function worker(state: MatchState, id: string): UnitEntityState {
  return state.entities.find((entity): entity is UnitEntityState => entity.id === id && entity.kind === "unit")!;
}

function interruptedConstruction() {
  let state = createInitialState({ seed: 2201001, matchId: "resume-construction", map: { id: "villageAssault", width: 32, height: 24, layoutId: "pinehold" } });
  const workerIds = state.entities.filter(entity => entity.kind === "unit" && entity.ownerId === "player-1").map(entity => entity.id);
  const workerId = workerIds[0]!;
  state = issue(state, 0, { type: "stop", entityIds: workerIds });
  state = issue(state, 1, { type: "build", builderIds: [workerId], buildingType: "house", origin: { x: 6, y: 6 } });
  state = stepSimulation(state, [], 60).state;
  const house = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "house")!;
  expect(house.constructionRemainingTicks).toBeGreaterThan(0);
  expect(house.constructionRemainingTicks).toBeLessThan(BUILDINGS.house.buildTicks);
  const houseProgress = house.constructionRemainingTicks;
  state = issue(state, 2, { type: "build", builderIds: [workerId], buildingType: "barracks", origin: { x: 7, y: 13 } });
  state = stepSimulation(state, [], 80).state;
  const barracks = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "barracks")!;
  expect(barracks.constructionRemainingTicks).toBeGreaterThan(0);
  expect(barracks.constructionRemainingTicks).toBeLessThan(BUILDINGS.barracks.buildTicks);
  expect(building(state, house.id).constructionRemainingTicks).toBe(houseProgress);
  return { state, workerId, houseId: house.id, barracksId: barracks.id };
}

describe("resuming paid unfinished construction through the existing repair command", () => {
  it("lets the same worker switch A→B→A, complete both buildings and pay each construction cost once", () => {
    const interrupted = interruptedConstruction();
    let state = interrupted.state;
    const { workerId, houseId, barracksId } = interrupted;
    const paidWallet = { food: STARTING_RESOURCES.food, wood: STARTING_RESOURCES.wood - BUILDINGS.house.cost.wood - BUILDINGS.barracks.cost.wood, stone: STARTING_RESOURCES.stone - BUILDINGS.barracks.cost.stone };
    expect(state.players[0]!.resources).toEqual(paidWallet);
    const progress = building(state, houseId).constructionRemainingTicks;
    const hp = building(state, houseId).hitPoints;
    state = issue(state, 3, { type: "repair", entityIds: [workerId], targetId: houseId });
    expect(worker(state, workerId).order).toEqual({ type: "construct", targetId: houseId });
    expect(building(state, houseId)).toMatchObject({ constructionRemainingTicks: progress, hitPoints: hp });
    expect(state.players[0]!.resources).toEqual(paidWallet);
    state = stepSimulation(state, [], 500).state;
    expect(building(state, houseId)).toMatchObject({ complete: true, constructionRemainingTicks: 0 });
    expect(building(state, barracksId).complete).toBe(false);
    state = issue(state, 4, { type: "repair", entityIds: [workerId], targetId: barracksId });
    state = stepSimulation(state, [], 500).state;
    expect(building(state, barracksId)).toMatchObject({ complete: true, constructionRemainingTicks: 0 });
    expect(state.players[0]!.resources).toEqual(paidWallet);
    expect(state.entities.filter(entity => entity.kind === "building" && [houseId, barracksId].includes(entity.id))).toHaveLength(2);
  });

  it("continues a damaged foundation with zero wood without restoring lost health or charging a new cost", () => {
    const interrupted = interruptedConstruction();
    let state = interrupted.state;
    const { workerId, houseId } = interrupted;
    state.players[0]!.resources.wood = 0;
    building(state, houseId).hitPoints -= 20;
    const beforeWallet = { ...state.players[0]!.resources };
    const hp = building(state, houseId).hitPoints;
    state = issue(state, 3, { type: "repair", entityIds: [workerId], targetId: houseId });
    expect(building(state, houseId).hitPoints).toBe(hp);
    state = stepSimulation(state, [], 500).state;
    expect(building(state, houseId).complete).toBe(true);
    expect(building(state, houseId).hitPoints).toBeGreaterThan(hp);
    expect(building(state, houseId).hitPoints).toBeLessThan(building(state, houseId).maxHitPoints);
    expect(state.players[0]!.resources).toEqual(beforeWallet);
    expect(validateCommand(state, envelope(state, 4, { type: "repair", entityIds: [workerId], targetId: houseId }))).toEqual({ ok: false, code: "INSUFFICIENT_RESOURCES" });
  });

  it("preserves completed-building repair work, exact wood cost and allied repair permission", () => {
    const { state: base, workerId } = interruptedConstruction();
    const center = base.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    worker(base, workerId).position = { x: center.position.x - 1, y: center.position.y };
    center.hitPoints -= 20;
    const beforeWood = base.players[0]!.resources.wood;
    const beforeHp = center.hitPoints;
    let state = issue(base, 3, { type: "repair", entityIds: [workerId], targetId: center.id });
    expect(worker(state, workerId).order).toEqual({ type: "repair", targetId: center.id });
    state = stepSimulation(state, [], 1).state;
    expect(building(state, center.id).hitPoints).toBe(beforeHp + 10);
    expect(state.players[0]!.resources.wood).toBe(beforeWood - 1);

    const allied = cloneMatchState(base);
    allied.players[1]!.teamId = allied.players[0]!.teamId;
    building(allied, center.id).ownerId = allied.players[1]!.id;
    expect(validateCommand(allied, envelope(allied, 3, { type: "repair", entityIds: [workerId], targetId: center.id }))).toEqual({ ok: true });
  });

  it.each(["enemy", "ally", "soldier", "deadWorker", "foreignWorker", "removedWorker", "deadBuilding", "removed"] as const)("rejects invalid unfinished construction: %s", scenario => {
    const { state, workerId, houseId } = interruptedConstruction();
    const house = building(state, houseId);
    if (scenario === "enemy" || scenario === "ally") house.ownerId = "player-2";
    if (scenario === "ally") state.players[1]!.teamId = state.players[0]!.teamId;
    if (scenario === "soldier") worker(state, workerId).typeId = "warrior";
    if (scenario === "deadWorker") worker(state, workerId).hitPoints = 0;
    if (scenario === "foreignWorker") worker(state, workerId).ownerId = "player-2";
    if (scenario === "removedWorker") state.entities = state.entities.filter(entity => entity.id !== workerId);
    if (scenario === "deadBuilding") house.hitPoints = 0;
    if (scenario === "removed") state.entities = state.entities.filter(entity => entity.id !== houseId);
    const beforeHash = hashMatchState(state);
    const applied = applyCommand(state, envelope(state, 3, { type: "repair", entityIds: [workerId], targetId: houseId }));
    const code = scenario === "removed" ? "TARGET_NOT_VISIBLE" : scenario === "foreignWorker" || scenario === "removedWorker" ? "ENTITY_NOT_OWNED" : "INVALID_PAYLOAD";
    expect(applied.validation).toEqual({ ok: false, code });
    expect(hashMatchState(applied.state)).toBe(beforeHash);
  });

  it("rejects a foundation whose entire work perimeter is statically blocked", () => {
    const { state, workerId, houseId } = interruptedConstruction();
    const house = building(state, houseId);
    for (const [index, position] of getFootprintPerimeterCells(house.position, getBuildingFootprint(house.typeId, house.orientation)).entries()) {
      state.entities.push({ ...house, id: `resume-blocker-${index}`, typeId: "resinPalisade", position, complete: true, constructionRemainingTicks: 0, hitPoints: BUILDINGS.resinPalisade.maxHitPoints, maxHitPoints: BUILDINGS.resinPalisade.maxHitPoints });
    }
    const beforeHash = hashMatchState(state);
    const applied = applyCommand(state, envelope(state, 3, { type: "repair", entityIds: [workerId], targetId: houseId }));
    expect(applied.validation).toEqual({ ok: false, code: "TARGET_NOT_REACHABLE" });
    expect(hashMatchState(applied.state)).toBe(beforeHash);
  });

  it("imports a genuine pre-fix 0.22.0 unfinished save with its original hash and resumes construction", () => {
    expect(RULES_VERSION).toBe("village-siege/0.19.0");
    expect(MATCH_PROTOCOL_VERSION).toBe("village-siege-network/4");
    expect(legacyConstruction.sourceCommit).toBe("933f9f1");
    const save = parseMatchSaveFile(JSON.stringify(legacyConstruction.save));
    expect(save.snapshot.hash).toBe("fbf4d7a8");
    expect(hashMatchState(save.snapshot.state)).toBe("fbf4d7a8");
    expect(legacyConstruction.originalRejectedCommand).toMatchObject({ sequence: 3, code: "INVALID_PAYLOAD", hash: "fbf4d7a8" });
    const targetId = legacyConstruction.abandonedBuildingId;
    const workerId = legacyConstruction.workerId;
    let state = issue(save.snapshot.state, save.runtime.nextPlayerSequence, { type: "repair", entityIds: [workerId], targetId });
    state = stepSimulation(state, [], 500).state;
    expect(building(state, targetId)).toMatchObject({ complete: true, constructionRemainingTicks: 0 });
  });

  it("replays the genuine pre-fix accepted completed repair with the original final hash; rejected repair was never journaled", () => {
    const replay = parseMatchReplayFile(JSON.stringify(legacyConstruction.replay));
    expect(replay.journal.operations.filter(operation => operation.kind === "accepted-command")).toHaveLength(1);
    expect(replay.journal.operations.some(operation => operation.kind === "accepted-command" && operation.envelope.sequence === legacyConstruction.originalRejectedCommand.sequence)).toBe(false);
    expect(replay.finalHash).toBe("b32f0001");
    const restored = replayMatchReplay(replay);
    expect(restored.state.tick).toBe(340);
    expect(hashMatchState(restored.state)).toBe("b32f0001");
    expect(building(restored.state, legacyConstruction.abandonedBuildingId).complete).toBe(false);
  });

  it("records and verifies a new continuation replay after resuming a pre-fix save", () => {
    const save = parseMatchSaveFile(JSON.stringify(legacyConstruction.save));
    let state = save.snapshot.state;
    let journal = createMatchCommandJournalFile(state);
    const resumed = appendJournalCommand(journal, state, envelope(state, save.runtime.nextPlayerSequence, { type: "repair", entityIds: [legacyConstruction.workerId], targetId: legacyConstruction.abandonedBuildingId }), "human");
    state = resumed.state;
    journal = resumed.journal;
    for (let tick = 0; tick < 500; tick += 1) {
      const next = appendJournalAdvance(journal, state);
      state = next.state;
      journal = next.journal;
    }
    expect(building(state, legacyConstruction.abandonedBuildingId).complete).toBe(true);
    const replay = createMatchReplayFile(save, journal, { ...save.runtime, nextPlayerSequence: save.runtime.nextPlayerSequence + 1 }, state);
    const restored = replayMatchReplay(parseMatchReplayFile(serializeMatchReplayFile(replay)));
    expect(hashMatchState(restored.state)).toBe(hashMatchState(state));
  });
});
