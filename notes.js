/* =====================================================================
   NOTES  -  a short line (60 characters) on top of your chats. Every friend sees it in
   their chat list and at the top of your conversation. Saved at notes/<your id>.
   ===================================================================== */
const NOTE_LIFETIME_MS = 24 * 60 * 60 * 1000;
function isNoteActive(note) {
  if (!note || typeof note.text !== 'string' || !note.text.trim()) return false;
  const createdAt = Number(note.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 && Date.now() - createdAt < NOTE_LIFETIME_MS;
}
function watchNote(uid) {
  if (noteSubs[uid]) return;
  noteSubs[uid] = onValue(ref(db, 'notes/' + uid), snap => {
    const v = snap.val();
    if (v && typeof v.text === 'string' && v.text.trim() && !isNoteActive(v)) {
      noteData[uid] = null;
      // Only the note owner may remove the expired database record.
      if (uid === meUid()) remove(ref(db, 'notes/' + uid)).catch(() => {});
    } else {
      noteData[uid] = isNoteActive(v) ? v : null;
    }
    renderNoteRow(); renderProfileNote(); if (activeChatUid === uid) renderConversation();
  }, () => {});
}
function stopNoteListeners() {
  Object.values(noteSubs).forEach(unsubscribe => {
    if (typeof unsubscribe === 'function') unsubscribe();
  });
  noteSubs = {};
  noteData = {};
}
function pruneNotes() {
  let changed = false;
  Object.entries(noteData).forEach(([uid, note]) => {
    if (!note || isNoteActive(note)) return;
    noteData[uid] = null;
    changed = true;
    // Only the owner may clean the expired database record.
    if (uid === meUid()) remove(ref(db, 'notes/' + uid)).catch(() => {});
  });
  if (changed) {
    renderNoteRow();
    renderProfileNote();
    if (activeChatUid) renderConversation();
  }
}
setInterval(pruneNotes, 60000);

function renderNoteRow() {
  const row = document.getElementById('noteRow'), me = meUid();
  if (!row) return;
  if (!me) { row.innerHTML = ''; return; }
  const fr = chatFriends().map(otherOf);
  [me, ...fr.map(o => o.uid)].forEach(watchNote);
  const mine = isNoteActive(noteData[me]) ? noteData[me] : null;
  row.innerHTML = `<button type="button" class="note-tile" data-note-edit><span class="note-bubble${mine ? '' : ' empty'}">${mine ? esc(mine.text) : 'Add note'}</span>${avatarHtml(me, state.currentUser?.name || '')}<small>Your note</small></button>`
    + fr.filter(o => isNoteActive(noteData[o.uid])).map(o => `<button type="button" class="note-tile" data-msg="${esc(o.uid)}"><span class="note-bubble">${esc(noteData[o.uid].text)}</span>${avatarHtml(o.uid, o.name)}<small>${esc(o.name.split(' ')[0])}</small></button>`).join('');
}
function openNoteSheet() {
  const me = meUid(); if (!me || document.querySelector('.note-sheet')) return;
  const cur = noteData[me], max = 60;
  const el = document.createElement('div');
  el.className = 'np-sheet note-sheet'; el.style.cssText = 'position:fixed;z-index:300';
  el.innerHTML = `<div class="np-sheet-card"><div class="np-sheet-head"><strong>Your note</strong><button type="button" class="btn small ghost" data-nclose>Close</button></div>
    <textarea class="note-input" maxlength="${max}" placeholder="Share what’s on your mind…" aria-label="Your note"></textarea>
    <div class="np-count"><span data-nn>0</span>/${max}</div>
    <p class="note-hint">Everyone you chat with can see your note.</p>
    <div class="note-actions">${cur ? '<button type="button" class="btn ghost" data-ndel>Delete note</button>' : ''}<button type="button" class="btn primary" data-nsave disabled>Share note</button></div></div>`;
  document.body.appendChild(el);
  const ta = el.querySelector('.note-input'), save = el.querySelector('[data-nsave]'), close = () => el.remove();
  ta.value = cur ? cur.text : '';
  const sync = () => { el.querySelector('[data-nn]').textContent = ta.value.length; save.disabled = !ta.value.trim(); };
  sync(); ta.addEventListener('input', sync);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-nclose]')) close(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  save.onclick = async () => {
    const text = cleanText(ta.value, max); if (!text) return;
    save.disabled = true;
    try {
      await set(ref(db, 'notes/' + me), { text, createdAt: serverTimestamp() });
      showToast('Note shared with your friends.'); close(); renderNoteRow(); renderProfileNote();
    } catch (err) { showToast(friendlyError(err, 'Could not share your note.')); save.disabled = false; }
  };
  const del = el.querySelector('[data-ndel]');
  if (del) del.onclick = async () => {
    try { await remove(ref(db, 'notes/' + me)); noteData[me] = null; showToast('Note deleted.'); close(); renderNoteRow(); renderProfileNote(); }
    catch (err) { showToast(friendlyError(err, 'Could not delete your note.')); }
  };
  setTimeout(() => ta.focus(), 60);
}
document.addEventListener('click', e => { if (e.target.closest('[data-note-edit]')) openNoteSheet(); });

