/* Supabase-only social features for Murmur. */
import { supabase } from "./supabase-client.js";
import { friendships, stories, reels, userNotes, conversations, messages, storage } from "./supabase-data.js?v=20261122-1";

const el = id => document.getElementById(id);
let socialChannel = null;
let messageChannel = null;
let presenceChannel = null;
let onlineUserIds = new Set();
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };
const avatarMarkup = (person, label = "View profile") => {
  const name = person?.display_name || person?.username || "Murmur user";
  const initial = esc(name.slice(0, 1).toUpperCase());
  const image = person?.avatar_url
    ? '<img src="' + esc(person.avatar_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.textContent=\'' + initial + '\'">'
    : initial;
  return '<span class="avatar" role="img" aria-label="' + esc(label) + '" style="display:inline-flex;align-items:center;justify-content:center;overflow:hidden;border-radius:50%;flex:0 0 auto">' + image + '</span>';
};

async function renderFriends() {
  const list = el("friendsList");
  const search = el("searchResults");
  if (list) list.innerHTML = "<p>Loading friends…</p>";
  try {
    const rows = await friendships.people("accepted");
    if (list) list.innerHTML = rows.length ? rows.map(row => {
      const p = row.person || {};
      return '<article class="friend-row">' + avatarMarkup(p, "Friend profile picture") + '<div><strong>' + esc(p.display_name || "Murmur user") + '</strong><small>@' + esc(p.username || "") + '</small></div><button class="btn secondary" type="button" data-chat-user="' + esc(p.id) + '">Message</button></article>';
    }).join("") : '<p class="empty-state">Your friends will appear here.</p>';
    list?.querySelectorAll("[data-chat-user]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await openDirectChat(button.dataset.chatUser); }
      catch (error) { alert(error.message); }
      finally { button.disabled = false; }
    }));
    if (search) search.innerHTML = "";
    const incoming = await friendships.incoming();
    const reqList = el("reqList");
    if (el("reqCard")) el("reqCard").hidden = !incoming.length;
    if (el("reqCount")) el("reqCount").textContent = incoming.length ? String(incoming.length) : "";
    const requesterIds = [...new Set(incoming.map(row => row.requester_id))];
    const { data: requesters, error: requesterError } = requesterIds.length
      ? await supabase.from("murmur_public_profiles").select("id,display_name,username,avatar_url").in("id", requesterIds)
      : { data: [], error: null };
    if (requesterError) throw requesterError;
    const requesterById = new Map((requesters || []).map(person => [person.id, person]));
    if (reqList) reqList.innerHTML = incoming.map(row => {
      const person = requesterById.get(row.requester_id) || {};
      const name = person.display_name || (person.username ? "@" + person.username : "Someone");
      return '<div class="friend-row"><button type="button" class="friend-request-profile" data-open-profile="' + esc(row.requester_id) + '" aria-label="View ' + esc(name) + ' profile" style="border:0;background:transparent;padding:0;cursor:pointer">' + avatarMarkup(person, "Open profile") + '</button><div><button type="button" class="people-profile-name" data-open-profile="' + esc(row.requester_id) + '">' + esc(name) + '</button><small>@' + esc(person.username || "") + ' · Friend request</small></div><button class="btn primary" type="button" data-accept="' + esc(row.requester_id) + '">Accept</button></div>';
    }).join("");
    reqList?.querySelectorAll("[data-accept]").forEach(button => button.addEventListener("click", async () => {
      try { await friendships.setStatus(button.dataset.accept, "accepted"); await renderFriends(); }
      catch (error) { alert(error.message); }
    }));
  } catch (error) { fail(list, error); }
}

