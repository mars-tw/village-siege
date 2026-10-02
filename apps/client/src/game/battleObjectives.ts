import {
  BUILDINGS,
  UNITS,
  isVillageAssaultLayoutId,
  isVillageAssaultWalkableCell,
  type BuildingType,
  type GameCommand,
  type GridPoint,
  type PublicEntityState,
  type UnitType,
  type VisibleSnapshot,
} from "@village-siege/shared";

const COMBAT_UNIT_TYPES = ["warrior", "shieldBearer", "archer", "mage", "musketeer", "boarRider", "heavyCrossbowman"] as const;
const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
const UNIT_TYPES = Object.keys(UNITS) as UnitType[];

export type BattleObjectiveAction =
  | { readonly kind: "progression"; readonly tab: "era" | "economy" | "military" | "artificer" }
  | { readonly kind: "selectUnitGroup"; readonly entityIds: readonly string[] }
  | { readonly kind: "showProducer"; readonly buildingType: BuildingType; readonly unitType?: UnitType }
  | { readonly kind: "build"; readonly buildingType: BuildingType }
  | { readonly kind: "command"; readonly command: GameCommand };

export interface BattleObjectiveCard {
  readonly id: string;
  readonly stage: "發展" | "集結" | "偵察" | "攻城" | "勝利條件" | "兵種指南";
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly done: boolean;
  readonly actionLabel?: string;
  readonly action?: BattleObjectiveAction;
}

export const COMBAT_ROLE_GUIDE: readonly BattleObjectiveCard[] = [
  guide("warrior", "戰士", "近戰前排，適合貼近遠程部隊並守住狹口。"),
  guide("shieldBearer", "持盾兵", "耐久前排，適合掩護後排承受正面壓力。"),
  guide("archer", "弓箭手", "遠程輸出，應與近戰前排保持隊形。"),
  guide("mage", "法師", "遠程術士，適合在前排後方支援交戰。"),
  guide("musketeer", "火槍手", "穩定遠程火力，避免被快速近戰貼身。"),
  guide("boarRider", "野豬騎兵", "快速機動兵，適合側翼、追擊與偵察。"),
  guide("heavyCrossbowman", "重弩手", "重型遠程兵，適合在掩護下攻擊建築與高耐久目標。"),
];

