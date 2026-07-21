import { describe, expect, it } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  isMatchReplicationFrame,
  type MatchDeltaFrame,
  type VisibleSnapshot,
} from "./protocol.js";
import { RULES_VERSION } from "./content.js";
import {
  ReplicationError,
  applyVisibleSnapshotDelta,
  createVisibleSnapshotDelta,
} from "./replication.js";
import {
  createInitialState,
  hashVisibleSnapshot,
  stepSimulation,
  toVisibleSnapshot,
} from "./simulation.js";

function closeBattlefield() {
  return createInitialState({
    matchId: "replication-security",
    map: { width: 40, height: 40 },
    spawnOverrides: {
      "player-1": { x: 3, y: 3 },
      "player-2": { x: 12, y: 3 },
    },
  });
}

function withChecksum(snapshot: VisibleSnapshot): VisibleSnapshot {
  const { checksum: _checksum, ...body } = snapshot;
  return { ...body, checksum: hashVisibleSnapshot(body) };
}

describe("recipient-bound replication security", () => {
  it("rejects a valid delta applied to another recipient without mutating that recipient base", () => {
    const initialState = closeBattlefield();
    const nextState = stepSimulation(initialState, [], 1).state;
    const playerOneBase = toVisibleSnapshot(initialState, "player-1");
    const playerOneDelta = createVisibleSnapshotDelta(
      playerOneBase,
      toVisibleSnapshot(nextState, "player-1"),
    );
    const playerTwoBase = toVisibleSnapshot(initialState, "player-2");
    const playerTwoBefore = structuredClone(playerTwoBase);

    expect(() => applyVisibleSnapshotDelta(playerTwoBase, playerOneDelta)).toThrowError(ReplicationError);
    expect(playerTwoBase).toEqual(playerTwoBefore);
  });

  it("atomically rejects foreign ownerControl injection even when the attacker recomputes the visible checksum", () => {
    const initialState = closeBattlefield();
    const nextState = stepSimulation(initialState, [], 1).state;
    const base = toVisibleSnapshot(initialState, "player-1");
    const next = toVisibleSnapshot(nextState, "player-1");
    const enemyIndex = next.entities.findIndex((entity) => (
      entity.kind === "building" && entity.ownerId === "player-2"
    ));
    expect(enemyIndex).toBeGreaterThanOrEqual(0);
    const forgedEntities = [...next.entities];
    forgedEntities[enemyIndex] = {
      ...forgedEntities[enemyIndex]!,
      ownerControl: { productionQueue: [], rallyPoint: { x: 39, y: 39 } },
    };
    const forgedNext = withChecksum({ ...next, entities: forgedEntities });
    const forgedDelta = createVisibleSnapshotDelta(base, forgedNext);
    const baseBefore = structuredClone(base);

    expect(() => applyVisibleSnapshotDelta(base, forgedDelta)).toThrowError(ReplicationError);
    expect(base).toEqual(baseBefore);
  });

  it("rejects a world event that carries forged foreign building controls on an otherwise valid delta", () => {
    const initialState = closeBattlefield();
    const nextState = stepSimulation(initialState, [], 1).state;
    const base = toVisibleSnapshot(initialState, "player-1");
    const next = toVisibleSnapshot(nextState, "player-1");
    const delta = createVisibleSnapshotDelta(base, next);
    const enemyBuilding = next.entities.find((entity) => (
      entity.kind === "building" && entity.ownerId === "player-2"
    ));
    if (!enemyBuilding) throw new Error("Expected visible enemy building");
    const forgedFrame = {
      kind: "delta",
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      matchId: next.matchId,
      recipientPlayerId: "player-1",
      serverTick: next.serverTick,
      events: [{
        type: "entityUpdated",
        entity: {
          ...enemyBuilding,
          ownerControl: { productionQueue: [], rallyPoint: { x: 39, y: 39 } },
        },
      }],
      delta,
    } as unknown as MatchDeltaFrame;

    expect(isMatchReplicationFrame(forgedFrame)).toBe(false);
  });
});