export async function openDirectChat(targetUserId) {
  if (!targetUserId) throw new Error("Choose an account before opening a conversation.");
  const chatsTab = document.querySelector(".fb-nav [data-view=\"chats\"]") ||
    document.querySelector('[data-view="chats"]');
  chatsTab?.click();

  const chatsPane = document.querySelector('[data-pane="chats"]');
  if (chatsPane && !chatsPane.classList.contains("active")) {
    document.querySelectorAll("[data-pane]").forEach(pane => {
      const active = pane === chatsPane;
      pane.classList.toggle("active", active);
      pane.hidden = !active;
    });
    document.querySelectorAll(".fb-nav [data-view]").forEach(item => {
      const active = item.dataset.view === "chats";
      item.classList.toggle("active", active);
      item.setAttribute("aria-current", active ? "page" : "false");
    });
    window.dispatchEvent(new CustomEvent("murmur:view-changed", { detail: { view: "chats" } }));
  }

  const root = el("messages");
  if (root) {
    root.dataset.conversationId = "";
    root.innerHTML = '<p class="empty-state">Opening conversation…</p>';
  }
  const { data: conversationId, error } = await supabase.rpc("start_murmur_direct_conversation", {
    p_target_user_id: targetUserId
  });
  if (error) throw error;
  const resolvedId = typeof conversationId === "string" ? conversationId : conversationId?.id;
  if (!resolvedId) throw new Error("Murmur did not return a conversation ID. Please try again.");
  await openConversation(resolvedId);
}

let peopleSearchRun = 0;

async function searchPeople() {
  const input = el("friendSearch");
  const button = el("friendSearchBtn");
  const target = el("searchResults");
  const term = (input?.value || "").trim().replace(/^@+/, "");
  if (!target) return;
  const run = ++peopleSearchRun;
  if (el("peopleBlock")) el("peopleBlock").hidden = false;
  if (!term) {
    target.innerHTML = '<p class="empty-state">Type a name or username to find people.</p>';
    return;
  }

  const originalLabel = button?.textContent || "Search";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = '<span class="people-search-spinner" aria-hidden="true"></span><span>Searching</span>';
  }
  target.setAttribute("aria-busy", "true");
  target.innerHTML = '<div class="people-search-loading"><span class="people-search-spinner" aria-hidden="true"></span><span>Searching the database…</span></div>';

  try {
    // Escape PostgREST OR/filter punctuation and LIKE wildcards while retaining
    // partial-name matching for both display names and usernames.
    const safe = term.replace(/[\\%_(),]/g, " ").replace(/\s+/g, " ").trim();
    if (!safe) {
      target.innerHTML = '<p class="empty-state">Enter a valid name or username to search.</p>';
      return;
    }
    const pattern = "%" + safe + "%";
    const { data, error } = await supabase.from("murmur_public_profiles")
      .select("id,username,display_name,avatar_url")
      .or("username.ilike." + pattern + ",display_name.ilike." + pattern)
      .limit(20);
    if (error) throw error;
    if (run !== peopleSearchRun) return;
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const currentUserId = sessionData?.session?.user?.id;
    const matches = (data || []).filter(person => person.id !== currentUserId);
    target.innerHTML = matches.map(person =>
      '<div class="friend-row"><button class="avatar" type="button" data-open-profile="' + esc(person.id) + '" aria-label="View profile" style="padding:0;overflow:hidden;border-radius:50%;flex:0 0 auto">' + (person.avatar_url ? '<img src="' + esc(person.avatar_url) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.remove();this.parentElement.textContent=\'' + esc((person.display_name || person.username || "?").slice(0,1).toUpperCase()) + '\'">' : esc((person.display_name || person.username || "?").slice(0,1).toUpperCase())) + '</button><div><button class="people-profile-name" type="button" data-open-profile="' + esc(person.id) + '">' + esc(person.display_name || "Murmur user") + '</button><small>@' + esc(person.username || "") + '</small></div><div class="friend-actions"><button class="btn secondary" type="button" data-chat-user="' + esc(person.id) + '">Message</button><button class="btn secondary" type="button" data-request="' + esc(person.id) + '">Add friend</button></div></div>'
    ).join("") || '<p class="empty-state">No account found. Try another name or username.</p>';
    target.querySelectorAll("[data-chat-user]").forEach(action => action.addEventListener("click", async () => {
      action.disabled = true;
      try { await openDirectChat(action.dataset.chatUser); }
      catch (error) { alert(error.message); }
      finally { action.disabled = false; }
    }));
    target.querySelectorAll("[data-request]").forEach(action => action.addEventListener("click", async () => {
      action.disabled = true;
      try { await friendships.request(action.dataset.request); action.textContent = "Request sent"; }
      catch (error) { action.disabled = false; alert(error.message); }
    }));
  } catch (error) {
    if (run === peopleSearchRun) fail(target, error);
  } finally {
    if (run === peopleSearchRun) {
      target.removeAttribute("aria-busy");
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = originalLabel;
      }
    }
  }
}

