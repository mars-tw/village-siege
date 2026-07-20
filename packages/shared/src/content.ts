import type { BuildingType, GridPoint, PlayableVillageId, ResourceKind, ResourceWallet, SettlementTier, UnitType, VillageId } from "./protocol.js";

export const RULES_VERSION = "village-siege/0.3.0";
export const TICKS_PER_SECOND = 10;
export const TICK_MILLISECONDS = 100;
export const MAX_VILLAGES = 5;
export const MAX_UNITS_PER_PLAYER = 128;
export const MAX_TRAINING_QUEUE_DEPTH = 5;
export const TOWN_CENTER_REBUILD_GRACE_TICKS = 60 * TICKS_PER_SECOND;

export interface VillageDefinition {
  readonly id: PlayableVillageId;
  readonly displayName: string;
  readonly artSetId: string;
  readonly emblemAssetId: string;
  readonly paletteId: string;
  readonly spawn: { readonly x: number; readonly y: number };
  readonly trait: {
    readonly metric: "gatherRate" | "unitSpeed" | "towerArmor";
    readonly multiplierPermille: number;
  };
}

export const VILLAGE_IDS = ["pinehold", "riverstead", "highcrag", "marshwatch", "sunfield"] as const satisfies readonly VillageId[];

export const VILLAGES = [
  { id: "pinehold", displayName: "松林堡", artSetId: "pinehold", emblemAssetId: "emblem-pine", paletteId: "pine", spawn: { x: 6, y: 6 }, trait: { metric: "gatherRate", multiplierPermille: 1030 } },
  { id: "riverstead", displayName: "河谷鎮", artSetId: "riverstead", emblemAssetId: "emblem-river", paletteId: "river", spawn: { x: 25, y: 6 }, trait: { metric: "unitSpeed", multiplierPermille: 1030 } },
  { id: "highcrag", displayName: "高地寨", artSetId: "highcrag", emblemAssetId: "emblem-crag", paletteId: "crag", spawn: { x: 15, y: 25 }, trait: { metric: "towerArmor", multiplierPermille: 1040 } },
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

export interface UnitDefinition {
  readonly id: UnitType;
  readonly requiredTier: SettlementTier;
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
  villager: { id: "villager", requiredTier: "frontier", cost: wallet(50, 0, 0), maxHitPoints: 55, attackDamage: 4, attackRange: 1, attackCooldownTicks: 12, speedMilliTilesPerSecond: 1100, sightRadius: 6, population: 1, trainTicks: 120, producers: ["townCenter"], gatherPerSecond: { food: 6, wood: 6, stone: 4 } },
  militia: { id: "militia", requiredTier: "frontier", cost: wallet(60, 25, 0), maxHitPoints: 85, attackDamage: 11, attackRange: 1, attackCooldownTicks: 10, speedMilliTilesPerSecond: 1050, sightRadius: 6, population: 1, trainTicks: 150, producers: ["barracks"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
  spearman: { id: "spearman", requiredTier: "frontier", cost: wallet(45, 35, 0), maxHitPoints: 75, attackDamage: 13, attackRange: 2, attackCooldownTicks: 12, speedMilliTilesPerSecond: 1000, sightRadius: 7, population: 1, trainTicks: 160, producers: ["barracks"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
  archer: { id: "archer", requiredTier: "stronghold", cost: wallet(45, 50, 0), maxHitPoints: 60, attackDamage: 10, attackRange: 5, attackCooldownTicks: 14, speedMilliTilesPerSecond: 1050, sightRadius: 8, population: 1, trainTicks: 180, producers: ["archeryRange"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
  mage: { id: "mage", requiredTier: "artificer", cost: wallet(70, 0, 75), maxHitPoints: 55, attackDamage: 20, attackRange: 4, attackCooldownTicks: 18, speedMilliTilesPerSecond: 950, sightRadius: 8, population: 2, trainTicks: 240, producers: ["mageSanctum"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
  musketeer: { id: "musketeer", requiredTier: "artificer", cost: wallet(70, 65, 20), maxHitPoints: 65, attackDamage: 24, attackRange: 5, attackCooldownTicks: 20, speedMilliTilesPerSecond: 920, sightRadius: 8, population: 2, trainTicks: 260, producers: ["gunWorkshop"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
  scout: { id: "scout", requiredTier: "stronghold", cost: wallet(80, 20, 0), maxHitPoints: 95, attackDamage: 9, attackRange: 1, attackCooldownTicks: 9, speedMilliTilesPerSecond: 1800, sightRadius: 9, population: 1, trainTicks: 200, producers: ["beastStable"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
  batteringRam: { id: "batteringRam", requiredTier: "artificer", cost: wallet(0, 140, 80), maxHitPoints: 230, attackDamage: 35, attackRange: 1, attackCooldownTicks: 20, speedMilliTilesPerSecond: 650, sightRadius: 5, population: 3, trainTicks: 300, producers: ["siegeWorkshop"], gatherPerSecond: { food: 0, wood: 0, stone: 0 } },
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
  readonly footprint: readonly GridPoint[];
}

export const BUILDINGS: Readonly<Record<BuildingType, BuildingDefinition>> = {
  townCenter: { id: "townCenter", requiredTier: "frontier", cost: wallet(0, 275, 225), maxHitPoints: 1200, buildTicks: 600, populationCapacity: 10, sightRadius: 9, attackDamage: 12, attackRange: 6, attackCooldownTicks: 15, footprint: rectangleFootprint(2, 2) },
  house: { id: "house", requiredTier: "frontier", cost: wallet(0, 80, 0), maxHitPoints: 360, buildTicks: 180, populationCapacity: 8, sightRadius: 4, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(1, 1) },
  lumberCamp: { id: "lumberCamp", requiredTier: "frontier", cost: wallet(0, 110, 0), maxHitPoints: 430, buildTicks: 220, populationCapacity: 0, sightRadius: 5, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 1) },
  farmstead: { id: "farmstead", requiredTier: "frontier", cost: wallet(0, 85, 20), maxHitPoints: 410, buildTicks: 220, populationCapacity: 0, sightRadius: 5, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 1) },
  barracks: { id: "barracks", requiredTier: "frontier", cost: wallet(0, 150, 35), maxHitPoints: 650, buildTicks: 280, populationCapacity: 0, sightRadius: 6, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 2) },
  defenseTower: { id: "defenseTower", requiredTier: "stronghold", cost: wallet(0, 90, 125), maxHitPoints: 720, buildTicks: 320, populationCapacity: 0, sightRadius: 9, attackDamage: 18, attackRange: 7, attackCooldownTicks: 12, footprint: rectangleFootprint(1, 1) },
  archeryRange: { id: "archeryRange", requiredTier: "stronghold", cost: wallet(0, 160, 45), maxHitPoints: 560, buildTicks: 260, populationCapacity: 0, sightRadius: 7, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 2) },
  mageSanctum: { id: "mageSanctum", requiredTier: "artificer", cost: wallet(0, 130, 130), maxHitPoints: 500, buildTicks: 340, populationCapacity: 0, sightRadius: 8, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 2) },
  gunWorkshop: { id: "gunWorkshop", requiredTier: "artificer", cost: wallet(0, 185, 85), maxHitPoints: 540, buildTicks: 360, populationCapacity: 0, sightRadius: 6, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 2) },
  beastStable: { id: "beastStable", requiredTier: "stronghold", cost: wallet(0, 180, 45), maxHitPoints: 590, buildTicks: 300, populationCapacity: 0, sightRadius: 7, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(2, 2) },
  siegeWorkshop: { id: "siegeWorkshop", requiredTier: "artificer", cost: wallet(0, 240, 140), maxHitPoints: 720, buildTicks: 420, populationCapacity: 0, sightRadius: 6, attackDamage: 0, attackRange: 0, attackCooldownTicks: 0, footprint: rectangleFootprint(3, 2) },
};

export const STARTING_RESOURCES: ResourceWallet = wallet(420, 420, 260);

export function getVillage(id: VillageId): VillageDefinition | undefined {
  return VILLAGES.find((village) => village.id === id);
}

function wallet(food: number, wood: number, stone: number): ResourceWallet {
  return { food, wood, stone };
}

function rectangleFootprint(width: number, height: number): readonly GridPoint[] {
  return Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
}
