export interface BattlePreloadFile {
  readonly state: number;
  readonly type?: string;
  readonly data?: unknown;
  readonly xhrLoader?: { abort(): void; ontimeout?: unknown; onabort?: unknown } | null;
  resetXHR(): void;
}

export interface BattlePreloadFileStates {
  readonly processing: number;
  readonly complete: number;
  readonly pendingDestroy: number;
}

export interface BattlePreloadAttempt {
  owns(file: unknown): boolean;
  abort(): void;
}

/** Capture identities before Phaser shutdown clears its Sets without aborting XHRs. */
export function captureBattlePreload(
  queued: Iterable<BattlePreloadFile>,
  states: BattlePreloadFileStates,
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url),
): BattlePreloadAttempt {
  const files = new Set(queued);
  let current = true;
  return {
    owns: (file) => current && files.has(file as BattlePreloadFile),
    abort: () => {
      if (!current) return;
      current = false;
      for (const file of files) {
        // These image elements already belong to textures and must stay intact.
        if (file.state === states.complete || file.state === states.pendingDestroy) continue;
        const xhr = file.xhrLoader;
        file.resetXHR();
        if (xhr) {
          // Phaser resetXHR omits timeout/abort callbacks.
          xhr.ontimeout = null;
          xhr.onabort = null;
          xhr.abort();
        }
        if (file.state === states.processing && file.type === "image" && file.data && typeof file.data === "object") {
          const image = file.data as { src?: string; onload?: unknown; onerror?: unknown; removeAttribute?: (name: string) => void };
          image.onload = null;
          image.onerror = null;
          if (typeof image.src === "string" && image.src.startsWith("blob:")) revokeObjectURL(image.src);
          if (image.removeAttribute) image.removeAttribute("src");
          else image.src = "";
        }
      }
      files.clear();
    },
  };
}
