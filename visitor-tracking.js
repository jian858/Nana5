/* MURMUR VISITOR TRACKING
 * One persistent first-party visitor ID per browser profile.
 * A device is counted once in the unique-device table; page opens are events.
 * Storage is best-effort: blocked browser storage must never stop tracking.
 */
(function initMurmurVisitorTracking() {
  "use strict";
  const storageKey = "murmur_visitor_id_v1";
  const throttleKey = "murmur_visit_throttle_v2";
  let memoryVisitorId = null;
  let lastMemoryVisit = { path: "", at: 0 };
  let trackingStarted = false;

  function makeId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    } catch (_) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function getVisitorId() {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) {
        memoryVisitorId = saved;
        return saved;
      }
    } catch (_) {}
    if (!memoryVisitorId) memoryVisitorId = makeId();
    try { window.localStorage.setItem(storageKey, memoryVisitorId); } catch (_) {}
    return memoryVisitorId;
  }

  function safePath(value) {
    const path = String(value || "/").split("?")[0].split("#")[0];
    return path.startsWith("/") && path.length <= 100 && /^\/[a-zA-Z0-9/_-]*$/.test(path) ? path : "/";
  }

  function wasRecentlyRecorded(path, now) {
    let previous = lastMemoryVisit;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(throttleKey) || "null");
      if (saved && typeof saved.path === "string") previous = saved;
    } catch (_) {}
    return previous.path === path && now - Number(previous.at || 0) < 15000;
  }

  function markRecorded(path, now) {
    lastMemoryVisit = { path, at: now };
    try { window.sessionStorage.setItem(throttleKey, JSON.stringify(lastMemoryVisit)); } catch (_) {}
  }

  async function record(path, force) {
    const visitorId = getVisitorId();
    const cleanPath = safePath(path);
    const now = Date.now();
    if (!force && wasRecentlyRecorded(cleanPath, now)) return false;

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // The runtime exposes the shared client as MurmurSupabase.client and
        // announces readiness with murmur:supabase-ready.
        const client = window.MurmurSupabase?.client;
        if (!client?.functions) throw new Error("Supabase client is not ready.");
        const { data, error } = await client.functions.invoke("murmur-visitor-track", {
          body: { visitor_id: visitorId, page_path: cleanPath }
        });
        if (error) throw error;
        if (!data || typeof data.recorded !== "boolean") {
          throw new Error("Visitor tracking returned an invalid response.");
        }
        markRecorded(cleanPath, Date.now());
        window.dispatchEvent(new CustomEvent("murmur:visitor-recorded", { detail: { path: cleanPath } }));
        return true;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    console.warn("[Murmur visitor tracking] Visit was not confirmed by Supabase:", lastError);
    return false;
  }

  window.MurmurVisitorTracking = {
    record: (path, force) => record(path || window.location.pathname, !!force)
  };

  function startTracking() {
    if (trackingStarted || !window.MurmurSupabase?.client?.functions) return;
    trackingStarted = true;
    void record(window.location.pathname, true);
  }

  // Module scripts execute after this classic script; handle both load orders.
  if (window.MurmurSupabase?.client?.functions) startTracking();
  else window.addEventListener("murmur:supabase-ready", startTracking, { once: true });

  // Match the application's actual programmatic navigation event.
  window.addEventListener("murmur:view-changed", event => {
    const view = String(event.detail?.view || "").toLowerCase();
    if (/^(home|reels|friends|chats|alerts|menu|profile)$/.test(view)) {
      void record("/" + view, false);
    }
  });

  // Also support legacy navigation buttons and ordinary same-origin links.
  document.addEventListener("click", event => {
    const target = event.target && (event.target.closest ? event.target : event.target.parentElement);
    if (!target?.closest) return;
    const viewButton = target.closest("[data-view]");
    if (viewButton) {
      const view = String(viewButton.getAttribute("data-view") || "").toLowerCase();
      if (/^(home|reels|friends|chats|alerts|menu|profile)$/.test(view)) {
        void record("/" + view, false);
      }
      return;
    }
    const link = target.closest("a[href]");
    if (!link) return;
    try {
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin) void record(destination.pathname, false);
    } catch (_) {}
  }, true);
})();
