/* what happens when you leave a screen (kept in one place, so adding a screen means adding one line) */
function leaveView(next) {
  if (next !== 'chats' && activeChatUid) { if (location.hash === '#chat') history.replaceState(null, '', location.pathname + location.search); closeChat(); }
  if (next !== 'reels') pauseReels();
  if (next === 'friends' && typeof setFrSearch === 'function') setFrSearch(false);
  // Keep each notification unread until that specific item is opened.
}
function setView(view) {
  animateRows();
  leaveView(view);
  state.activeView = view;
  window.dispatchEvent(new CustomEvent('murmur:viewchange', { detail: { view } }));
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

