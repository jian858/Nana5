
/* =====================================================================
   APP  -  the app logic. Jump to a part by searching its CAPITAL title:
   APP STATE, SMALL HELPERS, HOME FEED, FRIENDS, CHAT, ALERTS, ONLINE STATUS,
   LOG IN, CREATE ACCOUNT, FORGOT PASSWORD, LEGAL PAGES, BLOCK PEOPLE,
   SECURITY + SAFETY, SENDING
   Numbers and wording live in SETTINGS above.
   ===================================================================== */
const monitoredFirebaseMethods = new Set([
  'createUserWithEmailAndPassword','signInWithEmailAndPassword','sendPasswordResetEmail',
  'reauthenticateWithCredential','deleteUser','signOut','set','get','push','update','remove',
  'uploadBytesResumable','getDownloadURL','deleteObject'
]);
const monitoredFirebase = new Proxy(window.__fb, {
  get(target, property, receiver) {
    const original = Reflect.get(target, property, receiver);
    if (typeof original !== 'function') return original;
    if (property === 'onValue') {
      return function (queryRef, callback, cancelCallback, ...rest) {
        const reportCancel = typeof cancelCallback === 'function' ? cancelCallback : function (error) {
          sendMurmurError('firebase', error, { source: 'firebase.onValue listener' });
        };
        return Reflect.apply(original, target, [queryRef, callback, reportCancel, ...rest]);
      };
    }
    if (!monitoredFirebaseMethods.has(property)) return original;
    return function (...args) {
      let result;
      try { result = Reflect.apply(original, target, args); }
      catch (error) {
        sendMurmurError(property === 'uploadBytesResumable' || property === 'getDownloadURL' || property === 'deleteObject' ? 'storage' : 'firebase', error, { source: 'firebase.' + String(property) });
        throw error;
      }
      if (result && typeof result.then === 'function') {
        return result.catch(error => {
          sendMurmurError(property === 'uploadBytesResumable' || property === 'getDownloadURL' || property === 'deleteObject' ? 'storage' : 'firebase', error, { source: 'firebase.' + String(property) });
          throw error;
        });
      }
      if (property === 'uploadBytesResumable' && result && typeof result.on === 'function') {
        const task = result;
        return new Proxy(task, {
          get(taskTarget, taskProperty, taskReceiver) {
            const taskValue = Reflect.get(taskTarget, taskProperty, taskReceiver);
            if (taskProperty !== 'on' || typeof taskValue !== 'function') return typeof taskValue === 'function' ? taskValue.bind(taskTarget) : taskValue;
            return function (...taskArgs) {
              if (taskArgs[0] === 'state_changed' && typeof taskArgs[2] === 'function') {
                const originalError = taskArgs[2];
                taskArgs[2] = error => {
                  sendMurmurError('storage', error, { source: 'firebase.uploadBytesResumable' });
                  return originalError(error);
                };
              }
              return Reflect.apply(taskValue, taskTarget, taskArgs);
            };
          }
        });
      }
      return result;
    };
  }
});
const { initializeApp, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser, signOut, onAuthStateChanged, getDatabase, ref, set, get, push, update, remove, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp, getStorage, storageRef, uploadBytesResumable, getDownloadURL, deleteObject } = monitoredFirebase;

const firebaseConfig = window.MURMUR_FIREBASE;   // edit in SETTINGS


const CONFIG = window.MURMUR_CONFIG;             // edit in SETTINGS

document.documentElement.style.setProperty('--chat-ms', CONFIG.chatAnimMs);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Firebase remains the login provider. Supabase independently creates and stores its own UUID.
const MURMUR_SUPABASE_URL = 'https://pkadftvqslkykehcqedj.supabase.co';
const MURMUR_SUPABASE_KEY = 'sb_publishable_etoHiUGbJ96MUPzJABL12A_UiTWVxok';
const MURMUR_IDENTITY_URL = MURMUR_SUPABASE_URL + '/functions/v1/murmur-identity';
window.MURMUR_IDS = window.MURMUR_IDS || { firebaseUid: null, supabaseId: null, status: 'not-signed-in' };
async function syncMurmurSupabaseIdentity(user) {
  if (!user) {
    window.MURMUR_IDS = { firebaseUid: null, supabaseId: null, status: 'not-signed-in' };
    return window.MURMUR_IDS;
  }
  window.MURMUR_IDS = { firebaseUid: user.uid, supabaseId: null, status: 'checking' };
  try {
    // The Edge Function verifies the Firebase token itself; no Firebase custom role claim is needed to create IDs.
    const firebaseToken = await user.getIdToken();
    const response = await fetch(MURMUR_IDENTITY_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + firebaseToken,
        'apikey': MURMUR_SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Supabase identity request failed (' + response.status + ')');
    if (result.firebaseUid !== user.uid || !result.supabaseId) {
      throw new Error('Supabase returned an invalid account ID link');
    }
    window.MURMUR_IDS = {
      firebaseUid: result.firebaseUid,
      supabaseId: result.supabaseId,
      status: 'connected'
    };
    console.info('Murmur Firebase/Supabase identity linked', window.MURMUR_IDS);
  } catch (error) {
    window.MURMUR_IDS.status = 'sync-error';
    window.MURMUR_IDS.error = String(error && error.message || error);
    console.warn('Supabase identity sync is not ready:', window.MURMUR_IDS.error);
  }
  return window.MURMUR_IDS;
}

/* =====================================================================
   APP STATE  -  what we remember about the logged-in user
   ===================================================================== */
const DEFAULT_STATE = {
  v: 2,
  loggedIn: false,
  currentUser: { name: 'Me', email: '', username: '@me' },
  users: { me: { name: 'Me', email: '', username: '@me' } },
  posts: [],
  conversations: {},
  alerts: [],
  activeChat: null,
  activeView: 'home'
};

const state = loadState();
const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const splash = document.getElementById('splash');
const authError = document.getElementById('authError');

function saveState() {
  try { localStorage.setItem('murmur-state', JSON.stringify(state)); } catch {}
}

function loadState() {
  const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
  try {
    const old = JSON.parse(localStorage.getItem('murmur-state') || 'null');
    if (!old) return fresh();
    const st = fresh();
    st.loggedIn = !!old.loggedIn;
    // Always start authenticated sessions on Home; do not restore the last tab after reopening.
    st.activeView = 'home';
    if (old.currentUser && old.currentUser.uid) { st.currentUser = old.currentUser; st.users.me = { ...old.currentUser }; }
    if (old.v === 2) st.posts = old.posts || [];
    return st;
  } catch { return fresh(); }
}

function initials(name) {
  return (name || 'M').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'M';
}

/* =====================================================================
   SMALL HELPERS  -  toast messages, show/hide screens
   ===================================================================== */
function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(20,33,61,0.88)';
  toast.style.color = '#fff';
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '999px';
  toast.style.zIndex = '300';
  toast.style.fontWeight = '700';
  toast.style.fontSize = '0.9rem';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

const MURMUR_CONSENT_VERSION = '2026-11-01-v1';
const MURMUR_CONSENT_KEY = 'murmur-required-consent';
function hasMurmurConsent() {
  try {
    const saved = JSON.parse(localStorage.getItem(MURMUR_CONSENT_KEY) || 'null');
    return !!saved && saved.version === MURMUR_CONSENT_VERSION && saved.terms === true && saved.privacy === true;
  } catch { return false; }
}
function showConsentGate(onAccepted) {
  if (document.querySelector('.murmur-consent-gate')) return;
  authEl.hidden = true;
  appEl.hidden = true;
  if (!document.getElementById('murmur-consent-styles')) {
    const style = document.createElement('style');
    style.id = 'murmur-consent-styles';
    style.textContent = `.murmur-consent-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(10,16,28,.72);font-family:inherit;color:#182235}.murmur-consent-card{width:min(100%,480px);max-height:min(88vh,760px);overflow:auto;box-sizing:border-box;padding:26px 22px;border-radius:18px;background:#fff;box-shadow:0 24px 80px #0005}.murmur-consent-card h1{margin:0 0 12px;font-size:1.55rem;line-height:1.2;font-weight:800}.murmur-consent-card p{font-size:.98rem;line-height:1.55;color:#596579}.murmur-consent-check{display:flex;align-items:flex-start;gap:11px;padding:13px 0;border-top:1px solid #e8ebf0;font-size:.96rem;line-height:1.45}.murmur-consent-check input{width:20px;height:20px;flex:0 0 20px;margin:1px 0 0;accent-color:#087f70}.murmur-consent-card [data-consent-accept]{width:100%;min-height:50px;margin-top:12px;border:0;border-radius:10px;background:#087f70;color:#fff;font:inherit;font-weight:800}.murmur-consent-card [data-consent-accept]:disabled{opacity:.45;cursor:not-allowed}.murmur-consent-card small{display:block;margin-top:12px;color:#737d8c;line-height:1.4;text-align:center}@media(prefers-reduced-motion:no-preference){.murmur-consent-card{animation:murmurConsentIn .22s ease-out}@keyframes murmurConsentIn{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}}`;
    document.head.appendChild(style);
  }
  const gate = document.createElement('div');
  gate.className = 'murmur-consent-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'murmurConsentTitle');
  gate.innerHTML = `<section class="murmur-consent-card">
    <h1 id="murmurConsentTitle">Before you use Murmur</h1>
    <p>To continue, confirm that you agree to Murmur's Terms of Service and acknowledge its Privacy Policy. You can review both documents from the app's Legal section after continuing.</p>
    <p>Camera, microphone, photos, location, contacts and notifications are not required to enter Murmur. Each device permission is requested only when you choose to use its related feature.</p>
    <label class="murmur-consent-check"><input type="checkbox" data-consent="terms"> <span>I agree to Murmur's Terms of Service.</span></label>
    <label class="murmur-consent-check"><input type="checkbox" data-consent="privacy"> <span>I acknowledge the Privacy Policy.</span></label>
    <button type="button" data-consent-accept disabled>Accept and continue</button>
    <small>You must accept both statements to use Murmur on this device.</small>
  </section>`;
  document.body.appendChild(gate);
  const terms = gate.querySelector('[data-consent="terms"]');
  const privacy = gate.querySelector('[data-consent="privacy"]');
  const accept = gate.querySelector('[data-consent-accept]');
  const sync = () => { accept.disabled = !(terms.checked && privacy.checked); };
  terms.addEventListener('change', sync);
  privacy.addEventListener('change', sync);
  accept.addEventListener('click', () => {
    if (!terms.checked || !privacy.checked) return;
    try {
      localStorage.setItem(MURMUR_CONSENT_KEY, JSON.stringify({
        version: MURMUR_CONSENT_VERSION, terms: true, privacy: true, acceptedAt: new Date().toISOString()
      }));
    } catch {
      showToast('Please enable site storage to save your acceptance.');
      return;
    }
    gate.remove();
    onAccepted?.();
  });
  terms.focus();
}
function showAuth(skipConsent = false) {
  if (!skipConsent && !hasMurmurConsent()) {
    showConsentGate(() => showAuth(true));
    return;
  }
  authEl.hidden = false;
  appEl.hidden = true;
  document.getElementById('email').focus();
  authError.textContent = '';
}

/* AFTER THE SPLASH SCREEN: a grey placeholder of the whole app (header, tabs, stories, composer, posts)
   shows until the first posts arrive, so the screen never jumps from blank to full. */
const SKELETON_MIN_MS = 500, SKELETON_MAX_MS = 6000;
let skeletonShownAt = 0;
function showAppSkeleton() {
  const el = document.getElementById('appSkeleton'); if (!el) return;
  skeletonShownAt = Date.now(); el.hidden = false;
  setTimeout(hideAppSkeleton, SKELETON_MAX_MS);          // never stay forever, even if the network is slow
}
function hideAppSkeleton() {
  const el = document.getElementById('appSkeleton'); if (!el || el.classList.contains('hide')) return;
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 400); }, Math.max(0, SKELETON_MIN_MS - (Date.now() - skeletonShownAt)));
}

function showApp(skipConsent = false) {
  if (!skipConsent && !hasMurmurConsent()) {
    showConsentGate(() => showApp(true));
    return;
  }
  authEl.hidden = true;
  appEl.hidden = false;
  renderAll();
}

function getCurrentUserName() {
  return state.currentUser?.name || 'Me';
}

function getUserById(id) {
  return state.users[id] || { name: 'Someone', email: '', username: '@someone' };
}

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, c) => `<svg class="ic"${c ? ` style="color:${c}"` : ''} aria-hidden="true"><use href="#i-${n}"/></svg>`;
let noteData = {}, noteSubs = {};   // notes: one short line each friend can see in chat
let remotePosts = null, unsubPosts = null, feedLoading = false;

function startPostsListener() {
  if (unsubPosts) return;
  const q = query(ref(db, 'posts'), orderByChild('createdAt'), limitToLast(50));
  feedLoading = true; renderPosts();
  unsubPosts = onValue(q, snap => {
    feedLoading = false; hideAppSkeleton();
    const v = snap.val() || {};
    Object.values(v).forEach(p => watchPhoto(p.authorUid));
    remotePosts = Object.entries(v).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.createdAt || Date.now()) - (a.createdAt || Date.now()));
    renderPosts();
  }, err => {
    console.warn('Shared posts unavailable (check Realtime Database rules):', err);
    feedLoading = false; hideAppSkeleton(); remotePosts = null; unsubPosts = null; renderPosts();
  });
}
    function stopPostsListener() { if (unsubPosts) unsubPosts(); unsubPosts = null; remotePosts = null; }

/* =====================================================================
   HOME FEED  -  posts, likes, comments
   ===================================================================== */
/* the extras a post can carry (see CREATE POST) */
function postSubHtml(p) {
  const bits = [];
  if (p.feeling && p.feeling.text) bits.push((p.feeling.type === 'feeling' ? 'feeling ' : '') + esc(p.feeling.text));
  if (p.place) bits.push('at ' + esc(p.place));
  const tags = p.tags ? Object.entries(p.tags) : [];
  if (tags.length) bits.push('with ' + tags.map(([u, n]) => `<button type="button" class="post-tag" data-profile="${esc(u)}">${esc(n)}</button>`).join(', '));
  return bits.length ? `<div class="post-sub">${bits.join(' · ')}</div>` : '';
}
function postMediaHtml(p) {
  let h = '';
  if (p.music && p.music.song) h += `<div class="post-chip">${ic('music', '#f35fb0')}<span>${esc(p.music.song)}${p.music.artist ? ' – ' + esc(p.music.artist) : ''}</span></div>`;
  if (p.event && p.event.title) {
    const d = new Date(p.event.when || 0);
    h += `<div class="post-event"><div class="ev-date"><b>${d.getDate()}</b><span>${esc(d.toLocaleString('en', { month: 'short' }))}</span></div><div><strong>${esc(p.event.title)}</strong><small>${esc(fmtEventWhen(p.event.when || 0))}${p.event.place ? ' · ' + esc(p.event.place) : ''}</small></div></div>`;
  }
  if (okImg(p.photo)) h += `<img class="post-photo" src="${p.photo}" alt="Photo in post" loading="lazy" />`;
  return h;
}
let savedPostIds = {};
function renderPosts() {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';
  if (feedLoading && !remotePosts) { postsEl.innerHTML = '<div class="skeleton-post"><i></i><b></b><b></b></div>'.repeat(3); return; }
  const uid = meUid();
  const list = remotePosts
    ? remotePosts.filter(canSeePost).map(p => ({ raw: p, aud: p.audience || 'public', id: p.id, name: p.authorName || 'Someone', username: p.authorUsername || '', text: p.text || '', likes: Object.keys(p.likes || {}).length, liked: !!uid && !!(p.likes || {})[uid], mine: p.authorUid === uid, uid: p.authorUid, time: p.createdAt, remote: true }))
    : state.posts.map(p => { const a = getUserById(p.author); return { id: p.id, name: a.name, username: a.username || '@user', text: p.text, likes: p.likes, liked: p.liked, mine: false, remote: false }; });
  if (!list.length) { postsEl.innerHTML = '<div class="empty empty-rich">' + ic('sparkle') + '<strong>Nothing here yet</strong>Be the first to share something with your friends.</div>'; return; }
  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'post';
    card.innerHTML = `
      <div class="post-head">${p.uid ? `<button type="button" class="person-link" data-profile="${esc(p.uid)}">` : '<div class="meta">'}
        ${avatarHtml(p.uid, p.name)}
        <div style="text-align:left"><strong>${esc(p.name)}</strong><br /><small>${esc(p.username)}${p.time ? ' · ' + timeAgo(p.time) : ''}${p.remote ? ` · <span class="aud-tag" title="${esc(audMeta(p.aud)[1])}">${ic(audMeta(p.aud)[0])}</span>` : ''}</small></div>
      ${p.uid ? '</button>' : '</div>'}</div>
      ${p.raw ? postSubHtml(p.raw) : ''}
      ${p.text ? `<p>${esc(p.text)}</p>` : ''}
      ${p.raw ? postMediaHtml(p.raw) : ''}
      <div class="post-actions">
        <button class="${p.liked ? 'active' : ''}" data-like="${esc(p.id)}" type="button">${ic('heart')}Like${p.likes ? ' ' + p.likes : ''}</button>
        ${p.remote ? `<button type="button" data-comment="${esc(p.id)}">${ic('comment')}Comment</button><button type="button" data-save-post="${esc(p.id)}">${savedPostIds[p.id] ? '★ Saved' : '☆ Save'}</button>` : ''}
        ${p.mine ? `<button type="button" data-del="${esc(p.id)}">Delete</button>` : (p.remote ? `<button type="button" data-report-post="${esc(p.id)}" data-name="${esc(p.name)}">Report</button>` : '')}
      </div>`;
    card.dataset.pid = p.id;
    postsEl.appendChild(card);
    if (p.remote && openComments.has(p.id)) attachComments(card, p.id);
  });
}

function renderMenuHeader() {
  const cu = state.currentUser || {};
  document.getElementById('menuAvatar').textContent = initials(cu.name || '?');
  document.getElementById('menuName').textContent = cu.name || 'Your name';
  document.getElementById('menuUser').textContent = cu.username || '';
  applyOwnPhoto();
}

let friendDocs = [], unsubFriends = null, activeChatUid = null, unsubMsgs = null, chatMsgs = [], searchResults = [];
const meUid = () => auth.currentUser?.uid;
const otherOf = d => ({ uid: d.uid, name: d.name, username: d.username });
const friendsOf = () => friendDocs.filter(d => d.status === 'accepted');
const incoming = () => friendDocs.filter(d => d.status === 'incoming');
const outgoing = () => friendDocs.filter(d => d.status === 'outgoing');
const chatIdOf = (a, b) => [a, b].sort().join('_');
const blocked = new Map();            // uid -> name of people you stopped (see BLOCK PEOPLE)
let blockedLoadedFor = null;
const isBlocked = uid => { loadBlocked(); return blocked.has(uid); };
const chatFriends = () => friendsOf().filter(d => !isBlocked(d.uid));

const photoCache = {};
let photoSubs = {}, photoTick = false;
const photoFor = uid => uid && uid === meUid() ? state.currentUser?.photo : photoCache[uid];
const avatarHtml = (uid, name) => { const u = photoFor(uid); return okImg(u) ? `<div class="avatar" style="background-image:url('${u}');background-size:cover;background-position:center"></div>` : `<div class="avatar">${esc(initials(name))}</div>`; };
function refreshPhotoViews() {
  if (photoTick) return; photoTick = true;
  setTimeout(() => { photoTick = false; renderFriends(); renderChats(); renderPosts(); renderAlerts(); renderStories(); }, 120);
}
function watchPhoto(uid) {
  if (!uid || photoSubs[uid]) return;
  photoSubs[uid] = onValue(ref(db, 'profiles/' + uid + '/photo'), snap => {
    const v = snap.val() || '';
    if (photoCache[uid] !== v) { photoCache[uid] = v; refreshPhotoViews(); }
  }, () => {});
}

/* =====================================================================
   FRIENDS  -  search, requests, accept/delete
   ===================================================================== */
// one Facebook-style row: big avatar, name, small line, two buttons side by side
function fbRow(uid, name, sub, primary, secondary, i) {
  return `<div class="fr-row" style="--i:${Math.min(i || 0, 8)}">
    <button type="button" class="fr-av person-link" data-profile="${esc(uid)}" aria-label="Open ${esc(name)}">${avatarHtml(uid, name)}</button>
    <div class="fr-body">
      <button type="button" class="fr-name person-link" data-profile="${esc(uid)}">${esc(name)}</button>
      <div class="fr-sub">${sub}</div>
      <div class="fr-btns">${primary || ''}${secondary || ''}</div>
    </div></div>`;
}
const frBlue = (attr, val, label) => `<button class="fr-btn blue" ${attr}="${esc(val)}" type="button">${label}</button>`;
const frGray = (attr, val, label) => `<button class="fr-btn gray" ${attr}="${esc(val)}" type="button">${label}</button>`;
const statusLine = (uid, username) => `<span class="${isActive(uid) ? 'st-on' : 'st-off'}">${isActive(uid) ? CONFIG.text.online : CONFIG.text.offline}</span> \u00b7 ${esc(username)}`;

