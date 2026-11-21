/* =====================================================================
   PROFILE PAGE  -  cover + photo (camera buttons on your own), note bubble, short info line,
   tabs All / Photos / Reels, and sections for personal details, work, education and friends.
   ===================================================================== */
function profileShellHtml(person, self) {
  const tabs = [['all', 'All'], ['photos', 'Photos'], ['reels', 'Reels']];
  const cam = (kind, label) => self ? `<button type="button" class="p-cam${kind === 'cover' ? ' cover' : ''}" data-p-pick="${kind}" aria-label="${label}">${ic('camera')}</button>` : '';
  return `<div class="legal-top p-top"><button class="chat-back" style="display:grid;place-items:center" type="button" data-p-close aria-label="Back">←</button><strong class="p-title">${esc(person.name)}</strong>${self ? `<button type="button" class="p-ico" data-p-edit aria-label="Edit profile">${ic('edit')}</button>` : ''}<button type="button" class="p-ico" data-p-menu aria-label="More">${ic('more')}</button></div>
    <div class="legal-body" style="padding:0"><div class="p-wrap">
      <div class="p-cover">${cam('cover', 'Change cover photo')}</div>
      <div class="p-stage"><button type="button" class="p-note" data-p-note hidden></button>
        <div class="avatar-wrap p-avatar"><div class="avatar big">${esc(initials(person.name))}</div><span class="active-dot big" data-p-dot hidden></span>${cam('photo', 'Change profile photo')}</div></div>
      <h1 class="p-name">${esc(person.name)}</h1>
      <p class="p-sub">${esc(person.username)}</p>
      <p class="p-sub" data-p-rel></p>
      <p class="p-info" data-p-info></p>
      <div class="p-actions" data-p-actions></div>
      <div class="p-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" data-p-tab="${t[0]}" class="${t[0] === 'all' ? 'on' : ''}">${t[1]}</button>`).join('')}</div>
      <div class="p-tabbody" data-p-tabbody></div>
    </div></div>`;
}
function leaveProfile(then) {
  closeProfile(true); history.replaceState(null, '', location.pathname + location.search); then();
}
function bindProfileEvents(el, uid) {
  el.addEventListener('click', e => {
    const t = e.target, tab = t.closest('[data-p-tab]');
    if (tab) { profileTab = tab.dataset.pTab; el.querySelectorAll('[data-p-tab]').forEach(b => b.classList.toggle('on', b === tab)); renderProfileTab(); return; }
    const pick = t.closest('[data-p-pick]');
    if (pick) pickProfileImage(pick.dataset.pPick);
    else if (t.closest('[data-p-note]')) { if (uid === meUid()) openNoteSheet(); }
    else if (t.closest('[data-p-story]')) leaveProfile(openCreateStory);
    else if (t.closest('[data-p-seeall]')) leaveProfile(() => setView('friends'));
    else if (t.closest('[data-p-reel]')) leaveProfile(() => setView('reels'));
    else if (t.closest('[data-p-menu]')) openProfileMenu();
  });
}
function pickProfileImage(kind) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const url = await fileToDataUrl(f, kind === 'photo' ? 160 : 720, kind === 'photo' ? 160 : 240), u = meUid();
      await update(ref(db), { [`users/${u}/${kind}`]: url, [`profiles/${u}/${kind}`]: url });
      if (kind === 'photo') { state.currentUser.photo = url; applyOwnPhoto(); }
      if (profileData) profileData[kind] = url;
      paintProfile(); showToast(kind === 'photo' ? 'Profile photo updated.' : 'Cover photo updated.');
    } catch (err) { showToast(friendlyError(err, 'Could not use that image.')); }
  };
  input.click();
}
function openProfileMenu() {
  const self = profileUid === meUid(), person = findPerson(profileUid) || {};
  const el = document.createElement('div'); el.className = 'np-sheet'; el.style.cssText = 'position:fixed;z-index:700';
  const item = (key, icon, title, sub) => `<button type="button" class="np-choice" data-m="${key}">${ic(icon)}<span><b>${title}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
  el.innerHTML = `<div class="np-sheet-card"><div class="np-sheet-head"><strong>${esc(person.name || 'Profile')}</strong><button type="button" class="btn small ghost" data-x>Close</button></div>
    ${item('share', 'share', 'Share profile')}${self ? item('edit', 'edit', 'Edit profile') : ''}</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', async e => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (e.target === el || e.target.closest('[data-x]')) return el.remove();
    if (!m) return;
    el.remove();
    if (m === 'edit') openEditProfile();
    else { try { const data = { title: person.name, text: (person.name || 'Someone') + ' on Murmur', url: location.href.split('#')[0] }; if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); showToast('Link copied.'); } } catch {} }
  });
}
function renderProfileNote() {
  const b = profileOverlay && profileOverlay.querySelector('[data-p-note]'); if (!b) return;
  const self = profileUid === meUid(), n = isNoteActive(noteData[profileUid]) ? noteData[profileUid] : null;
  b.hidden = !self && !n; b.textContent = n ? n.text : 'Share a note…'; b.classList.toggle('empty', !n); b.disabled = !self;
}
function profileRows(d, self) {
  const rows = [], bold = t => `<b>${esc(t)}</b>`;
  if (d.bio) rows.push(['note', esc(d.bio)]);
  if (d.location) rows.push(['pin', 'Lives in ' + bold(d.location)]);
  if (d.hometown) rows.push(['home', 'From ' + bold(d.hometown)]);
  const ints = Array.isArray(d.interests) ? d.interests : Object.values(d.interests || {});
  if (ints.length) rows.push(['heart', ints.map(esc).join(', ')]);
  const joined = d.createdAt ? new Date(d.createdAt) : null;
  if (joined && !isNaN(joined)) rows.push(['calendar', 'Joined ' + joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })]);
  if (self) {
    if (d.birthday) { const b = new Date(d.birthday + 'T00:00:00'); if (!isNaN(b)) rows.push(['cake', 'Born ' + b.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })]); }
    if (d.gender) rows.push(['user', esc(d.gender)]);
    if (d.email) rows.push(['mail', esc(d.email)]);
    if (d.phone) rows.push(['phone', esc(d.phone)]);
  }
  return rows;
}
function renderProfileTab() {
  const body = profileOverlay && profileOverlay.querySelector('[data-p-tabbody]'); if (!body) return;
  const d = profileData, uid = profileUid, self = uid === meUid();
  if (!d) { body.innerHTML = `<div class="p-sec">${skelRows(3)}</div>`; return; }
  if (profileTab === 'photos') {
    const pics = (remotePosts || []).filter(p => p.authorUid === uid && okImg(p.photo) && canSeePost(p));
    body.innerHTML = pics.length ? `<div class="p-grid">${pics.map(p => `<img src="${p.photo}" alt="Photo" loading="lazy" />`).join('')}</div>` : '<div class="p-sec"><p class="reel-muted">No photos yet.</p></div>';
  } else if (profileTab === 'reels') {
    const mine = reels.filter(r => r.authorUid === uid);
    body.innerHTML = mine.length ? `<div class="p-grid">${mine.map(r => `<button type="button" data-p-reel aria-label="Open reels"><video src="${esc(r.url)}" muted playsinline preload="metadata"></video></button>`).join('')}</div>` : '<div class="p-sec"><p class="reel-muted">No reels yet.</p></div>';
  } else {
    const row = r => `<div class="p-row"><span>${ic(r[0])}</span><div>${r[1]}</div></div>`;
    const sec = (title, inner, pen, link) => `<section class="p-sec"><div class="p-sec-head"><h2>${title}</h2>${pen && self ? `<button type="button" class="p-pen" data-p-edit aria-label="Edit">${ic('edit')}</button>` : ''}${link || ''}</div>${inner}</section>`;
    const rows = profileRows(d, self), hint = t => `<p class="reel-muted">${t}</p>`;
    let h = sec('Personal details', rows.length ? rows.map(row).join('') : hint('No details yet.'), true);
    if (d.work) h += sec('Work', row(['work', `<b>${esc(d.work)}</b>${d.role ? `<br /><small>${esc(d.role)}</small>` : ''}`]), true);
    else if (self) h += sec('Work', hint('Add where you work.'), true);
    if (d.school) h += sec('Education', row(['school', `<b>${esc(d.school)}</b>`]), true);
    else if (self) h += sec('Education', hint('Add your school.'), true);
    if (self) {
      const fr = friendDocs.filter(x => x.status === 'accepted');
      h += sec('Friends', fr.length ? `<div class="p-friends">${fr.slice(0, 6).map(x => `<button type="button" class="p-friend" data-profile="${esc(x.uid)}">${avatarHtml(x.uid, x.name)}<span>${esc(x.name)}</span></button>`).join('')}</div>` : hint('Your friends will show here.'), false, '<button type="button" class="p-link" data-p-seeall>See all</button>');
    }
    body.innerHTML = h;
  }
}
function paintProfile() {
  const root = profileOverlay; if (!root) return;
  const d = profileData || {}, cover = root.querySelector('.p-cover'), av = root.querySelector('.avatar.big');
  const displayName = d.name || d.displayName || (profileUid === meUid() ? state.currentUser?.name : '') || 'Profile';
  root.querySelector('.p-title').textContent = displayName;
  root.querySelector('.p-name').textContent = displayName;
  root.querySelector('.p-sub').textContent = d.username || (profileUid === meUid() ? state.currentUser?.username : '') || '';
  if (av) {
    av.textContent = initials(displayName);
    if (okImg(d.photo)) setBg(av, d.photo); else av.style.backgroundImage = '';
  }
  if (okImg(d.cover)) setBg(cover, d.cover); else cover.style.backgroundImage = '';
  const city = (d.location || '').split(',')[0].trim();
  root.querySelector('[data-p-info]').innerHTML = [city && ic('pin') + esc(city), d.work && ic('work') + esc(d.work), d.school && ic('school') + esc(d.school)].filter(Boolean).map(x => `<span>${x}</span>`).join('<i>·</i>');
  renderProfileNote(); renderProfileTab();
}
async function loadProfileDetails(uid) {
  let d = null;
  watchNote(uid);
  try { d = (await get(ref(db, (uid === meUid() ? 'users/' : 'profiles/') + uid))).val(); }
  catch (error) { console.warn('Could not load public profile:', error); }
  if (!profileOverlay || profileUid !== uid) return;
  profileData = d && typeof d === 'object' ? d : {};
  paintProfile();
  if (!d) {
    const body = profileOverlay.querySelector('[data-p-tabbody]');
    if (body) body.innerHTML = '<div class="p-sec"><p class="reel-muted">This profile is unavailable or its public profile data could not be loaded.</p></div>';
  }
}

function openProfileCard(user) {
  const uid = typeof user === 'string' ? user : (user && (user.uid || user.id));
  if (!uid) return;
  openProfile(uid);
}
function openProfile(uid) {
  const person = findPerson(uid);
  if (!person) return;
  closeProfile(true);
  profileUid = uid;
  if (location.hash !== '#profile') history.pushState(null, '', '#profile');
  const el = document.createElement('div');
  profileOverlay = el;
  el.className = 'screen-legal';
  // Keep the profile screen above the chat layout and its mobile conversation layer.
  el.style.zIndex = '10000';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Profile');
  profileTab = 'all'; profileData = null;
  el.innerHTML = profileShellHtml(person, uid === meUid());
  document.body.appendChild(el);
  el.querySelector('[data-p-close]').onclick = () => closeProfile(false);
  bindProfileEvents(el, uid);
  el.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(false); });
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-p-msg],[data-p-add],[data-p-accept],[data-p-remove],[data-p-edit]');
    if (!t) return;
    const u = meUid(), rel = relationOf(uid);
    if (t.hasAttribute('data-p-edit')) { openEditProfile(); return; }
    try {
      if (t.hasAttribute('data-p-msg')) { closeProfile(true); history.replaceState(null, '', location.pathname + location.search); setView('chats'); openChat(uid); return; }
      if (t.hasAttribute('data-p-add')) {
        await sendFriendRequest(person);
      } else if (t.hasAttribute('data-p-accept')) {
        await update(ref(db), { [`friends/${u}/${uid}/status`]: 'accepted', [`friends/${uid}/${u}/status`]: 'accepted' });
      } else {
        if (rel === 'accepted' && !confirm('Remove ' + person.name + ' from your friends?')) return;
        await update(ref(db), { [`friends/${u}/${uid}`]: null, [`friends/${uid}/${u}`]: null });
      }
      renderFriends(); renderChats(); renderAlerts(); renderProfileActions();
    } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
  });
  renderProfileActions();
  loadProfileDetails(uid);
  el.querySelector('[data-p-close]').focus();
}
['.menu-me', '#composerAvatar'].forEach(sel => {
  const node = document.querySelector(sel);
  if (!node) return;
  node.style.cursor = 'pointer';
  node.addEventListener('click', () => openProfile(meUid()));
});
document.addEventListener('click', e => { const pr = e.target.closest('[data-profile]'); if (pr) openProfileCard(pr.dataset.profile); });
// tapping a notification takes you to the page it is about
document.addEventListener('click', e => {
  if (e.target.closest('[data-fr-accept], [data-fr-del], [data-profile]')) return;   // the buttons inside keep their own job
  const go = e.target.closest('[data-goto]'); if (!go) return;
  setView(go.dataset.goto);
  if (go.dataset.goto === 'friends') setFrTab('suggest');
});
function closeChat() {
  stopChatSession();
  renderChats(); renderConversation();
}
function slideOutChat(done) {
  const c = document.querySelector('.chat-layout .conversation');
  const still = !c || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !CONFIG.chatAnimMs;
  if (still) { done(); return; }
  c.classList.add('closing');
  setTimeout(() => { c.classList.remove('closing'); done(); }, CONFIG.chatAnimMs * 0.85);
}
document.getElementById('chatBack').addEventListener('click', () => slideOutChat(() => { if (location.hash === '#chat') history.back(); else closeChat(); }));
function openProfileFromChat(uid) {
  if (!uid) return;
  // Leave the mobile conversation pane before opening the profile. This keeps
  // the profile from appearing to be trapped behind the active chat view.
  closeChat();
  openProfile(uid);
}
document.getElementById('chatProfileBtn').addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  const uid = event.currentTarget.dataset.profileUid || activeChatUid;
  if (!uid) { showToast('Open a conversation first to view this profile.'); return; }
  openProfileFromChat(uid);
});
['chatAvatar', 'chatName'].forEach(id => {
  const node = document.getElementById(id);
  node.style.cursor = 'pointer';
  node.addEventListener('click', () => { if (activeChatUid) openProfileFromChat(activeChatUid); });
});

let annList = [], notes = [], suspendedInfo = null, myAppeal = null, extraSubs = [], presenceTimer = null, suspendedCountdownTimer = null;
let accountCreatedAt = 0;
const alertTime = value => typeof value === 'number' ? value : (Date.parse(value || '') || 0);

let announcementRefreshTimer = null;
async function loadPublicAnnouncements() {
  try {
    const response = await fetch(MURMUR_SUPABASE_URL + '/functions/v1/murmur-public-announcements', {
      headers: { apikey: MURMUR_SUPABASE_KEY, Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Announcement request failed (' + response.status + ').');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Announcement response was not a list.');
    annList = rows.map(row => ({
      id: row.id, title: row.title, body: row.body, kind: row.kind,
      pinned: row.is_pinned === true,
      createdAt: Date.parse(row.created_at || row.published_at) || Date.now(),
      expiresAt: row.expires_at ? Date.parse(row.expires_at) : null
    }));
    const box = document.getElementById('announceBox');
    if (box) box.innerHTML = '';
    renderAlerts();
  } catch (error) {
    console.warn('Could not load Murmur announcements:', error);
    renderAlerts();
  }
}
function startExtras(uid) {
  stopExtras();
  const off = () => {};
  loadPublicAnnouncements();
  announcementRefreshTimer = setInterval(() => { if (!document.hidden) loadPublicAnnouncements(); }, 300000);
  extraSubs = [
    onValue(ref(db, 'notifications/' + uid), s => { notes = Object.entries(s.val() || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderAlerts(); }, off),
    onValue(ref(db, 'savedPosts/' + uid), s => { savedPostIds = s.val() || {}; renderPosts(); }, off),
    onValue(ref(db, 'suspended/' + uid), s => { suspendedInfo = s.exists() ? s.val() : null; renderSuspended(); }, off),
    onValue(ref(db, 'appeals/' + uid), s => { myAppeal = s.exists() ? s.val() : null; renderSuspended(); }, off)
  ];
  const ping = () => set(ref(db, 'presence/' + uid), serverTimestamp()).catch(() => {});
  ping();
  presenceTimer = setInterval(() => { if (!document.hidden) ping(); }, 60000);
}
function stopExtras() {
  extraSubs.forEach(u => u()); extraSubs = [];
  clearInterval(presenceTimer); presenceTimer = null;
  clearInterval(announcementRefreshTimer); announcementRefreshTimer = null;
  annList = []; notes = []; savedPostIds = {}; suspendedInfo = null; myAppeal = null;
  renderAnnouncements(); renderSuspended();
}
/* Announcements from admin.html show in Alerts (not on Home), signed "Admin of Murmur". */
const liveAnnouncements = () => annList.filter(a => !a.expiresAt || a.expiresAt > Date.now()).sort((a, b) => (!!b.pinned - !!a.pinned) || ((b.createdAt || 0) - (a.createdAt || 0)));
const seenAnn = () => { try { return JSON.parse(localStorage.getItem('murmur-seen-ann') || '[]'); } catch { return []; } };
function markAnnSeen() {
  try { localStorage.setItem('murmur-seen-ann', JSON.stringify(liveAnnouncements().map(a => a.id).slice(0, 60))); } catch {}
  renderAlerts();
}
function renderAnnouncements() {
  const box = document.getElementById('announceBox');
  if (box) box.innerHTML = '';
  // Rendering is not the same as reading: only markAnnSeen() on an explicit
  // visit to the Alerts tab or when the user opens an announcement.
  renderAlerts();
}
function renderSuspended() {
  document.getElementById('suspendedScreen')?.remove();
  clearInterval(suspendedCountdownTimer); suspendedCountdownTimer = null;
  if (!suspendedInfo) return;
  if (!suspendedInfo.deleted && !suspendedInfo.scheduledDelete && suspendedInfo.expiresAt && Number(suspendedInfo.expiresAt) <= Date.now()) { suspendedInfo = null; return; }
  const del = !!suspendedInfo.deleted;
  const timing = suspendedInfo.scheduledDelete && suspendedInfo.deleteAt
    ? 'Deletion date: ' + new Date(Number(suspendedInfo.deleteAt)).toLocaleString()
    : suspendedInfo.expiresAt ? 'Suspension ends: ' + new Date(Number(suspendedInfo.expiresAt)).toLocaleString()
    : (del ? 'This account is no longer available.' : 'This restriction has no automatic end time.');
  const ap = myAppeal && (myAppeal.createdAt || 0) >= (suspendedInfo.createdAt || 0) ? myAppeal : null;
  const el = document.createElement('div');
  el.id = 'suspendedScreen'; el.className = 'modal-back'; el.style.zIndex = '900';
  const tail = ap && ap.status === 'open'
    ? '<p class="appeal-note">Your appeal was sent. We will reply here.</p>'
    : (ap && ap.status === 'declined' ? `<p class="appeal-note">Your appeal was declined${ap.reply ? ': ' + esc(ap.reply) : '.'} You can send one more.</p>` : '')
      + '<textarea class="appeal-text" maxlength="300" placeholder="Why should we restore your account? Tell us what happened."></textarea><button class="btn primary" type="button" data-appeal>Send appeal</button>';
  el.innerHTML = `<div class="modal-card"><h3>${del ? 'Your account was deleted' : 'Your account is suspended'}</h3><p><strong>Reason:</strong> ${esc(suspendedInfo.reason || 'You broke the Murmur rules.')}</p><p><strong>Time:</strong> ${esc(timing)}</p>${!del && suspendedInfo.expiresAt ? '<p><strong>Time remaining before you can use your account again:</strong> <span data-susp-countdown>Calculating…</span></p>' : (!del && suspendedInfo.scheduledDelete ? '<p><strong>Account access is blocked now. Scheduled deletion:</strong> ' + esc(new Date(Number(suspendedInfo.deleteAt)).toLocaleString()) + '</p>' : '')}${tail}<p class="tiny">Or email ${esc(PRIVACY_CONTACT)}.</p><button class="btn ghost" type="button" data-logout>Log out</button></div>`;
  el.querySelector('[data-logout]').onclick = () => document.getElementById('logoutBtn').click();
  const send = el.querySelector('[data-appeal]');
  if (send) send.onclick = async () => {
    const text = cleanText(el.querySelector('.appeal-text').value, 300);
    if (text.length < 10) { showToast('Please write a little more (at least 10 characters).'); return; }
    send.disabled = true;
    try {
      await set(ref(db, 'appeals/' + auth.currentUser.uid), { message: text, createdAt: serverTimestamp(), status: 'open', type: del ? 'deleted' : 'suspended', reason: suspendedInfo.reason || '', name: state.currentUser?.name || '' });
      showToast('Appeal sent.');
    } catch (err) { showToast(friendlyError(err, 'Could not send your appeal.')); send.disabled = false; }
  };
  document.body.appendChild(el);
  const countdown = el.querySelector('[data-susp-countdown]');
  if (countdown) {
    const updateCountdown = () => {
      const left = window.MurmurRestrictionTools.remaining(suspendedInfo?.expiresAt);
      const days = Math.floor(left / 86400000), hours = Math.floor((left % 86400000) / 3600000), mins = Math.floor((left % 3600000) / 60000), secs = Math.floor((left % 60000) / 1000);
      countdown.textContent = days ? `${days}d ${hours}h ${mins}m ${secs}s` : `${hours}h ${mins}m ${secs}s`;
      if (left <= 0) { clearInterval(suspendedCountdownTimer); suspendedCountdownTimer = null; suspendedInfo = null; el.remove(); showToast('Your suspension has ended. You can use Murmur again.'); }
    };
    updateCountdown(); suspendedCountdownTimer = setInterval(updateCountdown, 1000);
  }
}
function markNotesRead() {
  const u = meUid(); if (!u) return;
  const removals = notes.filter(n => !n.read).map(n => remove(ref(db, `notifications/${u}/${n.id}`)));
  if (removals.length) Promise.allSettled(removals).then(() => {});
}
document.addEventListener('click', async e => {
  const rp = e.target.closest('[data-report-post],[data-report-user]');
  if (!rp) return;
  const isPost = !!rp.dataset.reportPost;
  const reason = prompt('Why are you reporting this ' + (isPost ? 'post' : 'person') + '? (for example: spam, harassment)');
  if (!reason || !reason.trim()) return;
  try {
    await push(ref(db, 'reports'), { type: isPost ? 'post' : 'user', targetId: isPost ? rp.dataset.reportPost : rp.dataset.reportUser, targetName: rp.dataset.name || '', reason: reason.trim().slice(0, 60), details: '', by: meUid(), byName: state.currentUser?.name || 'someone', createdAt: serverTimestamp(), status: 'open' });
    showToast('Report sent. Thank you.');
  } catch (err) { showToast(friendlyError(err, 'Could not send report.')); }
});

