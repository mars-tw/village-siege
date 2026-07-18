import type { GridPoint } from "./isometric";

export type VillageId = "pinehold" | "riverstead" | "highcrag";

export interface VillageDefinition {
  id: VillageId;
  name: string;
  epithet: string;
  primary: number;
  secondary: number;
  roof: number;
  spawn: GridPoint;
}

export const MAP_SIZE = { width: 24, height: 24 } as const;

export const VILLAGES: readonly VillageDefinition[] = [
  { id: "pinehold", name: "松林堡", epithet: "森防與長弓", primary: 0x2f6a4f, secondary: 0xbacb86, roof: 0x183f36, spawn: { x: 4, y: 5 } },
  { id: "riverstead", name: "河谷鎮", epithet: "水路與槍陣", primary: 0x2e79a0, secondary: 0xd4d7a1, roof: 0x174c66, spawn: { x: 18, y: 5 } },
  { id: "highcrag", name: "高地寨", epithet: "石壁與重衛", primary: 0xa45b38, secondary: 0xe1b56a, roof: 0x65301f, spawn: { x: 12, y: 18 } }
] as const;

export const UNIT_STATS = {
  scout: { name: "斥候", hp: 80, attack: 11, range: 1.15, speed: 2.25 },
  guard: { name: "村衛", hp: 125, attack: 16, range: 1.25, speed: 1.55 },
  archer: { name: "弓手", hp: 70, attack: 12, range: 3.1, speed: 1.7 }
} as const;

export type UnitKind = keyof typeof UNIT_STATS;

export function getVillage(id: VillageId): VillageDefinition {
  return VILLAGES.find((village) => village.id === id) ?? VILLAGES[0]!;
}
