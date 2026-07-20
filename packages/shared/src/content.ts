import type { BuildingType, GridPoint, PlayableVillageId, ResourceKind, ResourceWallet, SettlementTier, StructureOrientation, TechnologyType, UnitType, VillageId } from "./protocol.js";
import { COMBAT_UNITS, type CombatUnitId } from "./combat.js";

export const RULES_VERSION = "village-siege/0.10.0";
export const TICKS_PER_SECOND = 10;
export const TICK_MILLISECONDS = 100;
export const MAX_VILLAGES = 5;
export const MAX_UNITS_PER_PLAYER = 128;
export const MAX_TRAINING_QUEUE_DEPTH = 5;
export const TOWN_CENTER_REBUILD_GRACE_TICKS = 60 * TICKS_PER_SECOND;

export type VillageTraitMetric = "gatherRate" | "unitSpeed" | "towerArmor" | "buildingDurability" | "carryCapacity";

export interface VillageTraitDefinition {
  readonly metric: VillageTraitMetric;
  readonly multiplierPermille: number;
}

export interface VillageDefinition {
  readonly id: PlayableVillageId;
  readonly displayName: string;
  readonly artSetId: string;
  readonly emblemAssetId: string;
  readonly paletteId: string;
  readonly spawn: { readonly x: number; readonly y: number };
  /** Every playable village changes two authoritative rules, not only its label or palette. */
  readonly traits: readonly [VillageTraitDefinition, VillageTraitDefinition];
}

export const VILLAGE_IDS = ["pinehold", "riverstead", "highcrag", "marshwatch", "sunfield"] as const satisfies readonly VillageId[];

export const VILLAGES = [
  {
    id: "pinehold", displayName: "松林堡", artSetId: "pinehold", emblemAssetId: "emblem-pine", paletteId: "pine", spawn: { x: 6, y: 6 },
    traits: [{ metric: "gatherRate", multiplierPermille: 1030 }, { metric: "buildingDurability", multiplierPermille: 1060 }],
  },
  {
    id: "riverstead", displayName: "河谷鎮", artSetId: "riverstead", emblemAssetId: "emblem-river", paletteId: "river", spawn: { x: 25, y: 6 },
    traits: [{ metric: "unitSpeed", multiplierPermille: 1030 }, { metric: "carryCapacity", multiplierPermille: 1100 }],
  },
  {
    id: "highcrag", displayName: "高地寨", artSetId: "highcrag", emblemAssetId: "emblem-crag", paletteId: "crag", spawn: { x: 15, y: 25 },
    traits: [{ metric: "towerArmor", multiplierPermille: 1040 }, { metric: "buildingDurability", multiplierPermille: 1100 }],
  },
] as const satisfies readonly VillageDefinition[];

export interface SettlementTierDefinition {
  readonly id: SettlementTier;
  readonly cost: ResourceWallet;
  readonly advanceTicks: number;
  readonly prerequisites: readonly BuildingType[];
}

export const SETTLEMENT_TIER_ORDER = ["frontier", "stronghold", "artificer"] as const satisfies readonly SettlementTier[];

export const SETTLEMENT_TIERS: Readonly<Record<SettlementTier, SettlementTierDefinition>> = {
  frontier: { id: "frontier", cost: wallet(0, 0, 0), advanceTicks: 0, prerequisites: [] },
  stronghold: { id: "stronghold", cost: wallet(500, 300, 100), advanceTicks: 450, prerequisites: ["barracks", "lumberCamp"] },
  artificer: { id: "artificer", cost: wallet(750, 500, 300), advanceTicks: 600, prerequisites: ["archeryRange", "beastStable"] },
};

export type TechnologyCategory = "economy" | "defense" | "offense" | "mobility" | "siege";

export type TechnologyEffect =
  | { readonly kind: "gatherRate"; readonly resourceKinds: readonly ResourceKind[]; readonly multiplierPermille: number }
  | { readonly kind: "unitAttack"; readonly unitTypes: readonly UnitType[]; readonly multiplierPermille: number }
  | { readonly kind: "unitMaxHitPoints"; readonly unitTypes: readonly UnitType[]; readonly multiplierPermille: number }
  | { readonly kind: "unitSpeed"; readonly unitTypes: readonly UnitType[]; readonly multiplierPermille: number }
  | { readonly kind: "buildingMaxHitPoints"; readonly buildingTypes: readonly BuildingType[] | "all"; readonly multiplierPermille: number };

