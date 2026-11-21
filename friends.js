/* =====================================================================
   FRIENDS  -  search, requests, accept/delete
   ===================================================================== */
// one Facebook-style row: big avatar, name, small line, two buttons side by side
function fbRow(uid, name, sub, primary, secondary, i) {
  return `<div class="fr-row" style="--i:${Math.min(i || 0, 8)}">
    <button type="button" class="fr-av person-link" data-profile="${esc(uid)}" aria-label="Open ${esc(name)}">${avatarHtml(uid, name)}</button>
    <div class="fr-body">
      <button type="button" class="fr-name person-link" data-profile="${esc(uid)}">${esc(name)}</button>
      <div class="fr-sub">${sub}</div>
      <div class="fr-btns">${primary || ''}${secondary || ''}</div>
    </div></div>`;
}
const frBlue = (attr, val, label) => `<button class="fr-btn blue" ${attr}="${esc(val)}" type="button">${label}</button>`;
const frGray = (attr, val, label) => `<button class="fr-btn gray" ${attr}="${esc(val)}" type="button">${label}</button>`;
const statusLine = (uid, username) => `<span class="${isActive(uid) ? 'st-on' : 'st-off'}">${isActive(uid) ? CONFIG.text.online : CONFIG.text.offline}</span> \u00b7 ${esc(username)}`;

let frTab = 'suggest';
function setFrTab(tab) {
  frTab = tab; animateRows();
  document.querySelectorAll('[data-frtab]').forEach(b => { const on = b.dataset.frtab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('[data-frpanel]').forEach(p => { p.hidden = p.dataset.frpanel !== tab; });
}
document.querySelectorAll('[data-frtab]').forEach(b => b.addEventListener('click', () => setFrTab(b.dataset.frtab)));
// the search form is hidden until you tap the search button; hiding it also clears it
function setFrSearch(on) {
  const block = document.getElementById('findBlock'), input = document.getElementById('friendSearch');
  block.hidden = !on;
  if (on) { setFrTab('suggest'); setTimeout(() => input.focus(), 40); return; }
  input.value = '';
  if (searchResults.length) { searchResults = []; renderFriends(); }
}
document.getElementById('frSearchIcon').addEventListener('click', () => setFrSearch(document.getElementById('findBlock').hidden));

function renderFriends() {
  const req = incoming();
  document.getElementById('reqCard').hidden = !req.length;
  document.getElementById('reqCount').textContent = req.length || '';
  document.getElementById('reqList').innerHTML = req.map((d, i) => fbRow(d.uid, d.name, esc(d.username), frBlue('data-fr-accept', d.uid, 'Confirm'), frGray('data-fr-del', d.uid, 'Delete'), i)).join('');

  const f = friendsOf();
  document.getElementById('friendCount').textContent = f.length || '';
  document.getElementById('friendsList').innerHTML = f.length
    ? f.map((d, i) => { const o = otherOf(d); return fbRow(o.uid, o.name, statusLine(o.uid, o.username), frBlue('data-msg', o.uid, 'Message'), frGray('data-fr-del', d.uid, 'Remove'), i); }).join('')
    : '<div class="empty">No friends yet. Search for a username in Suggestions.</div>';

  const sent = outgoing();
  document.getElementById('sentCard').hidden = !sent.length;
  document.getElementById('sentList').innerHTML = sent.map((d, i) => fbRow(d.uid, d.name, esc(d.username), frGray('data-fr-del', d.uid, 'Cancel request'), '', i)).join('');

  document.getElementById('peopleBlock').hidden = !searchResults.length;
  document.getElementById('searchResults').innerHTML = searchResults.map((r, i) => {
    const rel = friendDocs.find(d => d.uid === r.uid);
    const first = rel ? `<span class="fr-note">${rel.status === 'accepted' ? 'Friends' : 'Request pending'}</span>` : frBlue('data-fr-add', i, 'Add friend');
    return fbRow(r.uid, r.name, esc(r.username), first, '', i);
  }).join('');
}

