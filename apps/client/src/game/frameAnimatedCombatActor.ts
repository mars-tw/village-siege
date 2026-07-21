import Phaser from "phaser";
import { DEFAULT_TEAM_PALETTES, type ProceduralCombatActorOptions, type TeamPalette } from "./combatArt";
import {
  ANCHOR_CONTRACT,
  type AnimationFrameEvent,
  type CombatAction,
  type CombatArtId,
  type Facing,
  FACING_ORDER,
  resolveFacing,
} from "./directionalAnimation";
import { FRAME_ANIMATED_ACTION_ROWS } from "./sixRowAnimationManifest";
import type {
  FrameAnimatedActionRow,
  FrameAnimatedCombatActorManifest,
  FrameAnimatedCombatActorManifestTable,
} from "./sixRowAnimationManifest";

export { createSixRowManifest, FRAME_ANIMATED_ACTION_ROWS } from "./sixRowAnimationManifest";
export type {
  FrameAnimatedActionRow,
  FrameAnimatedCombatActorManifest,
  FrameAnimatedCombatActorManifestTable,
} from "./sixRowAnimationManifest";

/**
 * Required row order for authored combat sprite sheets. Every action owns a
 * separate row, so changing actions always changes the source artwork.
 */
const LEFT_FACINGS = new Set<Facing>(["w", "nw", "sw"]);

export interface FrameAnimatedCombatSnapshot {
  readonly id: CombatArtId;
  readonly action: CombatAction;
  readonly facing: Facing;
  readonly frame: number;
  readonly normalizedTime: number;
  readonly finished: boolean;
}

export interface FrameAnimatedCombatActorView {
  readonly container: Phaser.GameObjects.Container;
  play(action: CombatAction, restart?: boolean): this;
  faceVector(gridDx: number, gridDy: number): this;
  setFacing(facing: Facing): this;
  setTeamPalette(palette: TeamPalette): this;
  setPosition(x: number, y: number): this;
  update(deltaMs: number): readonly AnimationFrameEvent[];
  destroy(): void;
}

/** Throws when a character table has no manifest for the requested actor. */
export function requireFrameAnimatedManifest(
  table: FrameAnimatedCombatActorManifestTable,
  id: CombatArtId,
): FrameAnimatedCombatActorManifest {
  const manifest = table[id];
  if (!manifest) throw new Error(`Required frame-animation manifest is missing for actor: ${id}`);
  if (manifest.id !== id) {
    throw new Error(`Frame-animation manifest table mismatch: key ${id} contains ${manifest.id}`);
  }
  return manifest;
}

/**
 * Validates both authoring metadata and the currently loaded Phaser texture.
 * This deliberately fails hard: a single portrait is not a sprite sheet and
 * must never silently fall back to pose wobbling.
 */
