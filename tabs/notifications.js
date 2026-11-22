/* Murmur Notifications tab. Owns notification data, filters, read state and details. */
import { supabase } from "../supabase-client.js";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };

let activeAlertFilter = "all";
export function setAlertFilter(filter) {
  activeAlertFilter = filter === "unread" ? "unread" : "all";
  return renderAlerts();
}

export async function renderAlerts() {
  const root = el("alertsList");
  if (!root) return;
  try {
    const { data: sessionData, error: userError } = await supabase.auth.getSession();
    if (userError) throw userError;
    const currentUser = sessionData?.session?.user;
    if (!currentUser) throw new Error("Sign in again to view notifications.");
    const notificationRequest = supabase.from("notifications").select("id,kind,content,read_at,created_at")
      .eq("recipient_id", currentUser.id).order("created_at", { ascending: false }).limit(50);
    const announcementRequest = activeAlertFilter === "all"
      ? supabase.from("announcements").select("id,title,body,kind,published_at")
          .lte("published_at", new Date().toISOString())
          .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
          .order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null });
    const [{ data, error }, { data: announcements, error: announcementError }] = await Promise.all([
      notificationRequest, announcementRequest
    ]);
    if (error) throw error;
    if (announcementError) console.warn("[Murmur notifications] Announcements unavailable:", announcementError);
    const uniqueAnnouncements = [...new Map((announcements || []).map(a => [
      [String(a.title || "").trim().toLowerCase(), String(a.body || "").trim().toLowerCase()].join("|"), a
    ])).values()];
    const unread = (data || []).filter(n => !n.read_at).length;
    const selectedAnnouncements = activeAlertFilter === "all" ? uniqueAnnouncements : [];
    const selectedNotifications = (data || []).filter(n => {
      if (activeAlertFilter === "unread") return !n.read_at;
      return activeAlertFilter === "all";
    });
    const announcementHtml = selectedAnnouncements.map(a =>
      '<article class="alert-row admin-announcement" tabindex="0" data-alert-open data-alert-title="' + esc(a.title || "Murmur announcement") + '" data-alert-content="' + esc(a.body || "") + '" data-alert-date="' + esc(a.published_at || "") + '" data-alert-source="Murmur">' +
      '<div class="alert-row-heading"><strong>Murmur announcement</strong></div><h3>' + esc(a.title) + '</h3><p>' + esc(a.body) + '</p><small>' + esc(new Date(a.published_at).toLocaleString()) + '</small><button class="btn secondary" type="button" data-open-alert>View notification</button></article>'
    ).join("");
    const notificationHtml = selectedNotifications.map(n => {
      const title = n.kind === "admin_post_removed" ? "Post removed by Murmur Admin" : (n.kind || "Murmur notification").replace(/[_-]/g, " ");
      return '<article class="alert-row murmur-notification' + (n.read_at ? '' : ' is-unread') + '" tabindex="0" data-alert-open data-alert-id="' + esc(n.id) + '" data-alert-title="' + esc(title) + '" data-alert-content="' + esc(n.content || "") + '" data-alert-date="' + esc(n.created_at || "") + '" data-alert-source="Murmur">' +
        '<div class="alert-row-heading"><strong>Murmur · ' + esc(title) + '</strong>' +
        (!n.read_at ? '<span class="alert-unread-dot" aria-label="Unread"></span>' : '') + '</div>' +
        '<p>' + esc(n.content) + '</p><small>' + esc(new Date(n.created_at).toLocaleString()) + (n.read_at ? ' · Read' : ' · Unread') + '</small>' +
        '<button class="btn secondary" type="button" data-open-alert>View notification</button>' +
        (!n.read_at ? '<button class="btn secondary" type="button" data-mark-alert="' + esc(n.id) + '">Mark read</button>' : '') + '</article>';
    }).join("");
    root.innerHTML = announcementHtml + notificationHtml || '<p class="empty-state">No notifications in this filter.</p>';
    const openAlertDetails = card => {
      const title = card.dataset.alertTitle || "Murmur notification";
      const content = card.dataset.alertContent || "No additional details are available.";
      const date = card.dataset.alertDate ? new Date(card.dataset.alertDate).toLocaleString() : "Date unavailable";
      const overlay = document.createElement("div");
      overlay.className = "murmur-auth-modal murmur-notification-modal";
      overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="murmur-notice-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><p class="alerts-eyebrow">MURMUR NOTIFICATION</p><h2 id="murmur-notice-title"></h2><p class="murmur-notification-detail"></p><small class="murmur-notification-date"></small><a class="btn primary murmur-notification-home" href="https://murmur.chat" target="_blank" rel="noopener noreferrer">murmur.chat</a></section>';
      document.body.appendChild(overlay);
      overlay.querySelector("#murmur-notice-title").textContent = title;
      overlay.querySelector(".murmur-notification-detail").textContent = content;
      overlay.querySelector(".murmur-notification-date").textContent = "Received " + date;
      const close = () => overlay.remove();
      overlay.querySelector(".murmur-modal-close")?.addEventListener("click", close);
      overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    };
    root.querySelectorAll("[data-alert-open]").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-mark-alert]")) return;
        openAlertDetails(card);
      });
      card.addEventListener("keydown", event => {
        if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openAlertDetails(card);
      });
    });
    root.querySelectorAll("[data-open-alert]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      openAlertDetails(button.closest("[data-alert-open]"));
    }));
    root.querySelectorAll("[data-mark-alert]").forEach(button => button.addEventListener("click", async event => {
      event.stopPropagation();
      button.disabled = true;
      try {
        const { error: updateError } = await supabase.from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", button.dataset.markAlert).eq("recipient_id", currentUser.id);
        if (updateError) throw updateError;
        await renderAlerts();
      } catch (error) { alert(error.message || "Could not mark notification as read."); button.disabled = false; }
    }));
    document.querySelectorAll("[data-alert-filter]").forEach(button => {
      const selected = button.dataset.alertFilter === activeAlertFilter;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    if (el("alertsBadge")) { el("alertsBadge").hidden = !unread; el("alertsBadge").textContent = unread ? String(unread) : ""; }
    if (el("alertsUnreadCount")) el("alertsUnreadCount").textContent = unread ? unread + " unread" : "You're all caught up";
  } catch (error) { fail(root, error); }
}
