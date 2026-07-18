export const COMBAT_ART_IDS = [
  "mage",
  "archer",
  "musketeer",
  "warrior",
  "shieldbearer",
  "boar_rider",
  "heavy_crossbow",
  "miremaw",
  "ashwing",
  "rootback"
] as const;

export type CombatArtId = (typeof COMBAT_ART_IDS)[number];

export const FACING_ORDER = ["e", "ne", "nw", "w", "sw", "se"] as const;
export type Facing = (typeof FACING_ORDER)[number];

export const COMBAT_ACTIONS = ["idle", "walk", "attack", "hurt", "death", "cast"] as const;
export type CombatAction = (typeof COMBAT_ACTIONS)[number];

export interface AnimationFrameEvent {
  readonly frame: number;
  readonly name: string;
}

export interface AnimationClipContract {
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly events: readonly AnimationFrameEvent[];
}

export interface ArtAnchorContract {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly shadowWidth: number;
  readonly shadowHeight: number;
}

const clip = (
  frames: number,
  fps: number,
  loop: boolean,
  events: readonly [frame: number, name: string][] = []
): AnimationClipContract => ({
  frames,
  fps,
  loop,
  events: events.map(([frame, name]) => ({ frame, name }))
});

export const ANCHOR_CONTRACT: Readonly<Record<CombatArtId, ArtAnchorContract>> = {
  mage: { frameWidth: 96, frameHeight: 112, anchorX: 48, anchorY: 88, shadowWidth: 28, shadowHeight: 11 },
  archer: { frameWidth: 96, frameHeight: 112, anchorX: 48, anchorY: 88, shadowWidth: 29, shadowHeight: 11 },
  musketeer: { frameWidth: 112, frameHeight: 112, anchorX: 56, anchorY: 88, shadowWidth: 34, shadowHeight: 12 },
  warrior: { frameWidth: 96, frameHeight: 112, anchorX: 48, anchorY: 88, shadowWidth: 31, shadowHeight: 12 },
  shieldbearer: { frameWidth: 112, frameHeight: 112, anchorX: 56, anchorY: 88, shadowWidth: 38, shadowHeight: 14 },
  boar_rider: { frameWidth: 144, frameHeight: 128, anchorX: 72, anchorY: 101, shadowWidth: 58, shadowHeight: 20 },
  heavy_crossbow: { frameWidth: 112, frameHeight: 112, anchorX: 56, anchorY: 88, shadowWidth: 39, shadowHeight: 14 },
  miremaw: { frameWidth: 128, frameHeight: 128, anchorX: 64, anchorY: 101, shadowWidth: 50, shadowHeight: 18 },
  ashwing: { frameWidth: 144, frameHeight: 144, anchorX: 72, anchorY: 116, shadowWidth: 56, shadowHeight: 20 },
  rootback: { frameWidth: 160, frameHeight: 144, anchorX: 80, anchorY: 116, shadowWidth: 78, shadowHeight: 27 }
};

