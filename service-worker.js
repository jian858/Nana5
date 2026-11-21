/* Murmur offline app shell.
 * Keep this list in sync with index.html and app-loader.js.
 * Cache version must change whenever this file's shell contents change.
 */
const CACHE_NAME = "murmur-shell-v17";
const OFFLINE_URL = "/offline.html";
const APP_SHELL = [
  "/",
  "/index.html",
  "/terms",
  "/privacy",
  "/cookies",
  "/styles.css?v=20261121-1",
  "/responsive.css?v=20261121-1",
  "/performance.css?v=20261121-2",
  "/legal-auth.css?v=20261121-2",
  "/support.css?v=20261121-1",
  "/config.js?v=20261102-1",
  "/firebase.js?v=20261118-2",
  "/account-restrictions.js?v=20261102-1",
  "/data-mode.js?v=20261121-1",
  "/visitor-tracking.js?v=20261121-2",
  "/app-loader.js?v=20261121-22",
  "/app.js",
  "/home-feed.js",
  "/friends.js",
  "/chat.js",
  "/alerts.js",
  "/presence.js",
  "/navigation.js",
  "/registration.js",
  "/login.js",
  "/password-reset.js",
  "/legal.js",
  "/stories.js",
  "/comments.js",
  "/post-composer.js",
  "/notes.js",
  "/session.js",
  "/reels.js",
  "/menu.js",
  "/profile.js",
  "/messaging.js",
  "/account-recovery.js",
  "/blocking.js",
  "/security.js",
  "/pwa.js?v=20261102-2",
  "/manifest.json?v=20261102-2",
  "/murmur-icon.svg",
  "/offline.html"
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
          await cache.put(request, response.clone());
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
