import { describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: {} }));
import { terrainBoundaryEdges } from "../src/game/battleMap";

describe("shoreline material boundary", () => {
  it("omits shared water edges so decoration never reveals an internal tile lattice", () => {
    const edges = terrainBoundaryEdges(["GGGG", "GWWG", "GGGG"], "W");
    expect(edges).toHaveLength(6);
    expect(edges).not.toContainEqual({ point: { x: 1, y: 1 }, edge: "se" });
    expect(edges).not.toContainEqual({ point: { x: 2, y: 1 }, edge: "nw" });
  });

  it("preserves legal crossing gaps and handles outside-map edges", () => {
    const rows = ["WSW", "WWW"];
    const edges = terrainBoundaryEdges(rows, "W");
    expect(edges).toContainEqual({ point: { x: 0, y: 0 }, edge: "se" });
    expect(edges).toContainEqual({ point: { x: 2, y: 0 }, edge: "nw" });
    expect(edges).toContainEqual({ point: { x: 1, y: 1 }, edge: "ne" });
    expect(edges.every(edge => rows[edge.point.y]![edge.point.x] === "W")).toBe(true);
    expect(terrainBoundaryEdges(["GGG"], "W")).toEqual([]);
  });
});
