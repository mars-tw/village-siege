import { describe, expect, it } from "vitest";
import { hashMatchState, previewBuildCommand, type UnitEntityState } from "@village-siege/shared";
import { createVillageAssaultRuntime } from "../src/game/villageAssaultRuntime";

function scenario() {
  const runtime = createVillageAssaultRuntime({ playerVillageId: "pinehold", aiPersonality: "balanced", aiDifficulty: "novice", seed: 2501 });
  const builder = runtime.state.entities.find((entity): entity is UnitEntityState => entity.kind === "unit" && entity.ownerId === runtime.playerId && entity.typeId === "villager")!;
  const command = { type: "build", builderIds: [builder.id], buildingType: "house", origin: { x: 8, y: 14 } } as const;
  return { runtime, builder, command };
}

describe("construction preview shares authoritative validation", () => {
  it("does not charge or change orders while previewing a reachable foundation", () => {
    const { runtime, command } = scenario();
    const before = hashMatchState(runtime.state);
    expect(previewBuildCommand(runtime.state, runtime.playerId, command)).toBe(true);
    expect(hashMatchState(runtime.state)).toBe(before);
    expect(runtime.issuePlayerCommand(command).accepted).toBe(true);
  });
  it("rejects another moving unit on the footprint before submitting the same rejected command", () => {
    const { runtime, builder, command } = scenario();
    runtime.state.entities.push({ ...structuredClone(builder), id: "preview-blocker", position: { ...command.origin } });
    const before = hashMatchState(runtime.state);
    expect(previewBuildCommand(runtime.state, runtime.playerId, command)).toBe(false);
    expect(hashMatchState(runtime.state)).toBe(before);
    expect(runtime.issuePlayerCommand(command)).toMatchObject({ accepted: false, rejectCode: "TARGET_NOT_REACHABLE" });
  });
});
