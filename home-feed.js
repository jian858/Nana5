/* =====================================================================
   HOME FEED  -  posts, likes, comments
   ===================================================================== */
/* the extras a post can carry (see CREATE POST) */
function postSubHtml(p) {
  const bits = [];
  if (p.feeling && p.feeling.text) bits.push((p.feeling.type === 'feeling' ? 'feeling ' : '') + esc(p.feeling.text));
  if (p.place) bits.push('at ' + esc(p.place));
  const tags = p.tags ? Object.entries(p.tags) : [];
  if (tags.length) bits.push('with ' + tags.map(([u, n]) => `<button type="button" class="post-tag" data-profile="${esc(u)}">${esc(n)}</button>`).join(', '));
  return bits.length ? `<div class="post-sub">${bits.join(' · ')}</div>` : '';
}
function postMediaHtml(p) {
  let h = '';
  if (p.music && p.music.song) h += `<div class="post-chip">${ic('music', '#f35fb0')}<span>${esc(p.music.song)}${p.music.artist ? ' – ' + esc(p.music.artist) : ''}</span></div>`;
  if (p.event && p.event.title) {
    const d = new Date(p.event.when || 0);
    h += `<div class="post-event"><div class="ev-date"><b>${d.getDate()}</b><span>${esc(d.toLocaleString('en', { month: 'short' }))}</span></div><div><strong>${esc(p.event.title)}</strong><small>${esc(fmtEventWhen(p.event.when || 0))}${p.event.place ? ' · ' + esc(p.event.place) : ''}</small></div></div>`;
  }
  if (okImg(p.photo)) h += `<img class="post-photo" src="${p.photo}" alt="Photo in post" loading="lazy" decoding="async" />`;
  return h;
}
let savedPostIds = {};
function renderPosts() {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';
  if (feedLoading && !remotePosts) { postsEl.innerHTML = '<div class="skeleton-post"><i></i><b></b><b></b></div>'.repeat(3); return; }
  const uid = meUid();
  const list = remotePosts
    ? remotePosts.filter(canSeePost).map(p => ({ raw: p, aud: p.audience || 'public', id: p.id, name: p.authorName || 'Someone', username: p.authorUsername || '', text: p.text || '', likes: Object.keys(p.likes || {}).length, liked: !!uid && !!(p.likes || {})[uid], mine: p.authorUid === uid, uid: p.authorUid, time: p.createdAt, remote: true }))
    : state.posts.map(p => { const a = getUserById(p.author); return { id: p.id, name: a.name, username: a.username || '@user', text: p.text, likes: p.likes, liked: p.liked, mine: false, remote: false }; });
  if (!list.length) { postsEl.innerHTML = '<div class="empty empty-rich">' + ic('sparkle') + '<strong>Nothing here yet</strong>Be the first to share something with your friends.</div>'; return; }
  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'post';
    card.innerHTML = `
      <div class="post-head">${p.uid ? `<button type="button" class="person-link" data-profile="${esc(p.uid)}">` : '<div class="meta">'}
        ${avatarHtml(p.uid, p.name)}
        <div style="text-align:left"><strong>${esc(p.name)}</strong><br /><small>${esc(p.username)}${p.time ? ' · ' + timeAgo(p.time) : ''}${p.remote ? ` · <span class="aud-tag" title="${esc(audMeta(p.aud)[1])}">${ic(audMeta(p.aud)[0])}</span>` : ''}</small></div>
      ${p.uid ? '</button>' : '</div>'}</div>
      ${p.raw ? postSubHtml(p.raw) : ''}
      ${p.text ? `<p>${esc(p.text)}</p>` : ''}
      ${p.raw ? postMediaHtml(p.raw) : ''}
      <div class="post-actions">
        <button class="${p.liked ? 'active' : ''}" data-like="${esc(p.id)}" type="button">${ic('heart')}Like${p.likes ? ' ' + p.likes : ''}</button>
        ${p.remote ? `<button type="button" data-comment="${esc(p.id)}">${ic('comment')}Comment</button><button type="button" data-save-post="${esc(p.id)}">${savedPostIds[p.id] ? '★ Saved' : '☆ Save'}</button>` : ''}
        ${p.mine ? `<button type="button" data-del="${esc(p.id)}">Delete</button>` : (p.remote ? `<button type="button" data-report-post="${esc(p.id)}" data-name="${esc(p.name)}">Report</button>` : '')}
      </div>`;
    card.dataset.pid = p.id;
    postsEl.appendChild(card);
    if (p.remote && openComments.has(p.id)) attachComments(card, p.id);
  });
}

function renderMenuHeader() {
  const cu = state.currentUser || {};
  document.getElementById('menuAvatar').textContent = initials(cu.name || '?');
  document.getElementById('menuName').textContent = cu.name || 'Your profile';
  document.getElementById('menuUser').textContent = cu.username || '';
  applyOwnPhoto();
}

let friendDocs = [], unsubFriends = null, activeChatUid = null, unsubMsgs = null, chatMsgs = [], searchResults = [];
const meUid = () => auth.currentUser?.uid;
const otherOf = d => ({ uid: d.uid, name: d.name, username: d.username });
function getFriendCount(friends) {
  if (Array.isArray(friends)) return friends.filter(friend => friend && friend.status === 'accepted').length;
  if (!friends || typeof friends !== 'object') return 0;
  return Object.values(friends).filter(Boolean).length;
}
const friendsOf = () => friendDocs.filter(d => d.status === 'accepted');
const incoming = () => friendDocs.filter(d => d.status === 'incoming');
const outgoing = () => friendDocs.filter(d => d.status === 'outgoing');
const chatIdOf = (a, b) => [a, b].sort().join('_');
const blocked = new Map();            // uid -> name of people you stopped (see BLOCK PEOPLE)
let blockedLoadedFor = null;
const isBlocked = uid => { loadBlocked(); return blocked.has(uid); };
const chatFriends = () => friendsOf().filter(d => !isBlocked(d.uid));

const photoCache = {};
let photoSubs = {}, photoTick = false;
const photoFor = uid => uid && uid === meUid() ? state.currentUser?.photo : photoCache[uid];
const avatarHtml = (uid, name) => { const u = photoFor(uid); return okImg(u) ? `<div class="avatar" style="background-image:url('${u}');background-size:cover;background-position:center"></div>` : `<div class="avatar">${esc(initials(name))}</div>`; };
function refreshPhotoViews() {
  if (photoTick) return; photoTick = true;
  setTimeout(() => { photoTick = false; renderFriends(); renderChats(); renderPosts(); renderAlerts(); renderStories(); }, 120);
}
function watchPhoto(uid) {
  if (!uid || photoSubs[uid]) return;
  photoSubs[uid] = onValue(ref(db, 'profiles/' + uid + '/photo'), snap => {
    const v = snap.val() || '';
    if (photoCache[uid] !== v) { photoCache[uid] = v; refreshPhotoViews(); }
  }, () => {});
}

