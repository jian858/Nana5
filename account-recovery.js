/* =====================================================================
   SUPABASE PASSWORD RECOVERY
   Supabase redirects recovery links to the app root with a recovery token
   in the URL fragment. Keep this flow separate from Firebase sign-in.
   ===================================================================== */
let murmurRecoveryMode = false;
function startMurmurPasswordRecovery() {
  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const recoveryType = params.get('type');
  const accessToken = params.get('access_token');
  const recoveryError = params.get('error_description') || params.get('error');
  if (recoveryType !== 'recovery' && !recoveryError) return false;

  murmurRecoveryMode = true;
  // Remove credentials from the visible URL and browser history immediately.
  history.replaceState(null, '', location.pathname + location.search);
  authEl.hidden = true;
  appEl.hidden = true;
  document.getElementById('splash')?.setAttribute('hidden', '');
  document.querySelectorAll('.murmur-recovery-screen').forEach(node => node.remove());

  const screen = document.createElement('main');
  screen.className = 'murmur-recovery-screen';
  screen.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--page,#f4f7fb);box-sizing:border-box;font-family:inherit;color:var(--text,#172033)';
  screen.innerHTML = `
    <section style="width:min(100%,440px);background:var(--card,#fff);padding:28px;border-radius:18px;box-shadow:0 12px 40px rgba(20,35,60,.12);box-sizing:border-box">
      <div style="font-size:1.5rem;font-weight:800;margin-bottom:8px">Murmur</div>
      <h1 style="font-size:1.35rem;margin:0 0 8px">Create a new password</h1>
      <p data-recovery-message style="color:var(--muted,#64748b);line-height:1.5;margin:0 0 20px"></p>
      <form data-recovery-form>
        <label style="display:block;font-weight:650;margin:12px 0 6px" for="murmur-new-password">New password</label>
        <input id="murmur-new-password" type="password" autocomplete="new-password" minlength="8" required style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5e1;border-radius:9px;font:inherit">
        <label style="display:block;font-weight:650;margin:14px 0 6px" for="murmur-confirm-password">Confirm new password</label>
        <input id="murmur-confirm-password" type="password" autocomplete="new-password" minlength="8" required style="width:100%;box-sizing:border-box;padding:13px;border:1px solid #cbd5e1;border-radius:9px;font:inherit">
        <div data-recovery-error role="alert" style="color:#b42318;margin:12px 0"></div>
        <button type="submit" data-recovery-submit style="width:100%;padding:14px;border:0;border-radius:9px;background:#14a88a;color:#fff;font:inherit;font-weight:750;margin-top:8px">Save new password</button>
      </form>
      <a href="/" data-recovery-home style="display:block;text-align:center;margin-top:18px;color:inherit">Return to Murmur login</a>
    </section>`;
  document.body.appendChild(screen);

  const message = screen.querySelector('[data-recovery-message]');
  const form = screen.querySelector('[data-recovery-form]');
  const errorBox = screen.querySelector('[data-recovery-error]');
  const submit = screen.querySelector('[data-recovery-submit]');
  if (recoveryError || !accessToken || recoveryType !== 'recovery') {
    form.hidden = true;
    message.textContent = recoveryError
      ? 'This password reset link is invalid or has expired. Return to Murmur and request a new link.'
      : 'This password reset link is incomplete. Return to Murmur and request a new link.';
    return true;
  }
  message.textContent = 'Choose a new password for your Murmur Supabase account. Use at least 8 characters.';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.textContent = '';
    const password = screen.querySelector('#murmur-new-password').value;
    const confirm = screen.querySelector('#murmur-confirm-password').value;
    if (password.length < 8) { errorBox.textContent = 'Your password must contain at least 8 characters.'; return; }
    if (password !== confirm) { errorBox.textContent = 'The passwords do not match.'; return; }
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      const response = await fetch(MURMUR_SUPABASE_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: {
          'apikey': MURMUR_SUPABASE_KEY,
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'The password could not be updated. Request a new reset link and try again.');
      form.hidden = true;
      message.textContent = 'Your Supabase account password has been updated. Return to Murmur and sign in.';
      submit.textContent = 'Password updated';
    } catch (error) {
      errorBox.textContent = error.message || 'The password could not be updated. Please request a new link.';
      submit.disabled = false;
      submit.textContent = 'Save new password';
    }
  });
  return true;
}
const murmurRecoveryStarted = startMurmurPasswordRecovery();

onAuthStateChanged(auth, async (user) => {
  if (murmurRecoveryMode) return;
  startMurmurAuthSessionChecks(user);
  // Finish the Firebase-to-Supabase identity handshake before starting data listeners.
  // The helper handles failures internally, so Firebase sign-in remains available during migration.
  if (user) {
    // Fail closed for a revoked Firebase session: do not initialize the Murmur
    // identity or open account data until Firebase accepts a forced token refresh.
    const sessionValid = await checkMurmurAuthSession(user);
    if (sessionValid === false) return;
  }
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
    // Read the account creation time before starting notification listeners.
    try {
      const accountSnap = await get(ref(db, 'users/' + user.uid));
      const accountProfile = accountSnap.val() || {};
      accountCreatedAt = alertTime(accountProfile.createdAt || accountProfile.accountCreatedAt) || accountCreatedAt || 0;
      if (accountSnap.exists()) {
        let accountUsername = String(accountProfile.username || '').trim();
        if (!/^@[A-Za-z0-9._-]{3,20}$/.test(accountUsername)) {
          accountUsername = '@user' + user.uid.slice(0, 8).toLowerCase();
          await update(ref(db, 'users/' + user.uid), { username: accountUsername });
          accountProfile.username = accountUsername;
        }
        await syncMurmurSupabaseIdentity(user, {
          username: accountUsername,
          name: accountProfile.name || user.displayName || 'Murmur User'
        });
      }
    } catch (accountError) { console.warn('Could not load account creation time:', accountError); }
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
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


