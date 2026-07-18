import Phaser from "phaser";
import {
  DEFAULT_TEAM_PALETTES,
  createProceduralCombatActor,
  type ProceduralCombatActor,
  type ProceduralCombatActorOptions,
  type TeamPalette,
} from "./combatArt";
import {
  ANCHOR_CONTRACT,
  DirectionalAnimationController,
  type AnimationFrameEvent,
  type CombatAction,
  type CombatArtId,
  type DirectionalAnimationSnapshot,
  type Facing,
} from "./directionalAnimation";

export type IllustratedUnitId =
  | "warrior"
  | "shieldBearer"
  | "archer"
  | "mage"
  | "musketeer"
  | "boarRider"
  | "heavyCrossbowman";

export type IllustratedCombatActorOptions = ProceduralCombatActorOptions;

export const ILLUSTRATED_UNIT_IDS = [
  "warrior",
  "shieldBearer",
  "archer",
  "mage",
  "musketeer",
  "boarRider",
  "heavyCrossbowman",
] as const satisfies readonly IllustratedUnitId[];

export const ILLUSTRATED_UNIT_TEXTURE_KEYS: Readonly<Record<IllustratedUnitId, string>> = {
  warrior: "unit-art-warrior",
  shieldBearer: "unit-art-shieldBearer",
  archer: "unit-art-archer",
  mage: "unit-art-mage",
  musketeer: "unit-art-musketeer",
  boarRider: "unit-art-boarRider",
  heavyCrossbowman: "unit-art-heavyCrossbowman",
};

const ART_TO_UNIT: Readonly<Partial<Record<CombatArtId, IllustratedUnitId>>> = {
  warrior: "warrior",
  shieldbearer: "shieldBearer",
  archer: "archer",
  mage: "mage",
  musketeer: "musketeer",
  boar_rider: "boarRider",
  heavy_crossbow: "heavyCrossbowman",
};

const LEFT_FACINGS = new Set<Facing>(["w", "nw", "sw"]);

const FACING_VECTOR: Readonly<Record<Facing, { readonly x: number; readonly y: number }>> = {
  e: { x: 1, y: 0 },
  ne: { x: 0.9, y: -0.45 },
  nw: { x: -0.9, y: -0.45 },
  w: { x: -1, y: 0 },
  sw: { x: -0.9, y: 0.45 },
  se: { x: 0.9, y: 0.45 },
};

const ILLUSTRATED_TARGET_BOUNDS: Readonly<Partial<Record<CombatArtId, { readonly width: number; readonly height: number }>>> = {
  warrior: { width: 128, height: 132 },
  shieldbearer: { width: 132, height: 138 },
  archer: { width: 122, height: 142 },
  mage: { width: 120, height: 144 },
  musketeer: { width: 158, height: 136 },
  boar_rider: { width: 190, height: 148 },
  heavy_crossbow: { width: 202, height: 132 },
};

export interface CombatActorView {
  readonly container: Phaser.GameObjects.Container;
  readonly animation: DirectionalAnimationController;
  play(action: CombatAction, restart?: boolean): this;
  setFacing(facing: Facing): this;
  faceVector(gridDx: number, gridDy: number): this;
  setTeamPalette(palette: TeamPalette): this;
  setPosition(x: number, y: number): this;
  update(deltaMs: number): readonly AnimationFrameEvent[];
  destroy(): void;
}

/**
 * Presentation-only actor for a single transparent character master image.
 * Authoritative movement, damage, timing and facing remain outside this class.
 */
export class IllustratedCombatActor implements CombatActorView {
  readonly container: Phaser.GameObjects.Container;
  readonly animation: DirectionalAnimationController;
  private readonly image: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly aura: Phaser.GameObjects.Ellipse;
  private readonly artScale: number;
  private palette: TeamPalette;
  private renderSignature = "";

  constructor(scene: Phaser.Scene, options: IllustratedCombatActorOptions, textureKey: string) {
    const contract = ANCHOR_CONTRACT[options.id];
    this.palette = options.teamPalette ?? DEFAULT_TEAM_PALETTES.neutral;
    this.animation = new DirectionalAnimationController(options.id, options.action, options.facing);
    this.shadow = scene.add.ellipse(0, 2, contract.shadowWidth * 1.2, contract.shadowHeight * 1.15, 0x10241e, 0.38);
    this.aura = scene.add.ellipse(0, -8, contract.shadowWidth * 1.25, contract.shadowHeight * 1.2, this.palette.highlight, 0.08);
    this.image = scene.add.image(0, 2, textureKey).setOrigin(0.5, 1);

    const sourceWidth = Math.max(1, this.image.width);
    const sourceHeight = Math.max(1, this.image.height);
    const targetBounds = ILLUSTRATED_TARGET_BOUNDS[options.id];
    const targetWidth = targetBounds?.width ?? contract.frameWidth;
    const targetHeight = targetBounds?.height ?? contract.frameHeight;
    this.artScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    this.image.setScale(this.artScale);

    this.container = scene.add.container(options.x, options.y, [this.shadow, this.aura, this.image]);
    this.container.setSize(contract.frameWidth, contract.frameHeight);
    this.container.setDepth(options.depth ?? options.y);
    this.container.setScale(options.scale ?? 1);
    this.render(true);
  }

