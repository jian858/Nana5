/* Murmur offline app shell.
 * Keep cache URLs aligned with the entry points and versioned assets in index.html.
 * A single shared Supabase client module prevents competing refresh-token rotations.
 */
const CACHE_NAME = "murmur-shell-v88";
const OFFLINE_URL = "/offline.html";
const APP_SHELL = [
  "/", "/index.html", "/terms", "/privacy", "/cookies",
  "/styles.css?v=20261121-4", "/responsive.css?v=20261121-2",
  "/performance.css?v=20261121-3", "/legal-auth.css?v=20261122-1",
  "/support.css?v=20261121-2", "/murmur-ui.css?v=20261122-1",
  "/murmur-fixes.css?v=20261122-16", "/visitor-tracking.js?v=20261121-3",
  "/supabase-client.js?v=20261122-2", "/supabase-runtime.js?v=20261122-3",
  "/supabase-data.js", "/supabase-data.js?v=20261122-3", "/supabase-data.js?v=20261122-4",
  "/supabase-app.js?v=20261122-48", "/supabase-social.js?v=20261122-39",
  "/tabs/stories.js", "/tabs/reels.js", "/tabs/notes.js", "/tabs/notifications.js",
  "/tabs/friends.js", "/tabs/friends.js?v=20261122-2", "/tabs/friends.js?v=20261122-3", "/tabs/home.js?v=20261122-2",
  "/pwa.js?v=20261122-2", "/manifest.json?v=20261102-2",
  "/murmur-icon.svg", "/offline.html"
];

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data?.text?.() || "You have a new update on Murmur." }; }
  const title = payload.title || "Murmur";
  const options = {
    body: payload.body || "You have a new notification.",
    icon: payload.icon || "/murmur-icon.svg",
    badge: payload.badge || "/murmur-icon.svg",
    tag: payload.tag || "murmur-notification",
    data: payload.data || { url: "/" },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) { await client.focus(); return; }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try { await cache.add(path); }
      catch (error) { console.warn("Murmur: app-shell resource was not cached:", path, error); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("murmur-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
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
        if (response?.ok) { const cache = await caches.open(CACHE_NAME); await cache.put(request, response.clone()); }
        return response;
      } catch {
        const cachedPage = await caches.match(request);
        if (cachedPage) return cachedPage;
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response?.ok) { const cache = await caches.open(CACHE_NAME); await cache.put(request, response.clone()); }
      return response;
    } catch { return (await caches.match(request)) || Response.error(); }
  })());
});
