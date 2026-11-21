/* Google sign-up/sign-in for Murmur.
 * Firebase remains the source of authentication; Supabase identity is synced
 * through the existing verified Firebase-token Edge Function.
 */
const googleCreateButton = document.getElementById('googleCreateBtn');

function murmurGoogleUsername(user) {
  const base = String(user.displayName || 'member')
    .normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10) || 'member';
  return '@' + base + user.uid.slice(0, 6).toLowerCase();
}

async function continueWithGoogle() {
  if (!googleCreateButton || googleCreateButton.disabled) return;
  const originalText = googleCreateButton.innerHTML;
  googleCreateButton.disabled = true;
  googleCreateButton.setAttribute('aria-busy', 'true');
  googleCreateButton.textContent = 'Connecting to Google…';
  authError.textContent = '';
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(auth, provider);
    const user = credential.user;
    if (!user || !user.uid || !user.email) throw new Error('Google did not return a verified email address.');

    const restriction = await getAccountRestriction(user.uid);
    if (restriction) {
      suspendedInfo = restriction;
      state.loggedIn = false;
      appEl.hidden = true;
      renderSuspended();
      return;
    }

    const userRef = ref(db, 'users/' + user.uid);
    const snapshot = await get(userRef);
    const existing = snapshot.exists() ? snapshot.val() || {} : {};
    const displayName = String(existing.name || user.displayName || 'Murmur User').trim();
    const profile = {
      ...existing,
      uid: user.uid,
      name: displayName,
      firstName: existing.firstName || displayName.split(/\s+/)[0] || '',
      lastName: existing.lastName || displayName.split(/\s+/).slice(1).join(' '),
      email: user.email,
      username: existing.username || murmurGoogleUsername(user),
      photo: existing.photo || user.photoURL || '',
      profilePhoto: existing.profilePhoto || existing.photo || user.photoURL || '',
      createdAt: existing.createdAt || new Date().toISOString(),
      authProvider: 'google'
    };

    if (!snapshot.exists()) {
      await set(userRef, profile);
    } else {
      await update(userRef, {
        name: profile.name,
        email: profile.email,
        username: profile.username,
        photo: profile.photo,
        profilePhoto: profile.profilePhoto,
        authProvider: 'google'
      });
    }

    await ensureProfile(user);
    await syncMurmurSupabaseIdentity(user, profile);
    state.loggedIn = true;
    state.currentUser = {
      uid: user.uid,
      name: profile.name,
      email: profile.email,
      username: profile.username,
      photo: profile.photo
    };
    state.users.me = { ...state.currentUser };
    state.activeView = 'home';
    saveState();
    showApp();
    showToast(snapshot.exists() ? 'Signed in with Google.' : 'Your Google account is now registered on Murmur.');
  } catch (error) {
    console.error('Google sign-in failed:', error && error.code);
    if (error && error.code === 'auth/popup-closed-by-user') {
      authError.textContent = 'Google sign-in was closed before it finished.';
    } else if (error && error.code === 'auth/unauthorized-domain') {
      authError.textContent = 'This website is not authorized for Google sign-in. Add the Murmur domain in Firebase Authentication settings.';
    } else if (error && error.code === 'auth/operation-not-allowed') {
      authError.textContent = 'Google sign-in is not enabled yet. Enable Google in Firebase Authentication providers.';
    } else {
      authError.textContent = friendlyError(error, 'Could not create or sign in with your Google account.');
    }
  } finally {
    googleCreateButton.disabled = false;
    googleCreateButton.removeAttribute('aria-busy');
    googleCreateButton.innerHTML = originalText;
  }
}

googleCreateButton?.addEventListener('click', continueWithGoogle);