let frTab = 'suggest';
function setFrTab(tab) {
  frTab = tab; animateRows();
  document.querySelectorAll('[data-frtab]').forEach(b => { const on = b.dataset.frtab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('[data-frpanel]').forEach(p => { p.hidden = p.dataset.frpanel !== tab; });
}
document.querySelectorAll('[data-frtab]').forEach(b => b.addEventListener('click', () => setFrTab(b.dataset.frtab)));
// the search form is hidden until you tap the search button; hiding it also clears it
function setFrSearch(on) {
  const block = document.getElementById('findBlock'), input = document.getElementById('friendSearch');
  block.hidden = !on;
  if (on) { setFrTab('suggest'); setTimeout(() => input.focus(), 40); return; }
  input.value = '';
  if (searchResults.length) { searchResults = []; renderFriends(); }
}
document.getElementById('frSearchIcon').addEventListener('click', () => setFrSearch(document.getElementById('findBlock').hidden));

function renderFriends() {
  const req = incoming();
  document.getElementById('reqCard').hidden = !req.length;
  document.getElementById('reqCount').textContent = req.length || '';
  document.getElementById('reqList').innerHTML = req.map((d, i) => fbRow(d.uid, d.name, esc(d.username), frBlue('data-fr-accept', d.uid, 'Confirm'), frGray('data-fr-del', d.uid, 'Delete'), i)).join('');

  const f = friendsOf();
  document.getElementById('friendCount').textContent = f.length || '';
  document.getElementById('friendsList').innerHTML = f.length
    ? f.map((d, i) => { const o = otherOf(d); return fbRow(o.uid, o.name, statusLine(o.uid, o.username), frBlue('data-msg', o.uid, 'Message'), frGray('data-fr-del', d.uid, 'Remove'), i); }).join('')
    : '<div class="empty">No friends yet. Search for a username in Suggestions.</div>';

  const sent = outgoing();
  document.getElementById('sentCard').hidden = !sent.length;
  document.getElementById('sentList').innerHTML = sent.map((d, i) => fbRow(d.uid, d.name, esc(d.username), frGray('data-fr-del', d.uid, 'Cancel request'), '', i)).join('');

  document.getElementById('peopleBlock').hidden = !searchResults.length;
  document.getElementById('searchResults').innerHTML = searchResults.map((r, i) => {
    const rel = friendDocs.find(d => d.uid === r.uid);
    const first = rel ? `<span class="fr-note">${rel.status === 'accepted' ? 'Friends' : 'Request pending'}</span>` : frBlue('data-fr-add', i, 'Add friend');
    return fbRow(r.uid, r.name, esc(r.username), first, '', i);
  }).join('');
}

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
function startChatSession(uid) {
  if (!uid || uid === meUid()) return;
  stopChatSession();
  activeChatUid = uid;
  const token = chatSessionToken;
  const base = chatPath();
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

/* =====================================================================
   ALERTS  -  friend requests and notifications
   ===================================================================== */
function renderAlerts() {
  const inc = incoming();
  const acc = [];
  const el = document.getElementById('alertsList');
  const ann = liveAnnouncements(), seen = seenAnn();
  el.innerHTML = (inc.length || notes.length || ann.length) ? '' : '<div class="empty">No alerts yet.</div>';
  ann.forEach(a => {   // messages from the admin of Murmur (published in admin.html)
    const mins = Math.max(0, Math.round((Date.now() - (a.createdAt || Date.now())) / 60000));
    const when = mins < 1 ? 'now' : mins < 60 ? mins + 'm' : mins < 1440 ? Math.round(mins / 60) + 'h' : Math.round(mins / 1440) + 'd';
    el.insertAdjacentHTML('beforeend', `<div class="notice admin-notice ${a.kind === 'warn' ? 'warn' : ''}"><span class="admin-ava" aria-hidden="true">M</span><div style="flex:1;min-width:0"><h4>${esc(a.title)}</h4><p>${esc(a.body)}</p><small>From Admin of Murmur · ${when}</small></div>${seen.includes(a.id) ? '' : '<span class="dot" style="background:var(--acc)"></span>'}</div>`);
  });
  inc.forEach(d => el.insertAdjacentHTML('beforeend', `<div class="notice" data-goto="friends"><button type="button" class="person-link">${avatarHtml(d.uid, d.name)}<div style="flex:1;min-width:0"><h4>${esc(d.name)} sent you a friend request</h4><small>${esc(d.username)}</small></div></button></div>`));
  acc.forEach(d => el.insertAdjacentHTML('beforeend', `<div class="notice"><span class="dot" style="background:rgba(20,33,61,0.3)"></span><div><h4>${esc(d.toName)} accepted your friend request</h4><small>${esc(d.toUsername)}</small></div></div>`));
  notes.forEach(n => el.insertAdjacentHTML('beforeend', `<div class="notice"${n.type === 'like' ? ' data-goto="home"' : ''}><span class="dot" style="background:${n.read ? 'rgba(20,33,61,0.3)' : 'var(--acc)'}"></span><div><h4>${n.type === 'like' ? esc(n.text) : 'Message from Murmur'}</h4>${n.type === 'like' ? '' : `<p>${esc(n.text)}</p>`}</div></div>`));
  const unread = notes.filter(n => !n.read).length + (state.activeView === 'alerts' ? 0 : ann.filter(a => !seen.includes(a.id)).length);
  document.title = (inc.length + unread ? `(${inc.length + unread}) ` : '') + 'Murmur – Chat, share and watch together';
  [['friendsBadge', inc.length], ['alertsBadge', inc.length + unread]].forEach(([id, c]) => { const b = document.getElementById(id); b.textContent = c; b.hidden = !c; });
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
/* =====================================================================
   ONLINE STATUS  -  green = online, gray = offline
   ===================================================================== */
let presenceMap = {}, presenceSubs = {};
const isActive = u => Date.now() - (presenceMap[u] || 0) < CONFIG.onlineWindowMs;
function syncPresence() {
  const want = new Set(friendsOf().map(d => d.uid));
  Object.keys(presenceSubs).forEach(u => { if (!want.has(u)) { presenceSubs[u](); delete presenceSubs[u]; delete presenceMap[u]; } });
  friendDocs.forEach(d => watchPhoto(d.uid));
  want.forEach(u => { if (!presenceSubs[u]) presenceSubs[u] = onValue(ref(db, 'presence/' + u), s => { presenceMap[u] = s.val() || 0; renderChats(); }, () => {}); });
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
  const raw = document.getElementById('friendSearch').value.trim().toLowerCase().replace(/^@/, '');
  if (raw.length < 3) { showToast('Type at least 3 letters of a username.'); return; }
  try {
    const snap = await get(query(ref(db, 'profiles'), orderByChild('usernameLower'), equalTo('@' + raw)));
    searchResults = Object.values(snap.val() || {}).filter(r => r.uid !== meUid());
    searchResults.forEach(r => watchPhoto(r.uid));
    if (!searchResults.length) showToast('No one found with that username.');
  } catch (e) { showToast(friendlyError(e, 'Search failed.')); }
  renderFriends();
}

async function sendFriendRequest(t) {
  const me = state.currentUser, u = meUid(), now = serverTimestamp();
  try {
    await update(ref(db), {
      [`friends/${u}/${t.uid}`]: { uid: t.uid, name: t.name, username: t.username, status: 'outgoing', createdAt: now },
      [`friends/${t.uid}/${u}`]: { uid: u, name: me.name, username: me.username, status: 'incoming', createdAt: now }
    });
    showToast('Friend request sent.');
  } catch (e) { showToast(friendlyError(e, 'Could not send request.')); }
}

function renderAll() {
  document.getElementById('composerAvatar').textContent = initials(getCurrentUserName());
  document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === state.activeView));
  document.querySelectorAll('.pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === state.activeView));
  [renderPosts, renderMenuHeader, renderFriends, renderChats, renderConversation, renderAlerts, renderReels].forEach(render => render());
}

// rows only animate right after you switch tabs (not on every background refresh)
function animateRows() { document.body.dataset.rowanim = '1'; clearTimeout(animateRows.t); animateRows.t = setTimeout(() => delete document.body.dataset.rowanim, 900); }
/* what happens when you leave a screen (kept in one place, so adding a screen means adding one line) */
function leaveView(next) {
  if (next !== 'chats' && activeChatUid) { if (location.hash === '#chat') history.replaceState(null, '', location.pathname + location.search); closeChat(); }
  if (next !== 'reels') pauseReels();
  if (next === 'friends' && typeof setFrSearch === 'function') setFrSearch(false);
  if (next === 'alerts') { markNotesRead(); markAnnSeen(); }
}
function setView(view) {
  animateRows();
  leaveView(view);
  state.activeView = view;
  saveState();
  renderAll();
  window.scrollTo(0, 0);
}

function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  if (score <= 2) return { score: 1, label: 'Weak', color: '#d84848' };
  if (score <= 4) return { score: 2, label: 'Fair', color: '#d18b14' };
  return { score: 3, label: 'Strong', color: '#14c8a0' };
}

function validateUsername(value) {
  const username = value.trim();
  if (!username) return 'Choose a username.';
  if (!/^@?[a-zA-Z0-9._-]{3,20}$/.test(username)) return 'Use 3–20 letters/numbers, periods, dashes, or underscores.';
  const normalized = username.startsWith('@') ? username : '@' + username;
  const taken = Object.values(state.users).some(user => (user.username || '').toLowerCase() === normalized.toLowerCase());
  if (taken) return 'That username is already taken.';
  return '';
}

function isAdult(dateString) {
  if (!dateString) return false;
  const birth = new Date(dateString);
  const now = new Date();
  const age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) return age - 1 >= 13;
  return age >= 13;
}

function saveProfileToRealtimeDatabase(uid, profileData) {
  return set(ref(db, 'users/' + uid), profileData);
}

function friendlyError(e, fallback) {
  const code = String((e && e.code) || '');
  const map = {
    'auth/email-already-in-use': 'That email is already registered. Try logging in instead.',
    'auth/invalid-email': 'Use a valid email address.',
    'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
    'auth/network-request-failed': 'No internet connection. Check your connection and try again.',
    'auth/too-many-requests': 'Too many tries. Please wait a moment and try again.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/operation-not-allowed': 'Sign up is not available right now. Please try again later.',
    'auth/requires-recent-login': 'Please log in again and try once more.',
    'auth/unauthorized-domain': 'This website address is not allowed to sign in yet.'
  };
  if (map[code]) return map[code];
  const msg = String((e && e.message) || '');
  if (/permission/i.test(code + ' ' + msg)) return 'You do not have permission to do that.';
  if (!msg || /firebase|auth\/|database|firestore/i.test(msg)) return fallback || 'Something went wrong. Please try again.';
  return msg;
}

let registerOverlay = null;

function closeRegisterWizard(fromHash) {
  if (!registerOverlay) return;
  registerOverlay.remove();
  registerOverlay = null;
  document.body.style.overflow = '';
  if (!fromHash && location.hash === '#create-account') history.back();
}

window.addEventListener('hashchange', () => {
  const h = location.hash;
  if (postOverlay && h !== '#new-post') closePost(true);
  if (h === '#new-post') return;
  if (storyOverlay && h !== '#new-story') closeStoryMaker(true);
  if (h === '#new-story') return;
  if (h === '#profile') return;
  if (profileOverlay) closeProfile(true);
  if (h === '#chat') return;
  if (activeChatUid) closeChat();
  if (LEGAL_HASHES[h]) { openLegal(LEGAL_HASHES[h]); return; }
  if (legalOverlay) closeLegal(true);
  if (h === '#create-account') {
    if (forgotOverlay) closeForgotPassword(true);
    if (!registerOverlay && !state.loggedIn) openRegisterWizard();
  } else if (h === '#forgot-password') {
    if (registerOverlay) closeRegisterWizard(true);
    if (!forgotOverlay && !state.loggedIn) openForgotPassword();
  } else {
    if (registerOverlay) closeRegisterWizard(true);
    if (forgotOverlay) closeForgotPassword(true);
  }
});

/* =====================================================================
   CREATE ACCOUNT  -  step-by-step sign up
   ===================================================================== */
function openRegisterWizard() {
  if (registerOverlay) return;
  if (location.hash !== '#create-account') history.pushState(null, '', '#create-account');

  const STEPS = [
    { title: 'Name', hint: 'Who you are' },
    { title: 'Account', hint: 'Username & email' },
    { title: 'Password', hint: 'Keep it secure' },
    { title: 'Profile', hint: 'Photo & bio' },
    { title: 'Details', hint: 'Location & interests' },
    { title: 'Review', hint: 'Confirm & create' }
  ];
  const TOTAL = STEPS.length;

  const overlay = document.createElement('div');
  registerOverlay = overlay;
  document.body.style.overflow = 'hidden';
  overlay.className = 'screen-registration';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'register-title');
  overlay.innerHTML = `
    <aside class="reg-side">
      <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
      <div class="reg-side-intro">
        <h2>Join the social space built for people you actually know.</h2>
        <p>Work through each tab at your own pace. You can jump back to any step before you create your account.</p>
      </div>
      <nav class="reg-tabs" role="tablist" aria-label="Sign up steps">
        ${STEPS.map((s, i) => `
          <button type="button" class="reg-tab" role="tab" data-tab="${i + 1}">
            <span class="num">${i + 1}</span>
            <span>${s.title}<small>${s.hint}</small></span>
          </button>`).join('')}
      </nav>
    </aside>

    <section class="reg-main">
      <div class="reg-topbar">
        <div>
          <strong id="register-title">Create account</strong>
          <small data-step-label>Step 1 of ${TOTAL}</small>
        </div>
        <button class="close-btn" type="button" aria-label="Close and go back to login">×</button>
      </div>
      <div class="reg-progress"><div data-progress></div></div>

      <div class="reg-body" data-body>
        <div class="reg-content">

          <div class="reg-step active" data-step="1">
            <div class="reg-step-head">
              <h3>What should we call you?</h3>
              <p>Use the name your friends know you by.</p>
            </div>
            <div class="row">
              <div class="field"><label for="reg-first">First name</label><input id="reg-first" name="firstName" type="text" autocomplete="given-name" placeholder="First name" /></div>
              <div class="field"><label for="reg-last">Last name</label><input id="reg-last" name="lastName" type="text" autocomplete="family-name" placeholder="Last name" /></div>
            </div>
            <div class="row">
              <div class="field"><label for="reg-middle">Middle name (optional)</label><input id="reg-middle" name="middleName" type="text" autocomplete="additional-name" placeholder="Middle name" /></div>
              <div class="field"><label for="reg-birthday">Birthday</label><input id="reg-birthday" name="birthday" type="date" autocomplete="bday" /></div>
            </div>
            <div class="field-hint">You must be at least 13 to use Murmur.</div>
          </div>

          <div class="reg-step" data-step="2">
            <div class="reg-step-head">
              <h3>Set up your account</h3>
              <p>Pick a username and the email you'll log in with.</p>
            </div>
            <div class="field">
              <label for="reg-username">Username</label>
              <input id="reg-username" name="username" type="text" autocomplete="username" placeholder="@jian123" />
              <div class="error" data-user-error></div>
            </div>
            <div class="field">
              <label for="reg-email">Email address</label>
              <input id="reg-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" />
            </div>
          </div>

          <div class="reg-step" data-step="3">
            <div class="reg-step-head">
              <h3>Create a password</h3>
              <p>Make it at least 8 characters. A mix of letters, numbers and symbols is stronger.</p>
            </div>
            <div class="field">
              <label for="reg-password">Password</label>
              <div class="password-wrap">
                <input id="reg-password" name="password" type="password" autocomplete="new-password" placeholder="Create a password" />
                <button class="password-toggle" type="button">Show</button>
              </div>
              <div class="strength-bar"><div class="strength-fill"></div></div>
              <div class="password-feedback"></div>
            </div>
            <div class="field">
              <label for="reg-confirm">Confirm password</label>
              <div class="password-wrap">
                <input id="reg-confirm" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Confirm your password" />
                <button class="password-toggle" type="button">Show</button>
              </div>
            </div>
          </div>

          <div class="reg-step" data-step="4">
            <div class="reg-step-head">
              <h3>Build your profile</h3>
              <p>Everything on this tab is optional. You can change it later.</p>
            </div>
            <div class="field reg-photo-field">
              <label>Profile photo <span class="reg-photo-optional">Optional</span></label>
              <input id="reg-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
              <div class="reg-photo-card">
                <div class="reg-photo-avatar" data-photo-preview aria-live="polite">
                  <span data-photo-placeholder>Choose a photo</span>
                  <img data-photo-image alt="Profile photo preview" hidden />
                </div>
                <div class="reg-photo-copy">
                  <strong data-photo-title>No photo selected</strong>
                  <small data-photo-description>Your profile looks better with a photo. You can add one now or do it later.</small>
                  <div class="reg-photo-actions">
                    <button class="reg-photo-pick" type="button" data-pick-photo>Choose photo</button>
                    <button class="reg-photo-remove" type="button" data-remove-photo hidden>Remove</button>
                  </div>
                </div>
              </div>
              <small class="reg-photo-help">Select a picture from your device. JPG, PNG, WebP or GIF · Maximum 5 MB.</small>
            </div>
            <div class="field">
              <label for="reg-bio">Short bio</label>
              <textarea id="reg-bio" name="bio" placeholder="Tell people a little about yourself..."></textarea>
            </div>
            <div class="field">
              <label for="reg-gender">Gender</label>
              <select id="reg-gender" name="gender">
                <option value="">Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Non-binary</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          <div class="reg-step" data-step="5">
            <div class="reg-step-head">
              <h3>A few more details</h3>
              <p>Help friends find you. All optional.</p>
            </div>
            <div class="row">
              <div class="field"><label for="reg-location">Location</label><input id="reg-location" name="location" type="text" autocomplete="address-level2" placeholder="City, Country" /></div>
              <div class="field"><label for="reg-school">School</label><input id="reg-school" name="school" type="text" placeholder="School or university" /></div>
            </div>
            <div class="field">
              <label for="reg-phone">Phone number</label>
              <input id="reg-phone" name="phone" type="tel" autocomplete="tel" placeholder="Optional" />
            </div>
            <div class="section-label">Hobbies &amp; interests</div>
            <div class="interest-grid">
              ${['Music','Gaming','Anime','Writing','Photography','Sports','Technology','Travel','Art'].map(t => `<button type="button" class="interest-option" aria-pressed="false">${t}</button>`).join('')}
            </div>
          </div>

          <div class="reg-step" data-step="6">
            <div class="reg-step-head">
              <h3>Review &amp; create</h3>
              <p>Check everything looks right. Use Edit to jump back to any section.</p>
            </div>
            <div class="profile-preview">
              <div class="avatar" data-preview-avatar>U</div>
              <div>
                <h4 data-preview-name>Your name</h4>
                <p data-preview-username>@yourname</p>
              </div>
            </div>
            <dl class="review-list" data-review-list style="margin:0"></dl>
            <label class="checkbox-row">
              <input type="checkbox" id="termsCheck" />
              <span>I agree to the <a href="#terms">Terms of Service</a>, <a href="#privacy">Privacy Policy</a> and <a href="#cookies">Cookie Policy</a>, and I am 13+ years old.</span>
            </label>
          </div>

        </div>
      </div>

      <div class="reg-footer">
        <button type="button" class="btn ghost" data-action="back">Back</button>
        <div class="reg-error" role="alert" aria-live="polite" data-reg-error></div>
        <button type="button" class="btn primary" data-action="next">Continue</button>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);

  let step = 1;
  const completed = new Set();
  const $ = sel => overlay.querySelector(sel);
  const field = name => overlay.querySelector(`[name="${name}"]`);
  const tabs = [...overlay.querySelectorAll('.reg-tab')];
  const panes = [...overlay.querySelectorAll('.reg-step')];
  const nextButton = $('[data-action="next"]');
  const backButton = $('[data-action="back"]');
  const errorBox = $('[data-reg-error]');
  const bodyEl = $('[data-body]');
  const usernameInput = field('username');
  const passwordInput = field('password');
  const confirmInput = field('confirmPassword');
  const profilePhotoInput = field('photo');
  const photoPreviewImage = $('[data-photo-image]');
  const photoPlaceholder = $('[data-photo-placeholder]');
  const photoTitle = $('[data-photo-title]');
  const photoDescription = $('[data-photo-description]');
  const removePhotoButton = $('[data-remove-photo]');
  let profilePhotoPreviewUrl = '';
  const clearProfilePhotoPreview = () => {
    if (profilePhotoPreviewUrl) URL.revokeObjectURL(profilePhotoPreviewUrl);
    profilePhotoPreviewUrl = '';
    photoPreviewImage.removeAttribute('src');
    photoPreviewImage.hidden = true;
    photoPlaceholder.hidden = false;
    photoTitle.textContent = 'No photo selected';
    photoDescription.textContent = 'Your profile looks better with a photo. You can add one now or do it later.';
    removePhotoButton.hidden = true;
  };
  $('[data-pick-photo]').addEventListener('click', () => profilePhotoInput.click());
  removePhotoButton.addEventListener('click', () => {
    profilePhotoInput.value = '';
    clearProfilePhotoPreview();
  });
  profilePhotoInput.addEventListener('change', () => {
    const file = profilePhotoInput.files && profilePhotoInput.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg','image/png','image/webp','image/gif'];
    if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      profilePhotoInput.value = '';
      clearProfilePhotoPreview();
      setError('Choose a JPG, PNG, WebP or GIF image smaller than 5 MB.');
      return;
    }
    if (profilePhotoPreviewUrl) URL.revokeObjectURL(profilePhotoPreviewUrl);
    profilePhotoPreviewUrl = URL.createObjectURL(file);
    photoPreviewImage.src = profilePhotoPreviewUrl;
    photoPreviewImage.hidden = false;
    photoPlaceholder.hidden = true;
    photoTitle.textContent = file.name;
    photoDescription.textContent = 'Photo selected. You can change or remove it before creating your account.';
    removePhotoButton.hidden = false;
    setError('');
  });

  const selectedInterests = new Set();
  overlay.querySelectorAll('.interest-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const text = opt.textContent.trim();
      if (selectedInterests.has(text)) selectedInterests.delete(text);
      else selectedInterests.add(text);
      const on = selectedInterests.has(text);
      opt.classList.toggle('selected', on);
      opt.setAttribute('aria-pressed', String(on));
    });
  });

  function setError(message) { errorBox.textContent = message || ''; }
  function normUser(v) { const t = v.trim(); return t.startsWith('@') ? t : '@' + t; }

  function validateStep(n) {
    if (n === 1) {
      if (!field('firstName').value.trim() || !field('lastName').value.trim()) return 'Add your first and last name.';
      const b = field('birthday').value;
      if (!b) return 'Add your birthday.';
      if (!isAdult(b)) return 'You must be at least 13 to create an account.';
    }
    if (n === 2) {
      const userErr = validateUsername(usernameInput.value);
      if (userErr) return userErr;
      const email = field('email').value.trim();
      if (!email) return 'Add your email address.';
      if (!email.includes('@')) return 'Use a valid email address.';
    }
    if (n === 3) {
      if (!passwordInput.value || passwordInput.value.length < 8) return 'Password must be at least 8 characters long.';
      if (passwordInput.value !== confirmInput.value) return 'Passwords do not match.';
    }
    if (n === 6) {
      if (!$('#termsCheck').checked) return 'You must accept the terms before creating your account.';
    }
    return '';
  }

  function renderReview() {
    const first = field('firstName').value.trim();
    const middle = field('middleName').value.trim();
    const last = field('lastName').value.trim();
    const name = [first, last].filter(Boolean).join(' ') || 'Your name';
    const fullName = [first, middle, last].filter(Boolean).join(' ') || 'Your name';
    const username = usernameInput.value.trim() ? normUser(usernameInput.value) : '@yourname';
    $('[data-preview-name]').textContent = name;
    $('[data-preview-avatar]').textContent = initials(name);
    $('[data-preview-username]').textContent = username;

    const rows = [
      ['Name', fullName, 1],
      ['Birthday', field('birthday').value, 1],
      ['Username', username, 2],
      ['Email', field('email').value.trim(), 2],
      ['Password', '•'.repeat(Math.min(passwordInput.value.length, 12)), 3],
      ['Bio', field('bio').value.trim(), 4],
      ['Gender', field('gender').value, 4],
      ['Location', field('location').value.trim(), 5],
      ['School', field('school').value.trim(), 5],
      ['Phone', field('phone').value.trim(), 5],
      ['Interests', [...selectedInterests].join(', '), 5]
    ];
    const list = $('[data-review-list]');
    list.innerHTML = '';
    rows.forEach(([label, value, target]) => {
      const row = document.createElement('div');
      row.className = 'review-row';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || 'Not added';
      if (!value) dd.className = 'empty-val';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => goTo(target));
      row.append(dt, dd, edit);
      list.appendChild(row);
    });
  }

  function updateUI() {
    tabs.forEach((tab, i) => {
      const n = i + 1;
      const isDone = completed.has(n) && n !== step;
      tab.classList.toggle('active', n === step);
      tab.classList.toggle('done', isDone);
      tab.setAttribute('aria-selected', String(n === step));
      tab.querySelector('.num').textContent = isDone ? '' : n;
    });
    panes.forEach(p => p.classList.toggle('active', Number(p.dataset.step) === step));
    backButton.style.visibility = step === 1 ? 'hidden' : 'visible';
    nextButton.textContent = step === TOTAL ? 'Create account' : 'Continue';
    $('[data-step-label]').textContent = `Step ${step} of ${TOTAL} · ${STEPS[step - 1].title}`;
    $('[data-progress]').style.width = `${(step / TOTAL) * 100}%`;
    setError('');
    if (step === TOTAL) renderReview();
    bodyEl.scrollTop = 0;
    const firstInput = panes[step - 1].querySelector('input:not([type="file"]):not([type="checkbox"]), textarea, select');
    if (firstInput) setTimeout(() => firstInput.focus({ preventScroll: true }), 30);
  }

  function goTo(target) {
    if (target < step) { step = target; updateUI(); return; }
    for (let n = step; n < target; n++) {
      const err = validateStep(n);
      if (err) {
        step = n;
        updateUI();
        setError(err);
        return;
      }
      completed.add(n);
    }
    step = target;
    updateUI();
  }

  function updateStrength() {
    const password = passwordInput.value;
    const strength = getPasswordStrength(password);
    const fill = $('.strength-fill');
    fill.style.width = `${password ? (strength.score / 3) * 100 : 0}%`;
    fill.style.background = strength.color;
    $('.password-feedback').innerHTML = password
      ? `<strong style="color:${strength.color}">${strength.label}</strong> Use 8+ characters and mix letters, numbers, symbols.`
      : 'Use 8+ characters and mix letters, numbers, symbols.';
  }

  async function submit() {
    const err = validateStep(TOTAL);
    if (err) { setError(err); return; }
    for (let n = 1; n < TOTAL; n++) {
      const e = validateStep(n);
      if (e) { goTo(n); setError(e); return; }
    }

    const first = field('firstName').value.trim();
    const middle = field('middleName').value.trim();
    const last = field('lastName').value.trim();
    const fullName = [first, middle, last].filter(Boolean).join(' ');
    const normalizedUser = normUser(usernameInput.value);
    const email = field('email').value.trim();
    const password = passwordInput.value;
    const userProfile = {
      firstName: first,
      middleName: middle,
      lastName: last,
      name: fullName,
      username: normalizedUser,
      email,
      birthday: field('birthday').value,
      gender: field('gender').value,
      school: field('school').value.trim(),
      location: field('location').value.trim(),
      phone: field('phone').value.trim(),
      bio: field('bio').value.trim(),
      interests: [...selectedInterests],
      createdAt: new Date().toISOString(),
      coverPhoto: '',
      profilePhoto: '',
      photo: ''
    };

    const selectedPhoto = profilePhotoInput.files && profilePhotoInput.files[0];
    if (selectedPhoto && (!selectedPhoto.type.startsWith('image/') || selectedPhoto.size > 5 * 1024 * 1024)) {
      goTo(4); setError('Choose an image smaller than 5 MB.'); return;
    }

    nextButton.disabled = true;
    nextButton.textContent = 'Creating...';
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      if (selectedPhoto) {
        const photoPath = 'profile-photos/' + uid + '/profile-' + Date.now();
        const photoTask = uploadBytesResumable(storageRef(getStorage(app), photoPath), selectedPhoto, { contentType: selectedPhoto.type });
        await new Promise((resolve, reject) => photoTask.on('state_changed', null, reject, resolve));
        const photoUrl = await getDownloadURL(photoTask.snapshot.ref);
        userProfile.profilePhoto = photoUrl;
        userProfile.photo = photoUrl;
        userProfile.photoPath = photoPath;
      }
      // Create/link the independent Supabase UUID immediately after Firebase creates the account.
      // The Firebase account remains valid if Supabase is temporarily unavailable; the status is surfaced below.
      const identityLink = await syncMurmurSupabaseIdentity(userCredential.user);
      try {
        await saveProfileToRealtimeDatabase(uid, userProfile);
        await ensureProfile(userCredential.user);
      } catch (profileErr) { console.warn('Profile save skipped:', profileErr); }
      state.loggedIn = true;
      state.currentUser = { name: fullName, email, username: normalizedUser, uid, ...(userProfile.photo ? { photo: userProfile.photo } : {}) };
      state.users.me = { ...state.currentUser };
      state.activeView = 'home';
      saveState();
      registerOverlay.remove();
      registerOverlay = null;
      document.body.style.overflow = '';
      history.replaceState(null, '', location.pathname + location.search);
      showApp();
      window.scrollTo(0, 0);
      showToast(identityLink && identityLink.status === 'connected'
        ? 'Welcome to Murmur! Your Firebase and Supabase IDs are linked.'
        : 'Account created. Supabase ID linking is pending; sign in again later to retry.');
    } catch (error) {
      console.error('Create account failed:', error && error.code);
      setError(friendlyError(error, 'Unable to create account.'));
      nextButton.disabled = false;
      nextButton.textContent = 'Create account';
    }
  }

  overlay.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-wrap').querySelector('input');
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      button.textContent = hidden ? 'Hide' : 'Show';
    });
  });

  usernameInput.addEventListener('input', () => {
    $('[data-user-error]').textContent = usernameInput.value ? validateUsername(usernameInput.value) : '';
  });
  passwordInput.addEventListener('input', updateStrength);
  overlay.addEventListener('input', () => setError(''));

  tabs.forEach(tab => tab.addEventListener('click', () => goTo(Number(tab.dataset.tab))));
  nextButton.addEventListener('click', () => { step === TOTAL ? submit() : goTo(step + 1); });
  backButton.addEventListener('click', () => { if (step > 1) goTo(step - 1); });
  $('.close-btn').addEventListener('click', () => closeRegisterWizard(false));

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeRegisterWizard(false); return; }
    if (e.key === 'Enter' && e.target.matches('input:not([type="checkbox"]):not([type="file"])')) {
      e.preventDefault();
      nextButton.click();
    }
  });

  updateUI();
  updateStrength();
}

/* =====================================================================
   LOG IN  -  email + password, uses the limits in SETTINGS
   ===================================================================== */
async function getAccountRestriction(uid) {
  const snap = await get(ref(db, 'suspended/' + uid));
  const info = snap.exists() ? snap.val() : null;
  if (!info) return null;
  const now = Date.now();
  if (info.deleted) return info;
  if (info.scheduledDelete) return Number(info.deleteAt) <= now ? { ...info, deleted: true, deletionDue: true } : null;
  if (info.expiresAt && Number(info.expiresAt) <= now) return null;
  return info;
}

async function login(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !String(password || '').trim()) {
    authError.textContent = 'Enter both email and password.';
    return;
  }
  if (!isValidEmail(normalized)) {
    authError.textContent = 'Use a valid email address.';
    return;
  }
  if (String(password).length > 128) {
    authError.textContent = 'That password is too long.';
    return;
  }
  const wait = loginLimiter.check();
  if (wait) {
    authError.textContent = `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`;
    return;
  }
  try {
    try { await setPersistence(auth, document.getElementById('rememberMe').checked ? browserLocalPersistence : browserSessionPersistence); } catch {}
    const userCredential = await signInWithEmailAndPassword(auth, normalized, password);
    const restriction = await getAccountRestriction(userCredential.user.uid);
    if (restriction) {
      suspendedInfo = restriction;
      myAppeal = (await get(ref(db, 'appeals/' + userCredential.user.uid)).catch(() => null))?.val?.() || null;
      state.loggedIn = false;
      appEl.hidden = true;
      renderSuspended();
      authError.textContent = 'This account is restricted. Review the notice on screen.';
      return;
    }
    const userDoc = await get(ref(db, 'users/' + userCredential.user.uid));
    const profile = userDoc.exists() ? userDoc.val() : {};
    state.loggedIn = true;
    state.currentUser = {
      uid: userCredential.user.uid,
      name: profile.name || userCredential.user.displayName || 'Me',
      email: userCredential.user.email || normalized,
      username: profile.username || '@user'
    };
    state.users.me = { ...state.currentUser };
    saveState();
    showApp();
  } catch (error) {
    console.error('Login failed:', error && error.code);
    authError.textContent = (error && /invalid-credential|wrong-password|user-not-found/.test(error.code || '')) ? 'Email or password is incorrect.' : friendlyError(error, 'Login failed. Please try again.');
  }
}

let forgotOverlay = null;

function closeForgotPassword(fromHash) {
  if (!forgotOverlay) return;
  forgotOverlay.remove();
  forgotOverlay = null;
  document.body.style.overflow = '';
  if (!fromHash && location.hash === '#forgot-password') history.back();
}

/* =====================================================================
   FORGOT PASSWORD
   ===================================================================== */
function openForgotPassword() {
  if (forgotOverlay) return;
  if (location.hash !== '#forgot-password') history.pushState(null, '', '#forgot-password');

  const overlay = document.createElement('div');
  forgotOverlay = overlay;
  document.body.style.overflow = 'hidden';
  overlay.className = 'screen-forgot';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'forgot-title');
  overlay.innerHTML = `
    <aside class="forgot-side">
      <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
      <div>
        <h2>Locked out? It happens.</h2>
        <p>Enter the email you signed up with and we'll send you a link to choose a new password.</p>
      </div>
      <span></span>
    </aside>
    <section class="forgot-main">
      <div class="forgot-top">
        <button class="close-btn" type="button" aria-label="Close and go back to login">×</button>
      </div>
      <div class="forgot-body">
        <div class="forgot-content">
          <h3 id="forgot-title">Reset your password</h3>
          <p data-forgot-intro>We'll email you a reset link.</p>
          <div class="field">
            <label for="forgot-email">Email address</label>
            <input id="forgot-email" type="email" autocomplete="email" placeholder="you@example.com" />
          </div>
          <div class="error" role="alert" aria-live="polite" data-forgot-error></div>
          <div class="forgot-success" data-forgot-success hidden></div>
          <button class="btn primary" type="button" data-forgot-send>Send reset link</button>
          <button class="btn ghost" type="button" data-forgot-back>Back to login</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);

  const $ = sel => overlay.querySelector(sel);
  const emailInput = $('#forgot-email');
  const errorBox = $('[data-forgot-error]');
  const successBox = $('[data-forgot-success]');
  const sendBtn = $('[data-forgot-send]');
  emailInput.value = (document.getElementById('email').value || '').trim();

  async function send() {
    const email = emailInput.value.trim();
    errorBox.textContent = '';
    successBox.hidden = true;
    if (!email) { errorBox.textContent = 'Add your email address first.'; return; }
    if (!email.includes('@')) { errorBox.textContent = 'Use a valid email address.'; return; }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      await sendPasswordResetEmail(auth, email);
      successBox.textContent = 'If an account exists for ' + email + ', a reset link is on its way. Check your inbox and spam folder.';
      successBox.hidden = false;
      sendBtn.textContent = 'Send again';
    } catch (error) {
      console.error('Password reset failed:', error && error.code);
      errorBox.textContent = error.code === 'auth/invalid-email'
        ? 'Use a valid email address.'
        : (friendlyError(error, 'Unable to send the reset email.'));
      sendBtn.textContent = 'Send reset link';
    }
    sendBtn.disabled = false;
  }

  sendBtn.addEventListener('click', send);
  $('[data-forgot-back]').addEventListener('click', () => closeForgotPassword(false));
  $('.close-btn').addEventListener('click', () => closeForgotPassword(false));
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeForgotPassword(false);
    if (e.key === 'Enter' && e.target === emailInput) { e.preventDefault(); send(); }
  });
  emailInput.addEventListener('input', () => { errorBox.textContent = ''; });
  setTimeout(() => emailInput.focus(), 30);
}

