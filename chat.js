/* =====================================================================
   CHAT  -  list of chats, open a chat, messages
   ===================================================================== */
function renderChats() {
  const list = document.getElementById('chatList');
  const f = chatFriends();
  list.innerHTML = f.length ? '' : '<div class="empty">Add a friend to start chatting.</div>';
  f.forEach((d, idx) => {
    const o = otherOf(d);
    const item = document.createElement('button');
    item.style.setProperty('--i', Math.min(idx, 8));
    item.type = 'button';
    item.className = 'chat-item' + (activeChatUid === o.uid ? ' active' : '');
    item.innerHTML = `<div class="avatar-wrap">${avatarHtml(o.uid, o.name)}<span class="active-dot${isActive(o.uid) ? '' : ' off'}"></span></div><div style="flex:1;min-width:0;text-align:left"><h4>${esc(o.name)}</h4><p class="${isActive(o.uid) ? 'st-on' : 'st-off'}">${isActive(o.uid) ? CONFIG.text.online : CONFIG.text.offline} · ${esc(o.username)}</p></div>`;
    item.addEventListener('click', () => openChat(o.uid));
    list.appendChild(item);
  });
  renderNoteRow();
  renderActiveRow();
  document.querySelector('.chat-layout').classList.toggle('open', !!activeChatUid);
  const cur = f.map(otherOf).find(o => o.uid === activeChatUid);
  const ca = document.getElementById('chatAvatar');
  ca.textContent = cur ? initials(cur.name) : '?'; ca.style.backgroundImage = '';
  if (cur) setBg(ca, photoFor(cur.uid));
  document.getElementById('chatName').textContent = cur ? cur.name : 'No chat selected';
  const profileButton = document.getElementById('chatProfileBtn');
  if (profileButton) {
    profileButton.dataset.profileUid = cur?.uid || '';
    profileButton.disabled = !cur;
  }
  const on = !!cur && isActive(cur.uid);
  const dot = document.getElementById('chatDot'), st = document.getElementById('chatStatus');
  dot.hidden = !cur; dot.className = 'active-dot' + (on ? '' : ' off');
  st.textContent = cur ? (on ? CONFIG.text.online : CONFIG.text.offline) : 'Pick a friend to message';
  st.className = cur ? (on ? 'st-on' : 'st-off') : '';
}

/* =====================================================================
   CHAT SESSION  -  everything that runs while a chat is open: messages, "typing…" and "Seen"
   Saved in chats/<chatId>/  messages/...,  typing/<uid> = a number that changes while that person types,
   seen/<uid> = when that person last read the chat (server time, so clocks never matter).
   ===================================================================== */
let unsubTyping = null, unsubSeen = null, otherTyping = false, otherSeenAt = 0, typingHide = null, typingStop = null, lastTypingSent = 0, lastSeenWrite = 0, chatSessionToken = 0, sendingMessage = false;
const chatPath = () => `chats/${chatIdOf(meUid(), activeChatUid)}`;
function stopTyping() {
  clearTimeout(typingStop); lastTypingSent = 0;
  if (activeChatUid && auth.currentUser) remove(ref(db, `${chatPath()}/typing/${meUid()}`)).catch(() => {});
}
function stopChatSession() {
  // Invalidate queued callbacks before unsubscribing so an old chat cannot overwrite the new one.
  chatSessionToken++;
  if (activeChatUid) stopTyping();
  [unsubMsgs, unsubTyping, unsubSeen].forEach(unsubscribe => { if (typeof unsubscribe === 'function') unsubscribe(); });
  unsubMsgs = unsubTyping = unsubSeen = null;
  clearTimeout(typingHide);
  activeChatUid = null; chatMsgs = []; otherTyping = false; otherSeenAt = 0; lastSeenWrite = 0;
  convShownFor = null; convShownCount = 0;
}
async function startChatSession(uid) {
  if (!uid || uid === meUid()) return;
  stopChatSession();
  activeChatUid = uid;
  const token = chatSessionToken;
  const base = chatPath();

  // Create immutable participant metadata for new chats. Existing chats are
  // readable only if Firebase confirms that this account is already a member.
  try {
    const participantsRef = ref(db, base + '/participants');
    try {
      await set(participantsRef, { [meUid()]: true, [uid]: true });
    } catch (_) {
      // Expected for an existing chat: its participants node is create-only.
    }
    const membership = await get(participantsRef);
    const participants = membership.val() || {};
    if (participants[meUid()] !== true || participants[uid] !== true) {
      throw new Error('This account is not a participant in this conversation.');
    }
  } catch (error) {
    if (token !== chatSessionToken || activeChatUid !== uid) return;
    console.warn('Chat membership could not be verified:', error);
    showToast(friendlyError(error, 'Could not open this conversation.'));
    activeChatUid = null;
    renderConversation();
    return;
  }
  if (token !== chatSessionToken || activeChatUid !== uid) return;
  unsubMsgs = onValue(query(ref(db, base + '/messages'), orderByChild('createdAt'), limitToLast(200)), snap => {
    if (token !== chatSessionToken || activeChatUid !== uid) return;
    chatMsgs = Object.entries(snap.val() || {}).map(([id, message]) => ({ id, ...message })).filter(Boolean).sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    renderConversation(); markSeen();
  }, err => {
    if (token !== chatSessionToken || activeChatUid !== uid) return;
    console.warn('Chat unavailable (check Realtime Database rules):', err);
    showToast(friendlyError(err, CONFIG.text.chatLoadFailed));
  });
  unsubTyping = onValue(ref(db, `${base}/typing/${uid}`), snap => {
    if (token !== chatSessionToken || activeChatUid !== uid) return;
    clearTimeout(typingHide);
    otherTyping = snap.exists();
    if (otherTyping) typingHide = setTimeout(() => {
      if (token !== chatSessionToken || activeChatUid !== uid) return;
      otherTyping = false; renderTyping();
    }, 4500);
    renderTyping();
  }, () => {});
  unsubSeen = onValue(ref(db, `${base}/seen/${uid}`), snap => {
    if (token !== chatSessionToken || activeChatUid !== uid) return;
    otherSeenAt = Number(snap.val()) || 0; renderConversation();
  }, () => {});
}
function markSeen() {
  if (!activeChatUid || document.hidden || !auth.currentUser) return;
  const last = [...chatMsgs].reverse().find(m => m.from === activeChatUid);
  if (!last || (last.createdAt || 0) <= lastSeenWrite) return;
  lastSeenWrite = last.createdAt || Date.now();
  set(ref(db, `${chatPath()}/seen/${meUid()}`), serverTimestamp()).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) markSeen(); });
