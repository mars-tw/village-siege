import { FACING_ORDER, type CombatAction, type CombatArtId, type Facing } from "./directionalAnimation";
import {
  createSixRowManifest,
  type FrameAnimatedCombatActorManifest,
  type FrameAnimatedCombatActorManifestTable,
} from "./sixRowAnimationManifest";
import { publicAssetUrl } from "./publicAssetUrl";

export const ANIMATED_UNIT_IDS = [
  "warrior",
  "shieldBearer",
  "archer",
  "mage",
  "musketeer",
  "boarRider",
  "heavyCrossbowman",
] as const;

export type AnimatedUnitId = (typeof ANIMATED_UNIT_IDS)[number];

export const ANIMATED_MONSTER_IDS = ["miremaw", "ashwing", "rootback"] as const;
export type AnimatedMonsterId = (typeof ANIMATED_MONSTER_IDS)[number];

export interface UnitFrameAsset {
  readonly unitId: AnimatedUnitId;
  readonly artId: CombatArtId;
  readonly textureKey: string;
  readonly path: string;
  readonly directionalPaths?: Readonly<Record<Facing, string>>;
  readonly manifest: FrameAnimatedCombatActorManifest;
}

export interface MonsterFrameAsset {
  readonly monsterId: AnimatedMonsterId;
  readonly artId: CombatArtId;
  readonly textureKey: string;
  readonly path: string;
  readonly directionalPaths?: Readonly<Record<Facing, string>>;
  readonly manifest: FrameAnimatedCombatActorManifest;
}

const ART_IDS: Readonly<Record<AnimatedUnitId, CombatArtId>> = {
  warrior: "warrior",
  shieldBearer: "shieldbearer",
  archer: "archer",
  mage: "mage",
  musketeer: "musketeer",
  boarRider: "boar_rider",
  heavyCrossbowman: "heavy_crossbow",
};

const ACTION_FPS: Readonly<Record<AnimatedUnitId, Readonly<Record<CombatAction, number>>>> = {
  warrior: { idle: 5, walk: 9, attack: 10, cast: 10, hurt: 9, death: 7 },
  shieldBearer: { idle: 5, walk: 8, attack: 9, cast: 9, hurt: 8, death: 7 },
  archer: { idle: 5, walk: 9, attack: 10, cast: 10, hurt: 9, death: 7 },
  mage: { idle: 5, walk: 8, attack: 9, cast: 10, hurt: 8, death: 7 },
  musketeer: { idle: 5, walk: 8, attack: 9, cast: 9, hurt: 8, death: 7 },
  boarRider: { idle: 5, walk: 10, attack: 10, cast: 11, hurt: 8, death: 6 },
  heavyCrossbowman: { idle: 5, walk: 8, attack: 9, cast: 9, hurt: 8, death: 7 },
};

function createAsset(unitId: AnimatedUnitId): UnitFrameAsset {
  const artId = ART_IDS[unitId];
  const directionalTextureKeys = unitId === "warrior"
    ? Object.fromEntries(FACING_ORDER.map((facing) => [facing, `unit-action-sheet-${artId}-${facing}`])) as Record<Facing, string>
    : undefined;
  const directionalPaths = unitId === "warrior"
    ? Object.fromEntries(FACING_ORDER.map((facing) => [
      facing,
      publicAssetUrl(`assets/original/units/${unitId}/sprites/facings/${facing}.png`),
    ])) as Record<Facing, string>
    : undefined;
  const textureKey = directionalTextureKeys?.se ?? `unit-action-sheet-${artId}`;
  const path = directionalPaths?.se ?? publicAssetUrl(`assets/original/units/${unitId}/sprites/action-sheet.png`);
  const frames: Readonly<Record<CombatAction, number>> = {
    idle: 4,
    walk: 4,
    attack: 4,
    cast: 4,
    hurt: 4,
    death: 4,
  };
  return {
    unitId,
    artId,
    textureKey,
    path,
    manifest: createSixRowManifest({
      id: artId,
      textureKey,
      directionalTextureKeys,
      frameWidth: unitId === "warrior" ? 96 : 256,
      frameHeight: unitId === "warrior" ? 112 : 256,
      anchorX: unitId === "warrior" ? 48 : 128,
      anchorY: unitId === "warrior" ? 88 : 224,
      artScale: unitId === "warrior" ? 1 : artId === "boar_rider" ? 0.55 : 0.5,
      authoredFacing: "right",
      frameNamePrefix: `unit-action-frame-${artId}`,
    }, frames, ACTION_FPS[unitId]),
    directionalPaths,
  };
}

