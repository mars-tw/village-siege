import { describe, expect, it } from "vitest";
import {
  createInitialState,
  toVisibleSnapshot,
  updateVisibilityState,
  type MatchState,
  type ProjectileState,
  type PublicEntityState,
  type VisibleSnapshot,
} from "@village-siege/shared";
import type { ResolvedMatchFrame } from "../src/network/AuthoritativeMatchStore.js";
import { AuthoritativeFrameInterpolator } from "../src/match/AuthoritativeFrameInterpolator.js";

describe("AuthoritativeFrameInterpolator", () => {
  it("interpolates only consecutive authoritative entity/projectile positions without mutating either snapshot", () => {
    const { base, next, movingEntityId, projectileId } = movingSnapshots();
    const baseJson = JSON.stringify(base);
    const nextJson = JSON.stringify(next);
    const interpolator = new AuthoritativeFrameInterpolator();

    interpolator.push(frame("snapshot", base), 0);
    interpolator.push(frame("delta", next), 100);

    const start = interpolator.sample(100)!;
    const middle = interpolator.sample(150)!;
    const end = interpolator.sample(200)!;
    expect(start.alpha).toBe(0);
    expect(middle.alpha).toBe(0.5);
    expect(end.alpha).toBe(1);
    expect(position(start.entityPositions, movingEntityId)).toEqual(entity(base, movingEntityId).position);
    expect(position(middle.entityPositions, movingEntityId)).toEqual({
      x: (entity(base, movingEntityId).position.x + entity(next, movingEntityId).position.x) / 2,
      y: (entity(base, movingEntityId).position.y + entity(next, movingEntityId).position.y) / 2,
    });
    expect(position(end.entityPositions, movingEntityId)).toEqual(entity(next, movingEntityId).position);
    expect(position(middle.projectilePositions, projectileId)).toEqual({ x: 5, y: 4 });
    expect(JSON.stringify(base)).toBe(baseJson);
    expect(JSON.stringify(next)).toBe(nextJson);
    expect(interpolator.current).toEqual(next);
  });

  it("clamps before/after the interpolation interval and never extrapolates", () => {
    const { base, next, movingEntityId } = movingSnapshots();
    const interpolator = new AuthoritativeFrameInterpolator();
    interpolator.push(frame("snapshot", base), 0);
    interpolator.push(frame("delta", next), 100);

    const before = interpolator.sample(-10_000)!;
    const after = interpolator.sample(10_000)!;
    expect(before.alpha).toBe(0);
    expect(after.alpha).toBe(1);
    expect(position(before.entityPositions, movingEntityId)).toEqual(entity(base, movingEntityId).position);
    expect(position(after.entityPositions, movingEntityId)).toEqual(entity(next, movingEntityId).position);
  });

  it("snaps on tick gaps and every full snapshot so recovery cannot blend unrelated worlds", () => {
    const { base, next, movingEntityId } = movingSnapshots();
    const interpolator = new AuthoritativeFrameInterpolator();
    interpolator.push(frame("snapshot", base), 0);
    interpolator.push(frame("delta", next), 100);
    expect(interpolator.sample(150)?.alpha).toBe(0.5);

    const gap = cloneSnapshot(next, { serverTick: next.serverTick + 2 });
    gap.entities = gap.entities.map((candidate) => candidate.id === movingEntityId
      ? { ...candidate, position: { x: 12, y: 7 } }
      : candidate);
    interpolator.push(frame("delta", gap), 200);
    expect(interpolator.sample(200)).toMatchObject({
      fromServerTick: gap.serverTick,
      toServerTick: gap.serverTick,
      alpha: 1,
    });
    expect(position(interpolator.sample(200)!.entityPositions, movingEntityId)).toEqual({ x: 12, y: 7 });

    const full = cloneSnapshot(gap, { serverTick: gap.serverTick + 1 });
    full.entities = full.entities.map((candidate) => candidate.id === movingEntityId
      ? { ...candidate, position: { x: 3, y: 11 } }
      : candidate);
    interpolator.push(frame("snapshot", full), 300);
    expect(interpolator.sample(350)).toMatchObject({
      fromServerTick: full.serverTick,
      toServerTick: full.serverTick,
      alpha: 1,
    });
    expect(position(interpolator.sample(350)!.entityPositions, movingEntityId)).toEqual({ x: 3, y: 11 });
  });

  it("snaps spawns and immediately omits removed or fog-hidden entities", () => {
    const { base, next, movingEntityId } = movingSnapshots();
    const interpolator = new AuthoritativeFrameInterpolator();
    interpolator.push(frame("snapshot", base), 0);
    interpolator.push(frame("delta", next), 100);

    const spawned: PublicEntityState = {
      ...entity(next, movingEntityId),
      id: "fresh-authoritative-unit",
      position: { x: 9, y: 9 },
    };
    const changed = cloneSnapshot(next, { serverTick: next.serverTick + 1 });
    changed.entities = [
      ...changed.entities.filter((candidate) => candidate.id !== movingEntityId),
      spawned,
    ];
    changed.visibleEntityIds = changed.entities.map((candidate) => candidate.id);
    interpolator.push(frame("delta", changed), 200);

    const sample = interpolator.sample(200)!;
    expect(sample.entityPositions.some((candidate) => candidate.id === movingEntityId)).toBe(false);
    expect(position(sample.entityPositions, spawned.id)).toEqual(spawned.position);
  });

  it("returns presentation positions separately from authoritative wallet, health and victory", () => {
    const { base, next } = movingSnapshots();
    const interpolator = new AuthoritativeFrameInterpolator();
    interpolator.push(frame("snapshot", base), 0);
    interpolator.push(frame("delta", next), 100);

    const sample = interpolator.sample(150)!;
    expect(Object.keys(sample).sort()).toEqual([
      "alpha",
      "entityPositions",
      "fromServerTick",
      "projectilePositions",
      "toServerTick",
    ]);
    expect(interpolator.current).toEqual(next);
  });
});

