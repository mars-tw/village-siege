import type { BuildingType } from "@village-siege/shared";
export const BUILDING_LABELS: Readonly<Record<BuildingType, string>> = {
  townCenter: "村鎮議事堂", house: "拓荒家屋", lumberCamp: "木作營", farmstead: "糧秣所", barracks: "邊軍兵營",
  defenseTower: "守望塔", archeryRange: "射箭庭", mageSanctum: "星火院", gunWorkshop: "火器坊", beastStable: "獠騎圈",
  siegeWorkshop: "攻城棚", resinPalisade: "樹脂石籠牆", surveyGate: "測界雙葉門", copperLandmark: "拓界銅標",
};
export const buildingDisplayName = (type: BuildingType): string => BUILDING_LABELS[type];
