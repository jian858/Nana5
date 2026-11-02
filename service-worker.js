const CACHE_NAME = "murmur-shell-v5";
const APP_SHELL = [
  "/", "/index.html", "/styles.css?v=20261102-2", "/config.js?v=20261102-1", "/firebase.js?v=20261102-1",
  "/account-restrictions.js?v=20261102-1", "/app.js?v=20261102-9", "/pwa.js?v=20261102-1", "/manifest.json?v=20261102-1",
  "/murmur-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(path =>
        cache.add(path).catch(error => {
          console.warn("Murmur: could not cache", path, error);
        })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("murmur-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/index.html")) || Response.error())
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || Response.error())
  );
});
