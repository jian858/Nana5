/* Murmur profile editor.
 * Saves private account fields under users/{uid} and only public profile fields
 * under profiles/{uid}. Email comes from Firebase Authentication and is read-only.
 */
let profileEditOverlay = null;

async function openEditProfile() {
  const uid = meUid();
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    showToast('Sign in to edit your profile.');
    return;
  }
  if (profileEditOverlay) return;
  let data = profileData && profileUid === uid ? { ...profileData } : {};
  try {
    const snap = await get(ref(db, 'users/' + uid));
    if (snap.exists()) data = { ...snap.val(), ...data };
  } catch (error) {
    showToast(friendlyError(error, 'Could not load your profile.'));
    return;
  }

  const overlay = document.createElement('div');
  profileEditOverlay = overlay;
  overlay.className = 'profile-edit-back';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'profileEditTitle');
  const val = key => esc(data[key] || '');
  const interests = Array.isArray(data.interests) ? data.interests.join(', ') : Object.values(data.interests || {}).join(', ');
  overlay.innerHTML = `
    <section class="profile-edit-card">
      <div class="profile-edit-head">
        <div><small style="color:var(--acc-strong);font-weight:800;letter-spacing:.08em">YOUR ACCOUNT</small><h2 id="profileEditTitle">Edit profile</h2></div>
        <button type="button" class="close-btn" data-edit-close aria-label="Close">×</button>
      </div>
      <form data-profile-edit-form>
        <div class="profile-edit-grid">
          <label class="field full"><span>Name</span><input name="name" maxlength="70" required value="${val('name')}" autocomplete="name"></label>
          <label class="field"><span>Username</span><input name="username" maxlength="21" required value="${val('username')}" autocomplete="username"></label>
          <label class="field"><span>Email address</span><input type="email" value="${esc(auth.currentUser.email || data.email || '')}" readonly disabled></label>
          <label class="field full"><span>Bio</span><textarea name="bio" maxlength="240">${val('bio')}</textarea></label>
          <label class="field"><span>School</span><input name="school" maxlength="100" value="${val('school')}"></label>
          <label class="field"><span>Location</span><input name="location" maxlength="100" value="${val('location')}"></label>
          <label class="field"><span>Work</span><input name="work" maxlength="100" value="${val('work')}"></label>
          <label class="field"><span>Role / position</span><input name="role" maxlength="80" value="${val('role')}"></label>
          <label class="field"><span>Hometown</span><input name="hometown" maxlength="100" value="${val('hometown')}"></label>
          <label class="field"><span>Phone</span><input name="phone" type="tel" maxlength="30" value="${val('phone')}"></label>
          <label class="field"><span>Birthday</span><input name="birthday" type="date" value="${val('birthday')}"></label>
          <label class="field"><span>Gender</span><select name="gender"><option value="">Prefer not to say</option><option ${data.gender === 'Female' ? 'selected' : ''}>Female</option><option ${data.gender === 'Male' ? 'selected' : ''}>Male</option><option ${data.gender === 'Non-binary' ? 'selected' : ''}>Non-binary</option><option ${data.gender === 'Other' ? 'selected' : ''}>Other</option></select></label>
          <label class="field full"><span>Interests (separate with commas)</span><input name="interests" maxlength="300" value="${esc(interests)}"></label>
          <label class="field"><span>Profile photo</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
          <label class="field"><span>Cover photo</span><input name="cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
        </div>
        <div class="profile-edit-error" data-profile-edit-error role="alert"></div>
        <div class="profile-edit-actions"><button type="button" class="btn ghost" data-edit-cancel>Cancel</button><button type="submit" class="btn primary" data-edit-save>Save changes</button></div>
      </form>
    </section>`;
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); profileEditOverlay = null; };
  overlay.querySelector('[data-edit-close]').addEventListener('click', close);
  overlay.querySelector('[data-edit-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  overlay.querySelector('[data-profile-edit-form]').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const save = form.querySelector('[data-edit-save]');
    const errorBox = form.querySelector('[data-profile-edit-error]');
    const name = form.elements.name.value.trim();
    let username = form.elements.username.value.trim().replace(/^@?/, '@');
    if (!name) { errorBox.textContent = 'Enter your name.'; return; }
    if (!/^@[A-Za-z0-9._-]{3,20}$/.test(username)) { errorBox.textContent = 'Username must be 3–20 letters, numbers, dots, dashes or underscores.'; return; }
    const duplicate = Object.entries(state.users || {}).some(([key, person]) => key !== 'me' && key !== uid && String(person.username || '').toLowerCase() === username.toLowerCase());
    if (duplicate && username.toLowerCase() !== String(data.username || '').toLowerCase()) { errorBox.textContent = 'That username is already in use.'; return; }

    const photoFile = form.elements.photo.files[0];
    const coverFile = form.elements.cover.files[0];
    const validImage = file => !file || (['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) && file.size <= 5 * 1024 * 1024);
    if (!validImage(photoFile) || !validImage(coverFile)) { errorBox.textContent = 'Choose JPG, PNG, WebP or GIF images smaller than 5 MB.'; return; }

    save.disabled = true;
    save.textContent = 'Saving…';
    errorBox.textContent = '';
    try {
      let photo = data.photo || data.profilePhoto || '';
      let cover = data.cover || data.coverPhoto || '';
      if (photoFile) photo = await fileToDataUrl(photoFile, 160, 160);
      if (coverFile) cover = await fileToDataUrl(coverFile, 900, 360);
      const interests = form.elements.interests.value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 20);
      const updates = {
        name,
        username,
        email: auth.currentUser.email || data.email || '',
        bio: form.elements.bio.value.trim(),
        school: form.elements.school.value.trim(),
        location: form.elements.location.value.trim(),
        work: form.elements.work.value.trim(),
        role: form.elements.role.value.trim(),
        hometown: form.elements.hometown.value.trim(),
        phone: form.elements.phone.value.trim(),
        birthday: form.elements.birthday.value,
        gender: form.elements.gender.value,
        interests,
        photo,
        profilePhoto: photo,
        cover,
        coverPhoto: cover
      };
      const publicProfile = {
        uid,
        name,
        username,
        usernameLower: username.toLowerCase(),
        bio: updates.bio,
        school: updates.school,
        location: updates.location,
        work: updates.work,
        role: updates.role,
        hometown: updates.hometown,
        interests,
        photo,
        cover,
        createdAt: data.createdAt || ''
      };
      await update(ref(db), {
        ['users/' + uid + '/name']: updates.name,
        ['users/' + uid + '/username']: updates.username,
        ['users/' + uid + '/email']: updates.email,
        ['users/' + uid + '/bio']: updates.bio,
        ['users/' + uid + '/school']: updates.school,
        ['users/' + uid + '/location']: updates.location,
        ['users/' + uid + '/work']: updates.work,
        ['users/' + uid + '/role']: updates.role,
        ['users/' + uid + '/hometown']: updates.hometown,
        ['users/' + uid + '/phone']: updates.phone,
        ['users/' + uid + '/birthday']: updates.birthday,
        ['users/' + uid + '/gender']: updates.gender,
        ['users/' + uid + '/interests']: interests,
        ['users/' + uid + '/photo']: photo,
        ['users/' + uid + '/profilePhoto']: photo,
        ['users/' + uid + '/cover']: cover,
        ['users/' + uid + '/coverPhoto']: cover,
        ['profiles/' + uid]: publicProfile
      });
      profileData = { ...data, ...updates };
      state.currentUser = { ...state.currentUser, name, username, email: updates.email, photo };
      state.users.me = { ...state.currentUser };
      saveState();
      if (typeof applyOwnPhoto === 'function') applyOwnPhoto();
      if (profileOverlay && profileUid === uid) paintProfile();
      await syncMurmurSupabaseIdentity(auth.currentUser, { name, username });
      close();
      showToast('Your profile has been updated.');
    } catch (error) {
      console.error('Profile update failed:', error);
      errorBox.textContent = friendlyError(error, 'Could not save your profile. Check your connection and try again.');
      save.disabled = false;
      save.textContent = 'Save changes';
    }
  });
  overlay.querySelector('[name="name"]').focus();
}
