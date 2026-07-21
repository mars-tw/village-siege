import { describe, expect, it } from "vitest";
import { RULES_VERSION } from "./content";
import { getAiObservation, reduceAi } from "./ai";
import {
  MATCH_JOURNAL_MAX_BYTES,
  MATCH_PERSISTENCE_MAX_DEPTH,
  MATCH_PERSISTENCE_MAX_STRING_LENGTH,
  MATCH_PERSISTENCE_MAX_TICK,
  MATCH_PERSISTENCE_PROTOCOL_VERSION,
  MATCH_PERSISTENCE_SCHEMA_VERSION,
  MATCH_REPLAY_MAX_BYTES,
  MATCH_SAVE_MAX_BYTES,
  MatchPersistenceError,
  appendJournalAdvance,
  appendJournalAiAuthority,
  appendJournalCommand,
  createMatchCommandJournalFile,
  createMatchReplayFile,
  createMatchSaveFile,
  parseMatchCommandJournalFile,
  parseMatchReplayFile,
  parseMatchSaveFile,
  replayMatchJournal,
  replayMatchReplay,
  serializeMatchCommandJournalFile,
  serializeMatchReplayFile,
  serializeMatchSaveFile,
  type MatchCommandJournalFile,
  type MatchRuntimeSaveMetadata,
} from "./persistence";
import { createInitialState, hashMatchState, type MatchState, type UnitEntityState } from "./simulation";
import type { AiAuthorityState, CommandEnvelope, GameCommand } from "./protocol";

