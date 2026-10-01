import type Phaser from "phaser";
import type { CombatAction, Facing } from "./directionalAnimation";
import type { TeamPalette } from "./combatArt";
import { FrameAnimatedCombatActor } from "./frameAnimatedCombatActor";
import type { FrameAnimatedCombatActorView } from "./frameAnimatedCombatActor";
import { VILLAGE_WORKER_ANIMATION_MANIFEST } from "./villageWorkerAnimation";

export type VillageWorkerPose =
  | "fieldReady"
  | "carryWood"
  | "carryFood"
  | "carryStone"
  | "harvestWood"
  | "harvestFood"
  | "harvestStone"
  | "construction"
  | "repair";

export interface VillageWorkerActorView extends FrameAnimatedCombatActorView {
  setWorkerPose(pose: VillageWorkerPose): this;
}

interface VillageWorkerActorOptions {
  readonly x: number;
  readonly y: number;
  readonly teamPalette?: TeamPalette;
  readonly facing?: Facing;
  readonly action?: CombatAction;
}

/** A civilian apron/tool sheet, with real authored walk/work frames and fixed hands. */
export class VillageWorkerActor extends FrameAnimatedCombatActor implements VillageWorkerActorView {
  private workerPose: VillageWorkerPose = "fieldReady";

  constructor(scene: Phaser.Scene, options: VillageWorkerActorOptions) {
    super(scene, { ...options, id: "villager" }, VILLAGE_WORKER_ANIMATION_MANIFEST);
  }

  override get snapshot() {
    return { ...super.snapshot, workerPose: this.workerPose };
  }

  setWorkerPose(pose: VillageWorkerPose): this {
    // Cargo is drawn by the existing entity view. Orders select attack/work or
    // cast/craft rows; changing a tool role never replaces legs with a bitmap bob.
    this.workerPose = pose;
    return this;
  }

  override play(action: CombatAction, restart?: boolean): this {
    // Online snapshots repeat the current work action. Repeated packets must
    // not pin an authored work cycle to frame0 every server tick.
    const continuousWork = action === "attack" || action === "cast";
    return super.play(action, continuousWork ? action !== this.snapshot.action : restart);
  }

}

export function createVillageWorkerActor(scene: Phaser.Scene, options: VillageWorkerActorOptions): VillageWorkerActor {
  return new VillageWorkerActor(scene, options);
}