export function validateFrameAnimatedCombatActorManifest(
  scene: Phaser.Scene,
  manifest: FrameAnimatedCombatActorManifest,
  expectedId: CombatArtId = manifest.id,
): void {
  if (manifest.id !== expectedId) {
    throw new Error(`Frame-animation manifest id mismatch: expected ${expectedId}, received ${manifest.id}`);
  }
  if (!manifest.textureKey || (!manifest.directionalTextureKeys && !scene.textures.exists(manifest.textureKey))) {
    throw new Error(`Required frame-animation texture is missing: ${manifest.textureKey || "<empty texture key>"}`);
  }
  assertPositiveInteger(manifest.frameWidth, "frameWidth", manifest.id);
  assertPositiveInteger(manifest.frameHeight, "frameHeight", manifest.id);
  assertNonNegativeInteger(manifest.sourceIndex ?? 0, "sourceIndex", manifest.id);
  assertNonNegativeInteger(manifest.marginX ?? 0, "marginX", manifest.id);
  assertNonNegativeInteger(manifest.marginY ?? 0, "marginY", manifest.id);
  assertNonNegativeInteger(manifest.spacingX ?? 0, "spacingX", manifest.id);
  assertNonNegativeInteger(manifest.spacingY ?? 0, "spacingY", manifest.id);
  if (manifest.artScale !== undefined && (!Number.isFinite(manifest.artScale) || manifest.artScale <= 0)) {
    throw new Error(`Invalid frame-animation artScale for ${manifest.id}: ${manifest.artScale}`);
  }

  const usedRows = new Set<number>();
  let requiredWidth = 0;
  let requiredHeight = 0;
  for (const action of FRAME_ANIMATED_ACTION_ROWS) {
    const row = manifest.actions[action] as FrameAnimatedActionRow | undefined;
    if (!row) throw new Error(`Frame-animation row is missing for ${manifest.id}.${action}`);
    assertNonNegativeInteger(row.row, `${action}.row`, manifest.id);
    if (usedRows.has(row.row)) {
      throw new Error(`Frame-animation actions must use distinct rows for ${manifest.id}; duplicate row ${row.row}`);
    }
    usedRows.add(row.row);
    if (!Number.isInteger(row.frames) || row.frames < 4) {
      throw new Error(`Frame-animation ${manifest.id}.${action} requires at least 4 frames; received ${row.frames}`);
    }
    if (!Number.isFinite(row.fps) || row.fps <= 0) {
      throw new Error(`Invalid frame-animation fps for ${manifest.id}.${action}: ${row.fps}`);
    }
    for (const event of row.events ?? []) {
      if (!Number.isInteger(event.frame) || event.frame < 0 || event.frame >= row.frames || !event.name) {
        throw new Error(`Invalid frame event for ${manifest.id}.${action}: ${event.name || "<empty>"}@${event.frame}`);
      }
    }
    requiredWidth = Math.max(requiredWidth, cellX(manifest, row.frames - 1) + manifest.frameWidth);
    requiredHeight = Math.max(requiredHeight, cellY(manifest, row.row) + manifest.frameHeight);
  }

  const textureKeys = textureKeysForManifest(manifest);
  if (manifest.directionalTextureKeys && new Set(textureKeys).size !== FACING_ORDER.length) {
    throw new Error(`Directional frame-animation textures must be unique for all six facings: ${manifest.id}`);
  }
  for (const textureKey of textureKeys) {
    if (!textureKey || !scene.textures.exists(textureKey)) {
      throw new Error(`Required frame-animation texture is missing: ${textureKey || "<empty texture key>"}`);
    }
    const texture = scene.textures.get(textureKey);
    const sourceIndex = manifest.sourceIndex ?? 0;
    const source = texture.source[sourceIndex];
    if (!source) {
      throw new Error(`Frame-animation texture ${textureKey} has no source at index ${sourceIndex}`);
    }
    if (requiredWidth > source.width || requiredHeight > source.height) {
      throw new Error(
        `Frame-animation sheet is too small for ${manifest.id}/${textureKey}: requires ${requiredWidth}x${requiredHeight}, ` +
        `loaded ${source.width}x${source.height}`,
      );
    }
  }
}

/** A real frame-by-frame renderer: no procedural bob, squash, or pose tween. */
export class FrameAnimatedCombatActor implements FrameAnimatedCombatActorView {
  readonly container: Phaser.GameObjects.Container;
  private readonly manifest: FrameAnimatedCombatActorManifest;
  private readonly image: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly aura: Phaser.GameObjects.Ellipse;
  private readonly frameNames: Readonly<Record<Facing, Readonly<Record<CombatAction, readonly string[]>>>>;
  private palette: TeamPalette;
  private currentAction: CombatAction;
  private currentFacing: Facing;
  private currentFrame = 0;
  private elapsedInFrameMs = 0;
  private pendingStartEvents = true;
  private animationFinished = false;