/* ---------- Privacy Policy, Cookie Policy and cookie notice ---------- */
// Replace with the address people should write to about their data.
const PRIVACY_CONTACT = 'privacy@example.com';
const POLICY_UPDATED = 'November 1, 2026';
const COOKIE_NOTICE_KEY = 'murmur-cookie-notice';
/* =====================================================================
   LEGAL PAGES  -  terms, privacy, cookies
   ===================================================================== */
const LEGAL_HASHES = { '#privacy': 'privacy', '#cookies': 'cookies', '#terms': 'terms' };

const LEGAL_PAGES = {
  terms: () => `
    <h1>Terms of Service</h1>
    <p class="legal-meta">Last updated: ${POLICY_UPDATED}</p>
    <p>These terms govern your use of Murmur. By creating an account or using Murmur you agree to them.</p>
    <h2>1. Who can use Murmur</h2>
    <p>You must be at least 13 years old and give accurate information when you sign up. You are responsible for your account and for keeping your password private.</p>
    <h2>2. Your content</h2>
    <p>You own what you post. You give Murmur permission to store and show it to other users so the service can work. Only post things you have the right to share.</p>
    <h2>3. Acceptable use</h2>
    <ul>
      <li>No harassment, hate, threats or sexual content involving minors.</li>
      <li>No spam, scams, impersonation or illegal content.</li>
      <li>No attempts to break, overload or get around the security of Murmur.</li>
    </ul>
    <p>We may remove content or suspend accounts that break these rules.</p>
    <h2>4. Ending your account</h2>
    <p>You can delete your account at any time from inside the app. We may suspend or end accounts that break these terms.</p>
    <h2>5. No guarantees</h2>
    <p>Murmur is provided "as is". We try to keep it running but cannot promise it will always be available or error-free. To the extent the law allows, we are not liable for indirect or lost-data damages.</p>
    <h2>6. Privacy</h2>
    <p>How we handle your information is explained in the <a href="#privacy">Privacy Policy</a> and <a href="#cookies">Cookie Policy</a>.</p>
    <h2>7. Changes and contact</h2>
    <p>We may update these terms and will change the date above when we do. Questions? Email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>
  `,

  privacy: () => `
    <h1>Privacy Policy</h1>
    <p class="legal-meta">Last updated: ${POLICY_UPDATED}</p>
    <p>This policy explains what personal information Murmur ("Murmur", "we", "us") collects, how we use it, who we share it with, and the choices you have. By creating an account or using Murmur you agree to it.</p>

    <h2>1. Information we collect</h2>
    <h3>Information you give us</h3>
    <ul>
      <li><strong>Account details:</strong> your first, middle and last name, username, email address and password. Your password is handled by Firebase Authentication. We never see it in readable form.</li>
      <li><strong>Birthday:</strong> used to check that you are at least 13 years old.</li>
      <li><strong>Optional profile details:</strong> gender, location, school, phone number, bio, interests and profile or cover photos, if you add them.</li>
    </ul>
    <h3>Information created as you use Murmur</h3>
    <p>Your posts, stories, comments, likes, friend connections, chats, reactions and notifications are stored in Firebase Realtime Database so they can sync between your devices and friends. Photos and videos you upload may be stored in Firebase Storage. Limited interface preferences and cached app state are kept in your browser storage.</p>
    <h3>Technical information</h3>
    <p>Our service providers record sign-in information such as your account ID and when you created your account and last signed in. They also process technical data such as your IP address and browser or device type so the service can run and stay secure.</p>

    <h2>2. How we use your information</h2>
    <ul>
      <li>To create and manage your account and let you log in.</li>
      <li>To send emails you need, such as password reset links.</li>
      <li>To show your name, username and profile to other people as part of Murmur's features.</li>
      <li>To keep Murmur safe, prevent misuse and fix problems.</li>
      <li>To follow the law and respond to valid legal requests.</li>
    </ul>

    <h2>3. Who we share it with</h2>
    <p>We do not sell your personal information. We share it only with:</p>
    <ul>
      <li><strong>Service providers.</strong> Murmur uses Firebase Authentication for sign-in, Firebase Realtime Database for profiles and social features, and Firebase Storage for uploaded media. Murmur also uses Supabase to create and privately link a separate Supabase account ID to your Firebase account. These providers process information under their own terms and privacy policies.</li>
      <li><strong>Authorities or other parties</strong> when the law requires it, or to protect the rights and safety of you, others or Murmur.</li>
      <li><strong>A successor</strong> if Murmur is merged with, or sold to, another service. We would tell you first if your information would be handled under a different policy.</li>
    </ul>

    <h2>4. What other people can see</h2>
    <p>Your name, username and the posts you share are visible to other Murmur users. Think before you post personal details, and only share what you are comfortable with others seeing.</p>

    <h2>5. Where your information is stored</h2>
    <p>Account and social information is stored with Firebase, and a separate account-ID link is stored privately with Supabase. These providers may process information in data centers outside the country where you live. Review their privacy policies for details about their processing and international transfers.</p>

    <h2>6. How long we keep it</h2>
    <p>Information is retained while needed to operate your account and the service. Deletion requests should cover your Firebase account, related Realtime Database records and uploaded files, and the private account-ID link held in Supabase; some records may remain where retention is required by law or needed for security. Browser-stored preferences and cached state remain until cleared from your device.</p>

    <h2>7. Your choices and rights</h2>
    <p>Depending on where you live, you may have the right to:</p>
    <ul>
      <li>ask for a copy of the information we hold about you;</li>
      <li>correct information that is wrong or out of date;</li>
      <li>ask us to delete your account and information;</li>
      <li>object to or limit certain uses of your information.</li>
    </ul>
    <p>To use any of these rights, email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>. We may need to confirm it is really you first. You can also clear the data Murmur keeps in your browser at any time from your browser settings.</p>

    <h2>8. Security</h2>
    <p>We use trusted providers and reasonable safeguards to protect your information. No online service is completely secure, so please choose a strong, unique password and keep it private.</p>

    <h2>9. Children</h2>
    <p>Murmur is not for children under 13. We do not knowingly collect information from anyone under 13. If you believe a child has given us information, contact us and we will delete it.</p>

    <h2>10. Cookies and similar technologies</h2>
    <p>We use a small amount of browser storage to keep you signed in and remember your settings. Read the <a href="#cookies">Cookie Policy</a> for the details.</p>

    <h2>11. Changes to this policy</h2>
    <p>We may update this policy from time to time. When we make an important change we will update the date at the top and, where appropriate, let you know in the app.</p>

    <h2>12. Contact us</h2>
    <p>Questions about this policy or your information? Email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>
  `,

  cookies: () => `
    <h1>Cookie Policy</h1>
    <p class="legal-meta">Last updated: ${POLICY_UPDATED}</p>
    <p>This policy explains how Murmur uses cookies and similar technologies, such as your browser's local storage, and what choices you have. It should be read together with our <a href="#privacy">Privacy Policy</a>.</p>

    <h2>1. What are cookies and similar technologies?</h2>
    <p>Cookies are small text files a website can save in your browser. Similar technologies, like local storage and IndexedDB, also let a website save small pieces of information on your device so it can remember you between visits.</p>

    <h2>2. What Murmur uses</h2>
    <p>Murmur only uses storage that is strictly necessary to run the service. That is why it does not ask you to switch anything on or off.</p>
    <div class="legal-table-wrap">
      <table class="legal-table">
        <thead><tr><th>Name</th><th>Type</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>
          <tr><td><code>murmur-state</code></td><td>Local storage</td><td>Keeps limited interface state and cached app data on this device; Firebase remains the shared source for account and social data.</td><td>Until cleared from your browser</td></tr>
          <tr><td><code>firebaseLocalStorageDb</code></td><td>IndexedDB (Firebase Authentication)</td><td>Keeps you signed in and keeps your login secure.</td><td>Until you log out or clear your browser data</td></tr>
          <tr><td><code>murmur-cookie-notice</code></td><td>Local storage</td><td>Remembers that you have seen the cookie notice so we do not show it every time.</td><td>Until you clear your browser data</td></tr>
        </tbody>
      </table>
    </div>

    <h2>3. What Murmur does not use</h2>
    <ul>
      <li>No advertising cookies.</li>
      <li>No cross-site tracking.</li>
      <li>No third-party analytics.</li>
    </ul>

    <h2>4. Third parties</h2>
    <p>Murmur uses Google Firebase to sign you in and store your profile. When your browser connects to Google services it may receive technical information such as your IP address. Google's own privacy policy explains how it handles that information.</p>

    <h2>5. Managing storage</h2>
    <p>You can delete or block cookies and site data in your browser settings. If you do, you will be logged out and Murmur may forget your settings. Blocking storage completely may stop you from logging in, because the service needs it to keep you signed in.</p>

    <h2>6. Changes</h2>
    <p>If we ever add cookies or tools that are not strictly necessary, we will update this policy and ask for your permission first where the law requires it.</p>

    <h2>7. Contact</h2>
    <p>Questions? Email <a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>.</p>

    <h2>Show the cookie notice again</h2>
    <button type="button" class="btn secondary" data-reset-cookie-notice>Show cookie notice again</button>
  `
};

