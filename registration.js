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

  let isSubmitting = false;
  async function submit() {
    if (isSubmitting) return;
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

    isSubmitting = true;
    nextButton.disabled = true;
    nextButton.setAttribute('aria-busy', 'true');
    nextButton.textContent = 'Creating account…';
    backButton.disabled = true;
    $('.close-btn').disabled = true;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      accountCreatedAt = alertTime(userProfile.createdAt) || Date.now();
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
      const identityLink = await syncMurmurSupabaseIdentity(userCredential.user, userProfile);
      try {
        await saveProfileToRealtimeDatabase(uid, userProfile);
        await ensureProfile(userCredential.user);
      } catch (profileErr) { console.warn('Profile save skipped:', profileErr); }

      // Save a durable welcome notification so it appears in the user's Notifications tab.
      try {
        const notificationId = 'system_account_created_' + uid;
        await set(ref(db, 'notifications/' + uid + '/' + notificationId), {
          type: 'system',
          title: 'Account created successfully',
          text: 'Welcome to Murmur. Your account is ready to use.',
          createdAt: Date.now(),
          read: false
        });
      } catch (notificationError) {
        console.warn('Welcome notification could not be saved:', notificationError);
      }

      state.loggedIn = true;
      state.currentUser = { name: fullName, email, username: normalizedUser, uid, ...(userProfile.photo ? { photo: userProfile.photo } : {}) };
      state.users.me = { ...state.currentUser };
      state.activeView = 'home';
      saveState();

      // Show a clear success confirmation before opening the newly created account.
      overlay.innerHTML = `
        <section class="reg-success" role="status" aria-live="polite">
          <div class="reg-success-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M10 25l9 9L38 14"/></svg>
          </div>
          <h1>You have successfully created an account</h1>
          <p>Your Murmur account is ready. Welcome to the community.</p>
          <div class="reg-success-progress"><span></span></div>
          <small>Opening your account…</small>
        </section>`;
      await new Promise(resolve => setTimeout(resolve, 1400));
      registerOverlay.remove();
      registerOverlay = null;
      document.body.style.overflow = '';
      history.replaceState(null, '', location.pathname + location.search);
      showApp();
      window.scrollTo(0, 0);
      showToast('Account created successfully. Your welcome notification is in Notifications.');
    } catch (error) {
      console.error('Create account failed:', error && error.code);
      isSubmitting = false;
      setError(friendlyError(error, 'Unable to create account.'));
      nextButton.disabled = false;
      nextButton.removeAttribute('aria-busy');
      nextButton.textContent = 'Create account';
      backButton.disabled = false;
      $('.close-btn').disabled = false;
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

