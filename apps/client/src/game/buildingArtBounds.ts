// Measured alpha >= 32 from the original PNG; regenerate with prepare-building-bounds.mjs.
import type { BuildingType } from "@village-siege/shared";
export const BUILDING_OPAQUE_TOP: Partial<Record<BuildingType, number>> = {
  "townCenter": 0.16146,
  "house": 0.14583,
  "barracks": 0.29427,
  "defenseTower": 0.06771,
  "lumberCamp": 0.33073,
  "farmstead": 0.28906,
  "archeryRange": 0.31771,
  "mageSanctum": 0.06771,
  "gunWorkshop": 0.20833,
  "beastStable": 0.26042,
  "siegeWorkshop": 0.26302,
  "copperLandmark": 0.06771
};