  constructor(
    scene: Phaser.Scene,
    options: ProceduralCombatActorOptions,
    manifest: FrameAnimatedCombatActorManifest,
  ) {
    validateFrameAnimatedCombatActorManifest(scene, manifest, options.id);
    this.manifest = manifest;
    this.currentAction = options.action ?? "idle";
    this.currentFacing = options.facing ?? "se";
    this.palette = options.teamPalette ?? DEFAULT_TEAM_PALETTES.neutral;
    this.frameNames = registerSpriteSheetFrames(scene, manifest);

    const contract = ANCHOR_CONTRACT[options.id];
    this.shadow = scene.add.ellipse(0, 2, contract.shadowWidth * 1.2, contract.shadowHeight * 1.15, 0x10241e, 0.38);
    this.aura = scene.add.ellipse(0, -7, contract.shadowWidth * 1.25, contract.shadowHeight * 1.2, this.palette.highlight, 0.08);
    this.image = scene.add.image(
      0,
      0,
      textureKeyForFacing(manifest, this.currentFacing),
      this.frameNames[this.currentFacing][this.currentAction][0],
    );
    this.image
      .setOrigin(
        (manifest.anchorX ?? contract.anchorX) / manifest.frameWidth,
        (manifest.anchorY ?? contract.anchorY) / manifest.frameHeight,
      )
      .setScale(manifest.artScale ?? 1);

    this.container = scene.add.container(options.x, options.y, [this.shadow, this.aura, this.image]);
    this.container.setSize(manifest.frameWidth, manifest.frameHeight);
    this.container.setDepth(options.depth ?? options.y);
    this.container.setScale(options.scale ?? 1);
    this.renderFrame();
    this.renderFacing();
  }

  get snapshot(): FrameAnimatedCombatSnapshot {
    const row = this.manifest.actions[this.currentAction];
    return {
      id: this.manifest.id,
      action: this.currentAction,
      facing: this.currentFacing,
      frame: this.currentFrame,
      normalizedTime: row.frames <= 1 ? 1 : this.currentFrame / (row.frames - 1),
      finished: this.animationFinished,
    };
  }

  play(action: CombatAction, restart = action !== this.currentAction || !this.manifest.actions[action].loop): this {
    if (action !== this.currentAction || restart) {
      this.currentAction = action;
      this.currentFrame = 0;
      this.elapsedInFrameMs = 0;
      this.pendingStartEvents = true;
      this.animationFinished = false;
      this.renderFrame();
    }
    return this;
  }

  setFacing(facing: Facing): this {
    if (facing !== this.currentFacing) {
      this.currentFacing = facing;
      this.renderFacing();
    }
    return this;
  }

  faceVector(gridDx: number, gridDy: number): this {
    return this.setFacing(resolveFacing(gridDx, gridDy, this.currentFacing));
  }

  setTeamPalette(palette: TeamPalette): this {
    this.palette = palette;
    this.aura.setFillStyle(palette.highlight, 0.08);
    return this;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y).setDepth(y);
    return this;
  }

  update(deltaMs: number): readonly AnimationFrameEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return [];
    const row = this.manifest.actions[this.currentAction];
    const emitted: AnimationFrameEvent[] = this.pendingStartEvents
      ? (row.events ?? []).filter((event) => event.frame === 0)
      : [];
    this.pendingStartEvents = false;
    if (this.animationFinished) {
      if (this.currentAction !== "death") this.play("idle", true);
      return emitted;
    }

    const frameDurationMs = 1000 / row.fps;
    const cappedDeltaMs = Math.min(deltaMs, frameDurationMs * row.frames * 2);
    this.elapsedInFrameMs += cappedDeltaMs;
    let changed = false;
    while (this.elapsedInFrameMs >= frameDurationMs) {
      this.elapsedInFrameMs -= frameDurationMs;
      if (this.currentFrame < row.frames - 1) {
        this.currentFrame += 1;
      } else if (row.loop) {
        this.currentFrame = 0;
      } else {
        this.animationFinished = true;
        this.elapsedInFrameMs = 0;
        break;
      }
      changed = true;
      for (const event of row.events ?? []) {
        if (event.frame === this.currentFrame) emitted.push(event);
      }
    }
    if (changed) this.renderFrame();
    return emitted;
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private renderFrame(): void {
    const frameName = this.frameNames[this.currentFacing][this.currentAction][this.currentFrame];
    if (!frameName) {
      throw new Error(`Registered frame is missing for ${this.manifest.id}.${this.currentAction}[${this.currentFrame}]`);
    }
    this.image?.setTexture(textureKeyForFacing(this.manifest, this.currentFacing), frameName);
  }

  private renderFacing(): void {
    if (this.manifest.directionalTextureKeys) {
      this.image.setFlipX(false);
      this.renderFrame();
      return;
    }
    const facingLeft = LEFT_FACINGS.has(this.currentFacing);
    const sourceFacesLeft = this.manifest.authoredFacing === "left";
    this.image.setFlipX(facingLeft !== sourceFacesLeft);
  }
}

