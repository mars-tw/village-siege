import { FACING_ORDER, type CombatAction, type Facing } from "./directionalAnimation";
import { publicAssetUrl } from "./publicAssetUrl";
import { createSixRowManifest } from "./sixRowAnimationManifest";

const FOUR_FRAMES = { idle: 4, walk: 4, attack: 4, hurt: 4, death: 4, cast: 4 } as const;
const directionalTextureKeys = Object.fromEntries(FACING_ORDER.map(facing => [facing, `unit-action-sheet-villager-frontier-${facing}`])) as Record<Facing, string>;
const directionalPaths = Object.fromEntries(FACING_ORDER.map(facing => [facing, publicAssetUrl(`assets/original/frontier/characters/villager/facings/${facing}.png`)])) as Record<Facing, string>;
const base = createSixRowManifest({
  id: "villager",
  textureKey: directionalTextureKeys.se,
  directionalTextureKeys,
  frameWidth: 96,
  frameHeight: 112,
  anchorX: 48,
  anchorY: 88,
  artScale: 1,
  authoredFacing: "right",
  mirrorFacings: false,
  shadowWidth: 30,
  shadowHeight: 10,
  teamPennant: true,
  frameNamePrefix: "frontier-villager-frame",
}, FOUR_FRAMES, { idle: 5, walk: 8, attack: 8, hurt: 9, death: 6, cast: 8 });

/** Real work and craft rows loop while their authoritative order stays active. */
export const VILLAGE_WORKER_ANIMATION_MANIFEST = {
  ...base,
  actions: {
    ...base.actions,
    attack: { ...base.actions.attack, loop: true },
    cast: { ...base.actions.cast, loop: true },
  },
};

/** Six independently generated native perspectives; no mirrored source sheets. */
export const VILLAGE_WORKER_FRAME_ASSET = {
  unitId: "villager" as const,
  artId: "villager" as const,
  textureKey: VILLAGE_WORKER_ANIMATION_MANIFEST.textureKey,
  path: directionalPaths.se,
  directionalPaths,
  manifest: VILLAGE_WORKER_ANIMATION_MANIFEST,
  authoredPerspectives: 6,
  framesPerAction: FOUR_FRAMES satisfies Readonly<Record<CombatAction, number>>,
};
