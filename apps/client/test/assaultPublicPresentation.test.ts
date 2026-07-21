import { describe, expect, it } from "vitest";
import type { PublicEntityState } from "@village-siege/shared";
import { publicPlayerHomePosition } from "../src/game/assaultPublicPresentation.js";

describe("publicPlayerHomePosition", () => {
  it("centers an east-slot recipient on its own town center instead of a fixed west coordinate", () => {
    const entities = [
      entity("west-town", "building", "west-player", "townCenter", { x: 5, y: 8 }),
      entity("east-unit", "unit", "east-player", "villager", { x: 13, y: 8 }),
      entity("east-town", "building", "east-player", "townCenter", { x: 14, y: 7 }),
    ];

    expect(publicPlayerHomePosition(entities, "east-player")).toEqual({ x: 14, y: 7 });
  });

  it("falls back to another owned public entity when the town center is gone", () => {
    const entities = [
      entity("east-barracks", "building", "east-player", "barracks", { x: 12, y: 9 }),
      entity("east-unit", "unit", "east-player", "villager", { x: 13, y: 8 }),
    ];

    expect(publicPlayerHomePosition(entities, "east-player")).toEqual({ x: 12, y: 9 });
    expect(publicPlayerHomePosition(entities, "missing-player")).toBeNull();
  });
});

function entity(
  id: string,
  kind: "building" | "unit",
  ownerId: string,
  typeId: string,
  position: { readonly x: number; readonly y: number },
): PublicEntityState {
  return {
    id,
    kind,
    ownerId,
    typeId,
    position,
    hitPoints: 100,
    maxHitPoints: 100,
  } as PublicEntityState;
}