export function createFrameAnimatedCombatActor(
  scene: Phaser.Scene,
  options: ProceduralCombatActorOptions,
  manifest: FrameAnimatedCombatActorManifest,
): FrameAnimatedCombatActor {
  return new FrameAnimatedCombatActor(scene, options, manifest);
}

function registerSpriteSheetFrames(
  scene: Phaser.Scene,
  manifest: FrameAnimatedCombatActorManifest,
): Readonly<Record<Facing, Readonly<Record<CombatAction, readonly string[]>>>> {
  if (!manifest.directionalTextureKeys) {
    const shared = registerTextureFrames(scene, manifest, manifest.textureKey);
    return Object.fromEntries(FACING_ORDER.map((facing) => [facing, shared])) as Record<
      Facing,
      Readonly<Record<CombatAction, readonly string[]>>
    >;
  }
  return Object.fromEntries(
    FACING_ORDER.map((facing) => [
      facing,
      registerTextureFrames(scene, manifest, manifest.directionalTextureKeys![facing], facing),
    ]),
  ) as Record<Facing, Readonly<Record<CombatAction, readonly string[]>>>;
}

function registerTextureFrames(
  scene: Phaser.Scene,
  manifest: FrameAnimatedCombatActorManifest,
  textureKey: string,
  facing?: Facing,
): Readonly<Record<CombatAction, readonly string[]>> {
  const texture = scene.textures.get(textureKey);
  const sourceIndex = manifest.sourceIndex ?? 0;
  const prefix = manifest.frameNamePrefix ?? `__frame-animated:${manifest.id}`;
  const registered = {} as Record<CombatAction, readonly string[]>;
  for (const action of FRAME_ANIMATED_ACTION_ROWS) {
    const row = manifest.actions[action];
    const names: string[] = [];
    for (let frameIndex = 0; frameIndex < row.frames; frameIndex += 1) {
      const name = `${prefix}${facing ? `:${facing}` : ""}:${action}:${frameIndex}`;
      const x = cellX(manifest, frameIndex);
      const y = cellY(manifest, row.row);
      if (texture.has(name)) {
        const existing = texture.get(name);
        if (
          existing.sourceIndex !== sourceIndex ||
          existing.cutX !== x ||
          existing.cutY !== y ||
          existing.cutWidth !== manifest.frameWidth ||
          existing.cutHeight !== manifest.frameHeight
        ) {
          throw new Error(`Conflicting registered sprite frame: ${textureKey}/${name}`);
        }
      } else if (!texture.add(name, sourceIndex, x, y, manifest.frameWidth, manifest.frameHeight)) {
        throw new Error(`Failed to register sprite frame: ${textureKey}/${name}`);
      }
      names.push(name);
    }
    registered[action] = names;
  }
  return registered;
}

function textureKeysForManifest(manifest: FrameAnimatedCombatActorManifest): readonly string[] {
  return manifest.directionalTextureKeys
    ? FACING_ORDER.map((facing) => manifest.directionalTextureKeys![facing])
    : [manifest.textureKey];
}

function textureKeyForFacing(manifest: FrameAnimatedCombatActorManifest, facing: Facing): string {
  return manifest.directionalTextureKeys?.[facing] ?? manifest.textureKey;
}

function cellX(manifest: FrameAnimatedCombatActorManifest, column: number): number {
  return (manifest.marginX ?? 0) + column * (manifest.frameWidth + (manifest.spacingX ?? 0));
}

function cellY(manifest: FrameAnimatedCombatActorManifest, row: number): number {
  return (manifest.marginY ?? 0) + row * (manifest.frameHeight + (manifest.spacingY ?? 0));
}

function assertPositiveInteger(value: number, field: string, id: CombatArtId): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid frame-animation ${field} for ${id}: ${value}`);
  }
}

function assertNonNegativeInteger(value: number, field: string, id: CombatArtId): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid frame-animation ${field} for ${id}: ${value}`);
  }
}
