import Phaser from "phaser";
import { getDeviceViewportProfile, lockLandscapeOrientation } from "./deviceViewport";

export type FullscreenRequestResult = "entered" | "exited" | "expanded";
export const GAME_FULLSCREEN_FALLBACK_EVENT = "game-fullscreen-fallback";

export function fullscreenButtonLabel(scene: Phaser.Scene): { glyph: string; label: string } {
  if (scene.scale.isFullscreen || document.documentElement.classList.contains("game-expanded")) {
    return { glyph: "↙", label: "縮小" };
  }
  if (scene.sys.game.device.fullscreen.available) return { glyph: "⛶", label: "全螢幕" };
  return { glyph: "↗", label: "滿版" };
}

export function toggleGameFullscreen(scene: Phaser.Scene): FullscreenRequestResult {
  if (scene.scale.isFullscreen) {
    document.documentElement.classList.remove("game-expanded");
    scene.scale.stopFullscreen();
    return "exited";
  }
  if (document.documentElement.classList.contains("game-expanded")) {
    document.documentElement.classList.remove("game-expanded");
    scene.scale.refresh();
    return "exited";
  }

  const profile = getDeviceViewportProfile();
  if (scene.sys.game.device.fullscreen.available) {
    let settled = false;
    const cleanup = (): void => {
      scene.scale.off(Phaser.Scale.Events.FULLSCREEN_FAILED, fallback);
      scene.scale.off(Phaser.Scale.Events.FULLSCREEN_UNSUPPORTED, fallback);
      document.removeEventListener("fullscreenerror", fallback);
    };
    const fallback = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      applyExpandedViewport(scene, profile.mobile);
      scene.events.emit(GAME_FULLSCREEN_FALLBACK_EVENT);
    };
    scene.scale.once(Phaser.Scale.Events.FULLSCREEN_FAILED, fallback);
    scene.scale.once(Phaser.Scale.Events.FULLSCREEN_UNSUPPORTED, fallback);
    document.addEventListener("fullscreenerror", fallback, { once: true });
    scene.scale.once(Phaser.Scale.Events.ENTER_FULLSCREEN, () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (profile.mobile) void lockLandscapeOrientation();
      scene.scale.refresh();
    });
    try {
      scene.scale.startFullscreen({ navigationUI: "hide" });
    } catch {
      fallback();
      return "expanded";
    }
    return "entered";
  }

  applyExpandedViewport(scene, profile.mobile);
  return "expanded";
}

function applyExpandedViewport(scene: Phaser.Scene, mobile: boolean): void {
  document.documentElement.classList.add("game-expanded");
  if (mobile) void lockLandscapeOrientation();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  scene.scale.refresh();
}