describe("versioned authoritative-private persistence", () => {
  it("round-trips a strict save with runtime continuation metadata", () => {
    const state = createPersistenceState(901);
    const file = createMatchSaveFile(state, runtimeMetadata(state, 0, 42.5));

    expect(file).toMatchObject({
      kind: "match-save",
      schemaVersion: MATCH_PERSISTENCE_SCHEMA_VERSION,
      protocolVersion: MATCH_PERSISTENCE_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      visibility: "authoritative-private",
      snapshot: { tick: 0, hash: hashMatchState(state) },
      runtime: { humanPlayerId: "human", nextPlayerSequence: 0, accumulatorMs: 42.5, aiBudgetMs: 5 },
    });
    expect(file.continuationHash).toMatch(/^[0-9a-f]{8}$/);
    expect(createMatchSaveFile(state, runtimeMetadata(state, 0, 42.5)).continuationHash).toBe(file.continuationHash);
    expect(file.snapshot.state).not.toBe(state);

    const serialized = serializeMatchSaveFile(file);
    const parsed = parseMatchSaveFile(serialized);
    expect(parsed).toEqual(file);
    expect(serializeMatchSaveFile(parsed)).toBe(serialized);
  });

  it("binds valid save and replay runtime metadata to their final state hash", () => {
    const base = createPersistenceState(911);
    const save = createMatchSaveFile(base, runtimeMetadata(base, 0, 42.5));
    const mutateRuntime = [
      (runtime: any) => { runtime.humanPlayerId = "computer"; },
      (runtime: any) => { runtime.nextPlayerSequence = 1; },
      (runtime: any) => { runtime.accumulatorMs = 43.5; },
      (runtime: any) => { runtime.aiBudgetMs = 6; },
    ];
    for (const mutate of mutateRuntime) {
      const raw = JSON.parse(serializeMatchSaveFile(save)) as any;
      mutate(raw.runtime);
      expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(raw)), "HASH_MISMATCH");
    }

    const changedState = JSON.parse(serializeMatchSaveFile(save)) as any;
    changedState.snapshot.state.players[0].resources.food += 1;
    changedState.snapshot.hash = hashMatchState(changedState.snapshot.state as MatchState);
    expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(changedState)), "HASH_MISMATCH");

    const advanced = appendJournalAdvance(createMatchCommandJournalFile(base), base);
    const replay = createMatchReplayFile(
      save,
      advanced.journal,
      runtimeMetadata(advanced.state, 0, 17.25),
      advanced.state,
    );
    expect(replay.continuationHash).toMatch(/^[0-9a-f]{8}$/);
    expect(replay.continuationHash).not.toBe(save.continuationHash);
    for (const mutate of mutateRuntime) {
      const raw = JSON.parse(serializeMatchReplayFile(replay)) as any;
      mutate(raw.runtime);
      expectPersistenceCode(() => parseMatchReplayFile(JSON.stringify(raw)), "HASH_MISMATCH");
    }

    const nested = JSON.parse(serializeMatchReplayFile(replay)) as any;
    nested.save.runtime.aiBudgetMs += 1;
    expectPersistenceCode(() => parseMatchReplayFile(JSON.stringify(nested)), "HASH_MISMATCH");

    const trusted = createMatchReplayFile(
      save,
      advanced.journal,
      runtimeMetadata(advanced.state, 0, 17.25),
      advanced.state,
    );
    (trusted.runtime as any).accumulatorMs = 18.25;
    expectPersistenceCode(() => serializeMatchReplayFile(trusted), "HASH_MISMATCH");

    const nestedTrusted = createMatchReplayFile(
      save,
      advanced.journal,
      runtimeMetadata(advanced.state, 0, 17.25),
      advanced.state,
    );
    (nestedTrusted.save.runtime as any).aiBudgetMs += 1;
    expectPersistenceCode(() => serializeMatchReplayFile(nestedTrusted), "HASH_MISMATCH");

    const cyclicTrusted = createMatchReplayFile(
      save,
      advanced.journal,
      runtimeMetadata(advanced.state, 0, 17.25),
      advanced.state,
    );
    (cyclicTrusted.save as any).cycle = cyclicTrusted.save;
    expectPersistenceCode(() => serializeMatchReplayFile(cyclicTrusted), "INVALID_SCHEMA");
  });

  it("records accepted human/AI commands, an AI authority commit and a fixed advance in exact order", () => {
    const base = createPersistenceState(902);
    const save = createMatchSaveFile(base, runtimeMetadata(base, 0, 0));
    let state = base;
    let journal = createMatchCommandJournalFile(base);

    const human = firstUnit(state, "human");
    let appended = appendJournalCommand(journal, state, envelope(state, "human", 0, {
      type: "stop",
      entityIds: [human.id],
    }), "human");
    state = appended.state;
    journal = appended.journal;

    const ai = firstUnit(state, "computer");
    appended = appendJournalCommand(journal, state, envelope(state, "computer", 0, {
      type: "setStance",
      entityIds: [ai.id],
      stance: "defensive",
    }), "ai");
    state = appended.state;
    journal = appended.journal;

    const authority = committedAuthority(state, "computer");
    appended = appendJournalAiAuthority(journal, state, authority, "accepted-command", [0]);
    state = appended.state;
    journal = appended.journal;

    appended = appendJournalAdvance(journal, state);
    state = appended.state;
    journal = appended.journal;

    expect(journal.operations.map((operation) => operation.kind)).toEqual([
      "accepted-command",
      "accepted-command",
      "ai-authority-commit",
      "advance",
    ]);
    expect(journal.operations.map((operation) => operation.order)).toEqual([0, 1, 2, 3]);
    expect(journal.finalTick).toBe(1);
    expect(journal.finalHash).toBe(hashMatchState(state));

    const parsedJournal = parseMatchCommandJournalFile(serializeMatchCommandJournalFile(journal));
    const journalReplay = replayMatchJournal(base, parsedJournal);
    expect(journalReplay.state).toEqual(state);
    expect(hashMatchState(journalReplay.state)).toBe(journal.finalHash);

    const finalRuntime = runtimeMetadata(state, 3, 17.25);
    const replay = createMatchReplayFile(save, journal, finalRuntime);
    const parsedReplay = parseMatchReplayFile(serializeMatchReplayFile(replay));
    const replayed = replayMatchReplay(parsedReplay);
    expect(replayed.state).toEqual(state);
    expect(replayed.runtime).toEqual(finalRuntime);
    expect(replayed.runtime).not.toEqual(save.runtime);
  });

  it("replays a commandless AI authority transition without running the reducer", () => {
    const base = createPersistenceState(903);
    let state = base;
    let journal = createMatchCommandJournalFile(base);
    const authority = committedAuthority(state, "computer");

    const committed = appendJournalAiAuthority(journal, state, authority, "commandless");
    state = committed.state;
    journal = committed.journal;
    const advanced = appendJournalAdvance(journal, state);
    state = advanced.state;
    journal = advanced.journal;

    const replayed = replayMatchJournal(base, journal).state;
    expect(replayed).toEqual(state);
    expect(replayed.aiControllers[0]).toEqual(authority);
    expect(hashMatchState(replayed)).toBe(journal.finalHash);
  });

  it("rejects a hash-consistent replay authority that is invalid for the live map", () => {
    const base = createPersistenceState(904);
    const save = createMatchSaveFile(base, runtimeMetadata(base));
    const committed = appendJournalAiAuthority(
      createMatchCommandJournalFile(base),
      base,
      committedAuthority(base, "computer"),
      "commandless",
    );
    const replay = createMatchReplayFile(
      save,
      committed.journal,
      runtimeMetadata(committed.state),
      committed.state,
    );
    const forged = JSON.parse(serializeMatchReplayFile(replay)) as any;
    forged.journal.operations[0].authority.regroupPoint = { x: 999, y: 999 };
    const forgedFinalState = JSON.parse(JSON.stringify(base)) as MatchState;
    forgedFinalState.aiControllers = forgedFinalState.aiControllers.map((authority) => (
      authority.playerId === "computer" ? forged.journal.operations[0].authority : authority
    ));
    const forgedFinalHash = hashMatchState(forgedFinalState);
    forged.journal.operations[0].postHash = forgedFinalHash;
    forged.journal.finalHash = forgedFinalHash;
    forged.finalHash = forgedFinalHash;
    forged.continuationHash = continuationHashForTest(forgedFinalHash, forged.runtime);

    expectPersistenceCode(() => parseMatchReplayFile(JSON.stringify(forged)), "INVALID_SCHEMA");
  });

  it("rejects rejected commands and invalid AI commit gates without advancing the cursor", () => {
    const state = createPersistenceState(904);
    const journal = createMatchCommandJournalFile(state);
    const enemy = firstUnit(state, "computer");

    expectPersistenceCode(() => appendJournalCommand(journal, state, envelope(state, "human", 0, {
      type: "move",
      entityIds: [enemy.id],
      target: { x: 1, y: 1 },
    }), "human"), "COMMAND_REJECTED");
    expect(journal.operations).toEqual([]);
    expect(journal.finalHash).toBe(hashMatchState(state));

    const authority = committedAuthority(state, "computer");
    expectPersistenceCode(
      () => appendJournalAiAuthority(journal, state, authority, "accepted-command", [99]),
      "AI_AUTHORITY_INVALID",
    );
    expectPersistenceCode(
      () => appendJournalAiAuthority(journal, state, authority, "commandless", [0]),
      "AI_AUTHORITY_INVALID",
    );
  });

  it("detects a validly-shaped command tamper at the exact post-operation hash", () => {
    const base = createPersistenceState(905);
    const unit = firstUnit(base, "human");
    const appended = appendJournalCommand(
      createMatchCommandJournalFile(base),
      base,
      envelope(base, "human", 0, { type: "setStance", entityIds: [unit.id], stance: "defensive" }),
      "human",
    );
    const raw = JSON.parse(serializeMatchCommandJournalFile(appended.journal)) as Record<string, any>;
    raw.operations[0].envelope.command.stance = "holdGround";
    const structurallyValid = parseMatchCommandJournalFile(JSON.stringify(raw));

    expectPersistenceCode(() => replayMatchJournal(base, structurallyValid), "HASH_MISMATCH");
  });

  it("rejects incompatible versions, visibility, unknown fields and hash-chain corruption explicitly", () => {
    const state = createPersistenceState(906);
    const save = createMatchSaveFile(state, runtimeMetadata(state));

    for (const [field, value, code] of [
      ["schemaVersion", 99, "UNSUPPORTED_SCHEMA_VERSION"],
      ["protocolVersion", "future/99", "UNSUPPORTED_PROTOCOL_VERSION"],
      ["rulesVersion", "village-siege/future", "UNSUPPORTED_RULES_VERSION"],
      ["visibility", "recipient-safe", "VISIBILITY_MISMATCH"],
    ] as const) {
      const raw = JSON.parse(serializeMatchSaveFile(save)) as Record<string, unknown>;
      raw[field] = value;
      expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(raw)), code);
    }

    const unknown = JSON.parse(serializeMatchSaveFile(save)) as Record<string, unknown>;
    unknown.extra = true;
    expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(unknown)), "INVALID_SCHEMA");

    const journal = createMatchCommandJournalFile(state);
    const broken = { ...journal, finalHash: "00000000" } satisfies MatchCommandJournalFile;
    expectPersistenceCode(() => parseMatchCommandJournalFile(JSON.stringify(broken)), "HASH_MISMATCH");
  });

  it("rejects prototype keys and bounded parser-work violations before artifact use", () => {
    const state = createPersistenceState(907);
    const save = createMatchSaveFile(state, runtimeMetadata(state));
    const forbidden = JSON.parse(serializeMatchSaveFile(save)) as Record<string, any>;
    forbidden.runtime.constructor = "pollution";
    expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(forbidden)), "INVALID_SCHEMA");

    const deep = `${"[".repeat(MATCH_PERSISTENCE_MAX_DEPTH + 2)}0${"]".repeat(MATCH_PERSISTENCE_MAX_DEPTH + 2)}`;
    expectPersistenceCode(() => parseMatchSaveFile(deep), "PAYLOAD_TOO_LARGE");
    expectPersistenceCode(
      () => parseMatchSaveFile(JSON.stringify("x".repeat(MATCH_PERSISTENCE_MAX_STRING_LENGTH + 1))),
      "PAYLOAD_TOO_LARGE",
    );

    const farFuture = JSON.parse(serializeMatchSaveFile(save)) as Record<string, any>;
    farFuture.snapshot.tick = MATCH_PERSISTENCE_MAX_TICK + 1;
    expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(farFuture)), "PAYLOAD_TOO_LARGE");
  });

  it("exports independent byte limits and enforces the parser-side save gate", () => {
    expect(MATCH_SAVE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(MATCH_JOURNAL_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(MATCH_REPLAY_MAX_BYTES).toBe(4 * 1024 * 1024);
    expectPersistenceCode(() => parseMatchSaveFile("x".repeat(MATCH_SAVE_MAX_BYTES + 1)), "PAYLOAD_TOO_LARGE");
  });

  it("validates final replay runtime metadata against the final accepted sequence", () => {
    const base = createPersistenceState(908);
    const save = createMatchSaveFile(base, runtimeMetadata(base));
    const unit = firstUnit(base, "human");
    const appended = appendJournalCommand(
      createMatchCommandJournalFile(base),
      base,
      envelope(base, "human", 0, { type: "stop", entityIds: [unit.id] }),
      "human",
    );

    expectPersistenceCode(
      () => createMatchReplayFile(save, appended.journal, runtimeMetadata(appended.state, 0)),
      "INVALID_SCHEMA",
    );
    const finalRuntime = runtimeMetadata(appended.state, 2, 63);
    expect(createMatchReplayFile(save, appended.journal, finalRuntime).runtime).toEqual(finalRuntime);
  });

  it("rejects structurally valid saves with invalid map, player, entity, projectile, visibility or canonical simulation semantics", () => {
    const state = createPersistenceState(909);
    const save = createMatchSaveFile(state, runtimeMetadata(state));

    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.map.width = 0;
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.players[0].resources.food = "many";
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.entities.find((entity: any) => entity.kind === "unit").typeId = "foreignUnit";
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.projectiles.push({
        id: "projectile-invalid-ref",
        ownerId: "intruder",
        sourceId: "missing-source",
        profileId: "arrow",
        origin: { x: 1, y: 1 },
        position: { x: 1, y: 1 },
        targetId: null,
        targetPoint: { x: 2, y: 2 },
        fixedImpact: false,
        launchTick: 0,
        impactTick: 1,
        damage: 1,
        statusEffects: [],
        resolution: null,
      });
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.visibilityByPlayer[0].playerId = "intruder";
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.teamTownCenterLostAt.push({ teamId: "team-human", tick: 0 });
    });
  });

  it("cannot bypass strict AI and discriminated entity validation by recomputing the state hash", () => {
    const state = createPersistenceState(911);
    const save = createMatchSaveFile(state, runtimeMetadata(state));

    expectInvalidSaveMutation(save, (candidate) => {
      delete candidate.snapshot.state.aiControllers[0].telemetry.decisions;
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.aiControllers[0].enemyMemory.push({
        entityId: "memory-injected",
        ownerId: "human",
        kind: "unit",
        typeId: "villager",
        lastKnownPosition: { x: 1, y: 1 },
        healthPermille: 500,
        observedAtTick: 0,
        injected: true,
      });
    });
    expectInvalidSaveMutation(save, (candidate) => {
      candidate.snapshot.state.aiControllers[0].activeWave = {
        memberIds: ["unit-unknown", "unit-unknown"],
        targetEntityId: null,
        targetPosition: { x: 1, y: 1 },
        launchedAtTick: 0,
        baselineStrength: 1,
      };
    }, "AI_AUTHORITY_INVALID");
    expectInvalidSaveMutation(save, (candidate) => {
      const unit = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "unit");
      unit.order.injected = true;
    });
    expectInvalidSaveMutation(save, (candidate) => {
      const unit = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "unit");
      unit.statuses.push({ id: "burn", sourceId: unit.id, expiresAtTick: 10 });
    });
    expectInvalidSaveMutation(save, (candidate) => {
      const building = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "building");
      delete building.gateOpen;
    });
    expectInvalidSaveMutation(save, (candidate) => {
      const building = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "building");
      building.productionQueue.push({
        jobId: { commandSequence: 0, itemIndex: 0 },
        kind: "train",
        unitType: "foreignUnit",
        remainingTicks: 1,
        totalTicks: 1,
        paidCost: { food: 0, wood: 0, stone: 0 },
      });
    });
    expectInvalidSaveMutation(save, (candidate) => {
      const resource = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "resource");
      resource.injected = true;
    });

    const assault = createPersistenceState(912, {
      id: "villageAssault",
      width: 18,
      height: 16,
      layoutId: "pinehold",
    });
    const assaultSave = createMatchSaveFile(assault, runtimeMetadata(assault));
    expectInvalidSaveMutation(assaultSave, (candidate) => {
      const monster = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "monster");
      monster.combat.injected = true;
    });

    const rubbleState = createPersistenceState(913);
    rubbleState.entities.push({
      id: "rubble-regression",
      ownerId: null,
      kind: "rubble",
      typeId: "resinPalisade",
      position: { x: 15, y: 15 },
      hitPoints: 0,
      maxHitPoints: 0,
      stateRevision: 0,
      orientation: "ne",
      decayAtTick: 100,
    });
    const rubbleSave = createMatchSaveFile(rubbleState, runtimeMetadata(rubbleState));
    expectInvalidSaveMutation(rubbleSave, (candidate) => {
      const rubble = candidate.snapshot.state.entities.find((entity: any) => entity.kind === "rubble");
      delete rubble.orientation;
    });
  });

  it("rejects malformed projectile discriminants directly before continuation hashing", () => {
    const groundState = createPersistenceState(914);
    addGroundAreaProjectile(groundState);
    expect(() => createMatchSaveFile(groundState, runtimeMetadata(groundState))).not.toThrow();
    expectInvalidLiveStateMutation(groundState, (candidate) => {
      delete candidate.projectiles[0].fixedImpact;
    });
    expectInvalidLiveStateMutation(groundState, (candidate) => {
      candidate.projectiles[0].statusEffects = ["foreignStatus"];
    });
    expectInvalidLiveStateMutation(groundState, (candidate) => {
      candidate.projectiles[0].resolution.injected = true;
    });
    expectInvalidLiveStateMutation(groundState, (candidate) => {
      delete candidate.projectiles[0].resolution.damage.skillMultiplier;
    });
    expectInvalidLiveStateMutation(groundState, (candidate) => {
      candidate.projectiles[0].resolution.damage.sourceUnitType = "mage";
      candidate.projectiles[0].resolution.damage.abilityId = "emberSigil";
    });

    const lineState = createPersistenceState(915);
    addLineProjectile(lineState);
    expect(() => createMatchSaveFile(lineState, runtimeMetadata(lineState))).not.toThrow();
    expectInvalidLiveStateMutation(lineState, (candidate) => {
      delete candidate.projectiles[0].resolution.hitTargetIds;
    });
    expectInvalidLiveStateMutation(lineState, (candidate) => {
      candidate.projectiles[0].resolution.damage.sourceUnitType = "villager";
    });
    expectInvalidLiveStateMutation(lineState, (candidate) => {
      candidate.projectiles[0].resolution = null;
      candidate.projectiles[0].damage = 1;
      candidate.projectiles[0].fixedImpact = false;
    });
    expectInvalidLiveStateMutation(lineState, (candidate) => {
      candidate.projectiles[0].resolution.damage.sourceUnitType = "boarRider";
      candidate.projectiles[0].resolution.damage.abilityId = "tuskCharge";
    });
    expectInvalidLiveStateMutation(lineState, (candidate) => {
      candidate.projectiles[0].profileId = "musketTrace";
      candidate.projectiles[0].resolution = null;
      candidate.projectiles[0].damage = 1;
      candidate.projectiles[0].fixedImpact = false;
    });
  });

  it("rejects malformed team timers and victory state directly before continuation hashing", () => {
    const state = createPersistenceState(916);
    const finished = JSON.parse(JSON.stringify(state)) as MatchState;
    const defeatedPlayer = finished.players.find((player) => player.id === "computer")!;
    defeatedPlayer.surrendered = true;
    defeatedPlayer.eliminated = true;
    const defeatedTeam = finished.victory.teams.find((team) => team.teamId === defeatedPlayer.teamId)!;
    (defeatedTeam as any).eliminatedAtTick = finished.tick;
    (defeatedTeam as any).eliminationReason = "surrender";
    finished.phase = "finished";
    finished.winningTeamIds = ["team-human"];
    finished.finishReason = "surrender";
    finished.victory = {
      ...finished.victory,
      outcome: "victory",
      winningTeamIds: ["team-human"],
      finishReason: "surrender",
      triggeredReasons: ["surrender"],
      finishedAtTick: finished.tick,
    };
    expect(() => createMatchSaveFile(finished, runtimeMetadata(finished))).not.toThrow();
    expectInvalidLiveStateMutation(finished, (candidate) => {
      candidate.victory.outcome = "draw";
    });
    expectInvalidLiveStateMutation(finished, (candidate) => {
      for (const player of candidate.players.filter((entry: any) => entry.teamId === "team-human")) {
        player.eliminated = true;
      }
    });

    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.teamTownCenterLostAt.push({ teamId: "team-human", tick: 0, injected: true });
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.winningTeamIds = ["foreign-team"];
      candidate.victory.winningTeamIds = ["foreign-team"];
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.finishReason = "foreignReason";
      candidate.victory.finishReason = "foreignReason";
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.victory.policy.injected = true;
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      delete candidate.victory.teams[0].timedControlScoreTicks;
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      delete candidate.victory.control.contested;
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.victory.triggeredReasons = ["landmark"];
    });
  });

  it("rejects malformed fog sightings and a reused generated ID cursor before continuation hashing", () => {
    const state = createPersistenceState(917);
    const enemyBuilding = state.entities.find((entity) => (
      entity.kind === "building" && entity.ownerId === "computer" && entity.typeId === "townCenter"
    ))!;
    const visibility = state.visibilityByPlayer.find((entry) => entry.playerId === "human")!;
    visibility.staleEnemySightings = [{
      entityId: enemyBuilding.id,
      ownerId: "computer",
      typeId: enemyBuilding.typeId,
      position: { ...enemyBuilding.position },
      hitPoints: enemyBuilding.hitPoints,
      maxHitPoints: enemyBuilding.maxHitPoints,
      stateRevision: enemyBuilding.stateRevision,
      orientation: enemyBuilding.orientation,
      complete: enemyBuilding.complete,
      constructionRemainingTicks: enemyBuilding.constructionRemainingTicks,
      healthBand: "healthy",
      blocksMovement: true,
      observedAtTick: state.tick,
    }];
    expect(() => createMatchSaveFile(state, runtimeMetadata(state))).not.toThrow();

    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.visibilityByPlayer.find((entry: any) => entry.playerId === "human").staleEnemySightings[0].healthBand = "destroyed";
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.visibilityByPlayer.find((entry: any) => entry.playerId === "human").staleEnemySightings[0].ownerId = "human";
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.visibilityByPlayer.find((entry: any) => entry.playerId === "human").staleEnemySightings[0].observedAtTick = state.tick + 1;
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.visibilityByPlayer.find((entry: any) => entry.playerId === "human").staleEnemySightings[0].injected = true;
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.visibilityByPlayer.find((entry: any) => entry.playerId === "human").staleEnemySightings[0].position = {
        x: candidate.map.width - 1,
        y: candidate.map.height - 1,
      };
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.entities.find((entity: any) => entity.id === enemyBuilding.id).position = {
        x: candidate.map.width - 1,
        y: candidate.map.height - 1,
      };
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.nextEntityNumber = Number(enemyBuilding.id.match(/-(\d+)$/)![1]);
    });
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.aiControllers[0].enemyMemory = [{
        entityId: "unit-99999",
        ownerId: "human",
        kind: "unit",
        typeId: "villager",
        lastKnownPosition: { x: 1, y: 1 },
        healthPermille: 500,
        observedAtTick: candidate.tick,
      }];
    });

    const namespaceState = createInitialState({
      seed: 918,
      matchId: "entity-namespace-player",
      players: [
        { id: "unit-99999", teamId: "team-human", villageId: "pinehold" },
        { id: "computer", teamId: "team-ai", villageId: "riverstead", ai: { personality: "balanced" } },
      ],
    });
    expect(() => createMatchSaveFile(namespaceState, {
      humanPlayerId: "unit-99999",
      nextPlayerSequence: 0,
      accumulatorMs: 0,
      aiBudgetMs: 5,
    })).not.toThrow();
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.players.find((player: any) => player.id === "human").advancement = {
        producerId: "building-99999",
        targetTier: "stronghold",
        remainingTicks: 10,
      };
    });
  });

  it("rejects AI authority observations and decisions dated after the state tick", () => {
    const state = createPersistenceState(919);
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.aiControllers[0].lastDecisionTick = candidate.tick + 1;
    }, "AI_AUTHORITY_INVALID");
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.aiControllers[0].phaseStartedTick = candidate.tick + 1;
    }, "AI_AUTHORITY_INVALID");
    expectInvalidLiveStateMutation(state, (candidate) => {
      candidate.aiControllers[0].enemyMemory = [{
        entityId: "remembered-enemy",
        ownerId: "human",
        kind: "unit",
        typeId: "villager",
        lastKnownPosition: { x: 1, y: 1 },
        healthPermille: 500,
        observedAtTick: candidate.tick + 1,
      }];
    }, "AI_AUTHORITY_INVALID");
    expectInvalidLiveStateMutation(state, (candidate) => {
      const memberId = candidate.entities.find((entity: any) => entity.kind === "unit" && entity.ownerId === "computer").id;
      candidate.aiControllers[0].activeWave = {
        memberIds: [memberId],
        targetEntityId: null,
        targetPosition: { x: 1, y: 1 },
        launchedAtTick: candidate.tick + 1,
        baselineStrength: 1,
      };
    }, "AI_AUTHORITY_INVALID");
  });

  it("replays a real command, AI reduction and combat across 10,000 fixed advances deterministically", () => {
    const base = createLongReplayState(910);
    const save = createMatchSaveFile(base, runtimeMetadata(base));
    let state = base;
    let journal = createMatchCommandJournalFile(base);
    const human = firstUnit(state, "human");
    const computer = firstUnit(state, "computer");
    let appended = appendJournalCommand(
      journal,
      state,
      envelope(state, "human", 0, { type: "attack", entityIds: [human.id], targetId: computer.id }),
      "human",
    );
    state = appended.state;
    journal = appended.journal;
    let combatDamageObserved = false;
    let combatRemovalObserved = false;
    let aiReductionCommitted = false;

    for (let tick = 0; tick < 10_000; tick += 1) {
      appended = appendJournalAdvance(journal, state);
      state = appended.state;
      journal = appended.journal;
      combatDamageObserved ||= appended.events.some((event) => event.type === "entityDamaged" && event.targetId === computer.id);
      combatRemovalObserved ||= appended.events.some((event) => event.type === "entityRemoved" && event.entityId === computer.id);
      if (combatRemovalObserved && !aiReductionCommitted) {
        const currentAuthority = state.aiControllers.find((authority) => authority.playerId === "computer")!;
        const reduced = reduceAi(currentAuthority, getAiObservation(state, "computer"), 5);
        expect(reduced.commands).toEqual([]);
        expect(reduced.authority).not.toEqual(currentAuthority);
        appended = appendJournalAiAuthority(journal, state, reduced.authority, "commandless");
        state = appended.state;
        journal = appended.journal;
        aiReductionCommitted = true;
      }
    }

    expect(journal.finalTick).toBe(10_000);
    expect(combatDamageObserved).toBe(true);
    expect(combatRemovalObserved).toBe(true);
    expect(aiReductionCommitted).toBe(true);
    expect(journal.operations.some((operation) => operation.kind === "accepted-command" && operation.source === "human")).toBe(true);
    expect(journal.operations.some((operation) => operation.kind === "ai-authority-commit")).toBe(true);
    const first = replayMatchJournal(base, journal).state;
    const second = replayMatchJournal(base, journal).state;
    expect(second).toEqual(first);
    expect(hashMatchState(first)).toBe(journal.finalHash);
    expect(hashMatchState(second)).toBe(journal.finalHash);

    const replay = createMatchReplayFile(save, journal, runtimeMetadata(state, 1), state);
    const serialized = serializeMatchReplayFile(replay);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(MATCH_REPLAY_MAX_BYTES);
  }, 120_000);
});

