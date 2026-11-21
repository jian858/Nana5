/* =====================================================================
   ALERTS  -  friend requests and notifications
   ===================================================================== */
function formatAlertBadge(alerts) {
  const unread = typeof alerts === 'number'
    ? Math.max(0, Math.floor(alerts))
    : (Array.isArray(alerts) ? alerts.filter(alert => alert && !alert.read).length : 0);
  return unread > 99 ? '99+' : String(unread);
}
function openAnnouncementDetails(id) {
  const item = liveAnnouncements().find(entry => String(entry.id) === String(id));
  if (!item) return;
  document.querySelector('.announcement-detail-screen')?.remove();
  const screen = document.createElement('section');
  screen.className = 'announcement-detail-screen';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-label', 'Announcement details');
  screen.innerHTML = '<div class="announcement-detail-card"><header class="announcement-detail-head"><button type="button" data-announcement-back>Back</button><span>MURMUR ANNOUNCEMENT</span><span></span></header><article class="announcement-detail-content"><small>FROM MURMUR</small><h1 data-announcement-title></h1><p class="announcement-detail-date" data-announcement-date></p><div class="announcement-detail-body" data-announcement-body></div></article></div>';
  screen.querySelector('[data-announcement-title]').textContent = item.title || 'Announcement';
  screen.querySelector('[data-announcement-date]').textContent = new Date(item.createdAt || Date.now()).toLocaleString();
  screen.querySelector('[data-announcement-body]').textContent = item.body || '';
  const previousOverflow = document.body.style.overflow;
  const close = () => { screen.remove(); document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); };
  const onKey = event => { if (event.key === 'Escape') close(); };
  screen.querySelector('[data-announcement-back]').addEventListener('click', close);
  screen.addEventListener('click', event => { if (event.target === screen) close(); });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.appendChild(screen);
}
let alertsFilter = 'all';
document.querySelectorAll('[data-alert-filter]').forEach(button => {
  button.addEventListener('click', () => {
    alertsFilter = button.dataset.alertFilter || 'all';
    document.querySelectorAll('[data-alert-filter]').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderAlerts();
  });
});

