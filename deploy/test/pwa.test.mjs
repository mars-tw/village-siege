import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerTemplate = await readFile(new URL("../../apps/client/public/sw.js", import.meta.url), "utf8");
const precache = ["index.html", "play.html", "assets/main-123.js", "assets/world.png", "manifest.webmanifest"];
const cachedBody = (url) => url.endsWith(".html") ? "cached generation" : "cached art";
const digest = (content) => `sha256-${createHash("sha256").update(content).digest("base64")}`;
const integrity = Object.fromEntries(precache.map((path) => [path, digest(cachedBody(path))]));

function workerHarness({ scope = "https://game.example/village-siege/", online = true, failDownload = false, tamperDownload = false, requestVersion = "0.21.1", holdDownload = false } = {}) {
  const listeners = new Map();
  const storage = new Map();
  const deleted = [];
  const requests = [];
  let skippedWaiting = false;
  let claimed = false;
  let shouldFailDownload = failDownload;
  let resolveStarted;
  const downloadStarted = new Promise((resolve) => { resolveStarted = resolve; });
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map());
      const entries = storage.get(name);
      return {
        async addAll(items) {
          if (items.some((request) => request.signal.aborted)) throw new Error("Download aborted");
          if (holdDownload) {
            const request = items[0];
            requests.push(request);
            resolveStarted();
            await new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("Download aborted")), { once: true }));
            return;
          }
          for (const item of items) {
            requests.push(item);
            const body = tamperDownload ? "mixed deployment generation" : cachedBody(item.url);
            if (item.integrity !== digest(body)) throw new TypeError("Fetch integrity mismatch");
            entries.set(item.url, new Response(body));
            if (shouldFailDownload) throw new TypeError("Partial download failure");
          }
        },
        async match(url) { return entries.get(typeof url === "string" ? url : url.url)?.clone(); },
        async keys() { return [...entries.keys()].map((url) => new Request(url)); },
      };
    },
    async keys() { return [...storage.keys()]; },
    async delete(name) { deleted.push(name); return storage.delete(name); },
  };
  vm.runInNewContext(workerTemplate
    .replace("__VILLAGE_SIEGE_BUILD_VERSION__", "test-revision")
    .replace("__VILLAGE_SIEGE_APP_VERSION__", "0.21.1")
    .replace('["__VILLAGE_SIEGE_PRECACHE__"]', JSON.stringify(precache))
    .replace('{"__VILLAGE_SIEGE_INTEGRITY__": ""}', JSON.stringify(integrity)), {
    self: {
      registration: { scope },
      location: { href: `${scope}sw.js${requestVersion === null ? "" : `?offline=${requestVersion}`}` },
      addEventListener(type, listener) { listeners.set(type, listener); },
      skipWaiting() { skippedWaiting = true; },
      clients: { claim() { claimed = true; } },
    },
    URL, Request, Response, Set, Promise, AbortController, caches,
    fetch: async (request) => {
      requests.push(request);
      if (!online) throw new TypeError("Offline");
      return new Response("new network generation");
    },
  });
  async function lifecycle(type) {
    let work;
    listeners.get(type)({ waitUntil(promise) { work = promise; } });
    await work;
  }
  function route(url, { method = "GET", mode = "cors" } = {}) {
    let response;
    const request = mode === "navigate" ? { url, method, mode } : new Request(url, { method });
    listeners.get("fetch")({ request, respondWith(promise) { response = promise; } });
    return response;
  }
  return {
    scope, storage, requests, deleted, lifecycle, route,
    downloadStarted,
    failFutureDownload() { shouldFailDownload = true; },
    cancelInstall() { listeners.get("message")({ data: { type: "VILLAGE_SIEGE_CANCEL_INSTALL" } }); },
    async repair(appVersion = "0.21.1") {
      let work;
      let result;
      listeners.get("message")({
        data: { type: "VILLAGE_SIEGE_REPAIR_CACHE", appVersion },
        ports: [{ postMessage(value) { result = value; } }],
        waitUntil(promise) { work = promise; },
      });
      await work;
      return result;
    },
    get interrupted() { return skippedWaiting || claimed; },
    async state() {
      let work;
      let state;
      listeners.get("message")({
        data: { type: "VILLAGE_SIEGE_OFFLINE_STATE" },
        ports: [{ postMessage(value) { state = value; } }],
        waitUntil(promise) { work = promise; },
      });
      await work;
      return state;
    },
  };
}

test("PWA manifest and icon URLs remain under a GitHub Pages base", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../apps/client/public/manifest.webmanifest", import.meta.url), "utf8"));
  const root = "https://game.example/village-siege/";
  assert.equal(new URL(manifest.start_url, root).href, `${root}play.html`);
  assert.equal(new URL(manifest.scope, root).href, root);
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "512x512"]);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png");
    assert.ok(new URL(icon.src, root).href.startsWith(root));
  }
});

test("worker precaches only base-scoped files and never interrupts active games", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.equal(worker.interrupted, false);
  assert.deepEqual(worker.requests.map((request) => request.url), precache.map((url) => worker.scope + url));
  assert.ok(worker.requests.every((request) => request.cache === "reload"));
  assert.ok(worker.requests.every((request) => request.integrity.startsWith("sha256-")));
  assert.equal((await worker.state()).ready, true);
  assert.equal((await worker.state()).appVersion, "0.21.1");
});

test("browser soft updates without the current explicit download token never start a full cache", async () => {
  for (const requestVersion of [null, "0.21.0"]) {
    const worker = workerHarness({ requestVersion });
    const old = `village-siege:${encodeURIComponent(worker.scope)}:old`;
    worker.storage.set(old, new Map());
    await assert.rejects(worker.lifecycle("install"), /explicit request/);
    assert.equal(worker.requests.length, 0);
    assert.deepEqual([...worker.storage.keys()], [old]);
  }
});

