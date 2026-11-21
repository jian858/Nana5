/* =====================================================================
   REELS  -  short videos: full-screen feed, like / comment / share / save, create from a video file or link.
   Data:  reels/<id> { authorUid, authorName, username, url, path, caption, duration, createdAt, likes/<uid>, commentCount }
          saved/<uid>/<reelId> = true      comments/<reelId>/<commentId>
   Files go to Firebase Storage at reels/<uid>/<file> (rules in storage.rules).
   ===================================================================== */
let reels = [], reelsLoaded = false, unsubReels = null, unsubSaved = null, savedReels = {}, reelMuted = true, reelObs = null, reelDelArm = '';
const reelTime = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function startReelsListener(uid) {
  if (unsubReels) return;
  reelsLoaded = false;
  const done = () => { reelsLoaded = true; renderReels(); };
  unsubReels = onValue(query(ref(db, 'reels'), orderByChild('createdAt'), limitToLast(30)), s => {
    reels = Object.entries(s.val() || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    done();
  }, done);
  unsubSaved = onValue(ref(db, 'saved/' + uid), s => { savedReels = s.val() || {}; renderReels(); }, () => {});
}
function stopReelsListener() {
  [unsubReels, unsubSaved].forEach(u => u && u());
  unsubReels = unsubSaved = null; reels = []; savedReels = {}; reelsLoaded = false; pauseReels();
}
function pauseReels() { document.querySelectorAll('#reelsFeed video').forEach(v => v.pause()); }

function reelHtml(r) {
  const me = meUid(), likes = r.likes || {}, own = r.authorUid === me;
  const follow = !own && !friendDocs.some(d => d.uid === r.authorUid) ? `<button type="button" class="reel-follow" data-rfollow>Add friend</button>` : '';
  const capText = [r.caption || '', r.hashtags || ''].filter(Boolean).join(' ');
  const cap = (r.title || capText) ? `<div class="reel-caption-block">${r.title ? `<strong class="reel-title">${esc(r.title)}</strong>` : ''}${capText ? `<p class="reel-cap" data-rcap>${esc(capText)}</p>${capText.length > 60 ? '<button type="button" class="reel-more" data-rmore>more</button>' : ''}` : ''}</div>` : '';
  return `<article class="reel paused" data-rid="${esc(r.id)}">
    <video src="${esc(r.url)}" playsinline loop ${reelMuted ? 'muted' : ''} preload="none"></video>
    <button type="button" class="reel-tap" data-rtap aria-label="Play or pause"><span class="reel-play">${ic('play')}</span></button>
    <div class="reel-side">
      <button type="button" data-rlike class="${likes[me] ? 'on' : ''}" aria-label="Like">${ic('heart')}<span data-rn>${Object.keys(likes).length}</span></button>
      <button type="button" data-rcomment aria-label="Comments">${ic('comment')}<span data-rc>${r.commentCount || 0}</span></button>
      <button type="button" data-rshare aria-label="Share">${ic('share')}<span>Share</span></button>
      <button type="button" data-rsave class="${savedReels[r.id] ? 'on' : ''}" aria-label="Save">${ic('bookmark')}<span>${savedReels[r.id] ? 'Saved' : 'Save'}</span></button>
    </div>
    <div class="reel-info"><div class="reel-who">${avatarHtml(r.authorUid, r.authorName)}<b>${esc(r.authorName || 'Someone')}</b>${follow}</div>${cap}</div>
    <div class="reel-bottom"><span data-rtime>0:00</span><div class="reel-bar" data-rseek><i data-rbar></i></div>
      <button type="button" data-rmute aria-label="Sound">${ic(reelMuted ? 'mute' : 'volume')}</button>${own ? `<button type="button" data-rdel aria-label="Delete reel">${ic('trash')}</button>` : ''}</div>
  </article>`;
}
function updateReel(r) {
  const el = document.querySelector(`.reel[data-rid="${CSS.escape(r.id)}"]`); if (!el) return;
  const likes = r.likes || {}, sv = el.querySelector('[data-rsave]');
  el.querySelector('[data-rlike]').classList.toggle('on', !!likes[meUid()]);
  el.querySelector('[data-rn]').textContent = Object.keys(likes).length;
  el.querySelector('[data-rc]').textContent = r.commentCount || 0;
  sv.classList.toggle('on', !!savedReels[r.id]); sv.querySelector('span').textContent = savedReels[r.id] ? 'Saved' : 'Save';
}
function watchReels() {
  const feed = document.getElementById('reelsFeed');
  if (reelObs) reelObs.disconnect();
  reelObs = new IntersectionObserver(entries => entries.forEach(e => {
    const v = e.target.querySelector('video');
    if (e.isIntersecting && e.intersectionRatio > 0.6) { v.muted = reelMuted; v.play().catch(() => {}); } else v.pause();
  }), { root: feed, threshold: [0, 0.6, 1] });
  feed.querySelectorAll('.reel').forEach(el => {
    const v = el.querySelector('video'), time = el.querySelector('[data-rtime]'), bar = el.querySelector('[data-rbar]');
    reelObs.observe(el);
    v.addEventListener('timeupdate', () => { bar.style.width = (v.duration ? v.currentTime / v.duration * 100 : 0) + '%'; time.textContent = reelTime(v.currentTime) + ' / ' + reelTime(v.duration); });
    v.addEventListener('loadedmetadata', () => { time.textContent = '0:00 / ' + reelTime(v.duration); });
    v.addEventListener('play', () => el.classList.remove('paused'));
    v.addEventListener('pause', () => el.classList.add('paused'));
  });
}
function renderReels() {
  if (state.activeView !== 'reels') return;
  const feed = document.getElementById('reelsFeed'), head = document.querySelector('.fb-head');
  if (!feed) return;
  if (head) document.querySelector('.reels-pane').style.setProperty('--reels-top', Math.round(head.getBoundingClientRect().bottom) + 'px');
  if (!reelsLoaded) { if (feed.dataset.sig !== 'skel') { feed.innerHTML = skelReel(); feed.dataset.sig = 'skel'; } return; }
  const visibleReels = reels.filter(r => { const me=meUid(); if(r.authorUid===me||!r.audience||r.audience==='public')return true; if(r.audience==='private')return false; if(r.audience==='friends')return friendsOf().some(d=>d.uid===r.authorUid); return true; });
  if (!visibleReels.length) { feed.innerHTML = '<div class="reel-empty"><strong>No reels yet</strong><span>Be the first to share a short video.</span><button class="btn primary" type="button" data-rcreate>Create reel</button></div>'; feed.dataset.sig = 'empty'; return; }
  const sig = visibleReels.map(r => r.id).join();
  if (feed.dataset.sig !== sig) { feed.innerHTML = visibleReels.map(reelHtml).join(''); feed.dataset.sig = sig; watchReels(); }
  else visibleReels.forEach(updateReel);
}

async function shareReel(r) {
  const data = { title: 'Murmur reel', text: r.caption || 'Watch this reel on Murmur', url: location.href.split('#')[0] };
  try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); showToast('Link copied.'); } } catch {}
}
async function deleteReel(r) {
  try {
    await remove(ref(db, 'reels/' + r.id));
    if (r.path) { try { await deleteObject(storageRef(getStorage(app), r.path)); } catch {} }
    showToast('Reel deleted.');
  } catch (err) { showToast(friendlyError(err, 'Could not delete the reel.')); }
}
document.getElementById('reelsFeed').addEventListener('click', e => {
  const t = e.target, el = t.closest('.reel'), r = el && reels.find(x => x.id === el.dataset.rid), me = meUid();
  if (t.closest('[data-rcreate]')) return openReelCreate(null, true);
  if (!el || !r) return;
  const v = el.querySelector('video');
  if (t.closest('[data-rtap]')) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
  else if (t.closest('[data-rlike]')) { const rf = ref(db, 'reels/' + r.id + '/likes/' + me); ((r.likes || {})[me] ? remove(rf) : set(rf, true)).catch(err => showToast(friendlyError(err, 'Could not like this reel.'))); }
  else if (t.closest('[data-rsave]')) { const rf = ref(db, 'saved/' + me + '/' + r.id), was = savedReels[r.id]; (was ? remove(rf) : set(rf, true)).catch(() => {}); showToast(was ? 'Removed from saved.' : 'Saved.'); }
  else if (t.closest('[data-rshare]')) shareReel(r);
  else if (t.closest('[data-rcomment]')) openReelComments(r);
  else if (t.closest('[data-rmute]')) {
    reelMuted = !reelMuted;
    document.querySelectorAll('#reelsFeed video').forEach(x => { x.muted = reelMuted; });
    document.querySelectorAll('[data-rmute]').forEach(b => { b.innerHTML = ic(reelMuted ? 'mute' : 'volume'); });
  }
  else if (t.closest('[data-rfollow]')) { sendFriendRequest({ uid: r.authorUid, name: r.authorName, username: r.username || '' }); t.closest('[data-rfollow]').remove(); }
  else if (t.closest('[data-rmore]') || t.closest('[data-rcap]')) {
    const cap = el.querySelector('[data-rcap]'), more = el.querySelector('[data-rmore]');
    cap.classList.toggle('open'); if (more) more.hidden = cap.classList.contains('open');
  }
  else if (t.closest('[data-rseek]')) { const b = t.closest('[data-rseek]').getBoundingClientRect(); if (v.duration) v.currentTime = (e.clientX - b.left) / b.width * v.duration; }
  else if (t.closest('[data-rdel]')) {
    if (reelDelArm !== r.id) { reelDelArm = r.id; showToast('Tap delete again to remove this reel.'); setTimeout(() => { reelDelArm = ''; }, 3500); }
    else { reelDelArm = ''; deleteReel(r); }
  }
});
document.getElementById('reelCreateBtn').addEventListener('click', () => openReelCreate(null, true));

