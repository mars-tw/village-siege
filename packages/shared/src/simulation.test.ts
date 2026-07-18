import { describe, expect, it } from "vitest";
import { nextUint32 } from "./random";
import {
  applyCommand,
  createInitialState,
  hashMatchState,
  hashReplay,
  stepSimulation,
  validateCommand,
  type MatchState,
} from "./simulation";
import type { CommandEnvelope } from "./protocol";

function envelope(state: MatchState, sequence: number, command: CommandEnvelope["command"]): CommandEnvelope {
  return { matchId: state.matchId, playerId: "player-1", sequence, clientTick: state.tick, command };
}

describe("deterministic shared simulation", () => {
  it("repeats seeded random values and replay hashes", () => {
    const randomA = nextUint32(20260717);
    const randomB = nextUint32(20260717);
    expect(randomA).toEqual(randomB);

    const initial = createInitialState({ seed: 20260717, matchId: "replay" });
    const villager = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    const commands = [envelope(initial, 0, { type: "move", entityIds: [villager.id], target: { x: 12, y: 12 } })];
    const first = stepSimulation(initial, commands, 80).state;
    const second = stepSimulation(initial, commands, 80).state;
    expect(hashMatchState(first)).toBe(hashMatchState(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(hashReplay(initial, commands, 80)).toBe(hashReplay(initial, commands, 80));
  });

  it("rejects malformed, foreign, unaffordable, and duplicate commands without mutation", () => {
    const initial = createInitialState({ seed: 7, matchId: "validation" });
    const originalHash = hashMatchState(initial);
    const foreign = initial.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-2")!;
    expect(validateCommand(initial, envelope(initial, 0, { type: "move", entityIds: [foreign.id], target: { x: 5, y: 5 } }))).toEqual({ ok: false, code: "ENTITY_NOT_OWNED" });
    expect(validateCommand(initial, { ...envelope(initial, 0, { type: "surrender" }), forgedDamage: 999 })).toEqual({ ok: false, code: "INVALID_PAYLOAD" });

    const poor = JSON.parse(JSON.stringify(initial)) as MatchState;
    poor.players[0]!.resources = { food: 0, wood: 0, stone: 0 };
    const ownVillager = poor.entities.find((entity) => entity.kind === "unit" && entity.ownerId === "player-1")!;
    expect(validateCommand(poor, envelope(poor, 0, { type: "build", builderIds: [ownVillager.id], buildingType: "house", origin: { x: 10, y: 10 } }))).toEqual({ ok: false, code: "INSUFFICIENT_RESOURCES" });

    const accepted = applyCommand(initial, envelope(initial, 1, { type: "move", entityIds: [ownVillager.id], target: { x: 10, y: 10 } }));
    expect(accepted.validation).toEqual({ ok: true });
    expect(validateCommand(accepted.state, envelope(accepted.state, 1, { type: "stop", entityIds: [ownVillager.id] }))).toEqual({ ok: false, code: "STALE_OR_DUPLICATE_SEQUENCE" });
    expect(hashMatchState(initial)).toBe(originalHash);
  });
});
