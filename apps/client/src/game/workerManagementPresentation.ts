import type { PublicEntityState, ResourceKind, VisibleSnapshot } from "@village-siege/shared";

export const WORKER_RESOURCE_LABELS: Readonly<Record<ResourceKind, string>> = Object.freeze({
  food: "採糧",
  wood: "伐木",
  stone: "採石",
});

const ACTIVITY_LABELS: Readonly<Record<NonNullable<PublicEntityState["civilianActivity"]>, string>> = Object.freeze({
  idle: "閒置",
  walking: "移動中",
  gathering: "採集中",
  hauling: "運送中",
  constructing: "施工中",
  repairing: "修復中",
});

export interface WorkerManagementEntry {
  readonly id: string;
  readonly label: string;
  readonly activity: string;
  readonly cargo: string;
}

/**
 * Projects only the recipient's currently visible, living villagers. It never
 * reaches through the public snapshot to infer orders or hidden targets.
 */
export function visibleOwnedWorkers(snapshot: VisibleSnapshot): readonly WorkerManagementEntry[] {
  const visibleIds = new Set(snapshot.visibleEntityIds);
  return snapshot.entities
    .filter((entity) => entity.kind === "unit"
      && entity.typeId === "villager"
      && entity.ownerId === snapshot.recipientPlayerId
      && entity.hitPoints > 0
      && visibleIds.has(entity.id))
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
    .map((worker, index) => ({
      id: worker.id,
      label: `工匠 ${index + 1}`,
      activity: worker.civilianActivity ? ACTIVITY_LABELS[worker.civilianActivity] : "狀態不明",
      cargo: cargoLabel(worker),
    }));
}

export function workerManagementPageSize(width: number, height: number): 1 | 2 | 4 {
  if (width <= 568 || height <= 320) return 1;
  if (width <= 844 || height <= 520) return 2;
  return 4;
}

function cargoLabel(worker: PublicEntityState): string {
  const cargo = worker.cargo;
  if (!cargo || cargo.kind === null || cargo.amount <= 0) return "未攜帶材料";
  const material = ({ food: "糧", wood: "木", stone: "石" } satisfies Record<ResourceKind, string>)[cargo.kind];
  return `攜帶${material} ${Math.floor(cargo.amount)}/${Math.floor(cargo.capacity)}`;
}
