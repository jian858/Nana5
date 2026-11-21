/* Supabase-only social features for Murmur. */
import { supabase } from "./supabase-client.js";
import { friendships, stories, reels, userNotes, conversations, messages, comments } from "./supabase-data.js";

const el = id => document.getElementById(id);
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
      return '<article class="friend-row"><span class="avatar">' + esc((p.display_name || "?").slice(0,1).toUpperCase()) + '</span><div><strong>' + esc(p.display_name || "Murmur user") + '</strong><small>@' + esc(p.username || "") + '</small></div></article>';
    }).join("") : '<p class="empty-state">Your friends will appear here.</p>';
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
    const { data, error } = await supabase.from("profiles")
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
    root.innerHTML = '<div class="story-heading">Stories</div>' + (rows.length ? rows.map(s => '<article class="story-card"><strong>' + esc(s.content || "Story") + '</strong><small>' + esc(new Date(s.created_at).toLocaleString()) + '</small></article>').join("") : '<p class="empty-state">No active stories.</p>');
  } catch (error) { fail(root, error); }
}

async function renderReels() {
  const root = el("reelsFeed");
  if (!root) return;
  try {
    const rows = await reels.list();
    root.innerHTML = rows.map(r => '<article class="reel-card"><video controls playsinline preload="metadata" src="' + esc(r.video_url) + '"></video><strong>' + esc(r.title || "Reel") + '</strong><p>' + esc(r.caption || "") + '</p></article>').join("") || '<p class="empty-state">No reels yet.</p>';
  } catch (error) { fail(root, error); }
}

async function renderNotes() {
  const root = el("noteRow");
  if (!root) return;
  try {
    const rows = await userNotes.listMine();
    root.innerHTML = rows.map(n => '<article class="note-card">' + esc(n.content) + '</article>').join("") || '<p class="empty-state">You have no active notes.</p>';
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
    root.innerHTML = (data || []).map(n => '<article class="alert-row"><strong>' + esc(n.kind || "Alert") + '</strong><p>' + esc(n.content) + '</p><small>' + esc(new Date(n.created_at).toLocaleString()) + '</small></article>').join("") || '<p class="empty-state">You are all caught up.</p>';
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
  el("noteRow")?.addEventListener("dblclick", async () => {
    const content = prompt("Write a note (up to 500 characters):");
    if (!content?.trim()) return;
    try { await userNotes.create({ content }); await renderNotes(); } catch (error) { alert(error.message); }
  });
  el("reelCreateBtn")?.addEventListener("click", () => alert("Reel publishing will be enabled after the Supabase video upload flow is configured."));
  el("frSearchIcon")?.addEventListener("click", () => { el("findBlock") && (el("findBlock").hidden = false); el("friendSearch")?.focus(); });
  window.addEventListener("murmur:supabase-user-ready", async () => {
    await Promise.all([renderFriends(), renderStories(), renderReels(), renderNotes(), renderAlerts(), renderChats()]);
  });
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.view === "friends") renderFriends();
    if (button.dataset.view === "reels") renderReels();
    if (button.dataset.view === "chats") renderChats();
    if (button.dataset.view === "alerts") renderAlerts();
  }));
}
