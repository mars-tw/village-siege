import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const startupSource = readFileSync(new URL("../public/startup.js", import.meta.url), "utf8");

function startupHarness(rawBase = "/village-siege/", options: { rejectRepair?: boolean } = {}) {
  const ids = ["startup-status", "startup-title", "startup-message", "startup-detail", "startup-controls", "startup-retry", "startup-repair", "startup-repair-note"];
  const elements = new Map(ids.map(id => [id, {
    hidden: id !== "startup-status", disabled: false, textContent: "",
    listeners: new Map<string, () => void>(),
    addEventListener(type: string, handler: () => void) { this.listeners.set(type, handler); },
  }]));
  const handlers = new Map<string, ((event?: unknown) => void)[]>();
  const timers = new Map<number, { callback: () => void; milliseconds: number }>();
  let timerId = 0;
  const reload = vi.fn();
  const replace = vi.fn();
  const ownUnregister = vi.fn(() => Promise.resolve(true));
  const otherUnregister = vi.fn(() => Promise.resolve(true));
  const foreignUnregister = vi.fn(() => Promise.resolve(true));
  const gamePrefix = `village-siege:${encodeURIComponent("https://example.test/village-siege/")}:`;
  const cacheDelete = vi.fn(() => Promise.resolve(true));
  const getRegistrations = vi.fn(() => options.rejectRepair ? Promise.reject(new Error("Storage access denied")) : Promise.resolve([
    { scope: "https://example.test/village-siege/", unregister: ownUnregister },
    { scope: "https://example.test/another-game/", unregister: otherUnregister },
    { scope: "https://foreign.test/village-siege/", unregister: foreignUnregister },
  ]));
  const location = { href: "https://example.test/village-siege/index.html", origin: "https://example.test", reload, replace };
  const localStorageClear = vi.fn();
  const indexedDbDelete = vi.fn();
  const window = {
    location,
    caches: {
      keys: vi.fn(() => Promise.resolve([`${gamePrefix}old`, `village-siege:${encodeURIComponent("https://example.test/another-game/")}:old`, "account-data"])),
      delete: cacheDelete,
    },
    localStorage: { clear: localStorageClear },
    indexedDB: { deleteDatabase: indexedDbDelete },
    setTimeout(callback: () => void, milliseconds: number) { timers.set(++timerId, { callback, milliseconds }); return timerId; },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener(type: string, handler: (event?: unknown) => void) { handlers.set(type, [...(handlers.get(type) ?? []), handler]); },
  };
  runInNewContext(startupSource, {
    document: { currentScript: { getAttribute: () => rawBase }, getElementById: (id: string) => elements.get(id) },
    window, navigator: { serviceWorker: { getRegistrations } }, URL, Promise, Error, encodeURIComponent,
  });
  return {
    element: (id: string) => elements.get(id)!,
    emit(type: string, event?: unknown) { handlers.get(type)?.forEach(handler => handler(event)); },
    click(id: string) { elements.get(id)!.listeners.get("click")!(); },
    timeout(milliseconds: number) { [...timers.values()].filter(timer => timer.milliseconds === milliseconds).forEach(timer => timer.callback()); },
    flush: () => new Promise<void>(resolve => setImmediate(resolve)),
    timers, ownUnregister, otherUnregister, foreignUnregister, cacheDelete, reload, replace, gamePrefix, getRegistrations,
    localStorageClear, indexedDbDelete,
  };
}

describe("static startup recovery", () => {
  it("shows a loading message after fifteen seconds and still accepts eventual readiness", () => {
    const page = startupHarness();
    page.timeout(15_000);
    expect(page.element("startup-title").textContent).toBe("遊戲仍在載入");
    expect(page.element("startup-detail").hidden).toBe(true);
    expect(page.element("startup-controls").hidden).toBe(false);
    page.emit("village-siege-ready");
    expect(page.element("startup-status").hidden).toBe(true);
    expect(page.timers.size).toBe(0);
    page.emit("error", { message: "later battle exception" });
    expect(page.element("startup-status").hidden).toBe(true);
  });

  it("keeps a boot failure visible instead of changing it to a false loading status", () => {
    const page = startupHarness();
    page.emit("error", { target: { tagName: "SCRIPT" } });
    page.timeout(15_000);
    expect(page.element("startup-title").textContent).toBe("遊戲沒有完成啟動");
    expect(page.element("startup-detail").textContent).toContain("遊戲程式下載失敗");
    expect(page.element("startup-controls").hidden).toBe(false);
    expect(page.getRegistrations).not.toHaveBeenCalled();
    expect(page.cacheDelete).not.toHaveBeenCalled();
  });

  it("retry only reloads the current page and does not remove storage", () => {
    const page = startupHarness();
    page.click("startup-retry");
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(page.getRegistrations).not.toHaveBeenCalled();
    expect(page.cacheDelete).not.toHaveBeenCalled();
    expect(page.localStorageClear).not.toHaveBeenCalled();
    expect(page.indexedDbDelete).not.toHaveBeenCalled();
  });

  it("repairs only the exact game scope and cache prefix after an explicit click", async () => {
    const page = startupHarness();
    page.click("startup-repair");
    page.click("startup-repair");
    await page.flush();
    expect(page.ownUnregister).toHaveBeenCalledTimes(1);
    expect(page.otherUnregister).not.toHaveBeenCalled();
    expect(page.foreignUnregister).not.toHaveBeenCalled();
    expect(page.cacheDelete).toHaveBeenCalledExactlyOnceWith(`${page.gamePrefix}old`);
    expect(page.localStorageClear).not.toHaveBeenCalled();
    expect(page.indexedDbDelete).not.toHaveBeenCalled();
    expect(page.replace).toHaveBeenCalledExactlyOnceWith("https://example.test/village-siege/play.html");
  });

  it("never follows a cross-origin base or lets it remove registrations", async () => {
    const page = startupHarness("https://untrusted.test/");
    expect(page.element("startup-repair").disabled).toBe(true);
    page.click("startup-repair");
    await page.flush();
    expect(page.replace).not.toHaveBeenCalled();
    expect(page.getRegistrations).not.toHaveBeenCalled();
    expect(page.cacheDelete).not.toHaveBeenCalled();
  });

  it("shows a repair error without navigating or deleting user saves", async () => {
    const page = startupHarness("/village-siege/", { rejectRepair: true });
    page.click("startup-repair");
    await page.flush();
    expect(page.element("startup-title").textContent).toBe("修復沒有完成");
    expect(page.element("startup-detail").textContent).toBe("Storage access denied");
    expect(page.element("startup-repair").disabled).toBe(false);
    expect(page.replace).not.toHaveBeenCalled();
    expect(page.localStorageClear).not.toHaveBeenCalled();
    expect(page.indexedDbDelete).not.toHaveBeenCalled();
  });
});
