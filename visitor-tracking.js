/* MURMUR VISITOR TRACKING
 * One persistent random first-party ID per browser profile.
 * A device is counted once in the unique-device table; page opens are events.
 * Storage is best-effort: blocked sessionStorage must never stop a visit request.
 */
(function initMurmurVisitorTracking() {
  "use strict";
  const storageKey = "murmur_visitor_id_v1";
  const throttleKey = "murmur_visit_throttle_v2";
  let memoryVisitorId = null;
  let lastMemoryVisit = { path: "", at: 0 };

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
    } catch (_) {
      // Private browsing / embedded browser may block localStorage.
    }
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
    } catch (_) {
      // Continue without sessionStorage.
    }
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
      let controller;
      let timeout;
      try {
        if (typeof AbortController !== "undefined") {
          controller = new AbortController();
          timeout = setTimeout(() => controller.abort(), 9000);
        }
        const client = window.murmurSupabase;
        if (!client?.functions) throw new Error("Supabase client is not ready.");
        const { data, error } = await client.functions.invoke("murmur-visitor-track", {
          body: { visitor_id: visitorId, page_path: cleanPath }
        });
        if (error) throw error;
        if (!data || typeof data.recorded !== "boolean") throw new Error("Visitor tracking returned an invalid response.");
        markRecorded(cleanPath, Date.now());
        window.dispatchEvent(new CustomEvent("murmur:visitor-recorded", { detail: { path: cleanPath } }));
        return true;
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    console.warn("[Murmur visitor tracking] Visit was not confirmed by Supabase:", lastError);
    return false;
  }

  window.MurmurVisitorTracking = { record: (path, force) => record(path || window.location.pathname, !!force) };

  // Wait for the shared Supabase module client before recording the first visit.
  function startTracking() { record(window.location.pathname, true); }
  if (window.murmurSupabase?.functions) startTracking();
  else window.addEventListener("murmur:supabase-client-ready", startTracking, { once: true });

  // App navigation calls this event even when a view is changed programmatically.
  window.addEventListener("murmur:viewchange", event => {
    const view = String(event.detail && event.detail.view || "").toLowerCase();
    if (/^(home|reels|friends|chats|alerts|menu|profile)$/.test(view)) record("/" + view, false);
  });

  // Also support ordinary same-origin links and legacy navigation buttons.
  document.addEventListener("click", function (event) {
    const target = event.target && (event.target.closest ? event.target : event.target.parentElement);
    if (!target || !target.closest) return;
    const viewButton = target.closest("[data-view]");
    if (viewButton) {
      const view = String(viewButton.getAttribute("data-view") || "").toLowerCase();
      if (/^(home|reels|friends|chats|alerts|menu|profile)$/.test(view)) record("/" + view, false);
      return;
    }
    const link = target.closest("a[href]");
    if (!link) return;
    try {
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin) record(destination.pathname, false);
    } catch (_) {}
  }, true);
})();