export const DIRECTIONAL_ANIMATION_CONTRACT: Readonly<Record<CombatArtId, Readonly<Record<CombatAction, AnimationClipContract>>>> = {
  mage: {
    idle: clip(8, 6, true, [[2, "emberPulse"], [6, "emberPulse"]]),
    walk: clip(8, 10, true, [[1, "footL"], [5, "footR"]]),
    attack: clip(10, 12, false, [[2, "telegraph"], [6, "projectile"], [8, "recover"]]),
    hurt: clip(4, 12, false, [[0, "flinch"]]),
    death: clip(12, 10, false, [[4, "dropStaff"], [8, "collisionOff"]]),
    cast: clip(12, 12, false, [[2, "telegraph"], [7, "aoeCommit"], [10, "recover"]])
  },
  archer: {
    idle: clip(8, 6, true, [[5, "scan"]]),
    walk: clip(8, 11, true, [[1, "footL"], [5, "footR"]]),
    attack: clip(10, 14, false, [[2, "nock"], [6, "projectile"], [9, "recover"]]),
    hurt: clip(4, 13, false, [[0, "flinch"]]),
    death: clip(12, 10, false, [[5, "dropBow"], [8, "collisionOff"]]),
    cast: clip(10, 12, false, [[2, "skillNock"], [6, "projectile"], [9, "recover"]])
  },
  musketeer: {
    idle: clip(8, 6, true, [[5, "checkMatch"]]),
    walk: clip(8, 9, true, [[1, "footL"], [5, "footR"]]),
    attack: clip(14, 12, false, [[3, "brace"], [6, "muzzle"], [6, "projectile"], [9, "reloadOpen"], [12, "reloadClose"]]),
    hurt: clip(4, 12, false, [[0, "flinch"]]),
    death: clip(12, 9, false, [[4, "dropMusket"], [8, "collisionOff"]]),
    cast: clip(12, 11, false, [[2, "forkOpen"], [6, "muzzle"], [6, "pierceLine"], [11, "recover"]])
  },
  warrior: {
    idle: clip(8, 7, true, [[4, "weightShift"]]),
    walk: clip(8, 12, true, [[1, "footL"], [5, "footR"]]),
    attack: clip(9, 15, false, [[2, "windup"], [5, "meleeHit"], [8, "recover"]]),
    hurt: clip(4, 14, false, [[0, "flinch"]]),
    death: clip(12, 11, false, [[6, "dropBlade"], [8, "collisionOff"]]),
    cast: clip(10, 14, false, [[2, "backStep"], [6, "cleaveHit"], [9, "recover"]])
  },
  shieldbearer: {
    idle: clip(8, 6, true, [[4, "shieldSettle"]]),
    walk: clip(8, 9, true, [[1, "footL"], [5, "footR"]]),
    attack: clip(10, 12, false, [[2, "jabWindup"], [6, "meleeHit"], [9, "recover"]]),
    hurt: clip(4, 11, false, [[0, "shieldImpact"]]),
    death: clip(12, 9, false, [[5, "shieldFall"], [9, "collisionOff"]]),
    cast: clip(10, 10, false, [[2, "braceStart"], [6, "guardActive"], [7, "wedgeSet"]])
  },
  boar_rider: {
    idle: clip(8, 6, true, [[3, "snort"], [6, "hoofScrape"]]),
    walk: clip(10, 12, true, [[1, "frontHoof"], [6, "rearHoof"]]),
    attack: clip(12, 14, false, [[2, "lowerTusk"], [7, "meleeHit"], [11, "recover"]]),
    hurt: clip(4, 12, false, [[0, "rear"]]),
    death: clip(14, 9, false, [[5, "riderSeparate"], [10, "collisionOff"]]),
    cast: clip(12, 13, false, [[1, "scrape1"], [4, "scrape2"], [7, "chargeActive"], [7, "dustBurst"]])
  },
  heavy_crossbow: {
    idle: clip(8, 6, true, [[5, "winchCheck"]]),
    walk: clip(8, 8, true, [[1, "footL"], [5, "footR"]]),
    attack: clip(14, 11, false, [[2, "standOpen"], [5, "draw"], [8, "projectile"], [9, "recoil"], [13, "standClose"]]),
    hurt: clip(4, 11, false, [[0, "flinch"]]),
    death: clip(12, 9, false, [[4, "crossbowDrop"], [8, "collisionOff"]]),
    cast: clip(12, 10, false, [[3, "stakeLoad"], [7, "projectile"], [8, "pinCue"], [11, "recover"]])
  },
  miremaw: {
    idle: clip(8, 6, true, [[4, "reedPulse"]]),
    walk: clip(10, 12, true, [[1, "foreFeet"], [6, "rearFeet"]]),
    attack: clip(10, 14, false, [[3, "jawOpen"], [6, "meleeHit"], [9, "recover"]]),
    hurt: clip(4, 12, false, [[0, "flinch"]]),
    death: clip(12, 9, false, [[9, "collisionOff"]]),
    cast: clip(12, 10, false, [[4, "submerge"], [8, "emergeHit"]])
  },
  ashwing: {
    idle: clip(8, 7, true, [[4, "wingRustle"]]),
    walk: clip(8, 13, true, [[1, "foreFeet"], [5, "rearFeet"]]),
    attack: clip(10, 15, false, [[3, "beakOpen"], [6, "meleeHit"]]),
    hurt: clip(4, 13, false, [[0, "flinch"]]),
    death: clip(10, 10, false, [[7, "collisionOff"]]),
    cast: clip(10, 12, false, [[3, "takeoff"], [7, "diveHit"]])
  },
  rootback: {
    idle: clip(8, 5, true, [[4, "bellSway"]]),
    walk: clip(10, 8, true, [[1, "shortFoot"], [6, "longFoot"]]),
    attack: clip(12, 11, false, [[4, "brace"], [8, "meleeHit"]]),
    hurt: clip(4, 10, false, [[0, "crackFlash"]]),
    death: clip(14, 8, false, [[11, "collisionOff"]]),
    cast: clip(14, 9, false, [[4, "telegraph"], [10, "slamHit"]])
  }
};

