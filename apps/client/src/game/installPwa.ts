import "./pwa.css";
import { publicAssetUrl } from "./publicAssetUrl";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface OfflineState {
  readonly type: string;
  readonly ready: boolean;
  readonly appVersion?: string;
}

type DownloadState = "idle" | "downloading" | "cancelled" | "failed";

/** A prior release's complete cache is not proof that this release is offline. */
export function offlineStateMatchesVersion(state: unknown, appVersion: string): boolean {
  if (typeof state !== "object" || state === null) return false;
  const candidate = state as Record<string, unknown>;
  return candidate.type === "VILLAGE_SIEGE_OFFLINE_STATE"
    && candidate.ready === true && candidate.appVersion === appVersion;
}

/** Inspect existing offline data; a fresh visit never starts a full download. */
export function installPwa(isMainMenu: () => boolean): () => void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) return () => {};

  const appVersion = import.meta.env.VITE_APP_VERSION as string;
  const workerUrl = new URL(publicAssetUrl("sw.js"), document.baseURI);
  const scope = new URL(".", workerUrl).href;
  workerUrl.searchParams.set("offline", appVersion);
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let repairWorker: ServiceWorker | undefined;
  let installPrompt: InstallPromptEvent | undefined;
  let currentReady = false;
  let olderReady = false;
  let updateWaiting = false;
  let downloadState: DownloadState = "idle";
  let cancelRequested = false;
  let installed = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const toolbar = document.createElement("aside");
  toolbar.className = "pwa-tools";
  toolbar.hidden = true;
  toolbar.setAttribute("aria-label", "安裝與離線遊戲");
  const status = document.createElement("span");
  status.className = "pwa-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "pwa-download";
  downloadButton.title = "下載約 18 MB，完成後可離線玩單人戰役";
  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.className = "pwa-install";
  installButton.hidden = true;
  toolbar.append(status, downloadButton, installButton);
  document.body.append(toolbar);

  const help = document.createElement("dialog");
  help.className = "pwa-install-help";
  const title = document.createElement("h2");
  title.textContent = "加入主畫面";
  const instructions = document.createElement("p");
  instructions.textContent = "在 Safari 開啟遊戲，點選分享按鈕，再選「加入主畫面」。需要離線遊玩時，先在選單下載離線版。";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "知道了";
  close.addEventListener("click", () => help.close());
  help.append(title, instructions, close);
  document.body.append(help);

  function cancelDownload(): void {
    if (downloadState !== "downloading") return;
    cancelRequested = true;
    downloadState = "cancelled";
    registration?.installing?.postMessage({ type: "VILLAGE_SIEGE_CANCEL_INSTALL" });
    repairWorker?.postMessage({ type: "VILLAGE_SIEGE_CANCEL_INSTALL" });
  }

  function render(): void {
    if (disposed) return;
    const menu = isMainMenu();
    // Prefer the foreground match over an explicitly-started background download.
    if (!menu) cancelDownload();
    toolbar.hidden = !menu;
    const label = downloadState === "downloading" ? "離線下載中…"
      : updateWaiting ? "新版已下載，關閉分頁後啟用"
        : currentReady ? navigator.onLine ? "離線版已備妥" : "離線中，可玩單人戰役"
          : downloadState === "cancelled" ? "下載已取消"
            : downloadState === "failed" ? "下載未完成，可重試"
              : olderReady ? "已保留舊版離線遊戲" : "離線版尚未下載";
    if (status.textContent !== label) status.textContent = label;
    downloadButton.hidden = currentReady || updateWaiting;
    downloadButton.textContent = downloadState === "downloading" ? "取消下載" : "下載離線版";
    downloadButton.disabled = (downloadState !== "downloading" && !navigator.onLine)
      || (downloadState === "cancelled" && registration?.installing?.state === "installing");
    installButton.hidden = installed || (!installPrompt && !ios);
    installButton.textContent = installPrompt ? "安裝遊戲" : "加入主畫面";
    if (!menu && help.open) help.close();
  }

  function readOfflineState(worker: ServiceWorker | null): Promise<OfflineState | undefined> {
    if (!worker || disposed) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => { channel.port1.close(); resolve(undefined); }, 5_000);
      channel.port1.onmessage = (event: MessageEvent<OfflineState>) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data?.type === "VILLAGE_SIEGE_OFFLINE_STATE" ? event.data : undefined);
      };
      try {
        worker.postMessage({ type: "VILLAGE_SIEGE_OFFLINE_STATE" }, [channel.port2]);
      } catch {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(undefined);
      }
    });
  }

  async function refreshOfflineState(): Promise<void> {
    const observed = registration;
    if (!observed || disposed) return;
    const active = await readOfflineState(observed.active);
    const waiting = await readOfflineState(observed.waiting);
    if (disposed || registration !== observed) return;
    currentReady = offlineStateMatchesVersion(active, appVersion);
    olderReady = active?.ready === true && active.appVersion !== appVersion;
    updateWaiting = offlineStateMatchesVersion(waiting, appVersion);
    render();
  }

  const observedWorkers = new WeakSet<ServiceWorker>();
  function observeInstalling(): void {
    const worker = registration?.installing;
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    if (cancelRequested) worker.postMessage({ type: "VILLAGE_SIEGE_CANCEL_INSTALL" });
    worker.addEventListener("statechange", () => {
      if (disposed) return;
      if (worker.state === "installed" || worker.state === "activated") {
        downloadState = "idle";
        void refreshOfflineState();
      } else if (worker.state === "redundant") {
        if (downloadState === "downloading") downloadState = "failed";
        void refreshOfflineState();
      }
      render();
    });
  }

  const observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
  function observeRegistration(value: ServiceWorkerRegistration): void {
    registration = value;
    if (!observedRegistrations.has(value)) {
      observedRegistrations.add(value);
      value.addEventListener("updatefound", observeInstalling);
    }
    observeInstalling();
  }

  function repairCurrentCache(worker: ServiceWorker): Promise<boolean> {
    repairWorker = worker;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const finish = (ready: boolean): void => {
        window.clearTimeout(timeout);
        channel.port1.close();
        repairWorker = undefined;
        resolve(ready);
      };
      const timeout = window.setTimeout(() => {
        worker.postMessage({ type: "VILLAGE_SIEGE_CANCEL_INSTALL" });
        finish(false);
      }, 120_000);
      channel.port1.onmessage = (event: MessageEvent<OfflineState>) => {
        if (event.data?.type === "VILLAGE_SIEGE_REPAIR_RESULT") {
          finish(event.data.ready === true && event.data.appVersion === appVersion);
        }
      };
      try {
        worker.postMessage({ type: "VILLAGE_SIEGE_REPAIR_CACHE", appVersion }, [channel.port2]);
      } catch { finish(false); }
    });
  }

  async function startDownload(): Promise<void> {
    if (disposed || !isMainMenu() || !navigator.onLine || downloadState === "downloading") return;
    cancelRequested = false;
    downloadState = "downloading";
    render();
    try {
      const value = await navigator.serviceWorker.register(workerUrl.href, { scope, updateViaCache: "none" });
      if (disposed) return;
      observeRegistration(value);
      if (!isMainMenu()) cancelDownload();
      if (cancelRequested) value.installing?.postMessage({ type: "VILLAGE_SIEGE_CANCEL_INSTALL" });
      if (!value.installing) {
        const active = await readOfflineState(value.active);
        if (!cancelRequested && active?.appVersion === appVersion && active.ready !== true && value.active) {
          const repaired = await repairCurrentCache(value.active);
          if (!cancelRequested) downloadState = repaired ? "idle" : "failed";
        } else if (!cancelRequested) downloadState = "idle";
        await refreshOfflineState();
      }
    } catch {
      if (!cancelRequested) downloadState = "failed";
    }
    render();
  }

  // Read only: getRegistration does not install/update the current worker script.
  void navigator.serviceWorker.getRegistration(scope).then((value) => {
    if (!value || value.scope !== scope || disposed || registration) return;
    observeRegistration(value);
    void refreshOfflineState();
  }).catch(() => {});

  const onBeforeInstall = (event: Event): void => { event.preventDefault(); installPrompt = event as InstallPromptEvent; render(); };
  const onInstalled = (): void => { installed = true; installPrompt = undefined; render(); };
  const onDownloadClick = (): void => {
    if (downloadState === "downloading") { cancelDownload(); render(); }
    else void startDownload();
  };
  const onInstallClick = async (): Promise<void> => {
    const prompt = installPrompt;
    if (!prompt) { if (ios && !help.open) help.showModal(); return; }
    installButton.disabled = true;
    installPrompt = undefined;
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") installed = true;
    } catch { /* Browser may withdraw an installation prompt. */ }
    finally { installButton.disabled = false; render(); }
  };
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  downloadButton.addEventListener("click", onDownloadClick);
  installButton.addEventListener("click", onInstallClick);
  const menuPoll = window.setInterval(render, 400);
  render();

  return () => {
    cancelDownload();
    disposed = true;
    window.clearInterval(menuPoll);
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
    window.removeEventListener("online", render);
    window.removeEventListener("offline", render);
    toolbar.remove();
    help.remove();
  };
}
