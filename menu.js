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
document.documentElement.classList.remove('murmur-lite');
try { localStorage.removeItem('murmur-lite'); } catch {}

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
    <section class="p-sec" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#e5e7eb)"><h4 style="margin:0 0 8px">Change email address</h4><p class="reel-muted" style="margin:0 0 10px">Current email: <strong data-current-email></strong></p><div class="field"><label for="changeEmailNew">New email address</label><input id="changeEmailNew" type="email" autocomplete="email" placeholder="new@example.com" /></div><div class="field"><label for="changeEmailPassword">Current password</label><input id="changeEmailPassword" type="password" autocomplete="current-password" placeholder="Enter your password to confirm" /></div><button class="btn ghost small" type="button" data-change-email>Send verification email</button><p class="reel-muted" data-email-status role="status" aria-live="polite"></p></section>
    <div class="error" role="alert" data-err></div>
    <div class="upload-status" data-up hidden><div class="splash-bar" data-upbar><i></i></div><strong data-uptext></strong></div>
    <div class="row-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save</button></div></div>`;
  document.body.appendChild(back);
  const q = sel => back.querySelector(sel), pending = {};
  PROFILE_FIELDS.forEach(k => { q(`[data-f="${k}"]`).value = d[k] || ''; });
  q('[data-current-email]').textContent = auth.currentUser?.email || 'Unavailable';
  q('[data-change-email]').onclick = async () => {
    const user = auth.currentUser;
    const nextEmail = q('#changeEmailNew').value.trim();
    const password = q('#changeEmailPassword').value;
    const status = q('[data-email-status]');
    status.textContent = '';
    q('[data-err]').textContent = '';
    if (!user) { q('[data-err]').textContent = 'Please sign in again before changing your email.'; return; }
    if (!nextEmail || !isValidEmail(nextEmail)) { q('[data-err]').textContent = 'Email is not valid. Please enter a valid email address.'; return; }
    if (nextEmail.toLowerCase() === String(user.email || '').toLowerCase()) { q('[data-err]').textContent = 'That is already your current email address.'; return; }
    if (!password) { q('[data-err]').textContent = 'Enter your current password to confirm this change.'; return; }
    const changeBtn = q('[data-change-email]');
    changeBtn.disabled = true; changeBtn.textContent = 'Sending verification…';
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      await verifyBeforeUpdateEmail(user, nextEmail, { url: 'https://murmurrr.vercel.app/', handleCodeInApp: false });
      q('#changeEmailPassword').value = '';
      status.textContent = 'Verification email sent to ' + nextEmail + '. Open that email and confirm the change. Your Murmur email will update after verification; sign in again afterward to sync your private Supabase account link.';
      changeBtn.textContent = 'Verification sent';
    } catch (error) {
      const code = String(error && error.code || '');
      const messages = {
        'auth/wrong-password': 'Your current password is incorrect.',
        'auth/invalid-credential': 'Your current password is incorrect. Please try again.',
        'auth/email-already-in-use': 'That email address is already used by another account.',
        'auth/invalid-email': 'Email is not valid. Please enter a valid email address.',
        'auth/requires-recent-login': 'Please sign in again, then try changing your email.',
        'auth/too-many-requests': 'Too many attempts. Please wait before trying again.'
      };
      q('[data-err]').textContent = messages[code] || friendlyError(error, 'Could not send the email verification. Please try again.');
      changeBtn.textContent = 'Send verification email';
    } finally { changeBtn.disabled = false; }
  };
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
  if (!uid) return null;
  if (uid === meUid()) return { uid, name: state.currentUser?.name || 'You', username: state.currentUser?.username || '' };
  const d = friendDocs.find(x => x.uid === uid) || searchResults.find(x => x.uid === uid);
  // A profile can be opened from a post, tag, or notification even when the
  // person is not in the current friends/search lists. Load their public
  // profile by UID instead of silently refusing navigation.
  return d ? { uid, name: d.name || 'Loading profile…', username: d.username || '' }
    : { uid, name: 'Loading profile…', username: '' };
}
const relationOf = uid => (friendDocs.find(x => x.uid === uid) || {}).status || 'none';

function renderProfileActions() {
  if (!profileOverlay) return;
  if (profileUid === meUid()) {
    profileOverlay.querySelector('[data-p-actions]').innerHTML = '<button class="btn primary" type="button" data-p-story>Add to story</button><button class="btn ghost" type="button" data-p-edit>Edit profile</button>';
    const n = getFriendCount(friendDocs);
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