export function battleObjectiveCards(snapshot: VisibleSnapshot): readonly BattleObjectiveCard[] {
  const finished = snapshot.phase === "finished";
  const own = snapshot.entities.filter((entity) => entity.ownerId === snapshot.recipientPlayerId && entity.hitPoints > 0);
  const ownBuildings = own.filter(isPublicBuilding);
  const ownMilitary = own.filter(isPublicCombatUnit);
  const hasBarracks = ownBuildings.some((entity) => entity.typeId === "barracks" && entity.complete);
  const hasLumberCamp = ownBuildings.some((entity) => entity.typeId === "lumberCamp" && entity.complete);
  const prerequisitesDone = hasBarracks && hasLumberCamp;
  const developmentAction = !hasBarracks
    ? ({ kind: "build", buildingType: "barracks" } as const)
    : !hasLumberCamp
      ? ({ kind: "build", buildingType: "lumberCamp" } as const)
      : snapshot.settlementTier === "frontier"
        ? ({ kind: "progression", tab: "era" } as const)
        : undefined;

  const cards: BattleObjectiveCard[] = [{
    id: "development",
    stage: "發展",
    title: prerequisitesDone ? "準備擴建聚落" : "打穩生產基礎",
    detail: "完成兵營與木作營，或進入科技與時代查看下一段發展。所有建造都使用現有工匠與資源。",
    status: prerequisitesDone ? `兵營與木作營已完成 · ${tierName(snapshot.settlementTier)}` : `兵營 ${hasBarracks ? "已完成" : "未完成"} · 木作營 ${hasLumberCamp ? "已完成" : "未完成"}`,
    done: prerequisitesDone,
    ...(!finished && developmentAction ? { actionLabel: developmentAction.kind === "progression" ? "查看發展" : `建造${developmentAction.buildingType === "barracks" ? "兵營" : "木作營"}`, action: developmentAction } : {}),
  }];

  if (ownMilitary.length < 3) {
    const producer = firstLegalProducer(snapshot, ownBuildings);
    cards.push({
      id: "rally",
      stage: "集結",
      title: "集結三名戰士",
      detail: "先補足可出征的軍隊；工匠不計入軍力。",
      status: `目前 ${ownMilitary.length} / 3 名${producer ? ` · 可由${buildingName(producer.buildingType)}訓練${unitName(producer.unitType)}` : " · 尚無可用軍事生產建築"}`,
      done: false,
      ...(!finished && producer ? { actionLabel: "查看生產建築", action: { kind: "showProducer", ...producer } as const } : {}),
    });
  } else {
    const enemyTown = currentlyVisibleEnemyTownCenter(snapshot);
    if (enemyTown) {
      cards.push({
        id: "assault",
        stage: "攻城",
        title: "攻擊敵方城鎮中心",
        detail: "敵方城鎮中心正在視野內。命令自己的軍隊攻擊這個可見目標。",
        status: `已集結 ${ownMilitary.length} 名 · 目標目前可見`,
        done: false,
        ...(!finished ? { actionLabel: "發動攻城", action: { kind: "command", command: { type: "attack", entityIds: ownMilitary.map(({ id }) => id), targetId: enemyTown.id } } as const } : {}),
      });
    } else {
      const waypoint = scoutWaypoint(snapshot, ownBuildings);
      cards.push({
        id: "scout",
        stage: "偵察",
        title: "偵察對岸",
        detail: "敵方城鎮中心目前不在視野內。軍隊會前往公開地圖上的對岸集結點，不會鎖定霧外單位。",
        status: `已集結 ${ownMilitary.length} 名 · 尚未取得可攻擊的城鎮中心視野`,
        done: false,
        ...(!finished && waypoint ? { actionLabel: "派隊偵察", action: { kind: "command", command: { type: "attackMove", entityIds: ownMilitary.map(({ id }) => id), target: waypoint } } as const } : {}),
      });
    }
  }

  cards.push(victoryCard(snapshot));
  return [...cards, ...COMBAT_ROLE_GUIDE];
}

function currentlyVisibleEnemyTownCenter(snapshot: VisibleSnapshot): PublicEntityState | undefined {
  const visibleIds = new Set(snapshot.visibleEntityIds);
  const hostilePlayerIds = new Set(snapshot.participants.filter((participant) => participant.teamId !== snapshot.recipientTeamId).map(({ id }) => id));
  return snapshot.entities.find((entity) => isPublicBuilding(entity)
    && entity.typeId === "townCenter"
    && entity.ownerId !== null
    && hostilePlayerIds.has(entity.ownerId)
    && entity.hitPoints > 0
    && visibleIds.has(entity.id));
}

function scoutWaypoint(snapshot: VisibleSnapshot, ownBuildings: readonly PublicEntityState[]): GridPoint | undefined {
  const home = ownBuildings.find((entity) => entity.typeId === "townCenter")?.position ?? ownBuildings[0]?.position;
  const leftHome = (home?.x ?? 0) < snapshot.map.width / 2;
  const preferred = { x: leftHome ? snapshot.map.width - 7 : 6, y: Math.min(8, snapshot.map.height - 1) };
  const candidates = [preferred, ...[-1, 1, -2, 2].map((dy) => ({ x: preferred.x, y: preferred.y + dy }))];
  return candidates.find((point) => point.x >= 0 && point.y >= 0 && point.x < snapshot.map.width && point.y < snapshot.map.height && publicMapPassable(snapshot, point));
}

function publicMapPassable(snapshot: VisibleSnapshot, point: GridPoint): boolean {
  if (snapshot.map.id !== "villageAssault") return false;
  return isVillageAssaultLayoutId(snapshot.map.layoutId) && isVillageAssaultWalkableCell(point, snapshot.map.layoutId);
}