test("cancelling an installing worker aborts its requests and preserves an old active cache", async () => {
  const worker = workerHarness({ holdDownload: true });
  const old = `village-siege:${encodeURIComponent(worker.scope)}:old`;
  worker.storage.set(old, new Map());
  const install = worker.lifecycle("install");
  await worker.downloadStarted;
  worker.cancelInstall();
  await assert.rejects(install, /Download aborted/);
  assert.equal(worker.requests[0].signal.aborted, true);
  assert.deepEqual([...worker.storage.keys()], [old]);
});

test("a cancel received before installation begins also prevents the complete download", async () => {
  const worker = workerHarness();
  worker.cancelInstall();
  await assert.rejects(worker.lifecycle("install"), /Download aborted/);
  assert.equal(worker.requests.length, 0);
});

test("an explicit current-version repair restores an incomplete active cache", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  worker.storage.values().next().value.delete(worker.scope + "play.html");
  assert.equal((await worker.state()).ready, false);
  assert.equal((await worker.repair()).ready, true);
  assert.equal((await worker.state()).ready, true);
});

test("a repair for a different release never changes stored offline bytes", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  const requests = worker.requests.length;
  assert.equal((await worker.repair("0.21.0")).ready, false);
  assert.equal(worker.requests.length, requests);
  assert.equal((await worker.state()).ready, true);
});

test("failed repair retains an active cache's remaining offline resources", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  const cache = worker.storage.values().next().value;
  cache.delete(worker.scope + "play.html");
  const before = [...cache.keys()];
  worker.failFutureDownload();
  assert.equal((await worker.repair()).ready, false);
  assert.deepEqual([...cache.keys()], before);
  assert.equal(worker.deleted.length, 0);
});

test("offline-ready stays false when the complete download is absent", async () => {
  const worker = workerHarness();
  assert.equal((await worker.state()).ready, false);
  await worker.lifecycle("install");
  worker.storage.values().next().value.delete(worker.scope + "assets/world.png");
  assert.equal((await worker.state()).ready, false);
});

test("failed download removes its partial cache while preserving a working old version", async () => {
  const worker = workerHarness({ failDownload: true });
  const old = `village-siege:${encodeURIComponent(worker.scope)}:old`;
  worker.storage.set(old, new Map());
  await assert.rejects(worker.lifecycle("install"), /Partial download failure/);
  assert.deepEqual([...worker.storage.keys()], [old]);
});

test("mixed deployment bytes fail pinned integrity and cannot replace a working cache", async () => {
  const worker = workerHarness({ tamperDownload: true });
  const old = `village-siege:${encodeURIComponent(worker.scope)}:old`;
  worker.storage.set(old, new Map());
  await assert.rejects(worker.lifecycle("install"), /Fetch integrity mismatch/);
  assert.deepEqual([...worker.storage.keys()], [old]);
});

test("offline navigation uses the shell paired with its precached code", async () => {
  const worker = workerHarness({ online: false });
  await worker.lifecycle("install");
  assert.equal(await (await worker.route(worker.scope, { mode: "navigate" })).text(), "cached generation");
  assert.equal(await (await worker.route(worker.scope + "index.html?campaign=1", { mode: "navigate" })).text(), "cached generation");
  assert.equal(await (await worker.route(worker.scope + "play.html?entry=fresh", { mode: "navigate" })).text(), "cached generation");
  assert.equal(await (await worker.route(worker.scope + "assets/world.png")).text(), "cached art");
});

test("online refresh cannot overwrite a running worker's shell with newer code", async () => {
  const worker = workerHarness();
  await worker.lifecycle("install");
  const before = worker.requests.length;
  assert.equal(await (await worker.route(worker.scope, { mode: "navigate" })).text(), "cached generation");
  assert.equal(worker.requests.length, before);
});

test("live runtime config is fetched without caching and disables multiplayer offline", async () => {
  const worker = workerHarness({ online: false });
  await worker.lifecycle("install");
  const before = worker.storage.values().next().value.size;
  const response = await worker.route(worker.scope + "runtime-config.js?deployment=current");
  const body = await response.text();
  assert.match(body, /multiplayerEnabled: "false"/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(worker.requests.at(-1).cache, "no-store");
  assert.equal(worker.storage.values().next().value.size, before);
});

test("API, multiplayer, non-GET, foreign and sibling-app requests bypass caching", () => {
  const worker = workerHarness();
  for (const url of [
    worker.scope + "api/matches", worker.scope + "health", worker.scope + "_health",
    worker.scope + "assets/unknown.png", worker.scope + "assets/world.png?live=1",
    "https://server.example/matches", "https://game.example/another-app/index.html",
    "https://game.example/village-siege-extra/assets/world.png",
  ]) assert.equal(worker.route(url), undefined, url);
  assert.equal(worker.route(worker.scope + "assets/world.png", { method: "POST" }), undefined);
  assert.equal(worker.route(worker.scope + "admin", { mode: "navigate" }), undefined);
});

test("cache cleanup affects only older versions of this exact app scope", async () => {
  const worker = workerHarness();
  const ownPrefix = `village-siege:${encodeURIComponent(worker.scope)}:`;
  worker.storage.set(ownPrefix + "old", new Map());
  worker.storage.set("another-app:old", new Map());
  worker.storage.set(`village-siege:${encodeURIComponent("https://game.example/other/")}:old`, new Map());
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.deepEqual(worker.deleted, [ownPrefix + "old"]);
  assert.equal(worker.storage.size, 3);
});