async function renderStories() {
  const roots = [el("storiesRow"), el("chatStoriesRow")].filter(Boolean);
  if (!roots.length) return;
  try {
    const rows = await stories.list();
    const displayRows = await Promise.all(rows.map(async story => ({
      ...story,
      signedMediaUrl: story.media_path ? await storage.url("murmur-stories", story.media_path) : null
    })));
    const storyMarkup = '<div class="story-heading"><strong>Stories</strong><button type="button" class="btn secondary" data-add-story>Share a story</button></div>' + (displayRows.length ? displayRows.map(s => '<article class="story-card">' + (s.signedMediaUrl ? (s.media_type === "video" ? '<video controls playsinline preload="metadata" src="' + esc(s.signedMediaUrl) + '"></video>' : '<img loading="lazy" src="' + esc(s.signedMediaUrl) + '" alt="Story media">') : '') + '<strong>' + esc(s.content || "Story") + '</strong><small>' + esc(new Date(s.created_at).toLocaleString()) + '</small></article>').join("") : '');
    roots.forEach(root => { root.innerHTML = storyMarkup; });
    roots.forEach(root => root.querySelector("[data-add-story]")?.addEventListener("click", () => {
      const picker = document.createElement("input");
      picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"; picker.hidden = true;
      document.body.appendChild(picker);
      picker.addEventListener("change", async () => {
        const file = picker.files?.[0] || null; picker.remove();
        const content = prompt("Add a caption to your story (optional, up to 2,000 characters):") || "";
        if (!file && !content.trim()) return;
        if (file && file.size > 20 * 1024 * 1024) return alert("Choose a story file under 20 MB.");
        try {
          let mediaPath = null, mediaType = null;
          if (file) {
            const uploaded = await storage.uploadMedia(file, "stories");
            mediaPath = uploaded.path;
            mediaType = file.type.startsWith("video/") ? "video" : "image";
          }
          await stories.create({ content, mediaPath, mediaType });
          await renderStories();
        } catch (error) { alert(error.message); }
      }, { once: true });
      picker.click();
    }));
  } catch (error) { roots.forEach(root => fail(root, error)); }
}

async function renderReels() {
  const root = el("reelsFeed");
  if (!root) return;
  try {
    const rows = await reels.list();
    const displayRows = await Promise.all(rows.map(async reel => ({
      ...reel,
      signedMediaUrl: reel.storage_path ? await storage.url("murmur-reels", reel.storage_path) : reel.video_url
    })));
    root.innerHTML = displayRows.map(r => '<article class="reel-card"><video controls playsinline preload="metadata" src="' + esc(r.signedMediaUrl || "") + '"></video><strong>' + esc(r.title || "Reel") + '</strong><p>' + esc(r.caption || "") + '</p></article>').join("") || '<p class="empty-state">No reels yet.</p>';
  } catch (error) { fail(root, error); }
}

async function renderNotes() {
  const root = el("noteRow");
  if (!root) return;
  try {
    const [{ data: authData, error: authError }, rows] = await Promise.all([
      supabase.auth.getUser(), userNotes.listMine()
    ]);
    if (authError) throw authError;
    const user = authData.user;
    if (!user) throw new Error("Sign in again to create a note.");
    let profile = {};
    try {
      const { data } = await supabase.from("murmur_public_profiles")
        .select("display_name,avatar_url").eq("id", user.id).maybeSingle();
      profile = data || {};
    } catch (_) {}
    const avatarUrl = profile.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
    const name = profile.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "You";
    const latest = rows[0] || null;
    root.innerHTML = '<button type="button" class="note-avatar-button" data-add-note title="' + (latest ? 'Edit or delete your note' : 'Create a note') + '" aria-label="' + (latest ? 'Edit or delete your note' : 'Create a note') + '">' +
      '<span class="note-action-label">' + esc(latest?.content || "Create note") + '</span>' +
      '<span class="note-avatar-circle">' + (avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="">' : '<span>' + esc(name.slice(0,1).toUpperCase()) + '</span>') +
      '</span>' +
      '</button>';
    root.querySelectorAll("[data-add-note]").forEach(noteButton => noteButton.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.className = "murmur-auth-modal murmur-note-modal";
      overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="note-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2 id="note-title">' + (latest ? 'Edit your note' : 'Create a note') + '</h2><label for="note-content">Your note</label><textarea id="note-content" maxlength="500" rows="5" placeholder="What’s on your mind?">' + esc(latest?.content || "") + '</textarea><div class="note-editor-footer"><small data-note-count>0 / 500</small><button type="button" class="btn primary" data-save-note>Save note</button></div>' + (latest ? '<button type="button" class="note-delete" data-delete-current>Delete note</button>' : '') + '<p class="murmur-modal-error" role="alert"></p></section>';
      document.body.appendChild(overlay);
      const input = overlay.querySelector("#note-content");
      const save = overlay.querySelector("[data-save-note]");
      const errorBox = overlay.querySelector(".murmur-modal-error");
      const close = () => overlay.remove();
      overlay.querySelector(".murmur-modal-close")?.addEventListener("click", close);
      overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
      overlay.querySelector("[data-note-count]").textContent = input.value.length + " / 500";
      input.addEventListener("input", () => { overlay.querySelector("[data-note-count]").textContent = input.value.length + " / 500"; });
      save.addEventListener("click", async () => {
        const content = input.value.trim();
        if (!content) { errorBox.textContent = "Write something before saving."; input.focus(); return; }
        save.disabled = true;
        try {
          await userNotes.replaceMine({ content });
          close(); await renderNotes();
        } catch (error) { errorBox.textContent = error.message || "Could not save your note."; save.disabled = false; }
      });
      overlay.querySelector("[data-delete-current]")?.addEventListener("click", async () => {
        try { await userNotes.removeMine(); close(); await renderNotes(); }
        catch (error) { errorBox.textContent = error.message || "Could not delete your note."; }
      });
      input.focus();
    }));
  } catch (error) { fail(root, error); }
}