let legalOverlay = null;
let legalDirect = false;

function closeLegal(fromHash) {
  if (!legalOverlay) return;
  legalOverlay.remove();
  legalOverlay = null;
  const stillLocked = registerOverlay || forgotOverlay;
  if (!stillLocked) document.body.style.overflow = '';
  if (fromHash) return;
  if (legalDirect) {
    history.replaceState(null, '', location.pathname + location.search);
    legalDirect = false;
  } else if (LEGAL_HASHES[location.hash]) {
    history.back();
  }
}

function openLegal(page, direct) {
  if (!LEGAL_PAGES[page]) return;
  if (!legalOverlay) {
    legalDirect = !!direct;
    const overlay = document.createElement('div');
    legalOverlay = overlay;
    document.body.style.overflow = 'hidden';
    overlay.className = 'screen-legal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Privacy and cookies');
    overlay.innerHTML = `
      <div class="legal-top">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
        <nav class="legal-tabs" role="tablist" aria-label="Legal pages">
          <button type="button" class="legal-tab" role="tab" data-legal-tab="terms">Terms</button>
          <button type="button" class="legal-tab" role="tab" data-legal-tab="privacy">Privacy Policy</button>
          <button type="button" class="legal-tab" role="tab" data-legal-tab="cookies">Cookie Policy</button>
        </nav>
        <button class="close-btn" type="button" aria-label="Close">×</button>
      </div>
      <div class="legal-body" data-legal-body><article class="legal-doc" data-legal-doc></article></div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-legal-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.legalTab;
        history.replaceState(null, '', '#' + target);
        renderLegal(target);
      });
    });
    overlay.querySelector('.close-btn').addEventListener('click', () => closeLegal(false));
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeLegal(false); });
    overlay.addEventListener('click', e => {
      if (e.target.closest('[data-reset-cookie-notice]')) {
        try { localStorage.removeItem(COOKIE_NOTICE_KEY); } catch {}
        showCookieNotice();
        showToast('Cookie notice will show again.');
      }
    });
    overlay.querySelector('.close-btn').focus();
  }
  renderLegal(page);
}

function renderLegal(page) {
  if (!legalOverlay || !LEGAL_PAGES[page]) return;
  legalOverlay.querySelectorAll('[data-legal-tab]').forEach(tab => {
    const on = tab.dataset.legalTab === page;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
  });
  legalOverlay.querySelector('[data-legal-doc]').innerHTML = LEGAL_PAGES[page]();
  legalOverlay.querySelector('[data-legal-body]').scrollTop = 0;
}

function showCookieNotice() {
  if (document.querySelector('.cookie-notice')) return;
  const box = document.createElement('div');
  box.className = 'cookie-notice';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Cookie notice');
  box.innerHTML = `
    <div>
      <strong>${ic('cookie')}We use cookies</strong>
      <p>Murmur only uses essential cookies and browser storage to keep you signed in and remember your settings. We don't use advertising or tracking cookies. See our <a href="#cookies">Cookie Policy</a> and <a href="#privacy">Privacy Policy</a>.</p>
    </div>
    <div class="cookie-actions">
      <button type="button" class="btn primary" data-cookie-ok>Got it</button>
      <button type="button" class="btn ghost" data-cookie-more>Learn more</button>
    </div>
  `;
  document.body.appendChild(box);
  box.querySelector('[data-cookie-ok]').addEventListener('click', () => {
    try { localStorage.setItem(COOKIE_NOTICE_KEY, 'seen'); } catch {}
    box.remove();
  });
  box.querySelector('[data-cookie-more]').addEventListener('click', () => {
    location.hash = '#cookies';
  });
}

function maybeShowCookieNotice() {
  let seen = false;
  try { seen = localStorage.getItem(COOKIE_NOTICE_KEY) === 'seen'; } catch {}
  if (!seen) showCookieNotice();
}

let profileOverlay = null;
function closeProfile(fromHash) {
  if (!profileOverlay) return;
  profileOverlay.remove(); profileOverlay = null;
  if (!fromHash && location.hash === '#profile') history.back();
}
let profileUid = null, profileTab = 'all', profileData = null;
const offlineBar = Object.assign(document.createElement('div'), { id: 'offlineBar', hidden: true, textContent: 'You are offline. Messages and posts will not send until you reconnect.' });
offlineBar.setAttribute('role', 'status');
document.body.appendChild(offlineBar);
const syncOnline = () => { offlineBar.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline); window.addEventListener('offline', syncOnline); syncOnline();

/* ---------- Stories (photos, 24 hours) ---------- */
let storySubs = {}, storiesData = {}, storyTimer = null;
const STORY_BGS = ['linear-gradient(160deg,#1877f2,#6a5cff)', 'linear-gradient(160deg,#f5576c,#f093fb)', 'linear-gradient(160deg,#11998e,#38ef7d)', 'linear-gradient(160deg,#f7971e,#ffd200)', 'linear-gradient(160deg,#232526,#414345)', 'linear-gradient(160deg,#ee0979,#ff6a00)'];
const STORY_MS = 864e5;   // a story lives 24 hours, then it is deleted
const dropStory = (uid, id) => { try { Promise.resolve(remove(ref(db, `stories/${uid}/${id}`))).catch(() => {}); } catch {} };
function pruneStories() {
  const cut = Date.now() - STORY_MS; let changed = false;
  Object.entries(storiesData).forEach(([uid, list]) => {
    const keep = list.filter(x => (x.createdAt || Date.now()) > cut);
    if (keep.length !== list.length) { list.filter(x => !keep.includes(x)).forEach(x => dropStory(uid, x.id)); storiesData[uid] = keep; changed = true; }
  });
  if (changed) renderStories();
}
setInterval(pruneStories, 60000);
const storyFile = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.appendChild(storyFile);
function watchStories(uid) {
  if (storySubs[uid]) return;
  storySubs[uid] = onValue(ref(db, 'stories/' + uid), snap => {
    const all = Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v })), cut = Date.now() - STORY_MS;
    all.filter(x => (x.createdAt || Date.now()) <= cut).forEach(x => dropStory(uid, x.id));
    storiesData[uid] = all.filter(x => (x.createdAt || Date.now()) > cut).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now()));
    renderStories();
  }, () => {});
}
function renderStories() {
  const row = document.getElementById('storiesRow'), me = meUid();
  if (!row) return;
  if (!me) { row.innerHTML = ''; return; }
  [me, ...friendsOf().map(d => d.uid)].forEach(watchStories);
  const card = (uid, name, label) => {
    const list = storiesData[uid] || []; if (!list.length) return '';
    const st = list[list.length - 1], pic = !!st.photo;
    const bg = pic ? (okImg(st.photo) ? `background-image:url('${st.photo}')` : '') : `background:${STORY_BGS[st.bg] || STORY_BGS[0]}`;
    if (!bg) return '';
    return `<button type="button" class="story${pic ? '' : ' txt'}" data-story-view="${esc(uid)}" style="${bg}"><span class="story-av">${avatarHtml(uid, name)}</span>${pic ? '' : `<em>${esc((st.text || '').slice(0, 60))}</em>`}<b>${esc(label)}</b></button>`;
  };
  row.innerHTML = '<button type="button" class="story add" data-story-add><span>＋</span><b>Add story</b></button>' + card(me, state.currentUser?.name || '', 'Your story') + friendsOf().map(d => card(d.uid, d.name, d.name.split(' ')[0])).join('');
}
function viewStory(uid) {
  const list = storiesData[uid] || []; if (!list.length) return;
  let i = 0;
  const el = document.createElement('div');
  el.className = 'story-view';
  document.body.appendChild(el);
  const close = () => { clearTimeout(storyTimer); el.remove(); };
  const show = () => {
    clearTimeout(storyTimer);
    if (i >= list.length) return close();
    const st = list[i], mine = uid === meUid(), name = mine ? 'Your story' : (friendsOf().find(d => d.uid === uid) || {}).name || '';
    if (!mine && meUid()) set(ref(db, `stories/${uid}/${st.id}/views/${meUid()}`), serverTimestamp()).catch(() => {});
    const viewerCount = Object.keys(st.views || {}).length;
    el.innerHTML = `<div class="story-bars">${list.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><div class="story-top"><strong>${esc(name)}</strong><span>${timeAgo(st.createdAt)}${mine ? ' · ' + Math.max(1, Math.ceil((st.createdAt + STORY_MS - Date.now()) / 36e5)) + 'h left' : ''}</span>${mine ? `<button type="button" data-story-viewers>Viewed by ${viewerCount}</button><button type="button" data-sdel>Delete</button>` : ''}<button type="button" data-sclose aria-label="Close">×</button></div>${st.photo ? `<img alt="" src="${okImg(st.photo) ? st.photo : ''}" />` : `<div class="story-text" style="background:${STORY_BGS[st.bg] || STORY_BGS[0]}"><p>${esc(st.text || '')}</p></div>`}${!mine ? '<div class="story-reactions" aria-label="Send a story reaction"><button type="button" data-story-emoji="❤️" aria-label="Send heart">❤️</button><button type="button" data-story-emoji="😂" aria-label="Send laughing face">😂</button><button type="button" data-story-emoji="😮" aria-label="Send surprised face">😮</button><button type="button" data-story-emoji="🔥" aria-label="Send fire">🔥</button><button type="button" data-story-emoji="👏" aria-label="Send clapping hands">👏</button></div>' : ''}<button class="story-prev" type="button" aria-label="Previous"></button><button class="story-next" type="button" aria-label="Next"></button>`;
    el.querySelector('[data-sclose]').onclick = close;
    const viewersBtn = el.querySelector('[data-story-viewers]');
    if (viewersBtn) viewersBtn.onclick = async () => {
      try {
        const snap = await get(ref(db, `stories/${uid}/${st.id}/views`));
        const viewers = Object.keys(snap.val() || {});
        if (!viewers.length) { showToast('No views yet.'); return; }
        const names = await Promise.all(viewers.map(async viewerUid => {
          if (viewerUid === meUid()) return state.currentUser?.name || 'You';
          const profile = await get(ref(db, 'profiles/' + viewerUid));
          return profile.val()?.name || 'Murmur member';
        }));
        const panel = document.createElement('div'); panel.className = 'modal-back top';
        panel.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Story viewers (${names.length})</h3><div class="saved-post-list">${names.map(n => `<p>${esc(n)}</p>`).join('')}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
        document.body.appendChild(panel); panel.querySelector('[data-close]').onclick = () => panel.remove();
      } catch (error) { showToast(friendlyError(error, 'Could not load viewers.')); }
    };
    el.querySelectorAll('[data-story-emoji]').forEach(button => {
      button.onclick = async event => {
        event.preventDefault(); event.stopPropagation();
        const reactorUid = meUid(), emoji = button.dataset.storyEmoji;
        if (!reactorUid || !uid || !st.id || reactorUid === uid) return;
        button.disabled = true;
        try {
          const fromName = state.currentUser?.name || 'A friend';
          await set(ref(db, `notifications/${uid}/story_${st.id}_${reactorUid}`), {
            type: 'story_reaction', storyId: st.id, from: reactorUid, fromName,
            emoji, text: `${fromName} reacted ${emoji} to your story`,
            createdAt: serverTimestamp(), read: false
          });
          showToast(`Sent ${emoji} to ${name}'s story.`);
        } catch (error) {
          showToast(friendlyError(error, 'Could not send your reaction.'));
          button.disabled = false;
        }
      };
    });
    el.querySelector('.story-next').onclick = () => { i++; show(); };
    el.querySelector('.story-prev').onclick = () => { i = Math.max(0, i - 1); show(); };
    const del = el.querySelector('[data-sdel]');
    if (del) del.onclick = async () => { try { await remove(ref(db, `stories/${uid}/${st.id}`)); showToast('Story deleted.'); } catch (e) { showToast(friendlyError(e, 'Could not delete.')); } close(); };
    storyTimer = setTimeout(() => { i++; show(); }, 5000);
  };
  show();
}
let storyOverlay = null;
function closeStoryMaker(fromHash) {
  if (!storyOverlay) return;
  storyOverlay.remove(); storyOverlay = null;
  if (!fromHash && location.hash === '#new-story') history.back();
}
function openCreateStory() {
  if (storyOverlay || !meUid()) return;
  if (location.hash !== '#new-story') history.pushState(null, '', '#new-story');
  let bg = 0;
  const el = document.createElement('div');
  storyOverlay = el;
  el.className = 'cs-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Create story');
  el.style.background = STORY_BGS[0];
  el.innerHTML = `
    <div class="cs-top"><button type="button" class="cs-x" data-cs-close aria-label="Close">×</button><strong>Create story</strong><button type="button" class="cs-share" data-cs-share disabled>Share</button></div>
    <div class="cs-mid"><textarea class="cs-text" maxlength="120" placeholder="Start typing" aria-label="Story text"></textarea></div>
    <div class="cs-bottom">
      <div class="cs-swatches">${STORY_BGS.map((g, i) => `<button type="button" class="cs-sw${i === 0 ? ' on' : ''}" data-cs-bg="${i}" style="background:${g}" aria-label="Background ${i + 1}"></button>`).join('')}</div>
      <button type="button" class="cs-photo" data-cs-photo>${ic('image')}Add a photo instead</button>
      <p class="cs-note">Your story disappears after 24 hours.</p>
    </div>`;
  document.body.appendChild(el);
  const ta = el.querySelector('.cs-text'), share = el.querySelector('[data-cs-share]');
  ta.addEventListener('input', () => { share.disabled = !ta.value.trim(); });
  el.addEventListener('click', e => {
    const sw = e.target.closest('[data-cs-bg]');
    if (sw) { bg = +sw.dataset.csBg; el.style.background = STORY_BGS[bg]; el.querySelectorAll('.cs-sw').forEach(b => b.classList.toggle('on', b === sw)); }
  });
  el.querySelector('[data-cs-close]').onclick = () => closeStoryMaker(false);
  el.querySelector('[data-cs-photo]').onclick = () => { closeStoryMaker(false); storyFile.click(); };
  el.addEventListener('keydown', e => { if (e.key === 'Escape') closeStoryMaker(false); });
  share.onclick = async () => {
    const text = cleanText(ta.value, 120); if (!text) return;
    share.disabled = true;
    try {
      await push(ref(db, 'stories/' + meUid()), { text, bg, createdAt: serverTimestamp() });
      showToast('Story added. It disappears after 24 hours.');
      closeStoryMaker(false);
    } catch (err) { showToast(friendlyError(err, 'Could not add your story.')); share.disabled = false; }
  };
  setTimeout(() => ta.focus(), 60);
}
storyFile.addEventListener('change', async () => {
  const f = storyFile.files[0]; storyFile.value = ''; if (!f || !meUid()) return;
  showToast('Uploading your story…');
  try {
    const photo = await fileToDataUrl(f, 360, 640);
    await push(ref(db, 'stories/' + meUid()), { photo, createdAt: serverTimestamp() });
    showToast('Story added. Friends can see it for 24 hours.');
  } catch (e) { showToast(friendlyError(e, 'Could not add your story.')); }
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-story-add]')) { openCreateStory(); return; }
  const v = e.target.closest('[data-story-view]'); if (v) viewStory(v.dataset.storyView);
});
const timeAgo = t => { if (!t || typeof t !== 'number') return ''; const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd'; };

/* ---------- Comments ---------- */
const openComments = new Set(), commentSubs = {}, commentData = {}, commentDraft = {};
function toggleComments(id) {
  if (openComments.has(id)) { openComments.delete(id); if (commentSubs[id]) { commentSubs[id](); delete commentSubs[id]; } }
  else {
    openComments.add(id);
    if (!commentSubs[id]) commentSubs[id] = onValue(query(ref(db, 'comments/' + id), orderByChild('createdAt'), limitToLast(50)), snap => {
      commentData[id] = Object.entries(snap.val() || {}).map(([cid, c]) => ({ cid, ...c })).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now()));
      commentData[id].forEach(c => watchPhoto(c.uid));
      const card = document.querySelector(`[data-pid="${CSS.escape(id)}"]`);
      if (card) attachComments(card, id);
    }, () => {});
  }
  renderPosts();
}
function attachComments(card, id) {
  card.querySelector('.comments')?.remove();
  if (!openComments.has(id)) return;
  const box = document.createElement('div');
  box.className = 'comments';
  const list = commentData[id] || [];
  box.innerHTML = (list.map(c => `<div class="comment">${avatarHtml(c.uid, c.name)}<div><button type="button" class="person-link" data-profile="${esc(c.uid)}"><b>${esc(c.name)}</b></button> ${esc(c.text)} <small>${timeAgo(c.createdAt)}</small></div></div>`).join('') || '<small>No comments yet.</small>') +
    '<div class="comment-form"><input type="text" maxlength="300" placeholder="Write a comment…" data-cinput /><button class="btn small primary" type="button" data-csend>Send</button></div>';
  const inp = box.querySelector('[data-cinput]');
  inp.value = commentDraft[id] || '';
  inp.addEventListener('input', () => { commentDraft[id] = inp.value; });
  const send = async () => {
    const text = inp.value.trim(); if (!text) return;
    const u = auth.currentUser; if (!u) return;
    try { await push(ref(db, 'comments/' + id), { uid: u.uid, name: state.currentUser?.name || 'Someone', text, createdAt: serverTimestamp() }); commentDraft[id] = ''; inp.value = ''; }
    catch (e) { showToast(friendlyError(e, 'Could not comment.')); }
  };
  box.querySelector('[data-csend]').onclick = send;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  card.appendChild(box);
}
document.addEventListener('click', e => { const c = e.target.closest('[data-comment]'); if (c) toggleComments(c.dataset.comment); });

/* =====================================================================
   CREATE POST  -  full-screen page opened from "What's on your mind?" and the + button
   Posts are visible to every Murmur user, so the pill says "Everyone".
   Photos, music, tags and the other rows are not built yet: they show a toast.
   ===================================================================== */
let postAudience = { mode: 'public', uids: [] };
function audMeta(m) { return m === 'friends' ? ['friends', 'Friends'] : m === 'specific' ? ['lock', 'Specific friends'] : ['globe', 'Public']; }
function canSeePost(p) {
  const me = meUid(); if (!me || p.authorUid === me) return true;
  const m = p.audience || 'public';
  if (m === 'friends') return friendsOf().some(d => d.uid === p.authorUid);
  if (m === 'specific') return !!(p.allowed && p.allowed[me]);
  return true;
}
function postAudienceFields() { const a = postAudience; return a.mode === 'specific' ? { audience: 'specific', allowed: Object.fromEntries(a.uids.map(u => [u, true])) } : { audience: a.mode }; }
/* =====================================================================
   CREATE POST  -  full-screen page. A post = text + who can see it + optional extras:
   photo, music, tagged friends, place, feeling/activity, event.
   Video and camera go to Reels (they need an upload, not a text post).
   Saved on the post: photo, music{song,artist}, tags{uid:name}, place, feeling{type,text}, event{title,when,place}.
   ===================================================================== */
let postOverlay = null, postExtras = {};
const FEELINGS = ['happy', 'excited', 'grateful', 'loved', 'blessed', 'relaxed', 'proud', 'tired', 'sad', 'angry'];
const ACTIVITIES = ['eating', 'watching a movie', 'listening to music', 'traveling', 'celebrating', 'working out', 'studying', 'playing games'];
const EXTRA_ROWS = [['photo', 'image', '#45bd62', 'Photo'], ['video', 'video', '#c0182b', 'Video (shared as a Reel)'], ['music', 'music', '#f35fb0', 'Music'],
  ['tags', 'tag', '#1877f2', 'Tag people'], ['place', 'pin', '#e41e3f', 'Add location'], ['feeling', 'smile', '#c99a06', 'Feeling/activity'],
  ['event', 'calendar', '#f3503f', 'Create event'], ['camera', 'camera', '#8a5cf6', 'Record video']];
