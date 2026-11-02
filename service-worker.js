const CACHE_NAME = "murmur-shell-v8";
const OFFLINE_URL = "/offline.html";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20261102-5",
  "/config.js?v=20261102-1",
  "/firebase.js?v=20261102-1",
  "/account-restrictions.js?v=20261102-1",
  "/app.js?v=20261102-10",
  "/pwa.js?v=20261102-2",
  "/manifest.json?v=20261102-2",
  "/murmur-icon.svg",
  OFFLINE_URL
];

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try {
        await cache.add(path);
      } catch (error) {
        console.warn("Murmur: app-shell resource was not cached:", path, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith("murmur-shell-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/functions/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/index.html", response.clone());
        }
        return response;
      } catch {
        const cachedPage = await caches.match(request);
        if (cachedPage) return cachedPage;

        const fallback = await caches.match(OFFLINE_URL);
        return fallback || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request)) || Response.error();
    }
  })());
});
