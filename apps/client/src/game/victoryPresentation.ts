import { TICKS_PER_SECOND, type VictoryFinishReason, type VictoryState } from "@village-siege/shared";

export type VictoryPresentationOutcome = "playing" | "victory" | "defeat" | "draw";

export interface VictoryPresentation {
  readonly outcome: VictoryPresentationOutcome;
  readonly objectiveText: string;
  readonly compactObjectiveText: string;
  readonly selectionText: string;
  readonly announcement: string;
  readonly tone: "normal" | "success" | "warning";
}

const FINISH_REASON_LABELS = {
  conquest: "議事核心失守",
  elimination: "戰力已被殲滅",
  landmark: "拓界標控制完成",
  timedControl: "中域控制時限達成",
  surrender: "明示投降",
  disconnect: "連線中斷判負",
} as const satisfies Readonly<Record<VictoryFinishReason, string>>;

const COMPACT_FINISH_REASON_LABELS = {
  conquest: "議事核心失守",
  elimination: "全軍殲滅",
  landmark: "拓界標達標",
  timedControl: "中域控制達標",
  surrender: "明示投降",
  disconnect: "連線中斷",
} as const satisfies Readonly<Record<VictoryFinishReason, string>>;

export function createVictoryPresentation(
  victory: VictoryState,
  recipientTeamId: string,
  serverTick: number,
): VictoryPresentation {
  if (victory.outcome === null || victory.finishedAtTick === null || victory.finishReason === null) {
    return createPlayingPresentation(victory, recipientTeamId, serverTick);
  }

  const reason = victory.triggeredReasons.length > 1
    ? victory.triggeredReasons.map((candidate) => FINISH_REASON_LABELS[candidate]).join("、")
    : FINISH_REASON_LABELS[victory.finishReason];
  const elapsedSeconds = ticksToSeconds(victory.finishedAtTick);
  if (victory.outcome === "draw") {
    const headline = `和局｜${reason}`;
    return {
      outcome: "draw",
      objectiveText: headline,
      compactObjectiveText: victory.triggeredReasons.length > 1
        ? "和局\n同刻達成勝途"
        : `和局\n${COMPACT_FINISH_REASON_LABELS[victory.finishReason]}`,
      selectionText: "戰局已結束｜再戰、下載重播或返回",
      announcement: `${headline}。戰局於 ${elapsedSeconds} 秒結束。可選擇再戰、下載重播或返回。`,
      tone: "normal",
    };
  }

  const won = victory.winningTeamIds.includes(recipientTeamId);
  const headline = `${won ? "勝利" : "戰敗"}｜${reason}`;
  return {
    outcome: won ? "victory" : "defeat",
    objectiveText: headline,
    compactObjectiveText: `${won ? "勝利" : "戰敗"}\n${COMPACT_FINISH_REASON_LABELS[victory.finishReason]}`,
    selectionText: "戰局已結束｜再戰、下載重播或返回",
    announcement: `${headline}。戰局於 ${elapsedSeconds} 秒結束。可選擇再戰、下載重播或返回。`,
    tone: won ? "success" : "warning",
  };
}

function createPlayingPresentation(
  victory: VictoryState,
  recipientTeamId: string,
  serverTick: number,
): VictoryPresentation {
  const own = victory.teams.find((team) => team.teamId === recipientTeamId);
  const parts: string[] = [];
  const compactParts: string[] = [];
  if (victory.policy.landmark) {
    const current = own?.landmarkHoldTicks ?? 0;
    const target = victory.policy.landmark.holdTicks;
    parts.push(`拓界標 ${ticksToSeconds(current)}/${ticksToSeconds(target)} 秒`);
    compactParts.push(`拓界 ${ticksToSeconds(current)}/${ticksToSeconds(target)}`);
  }
  if (victory.policy.timedControl) {
    const policy = victory.policy.timedControl;
    if (serverTick < policy.startsAtTick) {
      const remaining = Math.ceil((policy.startsAtTick - serverTick) / TICKS_PER_SECOND);
      parts.push(`中域 ${remaining} 秒後開放`);
      compactParts.push(`中域 ${remaining}後`);
    } else {
      const current = own?.timedControlScoreTicks ?? 0;
      const target = policy.targetTicks;
      const control = victory.control.contested
        ? "爭奪中"
        : victory.control.controllerTeamId === recipientTeamId
          ? "我方控制"
          : victory.control.controllerTeamId
            ? "敵方控制"
            : "中立";
      parts.push(`中域 ${ticksToSeconds(current)}/${ticksToSeconds(target)} 秒（${control}）`);
      compactParts.push(`中域 ${ticksToSeconds(current)}/${ticksToSeconds(target)}`);
    }
  }

  const objectiveText = parts.length > 0
    ? `勝途｜${parts.join("　")}`
    : "勝途｜摧毀敵方議事核心或殲滅敵軍";
  const compactObjectiveText = compactParts.length > 0
    ? compactParts.join("\n")
    : "勝途｜核心·殲滅";
  return {
    outcome: "playing",
    objectiveText,
    compactObjectiveText,
    selectionText: "",
    announcement: "",
    tone: "normal",
  };
}

function ticksToSeconds(ticks: number): number {
  return Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
}