let activeAlertFilter = "all";

async function renderAlerts() {
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
      '<article class="alert-row admin-announcement"><strong>From Admin of Murmur</strong><h3>' + esc(a.title) + '</h3><p>' + esc(a.body) + '</p><small>' + esc(new Date(a.published_at).toLocaleString()) + '</small></article>'
    ).join("");
    const notificationHtml = selectedNotifications.map(n =>
      '<article class="alert-row' + (n.read_at ? '' : ' is-unread') + '" data-alert-id="' + esc(n.id) + '">' +
      '<div class="alert-row-heading"><strong>' + esc((n.kind || "Alert").replace(/[_-]/g, " ")) + '</strong>' +
      (!n.read_at ? '<span class="alert-unread-dot" aria-label="Unread"></span>' : '') + '</div>' +
      '<p>' + esc(n.content) + '</p><small>' + esc(new Date(n.created_at).toLocaleString()) + (n.read_at ? ' · Read' : ' · Unread') + '</small>' +
      (!n.read_at ? '<button class="btn secondary" type="button" data-mark-alert="' + esc(n.id) + '">Mark read</button>' : '') + '</article>'
    ).join("");
    root.innerHTML = announcementHtml + notificationHtml || '<p class="empty-state">No notifications in this filter.</p>';
    root.querySelectorAll("[data-mark-alert]").forEach(button => button.addEventListener("click", async () => {
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

let activeConversationId = null;
let activeConversationPerson = null;

async function getConversationPeople(conversationIds, currentUserId) {
  if (!conversationIds.length) return new Map();
  const { data: memberships, error: membershipError } = await supabase
    .from("conversation_members")
    .select("conversation_id,user_id,last_read_at")
    .in("conversation_id", conversationIds);
  if (membershipError) throw membershipError;

  const otherIds = [...new Set((memberships || [])
    .filter(row => row.user_id !== currentUserId)
    .map(row => row.user_id))];
  let people = [];
  if (otherIds.length) {
    const { data, error } = await supabase.from("murmur_public_profiles")
      .select("id,username,display_name,avatar_url")
      .in("id", otherIds);
    if (error) throw error;
    people = data || [];
  }
  const profileById = new Map(people.map(person => [person.id, person]));
  const result = new Map();
  for (const row of memberships || []) {
    if (row.user_id === currentUserId) continue;
    const person = profileById.get(row.user_id);
    if (person && !result.has(row.conversation_id)) result.set(row.conversation_id, person);
  }
  return result;
}

async function renderChats() {
  const root = el("chatList");
  if (!root) return;
  root.innerHTML = '<p class="empty-state">Loading friends and conversations…</p>';
  try {
    const [{ data: authData, error: authError }, rows, friendRows] = await Promise.all([
      supabase.auth.getUser(), conversations.list(), friendships.people("accepted")
    ]);
    if (authError) throw authError;
    const currentUserId = authData.user?.id;
    if (!currentUserId) throw new Error("Sign in again to view your chats.");
    const ids = rows.map(row => row.id);
    const [peopleByConversation, latestResult] = await Promise.all([
      getConversationPeople(ids, currentUserId),
      ids.length ? supabase.from("messages").select("conversation_id,content,created_at,sender_id")
        .in("conversation_id", ids).is("deleted_at", null).order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (latestResult.error) throw latestResult.error;
    const latestByConversation = new Map();
    for (const message of latestResult.data || []) if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
    const conversationByPerson = new Map();
    for (const conversation of rows) {
      const person = peopleByConversation.get(conversation.id);
      if (person?.id) conversationByPerson.set(person.id, conversation);
    }
    const friendIds = new Set();
    const friendItems = (friendRows || []).map(row => row.person).filter(person => {
      if (!person?.id || person.id === currentUserId || friendIds.has(person.id)) return false;
      friendIds.add(person.id); return true;
    }).map(person => {
      const conversation = conversationByPerson.get(person.id);
      const last = conversation ? latestByConversation.get(conversation.id) : null;
      const preview = last ? (last.sender_id === currentUserId ? "You: " : "") + (last.content || "Attachment") : "Start a conversation";
      const online = onlineUserIds.has(person.id);
      return '<button class="chat-list-item murmur-friend-chat' + (conversation && activeConversationId === conversation.id ? ' active' : '') + '" type="button" ' +
        (conversation ? 'data-conversation="' + esc(conversation.id) + '"' : 'data-chat-user="' + esc(person.id) + '"') +
        ' aria-label="Message ' + esc(person.display_name || person.username || "friend") + '">' +
        avatarMarkup(person, "Friend profile picture") +
        '<span class="chat-list-copy"><strong>' + esc(person.display_name || (person.username ? "@" + person.username : "Friend")) + '</strong><small>' + esc(preview) + '</small></span>' +
        '<span class="murmur-presence ' + (online ? 'is-online' : 'is-offline') + '"><i></i>' + (online ? 'Online' : 'Offline') + '</span></button>';
    });
    const otherItems = rows.filter(conversation => {
      const person = peopleByConversation.get(conversation.id);
      return !person?.id || !friendIds.has(person.id);
    }).map(conversation => {
      const person = peopleByConversation.get(conversation.id) || {};
      const name = person.display_name || (person.username ? "@" + person.username : "Murmur user");
      const last = latestByConversation.get(conversation.id);
      const preview = last ? (last.sender_id === currentUserId ? "You: " : "") + (last.content || "Attachment") : "Start a conversation";
      const online = person.id && onlineUserIds.has(person.id);
      return '<button class="chat-list-item' + (activeConversationId === conversation.id ? ' active' : '') + '" type="button" data-conversation="' + esc(conversation.id) + '" aria-label="Open chat with ' + esc(name) + '">' +
        avatarMarkup(person, "Profile picture") + '<span class="chat-list-copy"><strong>' + esc(name) + '</strong><small>' + esc(preview) + '</small></span>' +
        '<span class="murmur-presence ' + (online ? 'is-online' : 'is-offline') + '"><i></i>' + (online ? 'Online' : 'Offline') + '</span></button>';
    });
    root.innerHTML = friendItems.concat(otherItems).join("") || '<p class="empty-state">Add friends to see them here and start a chat.</p>';
    root.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => openConversation(button.dataset.conversation)));
    root.querySelectorAll("[data-chat-user]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await openDirectChat(button.dataset.chatUser); }
      catch (error) { alert(error.message || "Could not open this chat."); }
      finally { button.disabled = false; }
    }));
  } catch (error) {
    fail(root, error);
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn secondary"; retry.textContent = "Try again";
    retry.addEventListener("click", renderChats, { once: true }); root.appendChild(retry);
  }
}

async function renderConversationMessages(conversationId) {
  const root = el("messages");
  if (!root || root.dataset.conversationId !== conversationId) return;
  try {
    const [{ data: authData, error: authError }, rows] = await Promise.all([
      supabase.auth.getUser(),
      messages.list(conversationId)
    ]);
    if (authError) throw authError;
    const currentUserId = authData.user?.id;
    root.innerHTML = rows.length ? rows.slice().reverse().map(message => {
      const mine = message.sender_id === currentUserId;
      return '<article class="message-row' + (mine ? ' mine' : '') + '" data-message-id="' + esc(message.id) + '">' +
        '<p>' + esc(message.content || (message.media_type ? "Attachment" : "")) + '</p>' +
        '<time datetime="' + esc(message.created_at) + '">' + esc(new Date(message.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})) + '</time></article>';
    }).join("") : '<p class="empty-state">No messages yet. Send the first message.</p>';
    root.scrollTop = root.scrollHeight;
  } catch (error) {
    fail(root, error);
  }
}

