import Phaser from "phaser";
import { DEFAULT_TEAM_PALETTES, type TeamPalette } from "./combatArt";
import {
  resolveFacing,
  type AnimationFrameEvent,
  type CombatAction,
  type Facing,
} from "./directionalAnimation";
import type { FrameAnimatedCombatActorView } from "./frameAnimatedCombatActor";

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

const INK = 0x1c211f;
const SKIN = 0xd0a879;
const SKIN_SHADOW = 0x9a7255;
const LINEN = 0xb8ad87;
const LINEN_SHADOW = 0x746d57;
const LEATHER = 0x553d2c;
const WOOD = 0x76563a;
const WOOD_LIGHT = 0xaa8657;
const IRON = 0x4f5958;
const IRON_LIGHT = 0xaeb8ad;
const COPPER = 0xb47a36;
const GRAIN = 0xd0aa54;
const STONE = 0x69716b;

/**
 * A dedicated original worker silhouette. It deliberately uses a broad apron,
 * rolled sleeves and a copper carpenter's square instead of borrowing a combat
 * unit. The authoritative order only selects the visible tool pose.
 */
export class VillageWorkerActor implements VillageWorkerActorView {
  readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly aura: Phaser.GameObjects.Ellipse;
  private readonly artRoot: Phaser.GameObjects.Container;
  private readonly art: Phaser.GameObjects.Graphics;
  private palette: TeamPalette;
  private action: CombatAction;
  private facing: Facing;
  private pose: VillageWorkerPose = "fieldReady";
  private elapsedMs = 0;

  constructor(scene: Phaser.Scene, options: VillageWorkerActorOptions) {
    this.palette = options.teamPalette ?? DEFAULT_TEAM_PALETTES.neutral;
    this.action = options.action ?? "idle";
    this.facing = options.facing ?? "se";
    this.shadow = scene.add.ellipse(0, 2, 36, 13, 0x10241e, 0.38);
    this.aura = scene.add.ellipse(0, -6, 39, 14, this.palette.highlight, 0.08);
    this.art = scene.add.graphics();
    this.artRoot = scene.add.container(0, 0, [this.art]);
    this.container = scene.add.container(options.x, options.y, [this.shadow, this.aura, this.artRoot]);
    this.container.setSize(96, 112).setDepth(options.y);
    this.renderFacing();
    this.render();
  }

  play(action: CombatAction, restart = action !== this.action): this {
    if (action !== this.action || restart) {
      this.action = action;
      this.elapsedMs = 0;
      this.render();
    }
    return this;
  }

  faceVector(gridDx: number, gridDy: number): this {
    return this.setFacing(resolveFacing(gridDx, gridDy, this.facing));
  }

  setFacing(facing: Facing): this {
    if (facing !== this.facing) {
      this.facing = facing;
      this.renderFacing();
    }
    return this;
  }

  setTeamPalette(palette: TeamPalette): this {
    this.palette = palette;
    this.aura.setFillStyle(palette.highlight, 0.08);
    this.render();
    return this;
  }