const fmtEventWhen = ms => new Date(ms).toLocaleString('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function postExtraFields() {
  const x = postExtras, out = {};
  ['photo', 'music', 'place', 'feeling', 'event'].forEach(k => { if (x[k]) out[k] = x[k]; });
  if (x.tags && Object.keys(x.tags).length) out.tags = x.tags;
  return out;
}
function closePost(fromHash) {
  if (!postOverlay) return;
  postOverlay.remove(); postOverlay = null;
  if (!fromHash && location.hash === '#new-post') history.back();
}
function openCreatePost() {
  if (postOverlay || !state.loggedIn) return;
  if (location.hash !== '#new-post') history.pushState(null, '', '#new-post');
  postExtras = {};
  const uid = meUid(), name = getCurrentUserName(), max = CONFIG.maxLength.post;
  const el = postOverlay = document.createElement('div');
  el.className = 'screen-legal np-screen';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Create post');
  el.innerHTML = `
    <div class="np-top">
      <button class="chat-back" type="button" data-np-close aria-label="Back" style="display:grid;place-items:center">←</button>
      <strong>Create post</strong>
      <button class="np-link" type="button" data-np-post disabled>POST</button>
    </div>
    <div class="np-body">
      <div class="np-who">${avatarHtml(uid, name)}<div><b>${esc(name)}</b><button type="button" class="np-aud" data-np-aud></button></div></div>
      <textarea class="np-text" maxlength="${max}" placeholder="What’s on your mind?" aria-label="Post text"></textarea>
      <div class="np-count"><span data-np-n>0</span>/${max}</div>
      <div class="np-chips"></div>
      <div class="np-opts">${EXTRA_ROWS.map(o => `<button type="button" class="np-opt" data-np-row="${o[0]}">${ic(o[1], o[2])}${o[3]}</button>`).join('')}</div>
      <button class="btn primary np-submit" type="button" data-np-post disabled>POST</button>
    </div>
    <div class="np-sheet" hidden><div class="np-sheet-card"><div class="np-sheet-head"><strong></strong><button type="button" class="np-link" data-np-done>Done</button></div><div class="np-sheet-body"></div></div></div>
    <input type="file" hidden data-np-file />`;
  document.body.appendChild(el);
  const q = s => el.querySelector(s), ta = q('.np-text'), chips = q('.np-chips'), btns = [...el.querySelectorAll('[data-np-post]')];
  const sheet = q('.np-sheet'), sheetBody = q('.np-sheet-body'), fileIn = q('[data-np-file]'), audBtn = q('[data-np-aud]');

  /* --- the little summary chips under the text box --- */
  const chip = (key, icon, color, text) => `<span class="np-chip">${ic(icon, color)}<span>${esc(text)}</span><button type="button" data-np-x="${key}" aria-label="Remove">×</button></span>`;
  const paintChips = () => {
    const x = postExtras, c = [];
    if (x.photo) c.push(`<div class="np-photo"><img src="${x.photo}" alt="Your photo" /><button type="button" data-np-x="photo" aria-label="Remove photo">×</button></div>`);
    if (x.music) c.push(chip('music', 'music', '#f35fb0', x.music.song + (x.music.artist ? ' – ' + x.music.artist : '')));
    if (x.tags && Object.keys(x.tags).length) c.push(chip('tags', 'tag', '#1877f2', 'With ' + Object.values(x.tags).join(', ')));
    if (x.place) c.push(chip('place', 'pin', '#e41e3f', x.place));
    if (x.feeling) c.push(chip('feeling', 'smile', '#c99a06', (x.feeling.type === 'feeling' ? 'Feeling ' : '') + x.feeling.text));
    if (x.event) c.push(chip('event', 'calendar', '#f3503f', x.event.title + ' · ' + fmtEventWhen(x.event.when)));
    chips.innerHTML = c.join('');
  };
  const sync = () => {
    el.querySelector('[data-np-n]').textContent = ta.value.length;
    const has = ta.value.trim() || Object.keys(postExtraFields()).length;
    btns.forEach(b => { b.disabled = !has; });
  };
  const refresh = () => { paintAud(); paintChips(); sync(); };

  /* --- one sheet reused for every extra --- */
  let onDone = null;
  const showSheet = (title, html, done) => { sheet.querySelector('.np-sheet-head strong').textContent = title; sheetBody.innerHTML = html; onDone = done || null; sheet.hidden = false; };
  const hideSheet = () => { sheet.hidden = true; if (onDone) onDone(); onDone = null; refresh(); };
  const input = (k, ph, v, type = 'text') => `<input class="np-in" data-f="${k}" type="${type}" maxlength="60" placeholder="${ph}" value="${esc(v || '')}" />`;
  const val = k => cleanText((sheetBody.querySelector(`[data-f="${k}"]`) || {}).value || '', 60);
  const SHEETS = {
    audience() {
      const desc = { public: 'Anyone on Murmur', friends: 'Only your friends', specific: 'Only the friends you choose' }, m = postAudience.mode, fr = friendsOf();
      showSheet('Who can see your post?', ['public', 'friends', 'specific'].map(k => `<button type="button" class="np-choice${m === k ? ' on' : ''}" data-aud="${k}">${ic(audMeta(k)[0])}<span><b>${audMeta(k)[1]}</b><small>${desc[k]}</small></span></button>`).join('')
        + (m === 'specific' ? `<div class="np-friends">${fr.length ? fr.map(d => `<label class="np-friend"><input type="checkbox" data-aud-uid="${esc(d.uid)}" ${postAudience.uids.includes(d.uid) ? 'checked' : ''} />${avatarHtml(d.uid, d.name)}<span>${esc(d.name)}</span></label>`).join('') : '<p class="note-hint">You have no friends to choose yet.</p>'}</div>` : ''));
    },
    music() {
      const m = postExtras.music || {};
      showSheet('Add music', input('song', 'Song name', m.song) + input('artist', 'Artist (optional)', m.artist) + '<p class="note-hint">The song name shows on your post. Songs are not played.</p>',
        () => { const song = val('song'); if (song) postExtras.music = { song, artist: val('artist') }; else delete postExtras.music; });
    },
    place() {
      showSheet('Add location', input('place', 'Where are you?', postExtras.place), () => { const p = val('place'); if (p) postExtras.place = p; else delete postExtras.place; });
    },
    tags() {
      const fr = friendsOf(), t = postExtras.tags || {};
      showSheet('Tag people', fr.length ? `<div class="np-friends">${fr.map(d => `<label class="np-friend"><input type="checkbox" data-tag-uid="${esc(d.uid)}" data-tag-name="${esc(d.name)}" ${t[d.uid] ? 'checked' : ''} />${avatarHtml(d.uid, d.name)}<span>${esc(d.name)}</span></label>`).join('')}</div>` : '<p class="note-hint">Add friends first, then you can tag them.</p>');
    },
    feeling() {
      const f = postExtras.feeling, pill = (type, text) => `<button type="button" class="np-pill${f && f.type === type && f.text === text ? ' on' : ''}" data-feel="${type}:${text}">${text}</button>`;
      showSheet('How are you feeling?', `<b>Feeling</b><div class="np-grid">${FEELINGS.map(t => pill('feeling', t)).join('')}</div><b>Doing</b><div class="np-grid">${ACTIVITIES.map(t => pill('activity', t)).join('')}</div>`);
    },
    event() {
      const e = postExtras.event || {}, d = e.when ? new Date(e.when) : null, pad = n => String(n).padStart(2, '0');
      showSheet('Create event', input('title', 'Event name', e.title) + input('date', '', d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '', 'date') + input('time', '', d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '', 'time') + input('where', 'Place (optional)', e.place),
        () => {
          const title = val('title'), date = val('date');
          if (title && date) postExtras.event = { title, when: new Date(date + 'T' + (val('time') || '12:00')).getTime(), place: val('where') };
          else { delete postExtras.event; if (title || date) showToast('An event needs a name and a date.'); }
        });
    }
  };
  const paintAud = () => { const a = postAudience, n = a.uids.length; audBtn.innerHTML = ic(audMeta(a.mode)[0]) + (a.mode === 'specific' ? 'Specific friends' + (n ? ' (' + n + ')' : '') : audMeta(a.mode)[1]) + ic('chev'); };

  /* --- photo / video / camera: pick a file --- */
  const pickFile = (mode, accept, capture) => { fileIn.dataset.mode = mode; fileIn.accept = accept; if (capture) fileIn.setAttribute('capture', capture); else fileIn.removeAttribute('capture'); fileIn.value = ''; fileIn.click(); };
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0], mode = fileIn.dataset.mode; if (!f) return;
    if (mode !== 'photo') { closePost(false); openReelCreate(f); return; }          // videos become Reels
    if (!/^image\//.test(f.type)) { showToast('Please choose a photo.'); return; }
    try {
      let url = await fileToFitDataUrl(f, 1000, 0.72);
      if (url.length > 380000) url = await fileToFitDataUrl(f, 760, 0.6);
      if (url.length > 380000) { showToast('That photo is too big. Try a smaller one.'); return; }
      postExtras.photo = url; refresh();
    } catch (err) { showToast(err.message || 'Could not read that photo.'); }
  });

  /* --- wiring --- */
  ta.addEventListener('input', sync);
  q('[data-np-close]').onclick = () => closePost(false);
  audBtn.onclick = () => SHEETS.audience();
  q('.np-opts').addEventListener('click', e => {
    const k = e.target.closest('[data-np-row]')?.dataset.npRow; if (!k) return;
    if (k === 'photo') pickFile('photo', 'image/*');
    else if (k === 'video') pickFile('video', 'video/*');
    else if (k === 'camera') pickFile('camera', 'video/*', 'environment');
    else SHEETS[k]();
  });
  chips.addEventListener('click', e => { const k = e.target.closest('[data-np-x]')?.dataset.npX; if (k) { delete postExtras[k]; refresh(); } });
  q('[data-np-done]').onclick = hideSheet;
  sheet.addEventListener('click', e => {
    if (e.target === sheet) return hideSheet();
    const aud = e.target.closest('[data-aud]'); if (aud) { postAudience.mode = aud.dataset.aud; SHEETS.audience(); }
    const feel = e.target.closest('[data-feel]');
    if (feel) { const [type, ...text] = feel.dataset.feel.split(':'); postExtras.feeling = { type, text: text.join(':') }; SHEETS.feeling(); }
  });
  sheet.addEventListener('change', e => {
    const d = e.target.dataset || {};
    if (d.audUid) postAudience.uids = e.target.checked ? [...new Set([...postAudience.uids, d.audUid])] : postAudience.uids.filter(x => x !== d.audUid);
    if (d.tagUid) { postExtras.tags = postExtras.tags || {}; if (e.target.checked) postExtras.tags[d.tagUid] = d.tagName; else delete postExtras.tags[d.tagUid]; }
    paintAud();
  });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!sheet.hidden) hideSheet(); else closePost(false); } });
  btns.forEach(b => { b.onclick = async () => {
    const box = document.getElementById('postInput');
    box.value = ta.value; btns.forEach(x => { x.disabled = true; });
    const ok = await createPost();
    if (!postOverlay) return;
    if (ok) closePost(false); else sync();
  }; });
  refresh();
  setTimeout(() => ta.focus({ preventScroll: true }), 60);
}
document.getElementById('postInput').addEventListener('click', openCreatePost);

/* =====================================================================
   NOTES  -  a short line (60 characters) on top of your chats. Every friend sees it in
   their chat list and at the top of your conversation. Saved at notes/<your id>.
   ===================================================================== */
function watchNote(uid) {
  if (noteSubs[uid]) return;
  noteSubs[uid] = onValue(ref(db, 'notes/' + uid), snap => {
    const v = snap.val(); noteData[uid] = v && typeof v.text === 'string' && v.text ? v : null;
    renderNoteRow(); renderProfileNote(); if (activeChatUid === uid) renderConversation();
  }, () => {});
}
function renderNoteRow() {
  const row = document.getElementById('noteRow'), me = meUid();
  if (!row) return;
  if (!me) { row.innerHTML = ''; return; }
  const fr = chatFriends().map(otherOf);
  [me, ...fr.map(o => o.uid)].forEach(watchNote);
  const mine = noteData[me];
  row.innerHTML = `<button type="button" class="note-tile" data-note-edit><span class="note-bubble${mine ? '' : ' empty'}">${mine ? esc(mine.text) : 'Add note'}</span>${avatarHtml(me, state.currentUser?.name || '')}<small>Your note</small></button>`
    + fr.filter(o => noteData[o.uid]).map(o => `<button type="button" class="note-tile" data-msg="${esc(o.uid)}"><span class="note-bubble">${esc(noteData[o.uid].text)}</span>${avatarHtml(o.uid, o.name)}<small>${esc(o.name.split(' ')[0])}</small></button>`).join('');
}
function openNoteSheet() {
  const me = meUid(); if (!me || document.querySelector('.note-sheet')) return;
  const cur = noteData[me], max = 60;
  const el = document.createElement('div');
  el.className = 'np-sheet note-sheet'; el.style.cssText = 'position:fixed;z-index:300';
  el.innerHTML = `<div class="np-sheet-card"><div class="np-sheet-head"><strong>Your note</strong><button type="button" class="btn small ghost" data-nclose>Close</button></div>
    <textarea class="note-input" maxlength="${max}" placeholder="Share what’s on your mind…" aria-label="Your note"></textarea>
    <div class="np-count"><span data-nn>0</span>/${max}</div>
    <p class="note-hint">Everyone you chat with can see your note.</p>
    <div class="note-actions">${cur ? '<button type="button" class="btn ghost" data-ndel>Delete note</button>' : ''}<button type="button" class="btn primary" data-nsave disabled>Share note</button></div></div>`;
  document.body.appendChild(el);
  const ta = el.querySelector('.note-input'), save = el.querySelector('[data-nsave]'), close = () => el.remove();
  ta.value = cur ? cur.text : '';
  const sync = () => { el.querySelector('[data-nn]').textContent = ta.value.length; save.disabled = !ta.value.trim(); };
  sync(); ta.addEventListener('input', sync);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-nclose]')) close(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  save.onclick = async () => {
    const text = cleanText(ta.value, max); if (!text) return;
    save.disabled = true;
    try {
      await set(ref(db, 'notes/' + me), { text, createdAt: serverTimestamp() });
      showToast('Note shared with your friends.'); close(); renderNoteRow(); renderProfileNote();
    } catch (err) { showToast(friendlyError(err, 'Could not share your note.')); save.disabled = false; }
  };
  const del = el.querySelector('[data-ndel]');
  if (del) del.onclick = async () => {
    try { await remove(ref(db, 'notes/' + me)); noteData[me] = null; showToast('Note deleted.'); close(); renderNoteRow(); renderProfileNote(); }
    catch (err) { showToast(friendlyError(err, 'Could not delete your note.')); }
  };
  setTimeout(() => ta.focus(), 60);
}
document.addEventListener('click', e => { if (e.target.closest('[data-note-edit]')) openNoteSheet(); });

/* =====================================================================
   SESSION  -  everything that starts when someone logs in and stops when they log out
   ===================================================================== */
function startSession(user) {
  startPostsListener(); startFriendsListener(user.uid); startExtras(user.uid); startReelsListener(user.uid);
  ensureProfile(user);
}
function endSession() {
  hideAppSkeleton();
  stopPostsListener(); stopFriendsListener(); stopExtras(); stopReelsListener();
}

/* =====================================================================
   SKELETON SCREENS  -  grey shimmering shapes shown while data loads, so the screen never looks empty
   skelRows(3) = list rows, skelReel() = a full reel. Used by Reels and the comments sheet.
   ===================================================================== */
const skelRows = n => Array.from({ length: n }, () => '<div class="skel-row"><i class="skel round"></i><div><i class="skel line"></i><i class="skel line short"></i></div></div>').join('');
const skelReel = () => '<div class="reel skel-reel" aria-hidden="true"><div class="skel-phone"><i class="skel round"></i><i class="skel line"></i><i class="skel block"></i><i class="skel line short"></i></div></div>';

/* =====================================================================
   REELS  -  short videos: full-screen feed, like / comment / share / save, create from a video file or link.
   Data:  reels/<id> { authorUid, authorName, username, url, path, caption, duration, createdAt, likes/<uid>, commentCount }
          saved/<uid>/<reelId> = true      comments/<reelId>/<commentId>
   Files go to Firebase Storage at reels/<uid>/<file> (rules in storage.rules).
   ===================================================================== */
let reels = [], reelsLoaded = false, unsubReels = null, unsubSaved = null, savedReels = {}, reelMuted = true, reelObs = null, reelDelArm = '';
const reelTime = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function startReelsListener(uid) {
  if (unsubReels) return;
  reelsLoaded = false;
  const done = () => { reelsLoaded = true; renderReels(); };
  unsubReels = onValue(query(ref(db, 'reels'), orderByChild('createdAt'), limitToLast(30)), s => {
    reels = Object.entries(s.val() || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    done();
  }, done);
  unsubSaved = onValue(ref(db, 'saved/' + uid), s => { savedReels = s.val() || {}; renderReels(); }, () => {});
}
function stopReelsListener() {
  [unsubReels, unsubSaved].forEach(u => u && u());
  unsubReels = unsubSaved = null; reels = []; savedReels = {}; reelsLoaded = false; pauseReels();
}
function pauseReels() { document.querySelectorAll('#reelsFeed video').forEach(v => v.pause()); }

function reelHtml(r) {
  const me = meUid(), likes = r.likes || {}, own = r.authorUid === me;
  const follow = !own && !friendDocs.some(d => d.uid === r.authorUid) ? `<button type="button" class="reel-follow" data-rfollow>Add friend</button>` : '';
  const capText = [r.caption || '', r.hashtags || ''].filter(Boolean).join(' ');
  const cap = (r.title || capText) ? `<div class="reel-caption-block">${r.title ? `<strong class="reel-title">${esc(r.title)}</strong>` : ''}${capText ? `<p class="reel-cap" data-rcap>${esc(capText)}</p>${capText.length > 60 ? '<button type="button" class="reel-more" data-rmore>more</button>' : ''}` : ''}</div>` : '';
  return `<article class="reel paused" data-rid="${esc(r.id)}">
    <video src="${esc(r.url)}" playsinline loop ${reelMuted ? 'muted' : ''} preload="metadata"></video>
    <button type="button" class="reel-tap" data-rtap aria-label="Play or pause"><span class="reel-play">${ic('play')}</span></button>
    <div class="reel-side">
      <button type="button" data-rlike class="${likes[me] ? 'on' : ''}" aria-label="Like">${ic('heart')}<span data-rn>${Object.keys(likes).length}</span></button>
      <button type="button" data-rcomment aria-label="Comments">${ic('comment')}<span data-rc>${r.commentCount || 0}</span></button>
      <button type="button" data-rshare aria-label="Share">${ic('share')}<span>Share</span></button>
      <button type="button" data-rsave class="${savedReels[r.id] ? 'on' : ''}" aria-label="Save">${ic('bookmark')}<span>${savedReels[r.id] ? 'Saved' : 'Save'}</span></button>
    </div>
    <div class="reel-info"><div class="reel-who">${avatarHtml(r.authorUid, r.authorName)}<b>${esc(r.authorName || 'Someone')}</b>${follow}</div>${cap}</div>
    <div class="reel-bottom"><span data-rtime>0:00</span><div class="reel-bar" data-rseek><i data-rbar></i></div>
      <button type="button" data-rmute aria-label="Sound">${ic(reelMuted ? 'mute' : 'volume')}</button>${own ? `<button type="button" data-rdel aria-label="Delete reel">${ic('trash')}</button>` : ''}</div>
  </article>`;
}
function updateReel(r) {
  const el = document.querySelector(`.reel[data-rid="${CSS.escape(r.id)}"]`); if (!el) return;
  const likes = r.likes || {}, sv = el.querySelector('[data-rsave]');
  el.querySelector('[data-rlike]').classList.toggle('on', !!likes[meUid()]);
  el.querySelector('[data-rn]').textContent = Object.keys(likes).length;
  el.querySelector('[data-rc]').textContent = r.commentCount || 0;
  sv.classList.toggle('on', !!savedReels[r.id]); sv.querySelector('span').textContent = savedReels[r.id] ? 'Saved' : 'Save';
}
function watchReels() {
  const feed = document.getElementById('reelsFeed');
  if (reelObs) reelObs.disconnect();
  reelObs = new IntersectionObserver(entries => entries.forEach(e => {
    const v = e.target.querySelector('video');
    if (e.isIntersecting && e.intersectionRatio > 0.6) { v.muted = reelMuted; v.play().catch(() => {}); } else v.pause();
  }), { root: feed, threshold: [0, 0.6, 1] });
  feed.querySelectorAll('.reel').forEach(el => {
    const v = el.querySelector('video'), time = el.querySelector('[data-rtime]'), bar = el.querySelector('[data-rbar]');
    reelObs.observe(el);
    v.addEventListener('timeupdate', () => { bar.style.width = (v.duration ? v.currentTime / v.duration * 100 : 0) + '%'; time.textContent = reelTime(v.currentTime) + ' / ' + reelTime(v.duration); });
    v.addEventListener('loadedmetadata', () => { time.textContent = '0:00 / ' + reelTime(v.duration); });
    v.addEventListener('play', () => el.classList.remove('paused'));
    v.addEventListener('pause', () => el.classList.add('paused'));
  });
}
function renderReels() {
  if (state.activeView !== 'reels') return;
  const feed = document.getElementById('reelsFeed'), head = document.querySelector('.fb-head');
  if (!feed) return;
  if (head) document.querySelector('.reels-pane').style.setProperty('--reels-top', Math.round(head.getBoundingClientRect().bottom) + 'px');
  if (!reelsLoaded) { if (feed.dataset.sig !== 'skel') { feed.innerHTML = skelReel(); feed.dataset.sig = 'skel'; } return; }
  const visibleReels = reels.filter(r => { const me=meUid(); if(r.authorUid===me||!r.audience||r.audience==='public')return true; if(r.audience==='private')return false; if(r.audience==='friends')return friendsOf().some(d=>d.uid===r.authorUid); return true; });
  if (!visibleReels.length) { feed.innerHTML = '<div class="reel-empty"><strong>No reels yet</strong><span>Be the first to share a short video.</span><button class="btn primary" type="button" data-rcreate>Create reel</button></div>'; feed.dataset.sig = 'empty'; return; }
  const sig = visibleReels.map(r => r.id).join();
  if (feed.dataset.sig !== sig) { feed.innerHTML = visibleReels.map(reelHtml).join(''); feed.dataset.sig = sig; watchReels(); }
  else visibleReels.forEach(updateReel);
}

async function shareReel(r) {
  const data = { title: 'Murmur reel', text: r.caption || 'Watch this reel on Murmur', url: location.href.split('#')[0] };
  try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); showToast('Link copied.'); } } catch {}
}
async function deleteReel(r) {
  try {
    await remove(ref(db, 'reels/' + r.id));
    if (r.path) { try { await deleteObject(storageRef(getStorage(app), r.path)); } catch {} }
    showToast('Reel deleted.');
  } catch (err) { showToast(friendlyError(err, 'Could not delete the reel.')); }
}
document.getElementById('reelsFeed').addEventListener('click', e => {
  const t = e.target, el = t.closest('.reel'), r = el && reels.find(x => x.id === el.dataset.rid), me = meUid();
  if (t.closest('[data-rcreate]')) return openReelCreate(null, true);
  if (!el || !r) return;
  const v = el.querySelector('video');
  if (t.closest('[data-rtap]')) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
  else if (t.closest('[data-rlike]')) { const rf = ref(db, 'reels/' + r.id + '/likes/' + me); ((r.likes || {})[me] ? remove(rf) : set(rf, true)).catch(err => showToast(friendlyError(err, 'Could not like this reel.'))); }
  else if (t.closest('[data-rsave]')) { const rf = ref(db, 'saved/' + me + '/' + r.id), was = savedReels[r.id]; (was ? remove(rf) : set(rf, true)).catch(() => {}); showToast(was ? 'Removed from saved.' : 'Saved.'); }
  else if (t.closest('[data-rshare]')) shareReel(r);
  else if (t.closest('[data-rcomment]')) openReelComments(r);
  else if (t.closest('[data-rmute]')) {
    reelMuted = !reelMuted;
    document.querySelectorAll('#reelsFeed video').forEach(x => { x.muted = reelMuted; });
    document.querySelectorAll('[data-rmute]').forEach(b => { b.innerHTML = ic(reelMuted ? 'mute' : 'volume'); });
  }
  else if (t.closest('[data-rfollow]')) { sendFriendRequest({ uid: r.authorUid, name: r.authorName, username: r.username || '' }); t.closest('[data-rfollow]').remove(); }
  else if (t.closest('[data-rmore]') || t.closest('[data-rcap]')) {
    const cap = el.querySelector('[data-rcap]'), more = el.querySelector('[data-rmore]');
    cap.classList.toggle('open'); if (more) more.hidden = cap.classList.contains('open');
  }
  else if (t.closest('[data-rseek]')) { const b = t.closest('[data-rseek]').getBoundingClientRect(); if (v.duration) v.currentTime = (e.clientX - b.left) / b.width * v.duration; }
  else if (t.closest('[data-rdel]')) {
    if (reelDelArm !== r.id) { reelDelArm = r.id; showToast('Tap delete again to remove this reel.'); setTimeout(() => { reelDelArm = ''; }, 3500); }
    else { reelDelArm = ''; deleteReel(r); }
  }
});
document.getElementById('reelCreateBtn').addEventListener('click', () => openReelCreate(null, true));

