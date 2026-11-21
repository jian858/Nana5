/* Supabase-only social features for Murmur. */
import { supabase } from "./supabase-client.js";
import { friendships, stories, reels, userNotes, conversations, messages, storage } from "./supabase-data.js";

const el = id => document.getElementById(id);
let socialChannel = null;
let messageChannel = null;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };

async function renderFriends() {
  const list = el("friendsList");
  const search = el("searchResults");
  if (list) list.innerHTML = "<p>Loading friends…</p>";
  try {
    const rows = await friendships.people("accepted");
    if (list) list.innerHTML = rows.length ? rows.map(row => {
      const p = row.person || {};
      return '<article class="friend-row"><span class="avatar">' + esc((p.display_name || "?").slice(0,1).toUpperCase()) + '</span><div><strong>' + esc(p.display_name || "Murmur user") + '</strong><small>@' + esc(p.username || "") + '</small></div><button class="btn secondary" type="button" data-chat-user="' + esc(p.id) + '">Message</button></article>';
    }).join("") : '<p class="empty-state">Your friends will appear here.</p>';
    list?.querySelectorAll("[data-chat-user]").forEach(button => button.addEventListener("click", async () => {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const { data: conversation, error: conversationError } = await supabase.from("conversations")
          .insert({ created_by: userData.user.id }).select("id").single();
        if (conversationError) throw conversationError;
        const { error: membersError } = await supabase.from("conversation_members").insert([
          { conversation_id: conversation.id, user_id: userData.user.id },
          { conversation_id: conversation.id, user_id: button.dataset.chatUser }
        ]);
        if (membersError) throw membersError;
        document.querySelector('[data-view="chats"]')?.click();
        await renderChats();
        await openConversation(conversation.id);
      } catch (error) { alert(error.message); }
    }));
    if (search) search.innerHTML = "";
    const incoming = await friendships.incoming();
    const reqList = el("reqList");
    if (el("reqCard")) el("reqCard").hidden = !incoming.length;
    if (el("reqCount")) el("reqCount").textContent = incoming.length ? String(incoming.length) : "";
    if (reqList) reqList.innerHTML = incoming.map(row => '<div class="friend-row"><span>' + esc(row.requester_id.slice(0,8)) + '</span><button class="btn primary" data-accept="' + esc(row.requester_id) + '">Accept</button></div>').join("");
    reqList?.querySelectorAll("[data-accept]").forEach(button => button.addEventListener("click", async () => {
      try { await friendships.setStatus(button.dataset.accept, "accepted"); await renderFriends(); }
      catch (error) { alert(error.message); }
    }));
  } catch (error) { fail(list, error); }
}

async function searchPeople() {
  const term = el("friendSearch")?.value.trim();
  const target = el("searchResults");
  if (!term || !target) return;
  target.innerHTML = "<p>Searching…</p>";
  try {
    const safe = term.replace(/[%,()]/g, "");
    const { data, error } = await supabase.from("murmur_public_profiles")
      .select("id,public_id,username,display_name,avatar_url")
      .or("username.ilike.%" + safe + "%,display_name.ilike.%" + safe + "%,public_id.eq." + safe)
      .limit(20);
    if (error) throw error;
    const { data: authData } = await supabase.auth.getUser();
    target.innerHTML = (data || []).filter(p => p.id !== authData.user?.id).map(p =>
      '<div class="friend-row"><div><strong>' + esc(p.display_name || "Murmur user") + '</strong><small>@' + esc(p.username || "") + ' · ID ' + esc(p.public_id || "") + '</small></div><button class="btn secondary" data-request="' + esc(p.id) + '">Add friend</button></div>'
    ).join("") || '<p class="empty-state">No people found.</p>';
    target.querySelectorAll("[data-request]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await friendships.request(button.dataset.request); button.textContent = "Request sent"; }
      catch (error) { button.disabled = false; alert(error.message); }
    }));
  } catch (error) { fail(target, error); }
}

async function renderStories() {
  const root = el("storiesRow");
  if (!root) return;
  try {
    const rows = await stories.list();
    const displayRows = await Promise.all(rows.map(async story => ({
      ...story,
      signedMediaUrl: story.media_path ? await storage.url("murmur-stories", story.media_path) : null
    })));
    root.innerHTML = '<div class="story-heading"><strong>Stories</strong> <button type="button" class="btn secondary" data-add-story>Share a story</button></div>' + (displayRows.length ? displayRows.map(s => '<article class="story-card">' + (s.signedMediaUrl ? (s.media_type === "video" ? '<video controls playsinline preload="metadata" src="' + esc(s.signedMediaUrl) + '"></video>' : '<img loading="lazy" src="' + esc(s.signedMediaUrl) + '" alt="Story media">') : '') + '<strong>' + esc(s.content || "Story") + '</strong><small>' + esc(new Date(s.created_at).toLocaleString()) + '</small></article>').join("") : '<p class="empty-state">No active stories.</p>');
    root.querySelector("[data-add-story]")?.addEventListener("click", () => {
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
    });
  } catch (error) { fail(root, error); }
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
    const rows = await userNotes.listMine();
    root.innerHTML = '<div class="note-heading"><strong>Your notes</strong> <button type="button" class="btn secondary" data-add-note>New note</button></div>' + (rows.map(n => '<article class="note-card">' + esc(n.content) + '</article>').join("") || '<p class="empty-state">You have no active notes.</p>');
    root.querySelector("[data-add-note]")?.addEventListener("click", async () => {
      const content = prompt("Write a note (up to 500 characters):");
      if (!content?.trim()) return;
      try { await userNotes.create({ content }); await renderNotes(); } catch (error) { alert(error.message); }
    });
  } catch (error) { fail(root, error); }
}

