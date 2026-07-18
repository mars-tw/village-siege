import Phaser from "phaser";
import {
  DEFAULT_TEAM_PALETTES,
  type ProceduralCombatActorOptions,
  type TeamPalette,
} from "./combatArt";
import {
  ANCHOR_CONTRACT,
  DirectionalAnimationController,
  type AnimationFrameEvent,
  type CombatAction,
  type DirectionalAnimationSnapshot,
  type Facing,
} from "./directionalAnimation";

export const ILLUSTRATED_MONSTER_IDS = ["miremaw", "ashwing", "rootback"] as const;
export type IllustratedMonsterId = (typeof ILLUSTRATED_MONSTER_IDS)[number];

export const ILLUSTRATED_MONSTER_TEXTURE_KEYS: Readonly<Record<IllustratedMonsterId, string>> = {
  miremaw: "monster-art-miremaw",
  ashwing: "monster-art-ashwing",
  rootback: "monster-art-rootback",
};

export type IllustratedMonsterActorOptions = Omit<ProceduralCombatActorOptions, "id"> & {
  readonly id: IllustratedMonsterId;
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

interface MonsterPose {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly alpha: number;
  readonly auraAlpha: number;
  readonly auraScaleX: number;
  readonly auraScaleY: number;
  readonly flash: boolean;
}

/** A CombatShowcase-compatible view backed by one transparent monster master PNG. */
export class IllustratedMonsterActor {
  readonly container: Phaser.GameObjects.Container;
  readonly animation: DirectionalAnimationController;
  private readonly image: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly aura: Phaser.GameObjects.Ellipse;
  private readonly artScale: number;
  private palette: TeamPalette;
  private renderSignature = "";

  constructor(scene: Phaser.Scene, options: IllustratedMonsterActorOptions, textureKey: string) {
    const contract = ANCHOR_CONTRACT[options.id];
    this.palette = options.teamPalette ?? DEFAULT_TEAM_PALETTES.neutral;
    this.animation = new DirectionalAnimationController(options.id, options.action, options.facing);
    this.shadow = scene.add.ellipse(0, 3, contract.shadowWidth * 1.18, contract.shadowHeight * 1.08, 0x101b18, 0.45);
    this.aura = scene.add.ellipse(0, -5, contract.shadowWidth * 1.2, contract.shadowHeight, this.palette.highlight, 0.08);
    this.image = scene.add.image(0, 3, textureKey).setOrigin(0.5, 1);

    const targetWidth = contract.frameWidth * monsterWidthMultiplier(options.id);
    const targetHeight = contract.frameHeight * monsterHeightMultiplier(options.id);
    this.artScale = Math.min(targetWidth / Math.max(1, this.image.width), targetHeight / Math.max(1, this.image.height));
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
    const pose = sampleMonsterPose(snapshot);
    const facingLeft = LEFT_FACINGS.has(snapshot.facing);

    this.image.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    if (pose.flash) this.image.setTint(0xfff1d4).setTintMode(Phaser.TintModes.FILL);
    this.image
      .setFlipX(facingLeft)
      .setPosition(pose.offsetX, pose.offsetY)
      .setScale(this.artScale * pose.scaleX, this.artScale * pose.scaleY)
      .setRotation(pose.rotation)
      .setAlpha(pose.alpha);
    this.aura
      .setFillStyle(this.palette.highlight, pose.auraAlpha)
      .setScale(pose.auraScaleX, pose.auraScaleY);
    const collapse = snapshot.action === "death" ? snapshot.normalizedTime : 0;
    this.shadow
      .setScale(1 + collapse * 0.36, Math.max(0.28, 1 - collapse * 0.58))
      .setAlpha(0.45 * (1 - collapse * 0.68));
  }
}

export function illustratedMonsterTextureKey(id: IllustratedMonsterId): string {
  return ILLUSTRATED_MONSTER_TEXTURE_KEYS[id];
}

export function isIllustratedMonsterId(value: string): value is IllustratedMonsterId {
  return ILLUSTRATED_MONSTER_IDS.includes(value as IllustratedMonsterId);
}

/**
 * Strict factory: monster artwork is a release requirement, so a missing texture
 * is reported immediately instead of silently substituting procedural artwork.
 */
export function createIllustratedMonsterActor(
  scene: Phaser.Scene,
  options: ProceduralCombatActorOptions,
): IllustratedMonsterActor {
  if (!isIllustratedMonsterId(options.id)) {
    throw new RangeError(`createIllustratedMonsterActor only accepts miremaw, ashwing, or rootback; received ${options.id}`);
  }
  const textureKey = illustratedMonsterTextureKey(options.id);
  if (!scene.textures.exists(textureKey)) {
    throw new Error(`Missing required illustrated monster texture: ${textureKey}`);
  }
  return new IllustratedMonsterActor(scene, { ...options, id: options.id }, textureKey);
}

function sampleMonsterPose(snapshot: DirectionalAnimationSnapshot): MonsterPose {
  const time = snapshot.normalizedTime;
  const wave = Math.sin(time * Math.PI * 2);
  const pulse = Math.sin(time * Math.PI);
  const vector = FACING_VECTOR[snapshot.facing];
  const facingLeft = LEFT_FACINGS.has(snapshot.facing);
  const base: MonsterPose = {
    offsetX: 0,
    offsetY: 3,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    auraAlpha: 0.08,
    auraScaleX: 1,
    auraScaleY: 1,
    flash: false,
  };

  switch (snapshot.id) {
    case "miremaw":
      return miremawPose(base, snapshot.action, wave, pulse, vector, time, facingLeft);
    case "ashwing":
      return ashwingPose(base, snapshot.action, wave, pulse, vector, time, facingLeft);
    case "rootback":
      return rootbackPose(base, snapshot.action, wave, pulse, vector, time, facingLeft);
    default:
      return base;
  }
}

function miremawPose(
  base: MonsterPose,
  action: CombatAction,
  wave: number,
  pulse: number,
  vector: { readonly x: number; readonly y: number },
  time: number,
  facingLeft: boolean,
): MonsterPose {
  switch (action) {
    case "idle":
      return { ...base, offsetY: 4 - Math.max(0, wave) * 1.4, scaleX: 1 + wave * 0.025, scaleY: 1 - wave * 0.02 };
    case "walk":
      return { ...base, offsetX: wave * 2.5, offsetY: 4 - Math.abs(wave) * 2, scaleX: 1 + wave * 0.045, scaleY: 1 - wave * 0.035, rotation: wave * 0.022 };
    case "attack": {
      const snap = Math.sin(Math.min(1, time * 1.5) * Math.PI);
      return { ...base, offsetX: vector.x * snap * 13, offsetY: 4 + vector.y * snap * 7, scaleX: 1 + snap * 0.08, scaleY: 1 - snap * 0.05, rotation: vector.x * snap * 0.06 };
    }
    case "cast":
      return { ...base, offsetY: 7 + pulse * 5, scaleX: 1 + pulse * 0.18, scaleY: 1 - pulse * 0.14, auraAlpha: 0.18 + pulse * 0.28, auraScaleX: 1 + pulse * 1.5, auraScaleY: 0.7 + pulse * 0.5 };
    case "hurt":
      return { ...base, offsetX: -vector.x * pulse * 8, offsetY: 4 - pulse * 3, scaleX: 1 + pulse * 0.1, scaleY: 1 - pulse * 0.08, flash: time < 0.58 };
    case "death":
      return { ...base, offsetX: (facingLeft ? -1 : 1) * time * 7, offsetY: 4 + time * 18, scaleX: 1 + time * 0.22, scaleY: Math.max(0.28, 1 - time * 0.72), rotation: (facingLeft ? -1 : 1) * time * 0.2, alpha: 1 - time * 0.22, auraAlpha: 0 };
  }
}

function ashwingPose(
  base: MonsterPose,
  action: CombatAction,
  wave: number,
  pulse: number,
  vector: { readonly x: number; readonly y: number },
  time: number,
  facingLeft: boolean,
): MonsterPose {
  switch (action) {
    case "idle":
      return { ...base, offsetY: -2 - wave * 3.5, scaleX: 1 + Math.abs(wave) * 0.035, scaleY: 1 - Math.abs(wave) * 0.02, rotation: wave * 0.02 };
    case "walk":
      return { ...base, offsetX: wave * 1.8, offsetY: -3 - Math.abs(wave) * 6, scaleX: 1 + Math.abs(wave) * 0.065, scaleY: 1 - Math.abs(wave) * 0.03, rotation: wave * 0.04 };
    case "attack": {
      const dive = Math.sin(Math.min(1, time * 1.4) * Math.PI);
      return { ...base, offsetX: vector.x * dive * 15, offsetY: -3 + vector.y * dive * 8 + dive * 5, scaleX: 1 - dive * 0.05, scaleY: 1 + dive * 0.08, rotation: vector.x * dive * 0.11 };
    }
    case "cast":
      return { ...base, offsetY: -5 - pulse * 14, scaleX: 1 + pulse * 0.13, scaleY: 1 + pulse * 0.08, rotation: wave * 0.06, auraAlpha: 0.2 + pulse * 0.32, auraScaleX: 1 + pulse * 1.1, auraScaleY: 1 + pulse * 1.8 };
    case "hurt":
      return { ...base, offsetX: -vector.x * pulse * 10, offsetY: -2 + pulse * 5, scaleX: 1 - pulse * 0.08, rotation: -vector.x * pulse * 0.14, flash: time < 0.6 };
    case "death":
      return { ...base, offsetX: (facingLeft ? -1 : 1) * time * 15, offsetY: -2 + time * 29, scaleX: 1 - time * 0.18, scaleY: 1 - time * 0.22, rotation: (facingLeft ? -1 : 1) * time * 1.05, alpha: 1 - time * 0.28, auraAlpha: 0 };
  }
}

function rootbackPose(
  base: MonsterPose,
  action: CombatAction,
  wave: number,
  pulse: number,
  vector: { readonly x: number; readonly y: number },
  time: number,
  facingLeft: boolean,
): MonsterPose {
  switch (action) {
    case "idle":
      return { ...base, offsetY: 4 - Math.max(0, wave) * 0.8, scaleX: 1 + wave * 0.01, scaleY: 1 + wave * 0.018, rotation: wave * 0.008 };
    case "walk":
      return { ...base, offsetX: wave * 2, offsetY: 4 - Math.abs(wave) * 2.4, rotation: wave * 0.035, scaleX: 1 + Math.abs(wave) * 0.018, scaleY: 1 - Math.abs(wave) * 0.014 };
    case "attack": {
      const slam = Math.sin(Math.min(1, time * 1.25) * Math.PI);
      return { ...base, offsetX: vector.x * slam * 7, offsetY: 4 + slam * 7, scaleX: 1 + slam * 0.09, scaleY: 1 - slam * 0.09, rotation: vector.x * slam * 0.035 };
    }
    case "cast":
      return { ...base, offsetY: 4 - pulse * 5, scaleX: 1 + pulse * 0.12, scaleY: 1 + pulse * 0.1, auraAlpha: 0.2 + pulse * 0.38, auraScaleX: 1 + pulse * 2, auraScaleY: 0.8 + pulse * 0.7 };
    case "hurt":
      return { ...base, offsetX: -vector.x * pulse * 5, offsetY: 4 + pulse * 2, rotation: -vector.x * pulse * 0.055, flash: time < 0.55 };
    case "death":
      return { ...base, offsetX: (facingLeft ? -1 : 1) * time * 6, offsetY: 4 + time * 16, scaleX: 1 + time * 0.15, scaleY: Math.max(0.4, 1 - time * 0.6), rotation: (facingLeft ? -1 : 1) * time * 0.58, alpha: 1 - time * 0.2, auraAlpha: 0 };
  }
}

function monsterWidthMultiplier(id: IllustratedMonsterId): number {
  return id === "ashwing" ? 1.2 : id === "rootback" ? 1.12 : 1.05;
}

function monsterHeightMultiplier(id: IllustratedMonsterId): number {
  return id === "ashwing" ? 1.14 : id === "rootback" ? 1.08 : 1.04;
}
