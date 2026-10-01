import { expect, it } from "vitest";
import { productionProgressLabel } from "../src/game/productionProgress";
it("distinguishes a paid trained unit waiting for exit from completed research",()=>{
  expect(productionProgressLabel({ kind:"train",remainingTicks:0,totalTicks:60 })).toBe("等候出營");
  expect(productionProgressLabel({ kind:"research",remainingTicks:0,totalTicks:60 })).toBe("100%");
});
it("shows incomplete training progress with bounded percentages",()=>{
  expect(productionProgressLabel({ kind:"train",remainingTicks:30,totalTicks:60 })).toBe("50%");
});
