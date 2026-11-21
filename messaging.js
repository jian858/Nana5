/* =====================================================================
   SENDING  -  messages and posts
   ===================================================================== */
let voiceRecorder = null, voiceChunks = [], voiceStream = null, voiceRecording = false;
async function toggleVoiceMessage() {
  const button = document.getElementById('voiceBtn');
  if (!activeChatUid || !meUid()) { showToast('Open a chat first.'); return; }
  if (voiceRecording && voiceRecorder) { voiceRecorder.stop(); button.textContent = '🎙️'; button.disabled = true; return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { showToast('Voice recording is not supported by this browser.'); return; }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = []; voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable = event => { if (event.data?.size) voiceChunks.push(event.data); };
    voiceRecorder.onerror = () => showToast('Voice recording failed.');
    voiceRecorder.onstop = async () => {
      voiceRecording = false; voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null;
      try {
        const recipientUid = activeChatUid, senderUid = meUid();
        const blob = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/webm' });
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Voice message must be under 8 MB.');
        const filePath = `chat-audio/${senderUid}/${chatIdOf(senderUid, recipientUid)}/${Date.now()}.webm`;
        const task = uploadBytesResumable(storageRef(getStorage(app), filePath), blob, { contentType: blob.type || 'audio/webm' });
        await new Promise((resolve, reject) => { task.on('state_changed', null, reject, resolve); });
        const audioUrl = await getDownloadURL(task.snapshot.ref);
        await push(ref(db, `chats/${chatIdOf(senderUid, recipientUid)}/messages`), { from: senderUid, audioUrl, audioPath: filePath, createdAt: serverTimestamp() });
        showToast('Voice message sent.');
      } catch (error) { showToast(friendlyError(error, 'Could not send voice message.')); }
      finally { button.disabled = false; button.textContent = '🎙️'; voiceRecorder = null; voiceChunks = []; }
    };
    voiceRecorder.start(); voiceRecording = true; button.textContent = '■'; showToast('Recording… tap ■ to send.');
  } catch (error) { voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null; showToast(friendlyError(error, 'Microphone permission is needed.')); }
}
document.getElementById('voiceBtn').addEventListener('click', toggleVoiceMessage);
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendBtn');
  const recipientUid = activeChatUid;
  const senderUid = meUid();
  const text = cleanText(input.value, CONFIG.maxLength.message);
  if (!text || !recipientUid || sendingMessage) return;
  if (!senderUid || !auth.currentUser) { showToast('Please log in again to send messages.'); return; }
  if (recipientUid === senderUid) { showToast('Choose a friend to message.'); return; }
  if (isBlocked(recipientUid)) { showToast('You blocked this person.'); return; }
  if (!navigator.onLine) { showToast('You are offline. Message not sent.'); return; }
  if (messageLimiter.check()) { showToast(CONFIG.text.tooFastMessage); return; }

  sendingMessage = true;
  sendButton.disabled = true;
  input.value = '';
  stopTyping();
  try {
    await push(ref(db, `chats/${chatIdOf(senderUid, recipientUid)}/messages`), {
      from: senderUid, text, createdAt: serverTimestamp()
    });
  } catch (error) {
    // Restore the draft only if the user has not started typing a newer message.
    if (!input.value) input.value = text;
    showToast(friendlyError(error, 'Message failed. Check your connection and try again.'));
  } finally {
    sendingMessage = false;
    sendButton.disabled = false;
    if (activeChatUid === recipientUid && document.activeElement !== input) input.focus();
  }
}

async function createPost() {
  const input = document.getElementById('postInput');
  const text = cleanText(input.value, CONFIG.maxLength.post), extras = postExtraFields();
  if (!text && !Object.keys(extras).length) return false;
  if (postAudience.mode === 'specific' && !postAudience.uids.length) { showToast('Choose at least one friend who can see this post.'); return false; }
  if (postLimiter.check()) { showToast(CONFIG.text.tooFastPost); return false; }
  const user = auth.currentUser;
  if (user && remotePosts) {
    try {
      await push(ref(db, 'posts'), { authorUid: user.uid, authorName: state.currentUser?.name || 'Someone', authorUsername: state.currentUser?.username || '', text, ...postAudienceFields(), ...extras, createdAt: serverTimestamp() });
      input.value = ''; postExtras = {};
      return true;
    } catch (e) { showToast(friendlyError(e, 'Could not post.')); return false; }
  }
  state.posts.unshift({ id: Date.now(), author: 'me', text, likes: 0, liked: false });
  input.value = '';
  saveState();
  renderPosts();
  return true;
}

