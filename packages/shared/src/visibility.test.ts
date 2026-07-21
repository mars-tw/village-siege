import { describe, expect, it } from "vitest";
import { createInitialState, hashMatchState, isEntityVisibleToPlayer, projectDomainEventsForPlayer, stepSimulation, toPublicEntity, toVisibleSnapshot, validateCommand, type BuildingEntityState, type ProjectileState, type UnitEntityState } from "./simulation";
import { isVisibleSnapshot, type DomainEvent } from "./protocol";
import { decodeExploredTilesRle, encodeExploredTilesRle, getPlayerVisibilityState, isTileExploredByPlayer, isTileVisibleToPlayer, updateVisibilityState } from "./visibility";

describe("deterministic player visibility", () => {
  it("creates sorted current and explored masks with stable RLE", () => {
    const state = createSeparatedMatch();
    const visibility = getPlayerVisibilityState(state, "player-1");

    expect(visibility.visibleTileIndices.length).toBeGreaterThan(0);
    expect(visibility.visibleTileIndices).toEqual([...visibility.visibleTileIndices].sort((left, right) => left - right));
    expect(visibility.exploredTileIndices).toEqual(visibility.visibleTileIndices);
    expect(isTileVisibleToPlayer(state, "player-1", { x: 3, y: 3 })).toBe(true);
    expect(isTileExploredByPlayer(state, "player-1", { x: 3, y: 3 })).toBe(true);
    const encoded = encodeExploredTilesRle(3, 2, [0, 1, 4]);
    expect(encoded).toBe("1:2,0:2,1:1,0:1");
    expect(decodeExploredTilesRle(3, 2, encoded)).toEqual([0, 1, 4]);
  });

  it("keeps explored tiles after observers move while current visibility changes", () => {
    const state = createSeparatedMatch();
    const oldVisible = new Set(getPlayerVisibilityState(state, "player-1").visibleTileIndices);
    const observers = state.entities.filter((entity) => entity.ownerId === "player-1");
    for (const [index, observer] of observers.entries()) observer.position = { x: 30 + (index % 2), y: 30 + Math.floor(index / 2) };

    updateVisibilityState(state);

    const visibility = getPlayerVisibilityState(state, "player-1");
    expect(visibility.visibleTileIndices.some((index) => !oldVisible.has(index))).toBe(true);
    expect([...oldVisible].every((index) => visibility.exploredTileIndices.includes(index))).toBe(true);
    expect(isTileVisibleToPlayer(state, "player-1", { x: 3, y: 3 })).toBe(false);
    expect(isTileExploredByPlayer(state, "player-1", { x: 3, y: 3 })).toBe(true);
  });

  it("shares team vision but isolates hostile factions", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      players: [
        { id: "player-1", teamId: "allies", villageId: "pinehold" },
        { id: "player-2", teamId: "allies", villageId: "riverstead" },
        { id: "player-3", teamId: "hostile", villageId: "highcrag" },
      ],
      spawnOverrides: {
        "player-1": { x: 3, y: 3 },
        "player-2": { x: 20, y: 3 },
        "player-3": { x: 35, y: 35 },
      },
    });
    const alliedTown = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const hostileTown = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-3" && entity.typeId === "townCenter")!;

    expect(isEntityVisibleToPlayer(state, "player-1", alliedTown)).toBe(true);
    expect(isEntityVisibleToPlayer(state, "player-1", hostileTown)).toBe(false);
    expect(toVisibleSnapshot(state, "player-1").entities.some((entity) => entity.id === alliedTown.id)).toBe(true);
    expect(toVisibleSnapshot(state, "player-1").entities.some((entity) => entity.id === hostileTown.id)).toBe(false);
  });

  it("publishes a sorted five-player roster without player resources or AI authority state", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      players: [
        { id: "player-e", teamId: "team-3", villageId: "sunfield" },
        { id: "player-a", teamId: "team-1", villageId: "pinehold" },
        { id: "player-d", teamId: "team-3", villageId: "marshwatch" },
        { id: "player-c", teamId: "team-2", villageId: "highcrag" },
        { id: "player-b", teamId: "team-1", villageId: "riverstead" },
      ],
      spawnOverrides: {
        "player-a": { x: 3, y: 3 },
        "player-b": { x: 20, y: 3 },
        "player-c": { x: 35, y: 3 },
        "player-d": { x: 3, y: 35 },
        "player-e": { x: 35, y: 35 },
      },
    });
    state.players.find((player) => player.id === "player-c")!.surrendered = true;
    state.players.find((player) => player.id === "player-e")!.eliminated = true;

    const snapshot = toVisibleSnapshot(state, "player-a");
    const serialized = JSON.stringify(snapshot.participants);

    expect(snapshot.recipientTeamId).toBe("team-1");
    expect(snapshot.participants.map((participant) => participant.id)).toEqual([
      "player-a", "player-b", "player-c", "player-d", "player-e",
    ]);
    expect(snapshot.participants.find((participant) => participant.id === "player-c")?.surrendered).toBe(true);
    expect(snapshot.participants.find((participant) => participant.id === "player-e")?.eliminated).toBe(true);
    expect(Object.keys(snapshot.participants[0]!)).toEqual(["id", "teamId", "villageId", "surrendered", "eliminated"]);
    expect(serialized).not.toContain("resources");
    expect(serialized).not.toContain("lastSequence");
    expect(serialized).not.toContain("personality");
    expect(serialized).not.toContain("difficulty");
    expect(isVisibleSnapshot(snapshot)).toBe(true);
  });

  it("projects queue, rally point and advancement only for the recipient's own buildings", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      players: [
        { id: "player-1", teamId: "allies", villageId: "pinehold" },
        { id: "player-2", teamId: "allies", villageId: "riverstead" },
        { id: "player-3", teamId: "hostile", villageId: "highcrag" },
      ],
      spawnOverrides: {
        "player-1": { x: 3, y: 3 },
        "player-2": { x: 20, y: 3 },
        "player-3": { x: 35, y: 35 },
      },
    });
    const ownTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    const alliedTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const hostileTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-3" && entity.typeId === "townCenter")!;
    ownTown.productionQueue.push({
      jobId: { commandSequence: 8, itemIndex: 0 },
      kind: "train",
      unitType: "villager",
      remainingTicks: 90,
      totalTicks: 120,
      paidCost: { food: 50, wood: 0, stone: 0 },
    });
    ownTown.rallyPoint = { x: 9, y: 8 };
    alliedTown.rallyPoint = { x: 19, y: 9 };
    hostileTown.rallyPoint = { x: 34, y: 34 };
    state.players.find((player) => player.id === "player-1")!.advancement = {
      producerId: ownTown.id,
      targetTier: "stronghold",
      remainingTicks: 311,
    };
    state.players.find((player) => player.id === "player-2")!.advancement = {
      producerId: alliedTown.id,
      targetTier: "stronghold",
      remainingTicks: 917,
    };
    state.players.find((player) => player.id === "player-3")!.advancement = {
      producerId: hostileTown.id,
      targetTier: "stronghold",
      remainingTicks: 918,
    };
    const scout = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1")!;
    scout.position = { x: hostileTown.position.x - 1, y: hostileTown.position.y };
    updateVisibilityState(state);

    const snapshot = toVisibleSnapshot(state, "player-1");
    const ownPublic = snapshot.entities.find((entity) => entity.id === ownTown.id)!;
    const alliedPublic = snapshot.entities.find((entity) => entity.id === alliedTown.id)!;
    const hostilePublic = snapshot.entities.find((entity) => entity.id === hostileTown.id)!;

    expect(ownPublic.ownerControl).toEqual({
      productionQueue: [{
        jobId: { commandSequence: 8, itemIndex: 0 },
        kind: "train",
        unitType: "villager",
        remainingTicks: 90,
        totalTicks: 120,
        paidCost: { food: 50, wood: 0, stone: 0 },
      }],
      rallyPoint: { x: 9, y: 8 },
    });
    expect(alliedPublic.ownerControl).toBeUndefined();
    expect(hostilePublic.ownerControl).toBeUndefined();
    expect(snapshot.advancement).toEqual({ producerId: ownTown.id, targetTier: "stronghold", remainingTicks: 311 });
    expect(JSON.stringify(snapshot)).not.toContain('"remainingTicks":917');
    expect(JSON.stringify(snapshot)).not.toContain('"remainingTicks":918');
    expect(isVisibleSnapshot(snapshot)).toBe(true);
  });

  it("derives presentation activity without exposing unit orders, ability ids or targets", () => {
    const state = createSeparatedMatch();
    const villager = state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    villager.order = { type: "gather", targetId: "private-resource-target", resourceKind: "wood", phase: "toSource", dropOffId: "private-dropoff" };
    villager.combat = {
      phase: "windup",
      action: "ability",
      abilityId: "private-ability-id",
      target: { kind: "entity", entityId: "private-combat-target" },
      commitTick: state.tick + 1,
      readyTick: state.tick + 2,
    };

    const publicEntity = toPublicEntity(villager);
    const serialized = JSON.stringify(publicEntity);

    expect(publicEntity).toMatchObject({ civilianActivity: "gathering", combatActivity: "casting", combatPhase: "windup" });
    expect(serialized).not.toContain("private-resource-target");
    expect(serialized).not.toContain("private-dropoff");
    expect(serialized).not.toContain("private-ability-id");
    expect(serialized).not.toContain("private-combat-target");
  });

  it("rejects construction whose full footprint is not currently visible without mutating state", () => {
    const state = createSeparatedMatch();
    const builder = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1" && entity.typeId === "villager")!;
    const before = hashMatchState(state);

    expect(validateCommand(state, {
      matchId: state.matchId,
      playerId: "player-1",
      sequence: 0,
      clientTick: state.tick,
      command: { type: "build", builderIds: [builder.id], buildingType: "house", origin: { x: 20, y: 20 } },
    })).toEqual({ ok: false, code: "TARGET_NOT_VISIBLE" });
    expect(hashMatchState(state)).toBe(before);
  });

  it("allows movement into fog without revealing a hidden occupied destination", () => {
    const state = createSeparatedMatch();
    const mover = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const hiddenTown = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const command = {
      matchId: state.matchId,
      playerId: "player-1",
      sequence: 0,
      clientTick: state.tick,
      command: { type: "attackMove" as const, entityIds: [mover.id], target: { ...hiddenTown.position } },
    };

    expect(isTileVisibleToPlayer(state, "player-1", hiddenTown.position)).toBe(false);
    expect(validateCommand(state, command)).toEqual({ ok: true });

    mover.position = { x: hiddenTown.position.x - 2, y: hiddenTown.position.y };
    updateVisibilityState(state);
    expect(isTileVisibleToPlayer(state, "player-1", hiddenTown.position)).toBe(true);
    expect(validateCommand(state, command)).toEqual({ ok: false, code: "TARGET_NOT_REACHABLE" });
  });

  it("remembers only the last observed hostile building state and clears it after re-scouting an empty site", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      spawnOverrides: { "player-1": { x: 3, y: 3 }, "player-2": { x: 12, y: 3 } },
    });
    const enemyTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    expect(isEntityVisibleToPlayer(state, "player-1", enemyTown)).toBe(true);
    const observed = getPlayerVisibilityState(state, "player-1").staleEnemySightings.find((sighting) => sighting.entityId === enemyTown.id)!;

    for (const [index, observer] of state.entities.filter((entity) => entity.ownerId === "player-1").entries()) {
      observer.position = { x: 30 + (index % 2), y: 30 + Math.floor(index / 2) };
    }
    enemyTown.hitPoints -= 200;
    enemyTown.stateRevision += 1;
    updateVisibilityState(state);
    const hidden = getPlayerVisibilityState(state, "player-1").staleEnemySightings.find((sighting) => sighting.entityId === enemyTown.id)!;
    expect(hidden.hitPoints).toBe(observed.hitPoints);
    expect(hidden.stateRevision).toBe(observed.stateRevision);

    state.entities = state.entities.filter((entity) => entity.id !== enemyTown.id);
    const scout = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    scout.position = { ...observed.position };
    updateVisibilityState(state);
    expect(getPlayerVisibilityState(state, "player-1").staleEnemySightings.some((sighting) => sighting.entityId === enemyTown.id)).toBe(false);
  });

  it("records the final continuously visible tick before a hostile building leaves sight", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      spawnOverrides: { "player-1": { x: 3, y: 3 }, "player-2": { x: 12, y: 3 } },
    });
    const enemyTown = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;

    state.tick = 5;
    updateVisibilityState(state);
    expect(getPlayerVisibilityState(state, "player-1").staleEnemySightings.find((sighting) => sighting.entityId === enemyTown.id)?.observedAtTick).toBe(5);

    for (const [index, observer] of state.entities.filter((entity) => entity.ownerId === "player-1").entries()) {
      observer.position = { x: 30 + (index % 2), y: 30 + Math.floor(index / 2) };
    }
    state.tick = 6;
    updateVisibilityState(state);
    expect(getPlayerVisibilityState(state, "player-1").staleEnemySightings.find((sighting) => sighting.entityId === enemyTown.id)?.observedAtTick).toBe(5);
  });

  it("clears a stale multi-cell building when any remembered footprint cell is re-scouted", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      spawnOverrides: { "player-1": { x: 3, y: 3 }, "player-2": { x: 12, y: 3 } },
    });
    const enemyTown = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    const visibility = getPlayerVisibilityState(state, "player-1");
    expect(visibility.staleEnemySightings.some((sighting) => sighting.entityId === enemyTown.id)).toBe(true);

    state.entities = state.entities.filter((entity) => entity.id !== enemyTown.id);
    visibility.visibleTileIndices = [enemyTown.position.y * state.map.width + enemyTown.position.x + 1];
    updateVisibilityState(state);

    expect(visibility.staleEnemySightings.some((sighting) => sighting.entityId === enemyTown.id)).toBe(false);
  });

  it("filters hidden live entities and masks projectile source and target ids without changing the recipient checksum", () => {
    const state = createSeparatedMatch();
    const hiddenEnemy = state.entities.find((entity) => entity.ownerId === "player-2" && entity.kind === "unit")!;
    expect(isEntityVisibleToPlayer(state, "player-1", hiddenEnemy)).toBe(false);
    const hiddenProjectile: ProjectileState = {
      id: "hidden-projectile",
      ownerId: "player-2",
      sourceId: hiddenEnemy.id,
      profileId: "arrow",
      origin: { x: 3, y: 3 },
      position: { x: 3, y: 3 },
      targetId: null,
      targetPoint: { ...hiddenEnemy.position },
      fixedImpact: false,
      launchTick: state.tick,
      impactTick: state.tick + 5,
      damage: 10,
      statusEffects: [],
      resolution: null,
    };
    state.projectiles.push(hiddenProjectile);
    const before = toVisibleSnapshot(state, "player-1");

    hiddenEnemy.hitPoints -= 7;
    hiddenEnemy.position = { x: hiddenEnemy.position.x - 1, y: hiddenEnemy.position.y };
    hiddenEnemy.stateRevision += 1;
    hiddenProjectile.targetId = hiddenEnemy.id;
    updateVisibilityState(state);
    const after = toVisibleSnapshot(state, "player-1");

    expect(before).toEqual(after);
    expect(after.entities.some((entity) => entity.id === hiddenEnemy.id)).toBe(false);
    expect(after.projectiles.find((projectile) => projectile.id === hiddenProjectile.id)).toMatchObject({
      sourceId: null,
      targetId: null,
      targetPoint: { x: 3, y: 3 },
    });
  });

  it("projects events per recipient and masks hidden source ids", () => {
    const state = createSeparatedMatch();
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const hiddenEnemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    const events: DomainEvent[] = [
      { type: "commandAccepted", sequence: 3, serverTick: state.tick },
      { type: "commandAccepted", sequence: 4, serverTick: state.tick },
      { type: "entityDamaged", sourceId: hiddenEnemy.id, targetId: ownUnit.id, amount: 5, hitPoints: ownUnit.hitPoints - 5 },
      { type: "entityDamaged", sourceId: ownUnit.id, targetId: hiddenEnemy.id, amount: 5, hitPoints: hiddenEnemy.hitPoints - 5 },
      { type: "projectileImpacted", projectileId: "hidden-impact", position: { ...hiddenEnemy.position }, targetIds: [hiddenEnemy.id] },
      { type: "settlementAdvanced", playerId: "player-2", producerId: "enemy-town", settlementTier: "stronghold" },
    ];

    expect(projectDomainEventsForPlayer(state, "player-1", { serverTick: state.tick, events }, [3])).toEqual([
      { type: "commandAccepted", sequence: 3, serverTick: state.tick },
      { type: "entityDamaged", sourceId: null, targetId: ownUnit.id, amount: 5, hitPoints: ownUnit.hitPoints - 5 },
    ]);
  });

  it("rebuilds entity events from authority and strips forged foreign building controls", () => {
    const state = createInitialState({
      map: { width: 40, height: 40 },
      players: [
        { id: "player-1", teamId: "allies", villageId: "pinehold" },
        { id: "player-2", teamId: "allies", villageId: "riverstead" },
        { id: "player-3", teamId: "hostile", villageId: "highcrag" },
      ],
      spawnOverrides: {
        "player-1": { x: 3, y: 3 },
        "player-2": { x: 20, y: 3 },
        "player-3": { x: 35, y: 35 },
      },
    });
    const ownTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-1" && entity.typeId === "townCenter")!;
    const alliedTown = state.entities.find((entity): entity is BuildingEntityState => entity.kind === "building" && entity.ownerId === "player-2" && entity.typeId === "townCenter")!;
    ownTown.rallyPoint = { x: 9, y: 8 };
    const forgedAlliedEvent = {
      type: "entityUpdated",
      entity: {
        ...toPublicEntity(alliedTown),
        ownerControl: { productionQueue: [], rallyPoint: { x: 39, y: 39 } },
      },
    } as unknown as DomainEvent;

    const projected = projectDomainEventsForPlayer(state, "player-1", {
      serverTick: state.tick,
      events: [
        forgedAlliedEvent,
        { type: "entityUpdated", entity: toPublicEntity(ownTown) },
      ],
    });

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ type: "entityUpdated", entity: { id: alliedTown.id } });
    expect((projected[0] as Extract<DomainEvent, { type: "entityUpdated" }>).entity.ownerControl).toBeUndefined();
    expect((projected[1] as Extract<DomainEvent, { type: "entityUpdated" }>).entity.ownerControl).toEqual({
      productionQueue: [],
      rallyPoint: { x: 9, y: 8 },
    });
  });

  it("projects only visible hostile tactical signals and rebuilds their privacy-safe payload", () => {
    const state = createSeparatedMatch();
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const visibleEnemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    const hiddenEnemy = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2")!;
    visibleEnemy.position = { x: ownUnit.position.x + 1, y: ownUnit.position.y };
    updateVisibilityState(state);

    const visibleWithPrivateFields = {
      type: "tacticalSignalRaised",
      actingPlayerId: "player-2",
      signal: "retreating",
      anchorEntityId: visibleEnemy.id,
      emittedAtTick: state.tick,
      targetPosition: { ...hiddenEnemy.position },
      memberIds: [visibleEnemy.id, hiddenEnemy.id],
    } as unknown as DomainEvent;
    const events: DomainEvent[] = [
      visibleWithPrivateFields,
      { type: "tacticalSignalRaised", actingPlayerId: "player-2", signal: "assaulting", anchorEntityId: hiddenEnemy.id, emittedAtTick: state.tick },
      { type: "tacticalSignalRaised", actingPlayerId: "player-2", signal: "alarm", anchorEntityId: ownUnit.id, emittedAtTick: state.tick },
      { type: "tacticalSignalRaised", actingPlayerId: "player-1", signal: "scouting", anchorEntityId: ownUnit.id, emittedAtTick: state.tick },
    ];

    expect(isEntityVisibleToPlayer(state, "player-1", visibleEnemy)).toBe(true);
    expect(isEntityVisibleToPlayer(state, "player-1", hiddenEnemy)).toBe(false);
    expect(projectDomainEventsForPlayer(state, "player-1", { serverTick: state.tick, events })).toEqual([{
      type: "tacticalSignalRaised",
      actingPlayerId: "player-2",
      signal: "retreating",
      anchorEntityId: visibleEnemy.id,
      emittedAtTick: state.tick,
    }]);
  });

  it("keeps a hostile tactical signal when its visible anchor is removed in the same frame", () => {
    const state = createSeparatedMatch();
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const enemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    enemy.position = { x: ownUnit.position.x + 1, y: ownUnit.position.y };
    updateVisibilityState(state);
    const removed = toPublicEntity(enemy);
    state.entities = state.entities.filter((entity) => entity.id !== enemy.id);
    updateVisibilityState(state);
    const events: DomainEvent[] = [
      { type: "entityRemoved", entityId: enemy.id, entity: removed },
      { type: "tacticalSignalRaised", actingPlayerId: "player-2", signal: "retreating", anchorEntityId: enemy.id, emittedAtTick: state.tick },
    ];

    expect(projectDomainEventsForPlayer(state, "player-1", { serverTick: state.tick, events })).toEqual(events);
  });

  it("keeps a same-tick fatal monster provocation visible without leaking its hidden source team", () => {
    const state = createInitialState({
      seed: 81,
      matchId: "fatal-monster-provocation-visibility",
      map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
    });
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const hiddenEnemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    const monster = state.entities.find((entity) => entity.kind === "monster" && entity.typeId === "miremaw")!;
    ownUnit.position = { x: 2, y: 7 };
    hiddenEnemy.position = { x: 17, y: 15 };
    monster.position = { x: 3, y: 7 };
    const removedMonster = { ...toPublicEntity(monster), hitPoints: 0 };
    state.entities = state.entities.filter((entity) => entity.id !== monster.id);
    updateVisibilityState(state);

    expect(isEntityVisibleToPlayer(state, "player-1", hiddenEnemy)).toBe(false);
    expect(projectDomainEventsForPlayer(state, "player-1", { serverTick: state.tick, events: [
      { type: "monsterProvoked", monsterId: monster.id, monsterTypeId: monster.typeId, teamId: "team-2", sourceId: hiddenEnemy.id },
      { type: "entityRemoved", entityId: monster.id, entity: removedMonster, reason: "destroyed" },
    ] })).toEqual([
      { type: "monsterProvoked", monsterId: monster.id, monsterTypeId: monster.typeId, teamId: null, sourceId: null },
      { type: "entityRemoved", entityId: monster.id, entity: removedMonster, reason: "destroyed" },
    ]);
  });

  it("filters hidden impact target ids and never exposes an old hidden target point", () => {
    const state = createSeparatedMatch();
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const enemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    const hiddenPoint = { ...enemy.position };
    enemy.position = { x: ownUnit.position.x + 1, y: ownUnit.position.y };
    updateVisibilityState(state);

    const projected = projectDomainEventsForPlayer(state, "player-1", { serverTick: state.tick, events: [
      {
        type: "projectileSpawned",
        projectile: {
          id: "masked-target-point",
          ownerId: "player-1",
          sourceId: ownUnit.id,
          profileId: "arrow",
          position: { ...ownUnit.position },
          targetId: enemy.id,
          targetPoint: hiddenPoint,
          impactTick: state.tick + 5,
        },
      },
      {
        type: "projectileImpacted",
        projectileId: "mixed-impact",
        position: { ...ownUnit.position },
        targetIds: [ownUnit.id, "still-hidden-enemy"],
      },
    ] });

    expect(projected[0]).toMatchObject({
      type: "projectileSpawned",
      projectile: { targetId: enemy.id, targetPoint: enemy.position },
    });
    expect(projected[1]).toEqual({
      type: "projectileImpacted",
      projectileId: "mixed-impact",
      position: ownUnit.position,
      targetIds: [ownUnit.id],
    });
  });

  it("keeps visible fatal damage and removal events while omitting hidden removals", () => {
    const state = createSeparatedMatch();
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const visibleEnemy = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    const hiddenEnemy = state.entities.find((entity) => entity.kind === "building" && entity.ownerId === "player-2")!;
    visibleEnemy.position = { x: ownUnit.position.x + 1, y: ownUnit.position.y };
    updateVisibilityState(state);
    const visiblePublic = { ...toPublicEntity(visibleEnemy), hitPoints: 0 };
    const hiddenPublic = { ...toPublicEntity(hiddenEnemy), hitPoints: 0 };
    state.entities = state.entities.filter((entity) => entity.id !== visibleEnemy.id && entity.id !== hiddenEnemy.id);
    updateVisibilityState(state);

    expect(projectDomainEventsForPlayer(state, "player-1", { serverTick: state.tick, events: [
      { type: "entityDamaged", sourceId: ownUnit.id, targetId: visibleEnemy.id, amount: 999, hitPoints: 0 },
      { type: "entityRemoved", entityId: visibleEnemy.id, entity: visiblePublic, reason: "destroyed" },
      { type: "entityRemoved", entityId: hiddenEnemy.id, entity: hiddenPublic, reason: "destroyed" },
    ] })).toEqual([
      { type: "entityDamaged", sourceId: ownUnit.id, targetId: visibleEnemy.id, amount: 999, hitPoints: 0 },
      { type: "entityRemoved", entityId: visibleEnemy.id, entity: visiblePublic, reason: "destroyed" },
    ]);
  });

  it("rejects event batches that are not bound to the current authoritative tick", () => {
    const state = createSeparatedMatch();
    expect(() => projectDomainEventsForPlayer(state, "player-1", {
      serverTick: state.tick - 1,
      events: [],
    })).toThrow("single authoritative tick");
  });

  it("advances ordinary projectile positions every tick for snapshot-driven rendering", () => {
    const state = createSeparatedMatch();
    const ownUnit = state.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    state.projectiles.push({
      id: "moving-projectile",
      ownerId: "player-1",
      sourceId: ownUnit.id,
      profileId: "arrow",
      origin: { x: 3, y: 3 },
      position: { x: 3, y: 3 },
      targetId: null,
      targetPoint: { x: 8, y: 3 },
      fixedImpact: true,
      launchTick: state.tick,
      impactTick: state.tick + 5,
      damage: 0,
      statusEffects: [],
      resolution: null,
    });

    const next = stepSimulation(state, [], 1).state;
    expect(next.projectiles.find((projectile) => projectile.id === "moving-projectile")?.position).toEqual({ x: 4, y: 3 });
    expect(toVisibleSnapshot(next, "player-1").projectiles.find((projectile) => projectile.id === "moving-projectile")?.position).toEqual({ x: 4, y: 3 });
  });
});

function createSeparatedMatch() {
  return createInitialState({
    map: { width: 40, height: 40 },
    spawnOverrides: { "player-1": { x: 3, y: 3 }, "player-2": { x: 35, y: 35 } },
  });
}
