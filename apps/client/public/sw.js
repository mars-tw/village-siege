/* Build replaces these markers with a content revision and exact runtime file list. */
const BUILD_VERSION = "__VILLAGE_SIEGE_BUILD_VERSION__";
const PRECACHE_PATHS = ["__VILLAGE_SIEGE_PRECACHE__"];
const PRECACHE_INTEGRITY = {"__VILLAGE_SIEGE_INTEGRITY__": ""};
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = `village-siege:${encodeURIComponent(SCOPE_URL.href)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;
const SHELL_URL = new URL("index.html", SCOPE_URL).href;
const CONFIG_PATH = new URL("runtime-config.js", SCOPE_URL).pathname;
const PRECACHE_URLS = PRECACHE_PATHS.map((path) => new URL(path, SCOPE_URL).href);
const STATIC_URLS = new Set(PRECACHE_URLS);

self.addEventListener("install", (event) => {
  // Dev serves the source template. Never register a half-configured worker.
  if (BUILD_VERSION.startsWith("__")) {
    event.waitUntil(Promise.reject(new Error("Service worker requires a production build")));
    return;
  }
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // A complete generation is cached before it can serve any offline game.
      await cache.addAll(PRECACHE_PATHS.map((path) => new Request(new URL(path, SCOPE_URL).href, {
        cache: "reload",
        integrity: PRECACHE_INTEGRITY[path],
      })));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
  // Deliberately no skipWaiting: an ongoing match keeps its code and art version.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
  })());
  // Deliberately no clients.claim: never change an already-open game underneath it.
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== SCOPE_URL.origin
      || !url.pathname.startsWith(SCOPE_URL.pathname)) return;

  if (url.pathname === CONFIG_PATH) {
    // Deployment endpoints are live configuration, never part of the offline cache.
    event.respondWith(fetch(new Request(request, { cache: "no-store" })).catch(() => new Response(
      'globalThis.__VILLAGE_SIEGE_RUNTIME_CONFIG__ = Object.freeze({ multiplayerEnabled: "false" });',
      { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } },
    )));
    return;
  }

  if (request.mode === "navigate") {
    if (url.pathname !== SCOPE_URL.pathname && url.href.split("?")[0] !== SHELL_URL) return;
    // Keep the shell paired with this worker's exact precached JS/CSS generation.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(SHELL_URL) ?? fetch(request);
    })());
    return;
  }

  // No arbitrary runtime caches: API, health, multiplayer and foreign URLs bypass us.
  if (url.search || !STATIC_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(url.href) ?? fetch(request);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "VILLAGE_SIEGE_OFFLINE_STATE") return;
  const port = event.ports?.[0];
  if (!port) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const stored = new Set((await cache.keys()).map((request) => request.url));
    port.postMessage({
      type: "VILLAGE_SIEGE_OFFLINE_STATE",
      ready: PRECACHE_URLS.every((url) => stored.has(url)),
      version: BUILD_VERSION,
      assets: PRECACHE_URLS.length,
    });
  })());
});
