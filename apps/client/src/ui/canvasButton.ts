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
  setActive(active: boolean | null): void;
  setEnabled(enabled: boolean): void;
  setLabel(glyph: string, label: string, accessibleLabel?: string): void;
  setSuspended(suspended: boolean): void;
  setVisible(visible: boolean): void;
  focus(): boolean;
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
  const glyph = scene.add.text(0, options.compact ? -22 : -13, options.glyph, {
    color: "#f0ebcf",
    fontFamily: 'Georgia, "Noto Serif TC", serif',
    fontSize: options.compact ? "31px" : "36px",
    fontStyle: "bold",
  }).setOrigin(0.5);
  const label = scene.add.text(0, options.compact ? 19 : 27, options.label, {
    color: "#f0ebcf",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: options.compact ? "26px" : "28px",
    fontStyle: "bold",
    align: "center",
    wordWrap: options.compact ? { width: options.width - 14, useAdvancedWrap: true } : undefined,
  }).setOrigin(0.5);
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
  let focused = false;
  let pressed = false;
  let pressedPointerId: number | null = null;
  let suspended = false;
  let destroyed = false;

  const draw = (): void => {
    if (destroyed || !container.scene || !background.scene || !glyph.scene || !label.scene) return;
    const interactive = enabled && !suspended;
    const fill = !interactive
      ? COLORS.charcoal
      : active || pressed
        ? COLORS.copper
        : hovered
          ? COLORS.pine
          : COLORS.pineDark;
    const foreground = active || pressed ? COLORS.charcoal : interactive ? COLORS.chalk : COLORS.muted;
    background.clear();
    background.fillStyle(COLORS.charcoal, 0.78).fillRect(-options.width / 2 + 5, -options.height / 2 + 7, options.width, options.height);
    background.fillStyle(fill, interactive ? 0.98 : 0.72).fillRect(-options.width / 2, -options.height / 2, options.width - 5, options.height - 7);
    background.lineStyle(active ? 4 : 3, options.accent || active ? COLORS.copper : COLORS.chalk, interactive ? 0.95 : 0.38)
      .strokeRect(-options.width / 2, -options.height / 2, options.width - 5, options.height - 7);
    background.lineStyle(1, COLORS.charcoal, 0.88)
      .strokeRect(-options.width / 2 + 5, -options.height / 2 + 5, options.width - 15, options.height - 17);
    if (focused) {
      background.lineStyle(5, COLORS.copper, 1)
        .strokeRect(-options.width / 2 + 2, -options.height / 2 + 2, options.width - 9, options.height - 11);
    }
    glyph.setColor(Phaser.Display.Color.IntegerToColor(foreground).rgba);
    label.setColor(Phaser.Display.Color.IntegerToColor(foreground).rgba);
    container.setAlpha(interactive ? 1 : 0.62);
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
    if (!enabled || suspended) return;
    pressed = true;
    pressedPointerId = pointer.id;
    draw();
  });
  hitZone.on("pointerup", (pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
    event.stopPropagation();
    const shouldPress = enabled && !suspended && pressed && pressedPointerId === pointer.id;
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
    focused = true;
    hovered = true;
    draw();
  });
  accessibilityButton.addEventListener("blur", () => {
    focused = false;
    hovered = false;
    pressed = false;
    pressedPointerId = null;
    draw();
  });
  accessibilityButton.addEventListener("click", () => {
    if (enabled && !suspended && container.visible) onPress(scene.input.activePointer);
  });

  draw();

  return {
    container,
    name: options.name,
    setActive(value: boolean | null): void {
      if (destroyed) return;
      active = value ?? false;
      if (value === null) accessibilityButton.removeAttribute("aria-pressed");
      else accessibilityButton.setAttribute("aria-pressed", String(value));
      draw();
    },
    setEnabled(value: boolean): void {
      if (destroyed) return;
      enabled = value;
      if (!value) {
        pressed = false;
        pressedPointerId = null;
      }
      if (hitZone.input) hitZone.input.enabled = value && container.visible && !suspended;
      accessibilityButton.disabled = !value || suspended;
      draw();
    },
    setLabel(nextGlyph: string, nextLabel: string, nextAccessibleLabel?: string): void {
      if (destroyed) return;
      glyph.setText(nextGlyph);
      label.setText(nextLabel);
      accessibilityButton.setAttribute("aria-label", nextAccessibleLabel ?? nextLabel);
      accessibilityButton.textContent = `${nextGlyph} ${nextLabel}`;
      draw();
    },
    setSuspended(value: boolean): void {
      if (destroyed) return;
      suspended = value;
      if (value) {
        hovered = false;
        focused = false;
        pressed = false;
        pressedPointerId = null;
        if (document.activeElement === accessibilityButton) accessibilityButton.blur();
      }
      if (hitZone.input) hitZone.input.enabled = container.visible && enabled && !value;
      accessibilityButton.disabled = !enabled || value;
      accessibilityButton.hidden = !container.visible || value;
      draw();
    },
    setVisible(visible: boolean): void {
      if (destroyed) return;
      container.setVisible(visible).setActive(visible);
      if (hitZone.input) hitZone.input.enabled = visible && enabled && !suspended;
      accessibilityButton.hidden = !visible || suspended;
    },
    focus(): boolean {
      if (destroyed || accessibilityButton.hidden || accessibilityButton.disabled) return false;
      accessibilityButton.focus();
      return true;
    },
    destroy(): void {
      if (destroyed) return;
      // Removing a focused proxy synchronously emits blur in Chromium. Mark
      // the control dead first so that blur cannot redraw destroyed Phaser
      // Text/Graphics objects during scene shutdown or restart.
      destroyed = true;
      accessibilityButton.remove();
      container.destroy(true);
    },
  };
}
