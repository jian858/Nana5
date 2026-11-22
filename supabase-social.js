/* Supabase-only social features for Murmur. */
import { supabase } from "./supabase-client.js?v=20261122-2";
import { friendships, reels, conversations, messages, storage } from "./supabase-data.js?v=20261122-4";
import { renderStories } from "./tabs/stories.js";
import { renderReels } from "./tabs/reels.js";
import { renderNotes } from "./tabs/notes.js";
import { renderAlerts, setAlertFilter } from "./tabs/notifications.js?v=20261122-3";
import { renderFriends, searchPeople } from "./tabs/friends.js?v=20261122-3";

const el = id => document.getElementById(id);
let socialChannel = null;
let messageChannel = null;
let presenceChannel = null;
let onlineUserIds = new Set();
let chatListRenderRun = 0;
let cachedConversationByPerson = new Map();
let messageRenderRun = 0;
let sendingMessage = false;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };

// Chat list rendering uses this helper locally; avatarMarkup in supabase-app.js
// is scoped to that module and cannot be accessed from this file.
const avatarMarkup = (person = {}, label = "Profile picture") => {
  const name = person.display_name || person.username || "Murmur user";
  const initial = esc(String(name).trim().charAt(0).toUpperCase() || "?");
  const fallback = '<span class="avatar chat-list-avatar-fallback" aria-hidden="true">' + initial + '</span>';
  const image = person.avatar_url
    ? '<img class="avatar chat-list-avatar-image" src="' + esc(person.avatar_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
    : "";
  return '<span class="chat-list-avatar" role="img" aria-label="' + esc(label) + '" style="display:inline-grid;position:relative;flex:0 0 42px;width:42px;height:42px;border-radius:50%;overflow:hidden;vertical-align:middle">' + fallback.replace('class="avatar chat-list-avatar-fallback"', 'class="avatar chat-list-avatar-fallback" style="grid-area:1/1;width:100%;height:100%;display:grid;place-items:center"') + image.replace('class="avatar chat-list-avatar-image"', 'class="avatar chat-list-avatar-image" style="grid-area:1/1;position:absolute;inset:0;width:100%;height:100%;object-fit:cover"') + '</span>';
};

export async function openDirectChat(targetUserId) {
  const targetId = String(targetUserId || "").trim();
  if (!targetId) throw new Error("Choose an account before opening a conversation.");

  // Switch views directly instead of relying on a navigation click. This also
  // works when opening a chat from a dynamically-created profile pane.
  const chatsPane = document.querySelector('[data-pane="chats"]');
  if (!chatsPane) throw new Error("The Chats screen is unavailable. Reload Murmur and try again.");
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

  document.body.classList.add("chat-open");
  const layout = document.querySelector(".chat-layout");
  layout?.classList.add("open");
  const root = el("messages");
  if (root) {
    root.dataset.conversationId = "";
    root.setAttribute("aria-busy", "true");
    root.innerHTML = '<div class="murmur-chat-loading" role="status"><span class="murmur-chat-loader" aria-hidden="true"></span><span>Opening conversation…</span></div>';
  }
  const status = el("chatSendStatus");
  if (status) status.textContent = "Opening conversation…";

  try {
    // Reuse a conversation already loaded in the chat list; avoid an extra RPC round-trip.
    let resolvedId = cachedConversationByPerson.get(targetId) || null;
    if (!resolvedId) {
      const { data, error } = await supabase.rpc("start_murmur_direct_conversation", {
        p_target_user_id: targetId
      });
      if (error) throw error;
      resolvedId = typeof data === "string" ? data : Array.isArray(data) ? data[0] : data?.id;
    }
    if (!resolvedId || typeof resolvedId !== "string") {
      throw new Error("Murmur could not create or find this conversation. Please try again.");
    }
    await openConversation(resolvedId);
    if (status) status.textContent = "";
    return resolvedId;
  } catch (error) {
    const message = error?.message || "Could not open this conversation. Please try again.";
    if (root) {
      root.dataset.conversationId = "";
      root.innerHTML = '<div class="empty-state" role="alert"><p>Could not open this chat.</p><small>' + esc(message) + '</small><button type="button" class="btn secondary" data-retry-chat-user="' + esc(targetId) + '">Try again</button></div>';
    }
    if (status) status.textContent = message;
    throw error;
  }
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
      .select("id,username,display_name,avatar_url,is_verified")
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
  const run = ++chatListRenderRun;
  if (!root.innerHTML.trim()) root.innerHTML = '<p class="empty-state">Loading friends and conversations…</p>';
  try {
    const [{ data: authData, error: authError }, rows, friendRows] = await Promise.all([
      supabase.auth.getUser(), conversations.list(), friendships.people("accepted")
    ]);
    if (authError) throw authError;
    const currentUserId = authData.user?.id;
    if (!currentUserId) throw new Error("Sign in again to view your chats.");
    const ids = rows.map(row => row.id);
    // Load one latest message per conversation. A single global limit can
    // accidentally hide previews for older conversations with busy threads.
    const [peopleByConversation, latestResults] = await Promise.all([
      getConversationPeople(ids, currentUserId),
      Promise.all(ids.map(async conversationId => {
        const { data, error } = await supabase.from("messages")
          .select("conversation_id,content,created_at,sender_id,media_type")
          .eq("conversation_id", conversationId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        return data?.[0] || null;
      }))
    ]);
    if (run !== chatListRenderRun) return;
    const latestByConversation = new Map();
    latestResults.forEach(message => {
      if (message) latestByConversation.set(message.conversation_id, message);
    });
    const conversationByPerson = new Map();
    for (const conversation of rows) {
      const person = peopleByConversation.get(conversation.id);
      if (person?.id) conversationByPerson.set(person.id, conversation);
    }
    cachedConversationByPerson = new Map(
      [...conversationByPerson].map(([personId, conversation]) => [personId, conversation.id])
    );
    const friendIds = new Set();
    const friendItems = (friendRows || []).map(row => row.person).filter(person => {
      if (!person?.id || person.id === currentUserId || friendIds.has(person.id)) return false;
      friendIds.add(person.id); return true;
    }).map(person => {
      const conversation = conversationByPerson.get(person.id);
      const last = conversation ? latestByConversation.get(conversation.id) : null;
      const preview = last ? (last.sender_id === currentUserId ? "You: " : "") + (last.content || (last.media_type ? "Attachment" : "Message")) : "Start a conversation";
      const online = onlineUserIds.has(person.id);
      return '<button class="chat-list-item murmur-friend-chat' + (conversation && activeConversationId === conversation.id ? ' active' : '') + '" type="button" ' +
        (conversation ? 'data-conversation="' + esc(conversation.id) + '"' : 'data-chat-user="' + esc(person.id) + '"') +
        ' aria-label="Message ' + esc(person.display_name || person.username || "friend") + '">' +
        avatarMarkup(person, "Friend profile picture") +
        '<span class="chat-list-copy"><strong>' + esc(person.display_name || (person.username ? "@" + person.username : "Friend")) + (person.is_verified ? ' <span class="murmur-verified-badge" title="Verified by Murmur" aria-label="Verified by Murmur"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 12.2 3l2.7-.1 1.1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1.1 2.5-2.7-.1L10 17.5 7.8 16l-2.7.1L4 13.6l-2.3-1.4.6-2.7-.6-2.7L4 5.4l1.1-2.5 2.7.1z"/><path d="m6.6 10 2.2 2.2 4.7-4.7"/></svg></span>' : '') + '</strong><small>' + esc(preview) + '</small></span>' +
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
        avatarMarkup(person, "Profile picture") + '<span class="chat-list-copy"><strong>' + esc(name) + (person.is_verified ? ' <span class="murmur-verified-badge" title="Verified by Murmur" aria-label="Verified by Murmur"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 12.2 3l2.7-.1 1.1 2.5 2.3 1.4-.6 2.7.6 2.7-2.3 1.4-1.1 2.5-2.7-.1L10 17.5 7.8 16l-2.7.1L4 13.6l-2.3-1.4.6-2.7-.6-2.7L4 5.4l1.1-2.5 2.7.1z"/><path d="m6.6 10 2.2 2.2 4.7-4.7"/></svg></span>' : '') + '</strong><small>' + esc(preview) + '</small></span>' +
        '<span class="murmur-presence ' + (online ? 'is-online' : 'is-offline') + '"><i></i>' + (online ? 'Online' : 'Offline') + '</span></button>';
    });
    if (run !== chatListRenderRun) return;
    root.innerHTML = friendItems.concat(otherItems).join("") || '<p class="empty-state">Add friends to see them here and start a chat.</p>';
    root.querySelectorAll("[data-conversation]").forEach(button => button.addEventListener("click", () => openConversation(button.dataset.conversation)));

  } catch (error) {
    if (run !== chatListRenderRun) return;
    fail(root, error);
    const retry = document.createElement("button"); retry.type = "button"; retry.className = "btn secondary"; retry.textContent = "Try again";
    retry.addEventListener("click", renderChats, { once: true }); root.appendChild(retry);
  }
}

async function renderConversationMessages(conversationId, prefetched = null) {
  const root = el("messages");
  if (!root || root.dataset.conversationId !== conversationId) return;
  const run = ++messageRenderRun;
  try {
    let rows = prefetched?.rows;
    let currentUserId = prefetched?.currentUserId;
    if (!rows || !currentUserId) {
      const [{ data: sessionData, error: sessionError }, fetchedRows] = await Promise.all([
        supabase.auth.getSession(),
        messages.list(conversationId)
      ]);
      if (sessionError) throw sessionError;
      rows = fetchedRows;
      currentUserId = sessionData?.session?.user?.id;
    }
    if (run !== messageRenderRun || root.dataset.conversationId !== conversationId) return;
    root.removeAttribute("aria-busy");
    root.innerHTML = rows.length ? rows.slice().reverse().map(message => {
      const mine = message.sender_id === currentUserId;
      return '<article class="message-row' + (mine ? ' mine' : '') + '" data-message-id="' + esc(message.id) + '">' +
        '<p>' + esc(message.content || (message.media_type ? "Attachment" : "")) + '</p>' +
        '<time datetime="' + esc(message.created_at) + '">' + esc(new Date(message.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})) + '</time></article>';
    }).join("") : '<p class="empty-state">No messages yet. Send the first message.</p>';
    root.scrollTop = root.scrollHeight;
  } catch (error) {
    if (run !== messageRenderRun || root.dataset.conversationId !== conversationId) return;
    fail(root, error);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn secondary";
    retry.textContent = "Reload messages";
    retry.addEventListener("click", () => renderConversationMessages(conversationId), { once: true });
    root.appendChild(retry);
  }
}

let conversationOpenRun = 0;
let typingChannel = null;
let typingResetTimer = null;
let typingPeerIsActive = false;
let typingIsPublished = false;

function showTypingStatus(isTyping) {
  typingPeerIsActive = Boolean(isTyping);
  const status = el("chatStatus");
  if (!status) return;
  if (typingPeerIsActive) {
    status.innerHTML = '<span class="murmur-typing-label">Typing<span class="murmur-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>';
  } else {
    status.textContent = activeConversationPerson?.username ? "@" + activeConversationPerson.username : "Private chat";
  }
}

function stopConversationTyping() {
  if (typingResetTimer) clearTimeout(typingResetTimer);
  typingResetTimer = null;
  if (typingChannel) supabase.removeChannel(typingChannel);
  typingChannel = null;
  typingPeerIsActive = false;
  typingIsPublished = false;
}

async function setConversationTyping(isTyping) {
  if (!typingChannel || typingIsPublished === Boolean(isTyping)) return;
  typingIsPublished = Boolean(isTyping);
  try {
    await typingChannel.send({
      type: "broadcast",
      event: "typing",
      payload: { typing: typingIsPublished }
    });
  } catch (error) {
    console.warn("[Murmur typing] Could not broadcast typing status:", error);
  }
}

function startConversationTyping(conversationId) {
  stopConversationTyping();
  if (!conversationId) return;
  const channel = supabase.channel("murmur-typing-" + conversationId);
  typingChannel = channel;
  channel.on("broadcast", { event: "typing" }, ({ payload }) => {
    if (typingChannel !== channel) return;
    showTypingStatus(payload?.typing === true);
  });
  channel.subscribe();
}

async function openConversation(id) {
  const root = el("messages");
  if (!root || !id) return;
  const run = ++conversationOpenRun;
  stopConversationTyping();
  activeConversationId = id;
  root.dataset.conversationId = id;
  for (const id of ["chatProfileBtn", "chatBlockBtn"]) {
    const button = el(id);
    if (button) {
      button.hidden = true;
      delete button.dataset.openProfile;
      delete button.dataset.blockUserId;
    }
  }
  root.setAttribute("aria-busy", "true");
  root.innerHTML = '<div class="murmur-chat-loading" role="status"><span class="murmur-chat-loader" aria-hidden="true"></span><span>Loading conversation…</span></div>';
  document.body.classList.add("chat-open");
  document.querySelector(".chat-layout")?.classList.add("open");
  el("chatName") && (el("chatName").textContent = "Loading chat…");
  el("chatStatus") && (el("chatStatus").textContent = "Connecting…");
  try {
    // Fetch identity, participants, and the first message page together.
    // Previously message loading waited for a separate profile request.
    const [{ data: sessionData, error: sessionError }, members, firstMessages] = await Promise.all([
      supabase.auth.getSession(),
      conversations.members(id),
      messages.list(id)
    ]);
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
    if (sessionError) throw sessionError;
    const currentUserId = sessionData?.session?.user?.id;
    if (!currentUserId) throw new Error("Sign in again to view this conversation.");
    const otherId = (members || []).find(member => member.user_id !== currentUserId)?.user_id;
    // Paint messages immediately; profile details can finish loading afterward.
    await renderConversationMessages(id, { rows: firstMessages, currentUserId });
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;

    // Make the composer and live updates available as soon as messages are visible.
    startConversationTyping(id);
    if (messageChannel) supabase.removeChannel(messageChannel);
    messageChannel = supabase.channel("murmur-chat-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq." + id },
        () => { if (root.dataset.conversationId === id) void renderConversationMessages(id); })
      .subscribe();
    conversations.markRead(id).catch(error => console.warn("[Murmur chat] Could not update read state:", error));
    el("messageInput")?.focus();

    const personPromise = otherId
      ? supabase.from("murmur_public_profiles")
          .select("id,username,display_name,avatar_url")
          .eq("id", otherId).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const { data: person, error: personError } = await personPromise;
    if (personError) throw personError;
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
    activeConversationPerson = person || null;
    const name = activeConversationPerson?.display_name || activeConversationPerson?.username || "Conversation";
    if (el("chatName")) el("chatName").textContent = name;
    if (el("chatStatus")) el("chatStatus").textContent = activeConversationPerson?.username ? "@" + activeConversationPerson.username : "Private chat";
    const profileButton = el("chatProfileBtn");
    if (profileButton) {
      if (activeConversationPerson?.id) {
        profileButton.dataset.openProfile = activeConversationPerson.id;
        profileButton.hidden = false;
      } else {
        delete profileButton.dataset.openProfile;
        profileButton.hidden = true;
      }
    }
    const blockButton = el("chatBlockBtn");
    if (blockButton) {
      if (activeConversationPerson?.id) {
        blockButton.dataset.blockUserId = activeConversationPerson.id;
        blockButton.hidden = false;
      } else {
        delete blockButton.dataset.blockUserId;
        blockButton.hidden = true;
      }
    }
    if (el("chatAvatar")) {
      const person = activeConversationPerson;
      el("chatAvatar").innerHTML = person?.avatar_url
        ? '<img src="' + esc(person.avatar_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.remove()">'
        : esc(name.slice(0,1).toUpperCase());
    }

  } catch (error) {
    if (run !== conversationOpenRun || root.dataset.conversationId !== id) return;
    root.innerHTML = '<div class="empty-state" role="alert"><p>This conversation could not be opened.</p><small>' + esc(error.message || "Please check your connection and try again.") + '</small><button type="button" class="btn secondary" data-retry-conversation>Try again</button></div>';
    root.querySelector("[data-retry-conversation]")?.addEventListener("click", () => openConversation(id), { once: true });
  }
}

async function sendChatMessage() {
  if (sendingMessage) return;
  const root = el("messages");
  const id = root?.dataset.conversationId;
  const input = el("messageInput");
  const button = el("sendBtn");
  const status = el("chatSendStatus");
  const content = input?.value.trim();
  if (!id) {
    if (status) status.textContent = "Open a conversation before sending a message.";
    return;
  }
  if (!content) {
    input?.focus();
    return;
  }
  if (typingResetTimer) clearTimeout(typingResetTimer);
  typingResetTimer = null;
  sendingMessage = true;
  await setConversationTyping(false);
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  if (status) status.textContent = "Sending…";
  const optimisticId = "pending-" + Date.now();
  const optimistic = document.createElement("article");
  optimistic.className = "message-row mine is-pending";
  optimistic.dataset.messageId = optimisticId;
  const body = document.createElement("p");
  body.textContent = content;
  const time = document.createElement("time");
  time.textContent = "Sending…";
  optimistic.append(body, time);
  root.querySelector(".empty-state")?.remove();
  root.append(optimistic);
  root.scrollTop = root.scrollHeight;
  input.value = "";
  try {
    await messages.send({ conversationId: id, content });
    // Push delivery runs independently so a slow/offline recipient never delays sending.
    void supabase.functions.invoke("murmur-push", {
      body: { action: "notify", conversation_id: id }
    }).then(({ error }) => {
      if (error) console.warn("[Murmur push] Message notification was not delivered:", error.message);
    }).catch(error => console.warn("[Murmur push] Message notification failed:", error));
    if (status) status.textContent = "Sent";
    await renderConversationMessages(id);
    void renderChats();
  } catch (error) {
    console.error("[Murmur message send]", error);
    optimistic.remove();
    input.value = content;
    input.focus();
    if (status) status.textContent = error.message || "Message failed to send. Your text was restored.";
  } finally {
    sendingMessage = false;
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
    input?.focus();
  }
}

export function initSupabaseSocial() {
  if (el("chatProfileBtn")) el("chatProfileBtn").hidden = true;
  if (el("chatBlockBtn")) el("chatBlockBtn").hidden = true;
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
    setAlertFilter(button.dataset.alertFilter || "all");
  }));

  // One delegated handler supports account rows created after async searches,
  // friend-list refreshes, and profile navigation.
  document.addEventListener("click", async event => {
    const action = event.target.closest("[data-chat-user], [data-retry-chat-user]");
    if (!action || action.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const targetId = action.dataset.chatUser || action.dataset.retryChatUser;
    action.disabled = true;
    const originalText = action.textContent;
    try {
      await openDirectChat(targetId);
    } catch (error) {
      console.error("[Murmur open chat]", error);
      const status = el("chatSendStatus");
      if (status) status.textContent = error?.message || "Could not open this chat.";
    } finally {
      action.disabled = false;
      if (action.dataset.retryChatUser) action.textContent = "Try again";
      else if (originalText) action.textContent = originalText;
    }
  });
  el("friendSearchBtn")?.addEventListener("click", searchPeople);
  el("friendSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); searchPeople(); }
  });
  const chatComposer = el("chatComposer");
  const sendButton = el("sendBtn");
  const messageInput = el("messageInput");
  // Handle both the explicit Send tap and native form submission. Some mobile
  // browsers/PWA keyboards do not consistently dispatch submit for this
  // dynamically displayed composer, so the button has its own guarded path.
  sendButton?.addEventListener("click", event => {
    event.preventDefault();
    void sendChatMessage();
  });
  chatComposer?.addEventListener("submit", event => {
    event.preventDefault();
    void sendChatMessage();
  });
  messageInput?.addEventListener("input", () => {
    if (typingResetTimer) clearTimeout(typingResetTimer);
    const isTyping = Boolean(messageInput.value.trim());
    void setConversationTyping(isTyping);
    if (isTyping) typingResetTimer = setTimeout(() => { void setConversationTyping(false); }, 1800);
  });
  messageInput?.addEventListener("blur", () => { if (typingResetTimer) clearTimeout(typingResetTimer); typingResetTimer = null; void setConversationTyping(false); });
  messageInput?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendChatMessage();
    }
  });
  el("chatSettingsBtn")?.addEventListener("click", () => {
    const menu=document.createElement("div"); menu.className="chat-settings-popover";
    menu.innerHTML='<strong>Message settings</strong><p>Manage blocked people in Settings.</p><button type="button" class="btn secondary" data-chat-settings-close>Close</button>';
    document.querySelector(".chat-settings-popover")?.remove(); document.querySelector('[data-pane="chats"]')?.append(menu);
    menu.querySelector("[data-chat-settings-close]")?.addEventListener("click",()=>menu.remove());
  });

  window.addEventListener("murmur:view-changed", event => {
    if (event.detail?.view !== "chats") {
      stopConversationTyping();
      document.body.classList.remove("chat-open");
      document.querySelector(".chat-layout")?.classList.remove("open");
    }
  });

  el("chatBack")?.addEventListener("click", () => {
    stopConversationTyping();
    document.body.classList.remove("chat-open");
    document.querySelector(".chat-layout")?.classList.remove("open");
    void renderChats();
  });
  el("chatBlockBtn")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const targetId = button.dataset.blockUserId;
    if (!targetId || button.disabled) return;
    const name = el("chatName")?.textContent || "this account";
    if (!window.confirm("Block " + name + "? This will remove them from your Friends list and stop messages between you.")) return;
    button.disabled = true;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user?.id) throw new Error("Sign in again to block this account.");
      const { error } = await supabase.from("blocks").upsert(
        { blocker_id: authData.user.id, blocked_id: targetId },
        { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
      );
      if (error) throw error;
      if (messageChannel) supabase.removeChannel(messageChannel);
      messageChannel = null;
      activeConversationId = null;
      document.querySelector(".chat-layout")?.classList.remove("open");
      await renderChats();
    } catch (error) {
      alert(error.message || "This account could not be blocked.");
    } finally {
      button.disabled = false;
    }
  });

  // The More menu keeps secondary chat actions available without crowding the header.
  el("chatMoreBtn")?.addEventListener("click", event => {
    event.stopPropagation();
    document.querySelector(".murmur-chat-more-menu")?.remove();
    const profileButton = el("chatProfileBtn");
    const blockButton = el("chatBlockBtn");
    const menu = document.createElement("div");
    menu.className = "murmur-chat-more-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<button type="button" role="menuitem" data-chat-more-profile>View profile</button><button type="button" role="menuitem" data-chat-more-block>Block friend</button>';
    const anchor = el("chatMoreBtn");
    anchor?.insertAdjacentElement("afterend", menu);
    menu.querySelector("[data-chat-more-profile]")?.addEventListener("click", () => {
      menu.remove();
      if (profileButton && !profileButton.hidden) profileButton.click();
    });
    menu.querySelector("[data-chat-more-block]")?.addEventListener("click", () => {
      menu.remove();
      if (blockButton && !blockButton.hidden) blockButton.click();
    });
    const closeMenu = e => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener("click", closeMenu);
      }
    };
    document.addEventListener("click", closeMenu);
  });

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
      const channel = supabase.channel("murmur-presence", { config: { presence: { key: presenceUserId } } });
      presenceChannel = channel;
      channel
        .on("presence", { event: "sync" }, () => {
          if (presenceChannel !== channel) return;
          onlineUserIds = new Set(Object.keys(channel.presenceState() || {}));
          void renderChats();
        })
        .subscribe(async status => {
          if (presenceChannel === channel && status === "SUBSCRIBED") {
            await channel.track({ user_id: presenceUserId, online_at: new Date().toISOString() });
          }
        });
    }
    if (socialChannel) supabase.removeChannel(socialChannel);
    socialChannel = supabase.channel("murmur-social-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, renderAlerts)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, renderChats)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, renderChats)
      // Refresh chat-list previews even when the conversation is not open.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, renderChats)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, renderChats)
      .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, renderStories)
      .on("postgres_changes", { event: "*", schema: "public", table: "reels" }, renderReels)
      .subscribe();
    await Promise.all([renderFriends(), renderStories(), renderReels(), renderNotes(), renderAlerts(), renderChats()]);
  });
  window.addEventListener("murmur:supabase-signed-out", () => {
    if (socialChannel) supabase.removeChannel(socialChannel);
    if (messageChannel) supabase.removeChannel(messageChannel);
    stopConversationTyping();
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
