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

const MURMUR_LOGIN_LOCK = {
  maxAttempts: 5,
  supportEmail: 'jiancarlopadua9@gmail.com'
};
function murmurLoginLockKey(email) {
  return 'murmur_login_lock_' + String(email || '').trim().toLowerCase();
}
function getMurmurLoginLock(email) {
  try {
    const saved = JSON.parse(localStorage.getItem(murmurLoginLockKey(email)) || 'null');
    return saved && typeof saved === 'object' ? saved : { fails: 0, locked: false };
  } catch {
    return { fails: 0, locked: false };
  }
}
function setMurmurLoginLock(email, value) {
  try { localStorage.setItem(murmurLoginLockKey(email), JSON.stringify(value)); } catch {}
}
function clearMurmurLoginLock(email) {
  try { localStorage.removeItem(murmurLoginLockKey(email)); } catch {}
}
function isLockedOut(fails) {
  return Number(fails) >= MURMUR_LOGIN_LOCK.maxAttempts;
}
function showMurmurLoginLockMessage() {
  authError.textContent = '';
  const message = document.createElement('span');
  message.textContent = 'This sign-in is locked after 5 incorrect attempts. Contact customer service at ';
  const link = document.createElement('a');
  link.href = 'mailto:' + MURMUR_LOGIN_LOCK.supportEmail;
  link.textContent = MURMUR_LOGIN_LOCK.supportEmail;
  link.rel = 'noopener';
  const ending = document.createTextNode(' to request help unlocking your sign-in.');
  authError.append(message, link, ending);
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
  const accountLock = getMurmurLoginLock(normalized);
  if (accountLock.locked || isLockedOut(accountLock.fails)) {
    accountLock.locked = true;
    setMurmurLoginLock(normalized, accountLock);
    showMurmurLoginLockMessage();
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
    clearMurmurLoginLock(normalized);
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
    const isWrongLogin = !!(error && /invalid-credential|wrong-password|user-not-found/.test(error.code || ''));
    if (isWrongLogin) {
      const failed = getMurmurLoginLock(normalized);
      failed.fails = Math.min(MURMUR_LOGIN_LOCK.maxAttempts, (Number(failed.fails) || 0) + 1);
      failed.locked = isLockedOut(failed.fails);
      setMurmurLoginLock(normalized, failed);
      if (failed.locked) {
        showMurmurLoginLockMessage();
      } else {
        authError.textContent = `Email or password is incorrect. ${MURMUR_LOGIN_LOCK.maxAttempts - failed.fails} attempt(s) left.`;
      }
      return;
    }
    authError.textContent = friendlyError(error, 'Login failed. Please try again.');
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

