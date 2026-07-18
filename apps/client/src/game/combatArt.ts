import Phaser from "phaser";
import {
  ANCHOR_CONTRACT,
  DirectionalAnimationController,
  sampleProceduralPose,
  type AnimationFrameEvent,
  type CombatAction,
  type CombatArtId,
  type DirectionalAnimationSnapshot,
  type Facing
} from "./directionalAnimation";

export interface TeamPalette {
  readonly dark: number;
  readonly primary: number;
  readonly light: number;
  readonly highlight: number;
}

export const DEFAULT_TEAM_PALETTES = {
  pine: { dark: 0x1e3a31, primary: 0x315e4d, light: 0x6f967a, highlight: 0xb8c99a },
  river: { dark: 0x244452, primary: 0x39738a, light: 0x72a4b3, highlight: 0xb8d3d2 },
  crag: { dark: 0x5a3229, primary: 0x96513c, light: 0xc27a50, highlight: 0xe2b66e },
  enemy: { dark: 0x542a2b, primary: 0x8f3b3a, light: 0xc16a55, highlight: 0xe3aa7b },
  neutral: { dark: 0x253844, primary: 0x41657a, light: 0x6e94a8, highlight: 0xa9c5cf }
} as const satisfies Readonly<Record<string, TeamPalette>>;

export interface ProceduralCombatActorOptions {
  readonly id: CombatArtId;
  readonly x: number;
  readonly y: number;
  readonly teamPalette?: TeamPalette;
  readonly facing?: Facing;
  readonly action?: CombatAction;
  readonly depth?: number;
  readonly scale?: number;
}

interface FacingProfile {
  readonly side: -1 | 1;
  readonly front: boolean;
  readonly back: boolean;
  readonly width: number;
}

const INK = 0x1c211f;
const SKIN = 0xd1aa7d;
const SKIN_SHADOW = 0x9b7358;
const IRON = 0x586064;
const IRON_LIGHT = 0xb2bdba;
const BLACK_IRON = 0x30383a;
const LEATHER = 0x594332;
const WOOD = 0x766044;
const PALE_WOOD = 0xa5966d;
const BONE = 0xc3b896;
const COPPER = 0xb47a36;
const ASH = 0xbcc2b5;

const PROFESSION_ACCENT: Readonly<Record<CombatArtId, number>> = {
  mage: 0x6e627d,
  archer: 0xa59a58,
  musketeer: 0x596e72,
  warrior: 0x8b4e43,
  shieldbearer: 0x536d55,
  boar_rider: 0xa3643f,
  heavy_crossbow: 0xb8ae8e,
  miremaw: 0x586b4e,
  ashwing: 0x8c4a3d,
  rootback: 0x4e5a5b
};

function profileFor(facing: Facing): FacingProfile {
  return {
    side: facing === "w" || facing === "nw" || facing === "sw" ? -1 : 1,
    front: facing === "sw" || facing === "se",
    back: facing === "nw" || facing === "ne",
    width: facing === "e" || facing === "w" ? 0.72 : 1
  };
}

function polygon(graphics: Phaser.GameObjects.Graphics, color: number, points: readonly [number, number][], alpha = 1): void {
  const first = points[0];
  if (!first) return;
  graphics.fillStyle(color, alpha).beginPath().moveTo(first[0], first[1]);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    graphics.lineTo(point[0], point[1]);
  }
  graphics.closePath().fillPath();
}

function line(
  graphics: Phaser.GameObjects.Graphics,
  color: number,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  alpha = 1
): void {
  graphics.lineStyle(width, color, alpha).lineBetween(x1, y1, x2, y2);
}

function drawFeet(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  side: -1 | 1,
  stride: number,
  width = 5
): void {
  const offset = stride * 3.5;
  graphics.fillStyle(INK).fillEllipse(x - side * 4 + offset, y, width + 3, 4);
  graphics.fillStyle(INK).fillEllipse(x + side * 4 - offset, y + 1, width + 3, 4);
}