function renderAlerts() {
  const accountStart = accountCreatedAt || 0;
  const inc = incoming().filter(item => !accountStart || alertTime(item.createdAt) >= accountStart);
  const seen = seenAnn();
  // Announcements are shared by all users, so hide a read announcement only
  // for this user's local account instead of deleting the global admin post.
  const visibleAnnouncements = liveAnnouncements().filter(item =>
    (!accountStart || alertTime(item.createdAt) >= accountStart) && !seen.includes(String(item.id))
  );
  const visibleNotes = notes.filter(item => !accountStart || alertTime(item.createdAt) >= accountStart);
  const el = document.getElementById('alertsList');
  if (!el) return;
  const ann = visibleAnnouncements;
  const items = [
    ...ann.map(a => ({ type: 'announcement', id: a.id, time: alertTime(a.createdAt), unread: !seen.includes(a.id), data: a })),
    ...inc.map(d => ({ type: 'request', id: d.uid, time: alertTime(d.createdAt), unread: true, data: d })),
    ...visibleNotes.map(n => ({ type: 'activity', id: n.id, time: alertTime(n.createdAt), unread: !n.read, data: n }))
  ].sort((a, b) => (b.time || 0) - (a.time || 0));
  const filtered = items.filter(item => {
    if (alertsFilter === 'unread') return item.unread;
    if (alertsFilter === 'announcements') return item.type === 'announcement';
    if (alertsFilter === 'people') return item.type === 'request';
    if (alertsFilter === 'activity') return item.type === 'activity';
    return true;
  });
  const unreadCount = items.filter(item => item.unread).length;
  const countEl = document.getElementById('alertsUnreadCount');
  if (countEl) countEl.textContent = unreadCount ? unreadCount + ' unread' : 'You’re all caught up';
  el.innerHTML = '';
  if (!filtered.length) {
    const title = alertsFilter === 'unread' ? 'You’re all caught up' : 'Nothing in this filter yet';
    const copy = alertsFilter === 'unread'
      ? 'New friend requests, activity and Murmur announcements will appear here.'
      : 'Try another filter or explore Murmur while you wait for new updates.';
    el.innerHTML = `<div class="alerts-empty"><span class="alerts-empty-icon" aria-hidden="true">${ic('bell')}</span><h2>${title}</h2><p>${copy}</p><div class="alerts-empty-actions"><button type="button" data-alert-goto="friends">Find people</button><button type="button" data-alert-goto="home">Explore feed</button></div></div>`;
  } else {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const earlier = [], today = [];
    filtered.forEach(item => ((item.time || 0) >= todayStart.getTime() ? today : earlier).push(item));
    const renderGroup = (label, list) => {
      if (!list.length) return '';
      return `<section class="alerts-group"><h2>${label}</h2><div class="alerts-group-items">${list.map(item => {
        const mins = Math.max(0, Math.round((Date.now() - (item.time || Date.now())) / 60000));
        const when = mins < 1 ? 'Just now' : mins < 60 ? mins + 'm ago' : mins < 1440 ? Math.round(mins / 60) + 'h ago' : Math.round(mins / 1440) + 'd ago';
        if (item.type === 'announcement') {
          const a = item.data;
          return `<button type="button" class="notice admin-notice alerts-row ${item.unread ? 'is-unread' : ''} ${a.kind === 'warning' || a.kind === 'warn' || a.kind === 'urgent' ? 'warn' : ''}" data-announcement="${esc(a.id)}" aria-label="Open announcement: ${esc(a.title)}">
            <span class="admin-ava" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 10v4h3l11 5V5L6 10H3z"/><path d="M6 14l2 6h4l-3-7M20 9l2-2M20 15l2 2"/></svg></span>
            <span class="admin-notice-copy"><strong>From Murmur</strong><span class="alerts-message">${esc(a.body || a.title || 'A new announcement is available.')}</span><span class="alerts-see-more">See more</span><small>${esc(a.title || 'Murmur announcement')} · ${when}</small></span>
            ${item.unread ? '<span class="alerts-unread-dot" aria-label="Unread"></span>' : ''}
          </button>`;
        }
        if (item.type === 'request') {
          const d = item.data;
          return `<article class="notice alerts-row is-unread"><span class="alerts-person-avatar">${avatarHtml(d.uid, d.name)}</span><span class="alerts-row-copy"><strong>${esc(d.name)} sent you a friend request</strong><small>${esc(d.username || '')} · ${when}</small></span><span class="alerts-unread-dot" aria-label="Unread"></span><button type="button" class="alerts-row-action" data-alert-goto="friends">View</button></article>`;
        }
        const n = item.data;
        const title = n.type === 'like' ? (n.text || 'Someone interacted with your post') : (n.title || 'Murmur activity');
        return `<button type="button" class="notice alerts-row ${item.unread ? 'is-unread' : ''}" data-note-id="${esc(n.id)}" ${n.type === 'like' ? 'data-alert-goto="home"' : ''}><span class="alerts-activity-icon">${ic(n.type === 'like' ? 'heart' : 'bell')}</span><span class="alerts-row-copy"><strong>${esc(title)}</strong>${n.type === 'like' ? '' : `<span class="alerts-message">${esc(n.text || '')}</span>`}<small>${when}</small></span>${item.unread ? '<span class="alerts-unread-dot" aria-label="Unread"></span>' : ''}</button>`;
      }).join('')}</div></section>`;
    };
    el.innerHTML = renderGroup('Today', today) + renderGroup('Earlier', earlier);
  }
  el.querySelectorAll('[data-announcement]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.announcement;
    const current = seenAnn();
    if (!current.includes(id)) {
      try { localStorage.setItem('murmur-seen-ann', JSON.stringify([...current, id].slice(-60))); } catch {}
    }
    openAnnouncementDetails(id);
    renderAlerts();
  }));
  el.querySelectorAll('[data-note-id]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.noteId, uid = meUid();
    if (uid && id) {
      try { await remove(ref(db, 'notifications/' + uid + '/' + id)); }
      catch (error) { console.warn('Could not delete read notification:', error); }
    }
    if (button.dataset.alertGoto) setView(button.dataset.alertGoto);
    else renderAlerts();
  }));
  el.querySelectorAll('[data-alert-goto]').forEach(button => button.addEventListener('click', () => {
    const view = button.dataset.alertGoto;
    if (view) setView(view);
  }));
  const unread = visibleNotes.filter(n => !n.read).length + inc.length + (state.activeView === 'alerts' ? 0 : ann.filter(a => !seen.includes(a.id)).length);
  document.title = (unread ? `(${unread}) ` : '') + 'Murmur – Chat, share and watch together';
  [['friendsBadge', inc.length], ['alertsBadge', unread]].forEach(([id, c]) => { const b = document.getElementById(id); b.textContent = formatAlertBadge(c); b.hidden = !c; });
}


/* Every user gets their own 16-character ID. It is only for the admin: it lives in the database (users/<uid>/code and
   the list codes/<ID> = uid, so no two users share one) and is never shown in the app. Letters/numbers without 0, 1, I, O. */
async function ensureCode(uid, p) {
  if (p.code) return p.code;
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 6; i++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => A[b % 32]).join('');
    try {
      await set(ref(db, 'codes/' + code), uid);                 // fails if the ID is already taken
      await update(ref(db), { ['users/' + uid + '/code']: code });
      return code;
    } catch (e) { /* taken or not allowed: try another */ }
  }
  return '';
}
async function ensureProfile(user) {
  try {
    const snap = await get(ref(db, 'users/' + user.uid));
    if (!snap.exists()) return;
    const p = snap.val();
    p.code = await ensureCode(user.uid, p);
    remove(ref(db, 'profiles/' + user.uid + '/code')).catch(() => {});   // older versions put the ID in the public profile
    await set(ref(db, 'profiles/' + user.uid), { uid: user.uid, name: p.name || '', username: p.username || '', usernameLower: (p.username || '').toLowerCase(), bio: p.bio || '', school: p.school || '', location: p.location || '', interests: p.interests || [], createdAt: p.createdAt || '', photo: p.photo || '', cover: p.cover || '' });
    if (state.currentUser) { state.currentUser.photo = p.photo || ''; applyOwnPhoto(); }
  } catch (e) { console.warn('Profile sync failed (check Realtime Database rules):', e); }
}

function startFriendsListener(uid) {
  if (unsubFriends) return;
  unsubFriends = onValue(ref(db, 'friends/' + uid), snap => {
    friendDocs = Object.entries(snap.val() || {}).map(([id, d]) => ({ id, ...d }));
    if (activeChatUid && !friendsOf().some(d => d.uid === activeChatUid)) { stopChatSession(); renderConversation(); }
    syncPresence();
    renderFriends(); renderChats(); renderAlerts(); renderProfileActions(); renderStories();
  }, err => console.warn('Friends unavailable (check Realtime Database rules):', err));
}