async function openReelComments(r) {
  if (document.querySelector('.reel-sheet')) return;
  const el = document.createElement('div');
  el.className = 'np-sheet reel-sheet'; el.style.cssText = 'position:fixed;z-index:300';
  el.innerHTML = `<div class="np-sheet-card"><div class="np-sheet-head"><strong>Comments</strong><button type="button" class="btn small ghost" data-cclose>Close</button></div>
    <div class="reel-comments">${skelRows(3)}</div>
    <div class="reel-cform"><input maxlength="200" placeholder="Add a comment" aria-label="Add a comment" /><button type="button" class="btn primary small" data-csend>Send</button></div></div>`;
  document.body.appendChild(el);
  const list = el.querySelector('.reel-comments'), input = el.querySelector('input');
  const load = async () => {
    try {
      const rows = Object.values((await get(ref(db, 'comments/' + r.id))).val() || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      list.innerHTML = rows.length ? rows.map(c => `<div class="reel-comment"><b>${esc(c.name || 'Someone')}</b><span>${esc(c.text)}</span></div>`).join('') : '<p class="reel-muted">No comments yet. Say something first.</p>';
      return rows.length;
    } catch { list.innerHTML = '<p class="reel-muted">Could not load comments.</p>'; return 0; }
  };
  load();
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-cclose]')) el.remove(); });
  el.querySelector('[data-csend]').onclick = async () => {
    const text = cleanText(input.value, 200); if (!text) return; input.value = '';
    try {
      await push(ref(db, 'comments/' + r.id), { uid: meUid(), name: state.currentUser?.name || 'Someone', text, createdAt: serverTimestamp() });
      const n = await load(); set(ref(db, 'reels/' + r.id + '/commentCount'), n).catch(() => {});
    } catch (err) { showToast(friendlyError(err, 'Could not send your comment.')); }
  };
}

function openReelCreate(initialFile, openGallery = false) {
  if (!meUid() || document.querySelector('.reel-create')) return;
  const el=document.createElement('div');el.className='screen-legal np-screen reel-create';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Create reel');
  el.innerHTML='<header class="reel-compose-head"><button type="button" data-rclose aria-label="Back">←</button><strong>Create reel</strong><span></span></header>'+
  '<nav class="reel-step-tabs" aria-label="Reel creation steps"><button type="button" class="active" data-step="video">Pick video</button><button type="button" data-step="caption">Caption &amp; hashtags</button><button type="button" data-step="upload">Upload</button></nav>'+
  '<main class="reel-compose-body">'+
  '<section class="reel-step-panel active" data-panel="video"><h3>Choose a video</h3><button type="button" class="reel-gallery-pick" data-gallery><span class="reel-gallery-icon">▣</span><b>Open gallery</b><small>Select a video from your phone</small></button><input id="reelVideoFile" type="file" accept="video/*" hidden/><video class="reel-preview" controls playsinline hidden></video><p class="reel-msg" role="alert"></p><button type="button" class="reel-next" data-next="caption">Next: Caption and hashtags</button></section>'+
  '<section class="reel-step-panel" data-panel="caption" hidden><h3>Add caption and hashtags</h3><textarea class="np-text" maxlength="500" placeholder="Write a caption…" aria-label="Caption"></textarea><input class="reel-title-input" maxlength="80" placeholder="Add a title (optional)" aria-label="Reel title"/><input class="reel-hashtags" maxlength="200" placeholder="Add hashtags (example: #murmur #friends)" aria-label="Hashtags"/><div class="reel-step-actions"><button type="button" class="reel-back" data-next="video">Back</button><button type="button" class="reel-next" data-next="upload">Next: Upload</button></div></section>'+
  '<section class="reel-step-panel" data-panel="upload" hidden><h3>Review and upload</h3><div class="reel-upload-summary"><span data-upload-name>No video selected</span><small data-upload-caption>Caption and hashtags will appear with your reel.</small></div><button type="button" class="reel-audience-row" data-raudience><span class="reel-audience-icon">●</span><span><b>Who can see this reel?</b><small data-audience-label>Friends</small></span><span class="reel-chevron">›</span></button><label class="reel-ai-row"><span class="reel-ai-icon">✧</span><span><b>Add AI label</b><small>Label realistic content that’s made with AI.</small></span><input type="checkbox" data-ailabel aria-label="Add AI label"/></label><div class="reel-prog" hidden><i></i></div><p class="reel-msg" role="alert"></p><div class="reel-step-actions"><button type="button" class="reel-back" data-next="caption">Back</button><button class="reel-share" type="button" data-rpost disabled>Upload Reel</button></div></section>'+
  '</main>';
  document.body.appendChild(el);
  const fileIn=el.querySelector('#reelVideoFile'),prev=el.querySelector('.reel-preview'),cap=el.querySelector('textarea'),titleIn=el.querySelector('.reel-title-input'),tagsIn=el.querySelector('.reel-hashtags'),prog=el.querySelector('.reel-prog'),btn=el.querySelector('[data-rpost]');
  let file=null,dur=0,audience='friends',busy=false,objectUrl='';
  const close=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);el.remove();};
  const msgFor=panel=>el.querySelector('[data-panel="'+panel+'"] .reel-msg');
  const sync=()=>{btn.disabled=busy||!file;el.querySelector('[data-upload-name]').textContent=file?file.name:'No video selected';el.querySelector('[data-upload-caption]').textContent=[cleanText(cap.value,500),cleanText(tagsIn.value,200)].filter(Boolean).join(' ')||'Caption and hashtags will appear with your reel.';};
  const go=step=>{el.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('active',b.dataset.step===step));el.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==step;p.classList.toggle('active',p.dataset.panel===step);});if(step==='upload')sync();};
  el.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>go(b.dataset.step));
  el.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>go(b.dataset.next));
  el.querySelector('[data-gallery]').onclick=()=>fileIn.click();
  fileIn.addEventListener('change',()=>{const f=fileIn.files[0];msgFor('video').textContent='';file=null;prev.hidden=true;dur=0;if(!f)return sync();if(!/^video\//.test(f.type)){msgFor('video').textContent='Please choose a video file.';return sync();}if(f.size>25*1024*1024){msgFor('video').textContent='Video must be under 25 MB.';return sync();}file=f;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(f);prev.src=objectUrl;prev.hidden=false;sync();});
  prev.addEventListener('loadedmetadata',()=>{dur=Math.round(prev.duration||0);if(dur>90){msgFor('video').textContent='Reels can be up to 90 seconds.';file=null;prev.hidden=true;sync();}});
  cap.addEventListener('input',sync);tagsIn.addEventListener('input',sync);titleIn.addEventListener('input',sync);
  el.querySelector('[data-rclose]').onclick=close;el.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  el.querySelector('[data-raudience]').onclick=()=>{const sheet=document.createElement('div');sheet.className='reel-audience-sheet';sheet.innerHTML='<div class="reel-audience-card"><div class="reel-audience-sheet-head"><b>Who can see this reel?</b><button type="button" data-audclose>×</button></div><button type="button" data-aud="public"><span><b>Public</b><small>Anyone on Murmur</small></span><i></i></button><button type="button" data-aud="friends"><span><b>Friends</b><small>Only your friends</small></span><i></i></button><button type="button" data-aud="private"><span><b>Only me</b><small>Only you can see this reel</small></span><i></i></button></div>';document.body.appendChild(sheet);sheet.querySelectorAll('[data-aud]').forEach(b=>{b.classList.toggle('selected',b.dataset.aud===audience);b.querySelector('i').textContent=b.dataset.aud===audience?'✓':'';});sheet.addEventListener('click',e=>{if(e.target===sheet||e.target.closest('[data-audclose]')){sheet.remove();return;}const choice=e.target.closest('[data-aud]');if(!choice)return;audience=choice.dataset.aud;el.querySelector('[data-audience-label]').textContent=({public:'Public',friends:'Friends',private:'Only me'})[audience];sheet.remove();});};
  btn.onclick=async()=>{if(busy)return;busy=true;sync();msgFor('upload').textContent='';let url='',path='';try{if(file){const ext=(file.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'mp4';path='reels/'+meUid()+'/'+Date.now()+'.'+ext;const task=uploadBytesResumable(storageRef(getStorage(app),path),file,{contentType:file.type});await new Promise((ok,bad)=>task.on('state_changed',s=>{prog.hidden=false;prog.firstElementChild.style.width=(s.bytesTransferred/s.totalBytes*100)+'%';},bad,ok));url=await getDownloadURL(task.snapshot.ref);}else throw new Error('Choose a video from your phone first.');const hashtags=cleanText(tagsIn.value,200).split(/\s+/).filter(Boolean).map(tag=>tag.startsWith('#')?tag:'#'+tag.replace(/^#+/,'')).join(' ');await push(ref(db,'reels'),{authorUid:meUid(),authorName:state.currentUser?.name||'Someone',username:state.currentUser?.username||'',url,path,title:cleanText(titleIn.value,80),caption:cleanText(cap.value,500),hashtags,audience,aiLabel:!!el.querySelector('[data-ailabel]').checked,duration:dur,createdAt:serverTimestamp()});showToast('Reel uploaded.');close();setView('reels');}catch(err){msgFor('upload').textContent=/storage|unauthor|bucket|object-not-found|retry-limit/i.test((err.code||'')+' '+(err.message||''))?'Video upload is unavailable in Firebase Storage. Check your Firebase Storage setup.':friendlyError(err,'Could not upload your reel.');prog.hidden=true;busy=false;sync();}};
  if(initialFile){fileIn.files;const dt=new DataTransfer();dt.items.add(initialFile);fileIn.files=dt.files;fileIn.dispatchEvent(new Event('change'));}else if(openGallery)setTimeout(()=>fileIn.click(),180);
}
/* ---------- Dark mode ---------- */
function applyTheme(t) {
  const root = document.documentElement;
  if (root.dataset.theme && root.dataset.theme !== t) { root.classList.add('theme-fade'); clearTimeout(applyTheme.t); applyTheme.t = setTimeout(() => root.classList.remove('theme-fade'), 450); }
  document.documentElement.dataset.theme = t;
  const b = document.getElementById('themeBtn'); if (b) b.innerHTML = t === 'dark' ? ic('sun') + 'Light mode' : ic('moon') + 'Dark mode';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#121820' : '#14c8a0');
}
let savedTheme = 'light'; try { savedTheme = localStorage.getItem('murmur-theme') || 'light'; } catch {}
applyTheme(savedTheme);
document.getElementById('themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('murmur-theme', t); } catch {}
  applyTheme(t);
});


/* Menu actions: connect available features and clearly label features not yet integrated. */
function openMenuNotice(title, message, actionLabel) {
  const back = document.createElement('div');
  back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="menuNoticeTitle"><h3 id="menuNoticeTitle">${esc(title)}</h3><p>${esc(message)}</p><div class="cookie-actions"><button class="btn primary" type="button" data-close>${esc(actionLabel || 'Got it')}</button></div></div>`;
  document.body.appendChild(back);
  back.querySelector('[data-close]').onclick = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
}
function openMenuMemories() {
  const posts = (remotePosts || []).filter(p => p && (p.authorUid === meUid() || p.uid === meUid()));
  const back = document.createElement('div'); back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Memories</h3><p>Your posts from this account.</p><div class="saved-post-list">${posts.length ? posts.map(p => `<article><strong>${esc(p.authorName || 'You')}</strong><p>${esc(p.text || 'Shared a photo or video')}</p></article>`).join('') : '<p>Your memories will appear here when you share posts.</p>'}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
  document.body.appendChild(back); back.querySelector('[data-close]').onclick=()=>back.remove();
}
function openMenuSwitchAccount() {
  const back = document.createElement('div'); back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Add another account?</h3><p>You'll be signed out of this account and can then log in or create another Murmur account. Choose Remember me on the login screen if you want this device to remember the account.</p><div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-switch>Continue</button></div></div>`;
  document.body.appendChild(back);
  back.querySelector('[data-cancel]').onclick = () => back.remove();
  back.querySelector('[data-switch]').onclick = () => { back.remove(); document.getElementById('logoutBtn')?.click(); };
}

function openCustomerSupport(mode = 'question') {
  if (!meUid()) { showToast('Please sign in to contact support.'); return; }
  const back = document.createElement('div');
  back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="supportTitle" style="max-height:90vh;overflow:auto">
    <h3 id="supportTitle">${mode === 'report' ? 'Report a problem' : 'Customer support'}</h3>
    <p>Tell the Murmur support team what happened. Never include your password or verification codes.</p>
    <form id="murmurSupportForm">
      <label class="field"><span>What do you need help with?</span>
        <select name="category" required>
          <option value="Account">Account and login</option>
          <option value="Profile">Profile</option>
          <option value="Posts">Posts, photos and videos</option>
          <option value="Friends">Friends and messages</option>
          <option value="Safety">Safety or abuse</option>
          <option value="Bug">App problem or bug</option>
          <option value="Other">Other</option>
        </select>
      </label>
      <label class="field"><span>Describe the issue</span>
        <textarea name="details" rows="5" minlength="10" maxlength="1500" required placeholder="Explain what happened and what you expected..."></textarea>
      </label>
      <div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Send to support</button></div>
      <p class="support-status" role="status" aria-live="polite"></p>
    </form>
  </div>`;
  document.body.appendChild(back);
  back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
  back.addEventListener('click', event => { if (event.target === back) back.remove(); });
  back.querySelector('#murmurSupportForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const status = form.querySelector('.support-status');
    const details = cleanText(form.elements.details.value, 1500);
    const category = cleanText(form.elements.category.value, 40);
    if (details.length < 10) { status.textContent = 'Please provide at least 10 characters.'; return; }
    submit.disabled = true;
    submit.textContent = 'Sending...';
    status.textContent = '';
    try {
      await push(ref(db, 'reports'), {
        type: 'support',
        category,
        reason: mode === 'report' ? 'User reported a problem' : 'Customer support request',
        details,
        by: meUid(),
        byName: state.currentUser?.name || 'Murmur user',
        createdAt: serverTimestamp(),
        status: 'open'
      });
      status.textContent = 'Your request was sent. Thank you.';
      showToast('Your support request was sent.');
      setTimeout(() => back.remove(), 900);
    } catch (error) {
      console.error('Support request failed:', error);
      status.textContent = friendlyError(error, 'Could not send your request. Please try again.');
      submit.disabled = false;
      submit.textContent = 'Send to support';
    }
  });
}


function openAppPermissions() {
  if (document.querySelector('.permissions-screen')) return;
  const el=document.createElement('div'); el.className='screen-legal np-screen permissions-screen';
  el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label','App permissions');
  el.innerHTML=`<header class="permissions-head"><button type="button" data-close aria-label="Back">←</button><strong>App permissions</strong><span></span></header>
  <main class="permissions-body"><p class="permissions-intro">Choose which device features Murmur can use. Access is requested only when you tap Allow or open the related feature.</p>
  <section class="permission-item" data-perm="photos"><div><b>Photos and videos</b><small>Select media for posts and Reels. Your browser only gives access to files you choose.</small><span class="permission-status">Selected files only</span></div><button data-action="photos" type="button">Choose</button></section>
  <section class="permission-item" data-perm="camera"><div><b>Camera</b><small>Take photos or record video when you use a camera feature.</small><span class="permission-status">Not requested</span></div><button data-action="camera" type="button">Allow</button></section>
  <section class="permission-item" data-perm="microphone"><div><b>Microphone</b><small>Record voice messages and video sound.</small><span class="permission-status">Not requested</span></div><button data-action="microphone" type="button">Allow</button></section>
  <section class="permission-item" data-perm="notifications"><div><b>Notifications</b><small>Receive alerts about messages and activity. Optional.</small><span class="permission-status">Not requested</span></div><button data-action="notifications" type="button">Allow</button></section>
  <section class="permission-item" data-perm="location"><div><b>Location</b><small>Add a location to a post when you choose. Optional.</small><span class="permission-status">Not requested</span></div><button data-action="location" type="button">Allow</button></section>
  <section class="permission-item" data-perm="contacts"><div><b>Contacts</b><small>Open the browser contact picker where supported. Your selection is not saved or imported. Optional.</small><span class="permission-status">Checking support…</span></div><button data-action="contacts" type="button">Check</button></section>
  <p class="permissions-footnote">If you choose Don't allow, Murmur will show that choice. To allow it later, change the permission in your browser or phone settings. Murmur does not access these features in the background.</p><button class="permissions-refresh" data-refresh type="button">Refresh permission status</button></main>`;
  document.body.appendChild(el);
  const labelFor=state=>({granted:'Allow',denied:"Don't allow",prompt:'Not requested'}[state]||'Status unavailable');
  const status=(name,value)=>{
    const row=el.querySelector('[data-perm="'+name+'"] .permission-status');
    if(row) row.textContent=value;
    const button=el.querySelector('[data-action="'+name+'"]');
    if(button && ['Allowed',"Don't allow",'Not requested'].includes(value)) button.textContent=value==="Don't allow"?'Change in settings':value==='Allowed'?'Allowed':'Allow';
  };
  const permissionState=async(name,api)=>{
    try {
      const permission=await navigator.permissions.query({name:api});
      status(name,labelFor(permission.state));
      permission.onchange=()=>status(name,labelFor(permission.state));
    } catch {
      if(name==='notifications' && 'Notification' in window) {
        status(name,Notification.permission==='granted'?'Allowed':Notification.permission==='denied'?"Don't allow":'Not requested');
      } else status(name,'Status unavailable; use Allow to check');
    }
  };
  const refresh=async()=>{
    await Promise.all([
      permissionState('camera','camera'),
      permissionState('microphone','microphone'),
      permissionState('location','geolocation'),
      permissionState('notifications','notifications')
    ]);
    status('photos','Browser file picker; selected files only');
    status('contacts',navigator.contacts?.select?'Picker supported':'Not supported in this browser');
  };
  el.querySelector('[data-close]').onclick=()=>el.remove();
  el.addEventListener('click',e=>{if(e.target===el)el.remove();});
  el.querySelector('[data-refresh]').onclick=refresh;
  const refreshWhenVisible=()=>{if(!document.hidden && document.querySelector('.permissions-screen')===el) refresh();};
  window.addEventListener('focus',refreshWhenVisible);
  document.addEventListener('visibilitychange',refreshWhenVisible);
  const cleanup=()=>{window.removeEventListener('focus',refreshWhenVisible);document.removeEventListener('visibilitychange',refreshWhenVisible);};
  el.querySelector('[data-close]').addEventListener('click',cleanup);
  el.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=async()=>{
    const kind=btn.dataset.action;
    const current=el.querySelector('[data-perm="'+kind+'"] .permission-status')?.textContent||'';
    if(current==="Don't allow") {
      showToast('Permission is denied. Open your browser or phone site settings for Murmur and change it to Allow, then return and refresh.');
      return;
    }
    btn.disabled=true;
    try{
      if(kind==='photos'){
        const input=document.createElement('input');input.type='file';input.accept='image/*,video/*';input.multiple=true;
        input.onchange=()=>status('photos',input.files.length?input.files.length+' file(s) selected for this action':'No files selected');input.click();
      }
      if(kind==='camera'||kind==='microphone'){
        if(!navigator.mediaDevices?.getUserMedia)throw Error('This feature requires a supported browser and HTTPS.');
        const stream=await navigator.mediaDevices.getUserMedia(kind==='camera'?{video:true}:{audio:true});
        stream.getTracks().forEach(t=>t.stop());status(kind,'Allowed');showToast(kind+' permission allowed.');
      }
      if(kind==='notifications'){
        if(!('Notification'in window))throw Error('Notifications are not supported in this browser.');
        const p=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
        status(kind,p==='granted'?'Allowed':p==='denied'?"Don't allow":'Not requested');
      }
      if(kind==='location'){
        if(!navigator.geolocation)throw Error('Location is not supported in this browser.');
        await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(()=>resolve(),e=>reject(Error(e.code===1?'PERMISSION_DENIED: Location permission was denied.':'Could not access location.')),{timeout:10000,maximumAge:60000}));
        status(kind,'Allowed; location not saved');showToast('Location permission allowed. Your location was not saved.');
      }
      if(kind==='contacts'){
        if(!navigator.contacts?.select)throw Error('Contact picking is not supported here. You can still find friends by username.');
        const picked=await navigator.contacts.select(['name','email','tel'],{multiple:true});status(kind,picked.length?'Picker selection completed; contacts not saved':'No contacts selected');
      }
    }catch(e){
      const message=e.message||'Permission could not be requested.';
      if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError'||/PERMISSION_DENIED|permission denied|not allowed/i.test(message)) status(kind,"Don't allow");
      showToast(message.replace('PERMISSION_DENIED: ',''));
      await refresh();
      if(kind==='location' && /PERMISSION_DENIED/i.test(message)) status(kind,"Don't allow");
    } finally {btn.disabled=false;}
  });
  refresh();
}
function handleMenuAction(action) {
  switch(action) {
    case 'reels': setView('reels'); break;
    case 'friends': setView('friends'); break;
    case 'chats': setView('chats'); break;
    case 'alerts': setView('alerts'); break;
    case 'feeds': setView('home'); break;
    case 'saved': openSavedPosts(); break;
    case 'memories': openMenuMemories(); break;
    case 'privacy': openLegal('privacy'); break;
    case 'lite':
      document.documentElement.classList.toggle('murmur-lite');
      try { localStorage.setItem('murmur-lite', document.documentElement.classList.contains('murmur-lite') ? '1' : '0'); } catch {}
      showToast(document.documentElement.classList.contains('murmur-lite') ? 'Lite view enabled on this device.' : 'Standard view restored.');
      break;
    case 'add-account': openMenuSwitchAccount(); break;
    case 'account-settings': openEditProfile(); break;
    case 'permissions': openAppPermissions(); break;
    case 'help': openCustomerSupport('question'); break;
    case 'report': openCustomerSupport('report'); break;
    default: break;
  }
}
document.querySelectorAll('[data-menu-action]').forEach(item => item.addEventListener('click', () => handleMenuAction(item.dataset.menuAction)));
function bindMenuAccordion(buttonId, contentId) {
  const button = document.getElementById(buttonId), content = document.getElementById(contentId);
  if (!button || !content) return;
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open)); content.hidden = !open;
  });
}
bindMenuAccordion('settingsPrivacyToggle','settingsPrivacyContent');
bindMenuAccordion('helpSupportToggle','helpSupportContent');
const menuSortButton = document.getElementById('menuSortBtn');
const menuSortGrid = document.querySelector('.murmur-menu-grid');
const menuSortTiles = menuSortGrid ? Array.from(menuSortGrid.querySelectorAll('.murmur-menu-item')) : [];
const menuSortModes = ['original', 'az', 'za'];
let menuSortMode = 'original';
menuSortTiles.forEach((tile, index) => {
  tile.dataset.menuOriginalOrder = String(index);
});
try {
  const savedMode = localStorage.getItem('murmur-menu-sort');
  if (menuSortModes.includes(savedMode)) menuSortMode = savedMode;
} catch {}
function applyMenuSort(mode, announce = false) {
  if (!menuSortGrid || !menuSortTiles.length) return;
  if (!menuSortModes.includes(mode)) mode = 'original';
  menuSortMode = mode;
  const sortedTiles = [...menuSortTiles];
  if (mode === 'az' || mode === 'za') {
    sortedTiles.sort((a, b) => {
      const comparison = a.querySelector('span')?.textContent.trim().localeCompare(
        b.querySelector('span')?.textContent.trim(), undefined,
        { sensitivity: 'base', numeric: true }
      ) || 0;
      return mode === 'az' ? comparison : -comparison;
    });
  } else {
    sortedTiles.sort((a, b) =>
      Number(a.dataset.menuOriginalOrder) - Number(b.dataset.menuOriginalOrder)
    );
  }
  sortedTiles.forEach(tile => menuSortGrid.appendChild(tile));
  if (menuSortButton) {
    const labels = {
      original: 'Original order',
      az: 'A to Z',
      za: 'Z to A'
    };
    menuSortButton.setAttribute('aria-pressed', String(mode !== 'original'));
    menuSortButton.setAttribute('aria-label', 'Menu sort: ' + labels[mode] + '. Tap to change sort order');
    menuSortButton.title = 'Menu sort: ' + labels[mode] + ' (tap to change)';
    menuSortButton.dataset.sortMode = mode;
  }
  try { localStorage.setItem('murmur-menu-sort', mode); } catch {}
  if (announce && typeof showToast === 'function') {
    const messages = {
      original: 'Original menu order restored.',
      az: 'Menu sorted A to Z.',
      za: 'Menu sorted Z to A.'
    };
    showToast(messages[mode]);
  }
}
applyMenuSort(menuSortMode);
menuSortButton?.addEventListener('click', () => {
  const nextMode = menuSortModes[
    (menuSortModes.indexOf(menuSortMode) + 1) % menuSortModes.length
  ];
  applyMenuSort(nextMode, true);
});
const menuSearchPanel = document.getElementById('menuSearchPanel');
const menuSearchInput = document.getElementById('menuSearchInput');
const menuSearchClose = document.getElementById('menuSearchClose');
const menuSearchables = Array.from(document.querySelectorAll(
  '.murmur-menu-grid .murmur-menu-item, .menu-accordion-toggle, .menu-accordion-content .menu-row, .menu-add-account, .menu-logout'
));
function filterMenuItems(value) {
  const query = String(value || '').trim().toLocaleLowerCase();
  menuSearchables.forEach(item => {
    if (item.classList.contains('menu-accordion-content')) return;
    const match = !query || item.textContent.toLocaleLowerCase().includes(query);
    item.hidden = !match;
  });
  document.querySelectorAll('.menu-accordion-content').forEach(content => {
    const rows = Array.from(content.querySelectorAll('.menu-row'));
    const hasMatchingRow = query && rows.some(row => !row.hidden);
    const heading = content.previousElementSibling;
    if (query && hasMatchingRow) {
      content.hidden = false;
      if (heading) heading.hidden = false;
    } else if (query) {
      content.hidden = true;
    } else {
      const expanded = heading?.getAttribute('aria-expanded') === 'true';
      content.hidden = !expanded;
      if (heading) heading.hidden = false;
    }
  });
  document.querySelector('.murmur-menu-grid')?.classList.toggle('menu-searching', Boolean(query));
  document.querySelector('.menu-accordion')?.classList.toggle('menu-searching', Boolean(query));
}
function closeMenuSearch() {
  if (!menuSearchPanel) return;
  menuSearchPanel.hidden = true;
  if (menuSearchInput) menuSearchInput.value = '';
  filterMenuItems('');
  document.getElementById('menuSearchBtn')?.focus();
}
document.getElementById('menuSearchBtn')?.addEventListener('click', () => {
  if (!menuSearchPanel) return;
  menuSearchPanel.hidden = false;
  menuSearchInput?.focus();
});
menuSearchInput?.addEventListener('input', () => filterMenuItems(menuSearchInput.value));
menuSearchClose?.addEventListener('click', closeMenuSearch);
menuSearchInput?.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenuSearch();
});
document.getElementById('menuProfileBtn')?.addEventListener('click', () => {
  if (meUid()) openProfile(meUid());
});
try { if (localStorage.getItem('murmur-lite') === '1') document.documentElement.classList.add('murmur-lite'); } catch {}