export interface TechnologyDefinition {
  readonly id: TechnologyType;
  readonly displayName: string;
  readonly shortName: string;
  readonly category: TechnologyCategory;
  readonly producer: BuildingType;
  readonly requiredTier: SettlementTier;
  readonly cost: ResourceWallet;
  readonly researchTicks: number;
  readonly prerequisites: readonly TechnologyType[];
  readonly effect: TechnologyEffect;
}

export const TECHNOLOGY_ORDER = [
  "hearthlandAlmanac",
  "resinboundKits",
  "layeredHarness",
  "surveyedFoundations",
  "windspurRigging",
  "starfireBores",
  "torsionCradles",
] as const satisfies readonly TechnologyType[];

export const TECHNOLOGIES: Readonly<Record<TechnologyType, TechnologyDefinition>> = {
  hearthlandAlmanac: {
    id: "hearthlandAlmanac", displayName: "爐原節候錄", shortName: "節候錄", category: "economy",
    producer: "farmstead", requiredTier: "stronghold", cost: wallet(220, 80, 0), researchTicks: 280, prerequisites: [],
    effect: { kind: "gatherRate", resourceKinds: ["food"], multiplierPermille: 1_150 },
  },
  resinboundKits: {
    id: "resinboundKits", displayName: "樹脂固柄術", shortName: "固柄術", category: "economy",
    producer: "lumberCamp", requiredTier: "stronghold", cost: wallet(0, 240, 80), researchTicks: 300, prerequisites: [],
    effect: { kind: "gatherRate", resourceKinds: ["wood", "stone"], multiplierPermille: 1_150 },
  },
  layeredHarness: {
    id: "layeredHarness", displayName: "疊革戰具", shortName: "疊革具", category: "offense",
    producer: "barracks", requiredTier: "stronghold", cost: wallet(250, 120, 80), researchTicks: 360, prerequisites: [],
    effect: { kind: "unitMaxHitPoints", unitTypes: ["warrior", "shieldBearer"], multiplierPermille: 1_120 },
  },
  surveyedFoundations: {
    id: "surveyedFoundations", displayName: "方繩基準法", shortName: "基準法", category: "defense",
    producer: "townCenter", requiredTier: "stronghold", cost: wallet(180, 240, 140), researchTicks: 400, prerequisites: [],
    effect: { kind: "buildingMaxHitPoints", buildingTypes: "all", multiplierPermille: 1_100 },
  },
  windspurRigging: {
    id: "windspurRigging", displayName: "逐風鞍索", shortName: "逐風索", category: "mobility",
    producer: "beastStable", requiredTier: "stronghold", cost: wallet(240, 150, 40), researchTicks: 340, prerequisites: [],
    effect: { kind: "unitSpeed", unitTypes: ["boarRider"], multiplierPermille: 1_150 },
  },
  starfireBores: {
    id: "starfireBores", displayName: "星火膛鑽", shortName: "星火鑽", category: "offense",
    producer: "gunWorkshop", requiredTier: "artificer", cost: wallet(300, 220, 180), researchTicks: 420, prerequisites: ["layeredHarness"],
    effect: { kind: "unitAttack", unitTypes: ["mage", "musketeer"], multiplierPermille: 1_150 },
  },
  torsionCradles: {
    id: "torsionCradles", displayName: "絞索衝架", shortName: "絞索架", category: "siege",
    producer: "siegeWorkshop", requiredTier: "artificer", cost: wallet(200, 300, 220), researchTicks: 450, prerequisites: ["surveyedFoundations"],
    effect: { kind: "unitAttack", unitTypes: ["heavyCrossbowman"], multiplierPermille: 1_250 },
  },
};

export interface UnitDefinition {
  readonly id: UnitType;
  readonly requiredTier: SettlementTier;
  readonly carryCapacity: number;
  readonly cost: ResourceWallet;
  readonly maxHitPoints: number;
  readonly attackDamage: number;
  readonly attackRange: number;
  readonly attackCooldownTicks: number;
  readonly speedMilliTilesPerSecond: number;
  readonly sightRadius: number;
  readonly population: number;
  readonly trainTicks: number;
  readonly producers: readonly BuildingType[];
  readonly gatherPerSecond: Readonly<Record<ResourceKind, number>>;
}

