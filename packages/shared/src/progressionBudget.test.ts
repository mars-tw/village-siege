import { describe, expect, it } from "vitest";
import { VILLAGE_ASSAULT_LAYOUT_IDS } from "./battlefield";
import { BUILDINGS, SETTLEMENT_TIERS, STARTING_RESOURCES, TECHNOLOGIES, TECHNOLOGY_ORDER, UNITS } from "./content";
import { COMBAT_UNIT_IDS } from "./combat";
import { createInitialState } from "./simulation";
import type { BuildingType, ResourceKind, ResourceWallet } from "./protocol";

describe("complete settlement progression economy", () => {
  it("lets each home fund both advances, all research and a mixed army without raiding the opponent's finite deposits", () => {
    // Include actual population space, defensive construction and replacement
    // troops: a tree that only fits before the first lost soldier is unusable.
    const construction: BuildingType[] = ["house", "house", "house", "house", "lumberCamp", "farmstead", "barracks", "archeryRange", "beastStable", "mageSanctum", "gunWorkshop", "siegeWorkshop", "defenseTower", "defenseTower", "copperLandmark"];
    const costs: ResourceWallet[] = [
      ...construction.map(type => BUILDINGS[type].cost),
      SETTLEMENT_TIERS.stronghold.cost, SETTLEMENT_TIERS.artificer.cost,
      ...TECHNOLOGY_ORDER.map(id => TECHNOLOGIES[id].cost),
      ...COMBAT_UNIT_IDS.flatMap(type => [UNITS[type].cost, UNITS[type].cost]),
    ];
    for (const layoutId of VILLAGE_ASSAULT_LAYOUT_IDS) {
      const state = createInitialState({ map: { id: "villageAssault", width: 32, height: 24, layoutId } });
      for (const west of [true, false]) {
        for (const resourceKind of ["wood", "stone"] as ResourceKind[]) {
          const deposits = state.entities.filter(entity => entity.kind === "resource" && entity.typeId === resourceKind && (entity.position.x < 16) === west);
          const available = STARTING_RESOURCES[resourceKind] + deposits.reduce((total, entity) => total + (entity.kind === "resource" ? entity.amount : 0), 0);
          const needed = costs.reduce((total, cost) => total + cost[resourceKind], 0);
          expect(available, `${layoutId}/${west ? "west" : "east"} ${resourceKind}: full progression and defenses`).toBeGreaterThanOrEqual(needed);
          expect(deposits.every(entity => entity.kind === "resource" && entity.renewAtTick === null)).toBe(true);
        }
      }
    }
  });
});