  setWorkerPose(pose: VillageWorkerPose): this {
    if (pose !== this.pose) {
      this.pose = pose;
      this.elapsedMs = 0;
      this.render();
    }
    return this;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y).setDepth(y);
    return this;
  }

  update(deltaMs: number): readonly AnimationFrameEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return [];
    this.elapsedMs += Math.min(deltaMs, 250);
    this.render();
    return [];
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private renderFacing(): void {
    const facesLeft = this.facing === "w" || this.facing === "nw" || this.facing === "sw";
    this.artRoot.setScale(facesLeft ? -1 : 1, 1);
  }

  private render(): void {
    const g = this.art;
    g.clear();
    const phase = this.elapsedMs / 1000 * Math.PI * 2;
    const walking = this.action === "walk";
    const working = this.action === "attack" || this.action === "cast";
    const stride = walking ? Math.sin(phase * 1.7) * 4 : 0;
    const work = working ? (Math.sin(phase * 1.35 - Math.PI / 2) + 1) / 2 : 0.2;
    const bob = walking ? -Math.abs(Math.sin(phase * 1.7)) * 2 : Math.sin(phase * 0.45) * 0.5;
    const collapse = this.action === "death" ? Math.min(1, this.elapsedMs / 850) : 0;
    const recoil = this.action === "hurt" ? Math.sin(Math.min(1, this.elapsedMs / 280) * Math.PI) * -6 : 0;

    g.save();
    g.translateCanvas(recoil, bob + collapse * 17);
    if (collapse > 0) g.rotateCanvas(collapse * 0.72);

    // Boots and wide-set legs keep the worker readable at mobile scale.
    g.lineStyle(7, INK, 1)
      .lineBetween(-7, -17, -9 + stride, 0)
      .lineBetween(7, -17, 9 - stride, 0);
    g.lineStyle(5, LEATHER, 1)
      .lineBetween(-9 + stride, -1, -15 + stride, 1)
      .lineBetween(9 - stride, -1, 15 - stride, 1);

    // Broad lime-dusted apron, short torso and rolled sleeves: not a warrior coat.
    g.fillStyle(LINEN_SHADOW, 1).fillTriangle(-19, -48, 18, -48, 14, -13).fillRect(-14, -50, 28, 26);
    g.fillStyle(LINEN, 1).fillTriangle(-14, -46, 13, -46, 8, -16).fillRect(-10, -49, 20, 24);
    g.lineStyle(3, INK, 0.88).lineBetween(-18, -48, -12, -14).lineBetween(18, -48, 12, -14);
    g.fillStyle(this.palette.primary, 1).fillRect(-16, -45, 8, 23);
    g.fillStyle(this.palette.highlight, 1).fillRect(-15, -43, 5, 8);
    g.fillStyle(LEATHER, 1).fillRect(-18, -31, 36, 5);

    const handLift = this.pose === "construction" || this.pose === "repair" ? work * 20 : 0;
    g.lineStyle(8, LINEN_SHADOW, 1)
      .lineBetween(-13, -44, -24, -32 - handLift * 0.25)
      .lineBetween(13, -44, 24, -31 - handLift);
    g.fillStyle(SKIN, 1)
      .fillCircle(-25, -31 - handLift * 0.25, 5)
      .fillCircle(25, -30 - handLift, 5);

    g.fillStyle(SKIN_SHADOW, 1).fillCircle(0, -59, 12);
    g.fillStyle(SKIN, 1).fillCircle(2, -61, 10);
    // Asymmetric surveyor cap and copper pin form the idle signature.
    g.fillStyle(this.palette.dark, 1).fillTriangle(-13, -67, 14, -71, 5, -78).fillRect(-12, -70, 25, 5);
    g.fillStyle(this.palette.light, 1).fillTriangle(4, -78, 12, -70, 7, -68);
    g.fillStyle(COPPER, 1).fillCircle(10, -69, 2.5);
    g.fillStyle(INK, 0.9).fillCircle(8, -60, 1.5);

    this.drawTool(g, work, handLift);
    g.restore();
  }

  private drawTool(g: Phaser.GameObjects.Graphics, work: number, handLift: number): void {
    if (this.pose === "carryWood") {
      for (let index = 0; index < 3; index += 1) {
        const y = -54 + index * 8;
        g.lineStyle(9, index % 2 ? WOOD_LIGHT : WOOD, 1).lineBetween(-30, y + 10, 29, y - 9);
        g.lineStyle(2, INK, 0.8).strokeCircle(-30, y + 10, 4);
      }
      g.lineStyle(3, this.palette.highlight, 0.9).lineBetween(-17, -56, 17, -28);
      return;
    }
    if (this.pose === "carryFood") {
      g.lineStyle(6, WOOD_LIGHT, 1).lineBetween(-31, -57, 31, -57);
      for (const side of [-1, 1]) {
        const x = side * 27;
        g.lineStyle(2, LEATHER, 1).lineBetween(x, -56, x, -35);
        g.fillStyle(GRAIN, 1).fillTriangle(x - 10, -34, x + 10, -34, x + 7, -17).fillRect(x - 7, -33, 14, 16);
        g.lineStyle(2, INK, 0.75).strokeRect(x - 8, -34, 16, 17);
      }
      return;
    }
    if (this.pose === "carryStone") {
      g.fillStyle(LEATHER, 1).fillTriangle(-24, -50, -6, -54, -9, -18);
      g.fillStyle(STONE, 1).fillCircle(-20, -48, 7).fillCircle(-10, -45, 6).fillCircle(-16, -38, 7);
      g.lineStyle(3, this.palette.highlight, 0.9).lineBetween(-22, -52, 5, -25);
      return;
    }
    if (this.pose === "construction" || this.pose === "repair") {
      const angle = -0.9 + work * 1.55;
      const handX = 25;
      const handY = -30 - handLift;
      const endX = handX + Math.cos(angle) * 50;
      const endY = handY + Math.sin(angle) * 50;
      g.lineStyle(5, WOOD_LIGHT, 1).lineBetween(handX, handY, endX, endY);
      g.lineStyle(10, IRON, 1).lineBetween(endX - 10, endY - 5, endX + 10, endY + 5);
      g.lineStyle(2, IRON_LIGHT, 0.9).lineBetween(endX - 8, endY - 6, endX + 8, endY + 3);
      if (this.pose === "repair") {
        g.lineStyle(4, COPPER, 1).lineBetween(-25, -25, -8, -8).lineBetween(-25, -25, -27, -8);
      }
      return;
    }
    if (this.pose === "harvestFood") {
      g.lineStyle(5, WOOD_LIGHT, 1).lineBetween(24, -31, 35, -3);
      g.lineStyle(4, IRON_LIGHT, 1).beginPath().arc(27, -1, 12, -0.15, Math.PI * 0.92, false).strokePath();
      g.fillStyle(GRAIN, 1).fillTriangle(-27, -9, -22, -32, -17, -9).fillTriangle(-20, -8, -13, -28, -9, -7);
      return;
    }
    if (this.pose === "harvestWood" || this.pose === "harvestStone") {
      const angle = -0.6 + work * 1.25;
      const endX = 24 + Math.cos(angle) * 42;
      const endY = -31 + Math.sin(angle) * 42;
      g.lineStyle(5, WOOD_LIGHT, 1).lineBetween(24, -31, endX, endY);
      if (this.pose === "harvestWood") {
        g.fillStyle(IRON, 1).fillTriangle(endX - 11, endY - 9, endX + 10, endY - 5, endX + 1, endY + 8);
      } else {
        g.lineStyle(7, IRON, 1).lineBetween(endX - 13, endY - 6, endX + 13, endY + 6);
      }
      return;
    }
    // Carpenter's square and short mallet identify an idle worker without text.
    g.lineStyle(4, COPPER, 1).lineBetween(16, -29, 27, -15).lineBetween(27, -15, 17, -14);
    g.lineStyle(4, WOOD_LIGHT, 1).lineBetween(-24, -31, -28, -10);
    g.lineStyle(8, IRON, 1).lineBetween(-35, -11, -22, -9);
  }
}

export function createVillageWorkerActor(scene: Phaser.Scene, options: VillageWorkerActorOptions): VillageWorkerActor {
  return new VillageWorkerActor(scene, options);
}