async function renderAlerts() {
  const root = el("alertsList");
  if (!root) return;
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const { data, error } = await supabase.from("notifications")
      .select("id,kind,content,read_at,created_at")
      .eq("recipient_id", userData.user.id)
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    const { data: announcements, error: announcementError } = await supabase.from("announcements")
      .select("id,title,body,kind,published_at")
      .lte("published_at", new Date().toISOString())
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(20);
    if (announcementError) throw announcementError;
    const announcementHtml = (announcements || []).map(a => '<article class="alert-row admin-announcement"><strong>From Admin of Murmur</strong><h3>' + esc(a.title) + '</h3><p>' + esc(a.body) + '</p><small>' + esc(new Date(a.published_at).toLocaleString()) + '</small></article>').join("");
    const notificationHtml = (data || []).map(n => '<article class="alert-row" data-alert-id="' + esc(n.id) + '"><strong>' + esc(n.kind || "Alert") + '</strong><p>' + esc(n.content) + '</p><small>' + esc(new Date(n.created_at).toLocaleString()) + (n.read_at ? ' · Read' : ' · Unread') + '</small>' + (!n.read_at ? '<button class="btn secondary" type="button" data-mark-alert="' + esc(n.id) + '">Mark read</button>' : '') + '</article>').join("");
    root.innerHTML = announcementHtml + notificationHtml || '<p class="empty-state">You are all caught up.</p>';
    root.querySelectorAll("[data-mark-alert]").forEach(button => button.addEventListener("click", async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const { error: updateError } = await supabase.from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", button.dataset.markAlert).eq("recipient_id", userData.user.id);
        if (updateError) throw updateError;
        await renderAlerts();
      } catch (error) { alert(error.message); }
    }));
    const unread = (data || []).filter(n => !n.read_at).length;
    if (el("alertsBadge")) { el("alertsBadge").hidden = !unread; el("alertsBadge").textContent = unread ? String(unread) : ""; }
    if (el("alertsUnreadCount")) el("alertsUnreadCount").textContent = String(unread);
  } catch (error) { fail(root, error); }
}

async function renderChats() {
  const root = el("chatList");
  if (!root) return;
  try {
    const rows = await conversations.list();
    root.innerHTML = rows.map(c => '<button class="chat-list-item" type="button" data-conversation="' + esc(c.id) + '">Conversation · ' + esc(c.id.slice(0,8)) + '</button>').join("") || '<p class="empty-state">Your conversations will appear here.</p>';
    root.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => openConversation(button.dataset.conversation)));
  } catch (error) { fail(root, error); }
}
async function openConversation(id) {
  const root = el("messages");
  if (!root) return;
  root.dataset.conversationId = id;
  if (messageChannel) supabase.removeChannel(messageChannel);
  messageChannel = supabase.channel("murmur-chat-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq." + id }, () => openConversation(id))
    .subscribe();
  try {
    const rows = await messages.list(id);
    root.innerHTML = rows.reverse().map(m => '<article class="message-row">' + esc(m.content) + '</article>').join("") || '<p class="empty-state">Start the conversation.</p>';
    el("chatName") && (el("chatName").textContent = "Conversation");
  } catch (error) { fail(root, error); }
}
async function sendChatMessage() {
  const root = el("messages");
  const id = root?.dataset.conversationId;
  const input = el("messageInput");
  if (!id || !input?.value.trim()) return;
  try { await messages.send({ conversationId: id, content: input.value.trim() }); input.value = ""; await openConversation(id); }
  catch (error) { alert(error.message); }
}

export function initSupabaseSocial() {
  el("friendSearchBtn")?.addEventListener("click", searchPeople);
  el("friendSearch")?.addEventListener("keydown", event => { if (event.key === "Enter") searchPeople(); });
  el("sendBtn")?.addEventListener("click", sendChatMessage);
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
  el("frSearchIcon")?.addEventListener("click", () => { el("findBlock") && (el("findBlock").hidden = false); el("friendSearch")?.focus(); });
  window.addEventListener("murmur:supabase-user-ready", async () => {
    if (socialChannel) supabase.removeChannel(socialChannel);
    socialChannel = supabase.channel("murmur-social-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, renderAlerts)
      .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, renderStories)
      .on("postgres_changes", { event: "*", schema: "public", table: "reels" }, renderReels)
      .subscribe();
    await Promise.all([renderFriends(), renderStories(), renderReels(), renderNotes(), renderAlerts(), renderChats()]);
  });
  window.addEventListener("murmur:supabase-signed-out", () => {
    if (socialChannel) supabase.removeChannel(socialChannel);
    if (messageChannel) supabase.removeChannel(messageChannel);
    socialChannel = null; messageChannel = null;
  });
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.view === "friends") renderFriends();
    if (button.dataset.view === "reels") renderReels();
    if (button.dataset.view === "chats") renderChats();
    if (button.dataset.view === "alerts") renderAlerts();
  }));
}
