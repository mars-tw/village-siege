import { BUILDINGS, MAX_TRAINING_QUEUE_DEPTH, SETTLEMENT_TIER_ORDER, SETTLEMENT_TIERS, TECHNOLOGIES, TECHNOLOGY_ORDER,
  type BuildingType, type GameCommand, type ResourceWallet, type SettlementTier, type TechnologyType, type VisibleSnapshot } from "@village-siege/shared";
import { buildingDisplayName } from "./buildingNames";
import { isPublicBuilding, type PublicBuildingEntity } from "./assaultPublicPresentation";

export type ProgressionTab = "era" | "economy" | "military" | "artificer";
export type ProgressionAction = { kind: "command"; command: GameCommand } | { kind: "build"; type: BuildingType }
  | { kind: "select"; id: string } | { kind: "tab"; tab: ProgressionTab };
export interface ProgressionCard {
  id: string; title: string; detail: string; cost: string; status: string;
  actionLabel: string; action?: ProgressionAction;
  needs: readonly { label: string; done: boolean; action?: ProgressionAction }[];
}
export const ERA_NAMES: Record<SettlementTier, string> = { frontier: "拓荒期", stronghold: "城寨期", artificer: "工藝期" };
export function progressionCost(cost: ResourceWallet): string {
  return ([['糧', cost.food], ['木', cost.wood], ['石', cost.stone]] as const).filter(([,amount]) => amount > 0).map(([name, amount]) => `${name} ${amount}`).join(" · ");
}
const missingCost = (wallet: ResourceWallet, cost: ResourceWallet) => progressionCost({ food: Math.max(0, cost.food - wallet.food), wood: Math.max(0, cost.wood - wallet.wood), stone: Math.max(0, cost.stone - wallet.stone) });
const owned = (view: VisibleSnapshot) => view.entities.filter((e): e is PublicBuildingEntity => isPublicBuilding(e) && e.ownerId === view.recipientPlayerId && e.hitPoints > 0);
const producer = (view: VisibleSnapshot, type: BuildingType) => owned(view).filter(e => e.typeId === type)
  .sort((a,b) => Number(b.complete === true) - Number(a.complete === true) || (a.ownerControl?.productionQueue.length ?? 0) - (b.ownerControl?.productionQueue.length ?? 0))[0];
function buildingNeed(view: VisibleSnapshot, type: BuildingType) {
  const site = producer(view, type);
  const requiredTier = BUILDINGS[type].requiredTier;
  const unlocked = SETTLEMENT_TIER_ORDER.indexOf(view.settlementTier) >= SETTLEMENT_TIER_ORDER.indexOf(requiredTier);
  return { label: `${buildingDisplayName(type)}${unlocked ? "" : `（需${ERA_NAMES[requiredTier]}）`}`, done: site?.complete === true,
    action: site ? { kind: "select" as const, id: site.id } : unlocked ? { kind: "build" as const, type } : undefined };
}

export function progressionCards(view: VisibleSnapshot, tab: ProgressionTab): readonly ProgressionCard[] {
  if (tab === "era") return (["stronghold", "artificer"] as const).map(tier => {
    const definition = SETTLEMENT_TIERS[tier], town = producer(view, "townCenter"), index = SETTLEMENT_TIER_ORDER.indexOf(tier);
    const needs = definition.prerequisites.map(type => buildingNeed(view, type));
    const card: ProgressionCard = { id: tier, title: ERA_NAMES[tier], detail: tier === "stronghold" ? "解鎖弓箭手、野豬騎士、箭塔與五項科技" : "解鎖法師、火槍兵、重弩攻手與工藝科技",
      cost: progressionCost(definition.cost), status: "", actionLabel: `升級${ERA_NAMES[tier]}`, needs };
    if (SETTLEMENT_TIER_ORDER.indexOf(view.settlementTier) >= index) return { ...card, status: "已達成", actionLabel: "已達成" };
    if (view.advancement) {
      const percent = Math.floor((1 - view.advancement.remainingTicks / SETTLEMENT_TIERS[view.advancement.targetTier].advanceTicks) * 100);
      return { ...card, status: `${ERA_NAMES[view.advancement.targetTier]}升級中 ${percent}%`, actionLabel: "升級中" };
    }
    if (SETTLEMENT_TIER_ORDER.indexOf(view.settlementTier) !== index - 1) return { ...card, status: "先升級城寨期", actionLabel: "先升級城寨期" };
    if (!town?.complete) return { ...card, status: "需要完成主城", actionLabel: town ? "前往主城" : "建造主城", action: town ? { kind: "select", id: town.id } : { kind: "build", type: "townCenter" } };
    const absent = needs.filter(need => !need.done);
    if (absent.length) return { ...card, status: `先完成${absent.map(need => need.label).join("、")}`, actionLabel: "完成前置建築" };
    if (town.ownerControl?.productionQueue.length) return { ...card, status: "主城生產佇列尚未完成", actionLabel: "查看主城佇列", action: { kind: "select", id: town.id } };
    const missing = missingCost(view.wallet, definition.cost);
    if (missing) return { ...card, status: `還缺 ${missing}`, actionLabel: "材料不足" };
    return { ...card, status: `約 ${definition.advanceTicks / 10} 秒完成`, action: { kind: "command", command: { type: "advanceSettlement", producerId: town.id, targetTier: tier } } };
  });
  const ids = TECHNOLOGY_ORDER.filter(id => tab === "economy" ? TECHNOLOGIES[id].category === "economy"
    : tab === "artificer" ? TECHNOLOGIES[id].requiredTier === "artificer" : TECHNOLOGIES[id].requiredTier === "stronghold" && TECHNOLOGIES[id].category !== "economy");
  return ids.map(id => technologyCard(view, id));
}