function drawHumanBase(
  graphics: Phaser.GameObjects.Graphics,
  profile: FacingProfile,
  snapshot: DirectionalAnimationSnapshot,
  palette: TeamPalette,
  accent: number,
  broad = false
): { bodyX: number; bodyY: number; handX: number; handY: number } {
  const pose = sampleProceduralPose(snapshot);
  const side = profile.side;
  const fall = pose.collapse;
  const bodyX = side * pose.lean * 20 + side * fall * 7;
  const bodyY = pose.bob - 29 + fall * 22;
  const torsoWidth = (broad ? 21 : 17) * profile.width;
  drawFeet(graphics, bodyX, Math.min(1, bodyY + 29), side, pose.stride, broad ? 7 : 5);
  line(graphics, LEATHER, 5, bodyX - side * 4, bodyY + 14, bodyX - side * (4 + pose.stride * 2), bodyY + 27);
  line(graphics, LEATHER, 5, bodyX + side * 4, bodyY + 14, bodyX + side * (4 + pose.stride * 2), bodyY + 27);
  polygon(graphics, INK, [
    [bodyX - torsoWidth / 2 - 1, bodyY - 10],
    [bodyX + torsoWidth / 2 + 1, bodyY - 10],
    [bodyX + torsoWidth / 2 + 3, bodyY + 17],
    [bodyX - torsoWidth / 2 - 3, bodyY + 17]
  ]);
  polygon(graphics, accent, [
    [bodyX - torsoWidth / 2, bodyY - 9],
    [bodyX + torsoWidth / 2, bodyY - 9],
    [bodyX + torsoWidth / 2 + 1, bodyY + 14],
    [bodyX - torsoWidth / 2 - 1, bodyY + 14]
  ]);
  graphics.fillStyle(profile.back ? SKIN_SHADOW : SKIN).fillCircle(bodyX + side * 1.5, bodyY - 17, 6);
  graphics.fillStyle(palette.primary).fillRect(bodyX - torsoWidth / 2 - 1, bodyY - 5, torsoWidth + 2, 5);
  graphics.fillStyle(palette.light).fillRect(bodyX + side * (torsoWidth / 2 - 2), bodyY - 8, 4, 13);
  return { bodyX, bodyY, handX: bodyX + side * (torsoWidth / 2 + 4), handY: bodyY + 2 };
}

function drawMage(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const base = drawHumanBase(graphics, profile, snapshot, palette, PROFESSION_ACCENT.mage);
  const side = profile.side;
  const robeY = base.bodyY + 8;
  polygon(graphics, 0x6e627d, [[base.bodyX - 13, robeY], [base.bodyX + 13, robeY], [base.bodyX + 18, robeY + 22], [base.bodyX - 18, robeY + 22]]);
  polygon(graphics, INK, [[base.bodyX - 8, base.bodyY - 22], [base.bodyX + side * 3, base.bodyY - 42], [base.bodyX + side * 13, base.bodyY - 21]]);
  polygon(graphics, palette.primary, [[base.bodyX - 6, base.bodyY - 24], [base.bodyX + side * 3, base.bodyY - 39], [base.bodyX + side * 10, base.bodyY - 22]]);
  const staffX = base.bodyX + side * (16 + pose.weaponTravel * 4);
  line(graphics, 0x4b392c, 3, staffX, base.bodyY + 21, staffX + side * 2, base.bodyY - 31);
  graphics.lineStyle(3, BONE).strokeCircle(staffX + side * 2, base.bodyY - 36, 8 + pose.charge * 2);
  graphics.lineStyle(2, palette.highlight, 0.55 + pose.charge * 0.4).strokeCircle(staffX + side * 2, base.bodyY - 36, 4);
  if (snapshot.action === "cast" || snapshot.action === "attack") {
    graphics.fillStyle(0x6d9a91, 0.55 + pose.charge * 0.4).fillCircle(staffX + side * 2, base.bodyY - 36, 2 + pose.charge * 2);
  }
}

function drawArcher(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const base = drawHumanBase(graphics, profile, snapshot, palette, PROFESSION_ACCENT.archer);
  const side = profile.side;
  const bowX = base.bodyX + side * (17 + pose.weaponTravel * 6);
  line(graphics, WOOD, 3, bowX, base.bodyY - 21, bowX + side * 5, base.bodyY, 1);
  line(graphics, WOOD, 3, bowX + side * 5, base.bodyY, bowX, base.bodyY + 22);
  line(graphics, BONE, 1, bowX, base.bodyY - 21, bowX - side * pose.charge * 7, base.bodyY);
  line(graphics, BONE, 1, bowX - side * pose.charge * 7, base.bodyY, bowX, base.bodyY + 22);
  line(graphics, IRON_LIGHT, 2, bowX - side * pose.charge * 7, base.bodyY, bowX + side * 12, base.bodyY - 1);
  polygon(graphics, LEATHER, [[base.bodyX - side * 10, base.bodyY - 10], [base.bodyX - side * 15, base.bodyY + 13], [base.bodyX - side * 8, base.bodyY + 15]]);
  for (let index = 0; index < 3; index += 1) {
    line(graphics, palette.light, 2, base.bodyX - side * (10 + index * 2), base.bodyY - 10, base.bodyX - side * (12 + index * 2), base.bodyY - 20);
  }
}