function renderTyping() {
  const box = document.getElementById('messages'); if (!box) return;
  const old = box.querySelector('.bubble.typing');
  if (!otherTyping || !activeChatUid) { if (old) old.remove(); return; }
  if (old) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const b = document.createElement('div');
  b.className = 'bubble typing pop'; b.setAttribute('aria-label', 'typing'); b.innerHTML = '<i></i><i></i><i></i>';
  box.appendChild(b); if (nearBottom) box.scrollTop = box.scrollHeight;
}

function openChat(uid) {
  if (isBlocked(uid)) { showToast('You blocked this person. Unblock them in Menu > Blocked people.'); return; }
  startChatSession(uid);
  if (location.hash !== '#chat') history.pushState(null, '', '#chat');
  renderChats(); renderConversation();
}

let convShownFor = null, convShownCount = 0;
function renderConversation() {
  const box = document.getElementById('messages');
  box.innerHTML = '';
  if (!activeChatUid) { convShownFor = null; convShownCount = 0; box.innerHTML = '<div class="empty">Select a friend to start chatting.</div>'; return; }
  const list = chatMsgs.filter(m => m && ((typeof m.text === 'string' && m.text.trim()) || m.audioUrl) && !(m.from && m.from !== meUid() && isBlocked(m.from)));
  if (!list.length) box.innerHTML = '<div class="empty">No messages yet. Say hi!</div>';
  // first time we show this chat: pop the last few in one after another; afterwards: only brand new ones
  const firstShow = convShownFor !== activeChatUid;
  const from = firstShow ? Math.max(0, list.length - 6) : convShownCount;
  list.forEach((m, i) => {
    const b = document.createElement('div');
    b.className = 'bubble ' + (m.from === meUid() ? 'me' : '') + (i >= from ? ' pop' : '');
    if (i >= from && firstShow) b.style.animationDelay = ((i - from) * 45 + 120) + 'ms';
    if (m.audioUrl) { const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = m.audioUrl; audio.setAttribute('aria-label', 'Voice message'); b.appendChild(audio); }
    if (m.text) { const body = document.createElement('div'); body.textContent = m.text; b.appendChild(body); }
    if (m.id) { b.dataset.messageId = m.id; const reacts = document.createElement('div'); reacts.className = 'message-reactions'; reacts.innerHTML = ['❤️','😂','😮','👍','🔥'].map(emoji => `<button type="button" data-msg-react="${esc(m.id)}" data-emoji="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join(''); b.appendChild(reacts); const chosen = Object.entries(m.reactions || {}).map(([who, emoji]) => `${emoji}`).join(' '); if (chosen) { const summary = document.createElement('small'); summary.className = 'message-reaction-summary'; summary.textContent = chosen; b.appendChild(summary); } }
    box.appendChild(b);
  });
  const lastMsg = list[list.length - 1];
  if (lastMsg && lastMsg.from === meUid()) {   // status under my newest message (hidden once they reply)
    const st = document.createElement('div');
    st.className = 'msg-status'; st.textContent = otherSeenAt && otherSeenAt >= (lastMsg.createdAt || 0) ? 'Seen' : 'Sent';
    box.appendChild(st);
  }
  if (otherTyping) renderTyping();
  const who = chatFriends().map(otherOf).find(o => o.uid === activeChatUid);
  if (who) { const nt = noteData[who.uid]; box.insertAdjacentHTML('afterbegin', `<div class="chat-profile">${avatarHtml(who.uid, who.name)}<strong>${esc(who.name)}</strong>${who.username ? `<small>${esc(who.username)}</small>` : ''}${nt ? `<div class="note-bubble">${esc(nt.text)}</div>` : ''}<button type="button" class="btn small ghost" data-profile="${esc(who.uid)}">View profile</button></div>`); }
  convShownFor = activeChatUid; convShownCount = list.length;
  box.scrollTop = box.scrollHeight;
}