function createPersistenceState(
  seed: number,
  map?: { id: "open" | "villageAssault"; width: number; height: number; layoutId?: "pinehold" | "riverstead" | "highcrag" },
): MatchState {
  return createInitialState({
    seed,
    matchId: `persistence-${seed}`,
    map,
    players: [
      { id: "human", teamId: "team-human", villageId: "pinehold" },
      { id: "computer", teamId: "team-ai", villageId: "riverstead", ai: { personality: "balanced", difficulty: "veteran" } },
    ],
  });
}

function createLongReplayState(seed: number): MatchState {
  const state = createPersistenceState(seed);
  state.map = { id: "open", width: 8, height: 5 };
  const humanTownCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "human")!;
  const computerTownCenter = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "computer")!;
  const human = firstUnit(state, "human");
  const computer = firstUnit(state, "computer");
  humanTownCenter.position = { x: 0, y: 0 };
  computerTownCenter.position = { x: 5, y: 0 };
  human.position = { x: 3, y: 3 };
  computer.position = { x: 4, y: 3 };
  computer.hitPoints = 1;
  state.entities = [humanTownCenter, human, computerTownCenter, computer];
  state.projectiles = [];
  for (const player of state.players) {
    player.population = { used: 1, capacity: 15 };
    player.resources = { food: 0, wood: 0, stone: 0 };
  }
  const allTiles = Array.from({ length: state.map.width * state.map.height }, (_, index) => index);
  for (const visibility of state.visibilityByPlayer) {
    visibility.visibleTileIndices = [...allTiles];
    visibility.exploredTileIndices = [...allTiles];
    visibility.staleEnemySightings = [];
    visibility.observerRevision = "";
    visibility.sightingRevision = "";
    visibility.revision = 0;
  }
  state.teamTownCenterLostAt = [];
  state.victory.policy = {
    commandCenterConquest: null,
    elimination: false,
    landmark: null,
    timedControl: null,
  };
  return state;
}