function drawMusketeer(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const base = drawHumanBase(graphics, profile, snapshot, palette, PROFESSION_ACCENT.musketeer, true);
  const side = profile.side;
  const kick = pose.recoil * 5;
  line(graphics, WOOD, 5, base.bodyX - side * 13, base.bodyY + 13, base.bodyX + side * (22 - kick), base.bodyY - 13);
  line(graphics, BLACK_IRON, 3, base.bodyX + side * 2, base.bodyY - 2, base.bodyX + side * (33 - kick), base.bodyY - 21);
  graphics.fillStyle(COPPER).fillCircle(base.bodyX + side * (14 - kick), base.bodyY - 9, 2);
  polygon(graphics, palette.primary, [[base.bodyX - 10, base.bodyY - 22], [base.bodyX + side * 8, base.bodyY - 28], [base.bodyX + side * 15, base.bodyY - 20], [base.bodyX - 9, base.bodyY - 17]]);
  for (let index = 0; index < 4; index += 1) {
    graphics.fillStyle(index % 2 === 0 ? COPPER : palette.light).fillRect(base.bodyX - 10 + index * 6, base.bodyY + 8, 3, 8);
  }
  if ((snapshot.action === "attack" || snapshot.action === "cast") && snapshot.normalizedTime > 0.4 && snapshot.normalizedTime < 0.58) {
    const muzzleX = base.bodyX + side * (36 - kick);
    polygon(graphics, 0xe4d8a8, [[muzzleX, base.bodyY - 22], [muzzleX + side * 8, base.bodyY - 26], [muzzleX + side * 5, base.bodyY - 19]]);
    graphics.fillStyle(ASH, 0.65).fillCircle(muzzleX + side * 11, base.bodyY - 24, 5);
  }
}

function drawWarrior(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const base = drawHumanBase(graphics, profile, snapshot, palette, PROFESSION_ACCENT.warrior, true);
  const side = profile.side;
  polygon(graphics, palette.primary, [[base.bodyX - side * 10, base.bodyY - 10], [base.bodyX - side * 19, base.bodyY + 3], [base.bodyX - side * 8, base.bodyY + 10]]);
  const reach = 19 + pose.weaponTravel * 12;
  const bladeX = base.bodyX + side * reach;
  line(graphics, LEATHER, 4, base.handX, base.handY, bladeX - side * 5, base.bodyY - 7);
  polygon(graphics, IRON_LIGHT, [[bladeX - side * 6, base.bodyY - 12], [bladeX + side * 10, base.bodyY - 20], [bladeX + side * 14, base.bodyY - 15], [bladeX - side * 2, base.bodyY - 6]]);
  line(graphics, BLACK_IRON, 2, bladeX - side * 6, base.bodyY - 12, bladeX + side * 10, base.bodyY - 20);
}

function drawShieldbearer(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const base = drawHumanBase(graphics, profile, snapshot, palette, PROFESSION_ACCENT.shieldbearer, true);
  const side = profile.side;
  const shieldX = base.bodyX + side * (10 + (profile.front ? 4 : -2));
  const shieldY = base.bodyY + (snapshot.action === "cast" ? 7 : 1);
  polygon(graphics, INK, [[shieldX - 11, shieldY - 17], [shieldX + 11, shieldY - 17], [shieldX + 15, shieldY + 18], [shieldX - 15, shieldY + 18]]);
  polygon(graphics, WOOD, [[shieldX - 9, shieldY - 15], [shieldX + 9, shieldY - 15], [shieldX + 12, shieldY + 15], [shieldX - 12, shieldY + 15]]);
  line(graphics, PALE_WOOD, 3, shieldX - 5, shieldY - 14, shieldX - 7, shieldY + 14);
  line(graphics, PALE_WOOD, 3, shieldX + 4, shieldY - 14, shieldX + 6, shieldY + 14);
  polygon(graphics, palette.primary, [[shieldX - 9, shieldY - 15], [shieldX - 2, shieldY - 15], [shieldX - 4, shieldY - 8], [shieldX - 11, shieldY - 8]]);
  polygon(graphics, palette.light, [[shieldX + 2, shieldY - 15], [shieldX + 9, shieldY - 15], [shieldX + 11, shieldY - 8], [shieldX + 4, shieldY - 8]]);
  const spearStartX = base.bodyX - side * 13;
  const spearEndX = base.bodyX + side * (28 + pose.weaponTravel * 8);
  line(graphics, WOOD, 3, spearStartX, base.bodyY - 3, spearEndX, base.bodyY - 7);
  polygon(graphics, IRON_LIGHT, [[spearEndX, base.bodyY - 11], [spearEndX + side * 9, base.bodyY - 7], [spearEndX, base.bodyY - 3]]);
}

