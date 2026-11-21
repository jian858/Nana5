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

