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

