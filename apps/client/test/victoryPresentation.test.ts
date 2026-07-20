import { describe, expect, it } from "vitest";
import type { VictoryFinishReason, VictoryState } from "@village-siege/shared";
import { createVictoryPresentation } from "../src/game/victoryPresentation.js";

const PLAYING: VictoryState = {
  policy: {
    commandCenterConquest: { rebuildGraceTicks: 600 },
    elimination: true,
    landmark: { buildingType: "copperLandmark", requiredCount: 1, holdTicks: 900 },
    timedControl: { point: { x: 8, y: 8 }, radius: 2, startsAtTick: 600, targetTicks: 1_200 },
  },
  teams: [
    { teamId: "team-player", landmarkHoldTicks: 120, timedControlScoreTicks: 80, eliminatedAtTick: null, eliminationReason: null },
    { teamId: "team-ai", landmarkHoldTicks: 0, timedControlScoreTicks: 0, eliminatedAtTick: null, eliminationReason: null },
  ],
  control: { controllerTeamId: "team-player", contested: false },
  outcome: null,
  winningTeamIds: [],
  finishReason: null,
  triggeredReasons: [],
  finishedAtTick: null,
};

describe("victory presentation", () => {
  it("shows fixed-tick landmark and control progress without adding an interaction mode", () => {
    const beforeControl = createVictoryPresentation(PLAYING, "team-player", 500);
    expect(beforeControl).toMatchObject({ outcome: "playing", tone: "normal" });
    expect(beforeControl.objectiveText).toContain("拓界標 12/90 秒");
    expect(beforeControl.objectiveText).toContain("中域 10 秒後開放");

    const active = createVictoryPresentation(PLAYING, "team-player", 700);
    expect(active.objectiveText).toContain("中域 8/120 秒（我方控制）");
    expect(active.compactObjectiveText).toContain("中域 8/120");
  });

  it.each([
    ["conquest", "議事核心失守"],
    ["elimination", "戰力已被殲滅"],
    ["landmark", "拓界標控制完成"],
    ["timedControl", "中域控制時限達成"],
    ["surrender", "明示投降"],
    ["disconnect", "連線中斷判負"],
  ] as const)("maps %s to a complete persistent result", (reason, label) => {
    const result = createVictoryPresentation(finished(reason, ["team-player"]), "team-player", 420);
    expect(result).toMatchObject({ outcome: "victory", tone: "success", selectionText: "戰局已結束｜選擇再戰或返回" });
    expect(result.objectiveText).toBe(`勝利｜${label}`);
    expect(result.announcement).toContain("可選擇再戰或返回");
    expect(result.compactObjectiveText.split("\n")).toHaveLength(2);
  });

  it("distinguishes defeat and multi-trigger draw from the same public result", () => {
    const defeat = createVictoryPresentation(finished("landmark", ["team-ai"]), "team-player", 900);
    expect(defeat).toMatchObject({ outcome: "defeat", tone: "warning", objectiveText: "戰敗｜拓界標控制完成" });

    const drawState: VictoryState = {
      ...finished("landmark", ["team-player", "team-ai"]),
      outcome: "draw",
      triggeredReasons: ["landmark", "timedControl"],
    };
    const draw = createVictoryPresentation(drawState, "team-player", 900);
    expect(draw).toMatchObject({ outcome: "draw", tone: "normal" });
    expect(draw.objectiveText).toBe("和局｜拓界標控制完成、中域控制時限達成");
    expect(draw.compactObjectiveText).toBe("和局\n同刻達成勝途");
  });
});

function finished(reason: VictoryFinishReason, winningTeamIds: readonly string[]): VictoryState {
  return {
    ...PLAYING,
    outcome: "victory",
    winningTeamIds,
    finishReason: reason,
    triggeredReasons: [reason],
    finishedAtTick: 420,
  };
}
