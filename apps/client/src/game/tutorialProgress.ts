import {
  decodeExploredTilesRle,
  type DomainEvent,
  type GameCommand,
  type VisibleSnapshot,
} from "@village-siege/shared";

export type TutorialStepId = "economy" | "tier" | "research" | "fog" | "combat" | "breach" | "victory";

export interface TutorialStepDefinition {
  readonly id: TutorialStepId;
  readonly title: string;
  readonly shortTitle: string;
  readonly hint: string;
}

export const TUTORIAL_STEPS: readonly TutorialStepDefinition[] = [
  {
    id: "economy",
    title: "完成一次採集與卸貨",
    shortTitle: "採集卸貨",
    hint: "點選工匠，再按採糧、伐木或採石（也可直接點資源）；滿載會自動送回，也可點主城提前卸貨。",
  },
  {
    id: "tier",
    title: "把聚落升為城寨期",
    shortTitle: "升級城寨",
    hint: "選取主城並點「升級城寨」；若資源不足，先讓工匠持續採集。",
  },
  {
    id: "research",
    title: "完成任一項科技研究",
    shortTitle: "研究科技",
    hint: "選取主城、兵營或資源建築，開啟研究頁並選擇一項已解鎖科技。",
  },
  {
    id: "fog",
    title: "派部隊探索未知地形",
    shortTitle: "探索迷霧",
    hint: "用既有兵營訓練 2–3 名戰士，再選軍隊前往黑霧邊緣；探索命令後須新發現至少十格。",
  },
  {
    id: "combat",
    title: "對敵軍造成一次實際傷害",
    shortTitle: "投入戰鬥",
    hint: "選取軍隊，再點可見敵軍；也可使用攻擊移動，直到出現實際傷害。",
  },
  {
    id: "breach",
    title: "摧毀敵方城牆或城門建立破口",
    shortTitle: "建立破口",
    hint: "以多名戰士、盾衛或弓手集中攻擊敵方城門；持續集火直到出現可穿越破口。",
  },
  {
    id: "victory",
    title: "取得本場戰役勝利",
    shortTitle: "贏得戰役",
    hint: "穿過破口摧毀敵方主城，或完成地標／中域控制；勝利後教學才算完成。",
  },
] as const;

const FOG_EXPLORATION_TARGET = 10;

export interface TutorialProgress {
  readonly initialExploredTileCount: number;
  readonly economyGathererIds: readonly string[];
  readonly settlementAdvanceCommandAccepted: boolean;
  readonly researchTechnologyIds: readonly string[];
  readonly combatUnitIds: readonly string[];
  readonly combatProjectileIds: readonly string[];
  readonly breachTargetIds: readonly string[];
  readonly fogExplorationBaseline: number | null;
  readonly stepIndex: number;
  readonly accomplishments: Readonly<Record<TutorialStepId, boolean>>;
  readonly complete: boolean;
}

export interface TutorialProgressUpdate {
  readonly progress: TutorialProgress;
  readonly newlyCompletedStepIds: readonly TutorialStepId[];
}

export function createTutorialProgress(view: VisibleSnapshot): TutorialProgress {
  return {
    initialExploredTileCount: exploredTileCount(view),
    economyGathererIds: [],
    settlementAdvanceCommandAccepted: false,
    researchTechnologyIds: [],
    combatUnitIds: [],
    combatProjectileIds: [],
    breachTargetIds: [],
    fogExplorationBaseline: null,
    stepIndex: 0,
    accomplishments: emptyAccomplishments(),
    complete: false,
  };
}

export function recordTutorialAcceptedCommand(
  progress: TutorialProgress,
  command: GameCommand,
  view: VisibleSnapshot,
  playerId: string,
  opponentPlayerId: string,
): TutorialProgress {
  if (progress.complete) return progress;
  const economyGathererIds = command.type === "gather"
    ? mergeIds(progress.economyGathererIds, command.entityIds)
    : progress.economyGathererIds;
  const settlementAdvanceCommandAccepted = progress.settlementAdvanceCommandAccepted || command.type === "advanceSettlement";
  const researchTechnologyIds = command.type === "research"
    ? mergeIds(progress.researchTechnologyIds, [command.technologyId])
    : progress.researchTechnologyIds;
  const combatIds = command.type === "attack" || command.type === "attackMove"
    ? command.entityIds
    : command.type === "castAbility"
      ? [command.casterId]
      : [];
  const combatUnitIds = mergeIds(progress.combatUnitIds, combatIds);
  const target = command.type === "attack" ? view.entities.find((entity) => entity.id === command.targetId) : undefined;
  const breachTargetIds = target?.kind === "building"
    && target.ownerId === opponentPlayerId
    && (target.typeId === "resinPalisade" || target.typeId === "surveyGate")
    ? mergeIds(progress.breachTargetIds, [target.id])
    : progress.breachTargetIds;
  const militaryIds = new Set(view.entities
    .filter((entity) => entity.kind === "unit" && entity.ownerId === playerId && entity.typeId !== "villager")
    .map((entity) => entity.id));
  const explorationPoints = command.type === "move" || command.type === "attackMove"
    ? [command.target]
    : command.type === "patrol"
      ? command.waypoints
      : [];
  const movingIds = command.type === "move" || command.type === "attackMove" || command.type === "patrol"
    ? command.entityIds
    : [];
  const explored = new Set(decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle));
  const qualifiesForFog = (
    movingIds.some((id) => militaryIds.has(id))
    && explorationPoints.some((point) => !explored.has(point.y * view.map.width + point.x))
  );
  const fogExplorationBaseline = progress.fogExplorationBaseline ?? (qualifiesForFog ? explored.size : null);
  return {
    ...progress,
    economyGathererIds,
    settlementAdvanceCommandAccepted,
    researchTechnologyIds,
    combatUnitIds,
    breachTargetIds,
    fogExplorationBaseline,
  };
}