let conversationOpenRun = 0;
async function openConversation(id) {
  const root = el("messages");
  if (!root || !id) return;
  const run = ++conversationOpenRun;
  activeConversationId = id;
  root.dataset.conversationId = id;
  root.innerHTML = '<p class="empty-state">Loading conversation…</p>';
  document.querySelector(".chat-layout")?.classList.add("open");
  el("chatName") && (el("chatName").textContent = "Loading chat…");
  el("chatStatus") && (el("chatStatus").textContent = "Connecting…");
  // Refresh the sidebar in the background. It must never delay showing the
  // selected conversation on slower mobile connections.
  void renderChats();

  try {
    const [{ data: authData, error: authError }, members] = await Promise.all([
      supabase.auth.getUser(),
      conversations.members(id)
    ]);
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
    if (authError) throw authError;
    const otherId = (members || []).find(member => member.user_id !== authData.user?.id)?.user_id;
    if (otherId) {
      const { data: person, error } = await supabase.from("murmur_public_profiles")
        .select("id,username,display_name,avatar_url")
        .eq("id", otherId).maybeSingle();
      if (error) throw error;
      if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
      activeConversationPerson = person;
    } else {
      activeConversationPerson = null;
    }
    const name = activeConversationPerson?.display_name || activeConversationPerson?.username || "Conversation";
    if (el("chatName")) el("chatName").textContent = name;
    if (el("chatStatus")) el("chatStatus").textContent = activeConversationPerson?.username ? "@" + activeConversationPerson.username : "Private chat";
    if (el("chatAvatar")) {
      const person = activeConversationPerson;
      el("chatAvatar").innerHTML = person?.avatar_url
        ? '<img src="' + esc(person.avatar_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.remove()">'
        : esc(name.slice(0,1).toUpperCase());
    }

    if (messageChannel) supabase.removeChannel(messageChannel);
    messageChannel = supabase.channel("murmur-chat-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq." + id },
        () => { if (root.dataset.conversationId === id) void renderConversationMessages(id); })
      .subscribe();
    await renderConversationMessages(id);
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
    conversations.markRead(id).catch(error => console.warn("[Murmur chat] Could not update read state:", error));
    el("messageInput")?.focus();
  } catch (error) {
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
    root.innerHTML = '<div class="empty-state" role="alert"><p>This conversation could not be opened.</p><small>' + esc(error.message || "Please check your connection and try again.") + '</small><button type="button" class="btn secondary" data-retry-conversation>Try again</button></div>';
    root.querySelector("[data-retry-conversation]")?.addEventListener("click", () => openConversation(id), { once: true });
  }
}