export const ANIMATED_UNIT_FRAME_ASSETS: readonly UnitFrameAsset[] = ANIMATED_UNIT_IDS.map(createAsset);

function createMonsterAsset(monsterId: AnimatedMonsterId): MonsterFrameAsset {
  const textureKey = `monster-action-sheet-${monsterId}`;
  const fps: Readonly<Record<CombatAction, number>> = {
    idle: 5,
    walk: monsterId === "ashwing" ? 10 : 8,
    attack: 10,
    cast: 10,
    hurt: 8,
    death: 6,
  };
  const frames: Readonly<Record<CombatAction, number>> = {
    idle: 4,
    walk: 4,
    attack: 4,
    cast: 4,
    hurt: 4,
    death: 4,
  };
  return {
    monsterId,
    artId: monsterId,
    textureKey,
    path: publicAssetUrl(`assets/original/monsters/${monsterId}/sprites/action-sheet.png`),
    manifest: createSixRowManifest({
      id: monsterId,
      textureKey,
      frameWidth: 256,
      frameHeight: 256,
      anchorX: 128,
      anchorY: 224,
      artScale: monsterId === "rootback" ? 0.55 : 0.52,
      authoredFacing: "right",
      frameNamePrefix: `monster-action-frame-${monsterId}`,
    }, frames, fps),
  };
}

export const ANIMATED_MONSTER_FRAME_ASSETS: readonly MonsterFrameAsset[] = ANIMATED_MONSTER_IDS.map(createMonsterAsset);

export const COMBAT_ANIMATION_MANIFEST: FrameAnimatedCombatActorManifestTable = Object.fromEntries(
  [...ANIMATED_UNIT_FRAME_ASSETS, ...ANIMATED_MONSTER_FRAME_ASSETS].map((asset) => [asset.artId, asset.manifest]),
) as FrameAnimatedCombatActorManifestTable;

export interface FrameAssetFile {
  readonly textureKey: string;
  readonly path: string;
}

export function frameAssetFiles(asset: UnitFrameAsset | MonsterFrameAsset): readonly FrameAssetFile[] {
  if (!asset.directionalPaths || !asset.manifest.directionalTextureKeys) {
    return [{ textureKey: asset.textureKey, path: asset.path }];
  }
  return FACING_ORDER.map((facing) => ({
    textureKey: asset.manifest.directionalTextureKeys![facing],
    path: asset.directionalPaths![facing],
  }));
}

export function getUnitFrameAsset(unitId: string): UnitFrameAsset | undefined {
  return ANIMATED_UNIT_FRAME_ASSETS.find((asset) => asset.unitId === unitId);
}