export function updateTutorialProgress(
  previous: TutorialProgress,
  view: VisibleSnapshot,
  events: readonly DomainEvent[],
  playerId: string,
  playerTeamId: string,
  opponentPlayerId: string,
): TutorialProgressUpdate {
  if (previous.complete) return { progress: previous, newlyCompletedStepIds: [] };

  const accomplishments = { ...previous.accomplishments };
  const ownerByEntityId = new Map(view.entities.map((entity) => [entity.id, entity.ownerId] as const));
  for (const event of events) {
    if (event.type === "entityRemoved") ownerByEntityId.set(event.entityId, event.entity.ownerId);
  }

  const commandedGatherers = new Set(previous.economyGathererIds);
  if (events.some((event) => (
    event.type === "resourcesDeposited"
    && event.playerId === playerId
    && commandedGatherers.has(event.unitId)
    && event.amount > 0
  ))) {
    accomplishments.economy = true;
  }
  if (previous.settlementAdvanceCommandAccepted && view.settlementTier !== "frontier") accomplishments.tier = true;
  const commandedResearch = new Set(previous.researchTechnologyIds);
  if (view.completedTechnologyIds.some((technologyId) => commandedResearch.has(technologyId))) accomplishments.research = true;
  if (previous.fogExplorationBaseline !== null && exploredTileCount(view) >= previous.fogExplorationBaseline + FOG_EXPLORATION_TARGET) {
    accomplishments.fog = true;
  }
  const commandedCombatUnits = new Set(previous.combatUnitIds);
  const combatProjectileIds = mergeIds(previous.combatProjectileIds, events.flatMap((event) => (
    event.type === "projectileSpawned"
    && event.projectile.ownerId === playerId
    && event.projectile.sourceId !== null
    && commandedCombatUnits.has(event.projectile.sourceId)
      ? [event.projectile.id]
      : []
  )));
  const commandedProjectiles = new Set(combatProjectileIds);
  const impactedCombatTargetIds = new Set(events.flatMap((event) => (
    event.type === "projectileImpacted" && commandedProjectiles.has(event.projectileId)
      ? event.targetIds
      : []
  )));
  if (events.some((event) => (
    event.type === "entityDamaged"
    && (
      (event.sourceId !== null && commandedCombatUnits.has(event.sourceId))
      || (event.sourceId === null && impactedCombatTargetIds.has(event.targetId))
    )
    && ownerByEntityId.get(event.targetId) === opponentPlayerId
    && event.amount > 0
  ))) accomplishments.combat = true;
  const commandedBreachTargets = new Set(previous.breachTargetIds);
  if (events.some((event) => (
    event.type === "breachCreated"
    && event.ownerId === opponentPlayerId
    && commandedBreachTargets.has(event.structureId)
  ))) {
    accomplishments.breach = true;
  }
  if (view.victory.outcome === "victory" && view.victory.winningTeamIds.includes(playerTeamId)) {
    accomplishments.victory = true;
  }

  let stepIndex = previous.stepIndex;
  const newlyCompletedStepIds: TutorialStepId[] = [];
  while (stepIndex < TUTORIAL_STEPS.length) {
    const step = TUTORIAL_STEPS[stepIndex]!;
    if (!accomplishments[step.id]) break;
    newlyCompletedStepIds.push(step.id);
    stepIndex += 1;
  }

  return {
    progress: {
      initialExploredTileCount: previous.initialExploredTileCount,
      economyGathererIds: previous.economyGathererIds,
      settlementAdvanceCommandAccepted: previous.settlementAdvanceCommandAccepted,
      researchTechnologyIds: previous.researchTechnologyIds,
      combatUnitIds: previous.combatUnitIds,
      combatProjectileIds,
      breachTargetIds: previous.breachTargetIds,
      fogExplorationBaseline: previous.fogExplorationBaseline,
      stepIndex,
      accomplishments,
      complete: stepIndex === TUTORIAL_STEPS.length,
    },
    newlyCompletedStepIds,
  };
}

export function currentTutorialStep(progress: TutorialProgress): TutorialStepDefinition | null {
  return TUTORIAL_STEPS[progress.stepIndex] ?? null;
}

export function tutorialProgressLabel(progress: TutorialProgress): string {
  if (progress.complete) return `教學完成 ${TUTORIAL_STEPS.length}/${TUTORIAL_STEPS.length}`;
  const step = currentTutorialStep(progress)!;
  return `教學 ${progress.stepIndex + 1}/${TUTORIAL_STEPS.length}｜${step.shortTitle}`;
}

export function tutorialProgressSummary(progress: TutorialProgress): string {
  const completed = TUTORIAL_STEPS.filter((step) => progress.accomplishments[step.id]).map((step) => step.shortTitle);
  return completed.length === 0 ? "尚未完成教學目標" : `已完成：${completed.join("、")}`;
}

function exploredTileCount(view: VisibleSnapshot): number {
  return decodeExploredTilesRle(view.map.width, view.map.height, view.exploredTilesRle).length;
}

function emptyAccomplishments(): Record<TutorialStepId, boolean> {
  return {
    economy: false,
    tier: false,
    research: false,
    fog: false,
    combat: false,
    breach: false,
    victory: false,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergeIds(existing: readonly string[], additional: readonly string[]): readonly string[] {
  return [...new Set([...existing, ...additional])].sort(compareText);
}
