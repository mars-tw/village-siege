import { describe, expect, it } from "vitest";
import type { PublicEntityState } from "@village-siege/shared";
import { constructionPreviewOccupiedCells } from "../src/game/constructionPreview";

function entity(id:string,kind:PublicEntityState["kind"],x:number,hp=100):PublicEntityState {
  return {id,kind,typeId:kind === "resource" ? "wood" : kind === "monster" ? "rootback" : "villager",ownerId:kind === "unit" ? "player-1" : null,position:{x,y:2},hitPoints:hp,maxHitPoints:100,stateRevision:1} as PublicEntityState;
}
describe("construction preview occupancy",()=>{
  it("allows selected builders to vacate, but marks other living units occupied",()=>{
    expect(constructionPreviewOccupiedCells([entity("builder","unit",2),entity("guard","unit",3)],new Set(["builder"]))).toEqual([{x:3,y:2}]);
  });
  it("does not reserve dead units or dynamic monsters",()=>{
    expect(constructionPreviewOccupiedCells([entity("dead","unit",2,0),entity("monster","monster",3)],new Set())).toEqual([]);
  });
  it("keeps resource reservations even when the resource is depleted",()=>{
    expect(constructionPreviewOccupiedCells([entity("wood","resource",4,0)],new Set())).toEqual([{x:4,y:2}]);
  });
});