async function openReelComments(r) {
  if (document.querySelector('.reel-sheet')) return;
  const el = document.createElement('div');
  el.className = 'np-sheet reel-sheet'; el.style.cssText = 'position:fixed;z-index:300';
  el.innerHTML = `<div class="np-sheet-card"><div class="np-sheet-head"><strong>Comments</strong><button type="button" class="btn small ghost" data-cclose>Close</button></div>
    <div class="reel-comments">${skelRows(3)}</div>
    <div class="reel-cform"><input maxlength="200" placeholder="Add a comment" aria-label="Add a comment" /><button type="button" class="btn primary small" data-csend>Send</button></div></div>`;
  document.body.appendChild(el);
  const list = el.querySelector('.reel-comments'), input = el.querySelector('input');
  const load = async () => {
    try {
      const rows = Object.values((await get(ref(db, 'comments/' + r.id))).val() || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      list.innerHTML = rows.length ? rows.map(c => `<div class="reel-comment"><b>${esc(c.name || 'Someone')}</b><span>${esc(c.text)}</span></div>`).join('') : '<p class="reel-muted">No comments yet. Say something first.</p>';
      return rows.length;
    } catch { list.innerHTML = '<p class="reel-muted">Could not load comments.</p>'; return 0; }
  };
  load();
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-cclose]')) el.remove(); });
  el.querySelector('[data-csend]').onclick = async () => {
    const text = cleanText(input.value, 200); if (!text) return; input.value = '';
    try {
      await push(ref(db, 'comments/' + r.id), { uid: meUid(), name: state.currentUser?.name || 'Someone', text, createdAt: serverTimestamp() });
      const n = await load(); set(ref(db, 'reels/' + r.id + '/commentCount'), n).catch(() => {});
    } catch (err) { showToast(friendlyError(err, 'Could not send your comment.')); }
  };
}

