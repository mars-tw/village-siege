import type { VisibleSnapshot } from "@village-siege/shared";
import type { CombatArtId } from "./directionalAnimation";
import { isPublicMonster, isPublicUnit } from "./assaultPublicPresentation";

const MILITARY_ART = { warrior: "warrior", shieldBearer: "shieldbearer", archer: "archer", mage: "mage", musketeer: "musketeer", boarRider: "boar_rider", heavyCrossbowman: "heavy_crossbow" } as const;

/** Initial blocking downloads cover only entities actually present in the
 * recipient's starting view. The worker set and landscape are core assets. */
export function initialBattleArtIds(view: VisibleSnapshot | undefined): readonly CombatArtId[] {
  const ids = new Set<CombatArtId>();
  const visibleIds = new Set(view?.visibleEntityIds ?? []);
  for (const entity of view?.entities ?? []) {
    if (entity.ownerId !== view?.recipientPlayerId && !visibleIds.has(entity.id)) continue;
    if (isPublicUnit(entity) && entity.typeId !== "villager") ids.add(MILITARY_ART[entity.typeId]);
    else if (isPublicMonster(entity)) ids.add(entity.typeId);
  }
  return [...ids];
}