const okImg = u => typeof u === 'string' && u.startsWith('data:image/') && !/["')\s]/.test(u);
function fileToDataUrl(file, w, h) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const r = Math.max(w / img.width, h / img.height), dw = img.width * r, dh = img.height * r;
      c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = url;
  });
}
function fileToFitDataUrl(file, max = 1000, quality = 0.72) {   // keeps the picture's shape, only makes it smaller
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = url;
  });
}
const PROFILE_FIELDS = ['bio', 'school', 'location', 'hometown', 'work', 'role'];   // the text fields on Edit profile
function setBg(el, url) { if (okImg(url)) { el.style.backgroundImage = `url("${url}")`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; return true; } return false; }
function applyOwnPhoto() {
  const u = state.currentUser || {};
  ['menuAvatar', 'composerAvatar'].forEach(id => { const el = document.getElementById(id); if (el && !setBg(el, u.photo)) el.style.backgroundImage = ''; });
}

async function openEditProfile() {
  const u = meUid();
  let d = {};
  try { d = (await get(ref(db, 'users/' + u))).val() || {}; } catch {}
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal-card" style="max-height:92vh;overflow:auto" role="dialog" aria-modal="true"><h3>Edit profile</h3>
    <div class="edit-cover" data-cover></div>
    <label class="btn ghost small edit-pick">Change cover photo<input type="file" accept="image/*" hidden data-file="cover" /></label>
    <div class="edit-avatar avatar" data-avatar></div>
    <label class="btn ghost small edit-pick">Change profile photo<input type="file" accept="image/*" hidden data-file="photo" /></label>
    <div class="field"><label>Bio</label><textarea data-f="bio" maxlength="160"></textarea></div>
    <div class="field"><label>School</label><input data-f="school" type="text" maxlength="60" /></div>
    <div class="field"><label>Location</label><input data-f="location" type="text" maxlength="60" /></div>
    <div class="field"><label>Hometown</label><input data-f="hometown" type="text" maxlength="60" /></div>
    <div class="field"><label>Workplace</label><input data-f="work" type="text" maxlength="60" /></div>
    <div class="field"><label>Job title</label><input data-f="role" type="text" maxlength="60" /></div>
    <div class="error" role="alert" data-err></div>
    <div class="upload-status" data-up hidden><div class="splash-bar" data-upbar><i></i></div><strong data-uptext></strong></div>
    <div class="row-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save</button></div></div>`;
  document.body.appendChild(back);
  const q = sel => back.querySelector(sel), pending = {};
  PROFILE_FIELDS.forEach(k => { q(`[data-f="${k}"]`).value = d[k] || ''; });
  if (!setBg(q('[data-cover]'), d.cover)) q('[data-cover]').style.backgroundImage = '';
  if (!setBg(q('[data-avatar]'), d.photo)) q('[data-avatar]').textContent = initials(state.currentUser?.name || '?');
  back.querySelectorAll('[data-file]').forEach(inp => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const kind = inp.dataset.file;
      pending[kind] = await fileToDataUrl(f, kind === 'photo' ? 160 : 720, kind === 'photo' ? 160 : 240);
      setBg(q(kind === 'photo' ? '[data-avatar]' : '[data-cover]'), pending[kind]);
    } catch (e) { q('[data-err]').textContent = friendlyError(e, 'Could not use that image.'); }
  }));
  q('[data-cancel]').onclick = () => back.remove();
  q('[data-save]').onclick = async () => {
    const data = { ...Object.fromEntries(PROFILE_FIELDS.map(k => [k, q(`[data-f="${k}"]`).value.trim()])), ...pending };
    const btn = q('[data-save]'); btn.disabled = true; btn.textContent = 'Saving...';
    const hasImg = !!(pending.photo || pending.cover), t0 = Date.now(), delay = ms => new Promise(r => setTimeout(r, ms));
    q('[data-err]').textContent = '';
    if (hasImg) { q('[data-up]').hidden = false; q('[data-uptext]').textContent = 'Uploading your photo… please wait a few seconds.'; back.querySelectorAll('input,textarea,button').forEach(x => { x.disabled = true; }); }
    try {
      {
        const upd = {};
        Object.entries(data).forEach(([k, v]) => { upd[`users/${u}/${k}`] = v; upd[`profiles/${u}/${k}`] = v; });
        await update(ref(db), upd);
      }
      if (hasImg) {
        const wait = 2000 - (Date.now() - t0); if (wait > 0) await delay(wait);
        q('[data-upbar]').hidden = true; q('[data-uptext]').textContent = 'Uploaded! Your friends can now see your new photo.';
        await delay(1300);
      }
      if (data.photo) state.currentUser.photo = data.photo;
      applyOwnPhoto(); back.remove();
      if (profileOverlay && profileUid === u) loadProfileDetails(u);
      showToast('Profile updated.');
    } catch (e) { q('[data-err]').textContent = friendlyError(e, 'Could not save your profile.'); back.querySelectorAll('input,textarea,button').forEach(x => { x.disabled = false; }); q('[data-up]').hidden = true; btn.textContent = 'Save'; }
  };
}

function findPerson(uid) {
  if (uid === meUid()) return { uid, name: state.currentUser?.name || 'You', username: state.currentUser?.username || '' };
  const d = friendDocs.find(x => x.uid === uid) || searchResults.find(x => x.uid === uid);
  return d ? { uid, name: d.name, username: d.username } : null;
}
const relationOf = uid => (friendDocs.find(x => x.uid === uid) || {}).status || 'none';

function renderProfileActions() {
  if (!profileOverlay) return;
  if (profileUid === meUid()) {
    profileOverlay.querySelector('[data-p-actions]').innerHTML = '<button class="btn primary" type="button" data-p-story>Add to story</button><button class="btn ghost" type="button" data-p-edit>Edit profile</button>';
    const n = friendDocs.filter(d => d.status === 'accepted').length;
    profileOverlay.querySelector('[data-p-rel]').textContent = n + (n === 1 ? ' friend' : ' friends');
    return;
  }
  const rel = relationOf(profileUid), person = findPerson(profileUid) || {};
  const B = (cls, attr, label) => `<button class="btn ${cls}" type="button" ${attr}>${label}</button>`;
  const main = rel === 'accepted' ? B('primary', 'data-p-msg', 'Message') + B('ghost', 'data-p-remove', 'Remove friend')
    : rel === 'incoming' ? B('primary', 'data-p-accept', 'Confirm request') + B('ghost', 'data-p-remove', 'Delete')
    : rel === 'outgoing' ? B('ghost', 'data-p-remove', 'Cancel request')
    : B('primary', 'data-p-add', 'Add friend');
  profileOverlay.querySelector('[data-p-actions]').innerHTML = main + B('ghost', `data-report-user="${esc(profileUid)}" data-name="${esc(person.name || '')}"`, 'Report');
  profileOverlay.querySelector('[data-p-rel]').textContent = { accepted: isActive(profileUid) ? 'Friends · Active now' : 'Friends', incoming: 'Sent you a friend request', outgoing: 'Friend request sent', none: 'Not your friend yet' }[rel];
  const dot = profileOverlay.querySelector('[data-p-dot]');
  if (dot) { dot.hidden = rel !== 'accepted'; dot.classList.toggle('off', !isActive(profileUid)); }
}

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
  const self = profileUid === meUid(), n = noteData[profileUid];
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
  if (okImg(d.cover)) setBg(cover, d.cover); else cover.style.backgroundImage = '';
  if (okImg(d.photo)) setBg(av, d.photo);
  const city = (d.location || '').split(',')[0].trim();
  root.querySelector('[data-p-info]').innerHTML = [city && ic('pin') + esc(city), d.work && ic('work') + esc(d.work), d.school && ic('school') + esc(d.school)].filter(Boolean).map(x => `<span>${x}</span>`).join('<i>·</i>');
  renderProfileNote(); renderProfileTab();
}
async function loadProfileDetails(uid) {
  let d = null;
  watchNote(uid);
  try { d = (await get(ref(db, (uid === meUid() ? 'users/' : 'profiles/') + uid))).val(); } catch {}
  if (!profileOverlay || profileUid !== uid) return;
  profileData = d || {};
  paintProfile();
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
document.addEventListener('click', e => { const pr = e.target.closest('[data-profile]'); if (pr) openProfile(pr.dataset.profile); });
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
document.getElementById('chatProfileBtn').addEventListener('click', () => { if (activeChatUid) openProfile(activeChatUid); });
['chatAvatar', 'chatName'].forEach(id => {
  const node = document.getElementById(id);
  node.style.cursor = 'pointer';
  node.addEventListener('click', () => { if (activeChatUid) openProfile(activeChatUid); });
});

let annList = [], notes = [], suspendedInfo = null, myAppeal = null, extraSubs = [], presenceTimer = null, suspendedCountdownTimer = null;

function startExtras(uid) {
  stopExtras();
  const off = () => {};
  extraSubs = [
    onValue(query(ref(db, 'announcements'), orderByChild('createdAt'), limitToLast(20)), s => { annList = Object.entries(s.val() || {}).map(([id, a]) => ({ id, ...a })); renderAnnouncements(); }, off),
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
  if (state.activeView === 'alerts') markAnnSeen(); else renderAlerts();
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
  const upd = {};
  notes.filter(n => !n.read).forEach(n => { upd[`notifications/${u}/${n.id}/read`] = true; });
  if (Object.keys(upd).length) update(ref(db), upd).catch(() => {});
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

/* =====================================================================
   SENDING  -  messages and posts
   ===================================================================== */
let voiceRecorder = null, voiceChunks = [], voiceStream = null, voiceRecording = false;
async function toggleVoiceMessage() {
  const button = document.getElementById('voiceBtn');
  if (!activeChatUid || !meUid()) { showToast('Open a chat first.'); return; }
  if (voiceRecording && voiceRecorder) { voiceRecorder.stop(); button.textContent = '🎙️'; button.disabled = true; return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { showToast('Voice recording is not supported by this browser.'); return; }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = []; voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable = event => { if (event.data?.size) voiceChunks.push(event.data); };
    voiceRecorder.onerror = () => showToast('Voice recording failed.');
    voiceRecorder.onstop = async () => {
      voiceRecording = false; voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null;
      try {
        const recipientUid = activeChatUid, senderUid = meUid();
        const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/webm' });
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Voice message must be under 8 MB.');
        const filePath = `chat-audio/${senderUid}/${chatIdOf(senderUid, recipientUid)}/${Date.now()}.webm`;
        const task = uploadBytesResumable(storageRef(getStorage(app), filePath), blob, { contentType: blob.type || 'audio/webm' });
        await new Promise((resolve, reject) => { task.on('state_changed', null, reject, resolve); });
        const audioUrl = await getDownloadURL(task.snapshot.ref);
        await push(ref(db, `chats/${chatIdOf(senderUid, recipientUid)}/messages`), { from: senderUid, audioUrl, audioPath: filePath, createdAt: serverTimestamp() });
        showToast('Voice message sent.');
      } catch (error) { showToast(friendlyError(error, 'Could not send voice message.')); }
      finally { button.disabled = false; button.textContent = '🎙️'; voiceRecorder = null; voiceChunks = []; }
    };
    voiceRecorder.start(); voiceRecording = true; button.textContent = '■'; showToast('Recording… tap ■ to send.');
  } catch (error) { voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null; showToast(friendlyError(error, 'Microphone permission is needed.')); }
}
document.getElementById('voiceBtn').addEventListener('click', toggleVoiceMessage);
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendBtn');
  const recipientUid = activeChatUid;
  const senderUid = meUid();
  const text = cleanText(input.value, CONFIG.maxLength.message);
  if (!text || !recipientUid || sendingMessage) return;
  if (!senderUid || !auth.currentUser) { showToast('Please log in again to send messages.'); return; }
  if (recipientUid === senderUid) { showToast('Choose a friend to message.'); return; }
  if (isBlocked(recipientUid)) { showToast('You blocked this person.'); return; }
  if (!navigator.onLine) { showToast('You are offline. Message not sent.'); return; }
  if (messageLimiter.check()) { showToast(CONFIG.text.tooFastMessage); return; }

  sendingMessage = true;
  sendButton.disabled = true;
  input.value = '';
  stopTyping();
  try {
    await push(ref(db, `chats/${chatIdOf(senderUid, recipientUid)}/messages`), {
      from: senderUid, text, createdAt: serverTimestamp()
    });
  } catch (error) {
    // Restore the draft only if the user has not started typing a newer message.
    if (!input.value) input.value = text;
    showToast(friendlyError(error, 'Message failed. Check your connection and try again.'));
  } finally {
    sendingMessage = false;
    sendButton.disabled = false;
    if (activeChatUid === recipientUid && document.activeElement !== input) input.focus();
  }
}

async function createPost() {
  const input = document.getElementById('postInput');
  const text = cleanText(input.value, CONFIG.maxLength.post), extras = postExtraFields();
  if (!text && !Object.keys(extras).length) return false;
  if (postAudience.mode === 'specific' && !postAudience.uids.length) { showToast('Choose at least one friend who can see this post.'); return false; }
  if (postLimiter.check()) { showToast(CONFIG.text.tooFastPost); return false; }
  const user = auth.currentUser;
  if (user && remotePosts) {
    try {
      await push(ref(db, 'posts'), { authorUid: user.uid, authorName: state.currentUser?.name || 'Someone', authorUsername: state.currentUser?.username || '', text, ...postAudienceFields(), ...extras, createdAt: serverTimestamp() });
      input.value = ''; postExtras = {};
      return true;
    } catch (e) { showToast(friendlyError(e, 'Could not post.')); return false; }
  }
  state.posts.unshift({ id: Date.now(), author: 'me', text, likes: 0, liked: false });
  input.value = '';
  saveState();
  renderPosts();
  return true;
}

function openSavedPosts() {
  const ids = Object.keys(savedPostIds || {}).filter(id => savedPostIds[id]);
  const posts = (remotePosts || []).filter(p => ids.includes(p.id));
  const back = document.createElement('div'); back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Saved posts</h3><div class="saved-post-list">${posts.length ? posts.map(p => `<article><strong>${esc(p.authorName || 'Someone')}</strong><p>${esc(p.text || (p.photo ? 'Photo post' : 'Post'))}</p><button class="btn small ghost" type="button" data-unsave="${esc(p.id)}">Remove saved post</button></article>`).join('') : '<p>No saved posts yet.</p>'}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
  document.body.appendChild(back); back.querySelector('[data-close]').onclick = () => back.remove();
  back.addEventListener('click', async e => { const b = e.target.closest('[data-unsave]'); if (!b) return; try { await remove(ref(db, `savedPosts/${meUid()}/${b.dataset.unsave}`)); b.closest('article').remove(); showToast('Removed from saved posts.'); } catch (error) { showToast(friendlyError(error, 'Could not remove saved post.')); } });
}
document.getElementById('loginBtn').addEventListener('click', () => {
  login(document.getElementById('email').value, document.getElementById('password').value);
});
document.getElementById('createBtn').addEventListener('click', openRegisterWizard);
document.getElementById('resetBtn').addEventListener('click', openForgotPassword);
document.getElementById('postBtn').addEventListener('click', createPost);
document.getElementById('savedPostsOpen').addEventListener('click', openSavedPosts);
document.addEventListener('click', async e => {
  const save = e.target.closest('[data-save-post]'); if (!save || !meUid()) return;
  const id = save.dataset.savePost;
  try { await set(ref(db, `savedPosts/${meUid()}/${id}`), savedPostIds[id] ? null : true); showToast(savedPostIds[id] ? 'Post removed from saved.' : 'Post saved.'); }
  catch (error) { showToast(friendlyError(error, 'Could not save post.')); }
});
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messages').addEventListener('click', async e => {
  const b = e.target.closest('[data-msg-react]'); if (!b || !activeChatUid || !meUid()) return;
  const messageId = b.dataset.msgReact, emoji = b.dataset.emoji;
  try { await set(ref(db, `${chatPath()}/messages/${messageId}/reactions/${meUid()}`), emoji); }
  catch (error) { showToast(friendlyError(error, 'Could not react to message.')); }
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  const btn = document.getElementById('logoutBtn');
  if (btn.classList.contains('logging-out')) return;
  btn.classList.add('logging-out');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise(r => setTimeout(r, reduce ? 0 : CONFIG.logoutAnimationMs));
  appEl.classList.add('leaving');
  await new Promise(r => setTimeout(r, reduce ? 0 : 450));
  try {
    try { await signOut(auth); } catch (error) { console.warn('Sign out failed:', error && error.code); }
    state.loggedIn = false;
    saveState();
    showAuth();
  } finally {
    btn.classList.remove('logging-out');
    appEl.classList.remove('leaving');
  }
});
document.getElementById('messageInput').addEventListener('input', e => {
  if (!activeChatUid || !auth.currentUser) return;
  clearTimeout(typingStop);
  if (!e.target.value.trim()) return stopTyping();
  const now = Date.now();
  if (now - lastTypingSent > 2000) { lastTypingSent = now; set(ref(db, `${chatPath()}/typing/${meUid()}`), now).catch(() => {}); }
  typingStop = setTimeout(stopTyping, 3500);
});
document.getElementById('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
// tapping Send must not steal focus (that closes the keyboard)
document.getElementById('sendBtn').addEventListener('pointerdown', e => e.preventDefault());
document.getElementById('postInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') createPost();
});
document.getElementById('chatSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const list = document.getElementById('chatList');
  list.querySelectorAll('.chat-item').forEach(item => {
    const name = item.textContent.toLowerCase();
    item.style.display = q && !name.includes(q) ? 'none' : 'flex';
  });
});

