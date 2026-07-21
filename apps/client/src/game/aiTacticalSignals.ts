import {
  arePlayersHostile,
  isEntityVisibleToPlayer,
  type AiAuthorityState,
  type AiStrategicPhase,
  type DomainEvent,
  type GameCommand,
  type MatchState,
  type TacticalSignal,
} from "@village-siege/shared";

export type TacticalSignalRaisedEvent = Extract<DomainEvent, { type: "tacticalSignalRaised" }>;

export interface TacticalSignalPresentation {
  readonly notice: string;
  readonly glyph: string;
  readonly tone: "normal" | "warning";
  readonly color: number;
  readonly textColor: string;
}

export const TACTICAL_SIGNAL_NOTICE_MS = 2_200;
export const TACTICAL_SIGNAL_WORLD_MS = 720;

export const TACTICAL_SIGNAL_PRESENTATION: Readonly<Record<TacticalSignal, TacticalSignalPresentation>> = {
  scouting: { notice: "敵斥候現身", glyph: "探", tone: "normal", color: 0xe0b866, textColor: "#f2d895" },
  alarm: { notice: "敵寨鳴鐘，守軍集結", glyph: "警", tone: "warning", color: 0xf08b67, textColor: "#ffb09c" },
  repairing: { notice: "敵方正在搶修防線", glyph: "修", tone: "normal", color: 0xd2b98b, textColor: "#ead8ad" },
  retreating: { notice: "敵軍正在撤離", glyph: "撤", tone: "normal", color: 0xb8c0b8, textColor: "#dce2da" },
  regrouping: { notice: "敵軍重新整隊", glyph: "整", tone: "normal", color: 0xc9965b, textColor: "#efc98d" },
  assaulting: { notice: "敵軍攻勢逼近", glyph: "襲", tone: "warning", color: 0xd85f4d, textColor: "#ff9b86" },
};

const PHASE_SIGNAL: Readonly<Partial<Record<AiStrategicPhase, TacticalSignal>>> = {
  scouting: "scouting",
  defending: "alarm",
  repairing: "repairing",
  retreating: "retreating",
  regrouping: "regrouping",
  assaulting: "assaulting",
};

const DEFENSIVE_ANCHOR_PRIORITY = ["townCenter", "surveyGate", "defenseTower", "resinPalisade"] as const;

/**
 * Converts a private planner phase edge into the smallest public event possible.
 * Candidate selection is restricted to hostile entities the recipient can see;
 * no planner target, route, force count, wave index, or personality is copied.
 */
export function deriveVisibleTacticalSignalRaised(
  state: MatchState,
  recipientPlayerId: string,
  previous: AiAuthorityState,
  next: AiAuthorityState,
  commands: readonly GameCommand[],
): TacticalSignalRaisedEvent | null {
  if (previous.playerId !== next.playerId
    || previous.phase === next.phase
    || !arePlayersHostile(state, recipientPlayerId, next.playerId)) return null;
  const signal = PHASE_SIGNAL[next.phase];
  if (!signal) return null;

  const candidateIds = candidateAnchorIds(state, signal, next.playerId, previous, next, commands);
  const anchor = candidateIds
    .map((entityId) => state.entities.find((entity) => entity.id === entityId))
    .find((entity) => entity?.ownerId === next.playerId && isEntityVisibleToPlayer(state, recipientPlayerId, entity));
  if (!anchor) return null;

  return {
    type: "tacticalSignalRaised",
    actingPlayerId: next.playerId,
    signal,
    anchorEntityId: anchor.id,
    emittedAtTick: state.tick,
  };
}

function candidateAnchorIds(
  state: MatchState,
  signal: TacticalSignal,
  actingPlayerId: string,
  previous: AiAuthorityState,
  next: AiAuthorityState,
  commands: readonly GameCommand[],
): string[] {
  const commandActorIds = commands.flatMap(actorEntityIdsForCommand);
  const commandRepairTargets = commands.flatMap((command) => command.type === "repair" ? [command.targetId] : []);
  const previousWaveIds = previous.activeWave?.memberIds ?? [];
  const nextWaveIds = next.activeWave?.memberIds ?? [];
  const militaryIds = state.entities
    .filter((entity) => entity.ownerId === actingPlayerId && entity.kind === "unit" && entity.typeId !== "villager")
    .map((entity) => entity.id)
    .sort(compareText);
  const defensiveIds = state.entities
    .filter((entity) => entity.ownerId === actingPlayerId && entity.kind === "building")
    .filter((entity) => DEFENSIVE_ANCHOR_PRIORITY.includes(entity.typeId as typeof DEFENSIVE_ANCHOR_PRIORITY[number]))
    .sort((left, right) => DEFENSIVE_ANCHOR_PRIORITY.indexOf(left.typeId as typeof DEFENSIVE_ANCHOR_PRIORITY[number])
      - DEFENSIVE_ANCHOR_PRIORITY.indexOf(right.typeId as typeof DEFENSIVE_ANCHOR_PRIORITY[number])
      || compareText(left.id, right.id))
    .map((entity) => entity.id);

  const ordered = signal === "repairing"
    ? [...commandRepairTargets, next.repairTargetId, ...commandActorIds]
    : signal === "alarm"
      ? [...defensiveIds, ...commandActorIds]
      : signal === "regrouping"
        ? [...previousWaveIds, ...commandActorIds, ...(previous.activeWave ? [] : militaryIds)]
        : [...commandActorIds, ...nextWaveIds, ...previousWaveIds];
  return [...new Set(ordered.filter((entityId): entityId is string => typeof entityId === "string" && entityId.length > 0))];
}

function actorEntityIdsForCommand(command: GameCommand): readonly string[] {
  switch (command.type) {
    case "move":
    case "attackMove":
    case "attack":
    case "gather":
    case "dropOff":
    case "patrol":
    case "repair":
    case "setStance":
    case "setFormation":
    case "stop":
      return command.entityIds;
    case "build":
      return command.builderIds;
    case "train":
    case "research":
    case "cancelProduction":
    case "setRallyPoint":
    case "advanceSettlement":
      return [command.producerId];
    case "setGateState":
      return [command.gateId];
    case "castAbility":
      return [command.casterId];
    case "surrender":
      return [];
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
