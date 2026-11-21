/* =====================================================================
   ONLINE STATUS  -  green = online, gray = offline
   ===================================================================== */
let presenceMap = {}, presenceSubs = {};
const isActive = u => Date.now() - (presenceMap[u] || 0) < CONFIG.onlineWindowMs;
let presenceRenderQueued = false;
function schedulePresenceRender() {
  if (presenceRenderQueued) return;
  presenceRenderQueued = true;
  setTimeout(() => {
    presenceRenderQueued = false;
    if (!document.hidden) renderChats();
  }, 120);
}
function syncPresence() {
  const want = new Set(friendsOf().map(d => d.uid));
  Object.keys(presenceSubs).forEach(u => { if (!want.has(u)) { presenceSubs[u](); delete presenceSubs[u]; delete presenceMap[u]; } });
  friendDocs.forEach(d => watchPhoto(d.uid));
  want.forEach(u => { if (!presenceSubs[u]) presenceSubs[u] = onValue(ref(db, 'presence/' + u), s => { presenceMap[u] = s.val() || 0; schedulePresenceRender(); }, () => {}); });
}
setInterval(() => { if (!document.hidden && document.getElementById('activeRow')) renderChats(); }, CONFIG.presenceRefreshMs);
function renderActiveRow() {
  const row = document.getElementById('activeRow');
  const act = chatFriends().map(otherOf).filter(o => isActive(o.uid));
  row.hidden = !act.length;
  row.innerHTML = act.map(o => `<button type="button" class="active-friend" data-msg="${esc(o.uid)}"><span class="avatar-wrap">${avatarHtml(o.uid, o.name)}<span class="active-dot"></span></span><small>${esc(o.name.split(' ')[0])}</small></button>`).join('');
}
function stopFriendsListener() {
  Object.values(presenceSubs).forEach(u => u()); presenceSubs = {}; presenceMap = {};
  Object.values(photoSubs).forEach(u => u()); photoSubs = {};
  Object.values(storySubs).forEach(u => u()); storySubs = {}; storiesData = {}; renderStories();
  Object.values(noteSubs).forEach(u => u()); noteSubs = {}; noteData = {};
  stopChatSession();
  if (unsubFriends) unsubFriends();
  unsubFriends = null; friendDocs = []; searchResults = [];
  renderFriends(); renderChats(); renderConversation(); renderAlerts();
}

async function searchFriends() {
  const input = document.getElementById('friendSearch');
  const raw = input.value.trim().toLowerCase().replace(/^@/, '');
  if (raw.length < 2) { showToast('Type at least 2 letters of a name or username.'); return; }

  const button = document.getElementById('friendSearchBtn');
  if (button) { button.disabled = true; button.textContent = 'Searching…'; }
  try {
    // Search both public display names and usernames, not username equality only.
    // The public profiles node contains discoverable profile fields, not private account data.
    const snap = await get(ref(db, 'profiles'));
    const needle = raw.replace(/^@/, '');
    searchResults = Object.values(snap.val() || {})
      .filter(profile => {
        if (!profile || !profile.uid || profile.uid === meUid()) return false;
        const name = String(profile.name || '').toLowerCase();
        const username = String(profile.username || '').toLowerCase().replace(/^@/, '');
        return name.includes(needle) || username.includes(needle);
      })
      .sort((a, b) => {
        const an = String(a.name || '').toLowerCase();
        const au = String(a.username || '').toLowerCase().replace(/^@/, '');
        const bn = String(b.name || '').toLowerCase();
        const bu = String(b.username || '').toLowerCase().replace(/^@/, '');
        const aExact = an === needle || au === needle ? 0 : 1;
        const bExact = bn === needle || bu === needle ? 0 : 1;
        return aExact - bExact || an.localeCompare(bn);
      })
      .slice(0, 40);
    searchResults.forEach(profile => watchPhoto(profile.uid));
    if (!searchResults.length) showToast('No matching name or username was found.');
  } catch (e) {
    searchResults = [];
    showToast(friendlyError(e, 'Could not search profiles. Check your connection and profile-read database rules.'));
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Search'; }
    renderFriends();
  }
}

async function sendFriendRequest(t) {
  const me = state.currentUser, u = meUid();
  if (!auth.currentUser || !u) { showToast('Please log in to add friends.'); return; }
  if (!t || !t.uid || t.uid === u) { showToast('You cannot add your own account.'); return; }
  const existing = friendDocs.find(friend => friend.uid === t.uid);
  if (existing) {
    showToast(existing.status === 'accepted' ? 'You are already friends.' : 'A friend request is already pending.');
    return;
  }
  const now = serverTimestamp();
  try {
    // This is an in-app database action; it does not request device permissions.
    // Both request records are written atomically so sender and recipient stay in sync.
    await update(ref(db), {
      [`friends/${u}/${t.uid}`]: { uid: t.uid, name: t.name || '', username: t.username || '', status: 'outgoing', createdAt: now },
      [`friends/${t.uid}/${u}`]: { uid: u, name: me.name || '', username: me.username || '', status: 'incoming', createdAt: now }
    });
    showToast('Friend request sent.');
  } catch (e) {
    const code = String(e && e.code || '');
    if (/permission|denied/i.test(code + ' ' + (e && e.message || ''))) {
      showToast('Firebase blocked this friend request. The Realtime Database rules must allow an authenticated user to create a friend request; device permissions are not needed.');
    } else {
      showToast(friendlyError(e, 'Could not send friend request.'));
    }
  }
}

function renderAll() {
  document.getElementById('composerAvatar').textContent = initials(getCurrentUserName());
  document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === state.activeView));
  document.querySelectorAll('.pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === state.activeView));
  [renderPosts, renderMenuHeader, renderFriends, renderChats, renderConversation, renderAlerts, renderReels].forEach(render => render());
}

// rows only animate right after you switch tabs (not on every background refresh)
function animateRows() { document.body.dataset.rowanim = '1'; clearTimeout(animateRows.t); animateRows.t = setTimeout(() => delete document.body.dataset.rowanim, 900); }