function technologyCard(view: VisibleSnapshot, id: TechnologyType): ProgressionCard {
  const definition = TECHNOLOGIES[id], workshop = producer(view, definition.producer), effect = definition.effect;
  const effectName = { gatherRate: "採集效率", unitAttack: "部隊攻擊", unitMaxHitPoints: "部隊生命", unitSpeed: "移動速度", buildingMaxHitPoints: "建築耐久" }[effect.kind];
  const needs = [buildingNeed(view, definition.producer), ...definition.prerequisites.map(prerequisite => ({
    label: TECHNOLOGIES[prerequisite].displayName, done: view.completedTechnologyIds.includes(prerequisite),
    action: { kind: "tab" as const, tab: "military" as const },
  }))];
  const card: ProgressionCard = { id, title: definition.displayName, detail: `${effectName} +${Math.round((effect.multiplierPermille - 1000) / 10)}% · ${ERA_NAMES[definition.requiredTier]}`,
    cost: progressionCost(definition.cost), status: "", actionLabel: "開始研究", needs };
  if (view.completedTechnologyIds.includes(id)) return { ...card, status: "研究完成", actionLabel: "已完成" };
  for (const building of owned(view)) {
    const queue = building.ownerControl?.productionQueue ?? [], slot = queue.findIndex(job => job.kind === "research" && job.technologyId === id);
    if (slot >= 0) {
      const job = queue[slot]!;
      const percent = Math.floor((1 - job.remainingTicks / definition.researchTicks) * 100);
      return { ...card, status: slot === 0 ? `研究中 ${percent}%` : `等待佇列第 ${slot + 1} 項`, actionLabel: "查看研究佇列", action: { kind: "select", id: building.id } };
    }
  }
  if (SETTLEMENT_TIER_ORDER.indexOf(view.settlementTier) < SETTLEMENT_TIER_ORDER.indexOf(definition.requiredTier)) return { ...card, status: `先升級${ERA_NAMES[definition.requiredTier]}`, actionLabel: "前往時代升級", action: { kind: "tab", tab: "era" } };
  const missing = needs.filter(need => !need.done);
  if (missing.length) return { ...card, status: `先完成${missing.map(need => need.label).join("、")}`, actionLabel: workshop ? "完成研究前置" : `建造${buildingDisplayName(definition.producer)}`, action: workshop ? undefined : { kind: "build", type: definition.producer } };
  if (!workshop) return card;
  if (view.advancement?.producerId === workshop.id) return { ...card, status: "此建築正在升級聚落", actionLabel: "升級中" };
  if ((workshop.ownerControl?.productionQueue.length ?? 0) >= MAX_TRAINING_QUEUE_DEPTH) return { ...card, status: "生產佇列已滿", actionLabel: "查看生產佇列", action: { kind: "select", id: workshop.id } };
  const resources = missingCost(view.wallet, definition.cost);
  if (resources) return { ...card, status: `還缺 ${resources}`, actionLabel: "材料不足" };
  return { ...card, status: `約 ${definition.researchTicks / 10} 秒完成`, action: { kind: "command", command: { type: "research", producerId: workshop.id, technologyId: id } } };
}
