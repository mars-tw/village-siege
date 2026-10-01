import "./battleLoading.css";

export interface BattleLoadingView {
  update(progress: number): void;
  fail(message: string): void;
  destroy(): void;
}

/** DOM feedback remains usable while the canvas and textures are loading. */
export function createBattleLoading(host: HTMLElement, onRetry: () => void, onBack: () => void): BattleLoadingView {
  const root = document.createElement("section");
  root.className = "battle-loading";
  root.setAttribute("aria-label", "戰場載入");
  root.innerHTML = `<div class="battle-loading-panel"><p class="battle-loading-kicker">村莊攻防</p><h1>準備戰場</h1><p data-loading-message role="status" aria-live="polite">正在下載角色與建築素材。首次開啟可能需要一些時間。</p><progress max="1" value="0" aria-label="戰場素材載入進度"></progress><output data-loading-percent>0%</output><div class="battle-loading-actions"><button type="button" data-loading-retry hidden>重新載入</button><button type="button" data-loading-back>返回主選單</button></div></div>`;
  const message = root.querySelector<HTMLElement>("[data-loading-message]")!;
  const progressBar = root.querySelector<HTMLProgressElement>("progress")!;
  const percent = root.querySelector<HTMLOutputElement>("output")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-loading-retry]")!;
  retry.addEventListener("click", onRetry);
  root.querySelector("[data-loading-back]")!.addEventListener("click", onBack);
  host.append(root);
  let destroyed = false;
  let failed = false;
  const slowTimer = window.setTimeout(() => {
    if (destroyed || failed) return;
    message.textContent = "下載比平常慢。你可以繼續等候，或重新載入；也能先返回主選單。";
    retry.hidden = false;
  }, 15_000);
  return {
    update(value) {
      if (destroyed || failed) return;
      const ratio = Math.max(0, Math.min(1, value));
      progressBar.value = ratio;
      percent.textContent = `${Math.round(ratio * 100)}%`;
    },
    fail(detail) {
      if (destroyed) return;
      failed = true;
      window.clearTimeout(slowTimer);
      root.querySelector("h1")!.textContent = "戰場尚未載入";
      message.textContent = detail;
      retry.hidden = false;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(slowTimer);
      root.remove();
    },
  };
}