function drawBoarRider(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const side = profile.side;
  const bodyY = -20 + pose.bob + pose.collapse * 19;
  drawFeet(graphics, -side * 15, bodyY + 20, side, pose.stride, 9);
  drawFeet(graphics, side * 17, bodyY + 20, side, -pose.stride, 9);
  graphics.fillStyle(INK).fillEllipse(0, bodyY, 63 * profile.width, 31);
  graphics.fillStyle(0x6b6259).fillEllipse(-side * 2, bodyY - 2, 57 * profile.width, 27);
  graphics.fillStyle(0x302c29).fillEllipse(-side * 12, bodyY - 15, 29, 12);
  const snoutX = side * 34;
  graphics.fillStyle(0x777062).fillEllipse(snoutX, bodyY + 1, 22, 15);
  graphics.fillStyle(INK).fillCircle(snoutX + side * 7, bodyY - 1, 2);
  polygon(graphics, BONE, [[snoutX + side * 2, bodyY + 5], [snoutX + side * 10, bodyY + 12], [snoutX + side * 4, bodyY + 2]]);
  polygon(graphics, BONE, [[snoutX - side * 3, bodyY + 6], [snoutX + side * 3, bodyY + 10], [snoutX - side * 1, bodyY + 3]]);
  polygon(graphics, palette.primary, [[-25, bodyY - 10], [18, bodyY - 10], [22, bodyY + 5], [-22, bodyY + 5]]);
  const riderY = bodyY - 32;
  polygon(graphics, 0xa3643f, [[-9, riderY - 5], [9, riderY - 5], [12, riderY + 20], [-12, riderY + 20]]);
  graphics.fillStyle(SKIN).fillCircle(side * 2, riderY - 12, 6);
  graphics.fillStyle(palette.light).fillRect(-10, riderY + 3, 20, 5);
  const spearX = side * (31 + pose.weaponTravel * 10);
  line(graphics, WOOD, 4, -side * 6, riderY + 3, spearX, riderY - 9);
  polygon(graphics, IRON_LIGHT, [[spearX, riderY - 14], [spearX + side * 11, riderY - 10], [spearX, riderY - 5]]);
  line(graphics, palette.highlight, 3, spearX - side * 4, riderY - 8, spearX - side * 2, riderY + 1);
  if (snapshot.action === "cast") {
    for (let index = 0; index < 3; index += 1) {
      graphics.fillStyle(0x826d4e, 0.7 - index * 0.15).fillRect(-side * (33 + index * 8), bodyY + 17 - index * 2, 6, 4);
    }
  }
}

function drawHeavyCrossbow(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot, palette: TeamPalette): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const base = drawHumanBase(graphics, profile, snapshot, palette, PROFESSION_ACCENT.heavy_crossbow, true);
  const side = profile.side;
  const crossY = base.bodyY - 5;
  const frontX = base.bodyX + side * (17 + pose.weaponTravel * 7);
  line(graphics, WOOD, 6, base.bodyX - side * 11, crossY + 4, frontX + side * 18, crossY - 4);
  line(graphics, PALE_WOOD, 5, frontX - 3, crossY - 23, frontX + 3, crossY + 17);
  line(graphics, BONE, 1, frontX - 3, crossY - 23, frontX - side * pose.charge * 10, crossY - 3);
  line(graphics, BONE, 1, frontX - side * pose.charge * 10, crossY - 3, frontX + 3, crossY + 17);
  line(graphics, IRON_LIGHT, 3, frontX - side * 10, crossY - 3, frontX + side * 28, crossY - 5);
  graphics.lineStyle(3, BONE).strokeCircle(base.bodyX - side * 11, base.bodyY - 10, 7);
  line(graphics, WOOD, 3, frontX, crossY + 4, frontX - side * 7, 1);
  line(graphics, palette.primary, 4, base.bodyX - 9, base.bodyY - 6, base.bodyX + 9, base.bodyY + 7);
}

