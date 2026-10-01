import type { GridPoint, PublicEntityState } from "@village-siege/shared";
import { publicEntityFootprintCells } from "./assaultPublicPresentation";

/** Visible occupancy follows build validation: participating builders can move
 * off their footprint; other living units cannot be built over. Monsters are
 * dynamic blockers, not reserved building footprints in the shared rules. */
export function constructionPreviewOccupiedCells(
  visibleEntities: readonly PublicEntityState[],
  builderIds: ReadonlySet<string>,
): readonly GridPoint[] {
  return visibleEntities.filter(entity => entity.kind !== "monster" && (
    entity.kind !== "unit" || (entity.hitPoints > 0 && !builderIds.has(entity.id))
  )).flatMap(publicEntityFootprintCells);
}
