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
  readonly safeArea: DeviceSafeAreaInsets;
}

export interface DeviceSafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const ZERO_SAFE_AREA: DeviceSafeAreaInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
let measuredSafeArea: DeviceSafeAreaInsets = ZERO_SAFE_AREA;

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
    safeArea: measuredSafeArea,
  };
}

export function installDeviceViewportFit(game: Phaser.Game, host: HTMLElement): () => void {
  const root = document.documentElement;
  const safeAreaProbe = document.createElement("div");
  safeAreaProbe.setAttribute("aria-hidden", "true");
  safeAreaProbe.style.cssText = [
    "position:fixed",
    "inset:0 auto auto 0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top, 0px)",
    "padding-right:env(safe-area-inset-right, 0px)",
    "padding-bottom:env(safe-area-inset-bottom, 0px)",
    "padding-left:env(safe-area-inset-left, 0px)",
  ].join(";");
  document.body.append(safeAreaProbe);
  const apply = (): void => {
    measuredSafeArea = readSafeAreaInsets(safeAreaProbe);
    const profile = getDeviceViewportProfile();
    root.classList.toggle("device-touch", profile.touch || profile.coarsePointer);
    root.classList.toggle("device-mobile", profile.mobile);
    root.classList.toggle("device-landscape", profile.landscape);
    root.classList.toggle("device-standalone", profile.standalone);
    root.style.setProperty("--game-viewport-width", `${profile.width}px`);
    root.style.setProperty("--game-viewport-height", `${profile.height}px`);
    root.style.setProperty("--game-safe-top", `${profile.safeArea.top}px`);
    root.style.setProperty("--game-safe-right", `${profile.safeArea.right}px`);
    root.style.setProperty("--game-safe-bottom", `${profile.safeArea.bottom}px`);
    root.style.setProperty("--game-safe-left", `${profile.safeArea.left}px`);
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
    root.style.removeProperty("--game-safe-top");
    root.style.removeProperty("--game-safe-right");
    root.style.removeProperty("--game-safe-bottom");
    root.style.removeProperty("--game-safe-left");
    host.style.removeProperty("width");
    host.style.removeProperty("height");
    safeAreaProbe.remove();
    measuredSafeArea = ZERO_SAFE_AREA;
  };
}

function readSafeAreaInsets(probe: HTMLElement): DeviceSafeAreaInsets {
  const style = window.getComputedStyle(probe);
  const read = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return {
    top: read(style.paddingTop),
    right: read(style.paddingRight),
    bottom: read(style.paddingBottom),
    left: read(style.paddingLeft),
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
