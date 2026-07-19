import Phaser from "phaser";
import { getDeviceViewportProfile, lockLandscapeOrientation } from "./deviceViewport";

export type FullscreenRequestResult = "entered" | "exited" | "expanded";

export function fullscreenButtonLabel(scene: Phaser.Scene): { glyph: string; label: string } {
  if (scene.scale.isFullscreen) return { glyph: "↙", label: "縮小" };
  if (scene.sys.game.device.fullscreen.available) return { glyph: "⛶", label: "全螢幕" };
  return { glyph: "↗", label: "滿版" };
}

export function toggleGameFullscreen(scene: Phaser.Scene): FullscreenRequestResult {
  if (scene.scale.isFullscreen) {
    scene.scale.stopFullscreen();
    return "exited";
  }

  document.documentElement.classList.add("game-expanded");
  const profile = getDeviceViewportProfile();
  if (scene.sys.game.device.fullscreen.available) {
    scene.scale.once(Phaser.Scale.Events.ENTER_FULLSCREEN, () => {
      if (profile.mobile) void lockLandscapeOrientation();
      scene.scale.refresh();
    });
    scene.scale.startFullscreen({ navigationUI: "hide" });
    return "entered";
  }

  if (profile.mobile) void lockLandscapeOrientation();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  scene.scale.refresh();
  return "expanded";
}