  play(action: CombatAction, restart = action !== this.animation.action): this {
    this.animation.play(action, restart);
    this.render(true);
    return this;
  }

  setFacing(facing: Facing): this {
    this.animation.setFacing(facing);
    this.render(true);
    return this;
  }

  faceVector(gridDx: number, gridDy: number): this {
    this.animation.faceVector(gridDx, gridDy);
    this.render(true);
    return this;
  }

  setTeamPalette(palette: TeamPalette): this {
    this.palette = palette;
    this.aura.setFillStyle(palette.highlight, 0.08);
    this.render(true);
    return this;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y).setDepth(y);
    return this;
  }

  update(deltaMs: number): readonly AnimationFrameEvent[] {
    const events = this.animation.update(deltaMs);
    this.render(false);
    return events;
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private render(force: boolean): void {
    const snapshot = this.animation.snapshot;
    const signature = `${snapshot.action}:${snapshot.facing}:${snapshot.frame}`;
    if (!force && signature === this.renderSignature) return;
    this.renderSignature = signature;
    this.applyPose(snapshot);
  }

  private applyPose(snapshot: DirectionalAnimationSnapshot): void {
    const time = snapshot.normalizedTime;
    const wave = Math.sin(time * Math.PI * 2);
    const pulse = Math.sin(time * Math.PI);
    const vector = FACING_VECTOR[snapshot.facing];
    const facingLeft = LEFT_FACINGS.has(snapshot.facing);
    let offsetX = 0;
    let offsetY = 2;
    let scaleX = this.artScale;
    let scaleY = this.artScale;
    let rotation = 0;
    let alpha = 1;
    let auraAlpha = 0.08;
    let auraScale = 1;

    this.image.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    switch (snapshot.action) {
      case "idle":
        offsetY -= Math.max(0, wave) * 1.2;
        scaleY *= 1 + wave * 0.008;
        break;
      case "walk":
        offsetX += wave * 1.4;
        offsetY -= Math.abs(wave) * 3.2;
        rotation = wave * 0.025 * (facingLeft ? -1 : 1);
        break;
      case "attack": {
        const lunge = Math.sin(Math.min(1, time * 1.35) * Math.PI);
        offsetX += vector.x * lunge * 11;
        offsetY += vector.y * lunge * 6 - pulse * 1.5;
        rotation = vector.x * lunge * 0.055;
        break;
      }
      case "cast":
        offsetY -= pulse * 4;
        scaleX *= 1 + pulse * 0.035;
        scaleY *= 1 + pulse * 0.035;
        auraAlpha = 0.16 + pulse * 0.3;
        auraScale = 1 + pulse * 1.2;
        break;
      case "hurt":
        offsetX -= vector.x * pulse * 9;
        offsetY -= vector.y * pulse * 5;
        rotation = -vector.x * pulse * 0.09;
        if (time < 0.58) this.image.setTint(0xfff4d6).setTintMode(Phaser.TintModes.FILL);
        break;
      case "death": {
        const collapse = Phaser.Math.Clamp(time, 0, 1);
        offsetX += (facingLeft ? -1 : 1) * collapse * 8;
        offsetY += collapse * 13;
        rotation = (facingLeft ? -1 : 1) * collapse * 0.72;
        scaleY *= Math.max(0.42, 1 - collapse * 0.58);
        alpha = 1 - collapse * 0.18;
        auraAlpha = 0;
        break;
      }
    }

    this.image
      .setFlipX(facingLeft)
      .setPosition(offsetX, offsetY)
      .setScale(scaleX, scaleY)
      .setRotation(rotation)
      .setAlpha(alpha);
    this.aura
      .setFillStyle(this.palette.highlight, auraAlpha)
      .setScale(auraScale)
      .setPosition(vector.x * 2, -7 + vector.y * 2);
    const collapse = snapshot.action === "death" ? snapshot.normalizedTime : 0;
    this.shadow
      .setScale(1 + collapse * 0.25, Math.max(0.32, 1 - collapse * 0.5))
      .setAlpha(0.38 * (1 - collapse * 0.55));
  }
}

export function illustratedUnitTextureKey(id: IllustratedUnitId): string {
  return ILLUSTRATED_UNIT_TEXTURE_KEYS[id];
}

export function hasIllustratedUnitTexture(scene: Phaser.Scene, artId: CombatArtId): boolean {
  const unitId = ART_TO_UNIT[artId];
  return unitId !== undefined && scene.textures.exists(illustratedUnitTextureKey(unitId));
}

/**
 * Drop-in factory for `createProceduralCombatActor` call sites.
 * Monsters stay procedural until their dedicated art pass. Player-unit artwork
 * is mandatory: missing textures are a release error and never fall back.
 */
export function createIllustratedCombatActor(
  scene: Phaser.Scene,
  options: IllustratedCombatActorOptions,
): IllustratedCombatActor | ProceduralCombatActor {
  const unitId = ART_TO_UNIT[options.id];
  if (!unitId) return createProceduralCombatActor(scene, options);
  const textureKey = illustratedUnitTextureKey(unitId);
  if (!scene.textures.exists(textureKey)) {
    throw new Error(`Required illustrated unit texture is missing: ${textureKey}`);
  }
  return new IllustratedCombatActor(scene, options, textureKey);
}