function firstLegalProducer(snapshot: VisibleSnapshot, buildings: readonly PublicEntityState[]): { buildingType: BuildingType; unitType: UnitType } | undefined {
  const order = tierRank(snapshot.settlementTier);
  for (const unitType of COMBAT_UNIT_TYPES) {
    const definition = UNITS[unitType];
    if (tierRank(definition.requiredTier) > order) continue;
    const building = buildings.find((candidate) => candidate.complete && definition.producers.includes(candidate.typeId as BuildingType));
    if (building) return { buildingType: building.typeId as BuildingType, unitType };
  }
  return undefined;
}

function victoryCard(snapshot: VisibleSnapshot): BattleObjectiveCard {
  const ownScore = snapshot.victory.teams.find((team) => team.teamId === snapshot.recipientTeamId);
  const policy = snapshot.victory.policy;
  const parts: string[] = [];
  if (policy.commandCenterConquest) parts.push("摧毀敵方城鎮中心並守到重建期限結束");
  if (policy.elimination) parts.push("殲滅敵方所有單位與建築");
  if (policy.landmark) parts.push(`守住銅製地標 ${Math.ceil(policy.landmark.holdTicks / 10)} 秒`);
  if (policy.timedControl) parts.push(`控制中央區域 ${Math.ceil(policy.timedControl.targetTicks / 10)} 秒（目前 ${Math.floor((ownScore?.timedControlScoreTicks ?? 0) / 10)} 秒）`);
  const won = snapshot.phase === "finished" && snapshot.victory.winningTeamIds.includes(snapshot.recipientTeamId);
  return {
    id: "victory-policy", stage: "勝利條件", title: snapshot.phase === "finished" ? (won ? "戰役勝利" : "戰役結束") : "本局勝利目標",
    detail: parts.join("；") || "等待本局勝利規則同步。",
    status: snapshot.phase === "finished" ? `結算：${snapshot.victory.finishReason ?? "已結束"}` : `${snapshot.victory.control.contested ? "控制區交戰中" : snapshot.victory.control.controllerTeamId === snapshot.recipientTeamId ? "我方控制區域" : "尚未控制區域"} · 目標面板不提供額外資源`,
    done: snapshot.phase === "finished",
  };
}

function isPublicBuilding(entity: PublicEntityState): entity is PublicEntityState & { readonly kind: "building"; readonly typeId: BuildingType } {
  return entity.kind === "building" && BUILDING_TYPES.includes(entity.typeId as BuildingType);
}
function isPublicCombatUnit(entity: PublicEntityState): entity is PublicEntityState & { readonly kind: "unit"; readonly typeId: Exclude<UnitType, "villager"> } {
  return entity.kind === "unit" && UNIT_TYPES.includes(entity.typeId as UnitType) && entity.typeId !== "villager";
}
function tierRank(tier: VisibleSnapshot["settlementTier"]): number { return ["frontier", "stronghold", "artificer"].indexOf(tier); }
function tierName(tier: VisibleSnapshot["settlementTier"]): string { return ({ frontier: "拓荒期", stronghold: "堡壘期", artificer: "工藝期" } as const)[tier]; }
function buildingName(type: BuildingType): string { return ({ barracks: "兵營", archeryRange: "靶場", mageSanctum: "法師聖所", gunWorkshop: "火槍工坊", beastStable: "獸欄", siegeWorkshop: "攻城工坊" } as Partial<Record<BuildingType, string>>)[type] ?? type; }
function unitName(type: UnitType): string { return ({ warrior: "戰士", shieldBearer: "持盾兵", archer: "弓箭手", mage: "法師", musketeer: "火槍手", boarRider: "野豬騎兵", heavyCrossbowman: "重弩手" } as Partial<Record<UnitType, string>>)[type] ?? type; }
function guide(id: string, title: string, detail: string): BattleObjectiveCard { return { id: `guide-${id}`, stage: "兵種指南", title, detail, status: "角色說明依實際兵種定位；請依戰場與隊形搭配", done: false }; }
