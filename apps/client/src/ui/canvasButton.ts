import Phaser from "phaser";

export interface CanvasButtonOptions {
  readonly width: number;
  readonly height: number;
  readonly glyph: string;
  readonly label: string;
  readonly name: string;
  readonly accessibleLabel?: string;
  readonly compact?: boolean;
  readonly accent?: boolean;
}

export interface CanvasButtonControl {
  readonly container: Phaser.GameObjects.Container;
  readonly name: string;
  setActive(active: boolean): void;
  setEnabled(enabled: boolean): void;
  setLabel(glyph: string, label: string): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const COLORS = {
  charcoal: 0x101917,
  pine: 0x25483c,
  pineDark: 0x172d28,
  copper: 0xe0b866,
  chalk: 0xf0ebcf,
  muted: 0x8d927f,
} as const;

export function createCanvasButton(
  scene: Phaser.Scene,
  options: CanvasButtonOptions,
  onPress: (pointer: Phaser.Input.Pointer) => void,
): CanvasButtonControl {
  const container = scene.add.container(0, 0).setName(options.name);
  const background = scene.add.graphics();
  const glyph = scene.add.text(0, options.compact ? -1 : -13, options.glyph, {
    color: "#f0ebcf",
    fontFamily: 'Georgia, "Noto Serif TC", serif',
    fontSize: options.compact ? "32px" : "36px",
    fontStyle: "bold",
  }).setOrigin(0.5);
  const label = scene.add.text(0, options.compact ? 0 : 27, options.label, {
    color: "#f0ebcf",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: options.compact ? "27px" : "28px",
    fontStyle: "bold",
  }).setOrigin(0.5);
  if (options.compact) {
    glyph.setX(-options.width * 0.3);
    label.setX(options.width * 0.12);
  }
  const hitZone = scene.add.zone(0, 0, options.width, options.height)
    .setName(`${options.name}:hit-zone`)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  container.add([background, glyph, label, hitZone]);
  container.setSize(options.width, options.height);
  const accessibilityButton = document.createElement("button");
  accessibilityButton.type = "button";
  accessibilityButton.className = "canvas-control-proxy";
  accessibilityButton.dataset.canvasControl = options.name;
  accessibilityButton.setAttribute("aria-label", options.accessibleLabel ?? options.label);
  accessibilityButton.textContent = `${options.glyph} ${options.label}`;
  (scene.game.canvas.parentElement ?? document.body).append(accessibilityButton);

  let active = false;
  let enabled = true;
  let hovered = false;
  let pressed = false;
  let pressedPointerId: number | null = null;

  const draw = (): void => {
    const fill = !enabled
      ? COLORS.charcoal
      : active || pressed
        ? COLORS.copper
        : hovered
          ? COLORS.pine
          : COLORS.pineDark;
    const foreground = active || pressed ? COLORS.charcoal : enabled ? COLORS.chalk : COLORS.muted;
    background.clear();
    background.fillStyle(COLORS.charcoal, 0.78).fillRect(-options.width / 2 + 5, -options.height / 2 + 7, options.width, options.height);
    background.fillStyle(fill, enabled ? 0.98 : 0.72).fillRect(-options.width / 2, -options.height / 2, options.width - 5, options.height - 7);
    background.lineStyle(active ? 4 : 3, options.accent || active ? COLORS.copper : COLORS.chalk, enabled ? 0.95 : 0.38)
      .strokeRect(-options.width / 2, -options.height / 2, options.width - 5, options.height - 7);
    background.lineStyle(1, COLORS.charcoal, 0.88)
      .strokeRect(-options.width / 2 + 5, -options.height / 2 + 5, options.width - 15, options.height - 17);
    glyph.setColor(Phaser.Display.Color.IntegerToColor(foreground).rgba);
    label.setColor(Phaser.Display.Color.IntegerToColor(foreground).rgba);
    container.setAlpha(enabled ? 1 : 0.62);
  };

  hitZone.on("pointerover", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    hovered = true;
    draw();
  });
  hitZone.on("pointerout", () => {
    hovered = false;
    pressed = false;
    pressedPointerId = null;
    draw();
  });
  hitZone.on("pointerdown", (pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    if (!enabled) return;
    pressed = true;
    pressedPointerId = pointer.id;
    draw();
  });
  hitZone.on("pointerup", (pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    const shouldPress = enabled && pressed && pressedPointerId === pointer.id;
    pressed = false;
    pressedPointerId = null;
    draw();
    if (shouldPress) onPress(pointer);
  });
  hitZone.on("pointerupoutside", () => {
    pressed = false;
    pressedPointerId = null;
    draw();
  });
  accessibilityButton.addEventListener("focus", () => {
    hovered = true;
    draw();
  });
  accessibilityButton.addEventListener("blur", () => {
    hovered = false;
    pressed = false;
    pressedPointerId = null;
    draw();
  });
  accessibilityButton.addEventListener("click", () => {
    if (enabled && container.visible) onPress(scene.input.activePointer);
  });

  draw();

  return {
    container,
    name: options.name,
    setActive(value: boolean): void {
      active = value;
      accessibilityButton.setAttribute("aria-pressed", String(value));
      draw();
    },
    setEnabled(value: boolean): void {
      enabled = value;
      if (!value) {
        pressed = false;
        pressedPointerId = null;
      }
      if (hitZone.input) hitZone.input.enabled = value && container.visible;
      accessibilityButton.disabled = !value;
      draw();
    },
    setLabel(nextGlyph: string, nextLabel: string): void {
      glyph.setText(nextGlyph);
      label.setText(nextLabel);
      accessibilityButton.setAttribute("aria-label", nextLabel);
      accessibilityButton.textContent = `${nextGlyph} ${nextLabel}`;
      draw();
    },
    setVisible(visible: boolean): void {
      container.setVisible(visible).setActive(visible);
      if (hitZone.input) hitZone.input.enabled = visible && enabled;
      accessibilityButton.hidden = !visible;
    },
    destroy(): void {
      accessibilityButton.remove();
      container.destroy(true);
    },
  };
}