export const UNITS: Readonly<Record<UnitType, UnitDefinition>> = {
  villager: { id: "villager", requiredTier: "frontier", carryCapacity: 12, cost: wallet(50, 0, 0), maxHitPoints: 55, attackDamage: 4, attackRange: 1, attackCooldownTicks: 12, speedMilliTilesPerSecond: 1100, sightRadius: 6, population: 1, trainTicks: 120, producers: ["townCenter"], gatherPerSecond: { food: 6, wood: 6, stone: 4 } },
  warrior: combatUnit("warrior", "frontier", ["barracks"], 6),
  shieldBearer: combatUnit("shieldBearer", "frontier", ["barracks"], 7),
  archer: combatUnit("archer", "stronghold", ["archeryRange"], 8),
  mage: combatUnit("mage", "artificer", ["mageSanctum"], 8),
  musketeer: combatUnit("musketeer", "artificer", ["gunWorkshop"], 8),
  boarRider: combatUnit("boarRider", "stronghold", ["beastStable"], 9),
  heavyCrossbowman: combatUnit("heavyCrossbowman", "artificer", ["siegeWorkshop"], 7),
};

export interface BuildingDefinition {
  readonly id: BuildingType;
  readonly requiredTier: SettlementTier;
  readonly cost: ResourceWallet;
  readonly maxHitPoints: number;
  readonly buildTicks: number;
  readonly populationCapacity: number;
  readonly sightRadius: number;
  readonly attackDamage: number;
  readonly attackRange: number;
  readonly attackCooldownTicks: number;
  readonly armor: number;
  readonly footprint: readonly GridPoint[];
  readonly dropOffResources?: readonly ResourceKind[];
  readonly movementBlocking?: "always" | "whenClosed";
  readonly leavesRubble?: boolean;
}

export const BUILDINGS: Readonly<Record<BuildingType, BuildingDefinition>> = {
  townCenter: { id: "townCenter", requiredTier: "frontier", cost: wallet(0, 275, 225), maxHitPoints: 1200, buildTicks: 600, populationCapacity: 10, sightRadius: 9, attackDamage: 12, attackRange: 6, attackCooldownTicks: 15, armor: 18, footprint: rectangleFootprint(2, 2), dropOffResources: ["food", "wood", "stone"] },
  house: { id: "house", requiredTier: "frontier", cost: wallet(0, 80, 0), maxHitPoints: 360, buildTicks: 180, populationCapacity: 8, sightRadius: 4, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 6, footprint: rectangleFootprint(1, 1) },
  lumberCamp: { id: "lumberCamp", requiredTier: "frontier", cost: wallet(0, 110, 0), maxHitPoints: 430, buildTicks: 220, populationCapacity: 0, sightRadius: 5, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 8, footprint: rectangleFootprint(2, 1), dropOffResources: ["wood"] },
  farmstead: { id: "farmstead", requiredTier: "frontier", cost: wallet(0, 85, 20), maxHitPoints: 410, buildTicks: 220, populationCapacity: 0, sightRadius: 5, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 8, footprint: rectangleFootprint(2, 1), dropOffResources: ["food"] },
  barracks: { id: "barracks", requiredTier: "frontier", cost: wallet(0, 150, 35), maxHitPoints: 650, buildTicks: 280, populationCapacity: 0, sightRadius: 6, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 12, footprint: rectangleFootprint(2, 2) },
  defenseTower: { id: "defenseTower", requiredTier: "stronghold", cost: wallet(0, 90, 125), maxHitPoints: 720, buildTicks: 320, populationCapacity: 0, sightRadius: 9, attackDamage: 18, attackRange: 7, attackCooldownTicks: 12, armor: 24, footprint: rectangleFootprint(1, 1) },
  archeryRange: { id: "archeryRange", requiredTier: "stronghold", cost: wallet(0, 160, 45), maxHitPoints: 560, buildTicks: 260, populationCapacity: 0, sightRadius: 7, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 10, footprint: rectangleFootprint(2, 2) },
  mageSanctum: { id: "mageSanctum", requiredTier: "artificer", cost: wallet(0, 130, 130), maxHitPoints: 500, buildTicks: 340, populationCapacity: 0, sightRadius: 8, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 8, footprint: rectangleFootprint(2, 2) },
  gunWorkshop: { id: "gunWorkshop", requiredTier: "artificer", cost: wallet(0, 185, 85), maxHitPoints: 540, buildTicks: 360, populationCapacity: 0, sightRadius: 6, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 10, footprint: rectangleFootprint(2, 2) },
  beastStable: { id: "beastStable", requiredTier: "stronghold", cost: wallet(0, 180, 45), maxHitPoints: 590, buildTicks: 300, populationCapacity: 0, sightRadius: 7, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 10, footprint: rectangleFootprint(2, 2) },
  siegeWorkshop: { id: "siegeWorkshop", requiredTier: "artificer", cost: wallet(0, 240, 140), maxHitPoints: 720, buildTicks: 420, populationCapacity: 0, sightRadius: 6, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 16, footprint: rectangleFootprint(3, 2) },
  resinPalisade: { id: "resinPalisade", requiredTier: "frontier", cost: wallet(0, 35, 0), maxHitPoints: 320, buildTicks: 90, populationCapacity: 0, sightRadius: 2, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 14, footprint: rectangleFootprint(1, 1), leavesRubble: true },
  surveyGate: { id: "surveyGate", requiredTier: "frontier", cost: wallet(0, 75, 15), maxHitPoints: 480, buildTicks: 160, populationCapacity: 0, sightRadius: 3, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 18, footprint: rectangleFootprint(2, 1), movementBlocking: "whenClosed", leavesRubble: true },
  copperLandmark: { id: "copperLandmark", requiredTier: "stronghold", cost: wallet(0, 210, 260), maxHitPoints: 1_350, buildTicks: 520, populationCapacity: 0, sightRadius: 11, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, armor: 22, footprint: rectangleFootprint(2, 2), leavesRubble: true },
};