function openReelCreate(initialFile, openGallery = false) {
  if (!meUid() || document.querySelector('.reel-create')) return;
  const el=document.createElement('div');el.className='screen-legal np-screen reel-create';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Create reel');
  el.innerHTML='<header class="reel-compose-head"><button type="button" data-rclose aria-label="Back">←</button><strong>Create reel</strong><span></span></header>'+
  '<nav class="reel-step-tabs" aria-label="Reel creation steps"><button type="button" class="active" data-step="video">Pick video</button><button type="button" data-step="caption">Caption &amp; hashtags</button><button type="button" data-step="upload">Upload</button></nav>'+
  '<main class="reel-compose-body">'+
  '<section class="reel-step-panel active" data-panel="video"><h3>Choose a video</h3><button type="button" class="reel-gallery-pick" data-gallery><span class="reel-gallery-icon">▣</span><b>Open gallery</b><small>Select a video from your phone</small></button><input id="reelVideoFile" type="file" accept="video/*" hidden/><video class="reel-preview" controls playsinline hidden></video><p class="reel-msg" role="alert"></p><button type="button" class="reel-next" data-next="caption">Next: Caption and hashtags</button></section>'+
  '<section class="reel-step-panel" data-panel="caption" hidden><h3>Add caption and hashtags</h3><textarea class="np-text" maxlength="500" placeholder="Write a caption…" aria-label="Caption"></textarea><input class="reel-title-input" maxlength="80" placeholder="Add a title (optional)" aria-label="Reel title"/><input class="reel-hashtags" maxlength="200" placeholder="Add hashtags (example: #murmur #friends)" aria-label="Hashtags"/><div class="reel-step-actions"><button type="button" class="reel-back" data-next="video">Back</button><button type="button" class="reel-next" data-next="upload">Next: Upload</button></div></section>'+
  '<section class="reel-step-panel" data-panel="upload" hidden><h3>Review and upload</h3><div class="reel-upload-summary"><span data-upload-name>No video selected</span><small data-upload-caption>Caption and hashtags will appear with your reel.</small></div><button type="button" class="reel-audience-row" data-raudience><span class="reel-audience-icon">●</span><span><b>Who can see this reel?</b><small data-audience-label>Friends</small></span><span class="reel-chevron">›</span></button><label class="reel-ai-row"><span class="reel-ai-icon">✧</span><span><b>Add AI label</b><small>Label realistic content that’s made with AI.</small></span><input type="checkbox" data-ailabel aria-label="Add AI label"/></label><div class="reel-prog" hidden><i></i></div><p class="reel-msg" role="alert"></p><div class="reel-step-actions"><button type="button" class="reel-back" data-next="caption">Back</button><button class="reel-share" type="button" data-rpost disabled>Upload Reel</button></div></section>'+
  '</main>';
  document.body.appendChild(el);
  const fileIn=el.querySelector('#reelVideoFile'),prev=el.querySelector('.reel-preview'),cap=el.querySelector('textarea'),titleIn=el.querySelector('.reel-title-input'),tagsIn=el.querySelector('.reel-hashtags'),prog=el.querySelector('.reel-prog'),btn=el.querySelector('[data-rpost]');
  let file=null,dur=0,audience='friends',busy=false,objectUrl='';
  const close=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);el.remove();};
  const msgFor=panel=>el.querySelector('[data-panel="'+panel+'"] .reel-msg');
  const sync=()=>{btn.disabled=busy||!file;el.querySelector('[data-upload-name]').textContent=file?file.name:'No video selected';el.querySelector('[data-upload-caption]').textContent=[cleanText(cap.value,500),cleanText(tagsIn.value,200)].filter(Boolean).join(' ')||'Caption and hashtags will appear with your reel.';};
  const go=step=>{el.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('active',b.dataset.step===step));el.querySelectorAll('[data-panel]').forEach(p=>{p.hidden=p.dataset.panel!==step;p.classList.toggle('active',p.dataset.panel===step);});if(step==='upload')sync();};
  el.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>go(b.dataset.step));
  el.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>go(b.dataset.next));
  el.querySelector('[data-gallery]').onclick=()=>fileIn.click();
  fileIn.addEventListener('change',()=>{const f=fileIn.files[0];msgFor('video').textContent='';file=null;prev.hidden=true;dur=0;if(!f)return sync();if(!/^video\//.test(f.type)){msgFor('video').textContent='Please choose a video file.';return sync();}if(f.size>25*1024*1024){msgFor('video').textContent='Video must be under 25 MB.';return sync();}file=f;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(f);prev.src=objectUrl;prev.hidden=false;sync();});
  prev.addEventListener('loadedmetadata',()=>{dur=Math.round(prev.duration||0);if(dur>90){msgFor('video').textContent='Reels can be up to 90 seconds.';file=null;prev.hidden=true;sync();}});
  cap.addEventListener('input',sync);tagsIn.addEventListener('input',sync);titleIn.addEventListener('input',sync);
  el.querySelector('[data-rclose]').onclick=close;el.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  el.querySelector('[data-raudience]').onclick=()=>{const sheet=document.createElement('div');sheet.className='reel-audience-sheet';sheet.innerHTML='<div class="reel-audience-card"><div class="reel-audience-sheet-head"><b>Who can see this reel?</b><button type="button" data-audclose>×</button></div><button type="button" data-aud="public"><span><b>Public</b><small>Anyone on Murmur</small></span><i></i></button><button type="button" data-aud="friends"><span><b>Friends</b><small>Only your friends</small></span><i></i></button><button type="button" data-aud="private"><span><b>Only me</b><small>Only you can see this reel</small></span><i></i></button></div>';document.body.appendChild(sheet);sheet.querySelectorAll('[data-aud]').forEach(b=>{b.classList.toggle('selected',b.dataset.aud===audience);b.querySelector('i').textContent=b.dataset.aud===audience?'✓':'';});sheet.addEventListener('click',e=>{if(e.target===sheet||e.target.closest('[data-audclose]')){sheet.remove();return;}const choice=e.target.closest('[data-aud]');if(!choice)return;audience=choice.dataset.aud;el.querySelector('[data-audience-label]').textContent=({public:'Public',friends:'Friends',private:'Only me'})[audience];sheet.remove();});};
  btn.onclick=async()=>{if(busy)return;busy=true;sync();msgFor('upload').textContent='';let url='',path='';try{if(file){const ext=(file.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'mp4';path='reels/'+meUid()+'/'+Date.now()+'.'+ext;const task=uploadBytesResumable(storageRef(getStorage(app),path),file,{contentType:file.type});await new Promise((ok,bad)=>task.on('state_changed',s=>{prog.hidden=false;prog.firstElementChild.style.width=(s.bytesTransferred/s.totalBytes*100)+'%';},bad,ok));url=await getDownloadURL(task.snapshot.ref);}else throw new Error('Choose a video from your phone first.');const hashtags=cleanText(tagsIn.value,200).split(/\s+/).filter(Boolean).map(tag=>tag.startsWith('#')?tag:'#'+tag.replace(/^#+/,'')).join(' ');await push(ref(db,'reels'),{authorUid:meUid(),authorName:state.currentUser?.name||'Someone',username:state.currentUser?.username||'',url,path,title:cleanText(titleIn.value,80),caption:cleanText(cap.value,500),hashtags,audience,aiLabel:!!el.querySelector('[data-ailabel]').checked,duration:dur,createdAt:serverTimestamp()});showToast('Reel uploaded.');close();setView('reels');}catch(err){msgFor('upload').textContent=/storage|unauthor|bucket|object-not-found|retry-limit/i.test((err.code||'')+' '+(err.message||''))?'Video upload is unavailable in Firebase Storage. Check your Firebase Storage setup.':friendlyError(err,'Could not upload your reel.');prog.hidden=true;busy=false;sync();}};
  if(initialFile){fileIn.files;const dt=new DataTransfer();dt.items.add(initialFile);fileIn.files=dt.files;fileIn.dispatchEvent(new Event('change'));}else if(openGallery)setTimeout(()=>fileIn.click(),180);
}
