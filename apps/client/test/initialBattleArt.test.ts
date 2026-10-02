import { describe, expect, it } from "vitest";
import { initialBattleArtIds } from "../src/game/initialBattleArt";
import { createVillageAssaultRuntime } from "../src/game/villageAssaultRuntime";

describe("initial battle art follows the recipient's actual view", () => {
  it("does not block a new game on unseen monsters or untrained military", () => {
    const runtime = createVillageAssaultRuntime({ playerVillageId: "pinehold", aiPersonality: "balanced", seed: 2601 });
    expect(initialBattleArtIds(runtime.view)).toEqual([]);
  });
  it("requires existing visible military and monsters when restoring a battle", () => {
    const runtime = createVillageAssaultRuntime({ playerVillageId: "pinehold", aiPersonality: "balanced", seed: 2601 });
    const unit = runtime.view.entities.find(entity => entity.kind === "unit")!;
    const view = { ...runtime.view, visibleEntityIds: ["visible-monster"], entities: [
      { ...unit, id: "visible-archer", typeId: "archer" as const },
      { ...unit, id: "second-archer", typeId: "archer" as const },
      { ...unit, id: "visible-monster", ownerId: null, kind: "monster" as const, typeId: "miremaw" as const },
    ] };
    expect(initialBattleArtIds(view)).toEqual(["archer", "miremaw"]);
  });
  it("does not request hidden opponents or monster kinds", () => {
    const runtime = createVillageAssaultRuntime({ playerVillageId: "pinehold", aiPersonality: "balanced", seed: 2601 });
    const unit = runtime.view.entities.find(entity => entity.kind === "unit")!;
    const view = { ...runtime.view, visibleEntityIds: [], entities: [
      { ...unit, id: "hidden-archer", ownerId: "player-2", typeId: "archer" as const },
      { ...unit, id: "hidden-monster", ownerId: null, kind: "monster" as const, typeId: "miremaw" as const },
    ] };
    expect(initialBattleArtIds(view)).toEqual([]);
  });
});