document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.getElementById('friendSearchBtn').addEventListener('click', searchFriends);
document.getElementById('friendSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriends(); });
document.addEventListener('click', async e => {
  const add = e.target.closest('[data-fr-add]'), acc = e.target.closest('[data-fr-accept]'), del = e.target.closest('[data-fr-del]'), msg = e.target.closest('[data-msg]');
  try {
    if (add) { await sendFriendRequest(searchResults[Number(add.dataset.frAdd)]); return; }
    if (acc) { const o = acc.dataset.frAccept, u = meUid(); await update(ref(db), { [`friends/${u}/${o}/status`]: 'accepted', [`friends/${o}/${u}/status`]: 'accepted' }); return; }
    if (del) { const o = del.dataset.frDel, u = meUid(); await update(ref(db), { [`friends/${u}/${o}`]: null, [`friends/${o}/${u}`]: null }); return; }
    if (msg) { setView('chats'); openChat(msg.dataset.msg); return; }
  } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
});
document.addEventListener('click', async e => {
  const likeBtn = e.target.closest('[data-like]');
  const delBtn = e.target.closest('[data-del]');
  const uid = auth.currentUser?.uid;
  try {
    if (delBtn && remotePosts) { await remove(ref(db, 'posts/' + delBtn.dataset.del)); return; }
    if (!likeBtn) return;
    if (remotePosts && uid) {
      const post = remotePosts.find(p => p.id === likeBtn.dataset.like);
      if (!post) return;
      const lr = ref(db, `posts/${post.id}/likes/${uid}`);
      const had = !!(post.likes || {})[uid];
      await (had ? remove(lr) : set(lr, true));
      if (!had && post.authorUid && post.authorUid !== uid) set(ref(db, `notifications/${post.authorUid}/like_${post.id}_${uid}`), { type: 'like', postId: post.id, from: uid, text: `${state.currentUser?.name || 'Someone'} liked your post`, createdAt: serverTimestamp(), read: false }).catch(() => {});
      return;
    }
    const post = state.posts.find(p => p.id === Number(likeBtn.dataset.like));
    if (!post) return;
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    saveState();
    renderPosts();
  } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
});

document.getElementById('hdrAdd').addEventListener('click', () => { setView('home'); openCreatePost(); });
document.getElementById('hdrSearch').addEventListener('click', () => { setView('friends'); setFrSearch(true); });

function openDeleteAccount() {
  const user = auth.currentUser;
  if (!user) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Delete your account?</h3>
    <p>This permanently deletes your profile and your posts. It can't be undone. Enter your password to confirm.</p>
    <input type="password" autocomplete="current-password" placeholder="Password" />
    <div class="error" role="alert"></div>
    <div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-confirm style="background:var(--danger);color:#fff">Delete forever</button></div></div>`;
  document.body.appendChild(back);
  const pw = back.querySelector('input'), err = back.querySelector('.error'), ok = back.querySelector('[data-confirm]');
  back.querySelector('[data-cancel]').onclick = () => back.remove();
  pw.focus();
  ok.onclick = async () => {
    err.textContent = '';
    if (!pw.value) { err.textContent = 'Enter your password.'; return; }
    ok.disabled = true; ok.textContent = 'Deleting...';
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw.value));
      const mine = await get(query(ref(db, 'posts'), orderByChild('authorUid'), equalTo(user.uid)));
      const wipe = {};
      Object.keys(mine.val() || {}).forEach(id => { wipe['posts/' + id] = null; });
      friendDocs.forEach(d => { wipe[`friends/${user.uid}/${d.uid}`] = null; wipe[`friends/${d.uid}/${user.uid}`] = null; });
      wipe['profiles/' + user.uid] = null; wipe['presence/' + user.uid] = null; wipe['notifications/' + user.uid] = null; wipe['savedPosts/' + user.uid] = null; wipe['users/' + user.uid] = null;
      await update(ref(db), wipe);
      await deleteUser(user);
      stopPostsListener();
      state.loggedIn = false; state.currentUser = { ...DEFAULT_STATE.currentUser };
      saveState(); back.remove(); showAuth(); showToast('Your account was deleted.');
    } catch (e) {
      err.textContent = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential' ? 'Wrong password.' : (friendlyError(e, 'Could not delete account.'));
      ok.disabled = false; ok.textContent = 'Delete forever';
    }
  };
}
document.getElementById('deleteAccountBtn').addEventListener('click', openDeleteAccount);

onAuthStateChanged(auth, async (user) => {
  syncMurmurSupabaseIdentity(user);
  if (!user) { endSession(); suspendedInfo = null; document.getElementById('suspendedScreen')?.remove(); }
  renderMenuHeader();
  if (user) {
    let restriction = null;
    try { restriction = await getAccountRestriction(user.uid); } catch (e) { console.warn('Could not verify account restriction:', e); }
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
    if (restriction) {
      endSession();
      state.loggedIn = false;
      suspendedInfo = restriction;
      myAppeal = (await get(ref(db, 'appeals/' + user.uid)).catch(() => null))?.val?.() || null;
      appEl.hidden = true;
      renderSuspended();
      return;
    }
    startSession(user);
    state.activeView = 'home';
    state.loggedIn = true;
    state.currentUser = {
      uid: user.uid,
      name: state.currentUser?.name || 'Me',
      email: user.email || state.currentUser?.email || '',
      username: state.currentUser?.username || '@user'
    };
    saveState();
    get(ref(db, 'users/' + user.uid)).then(snap => {
      const p = snap.val() || {};
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      state.currentUser = { ...state.currentUser, name: p.name || state.currentUser.name, username: p.username || state.currentUser.username, photo: p.photo || state.currentUser.photo || '' };
      state.users.me = { ...state.currentUser };
      saveState();
      if (appEl.hidden) showApp(); else renderAll();
    }).catch(() => {});
  }
});


/* =====================================================================
   BLOCK PEOPLE  -  stop a person: STOP sign animation, hide their chat
   Saved on this device (and in Firebase at blocks/<you>/<them> if your rules allow it).
   ===================================================================== */
const blockKey = () => 'murmur-blocked-' + (meUid() || 'guest');
function loadBlocked() {
  const k = blockKey();
  if (blockedLoadedFor === k) return;
  blockedLoadedFor = k; blocked.clear();
  try { Object.entries(JSON.parse(localStorage.getItem(k) || '{}')).forEach(([u, n]) => blocked.set(u, n)); } catch {}
  if (auth.currentUser) {
    get(ref(db, 'blocks/' + auth.currentUser.uid)).then(snap => {
      const v = snap.val && snap.val(); if (!v) return;
      Object.keys(v).forEach(u => { if (!blocked.has(u)) blocked.set(u, 'Blocked person'); });
      renderChats();
    }).catch(() => {});
  }
}
function saveBlocked() {
  try { localStorage.setItem(blockKey(), JSON.stringify(Object.fromEntries(blocked))); } catch {}
}
async function setBlocked(uid, name, on) {
  loadBlocked();
  if (on) blocked.set(uid, name); else blocked.delete(uid);
  saveBlocked();
  if (auth.currentUser) {
    try { await set(ref(db, `blocks/${auth.currentUser.uid}/${uid}`), on ? true : null); } catch (e) { /* rules may not allow it: it still works on this device */ }
  }
}
const STOP_SIGN = '<div class="stop-sign" aria-hidden="true"><span>STOP</span></div>';

function openBlockDialog(uid, name) {
  const back = document.createElement('div');
  back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card block-card" role="dialog" aria-modal="true">${STOP_SIGN}<h3>${esc(CONFIG.text.blockTitle.replace('{name}', name))}</h3><p>${esc(CONFIG.text.blockBody)}</p><div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-confirm style="background:var(--danger);color:#fff">Block</button></div></div>`;
  document.body.appendChild(back);
  const card = back.querySelector('.block-card');
  back.querySelector('[data-cancel]').onclick = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('[data-confirm]').onclick = async () => {
    card.classList.add('stamped');
    card.querySelector('h3').textContent = name + ' is blocked';
    card.querySelector('p').textContent = '';
    card.querySelector('.cookie-actions').remove();
    await setBlocked(uid, name, true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      back.remove();
      slideOutChat(() => {
        if (location.hash === '#chat') history.replaceState(null, '', location.pathname + location.search);
        closeChat();
        renderChats();
        showToast(name + ' is blocked.');
      });
    }, reduce ? 0 : CONFIG.blockAnimMs);
  };
}
document.getElementById('chatBlockBtn').addEventListener('click', () => {
  if (!activeChatUid) return;
  const o = friendsOf().map(otherOf).find(x => x.uid === activeChatUid);
  openBlockDialog(activeChatUid, o ? o.name : 'this person');
});

function openBlockedList() {
  loadBlocked();
  const back = document.createElement('div');
  back.className = 'modal-back top';
  const rows = () => blocked.size ? [...blocked].map(([u, n]) => `<div class="blocked-row"><span>${esc(n)}</span><button class="btn small ghost" type="button" data-unblock="${esc(u)}">Unblock</button></div>`).join('') : '<p>You have not blocked anyone.</p>';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Blocked people</h3><div class="blocked-list">${rows()}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
  document.body.appendChild(back);
  back.querySelector('[data-close]').onclick = () => back.remove();
  back.addEventListener('click', async e => {
    if (e.target === back) { back.remove(); return; }
    const b = e.target.closest('[data-unblock]'); if (!b) return;
    await setBlocked(b.dataset.unblock, '', false);
    back.querySelector('.blocked-list').innerHTML = rows();
    renderChats(); showToast('Unblocked.');
  });
}
document.getElementById('blockedBtn').addEventListener('click', openBlockedList);

/* =====================================================================
   SECURITY + SAFETY  -  validation, rate limits, 401/403/404/500 pages
   ===================================================================== */
// ---------- input validation ----------
function isValidEmail(v) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
function cleanText(v, max) {
  // drop control chars, collapse runaway whitespace, enforce length
  return String(v || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s{3,}/g, '  ').trim().slice(0, max);
}

// ---------- rate limiting (client side; real limits belong on the server / Firebase rules) ----------
function makeLimiter(max, windowMs) {
  let hits = [];
  return { check() {
    const now = Date.now();
    hits = hits.filter(t => now - t < windowMs);
    if (hits.length >= max) return windowMs - (now - hits[0]);
    hits.push(now);
    return 0;
  } };
}
const loginLimiter = makeLimiter(...CONFIG.rateLimits.login);
const messageLimiter = makeLimiter(...CONFIG.rateLimits.message);
const postLimiter = makeLimiter(...CONFIG.rateLimits.post);

// ---------- status pages ----------
const STATUS_PAGES = {
  401: { label: 'Unauthorized', title: 'Please log in first', text: 'This page is only for signed-in people. Log in and try again.', bad: false, action: 'Go to log in' },
  403: { label: 'Forbidden', title: 'You can\u2019t open this', text: 'You\u2019re signed in, but this isn\u2019t something your account can access.', bad: false, action: 'Go back home' },
  404: { label: 'Not found', title: 'We couldn\u2019t find that page', text: 'The link may be wrong or the page may have moved.', bad: false, action: 'Go back home' },
  500: { label: 'Server error', title: 'Something broke on our side', text: 'It\u2019s not you. Reload the page, and if it keeps happening try again later.', bad: true, action: 'Reload' }
};
let statusEl = null;
function closeStatusPage() { if (statusEl) { statusEl.remove(); statusEl = null; } document.body.style.overflow = ''; }
function showStatusPage(code) {
  const info = STATUS_PAGES[code]; if (!info) return;
  closeStatusPage();
  statusEl = document.createElement('div');
  statusEl.className = 'status-page';
  statusEl.setAttribute('role', 'alert');
  statusEl.innerHTML = `<div class="status-card"><div class="status-code${info.bad ? ' is-bad' : ''}">${code}</div><span class="status-label">${info.label}</span><h2>${info.title}</h2><p>${info.text}</p><div class="status-actions"><button class="btn primary" type="button" data-go>${info.action}</button></div></div>`;
  document.body.appendChild(statusEl);
  document.body.style.overflow = 'hidden';
  statusEl.querySelector('[data-go]').onclick = () => {
    if (code === 500) { location.reload(); return; }
    closeStatusPage();
    history.replaceState(null, '', location.pathname + location.search);
    if (code === 401) { showAuth(); } else if (state.loggedIn) { showApp(); }
  };
  statusEl.querySelector('[data-go]').focus();
}

// ---------- 301-style redirects for old links ----------
const HASH_REDIRECTS = { '#login': '', '#signin': '', '#signup': '#create-account', '#register': '#create-account', '#reset': '#forgot-password', '#privacy-policy': '#privacy', '#cookie-policy': '#cookies' };
const KNOWN_HASHES = ['', '#', '#profile', '#chat', '#new-post', '#new-story', '#create-account', '#forgot-password', ...Object.keys(LEGAL_HASHES)];
const NEEDS_LOGIN = ['#profile', '#chat', '#new-post', '#new-story'];
function guardRoute() {
  let h = location.hash;
  if (h in HASH_REDIRECTS) { history.replaceState(null, '', location.pathname + location.search + HASH_REDIRECTS[h]); h = HASH_REDIRECTS[h]; }
  if (h === '#new-story' && !storyOverlay) { history.replaceState(null, '', location.pathname + location.search); return true; }
  if (h === '#new-post' && !postOverlay) { history.replaceState(null, '', location.pathname + location.search); return true; }
  if (h === '#chat' && !activeChatUid) { history.replaceState(null, '', location.pathname + location.search); return true; }
  if (!KNOWN_HASHES.includes(h)) { showStatusPage(404); return false; }
  if (NEEDS_LOGIN.includes(h) && !state.loggedIn) { showStatusPage(401); return false; }
  closeStatusPage();
  return true;
}
window.addEventListener('hashchange', guardRoute);

// ---------- automatic app error reporting ----------
const MURMUR_ERROR_LOG_URL = MURMUR_SUPABASE_URL + '/functions/v1/murmur-error-log';
const murmurErrorSeen = new Map();
const murmurOriginalFetch = window.fetch.bind(window);
window.fetch = async function (...args) {
  const requestUrl = String(args[0] && args[0].url || args[0] || '');
  if (requestUrl.includes('/functions/v1/murmur-error-log')) return murmurOriginalFetch(...args);
  try {
    const response = await murmurOriginalFetch(...args);
    if (!response.ok) sendMurmurError('api', new Error('HTTP ' + response.status + ' ' + response.statusText), { source: requestUrl });
    return response;
  } catch (error) {
    sendMurmurError('network', error, { source: requestUrl });
    throw error;
  }
};
const murmurOriginalConsoleError = console.error.bind(console);
console.error = function (...args) {
  murmurOriginalConsoleError(...args);
  const detail = args.map(value => value && (value.message || value.code) || value).join(' ');
  sendMurmurError('handled', detail, { source: 'console.error' });
};

function sendMurmurError(kind, error, meta = {}) {
  const user = auth.currentUser;
  const message = String(error && (error.message || error.code) || error || 'Unknown app error')
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .slice(0, 400);
  const source = String(meta.source || '').split('?')[0].slice(0, 200);
  const fingerprint = [kind, message, source].join('|').toLowerCase().slice(0, 120);
  const now = Date.now();
  if (murmurErrorSeen.has(fingerprint) && now - murmurErrorSeen.get(fingerprint) < 60000) return;
  murmurErrorSeen.set(fingerprint, now);
  const tokenRequest = user ? user.getIdToken().catch(() => null) : Promise.resolve(null);
  tokenRequest.then(token => {
    const headers = { 'apikey': MURMUR_SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(MURMUR_ERROR_LOG_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind, message, source,
        code: String(error && error.code || '').slice(0, 80),
        line: Number(meta.line) || null,
        column: Number(meta.column) || null,
        page: (location.pathname + location.hash).slice(0, 120),
        userAgent: navigator.userAgent,
        stack: error && typeof error.stack === 'string' ? error.stack.split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10)).slice(0, 1200) : '',
        fingerprint
      }),
      keepalive: true
    });
  }).catch(() => {});
}

// ---------- anything unhandled becomes a 500 page, details stay in the console ----------
let lastCrash = 0;
function crash(e) {
  sendMurmurError('crash', e);
  const now = Date.now();
  if (now - lastCrash < 5000) return;
  lastCrash = now;
  if (state.loggedIn || authEl.hidden === false) showStatusPage(500);
}
window.addEventListener('error', ev => {
  if (ev.target === window) {
    sendMurmurError('crash', ev.error || ev.message, { source: ev.filename, line: ev.lineno, column: ev.colno });
    crash(ev.error || ev.message);
  } else {
    const target = ev.target;
    sendMurmurError('resource', 'A page resource failed to load.', { source: target && (target.src || target.href) });
  }
}, true);
window.addEventListener('unhandledrejection', ev => {
  const code = ev.reason && ev.reason.code || '';
  if (/^(auth|permission|PERMISSION)/.test(code)) return; // handled elsewhere with friendly messages
  sendMurmurError('crash', ev.reason);
  crash(ev.reason);
});


// ---------- controlled automatic error-log test ----------
// Open the app with ?murmur-error-test=1 while signed in.
// This emits one clearly labelled synthetic error through the real global error handler.
if (new URLSearchParams(location.search).get('murmur-error-test') === '1') {
  let stopTestAuthWatch = null;
  stopTestAuthWatch = auth.onAuthStateChanged(user => {
    if (!user) return;
    if (stopTestAuthWatch) stopTestAuthWatch();
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('murmur-error-test');
    history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    setTimeout(() => {
      const testError = new Error('MURMUR_AUTOMATIC_ERROR_TEST: diagnostic test event');
      window.dispatchEvent(new ErrorEvent('error', {
        message: testError.message,
        error: testError,
        filename: 'murmur://diagnostics/automatic-error-test',
        lineno: 1,
        colno: 1
      }));
    }, 1000);
  });
}


// ---- while a chat is open: lock the page behind it so nothing moves ----
(function () {
  const layout = document.querySelector('.chat-layout');
  if (!layout) return;
  function sync() {
    const pane = layout.closest('.pane');
    const open = layout.classList.contains('open') && (!pane || pane.classList.contains('active')) && window.matchMedia('(max-width: 780px)').matches;
    document.body.classList.toggle('chat-open', open);
    if (open) { window.scrollTo(0, 0); const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight; }
  }
  const mo = new MutationObserver(sync);
  mo.observe(layout, { attributes: true, attributeFilter: ['class'] });
  if (layout.closest('.pane')) mo.observe(layout.closest('.pane'), { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => { if (document.body.classList.contains('chat-open')) { const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight; } });
  window.addEventListener('hashchange', sync);
})();

const SPLASH_MS = 1100;   // how long the splash screen shows
/* what happens right after the splash screen: open the app (with its skeleton) or the log in screen */
async function finishStartup() {
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 500);
  if (state.loggedIn || auth.currentUser) { showAppSkeleton(); showApp(); }
  else {
    showAuth();
    if (location.hash === '#create-account') openRegisterWizard();
    else if (location.hash === '#forgot-password') openForgotPassword();
  }
  if (LEGAL_HASHES[location.hash]) openLegal(LEGAL_HASHES[location.hash], true);
  guardRoute();
  maybeShowCookieNotice();
}
setTimeout(finishStartup, SPLASH_MS);
  
