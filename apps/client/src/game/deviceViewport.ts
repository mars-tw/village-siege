import Phaser from "phaser";

export interface DeviceViewportProfile {
  readonly touch: boolean;
  readonly coarsePointer: boolean;
  readonly mobileSized: boolean;
  readonly mobile: boolean;
  readonly landscape: boolean;
  readonly standalone: boolean;
  readonly width: number;
  readonly height: number;
}

export function getDeviceViewportProfile(): DeviceViewportProfile {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const touch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const mobileSized = Math.min(width, height) <= 900;
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return {
    touch,
    coarsePointer,
    mobileSized,
    mobile: (touch || coarsePointer) && mobileSized,
    landscape: width >= height,
    standalone,
    width,
    height,
  };
}

export function installDeviceViewportFit(game: Phaser.Game, host: HTMLElement): () => void {
  const root = document.documentElement;
  const apply = (): void => {
    const profile = getDeviceViewportProfile();
    root.classList.toggle("device-touch", profile.touch || profile.coarsePointer);
    root.classList.toggle("device-mobile", profile.mobile);
    root.classList.toggle("device-landscape", profile.landscape);
    root.classList.toggle("device-standalone", profile.standalone);
    root.style.setProperty("--game-viewport-width", `${profile.width}px`);
    root.style.setProperty("--game-viewport-height", `${profile.height}px`);
    host.style.width = `${profile.width}px`;
    host.style.height = `${profile.height}px`;
    window.requestAnimationFrame(() => game.scale.refresh());
  };

  const viewport = window.visualViewport;
  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", apply, { passive: true });
  viewport?.addEventListener("resize", apply, { passive: true });
  viewport?.addEventListener("scroll", apply, { passive: true });
  apply();

  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    viewport?.removeEventListener("resize", apply);
    viewport?.removeEventListener("scroll", apply);
    root.classList.remove("device-touch", "device-mobile", "device-landscape", "device-standalone", "game-expanded");
    root.style.removeProperty("--game-viewport-width");
    root.style.removeProperty("--game-viewport-height");
    host.style.removeProperty("width");
    host.style.removeProperty("height");
  };
}

export async function lockLandscapeOrientation(): Promise<boolean> {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: OrientationLockType) => Promise<void> };
  if (!orientation?.lock) return false;
  try {
    await orientation.lock("landscape");
    return true;
  } catch {
    return false;
  }
}
