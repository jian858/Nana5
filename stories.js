/* ---------- Stories (photos, 24 hours) ---------- */
let storySubs = {}, storiesData = {}, storyTimer = null;
const STORY_BGS = ['linear-gradient(160deg,#1877f2,#6a5cff)', 'linear-gradient(160deg,#f5576c,#f093fb)', 'linear-gradient(160deg,#11998e,#38ef7d)', 'linear-gradient(160deg,#f7971e,#ffd200)', 'linear-gradient(160deg,#232526,#414345)', 'linear-gradient(160deg,#ee0979,#ff6a00)'];
const STORY_MS = 864e5;   // a story lives 24 hours, then it is deleted
const dropStory = (uid, id) => { try { Promise.resolve(remove(ref(db, `stories/${uid}/${id}`))).catch(() => {}); } catch {} };
function pruneStories() {
  const cut = Date.now() - STORY_MS; let changed = false;
  Object.entries(storiesData).forEach(([uid, list]) => {
    const keep = list.filter(x => (x.createdAt || Date.now()) > cut);
    if (keep.length !== list.length) { list.filter(x => !keep.includes(x)).forEach(x => dropStory(uid, x.id)); storiesData[uid] = keep; changed = true; }
  });
  if (changed) renderStories();
}
setInterval(pruneStories, 60000);
const storyFile = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.appendChild(storyFile);
function watchStories(uid) {
  if (storySubs[uid]) return;
  storySubs[uid] = onValue(ref(db, 'stories/' + uid), snap => {
    const all = Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v })), cut = Date.now() - STORY_MS;
    all.filter(x => (x.createdAt || Date.now()) <= cut).forEach(x => dropStory(uid, x.id));
    storiesData[uid] = all.filter(x => (x.createdAt || Date.now()) > cut).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now()));
    renderStories();
  }, () => {});
}
function renderStories() {
  const row = document.getElementById('storiesRow'), me = meUid();
  if (!row) return;
  if (!me) { row.innerHTML = ''; return; }
  [me, ...friendsOf().map(d => d.uid)].forEach(watchStories);
  const card = (uid, name, label) => {
    const list = storiesData[uid] || []; if (!list.length) return '';
    const st = list[list.length - 1], pic = !!st.photo;
    const bg = pic ? (okImg(st.photo) ? `background-image:url('${st.photo}')` : '') : `background:${STORY_BGS[st.bg] || STORY_BGS[0]}`;
    if (!bg) return '';
    return `<button type="button" class="story${pic ? '' : ' txt'}" data-story-view="${esc(uid)}" style="${bg}"><span class="story-av">${avatarHtml(uid, name)}</span>${pic ? '' : `<em>${esc((st.text || '').slice(0, 60))}</em>`}<b>${esc(label)}</b></button>`;
  };
  row.innerHTML = '<button type="button" class="story add" data-story-add><span>＋</span><b>Add story</b></button>' + card(me, state.currentUser?.name || '', 'Your story') + friendsOf().map(d => card(d.uid, d.name, d.name.split(' ')[0])).join('');
}
function viewStory(uid) {
  const list = storiesData[uid] || []; if (!list.length) return;
  let i = 0;
  const el = document.createElement('div');
  el.className = 'story-view';
  document.body.appendChild(el);
  const close = () => { clearTimeout(storyTimer); el.remove(); };
  const show = () => {
    clearTimeout(storyTimer);
    if (i >= list.length) return close();
    const st = list[i], mine = uid === meUid(), name = mine ? 'Your story' : (friendsOf().find(d => d.uid === uid) || {}).name || '';
    if (!mine && meUid()) set(ref(db, `stories/${uid}/${st.id}/views/${meUid()}`), serverTimestamp()).catch(() => {});
    const viewerCount = Object.keys(st.views || {}).length;
    el.innerHTML = `<div class="story-bars">${list.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><div class="story-top"><strong>${esc(name)}</strong><span>${timeAgo(st.createdAt)}${mine ? ' · ' + Math.max(1, Math.ceil((st.createdAt + STORY_MS - Date.now()) / 36e5)) + 'h left' : ''}</span>${mine ? `<button type="button" data-story-viewers>Viewed by ${viewerCount}</button><button type="button" data-sdel>Delete</button>` : ''}<button type="button" data-sclose aria-label="Close">×</button></div>${st.photo ? `<img alt="" src="${okImg(st.photo) ? st.photo : ''}" />` : `<div class="story-text" style="background:${STORY_BGS[st.bg] || STORY_BGS[0]}"><p>${esc(st.text || '')}</p></div>`}${!mine ? '<div class="story-reactions" aria-label="Send a story reaction"><button type="button" data-story-emoji="❤️" aria-label="Send heart">❤️</button><button type="button" data-story-emoji="😂" aria-label="Send laughing face">😂</button><button type="button" data-story-emoji="😮" aria-label="Send surprised face">😮</button><button type="button" data-story-emoji="🔥" aria-label="Send fire">🔥</button><button type="button" data-story-emoji="👏" aria-label="Send clapping hands">👏</button></div>' : ''}<button class="story-prev" type="button" aria-label="Previous"></button><button class="story-next" type="button" aria-label="Next"></button>`;
    el.querySelector('[data-sclose]').onclick = close;
    const viewersBtn = el.querySelector('[data-story-viewers]');
    if (viewersBtn) viewersBtn.onclick = async () => {
      try {
        const snap = await get(ref(db, `stories/${uid}/${st.id}/views`));
        const viewers = Object.keys(snap.val() || {});
        if (!viewers.length) { showToast('No views yet.'); return; }
        const names = await Promise.all(viewers.map(async viewerUid => {
          if (viewerUid === meUid()) return state.currentUser?.name || 'You';
          const profile = await get(ref(db, 'profiles/' + viewerUid));
          return profile.val()?.name || 'Murmur member';
        }));
        const panel = document.createElement('div'); panel.className = 'modal-back top';
        panel.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Story viewers (${names.length})</h3><div class="saved-post-list">${names.map(n => `<p>${esc(n)}</p>`).join('')}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
        document.body.appendChild(panel); panel.querySelector('[data-close]').onclick = () => panel.remove();
      } catch (error) { showToast(friendlyError(error, 'Could not load viewers.')); }
    };
    el.querySelectorAll('[data-story-emoji]').forEach(button => {
      button.onclick = async event => {
        event.preventDefault(); event.stopPropagation();
        const reactorUid = meUid(), emoji = button.dataset.storyEmoji;
        if (!reactorUid || !uid || !st.id || reactorUid === uid) return;
        button.disabled = true;
        try {
          const fromName = state.currentUser?.name || 'A friend';
          await set(ref(db, `notifications/${uid}/story_${st.id}_${reactorUid}`), {
            type: 'story_reaction', storyId: st.id, from: reactorUid, fromName,
            emoji, text: `${fromName} reacted ${emoji} to your story`,
            createdAt: serverTimestamp(), read: false
          });
          showToast(`Sent ${emoji} to ${name}'s story.`);
        } catch (error) {
          showToast(friendlyError(error, 'Could not send your reaction.'));
          button.disabled = false;
        }
      };
    });
    el.querySelector('.story-next').onclick = () => { i++; show(); };
    el.querySelector('.story-prev').onclick = () => { i = Math.max(0, i - 1); show(); };
    const del = el.querySelector('[data-sdel]');
    if (del) del.onclick = async () => { try { await remove(ref(db, `stories/${uid}/${st.id}`)); showToast('Story deleted.'); } catch (e) { showToast(friendlyError(e, 'Could not delete.')); } close(); };
    storyTimer = setTimeout(() => { i++; show(); }, 5000);
  };
  show();
}
let storyOverlay = null;
function closeStoryMaker(fromHash) {
  if (!storyOverlay) return;
  storyOverlay.remove(); storyOverlay = null;
  if (!fromHash && location.hash === '#new-story') history.back();
}
function openCreateStory() {
  if (storyOverlay || !meUid()) return;
  if (location.hash !== '#new-story') history.pushState(null, '', '#new-story');
  let bg = 0;
  const el = document.createElement('div');
  storyOverlay = el;
  el.className = 'cs-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Create story');
  el.style.background = STORY_BGS[0];
  el.innerHTML = `
    <div class="cs-top"><button type="button" class="cs-x" data-cs-close aria-label="Close">×</button><strong>Create story</strong><button type="button" class="cs-share" data-cs-share disabled>Share</button></div>
    <div class="cs-mid"><textarea class="cs-text" maxlength="120" placeholder="Start typing" aria-label="Story text"></textarea></div>
    <div class="cs-bottom">
      <div class="cs-swatches">${STORY_BGS.map((g, i) => `<button type="button" class="cs-sw${i === 0 ? ' on' : ''}" data-cs-bg="${i}" style="background:${g}" aria-label="Background ${i + 1}"></button>`).join('')}</div>
      <button type="button" class="cs-photo" data-cs-photo>${ic('image')}Add a photo instead</button>
      <p class="cs-note">Your story disappears after 24 hours.</p>
    </div>`;
  document.body.appendChild(el);
  const ta = el.querySelector('.cs-text'), share = el.querySelector('[data-cs-share]');
  ta.addEventListener('input', () => { share.disabled = !ta.value.trim(); });
  el.addEventListener('click', e => {
    const sw = e.target.closest('[data-cs-bg]');
    if (sw) { bg = +sw.dataset.csBg; el.style.background = STORY_BGS[bg]; el.querySelectorAll('.cs-sw').forEach(b => b.classList.toggle('on', b === sw)); }
  });
  el.querySelector('[data-cs-close]').onclick = () => closeStoryMaker(false);
  el.querySelector('[data-cs-photo]').onclick = () => { closeStoryMaker(false); storyFile.click(); };
  el.addEventListener('keydown', e => { if (e.key === 'Escape') closeStoryMaker(false); });
  share.onclick = async () => {
    const text = cleanText(ta.value, 120); if (!text) return;
    share.disabled = true;
    try {
      await push(ref(db, 'stories/' + meUid()), { text, bg, createdAt: serverTimestamp() });
      showToast('Story added. It disappears after 24 hours.');
      closeStoryMaker(false);
    } catch (err) { showToast(friendlyError(err, 'Could not add your story.')); share.disabled = false; }
  };
  setTimeout(() => ta.focus(), 60);
}
storyFile.addEventListener('change', async () => {
  const f = storyFile.files[0]; storyFile.value = ''; if (!f || !meUid()) return;
  showToast('Uploading your story…');
  try {
    const photo = await fileToDataUrl(f, 360, 640);
    await push(ref(db, 'stories/' + meUid()), { photo, createdAt: serverTimestamp() });
    showToast('Story added. Friends can see it for 24 hours.');
  } catch (e) { showToast(friendlyError(e, 'Could not add your story.')); }
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-story-add]')) { openCreateStory(); return; }
  const v = e.target.closest('[data-story-view]'); if (v) viewStory(v.dataset.storyView);
});
const timeAgo = t => { if (!t || typeof t !== 'number') return ''; const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd'; };

