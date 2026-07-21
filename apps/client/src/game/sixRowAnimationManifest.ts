import type { AnimationFrameEvent, CombatAction, CombatArtId, Facing } from "./directionalAnimation";

export interface FrameAnimatedActionRow {
  /** Zero-based sprite-sheet row. Rows must be unique between actions. */
  readonly row: number;
  /** Number of consecutive authored frames in this row. Minimum: four. */
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly events?: readonly AnimationFrameEvent[];
}

export interface FrameAnimatedCombatActorManifest {
  readonly id: CombatArtId;
  readonly textureKey: string;
  /** Six independently authored source sheets. When present, mirroring is disabled. */
  readonly directionalTextureKeys?: Readonly<Record<Facing, string>>;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sourceIndex?: number;
  readonly marginX?: number;
  readonly marginY?: number;
  readonly spacingX?: number;
  readonly spacingY?: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
  /** Scale applied to the authored cells before the actor-level scale. */
  readonly artScale?: number;
  /** Which horizontal direction the source artwork faces. Defaults to right. */
  readonly authoredFacing?: "left" | "right";
  /** Optional stable namespace when multiple layouts share one texture key. */
  readonly frameNamePrefix?: string;
  readonly actions: Readonly<Record<CombatAction, FrameAnimatedActionRow>>;
}

export type FrameAnimatedCombatActorManifestTable = Readonly<Partial<Record<CombatArtId, FrameAnimatedCombatActorManifest>>>;

export const FRAME_ANIMATED_ACTION_ROWS = ["idle", "walk", "attack", "hurt", "death", "cast"] as const satisfies readonly CombatAction[];

const LOOPING_ACTIONS = new Set<CombatAction>(["idle", "walk"]);

/**
 * Pure manifest builder kept separate from Phaser so asset contracts can be
 * validated in Node-based tests and release tooling.
 */
export function createSixRowManifest(
  base: Omit<FrameAnimatedCombatActorManifest, "actions">,
  framesPerRow: Readonly<Record<CombatAction, number>>,
  fps: Readonly<Partial<Record<CombatAction, number>>> = {},
  events: Readonly<Partial<Record<CombatAction, readonly AnimationFrameEvent[]>>> = {},
): FrameAnimatedCombatActorManifest {
  const defaultFps: Readonly<Record<CombatAction, number>> = {
    idle: 6,
    walk: 10,
    attack: 12,
    cast: 12,
    hurt: 12,
    death: 9,
  };
  const actions = {} as Record<CombatAction, FrameAnimatedActionRow>;
  FRAME_ANIMATED_ACTION_ROWS.forEach((action, row) => {
    actions[action] = {
      row,
      frames: framesPerRow[action],
      fps: fps[action] ?? defaultFps[action],
      loop: LOOPING_ACTIONS.has(action),
      events: events[action],
    };
  });
  return { ...base, actions };
}
