import Phaser from "phaser";
import { COMMAND_ICON_TEXTURE, commandIcon, registerCommandIcons } from "../game/commandIcons";
import { VILLAGE_WORKER_ANIMATION_MANIFEST } from "../game/villageWorkerAnimation";

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
  const glyph = scene.add.text(0, options.compact ? -17 : -13, options.glyph, {
    color: "#f0ebcf",
    fontFamily: 'Georgia, "Noto Serif TC", serif',
    fontSize: options.compact ? "27px" : "36px",
    fontStyle: "bold",
  }).setOrigin(0.5);
  const icon = registerCommandIcons(scene) ? scene.add.image(0, options.compact ? -17 : -13, COMMAND_ICON_TEXTURE, "food").setDisplaySize(options.compact ? 40 : 48, options.compact ? 40 : 48).setVisible(false) : undefined;
  const label = scene.add.text(0, options.compact ? 19 : 27, options.label, {
    color: "#f0ebcf",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: options.compact ? "20px" : "28px",
    fontStyle: "bold",
    align: "center",
  }).setOrigin(0.5);
  const hitZone = scene.add.zone(0, 0, options.width, options.height)
    .setName(`${options.name}:hit-zone`)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  container.add([background, glyph, ...(icon ? [icon] : []), label, hitZone]);
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

  const updateIcon = (nextGlyph: string, nextLabel: string): void => {
    const frame = commandIcon(nextGlyph, nextLabel);
    const workerKey = VILLAGE_WORKER_ANIMATION_MANIFEST.directionalTextureKeys?.se ?? VILLAGE_WORKER_ANIMATION_MANIFEST.textureKey;
    const worker = /工匠/.test(nextLabel) && scene.textures.exists(workerKey);
    if (icon) {
      icon.setVisible(worker || frame !== null);
      if (worker) {
        const texture = scene.textures.get(workerKey);
        if (!texture.has("worker-command-portrait")) texture.add("worker-command-portrait", 0, 16, 8, 64, 64);
        icon.setTexture(workerKey, "worker-command-portrait");
      } else if (frame) icon.setTexture(COMMAND_ICON_TEXTURE, frame);
      icon.setDisplaySize(options.compact ? 40 : 48, options.compact ? 40 : 48);
    }
    glyph.setVisible(!icon || (!worker && frame === null));
  };
  updateIcon(options.glyph, options.label);

  // The native control occupies the painted button, so pointer, touch,
  // keyboard and screen-reader actions all activate the same command once.
  const syncProxy = (): void => {
    if (destroyed || !container.scene || !container.visible || suspended) return;
    const bounds = hitZone.getBounds();
    let ignored = container.cameraFilter;
    for (let parent = container.parentContainer; parent; parent = parent.parentContainer) ignored |= parent.cameraFilter;
    const camera = [...scene.cameras.cameras].reverse().find(candidate => !(ignored & candidate.id));
    if (!camera) return;
    const first = camera.matrixCombined.transformPoint(bounds.x, bounds.y);
    const last = camera.matrixCombined.transformPoint(bounds.right, bounds.bottom);
    const canvas = scene.game.canvas.getBoundingClientRect();
    const host = accessibilityButton.parentElement!.getBoundingClientRect();
    const scaleX = canvas.width / scene.scale.gameSize.width, scaleY = canvas.height / scene.scale.gameSize.height;
    Object.assign(accessibilityButton.style, {
      left: `${canvas.left - host.left + Math.min(first.x, last.x) * scaleX}px`,
      top: `${canvas.top - host.top + Math.min(first.y, last.y) * scaleY}px`,
      width: `${Math.abs(last.x - first.x) * scaleX}px`, height: `${Math.abs(last.y - first.y) * scaleY}px`,
    });
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, syncProxy);

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
    background.fillStyle(COLORS.charcoal, 0.35).fillRoundedRect(-options.width / 2 + 2, -options.height / 2 + 3, options.width - 3, options.height - 3, 5);
    background.fillStyle(fill, interactive ? 0.98 : 0.72).fillRoundedRect(-options.width / 2, -options.height / 2, options.width - 5, options.height - 7, 5);
    background.lineStyle(active ? 3 : 1.5, options.accent || active ? COLORS.copper : 0x6d8271, interactive ? 0.95 : 0.38)
      .strokeRect(-options.width / 2, -options.height / 2, options.width - 5, options.height - 7);
    background.lineStyle(1, COLORS.charcoal, 0.88)
      .strokeRect(-options.width / 2 + 5, -options.height / 2 + 5, options.width - 15, options.height - 17);
    if (focused) {
      background.lineStyle(5, COLORS.copper, 1)
        .strokeRect(-options.width / 2 + 2, -options.height / 2 + 2, options.width - 9, options.height - 11);
    }
    glyph.setColor(Phaser.Display.Color.IntegerToColor(foreground).rgba);
    icon?.setAlpha(interactive ? 1 : 0.45);
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
    // DOM controls share these bounds. Their native click owns the gesture;
    // Phaser may observe the same pointer-up, but must not execute it twice.
    if (shouldPress && pointer.event?.target !== accessibilityButton) onPress(pointer);
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
      updateIcon(nextGlyph, nextLabel);
      label.setText(nextLabel);
      // Keep the unit/building name and its cost or queue status legible on
      // phones, instead of shrinking the entire label into one tiny line.
      if (options.compact && label.width > options.width - 16 && nextLabel.includes(" ")) {
        label.setText(nextLabel.replace(" ", "\n"));
      }
      glyph.setY(options.compact ? (label.text.includes("\n") ? -26 : -17) : -13);
      icon?.setY(glyph.y);
      // Costs and long queue names stay inside the button instead of wrapping
      // onto the hint strip; its accessible label retains the complete text.
      label.setScale(Math.min(1, (options.width - 16) / Math.max(1, label.width)));
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
      accessibilityButton.focus({ preventScroll: true });
      return true;
    },
    destroy(): void {
      if (destroyed) return;
      // Removing a focused proxy synchronously emits blur in Chromium. Mark
      // the control dead first so that blur cannot redraw destroyed Phaser
      // Text/Graphics objects during scene shutdown or restart.
      destroyed = true;
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, syncProxy);
      accessibilityButton.remove();
      container.destroy(true);
    },
  };
}