interface FacingGuide {
  readonly facing: Facing;
  readonly x: number;
  readonly y: number;
}

const GUIDE_LENGTH = Math.hypot(48, 24);
const FACING_GUIDES: readonly FacingGuide[] = [
  { facing: "e", x: 1, y: 0 },
  { facing: "ne", x: 48 / GUIDE_LENGTH, y: -24 / GUIDE_LENGTH },
  { facing: "nw", x: -48 / GUIDE_LENGTH, y: -24 / GUIDE_LENGTH },
  { facing: "w", x: -1, y: 0 },
  { facing: "sw", x: -48 / GUIDE_LENGTH, y: 24 / GUIDE_LENGTH },
  { facing: "se", x: 48 / GUIDE_LENGTH, y: 24 / GUIDE_LENGTH }
];

export function resolveFacing(gridDx: number, gridDy: number, previous: Facing = "se", hysteresisDegrees = 8): Facing {
  const screenX = (gridDx - gridDy) * 48;
  const screenY = (gridDx + gridDy) * 24;
  const length = Math.hypot(screenX, screenY);
  if (length < 0.0001) return previous;

  const x = screenX / length;
  const y = screenY / length;
  let best = FACING_GUIDES[0]!;
  let bestScore = x * best.x + y * best.y;
  for (let index = 1; index < FACING_GUIDES.length; index += 1) {
    const guide = FACING_GUIDES[index]!;
    const score = x * guide.x + y * guide.y;
    if (score > bestScore) {
      best = guide;
      bestScore = score;
    }
  }

  const previousGuide = FACING_GUIDES.find((guide) => guide.facing === previous)!;
  const previousScore = clampNumber(x * previousGuide.x + y * previousGuide.y, -1, 1);
  const bestAngle = Math.acos(clampNumber(bestScore, -1, 1));
  const previousAngle = Math.acos(previousScore);
  const hysteresis = hysteresisDegrees * Math.PI / 180;
  return previousAngle <= bestAngle + hysteresis ? previous : best.facing;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function animationKey(id: CombatArtId, action: CombatAction, facing: Facing): string {
  const category = id === "miremaw" || id === "ashwing" || id === "rootback" ? "monster" : "unit";
  return `${category}.${id}.${action}.${facing}`;
}

export interface DirectionalAnimationSnapshot {
  readonly id: CombatArtId;
  readonly action: CombatAction;
  readonly facing: Facing;
  readonly frame: number;
  readonly normalizedTime: number;
  readonly finished: boolean;
  readonly anchor: ArtAnchorContract;
}

export interface ProceduralPose {
  readonly bob: number;
  readonly stride: number;
  readonly lean: number;
  readonly weaponTravel: number;
  readonly recoil: number;
  readonly collapse: number;
  readonly charge: number;
}

export function sampleProceduralPose(snapshot: DirectionalAnimationSnapshot): ProceduralPose {
  const time = snapshot.normalizedTime;
  const wave = Math.sin(time * Math.PI * 2);
  const pulse = Math.sin(time * Math.PI);
  switch (snapshot.action) {
    case "idle":
      return { bob: -Math.max(0, wave) * 0.8, stride: 0, lean: wave * 0.02, weaponTravel: 0, recoil: 0, collapse: 0, charge: 0 };
    case "walk":
      return { bob: -Math.abs(wave) * 1.8, stride: wave, lean: wave * 0.05, weaponTravel: 0, recoil: 0, collapse: 0, charge: 0 };
    case "attack": {
      const windup = Math.min(1, time / 0.55);
      const strike = time < 0.55 ? -windup : Math.max(0, 1 - (time - 0.55) / 0.22);
      return { bob: -pulse, stride: 0, lean: strike * 0.18, weaponTravel: strike, recoil: time > 0.55 ? pulse : 0, collapse: 0, charge: windup };
    }
    case "hurt":
      return { bob: 0, stride: 0, lean: -pulse * 0.22, weaponTravel: 0, recoil: pulse, collapse: 0, charge: 0 };
    case "death":
      return { bob: 0, stride: 0, lean: time * 0.55, weaponTravel: 0, recoil: 0, collapse: time, charge: 0 };
    case "cast":
      return { bob: -pulse * 2, stride: 0, lean: -pulse * 0.08, weaponTravel: pulse * 0.45, recoil: 0, collapse: 0, charge: Math.min(1, time / 0.68) };
  }
}

export class DirectionalAnimationController {
  readonly id: CombatArtId;
  private elapsedMs = 0;
  private pendingStartEvents = true;
  private currentAction: CombatAction;
  private currentFacing: Facing;

  constructor(id: CombatArtId, action: CombatAction = "idle", facing: Facing = "se") {
    this.id = id;
    this.currentAction = action;
    this.currentFacing = facing;
  }

  get action(): CombatAction {
    return this.currentAction;
  }

  get facing(): Facing {
    return this.currentFacing;
  }

  get snapshot(): DirectionalAnimationSnapshot {
    const contract = DIRECTIONAL_ANIMATION_CONTRACT[this.id][this.currentAction];
    const durationMs = contract.frames / contract.fps * 1000;
    const clamped = contract.loop ? this.elapsedMs % durationMs : Math.min(this.elapsedMs, durationMs);
    const rawFrame = Math.floor(clamped * contract.fps / 1000);
    const frame = Math.min(contract.frames - 1, rawFrame);
    return {
      id: this.id,
      action: this.currentAction,
      facing: this.currentFacing,
      frame,
      normalizedTime: contract.loop ? clamped / durationMs : Math.min(1, this.elapsedMs / durationMs),
      finished: !contract.loop && this.elapsedMs >= durationMs,
      anchor: ANCHOR_CONTRACT[this.id]
    };
  }

  setFacing(facing: Facing): this {
    this.currentFacing = facing;
    return this;
  }

  faceVector(gridDx: number, gridDy: number): this {
    this.currentFacing = resolveFacing(gridDx, gridDy, this.currentFacing);
    return this;
  }

  play(action: CombatAction, restart = action !== this.currentAction): this {
    if (action !== this.currentAction || restart) {
      this.currentAction = action;
      this.elapsedMs = 0;
      this.pendingStartEvents = true;
    }
    return this;
  }

  update(deltaMs: number): readonly AnimationFrameEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return [];
    const contract = DIRECTIONAL_ANIMATION_CONTRACT[this.id][this.currentAction];
    const previousRawFrame = Math.floor(this.elapsedMs * contract.fps / 1000);
    const previousAbsoluteFrame = contract.loop ? previousRawFrame : Math.min(contract.frames - 1, previousRawFrame);
    const durationMs = contract.frames / contract.fps * 1000;
    this.elapsedMs = contract.loop
      ? this.elapsedMs + Math.min(deltaMs, durationMs * 2)
      : Math.min(durationMs, this.elapsedMs + deltaMs);
    const nextRawFrame = Math.floor(this.elapsedMs * contract.fps / 1000);
    const nextAbsoluteFrame = contract.loop ? nextRawFrame : Math.min(contract.frames - 1, nextRawFrame);
    const emitted: AnimationFrameEvent[] = this.pendingStartEvents
      ? contract.events.filter((event) => event.frame === 0)
      : [];
    this.pendingStartEvents = false;
    if (nextAbsoluteFrame <= previousAbsoluteFrame) return emitted;

    const lastFrame = Math.min(nextAbsoluteFrame, previousAbsoluteFrame + contract.frames * 2);
    for (let absoluteFrame = previousAbsoluteFrame + 1; absoluteFrame <= lastFrame; absoluteFrame += 1) {
      const frame = contract.loop ? absoluteFrame % contract.frames : Math.min(absoluteFrame, contract.frames - 1);
      for (const event of contract.events) {
        if (event.frame === frame) emitted.push(event);
      }
    }
    return emitted;
  }
}