function drawMiremaw(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const side = profile.side;
  const y = -17 + pose.bob + pose.collapse * 17;
  for (let index = -1; index <= 1; index += 1) {
    const x = index * 15;
    line(graphics, INK, 5, x - side * 3, y + 7, x - side * (8 + pose.stride * 2), y + 20);
    line(graphics, INK, 5, x + side * 3, y + 8, x + side * (8 + pose.stride * 2), y + 21);
  }
  graphics.fillStyle(INK).fillEllipse(0, y, 62 * profile.width, 31);
  graphics.fillStyle(0x586b4e).fillEllipse(-side * 3, y - 2, 57 * profile.width, 27);
  for (let index = 0; index < 3; index += 1) {
    graphics.fillStyle(index === 1 ? 0xa79855 : 0x777062).fillEllipse(-side * (18 - index * 15), y - 19 - Math.abs(pose.charge) * 2, 11, 17);
  }
  const jawX = side * (29 + pose.weaponTravel * 8);
  polygon(graphics, INK, [[jawX - side * 5, y - 9], [jawX + side * 17, y - 4], [jawX + side * 19, y + 8], [jawX - side * 4, y + 10]]);
  polygon(graphics, 0x777062, [[jawX - side * 3, y - 7], [jawX + side * 14, y - 3], [jawX + side * 15, y + 5], [jawX - side * 3, y + 7]]);
  graphics.fillStyle(0xe0b866).fillCircle(jawX + side * 7, y - 7, 2);
}

function drawAshwing(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const side = profile.side;
  const airborne = snapshot.action === "cast" ? Math.sin(snapshot.normalizedTime * Math.PI) * 10 : 0;
  const y = -24 + pose.bob - airborne + pose.collapse * 23;
  polygon(graphics, INK, [[-6, y - 5], [-36, y - 31 - pose.charge * 7], [-28, y + 4], [0, y + 10]]);
  polygon(graphics, 0x81766d, [[-5, y - 4], [-32, y - 27 - pose.charge * 7], [-25, y + 1], [0, y + 7]]);
  polygon(graphics, INK, [[6, y - 5], [36, y - 31 - pose.charge * 7], [28, y + 4], [0, y + 10]]);
  polygon(graphics, 0x8c4a3d, [[5, y - 4], [32, y - 27 - pose.charge * 7], [25, y + 1], [0, y + 7]]);
  graphics.fillStyle(0x302f2c).fillEllipse(0, y, 48 * profile.width, 24);
  const headX = side * 26;
  graphics.fillStyle(0x302f2c).fillCircle(headX, y - 7, 9);
  polygon(graphics, BONE, [[headX + side * 4, y - 10], [headX + side * 17, y - 5], [headX + side * 4, y - 2]]);
  line(graphics, 0x302f2c, 4, -side * 22, y + 2, -side * 39, y + 12);
  drawFeet(graphics, -side * 11, Math.min(1, y + 21 + airborne), side, pose.stride, 6);
  graphics.fillStyle(0xe0b866).fillCircle(headX + side * 2, y - 10, 2);
}

function drawRootback(graphics: Phaser.GameObjects.Graphics, snapshot: DirectionalAnimationSnapshot): void {
  const profile = profileFor(snapshot.facing);
  const pose = sampleProceduralPose(snapshot);
  const side = profile.side;
  const y = -37 + pose.bob + pose.collapse * 33;
  drawFeet(graphics, 0, y + 38, side, pose.stride, 13);
  polygon(graphics, INK, [[-27, y - 19], [3, y - 32], [28, y - 10], [23, y + 31], [-29, y + 27]]);
  polygon(graphics, 0x4e5a5b, [[-24, y - 17], [2, y - 28], [24, y - 8], [20, y + 27], [-25, y + 24]]);
  polygon(graphics, 0x657170, [[-19, y - 14], [0, y - 24], [3, y + 19], [-23, y + 14]]);
  const shortHand = -side * 32;
  const longHand = side * (35 + pose.weaponTravel * 12);
  line(graphics, 0x5f4935, 10, -side * 17, y - 5, shortHand, y + 22);
  line(graphics, 0x4e5a5b, 15, side * 16, y - 9, longHand, y - 22 - pose.charge * 10);
  polygon(graphics, 0x657170, [[longHand - 9, y - 30 - pose.charge * 10], [longHand + 10, y - 27 - pose.charge * 10], [longHand + 13, y - 12 - pose.charge * 10], [longHand - 8, y - 10 - pose.charge * 10]]);
  for (let index = -1; index <= 1; index += 1) line(graphics, 0x5f4935, 3, index * 7, y - 23, index * 9, y + 25);
  line(graphics, BONE, 2, 0, y - 29, side * 2, y - 19);
  polygon(graphics, COPPER, [[side * 2 - 5, y - 19], [side * 2 + 5, y - 19], [side * 2 + 7, y - 10], [side * 2 - 7, y - 10]]);
  if (snapshot.action === "hurt" || snapshot.action === "cast") {
    line(graphics, 0x86b2aa, 2, -4, y - 8, 5, y + 3);
  }
}