function runtimeMetadata(
  state: MatchState,
  nextPlayerSequence = state.players.find((player) => player.id === "human")!.lastSequence + 1,
  accumulatorMs = 0,
): MatchRuntimeSaveMetadata {
  return { humanPlayerId: "human", nextPlayerSequence, accumulatorMs, aiBudgetMs: 5 };
}

function firstUnit(state: MatchState, playerId: string): UnitEntityState {
  return state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === playerId)!;
}

function committedAuthority(state: MatchState, playerId: string): AiAuthorityState {
  const current = state.aiControllers.find((authority) => authority.playerId === playerId)!;
  return {
    ...current,
    randomState: (current.randomState + 1) >>> 0,
    lastDecisionTick: state.tick,
    telemetry: { ...current.telemetry, decisions: current.telemetry.decisions + 1 },
  };
}

function envelope(
  state: MatchState,
  playerId: string,
  sequence: number,
  command: GameCommand,
): CommandEnvelope {
  return { matchId: state.matchId, playerId, sequence, clientTick: state.tick, command };
}

function expectPersistenceCode(action: () => unknown, code: MatchPersistenceError["code"]): void {
  try {
    action();
    throw new Error(`Expected MatchPersistenceError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(MatchPersistenceError);
    expect((error as MatchPersistenceError).code).toBe(code);
  }
}

function expectInvalidSaveMutation(
  save: ReturnType<typeof createMatchSaveFile>,
  mutate: (candidate: any) => void,
  expectedCode: MatchPersistenceError["code"] = "INVALID_SCHEMA",
): void {
  const candidate = JSON.parse(serializeMatchSaveFile(save)) as any;
  mutate(candidate);
  candidate.snapshot.hash = hashMatchState(candidate.snapshot.state as MatchState);
  candidate.snapshot.tick = candidate.snapshot.state.tick;
  expectPersistenceCode(() => parseMatchSaveFile(JSON.stringify(candidate)), expectedCode);
}

function expectInvalidLiveStateMutation(
  state: MatchState,
  mutate: (candidate: any) => void,
  expectedCode: MatchPersistenceError["code"] = "INVALID_SCHEMA",
): void {
  const candidate = JSON.parse(JSON.stringify(state)) as MatchState;
  mutate(candidate);
  expectPersistenceCode(() => createMatchSaveFile(candidate, runtimeMetadata(candidate)), expectedCode);
}

function addGroundAreaProjectile(state: MatchState): void {
  state.projectiles.push({
    id: "projectile-ground-regression",
    ownerId: "human",
    sourceId: "removed-archer",
    profileId: "pinningVolley",
    origin: { x: 1, y: 1 },
    position: { x: 1, y: 1 },
    targetId: null,
    targetPoint: { x: 4, y: 1 },
    fixedImpact: true,
    launchTick: state.tick,
    impactTick: state.tick + 2,
    damage: 0,
    statusEffects: ["slow"],
    resolution: {
      kind: "groundArea",
      groupId: "projectile-group-regression",
      hitAll: false,
      maxHitsPerTarget: 2,
      radiusSquared: 2.25,
      damage: {
        sourceUnitType: "archer",
        baseDamage: 18,
        abilityId: "pinningVolley",
        skillMultiplier: 0.55,
        structureMultiplierBonus: 1,
      },
    },
  } as any);
}

function addLineProjectile(state: MatchState): void {
  state.projectiles.push({
    id: "projectile-line-regression",
    ownerId: "human",
    sourceId: "removed-heavy-crossbowman",
    profileId: "breachingBolt",
    origin: { x: 1, y: 2 },
    position: { x: 1, y: 2 },
    targetId: null,
    targetPoint: { x: 7, y: 2 },
    fixedImpact: true,
    launchTick: state.tick,
    impactTick: state.tick + 2,
    damage: 0,
    statusEffects: [],
    resolution: {
      kind: "line",
      origin: { x: 1, y: 2 },
      maxTargets: 2,
      halfWidth: 1,
      lastResolvedDistance: 0,
      hitTargetIds: [],
      damage: {
        sourceUnitType: "heavyCrossbowman",
        baseDamage: 38,
        abilityId: "breachingBolt",
        skillMultiplier: 1.6,
        structureMultiplierBonus: 1,
      },
    },
  } as any);
}

function continuationHashForTest(finalStateHash: string, runtime: MatchRuntimeSaveMetadata): string {
  const canonical = stableStringifyForTest({
    domain: "village-siege/continuation/1",
    finalStateHash,
    runtime: {
      humanPlayerId: runtime.humanPlayerId,
      nextPlayerSequence: runtime.nextPlayerSequence,
      accumulatorMs: runtime.accumulatorMs,
      aiBudgetMs: runtime.aiBudgetMs,
    },
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringifyForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringifyForTest).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyForTest(record[key])}`).join(",")}}`;
}