function openSavedPosts() {
  const ids = Object.keys(savedPostIds || {}).filter(id => savedPostIds[id]);
  const posts = (remotePosts || []).filter(p => ids.includes(p.id));
  const back = document.createElement('div'); back.className = 'modal-back top';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Saved posts</h3><div class="saved-post-list">${posts.length ? posts.map(p => `<article><strong>${esc(p.authorName || 'Someone')}</strong><p>${esc(p.text || (p.photo ? 'Photo post' : 'Post'))}</p><button class="btn small ghost" type="button" data-unsave="${esc(p.id)}">Remove saved post</button></article>`).join('') : '<p>No saved posts yet.</p>'}</div><div class="cookie-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>`;
  document.body.appendChild(back); back.querySelector('[data-close]').onclick = () => back.remove();
  back.addEventListener('click', async e => { const b = e.target.closest('[data-unsave]'); if (!b) return; try { await remove(ref(db, `savedPosts/${meUid()}/${b.dataset.unsave}`)); b.closest('article').remove(); showToast('Removed from saved posts.'); } catch (error) { showToast(friendlyError(error, 'Could not remove saved post.')); } });
}
document.getElementById('loginBtn').addEventListener('click', () => {
  login(document.getElementById('email').value, document.getElementById('password').value);
});
document.getElementById('createBtn').addEventListener('click', openRegisterWizard);
document.getElementById('resetBtn').addEventListener('click', openForgotPassword);
document.getElementById('postBtn').addEventListener('click', createPost);
document.getElementById('savedPostsOpen').addEventListener('click', openSavedPosts);
document.addEventListener('click', async e => {
  const save = e.target.closest('[data-save-post]'); if (!save || !meUid()) return;
  const id = save.dataset.savePost;
  try { await set(ref(db, `savedPosts/${meUid()}/${id}`), savedPostIds[id] ? null : true); showToast(savedPostIds[id] ? 'Post removed from saved.' : 'Post saved.'); }
  catch (error) { showToast(friendlyError(error, 'Could not save post.')); }
});
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messages').addEventListener('click', async e => {
  const b = e.target.closest('[data-msg-react]'); if (!b || !activeChatUid || !meUid()) return;
  const messageId = b.dataset.msgReact, emoji = b.dataset.emoji;
  try { await set(ref(db, `${chatPath()}/messages/${messageId}/reactions/${meUid()}`), emoji); }
  catch (error) { showToast(friendlyError(error, 'Could not react to message.')); }
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  const btn = document.getElementById('logoutBtn');
  if (btn.classList.contains('logging-out')) return;
  btn.classList.add('logging-out');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise(r => setTimeout(r, reduce ? 0 : CONFIG.logoutAnimationMs));
  appEl.classList.add('leaving');
  await new Promise(r => setTimeout(r, reduce ? 0 : 450));
  try {
    try { await signOut(auth); } catch (error) { console.warn('Sign out failed:', error && error.code); }
    state.loggedIn = false;
    saveState();
    showAuth();
  } finally {
    btn.classList.remove('logging-out');
    appEl.classList.remove('leaving');
  }
});
document.getElementById('messageInput').addEventListener('input', e => {
  if (!activeChatUid || !auth.currentUser) return;
  clearTimeout(typingStop);
  if (!e.target.value.trim()) return stopTyping();
  const now = Date.now();
  if (now - lastTypingSent > 2000) { lastTypingSent = now; set(ref(db, `${chatPath()}/typing/${meUid()}`), now).catch(() => {}); }
  typingStop = setTimeout(stopTyping, 3500);
});
document.getElementById('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
// tapping Send must not steal focus (that closes the keyboard)
document.getElementById('sendBtn').addEventListener('pointerdown', e => e.preventDefault());
document.getElementById('postInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') createPost();
});
document.getElementById('chatSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const list = document.getElementById('chatList');
  list.querySelectorAll('.chat-item').forEach(item => {
    const name = item.textContent.toLowerCase();
    item.style.display = q && !name.includes(q) ? 'none' : 'flex';
  });
});