function movingSnapshots() {
  const state = createState();
  const moving = state.entities.find((candidate) => candidate.kind === "unit" && candidate.ownerId === "player-1")!;
  const projectile: ProjectileState = {
    id: "projectile-client-interpolation",
    ownerId: "player-1",
    sourceId: moving.id,
    profileId: "arrow",
    origin: { x: 3, y: 4 },
    position: { x: 3, y: 4 },
    targetId: null,
    targetPoint: { x: 9, y: 4 },
    fixedImpact: true,
    launchTick: 0,
    impactTick: 3,
    damage: 10,
    statusEffects: [],
    resolution: null,
  };
  state.projectiles.push(projectile);
  const base = toVisibleSnapshot(state, "player-1");
  moving.position = { x: moving.position.x + 2, y: moving.position.y };
  moving.stateRevision += 1;
  projectile.position = { x: 7, y: 4 };
  state.tick += 1;
  updateVisibilityState(state);
  const next = toVisibleSnapshot(state, "player-1");
  return { base, next, movingEntityId: moving.id, projectileId: projectile.id };
}

function createState(): MatchState {
  return createInitialState({
    matchId: "match-11111111111111111111111111111111",
    seed: 51,
    map: { id: "villageAssault", width: 18, height: 16, layoutId: "pinehold" },
    players: [
      { id: "player-1", teamId: "team-1", villageId: "pinehold" },
      { id: "player-2", teamId: "team-2", villageId: "riverstead" },
    ],
    spawnOverrides: {
      "player-1": { x: 3, y: 4 },
      "player-2": { x: 14, y: 11 },
    },
  });
}

function frame(kind: ResolvedMatchFrame["kind"], snapshot: VisibleSnapshot): ResolvedMatchFrame {
  return { kind, snapshot, events: [] };
}

function entity(snapshot: VisibleSnapshot, id: string): PublicEntityState {
  const found = snapshot.entities.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing fixture entity ${id}`);
  return found;
}

function position(items: readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number } }[], id: string) {
  return items.find((candidate) => candidate.id === id)?.position;
}

function cloneSnapshot(snapshot: VisibleSnapshot, changes: Partial<VisibleSnapshot>): MutableVisibleSnapshot {
  return Object.assign(JSON.parse(JSON.stringify(snapshot)) as MutableVisibleSnapshot, changes);
}

type MutableVisibleSnapshot = {
  -readonly [Key in keyof VisibleSnapshot]: VisibleSnapshot[Key];
};
