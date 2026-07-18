import Phaser from "phaser";

export interface EffectPoint { readonly x: number; readonly y: number }

export type ProjectileVisualKind = "arrow" | "bolt" | "musket" | "arcane" | "spore" | "ember" | "impact";

export interface ProjectileEffectOptions {
  readonly from: EffectPoint;
  readonly to: EffectPoint;
  readonly kind: ProjectileVisualKind | string;
  readonly tint?: number;
  readonly durationMs?: number;
  readonly depth?: number;
  readonly onImpact?: () => void;
}

const EFFECT_COLORS: Readonly<Record<string, number>> = {
  arrow: 0xe6d18f,
  bolt: 0xd9e0d2,
  musket: 0xffc46b,
  arcane: 0x7ee6ff,
  spore: 0x94c869,
  ember: 0xff7047,
  impact: 0xffe3a1,
};

export function launchProjectile(scene: Phaser.Scene, options: ProjectileEffectOptions): Phaser.GameObjects.Container {
  const color = options.tint ?? EFFECT_COLORS[options.kind] ?? EFFECT_COLORS.impact!;
  const dx = options.to.x - options.from.x;
  const dy = options.to.y - options.from.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const body = scene.add.graphics();

  if (options.kind === "arrow" || options.kind === "bolt") {
    body.lineStyle(options.kind === "bolt" ? 3 : 2, color, 1).lineBetween(-13, 0, 10, 0);
    body.fillStyle(color, 1).fillTriangle(13, 0, 6, -4, 6, 4);
    body.lineStyle(2, 0x6c4a31, 0.9).lineBetween(-13, 0, -18, -5).lineBetween(-13, 0, -18, 5);
  } else if (options.kind === "musket") {
    body.lineStyle(3, color, 0.95).lineBetween(-22, 0, 8, 0);
    body.fillStyle(0xfff2bd, 1).fillCircle(10, 0, 3);
  } else {
    body.fillStyle(color, 0.2).fillCircle(0, 0, 12);
    body.fillStyle(color, 0.75).fillCircle(0, 0, 7);
    body.fillStyle(0xffffff, 0.9).fillCircle(-2, -2, 2);
  }

  const projectile = scene.add.container(options.from.x, options.from.y, [body])
    .setDepth(options.depth ?? 20_000)
    .setRotation(angle);
  const duration = options.durationMs ?? Phaser.Math.Clamp(distance * 1.45, 130, 460);
  scene.tweens.add({
    targets: projectile,
    x: options.to.x,
    y: options.to.y,
    duration,
    ease: "Sine.easeIn",
    onComplete: () => {
      projectile.destroy();
      spawnImpactBurst(scene, options.to, color, options.kind === "musket" ? 12 : 8);
      options.onImpact?.();
    },
  });
  return projectile;
}

export function spawnImpactBurst(
  scene: Phaser.Scene,
  point: EffectPoint,
  color = EFFECT_COLORS.impact!,
  radius = 9,
): void {
  const ring = scene.add.graphics().setPosition(point.x, point.y).setDepth(20_001);
  ring.lineStyle(3, color, 0.9).strokeCircle(0, 0, 5);
  scene.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 220, onComplete: () => ring.destroy() });

  for (let index = 0; index < 7; index += 1) {
    const angle = index / 7 * Math.PI * 2;
    const mote = scene.add.circle(point.x, point.y, index % 2 === 0 ? 2.5 : 1.5, color, 0.95).setDepth(20_002);
    scene.tweens.add({
      targets: mote,
      x: point.x + Math.cos(angle) * radius * (1.4 + index * 0.08),
      y: point.y + Math.sin(angle) * radius * 0.75,
      alpha: 0,
      scale: 0.35,
      duration: 240 + index * 14,
      onComplete: () => mote.destroy(),
    });
  }
}

export function spawnSkillTelegraph(
  scene: Phaser.Scene,
  point: EffectPoint,
  color: number,
  radius = 34,
  durationMs = 460,
): Phaser.GameObjects.Graphics {
  const telegraph = scene.add.graphics().setPosition(point.x, point.y).setDepth(19_999);
  telegraph.lineStyle(3, color, 0.85).strokeEllipse(0, 0, radius * 2, radius);
  telegraph.lineStyle(1, 0xffffff, 0.55).strokeEllipse(0, 0, radius * 1.55, radius * 0.75);
  scene.tweens.add({
    targets: telegraph,
    scale: 1.4,
    alpha: 0,
    duration: durationMs,
    ease: "Cubic.easeOut",
    onComplete: () => telegraph.destroy(),
  });
  return telegraph;
}

export function spawnFloatingText(
  scene: Phaser.Scene,
  point: EffectPoint,
  label: string,
  color = "#fff1b6",
): Phaser.GameObjects.Text {
  const text = scene.add.text(point.x, point.y, label, {
    color,
    fontFamily: "Segoe UI, sans-serif",
    fontSize: "16px",
    fontStyle: "bold",
    stroke: "#18201d",
    strokeThickness: 4,
  }).setOrigin(0.5).setDepth(30_000);
  scene.tweens.add({
    targets: text,
    y: point.y - 32,
    alpha: 0,
    duration: 720,
    ease: "Cubic.easeOut",
    onComplete: () => text.destroy(),
  });
  return text;
}

export function spawnDeathDust(scene: Phaser.Scene, point: EffectPoint, color = 0x6c5b47): void {
  for (let index = 0; index < 9; index += 1) {
    const offset = (index - 4) * 5;
    const dust = scene.add.circle(point.x + offset, point.y + 2, 3 + index % 3, color, 0.5).setDepth(19_998);
    scene.tweens.add({
      targets: dust,
      x: dust.x + offset * 0.7,
      y: dust.y - 12 - index % 3 * 4,
      scale: 2,
      alpha: 0,
      duration: 520 + index * 24,
      onComplete: () => dust.destroy(),
    });
  }
}