document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.getElementById('friendSearchBtn').addEventListener('click', searchFriends);
document.getElementById('friendSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriends(); });
document.addEventListener('click', async e => {
  const add = e.target.closest('[data-fr-add]'), acc = e.target.closest('[data-fr-accept]'), del = e.target.closest('[data-fr-del]'), msg = e.target.closest('[data-msg]');
  try {
    if (add) { await sendFriendRequest(searchResults[Number(add.dataset.frAdd)]); return; }
    if (acc) { const o = acc.dataset.frAccept, u = meUid(); await update(ref(db), { [`friends/${u}/${o}/status`]: 'accepted', [`friends/${o}/${u}/status`]: 'accepted' }); return; }
    if (del) { const o = del.dataset.frDel, u = meUid(); await update(ref(db), { [`friends/${u}/${o}`]: null, [`friends/${o}/${u}`]: null }); return; }
    if (msg) { setView('chats'); openChat(msg.dataset.msg); return; }
  } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
});
document.addEventListener('click', async e => {
  const likeBtn = e.target.closest('[data-like]');
  const delBtn = e.target.closest('[data-del]');
  const uid = auth.currentUser?.uid;
  try {
    if (delBtn && remotePosts) { await remove(ref(db, 'posts/' + delBtn.dataset.del)); return; }
    if (!likeBtn) return;
    if (remotePosts && uid) {
      const post = remotePosts.find(p => p.id === likeBtn.dataset.like);
      if (!post) return;
      const lr = ref(db, `posts/${post.id}/likes/${uid}`);
      const had = !!(post.likes || {})[uid];
      await (had ? remove(lr) : set(lr, true));
      if (!had && post.authorUid && post.authorUid !== uid) set(ref(db, `notifications/${post.authorUid}/like_${post.id}_${uid}`), { type: 'like', postId: post.id, from: uid, text: `${state.currentUser?.name || 'Someone'} liked your post`, createdAt: serverTimestamp(), read: false }).catch(() => {});
      return;
    }
    const post = state.posts.find(p => p.id === Number(likeBtn.dataset.like));
    if (!post) return;
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    saveState();
    renderPosts();
  } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
});

document.getElementById('hdrAdd').addEventListener('click', () => { setView('home'); openCreatePost(); });
document.getElementById('hdrSearch').addEventListener('click', () => { setView('friends'); setFrSearch(true); });

function openDeleteAccount() {
  const user = auth.currentUser;
  if (!user) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Delete your account?</h3>
    <p>This permanently deletes your profile and your posts. It can't be undone. Enter your password to confirm.</p>
    <input type="password" autocomplete="current-password" placeholder="Password" />
    <div class="error" role="alert"></div>
    <div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-confirm style="background:var(--danger);color:#fff">Delete forever</button></div></div>`;
  document.body.appendChild(back);
  const pw = back.querySelector('input'), err = back.querySelector('.error'), ok = back.querySelector('[data-confirm]');
  back.querySelector('[data-cancel]').onclick = () => back.remove();
  pw.focus();
  ok.onclick = async () => {
    err.textContent = '';
    if (!pw.value) { err.textContent = 'Enter your password.'; return; }
    ok.disabled = true; ok.textContent = 'Deleting...';
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw.value));
      const mine = await get(query(ref(db, 'posts'), orderByChild('authorUid'), equalTo(user.uid)));
      const wipe = {};
      Object.keys(mine.val() || {}).forEach(id => { wipe['posts/' + id] = null; });
      friendDocs.forEach(d => { wipe[`friends/${user.uid}/${d.uid}`] = null; wipe[`friends/${d.uid}/${user.uid}`] = null; });
      wipe['profiles/' + user.uid] = null; wipe['presence/' + user.uid] = null; wipe['notifications/' + user.uid] = null; wipe['savedPosts/' + user.uid] = null; wipe['users/' + user.uid] = null;
      await update(ref(db), wipe);
      await deleteUser(user);
      stopPostsListener();
      state.loggedIn = false; state.currentUser = { ...DEFAULT_STATE.currentUser };
      saveState(); back.remove(); showAuth(); showToast('Your account was deleted.');
    } catch (e) {
      err.textContent = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential' ? 'Wrong password.' : (friendlyError(e, 'Could not delete account.'));
      ok.disabled = false; ok.textContent = 'Delete forever';
    }
  };
}
document.getElementById('deleteAccountBtn').addEventListener('click', openDeleteAccount);

// Re-check active Firebase sessions every five seconds so a password reset
// or administrator revocation is detected quickly. Checks run only while the
// app is visible; the initial forced refresh is awaited before account data opens.
// Supabase's separate Murmur ID mapping is preserved.
const MURMUR_AUTH_RECHECK_MS = 5 * 1000;
let murmurAuthRecheckTimer = null;
let murmurAuthRecheckBusy = false;
let murmurAuthRecheckUid = null;

async function checkMurmurAuthSession(user) {
  if (!user || !auth.currentUser || auth.currentUser.uid !== user.uid) return false;
  if (murmurAuthRecheckBusy) return null;
  murmurAuthRecheckBusy = true;
  try {
    await user.getIdToken(true);
    return true;
  } catch (error) {
    const code = String(error && error.code || '');
    // A rejected refresh token means this device must not continue into Murmur.
    if (/auth\/(user-token-expired|invalid-user-token|user-disabled|user-not-found)/.test(code)) {
      console.warn('Murmur session was revoked; signing out this device:', code);
      try { await signOut(auth); } catch (signOutError) {
        console.warn('Could not complete revoked-session sign-out:', signOutError && signOutError.code);
      }
      return false;
    }
    // Temporary network/service errors are not proof of revocation.
    console.warn('Murmur session recheck was deferred:', code || error);
    return null;
  } finally {
    murmurAuthRecheckBusy = false;
  }
}

function startMurmurAuthSessionChecks(user) {
  if (murmurAuthRecheckTimer) clearInterval(murmurAuthRecheckTimer);
  murmurAuthRecheckTimer = null;
  murmurAuthRecheckUid = user ? user.uid : null;
  if (!user) return;
  murmurAuthRecheckTimer = setInterval(() => {
    if (!document.hidden && auth.currentUser && auth.currentUser.uid === murmurAuthRecheckUid) {
      checkMurmurAuthSession(auth.currentUser);
    }
  }, MURMUR_AUTH_RECHECK_MS);
  // Check immediately on app startup/login so a reset made while this device
  // was offline is detected as soon as Firebase can refresh its token.
  checkMurmurAuthSession(user);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && auth.currentUser && auth.currentUser.uid === murmurAuthRecheckUid) {
    checkMurmurAuthSession(auth.currentUser);
  }
});


