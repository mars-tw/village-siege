import { describe, expect, it } from "vitest";
import { progressionCards } from "../src/game/progressionPresentation";
import { createVillageAssaultRuntime } from "../src/game/villageAssaultRuntime";
import type { PublicEntityState, VisibleSnapshot } from "@village-siege/shared";

const base = () => createVillageAssaultRuntime({ playerVillageId: "pinehold", aiPersonality: "balanced", seed: 24 }).view;
const building = (typeId: string, complete = true): PublicEntityState => ({ id: typeId, kind: "building", ownerId: "player-1", typeId,
  position: {x:7,y:8}, hitPoints:100,maxHitPoints:100,stateRevision:1,complete,ownerControl:{rallyPoint:null,productionQueue:[]} }) as PublicEntityState;

describe("player development presentation", () => {
  it("identifies actual upgrade prerequisites and gives a building action", () => {
    const card = progressionCards(base(), "era")[0]!;
    expect(card.status).toContain("邊軍兵營"); expect(card.status).toContain("木作營");
    expect(card.needs.find(n => n.label === "木作營")?.action).toEqual({kind:"build",type:"lumberCamp"});
    expect(card.action).toBeUndefined();
  });
  it("exposes the correct advance command only after structures and resources are available", () => {
    const view=base(), ready={...view,wallet:{food:600,wood:500,stone:200},entities:[...view.entities,building("barracks"),building("lumberCamp")]};
    expect(progressionCards(ready,"era")[0]?.action).toMatchObject({kind:"command",command:{type:"advanceSettlement",targetTier:"stronghold"}});
    expect(progressionCards({...ready,wallet:{food:0,wood:500,stone:200}},"era")[0]?.status).toBe("還缺 糧 500");
  });
  it("offers era guidance before research and producer construction after era unlock", () => {
    expect(progressionCards(base(),"economy")[0]?.action).toEqual({kind:"tab",tab:"era"});
    expect(progressionCards({...base(),settlementTier:"stronghold"},"economy")[0]?.action).toEqual({kind:"build",type:"farmstead"});
  });
  it("gates late research on its real technology prerequisite and never offers a duplicate completed technology", () => {
    const view:VisibleSnapshot={...base(),settlementTier:"artificer",wallet:{food:1000,wood:1000,stone:1000},entities:[...base().entities,building("gunWorkshop"),building("siegeWorkshop")]};
    expect(progressionCards(view,"artificer")[0]?.status).toContain("疊革戰具");
    const ready={...view,completedTechnologyIds:["layeredHarness" as const,"surveyedFoundations" as const]};
    expect(progressionCards(ready,"artificer")[0]?.action).toMatchObject({kind:"command",command:{type:"research",technologyId:"starfireBores"}});
    const done={...ready,completedTechnologyIds:[...ready.completedTechnologyIds,"starfireBores" as const]};
    expect(progressionCards(done,"artificer")[0]?.action).toBeUndefined();
    expect(progressionCards(done,"artificer")[0]?.status).toBe("研究完成");
  });
});