export function getBuildingFootprint(type: BuildingType, orientation: StructureOrientation = "ne"): readonly GridPoint[] {
  const footprint = BUILDINGS[type].footprint;
  return orientation === "ne" ? footprint : footprint.map((cell) => ({ x: cell.y, y: cell.x }));
}

export const STARTING_RESOURCES: ResourceWallet = wallet(420, 420, 260);

export interface ResourceNodeDefinition {
  readonly kind: ResourceKind;
  readonly maxAmount: number;
  readonly renewAfterTicks: number | null;
}

export const RESOURCE_NODES: Readonly<Record<ResourceKind, ResourceNodeDefinition>> = {
  food: { kind: "food", maxAmount: 360, renewAfterTicks: 300 },
  wood: { kind: "wood", maxAmount: 1_000, renewAfterTicks: null },
  stone: { kind: "stone", maxAmount: 700, renewAfterTicks: null },
};

export function getVillage(id: VillageId): VillageDefinition | undefined {
  return VILLAGES.find((village) => village.id === id);
}

function combatUnit(id: CombatUnitId, requiredTier: SettlementTier, producers: readonly BuildingType[], sightRadius: number): UnitDefinition {
  const combat = COMBAT_UNITS[id];
  return {
    id,
    requiredTier,
    carryCapacity: 0,
    cost: { ...combat.cost },
    maxHitPoints: combat.maxHitPoints,
    attackDamage: combat.baseDamage,
    attackRange: combat.attackRange,
    attackCooldownTicks: Math.max(1, Math.round(combat.attackIntervalMs / TICK_MILLISECONDS)),
    speedMilliTilesPerSecond: Math.round(combat.moveSpeed * 1_000),
    sightRadius,
    population: combat.population,
    trainTicks: Math.max(1, Math.round(combat.trainTimeMs / TICK_MILLISECONDS)),
    producers,
    gatherPerSecond: { food: 0, wood: 0, stone: 0 },
  };
}

function wallet(food: number, wood: number, stone: number): ResourceWallet {
  return { food, wood, stone };
}

function rectangleFootprint(width: number, height: number): readonly GridPoint[] {
  return Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
}