export function validateCombatAnimationManifest(): readonly string[] {
  const issues: string[] = [];
  const unitIds = new Set<string>();
  const artIds = new Set<CombatArtId>();
  const textureKeys = new Set<string>();
  for (const asset of ANIMATED_UNIT_FRAME_ASSETS) {
    if (unitIds.has(asset.unitId)) issues.push(`duplicate unit animation id: ${asset.unitId}`);
    if (artIds.has(asset.artId)) issues.push(`duplicate art animation id: ${asset.artId}`);
    unitIds.add(asset.unitId);
    artIds.add(asset.artId);
    if (Boolean(asset.directionalPaths) !== Boolean(asset.manifest.directionalTextureKeys)) {
      issues.push(`${asset.unitId} directional paths and texture keys must be declared together`);
    }
    const files = frameAssetFiles(asset);
    if (asset.directionalPaths && asset.manifest.directionalTextureKeys) {
      const pathFacings = Object.keys(asset.directionalPaths);
      const textureFacings = Object.keys(asset.manifest.directionalTextureKeys);
      if (pathFacings.length !== FACING_ORDER.length || FACING_ORDER.some((facing) => !pathFacings.includes(facing))) {
        issues.push(`${asset.unitId} directional paths must cover every facing`);
      }
      if (textureFacings.length !== FACING_ORDER.length || FACING_ORDER.some((facing) => !textureFacings.includes(facing))) {
        issues.push(`${asset.unitId} directional texture keys must cover every facing`);
      }
      if (new Set(Object.values(asset.directionalPaths)).size !== FACING_ORDER.length) {
        issues.push(`${asset.unitId} directional paths must be unique`);
      }
      if (new Set(Object.values(asset.manifest.directionalTextureKeys)).size !== FACING_ORDER.length) {
        issues.push(`${asset.unitId} directional texture keys must be unique`);
      }
      if (files.length !== FACING_ORDER.length) issues.push(`${asset.unitId} must expose six directional action sheets`);
    } else if (files.length !== 1) {
      issues.push(`${asset.unitId} non-directional animation must expose exactly one action sheet`);
    }
    for (const file of files) {
      if (!file.textureKey) {
        issues.push(`${asset.unitId} has an empty animation texture key`);
      } else if (textureKeys.has(file.textureKey)) {
        issues.push(`duplicate animation texture key: ${file.textureKey}`);
      } else {
        textureKeys.add(file.textureKey);
      }
      if (!file.path?.endsWith(".png")) issues.push(`invalid directional action-sheet path: ${file.path || "<empty>"}`);
    }
    if (!asset.directionalPaths && !asset.path.endsWith("/sprites/action-sheet.png")) issues.push(`invalid action-sheet path: ${asset.path}`);
    for (const action of ["idle", "walk", "attack", "cast", "hurt", "death"] as const) {
      const row = asset.manifest.actions[action];
      if (row.frames < 4) issues.push(`${asset.unitId}.${action} has fewer than four frames`);
    }
  }
  if (unitIds.size !== ANIMATED_UNIT_IDS.length) issues.push("not every combat unit has an animation sheet");
  for (const asset of ANIMATED_MONSTER_FRAME_ASSETS) {
    if (artIds.has(asset.artId)) issues.push(`duplicate monster animation id: ${asset.artId}`);
    artIds.add(asset.artId);
    if (Boolean(asset.directionalPaths) !== Boolean(asset.manifest.directionalTextureKeys)) {
      issues.push(`${asset.monsterId} directional paths and texture keys must be declared together`);
    }
    const files = frameAssetFiles(asset);
    if (asset.directionalPaths && asset.manifest.directionalTextureKeys) {
      const pathFacings = Object.keys(asset.directionalPaths);
      const textureFacings = Object.keys(asset.manifest.directionalTextureKeys);
      if (pathFacings.length !== FACING_ORDER.length || FACING_ORDER.some((facing) => !pathFacings.includes(facing))) {
        issues.push(`${asset.monsterId} directional paths must cover every facing`);
      }
      if (textureFacings.length !== FACING_ORDER.length || FACING_ORDER.some((facing) => !textureFacings.includes(facing))) {
        issues.push(`${asset.monsterId} directional texture keys must cover every facing`);
      }
      if (new Set(Object.values(asset.directionalPaths)).size !== FACING_ORDER.length) {
        issues.push(`${asset.monsterId} directional paths must be unique`);
      }
      if (new Set(Object.values(asset.manifest.directionalTextureKeys)).size !== FACING_ORDER.length) {
        issues.push(`${asset.monsterId} directional texture keys must be unique`);
      }
      if (files.length !== FACING_ORDER.length) issues.push(`${asset.monsterId} must expose six directional action sheets`);
    } else if (files.length !== 1) {
      issues.push(`${asset.monsterId} non-directional animation must expose exactly one action sheet`);
    }
    for (const file of files) {
      if (!file.textureKey) {
        issues.push(`${asset.monsterId} has an empty animation texture key`);
      } else if (textureKeys.has(file.textureKey)) {
        issues.push(`duplicate monster texture key: ${file.textureKey}`);
      } else {
        textureKeys.add(file.textureKey);
      }
      if (!file.path?.endsWith(".png")) issues.push(`invalid monster directional action-sheet path: ${file.path || "<empty>"}`);
    }
    if (!asset.directionalPaths && !asset.path.endsWith("/sprites/action-sheet.png")) issues.push(`invalid monster action-sheet path: ${asset.path}`);
    for (const action of ["idle", "walk", "attack", "cast", "hurt", "death"] as const) {
      if (asset.manifest.actions[action].frames < 4) issues.push(`${asset.monsterId}.${action} has fewer than four frames`);
    }
  }
  if (ANIMATED_MONSTER_FRAME_ASSETS.length !== ANIMATED_MONSTER_IDS.length) issues.push("not every monster has an animation sheet");
  return issues;
}

export function assertCombatAnimationManifestValid(): void {
  const issues = validateCombatAnimationManifest();
  if (issues.length > 0) throw new Error(`Combat animation manifest invalid: ${issues.join("; ")}`);
}
