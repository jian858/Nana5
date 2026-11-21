/* =====================================================================
   BLOCK PEOPLE  -  stop a person: STOP sign animation, hide their chat
   Saved on this device (and in Firebase at blocks/<you>/<them> if your rules allow it).
   ===================================================================== */
const blockKey = () => 'murmur-blocked-' + (meUid() || 'guest');
function loadBlocked() {
  const k = blockKey();
  if (blockedLoadedFor === k) return;
  blockedLoadedFor = k; blocked.clear();
  try { Object.entries(JSON.parse(localStorage.getItem(k) || '{}')).forEach(([u, n]) => blocked.set(u, n)); } catch {}
  if (auth.currentUser) {
    get(ref(db, 'blocks/' + auth.currentUser.uid)).then(snap => {
      const v = snap.val && snap.val(); if (!v) return;
      Object.keys(v).forEach(u => { if (!blocked.has(u)) blocked.set(u, 'Blocked person'); });
      renderChats();
    }).catch(() => {});
  }
}
function saveBlocked() {
  try { localStorage.setItem(blockKey(), JSON.stringify(Object.fromEntries(blocked))); } catch {}
}
async function setBlocked(uid, name, on) {
  loadBlocked();
  if (on) blocked.set(uid, name); else blocked.delete(uid);
  saveBlocked();
  if (auth.currentUser) {
    try { await set(ref(db, `blocks/${auth.currentUser.uid}/${uid}`), on ? true : null); } catch (e) { /* rules may not allow it: it still works on this device */ }
  }
}
const STOP_SIGN = '<div class="stop-sign" aria-hidden="true"><span>STOP</span></div>';

function openBlockDialog(uid, name) {
  const back = document.createElement('div');
  back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card block-card" role="dialog" aria-modal="true">${STOP_SIGN}<h3>${esc(CONFIG.text.blockTitle.replace('{name}', name))}</h3><p>${esc(CONFIG.text.blockBody)}</p><div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-confirm style="background:var(--danger);color:#fff">Block</button></div></div>`;
  document.body.appendChild(back);
  const card = back.querySelector('.block-card');
  back.querySelector('[data-cancel]').onclick = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('[data-confirm]').onclick = async () => {
    card.classList.add('stamped');
    card.querySelector('h3').textContent = name + ' is blocked';
    card.querySelector('p').textContent = '';
    card.querySelector('.cookie-actions').remove();
    await setBlocked(uid, name, true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      back.remove();
      slideOutChat(() => {
        if (location.hash === '#chat') history.replaceState(null, '', location.pathname + location.search);
        closeChat();
        renderChats();
        showToast(name + ' is blocked.');
      });
    }, reduce ? 0 : CONFIG.blockAnimMs);
  };
}
document.getElementById('chatBlockBtn').addEventListener('click', () => {
  if (!activeChatUid) return;
  const o = friendsOf().map(otherOf).find(x => x.uid === activeChatUid);
  openBlockDialog(activeChatUid, o ? o.name : 'this person');
});

function openBlockedList() {
  loadBlocked();
  const back = document.createElement('div');
  back.className = 'modal-back top';
  const rows = () => blocked.size ? [...blocked].map(([u, n]) => `<div class="blocked-row"><span>${esc(n)}</span><button class="btn small ghost" type="button" data-unblock="${esc(u)}">Unblock</button></div>`).join('') : '<p>You have not blocked anyone.</p>';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Blocked people</h3><div class="blocked-list">${rows()}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
  document.body.appendChild(back);
  back.querySelector('[data-close]').onclick = () => back.remove();
  back.addEventListener('click', async e => {
    if (e.target === back) { back.remove(); return; }
    const b = e.target.closest('[data-unblock]'); if (!b) return;
    await setBlocked(b.dataset.unblock, '', false);
    back.querySelector('.blocked-list').innerHTML = rows();
    renderChats(); showToast('Unblocked.');
  });
}
document.getElementById('blockedBtn').addEventListener('click', openBlockedList);