async function sendChatMessage() {
  const root = el("messages");
  const id = root?.dataset.conversationId;
  const input = el("messageInput");
  const button = el("sendBtn");
  const content = input?.value.trim();
  if (!id || !content) return;
  if (button) button.disabled = true;
  try {
    await messages.send({ conversationId: id, content });
    input.value = "";
    await renderConversationMessages(id);
    await renderChats();
  } catch (error) {
    alert(error.message || "Your message could not be sent. Please try again.");
  } finally {
    if (button) button.disabled = false;
    input?.focus();
  }
}

export function initSupabaseSocial() {
  // Friend tabs are real controls: switch the visible panel and refresh its data.
  const friendTabs = [...document.querySelectorAll("[data-frtab]")];
  const friendPanels = [...document.querySelectorAll("[data-frpanel]")];
  const activateFriendTab = tabName => {
    friendTabs.forEach(tab => {
      const selected = tab.dataset.frtab === tabName;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
    });
    friendPanels.forEach(panel => {
      const selected = panel.dataset.frpanel === tabName;
      panel.hidden = !selected;
      panel.classList.toggle("active", selected);
    });
    if (tabName === "suggest") {
      const findBlock = el("findBlock");
      if (findBlock) findBlock.hidden = false;
      el("friendSearch")?.focus({ preventScroll: true });
    }
    renderFriends();
  };
  friendTabs.forEach(tab => tab.addEventListener("click", () => activateFriendTab(tab.dataset.frtab || "suggest")));
  friendTabs.forEach(tab => tab.setAttribute("aria-selected", String(tab.classList.contains("active"))));
  document.querySelectorAll("[data-alert-filter]").forEach(button => button.addEventListener("click", () => {
    activeAlertFilter = button.dataset.alertFilter || "all";
    renderAlerts();
  }));

  el("friendSearchBtn")?.addEventListener("click", searchPeople);
  el("friendSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); searchPeople(); }
  });
  el("sendBtn")?.addEventListener("click", sendChatMessage);
  el("chatSettingsBtn")?.addEventListener("click", () => {
    const menu=document.createElement("div"); menu.className="chat-settings-popover";
    menu.innerHTML='<strong>Message settings</strong><p>Manage blocked people in Settings.</p><button type="button" class="btn secondary" data-chat-settings-close>Close</button>';
    document.querySelector(".chat-settings-popover")?.remove(); document.querySelector('[data-pane="chats"]')?.append(menu);
    menu.querySelector("[data-chat-settings-close]")?.addEventListener("click",()=>menu.remove());
  });

  el("chatBack")?.addEventListener("click", () => { document.querySelector(".chat-layout")?.classList.remove("open"); });
  el("messageInput")?.addEventListener("keydown", event => { if (event.key === "Enter") sendChatMessage(); });
  el("reelCreateBtn")?.addEventListener("click", () => {
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "video/mp4,video/webm"; picker.hidden = true;
    document.body.appendChild(picker);
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0]; picker.remove();
      if (!file) return;
      if (file.size > 100 * 1024 * 1024) return alert("Choose a video under 100 MB.");
      try {
        const uploaded = await storage.uploadMedia(file, "reels");
        await reels.create({ storagePath: uploaded.path, title: file.name });
        await renderReels();
      } catch (error) { alert(error.message); }
    }, { once: true });
    picker.click();
  });
  el("frSearchIcon")?.addEventListener("click", () => { document.querySelector('.fb-nav [data-view="friends"]')?.click(); document.querySelector('.fr-pill[data-frtab="suggest"]')?.click(); if (el("findBlock")) el("findBlock").hidden = false; if (el("peopleBlock")) el("peopleBlock").hidden = false; el("friendSearch")?.focus({ preventScroll: true }); });
  window.addEventListener("murmur:supabase-user-ready", async () => {
    const { data: presenceAuth } = await supabase.auth.getUser();
    const presenceUserId = presenceAuth.user?.id;
    if (presenceChannel) supabase.removeChannel(presenceChannel);
    onlineUserIds = new Set();
    if (presenceUserId) {
      presenceChannel = supabase.channel("murmur-presence", { config: { presence: { key: presenceUserId } } })
        .on("presence", { event: "sync" }, () => {
          onlineUserIds = new Set(Object.keys(presenceChannel?.presenceState?.() || {}));
          renderChats();
        })
        .subscribe(async status => {
          if (status === "SUBSCRIBED") await presenceChannel.track({ user_id: presenceUserId, online_at: new Date().toISOString() });
        });
    }
    if (socialChannel) supabase.removeChannel(socialChannel);
    socialChannel = supabase.channel("murmur-social-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, renderAlerts)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, renderChats)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, renderChats)
      .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, renderStories)
      .on("postgres_changes", { event: "*", schema: "public", table: "reels" }, renderReels)
      .subscribe();
    await Promise.all([renderFriends(), renderStories(), renderReels(), renderNotes(), renderAlerts(), renderChats()]);
  });
  window.addEventListener("murmur:supabase-signed-out", () => {
    if (socialChannel) supabase.removeChannel(socialChannel);
    if (messageChannel) supabase.removeChannel(messageChannel);
    if (presenceChannel) supabase.removeChannel(presenceChannel);
    socialChannel = null; messageChannel = null; presenceChannel = null; onlineUserIds = new Set();
  });
  window.addEventListener("murmur:view-changed", event => {
    const view = event.detail?.view;
    if (view === "friends") renderFriends();
    if (view === "reels") renderReels();
    if (view === "chats") renderChats();
    if (view === "alerts") renderAlerts();
  });
}
