/* ANONYMOUS VISITOR ANALYTICS
   Records page opens and internal navigation without requiring an account.
   Uses a random first-party visitor ID; does not collect IP addresses,
   names, email addresses, passwords, fingerprints, or full query strings.
*/
(function initAnonymousVisitorTracking() {
  "use strict";
  const endpoint = "https://pkadftvqslkykehcqedj.supabase.co/rest/v1/rpc/record_murmur_visit";
  const publicKey = "sb_publishable_etoHiUGbJ96MUPzJABL12A_UiTWVxok";
  const storageKey = "murmur_visitor_id_v1";
  const throttleKey = "murmur_visit_throttle_v1";

  function getVisitorId() {
    try {
      let id = localStorage.getItem(storageKey);
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        id = (crypto && crypto.randomUUID) ? crypto.randomUUID() :
          "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === "x" ? r : (r & 3 | 8)).toString(16);
          });
        localStorage.setItem(storageKey, id);
      }
      return id;
    } catch (_) {
      return null;
    }
  }

  function safePath(value) {
    let path = String(value || "/").split("?")[0].split("#")[0];
    if (!path.startsWith("/") || path.length > 100 || !/^\/[a-zA-Z0-9/_-]*$/.test(path)) return "/";
    return path;
  }

  async function record(path, force) {
    const visitorId = getVisitorId();
    if (!visitorId) return;
    const cleanPath = safePath(path);
    try {
      const now = Date.now();
      const previous = JSON.parse(sessionStorage.getItem(throttleKey) || "{}");
      if (!force && previous.path === cleanPath && now - Number(previous.at || 0) < 15000) return;
      // Use the Supabase publishable key for both gateway and PostgREST authorization.
      // Do not mark this page as recorded until Supabase confirms the insert.
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": publicKey,
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({ p_visitor_id: visitorId, p_page_path: cleanPath }),
            keepalive: true
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error("Visitor tracking failed (" + response.status + "): " + detail.slice(0, 240));
          }
          sessionStorage.setItem(throttleKey, JSON.stringify({ path: cleanPath, at: Date.now() }));
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
      console.warn("[Murmur visitor tracking]", lastError);
    } catch (error) {
      console.warn("[Murmur visitor tracking]", error);
    }
  }

  record(window.location.pathname, true);

  document.addEventListener("click", function (event) {
    const viewButton = event.target.closest && event.target.closest("[data-view]");
    if (viewButton) {
      const view = String(viewButton.getAttribute("data-view") || "").toLowerCase();
      if (/^(home|reels|friends|chats|alerts|menu|profile)$/.test(view)) {
        record("/" + view, false);
      }
      return;
    }
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;
    try {
      const target = new URL(link.href, window.location.href);
      if (target.origin === window.location.origin) record(target.pathname, false);
    } catch (_) {}
  }, true);
})();
