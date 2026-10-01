import { BUILDINGS, type GameCommand, type GridPoint, type PublicEntityState } from "@village-siege/shared";
import { isPublicBuilding, publicEntityFootprintCells } from "./assaultPublicPresentation";

interface WorkEntity {
  readonly id: string;
  readonly kind: string;
  readonly ownerId: string | null;
  readonly typeId: string;
  readonly hitPoints: number;
  readonly position: GridPoint;
  readonly complete?: boolean;
  readonly order?: { readonly type: string };
  readonly civilianActivity?: string;
}

/** Navigation differs from build occupancy: open gates and rubble are paths. */
export function continuationMovementBlockedCells(entities: readonly PublicEntityState[]): readonly GridPoint[] {
  return entities.filter(entity => {
    if (entity.kind === "resource") return true;
    if (!isPublicBuilding(entity) || entity.hitPoints <= 0) return false;
    if (entity.blocksMovement !== undefined) return entity.blocksMovement;
    return BUILDINGS[entity.typeId].movementBlocking !== "whenClosed" || !entity.complete || !entity.gateOpen;
  }).flatMap(publicEntityFootprintCells);
}

/** Explicitly selected workers may switch jobs; the existing wire command
 * continues an unfinished foundation without paying its build cost again. */
export function constructionContinuationCommand(
  target: WorkEntity,
  selected: readonly WorkEntity[],
  ownerId: string,
): Extract<GameCommand, { type: "repair" }> | null {
  if (target.kind !== "building" || target.ownerId !== ownerId || target.complete !== false || target.hitPoints <= 0) return null;
  const ids = [...new Set(selected.filter(worker => (
    worker.kind === "unit" && worker.typeId === "villager" && worker.ownerId === ownerId && worker.hitPoints > 0
  )).map(worker => worker.id))];
  return ids.length > 0 ? { type: "repair", entityIds: ids, targetId: target.id } : null;
}

/** The site's shortcut must not silently abandon another construction site.
 * Idle workers are preferred; gathering/moving workers are available next. */
export function chooseContinuationWorker<T extends WorkEntity>(
  candidates: readonly T[],
  target: WorkEntity,
  ownerId: string,
  approachDistance: (worker: T) => number | null,
): T | null {
  const eligible = candidates.filter(worker => constructionContinuationCommand(target, [worker], ownerId) !== null
    && worker.order?.type !== "construct" && worker.order?.type !== "repair"
    && worker.civilianActivity !== "constructing" && worker.civilianActivity !== "repairing");
  return eligible.map(worker => ({
    worker,
    distance: approachDistance(worker),
    priority: worker.order?.type === "idle" || worker.civilianActivity === "idle" ? 0 : 1,
  })).filter((entry): entry is typeof entry & { distance: number } => entry.distance !== null && Number.isFinite(entry.distance))
    .sort((left, right) => left.priority - right.priority || left.distance - right.distance || left.worker.id.localeCompare(right.worker.id))[0]?.worker ?? null;
}
