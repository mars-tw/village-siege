import type { PublicProductionJob } from "@village-siege/shared";

/** A fully trained unit may still wait for safe physical space to emerge. */
export function productionProgressLabel(job: Pick<PublicProductionJob, "kind" | "remainingTicks" | "totalTicks">): string {
  if (job.kind === "train" && job.remainingTicks === 0) return "等候出營";
  return `${Math.round(Math.max(0, Math.min(1, 1 - job.remainingTicks / Math.max(1, job.totalTicks))) * 100)}%`;
}
