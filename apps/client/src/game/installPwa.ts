import "./pwa.css";
import { publicAssetUrl } from "./publicAssetUrl";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface OfflineState {
  readonly type: string;
  readonly ready: boolean;
}

/** Register production-only caching and offer installation from the main menu. */
export function installPwa(isMainMenu: () => boolean): () => void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) return () => {};

  let disposed = false;
  let installPrompt: InstallPromptEvent | undefined;
  let ready = false;
  let failed = false;
  let updateWaiting = false;
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
  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.textContent = "安裝遊戲";
  installButton.hidden = true;
  toolbar.append(status, installButton);
  document.body.append(toolbar);

  const help = document.createElement("dialog");
  help.className = "pwa-install-help";
  const title = document.createElement("h2");
  title.textContent = "加入主畫面";
  const instructions = document.createElement("p");
  instructions.textContent = "在 Safari 開啟遊戲，點選分享按鈕，再選「加入主畫面」。離線下載完成後，就能從主畫面開始單人戰役。";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "知道了";
  close.addEventListener("click", () => help.close());
  help.append(title, instructions, close);
  document.body.append(help);

  function render(): void {
    if (disposed) return;
    toolbar.hidden = !isMainMenu();
    const label = updateWaiting
      ? "新版已備妥，關閉所有遊戲分頁後再開啟"
      : ready
        ? navigator.onLine ? "離線遊戲已備妥" : "離線中，可玩單人戰役"
        : failed ? "離線下載尚未完成" : "正在下載離線遊戲…";
    if (status.textContent !== label) status.textContent = label;
    installButton.hidden = installed || (!installPrompt && !ios);
    installButton.textContent = installPrompt ? "安裝遊戲" : "加入主畫面";
    // Never leave an installation dialog covering the battlefield.
    if (toolbar.hidden && help.open) help.close();
  }

  async function readOfflineState(worker: ServiceWorker | null): Promise<void> {
    if (!worker || disposed) return;
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      failed = true;
      render();
    }, 5_000);
    channel.port1.onmessage = (event: MessageEvent<OfflineState>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data.type !== "VILLAGE_SIEGE_OFFLINE_STATE") return;
      ready = event.data.ready === true;
      failed = !ready;
      render();
    };
    worker.postMessage({ type: "VILLAGE_SIEGE_OFFLINE_STATE" }, [channel.port2]);
  }

  const onBeforeInstall = (event: Event): void => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    render();
  };
  const onInstalled = (): void => {
    installed = true;
    installPrompt = undefined;
    render();
  };
  const onInstallClick = async (): Promise<void> => {
    const prompt = installPrompt;
    if (!prompt) { if (ios && !help.open) help.showModal(); return; }
    installButton.disabled = true;
    installPrompt = undefined;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") installed = true;
    } catch {
      // The browser may withdraw an installation prompt; keep the game usable.
    } finally {
      installButton.disabled = false;
      render();
    }
  };
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  installButton.addEventListener("click", onInstallClick);
  const menuPoll = window.setInterval(render, 600);
  render();

  const register = async (): Promise<void> => {
    if (disposed) return;
    try {
      const workerUrl = new URL(publicAssetUrl("sw.js"), document.baseURI);
      const registration = await navigator.serviceWorker.register(workerUrl.href, {
        scope: new URL(".", workerUrl).href,
        updateViaCache: "none",
      });
      if (disposed) return;
      updateWaiting = Boolean(registration.waiting);
      void readOfflineState(registration.active);
      const observeInstalling = (): void => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (disposed) return;
          if (worker.state === "installed") {
            updateWaiting = Boolean(registration.waiting && registration.active);
            render();
          } else if (worker.state === "activated") {
            void readOfflineState(worker);
          } else if (worker.state === "redundant") {
            failed = !ready;
            render();
          }
        });
      };
      registration.addEventListener("updatefound", observeInstalling);
      observeInstalling();
      // First installation activates without claiming or reloading this page.
      void navigator.serviceWorker.ready.then((active) => readOfflineState(active.active));
      render();
    } catch {
      failed = true;
      render();
    }
  };
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", register, { once: true });

  return () => {
    disposed = true;
    window.clearInterval(menuPoll);
    window.removeEventListener("load", register);
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
    window.removeEventListener("online", render);
    window.removeEventListener("offline", render);
    toolbar.remove();
    help.remove();
  };
}
