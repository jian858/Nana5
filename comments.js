/* ---------- Comments ---------- */
const openComments = new Set(), commentSubs = {}, commentData = {}, commentDraft = {};
function toggleComments(id) {
  if (openComments.has(id)) { openComments.delete(id); if (commentSubs[id]) { commentSubs[id](); delete commentSubs[id]; } }
  else {
    openComments.add(id);
    if (!commentSubs[id]) commentSubs[id] = onValue(query(ref(db, 'comments/' + id), orderByChild('createdAt'), limitToLast(50)), snap => {
      commentData[id] = Object.entries(snap.val() || {}).map(([cid, c]) => ({ cid, ...c })).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now()));
      commentData[id].forEach(c => watchPhoto(c.uid));
      const card = document.querySelector(`[data-pid="${CSS.escape(id)}"]`);
      if (card) attachComments(card, id);
    }, () => {});
  }
  renderPosts();
}
function attachComments(card, id) {
  card.querySelector('.comments')?.remove();
  if (!openComments.has(id)) return;
  const box = document.createElement('div');
  box.className = 'comments';
  const list = commentData[id] || [];
  box.innerHTML = (list.map(c => `<div class="comment">${avatarHtml(c.uid, c.name)}<div><button type="button" class="person-link" data-profile="${esc(c.uid)}"><b>${esc(c.name)}</b></button> ${esc(c.text)} <small>${timeAgo(c.createdAt)}</small></div></div>`).join('') || '<small>No comments yet.</small>') +
    '<div class="comment-form"><input type="text" maxlength="300" placeholder="Write a comment…" data-cinput /><button class="btn small primary" type="button" data-csend>Send</button></div>';
  const inp = box.querySelector('[data-cinput]');
  inp.value = commentDraft[id] || '';
  inp.addEventListener('input', () => { commentDraft[id] = inp.value; });
  const send = async () => {
    const text = inp.value.trim(); if (!text) return;
    const u = auth.currentUser; if (!u) return;
    try { await push(ref(db, 'comments/' + id), { uid: u.uid, name: state.currentUser?.name || 'Someone', text, createdAt: serverTimestamp() }); commentDraft[id] = ''; inp.value = ''; }
    catch (e) { showToast(friendlyError(e, 'Could not comment.')); }
  };
  box.querySelector('[data-csend]').onclick = send;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  card.appendChild(box);
}
document.addEventListener('click', e => { const c = e.target.closest('[data-comment]'); if (c) toggleComments(c.dataset.comment); });

