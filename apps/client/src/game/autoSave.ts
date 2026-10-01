import { parseMatchSaveFile, serializeMatchSaveFile } from "@village-siege/shared";

export interface AutoSaveEntry {
  readonly saveJson: string;
  readonly savedAt: number;
  readonly matchId: string;
  readonly seed: number;
  readonly tick: number;
  readonly finished: boolean;
}
export interface AutoSaveSlots { readonly latest: AutoSaveEntry | null; readonly previous: AutoSaveEntry | null }
export interface AutoSaveAdapter {
  load(): Promise<AutoSaveSlots>;
  commit(slots: AutoSaveSlots): Promise<void>;
}
export type AutoSaveResult = { readonly ok: true; readonly entry: AutoSaveEntry } | { readonly ok: false; readonly message: string };
export type AutoSaveReadResult = ({ readonly ok: true; readonly warning?: string } & AutoSaveSlots) | { readonly ok: false; readonly message: string };

/** Storage errors stay outside gameplay; callers can present the returned status. */
export function createAutoSaveStore(adapter: AutoSaveAdapter, now: () => number = Date.now) {
  let writes = Promise.resolve();
  const entryFromJson = (saveJson: string, savedAt: number): AutoSaveEntry => {
    const save = parseMatchSaveFile(saveJson);
    return {
      saveJson: serializeMatchSaveFile(save), savedAt, matchId: save.snapshot.state.matchId,
      seed: save.snapshot.state.seed, tick: save.snapshot.tick, finished: save.snapshot.state.phase === "finished",
    };
  };
  const validateStored = (entry: AutoSaveEntry | null): AutoSaveEntry | null => {
    if (!entry) return null;
    if (typeof entry.saveJson !== "string" || !Number.isFinite(entry.savedAt)) throw new Error("Invalid autosave slot");
    return entryFromJson(entry.saveJson, entry.savedAt);
  };
  const failure = (message: string) => ({ ok: false as const, message });
  return {
    async save(saveJson: string): Promise<AutoSaveResult> {
      let entry: AutoSaveEntry;
      try { entry = entryFromJson(saveJson, now()); }
      catch { return failure("自動存檔未完成：戰局資料驗證失敗。請手動匯出存檔。"); }
      const operation = writes.then(async (): Promise<AutoSaveResult> => {
        try {
          const stored = await adapter.load();
          let latest: AutoSaveEntry | null = null;
          let previous: AutoSaveEntry | null = null;
          try { latest = validateStored(stored.latest); } catch { /* Replace corrupt bytes with a validated checkpoint. */ }
          try { previous = validateStored(stored.previous); } catch { /* A damaged backup must not block the current match. */ }
          if (!latest) { latest = previous; previous = null; }
          const sameMatch = latest?.matchId === entry.matchId && latest.seed === entry.seed;
          if (sameMatch && latest && latest.tick > entry.tick) return failure("已保留較新的自動存檔。");
          await adapter.commit({ latest: entry, previous: latest && !sameMatch ? latest : previous });
          return { ok: true, entry };
        } catch { return failure("瀏覽器無法儲存戰局。遊戲可繼續，請從系統手動匯出存檔。"); }
      });
      writes = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async read(): Promise<AutoSaveReadResult> {
      await writes;
      try {
        const stored = await adapter.load();
        let previous: AutoSaveEntry | null = null;
        try { previous = validateStored(stored.previous); } catch { /* Keep a valid latest slot usable. */ }
        try { return { ok: true, latest: validateStored(stored.latest), previous }; }
        catch {
          if (previous) return { ok: true, latest: previous, previous: null, warning: "上次存檔無法讀取，已保留前一場備份供繼續遊玩。" };
          return failure("上次自動存檔無法讀取。你仍可開始新戰役或匯入手動存檔。");
        }
      } catch { return failure("瀏覽器未開放自動存檔。你仍可正常遊玩，並從系統手動匯出存檔。"); }
    },
  };
}

export function createIndexedDbAutoSaveAdapter(scope: string): AutoSaveAdapter {
  let database: Promise<IDBDatabase> | undefined;
  function open(): Promise<IDBDatabase> {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB is unavailable")); return; }
      const request = indexedDB.open(`village-siege:autosave:${scope}`, 1);
      let unavailable = false;
      const timeout = setTimeout(() => { unavailable = true; database = undefined; reject(new Error("Autosave storage timed out")); }, 5_000);
      request.onupgradeneeded = () => request.result.createObjectStore("slots");
      request.onsuccess = () => {
        clearTimeout(timeout);
        const value = request.result;
        if (unavailable) { value.close(); return; }
        value.onversionchange = () => { value.close(); database = undefined; };
        resolve(value);
      };
      request.onerror = () => { clearTimeout(timeout); database = undefined; reject(request.error); };
      request.onblocked = () => { clearTimeout(timeout); unavailable = true; database = undefined; reject(new Error("Autosave storage is blocked")); };
    });
    return database;
  }
  return {
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("slots", "readonly");
        const store = transaction.objectStore("slots");
        const latest = store.get("latest");
        const previous = store.get("previous");
        transaction.oncomplete = () => resolve({ latest: latest.result ?? null, previous: previous.result ?? null });
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
    async commit(slots) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("slots", "readwrite");
        const store = transaction.objectStore("slots");
        store.put(slots.latest, "latest");
        store.put(slots.previous, "previous");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
  };
}

let browserStore: ReturnType<typeof createAutoSaveStore> | undefined;
function store() {
  if (!browserStore) {
    const scope = typeof document === "undefined" ? "unavailable" : new URL(import.meta.env.BASE_URL, document.baseURI).href;
    browserStore = createAutoSaveStore(createIndexedDbAutoSaveAdapter(scope));
  }
  return browserStore;
}
export const saveAutoSave = (saveJson: string): Promise<AutoSaveResult> => store().save(saveJson);
export const readAutoSave = (): Promise<AutoSaveReadResult> => store().read();
