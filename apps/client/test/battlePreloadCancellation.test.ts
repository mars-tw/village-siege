import { describe, expect, it, vi } from "vitest";
import { captureBattlePreload, type BattlePreloadFile } from "../src/game/battlePreloadCancellation.js";

const states = { processing: 14, complete: 17, pendingDestroy: 20 };

describe("battle preload cancellation", () => {
  it("captures file identities before loader Sets clear and resets callbacks before abort", () => {
    const calls: string[] = [];
    const xhr = { abort: () => calls.push("abort"), ontimeout: vi.fn(), onabort: vi.fn() };
    const file: BattlePreloadFile = { state: 11, xhrLoader: xhr, resetXHR: () => calls.push("reset") };
    const queued = new Set([file]);
    const attempt = captureBattlePreload(queued, states);
    queued.clear();
    expect(attempt.owns(file)).toBe(true);
    attempt.abort();
    expect(calls).toEqual(["reset", "abort"]);
    expect(xhr.ontimeout).toBeNull();
    expect(xhr.onabort).toBeNull();
    expect(attempt.owns(file)).toBe(false);
    attempt.abort();
    expect(calls).toHaveLength(2);
  });

  it("ignores canceled old callbacks even when a new file uses the same key", () => {
    const old = { state: 11, key: "warrior-e", resetXHR: vi.fn() };
    const next = { state: 11, key: "warrior-e", resetXHR: vi.fn() };
    const previous = captureBattlePreload([old], states);
    previous.abort();
    const current = captureBattlePreload([next], states);
    expect(previous.owns(old)).toBe(false);
    expect(current.owns(old)).toBe(false);
    expect(current.owns(next)).toBe(true);
  });

  it("clears pending image-decode callbacks and revokes their object URL", () => {
    const image = { src: "blob:pending-image", onload: vi.fn(), onerror: vi.fn(), removeAttribute: vi.fn() };
    const revoke = vi.fn();
    const file = { type: "image", state: states.processing, data: image, resetXHR: vi.fn() };
    captureBattlePreload([file], states, revoke).abort();
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:pending-image");
    expect(image.removeAttribute).toHaveBeenCalledExactlyOnceWith("src");
  });

  it.each([states.complete, states.pendingDestroy])("preserves cached texture image data in completed state %i", (state) => {
    const image = { src: "blob:cached-texture", onload: vi.fn(), onerror: vi.fn(), removeAttribute: vi.fn() };
    const xhr = { abort: vi.fn() };
    const file = { type: "image", state, data: image, xhrLoader: xhr, resetXHR: vi.fn() };
    const revoke = vi.fn();
    captureBattlePreload([file], states, revoke).abort();
    expect(file.resetXHR).not.toHaveBeenCalled();
    expect(xhr.abort).not.toHaveBeenCalled();
    expect(image.onload).not.toBeNull();
    expect(image.onerror).not.toBeNull();
    expect(image.src).toBe("blob:cached-texture");
    expect(image.removeAttribute).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("does not clear image data outside the processing phase or revoke ordinary URLs", () => {
    const loading = { src: "blob:not-processing", onload: vi.fn(), onerror: vi.fn() };
    const processing = { src: "https://game.example/asset.png", onload: vi.fn(), onerror: vi.fn(), removeAttribute: vi.fn() };
    const revoke = vi.fn();
    captureBattlePreload([
      { type: "image", state: 11, data: loading, resetXHR: vi.fn() },
      { type: "image", state: states.processing, data: processing, resetXHR: vi.fn() },
    ], states, revoke).abort();
    expect(loading.onload).not.toBeNull();
    expect(loading.src).toBe("blob:not-processing");
    expect(processing.onload).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });
});