export function drawCombatArtFrame(
  graphics: Phaser.GameObjects.Graphics,
  id: CombatArtId,
  teamPalette: TeamPalette,
  snapshot: DirectionalAnimationSnapshot
): void {
  graphics.clear();
  switch (id) {
    case "mage": drawMage(graphics, snapshot, teamPalette); break;
    case "archer": drawArcher(graphics, snapshot, teamPalette); break;
    case "musketeer": drawMusketeer(graphics, snapshot, teamPalette); break;
    case "warrior": drawWarrior(graphics, snapshot, teamPalette); break;
    case "shieldbearer": drawShieldbearer(graphics, snapshot, teamPalette); break;
    case "boar_rider": drawBoarRider(graphics, snapshot, teamPalette); break;
    case "heavy_crossbow": drawHeavyCrossbow(graphics, snapshot, teamPalette); break;
    case "miremaw": drawMiremaw(graphics, snapshot); break;
    case "ashwing": drawAshwing(graphics, snapshot); break;
    case "rootback": drawRootback(graphics, snapshot); break;
  }
}

export class ProceduralCombatActor {
  readonly container: Phaser.GameObjects.Container;
  readonly animation: DirectionalAnimationController;
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private palette: TeamPalette;
  private renderSignature = "";

  constructor(scene: Phaser.Scene, options: ProceduralCombatActorOptions) {
    const contract = ANCHOR_CONTRACT[options.id];
    this.palette = options.teamPalette ?? DEFAULT_TEAM_PALETTES.neutral;
    this.animation = new DirectionalAnimationController(options.id, options.action, options.facing);
    this.shadow = scene.add.ellipse(0, 1, contract.shadowWidth, contract.shadowHeight, 0x10241e, 0.35);
    this.art = scene.add.graphics();
    this.container = scene.add.container(options.x, options.y, [this.shadow, this.art]);
    this.container.setSize(contract.frameWidth, contract.frameHeight);
    this.container.setDepth(options.depth ?? options.y);
    this.container.setScale(options.scale ?? 1);
    this.redraw(true);
  }

  setFacing(facing: Facing): this {
    this.animation.setFacing(facing);
    this.redraw(true);
    return this;
  }

  faceVector(gridDx: number, gridDy: number): this {
    this.animation.faceVector(gridDx, gridDy);
    this.redraw(true);
    return this;
  }

  play(action: CombatAction, restart = action !== this.animation.action): this {
    this.animation.play(action, restart);
    this.redraw(true);
    return this;
  }

  setTeamPalette(palette: TeamPalette): this {
    this.palette = palette;
    this.redraw(true);
    return this;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y).setDepth(y);
    return this;
  }

  update(deltaMs: number): readonly AnimationFrameEvent[] {
    const events = this.animation.update(deltaMs);
    this.redraw(false);
    return events;
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private redraw(force: boolean): void {
    const snapshot = this.animation.snapshot;
    const signature = `${snapshot.action}:${snapshot.facing}:${snapshot.frame}`;
    if (!force && signature === this.renderSignature) return;
    this.renderSignature = signature;
    drawCombatArtFrame(this.art, this.animation.id, this.palette, snapshot);
    const collapse = sampleProceduralPose(snapshot).collapse;
    this.shadow.setScale(1 + collapse * 0.2, Math.max(0.25, 1 - collapse * 0.55));
    this.shadow.setAlpha(snapshot.action === "death" ? 0.35 * (1 - collapse * 0.55) : 0.35);
  }
}

export function createProceduralCombatActor(scene: Phaser.Scene, options: ProceduralCombatActorOptions): ProceduralCombatActor {
  return new ProceduralCombatActor(scene, options);
}
