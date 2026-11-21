
/* =====================================================================
   APP  -  the app logic. Jump to a part by searching its CAPITAL title:
   APP STATE, SMALL HELPERS, HOME FEED, FRIENDS, CHAT, ALERTS, ONLINE STATUS,
   LOG IN, CREATE ACCOUNT, FORGOT PASSWORD, LEGAL PAGES, BLOCK PEOPLE,
   SECURITY + SAFETY, SENDING
   Numbers and wording live in SETTINGS above.
   ===================================================================== */
const monitoredFirebaseMethods = new Set([
  'createUserWithEmailAndPassword','signInWithEmailAndPassword','signInWithPopup','sendPasswordResetEmail',
  'reauthenticateWithCredential','verifyBeforeUpdateEmail','deleteUser','signOut','set','get','push','update','remove',
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
const { initializeApp, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, reauthenticateWithCredential, verifyBeforeUpdateEmail, EmailAuthProvider, deleteUser, signOut, onAuthStateChanged, getDatabase, ref, set, get, push, update, remove, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp, getStorage, storageRef, uploadBytesResumable, getDownloadURL, deleteObject } = monitoredFirebase;

const firebaseConfig = window.MURMUR_FIREBASE;   // edit in SETTINGS


const CONFIG = window.MURMUR_CONFIG;             // edit in SETTINGS

document.documentElement.style.setProperty('--chat-ms', CONFIG.chatAnimMs);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
window.MurmurErrorTokenProvider = () => auth.currentUser ? auth.currentUser.getIdToken().catch(() => "") : "";
const db = getDatabase(app);

// Firebase remains the login provider. Supabase independently creates and stores its own UUID.
const MURMUR_SUPABASE_URL = 'https://pkadftvqslkykehcqedj.supabase.co';
const MURMUR_SUPABASE_KEY = 'sb_publishable_etoHiUGbJ96MUPzJABL12A_UiTWVxok';
const MURMUR_IDENTITY_URL = MURMUR_SUPABASE_URL + '/functions/v1/murmur-identity';
const MURMUR_POSTS_URL = MURMUR_SUPABASE_URL + '/functions/v1/murmur-posts';
window.MURMUR_IDS = window.MURMUR_IDS || { firebaseUid: null, supabaseId: null, status: 'not-signed-in' };
function getMurmurDeviceToken() {
  try {
    const key = 'murmur_visitor_id_v1';
    let id = localStorage.getItem(key);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch { return null; }
}
async function syncMurmurSupabaseIdentity(user, profile = {}) {
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
      body: JSON.stringify({ username: profile.username || '', displayName: profile.name || profile.displayName || '', visitorId: getMurmurDeviceToken() })
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


async function murmurPostsRequest(action, payload = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to use posts.');
  const token = await user.getIdToken();
  const response = await fetch(MURMUR_POSTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'apikey': MURMUR_SUPABASE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Post service failed (' + response.status + ').');
  return result;
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
let supabasePosts = [], legacyPosts = [], supabasePostsTimer = null;

function startPostsListener() {
  if (unsubPosts) return;
  feedLoading = true;
  renderPosts();
  loadSupabasePosts().catch(error => console.warn('Supabase posts unavailable:', error.message));
  if (!supabasePostsTimer) supabasePostsTimer = setInterval(() => {
    loadSupabasePosts().catch(error => console.warn('Supabase post refresh failed:', error.message));
  }, 300000);
  const q = query(ref(db, 'posts'), orderByChild('createdAt'), limitToLast(50));
  unsubPosts = onValue(q, snap => {
    feedLoading = false;
    hideAppSkeleton();
    const v = snap.val() || {};
    Object.values(v).forEach(p => watchPhoto(p.authorUid));
    legacyPosts = Object.entries(v).map(([id, p]) => ({ id, ...p, source: 'firebase' }));
    mergeRemotePosts();
  }, err => {
    console.warn('Legacy Firebase posts unavailable:', err);
    legacyPosts = [];
    feedLoading = false;
    hideAppSkeleton();
    mergeRemotePosts();
  });
}
function stopPostsListener() {
  if (unsubPosts) unsubPosts();
  unsubPosts = null;
  if (supabasePostsTimer) clearInterval(supabasePostsTimer);
  supabasePostsTimer = null;
  remotePosts = null;
  supabasePosts = [];
  legacyPosts = [];
}

