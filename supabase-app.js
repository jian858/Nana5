/* Murmur — Supabase-only application bootstrap.
 * Authentication and the home feed use Supabase directly through the shared data layer.
 * No external identity bridge or fallback is loaded.
 */
import { supabase } from "./supabase-client.js";
import { posts, profiles, storage, friendships, stories, reels, userNotes, messages, conversations, comments, postLikes, accountRestrictions } from "./supabase-data.js?v=20261122-2";
import { initSupabaseSocial, openDirectChat } from "./supabase-social.js?v=20261122-21";

const authModalStyles = document.createElement("style");
authModalStyles.textContent = ".murmur-auth-modal{position:fixed;inset:0;z-index:9999;background:#101828a8;display:grid;place-items:center;padding:18px}.murmur-auth-modal section{position:relative;width:min(100%,440px);max-height:90dvh;overflow:auto;background:var(--panel,#fff);color:var(--text,#17202a);border-radius:20px;padding:26px;box-shadow:0 20px 70px #0004}.murmur-auth-modal h2{margin:0 36px 20px 0}.murmur-auth-modal label{display:grid;gap:6px;margin:12px 0;font-size:14px;font-weight:600}.murmur-auth-modal input{width:100%;min-height:44px;border:1px solid var(--border,#d5dbe3);border-radius:10px;padding:10px;background:var(--input-bg,#fff);color:inherit}.murmur-modal-close{position:absolute;right:14px;top:12px;border:0;background:transparent;font-size:26px}.murmur-modal-error{color:#c62828;font-size:13px;min-height:18px}.murmur-signup-submit{width:100%;min-height:46px}.murmur-auth-modal textarea,.murmur-auth-modal select{width:100%;min-height:44px;border:1px solid var(--border,#d5dbe3);border-radius:10px;padding:10px;background:var(--input-bg,#fff);color:inherit;font:inherit}.murmur-menu-dialog .btn{margin:8px 0;min-height:44px}.murmur-menu-dialog p{line-height:1.55}.murmur-menu-dialog-body{overflow-wrap:anywhere}";
document.head.appendChild(authModalStyles);
const signupScreenStyles=document.createElement('style');signupScreenStyles.textContent="\n/* Full-screen, two-section account creation flow. */\n.murmur-signup-screen{position:fixed;inset:0;z-index:10020;display:flex;flex-direction:column;background:var(--bg,#f5f8f7);color:var(--ink,#17202a);overflow:hidden}\n.murmur-signup-top{height:62px;flex:0 0 62px;display:flex;align-items:center;gap:14px;padding:0 max(18px,calc((100vw - 760px)/2));border-bottom:1px solid var(--line,#e3e9e7);background:var(--surface,#fff)}\n.murmur-signup-back{width:38px;height:38px;border:1px solid var(--line,#e3e9e7);border-radius:12px;background:transparent;color:inherit;font-size:22px}\n.murmur-signup-brand{font-weight:850;letter-spacing:-.04em;font-size:1.12rem}\n.murmur-signup-step-label{margin-left:auto;color:var(--muted,#73817e);font-size:.8rem}\n.murmur-signup-main{width:min(100%,680px);margin:0 auto;padding:30px 22px 40px;overflow-y:auto;overscroll-behavior:contain;flex:1}\n.murmur-signup-intro{margin-bottom:24px}\n.murmur-signup-kicker{font-size:.68rem;letter-spacing:.15em;font-weight:850;color:#0a9878}\n.murmur-signup-intro h1{font-size:clamp(1.8rem,5vw,2.35rem);letter-spacing:-.055em;margin:8px 0}\n.murmur-signup-intro p,.murmur-signup-help{color:var(--muted,#73817e);line-height:1.55;margin:0}\n.murmur-signup-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:5px;background:var(--surface-soft,#eaf0ee);border-radius:14px;margin-bottom:22px}\n.murmur-signup-tabs button{min-height:43px;border:0;border-radius:10px;background:transparent;color:var(--muted,#73817e);font-weight:750}\n.murmur-signup-tabs button.active{background:var(--surface,#fff);color:var(--ink,#17202a);box-shadow:0 2px 8px #0000000d}\n.murmur-signup-panel{padding:24px;border:1px solid var(--line,#e3e9e7);border-radius:20px;background:var(--surface,#fff);box-shadow:0 12px 35px #12251d0a}\n.murmur-signup-panel[hidden]{display:none}\n.murmur-signup-panel h2{margin:0 0 6px;font-size:1.2rem}\n.murmur-signup-panel>label,.murmur-signup-two-col label{display:grid;gap:7px;margin-top:17px;font-size:.85rem;font-weight:720}\n.murmur-signup-panel input,.murmur-signup-panel textarea{width:100%;min-height:46px;padding:11px 13px;border:1px solid var(--line,#dce4e1);border-radius:12px;background:var(--bg,#fff);color:var(--ink,#17202a);font:inherit;outline:none}\n.murmur-signup-panel input:focus,.murmur-signup-panel textarea:focus{border-color:#0a9878;box-shadow:0 0 0 3px #0a98781c}\n.murmur-signup-panel textarea{min-height:92px;resize:vertical}\n.murmur-signup-panel small{font-size:.72rem;color:var(--muted,#73817e);font-weight:400}\n.murmur-signup-two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.murmur-signup-password-note{margin:12px 0 20px;color:var(--muted,#73817e);font-size:.76rem}\n.murmur-signup-optional{display:inline;color:var(--muted,#73817e);font-weight:450;font-size:.75rem}\n.murmur-signup-next,.murmur-signup-actions button{width:100%;min-height:48px}\n.murmur-signup-actions{display:flex;gap:10px;margin-top:22px}\n.murmur-signup-actions .btn{flex:1}\n.murmur-signup-screen .murmur-modal-error{width:min(100%,680px);margin:12px auto 0;padding:0 22px;color:#c33b45;line-height:1.5}\n.murmur-signup-footnote{text-align:center;color:var(--muted,#73817e);font-size:.83rem;margin:20px 0 0}\n.murmur-signup-login{border:0;background:transparent;color:#0a9878;font-weight:800}\nhtml[data-theme=\"dark\"] .murmur-signup-screen{background:var(--bg);color:var(--ink)}\nhtml[data-theme=\"dark\"] .murmur-signup-top,html[data-theme=\"dark\"] .murmur-signup-panel{background:var(--surface);border-color:var(--line)}\nhtml[data-theme=\"dark\"] .murmur-signup-panel input,html[data-theme=\"dark\"] .murmur-signup-panel textarea{background:#101b1e;border-color:var(--line);color:var(--ink)}\n@media(max-width:560px){.murmur-signup-main{padding:22px 14px 30px}.murmur-signup-panel{padding:18px 15px}.murmur-signup-two-col{grid-template-columns:1fr;gap:0}.murmur-signup-top{padding:0 14px}}\n";document.head.appendChild(signupScreenStyles);
const $ = (id) => document.getElementById(id);
const authPanel = $("auth");
const appPanel = $("app");
const splash = $("splash");
const authError = $("authError");
let currentUser = null;
let currentProfile = null;
let authSubscription = null;
let pendingPostFile = null;

function showError(message) {
  if (!authError) return;
  const text = String(message ?? "").trim();
  // An empty message means clear the previous error, not show a fallback.
  authError.textContent = text;
  authError.hidden = !text;
  authError.setAttribute("aria-live", text ? "assertive" : "off");
}
function setLoginLoading(active, message = "") {
  const status = $("loginStatus");
  const button = $("loginBtn");
  if (status) { status.hidden = !active; const text = status.querySelector(".login-status-text"); if (text) text.textContent = message; }
  if (button) { button.disabled = active; button.textContent = active ? "Please wait…" : "Log in"; }
}
function showAuth() {
  if (splash) splash.hidden = true;
  if (appPanel) appPanel.hidden = true;
  if (authPanel) authPanel.hidden = false;
}
function showApp() {
  if (splash) splash.hidden = true;
  if (authPanel) authPanel.hidden = true;
  if (appPanel) appPanel.hidden = false;
}
function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

async function loadProfile(user) {
  let profile = await profiles.get(user.id);
  if (!profile) {
    const meta = user.user_metadata || {};
    const { data, error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: meta.full_name || meta.name || (user.email || "Murmur user").split("@")[0],
      username: String(meta.username || "").replace(/^@/, "").toLowerCase() || null,
      bio: meta.bio || "",
      school: meta.school || "",
      location: meta.location || "",
      interests: meta.interests || "",
      avatar_url: meta.avatar_url || meta.picture || null
    }, { onConflict: "id" }).select().single();
    if (error) throw error;
    profile = data;
  }
  currentProfile = profile;
  return profile;
}

async function openPublicProfile(userId) {
  if (!userId) return;
  const main = $("main-content");
  if (!main) return;
  document.querySelector(".murmur-profile-pane")?.remove();
  const previousView = document.querySelector("[data-pane].active")?.dataset.pane || "home";
  const pane = document.createElement("section");
  pane.className = "pane murmur-profile-pane";
  pane.dataset.pane = "profile";
  pane.innerHTML = '<div class="murmur-profile-tab-head"><button type="button" class="murmur-profile-back" aria-label="Back to previous page" title="Back">←</button><h1>Profile</h1></div><div class="murmur-profile-view-content"><p class="empty-state">Loading profile…</p></div>';
  // Keep the site legal footer after dynamically-created profile content.
  // The footer is a direct child of main-content, so appendChild would place
  // the new profile pane after it and make the footer appear above the profile.
  const legalFooter = main.querySelector(":scope > footer.legal-links");
  if (legalFooter) main.insertBefore(pane, legalFooter);
  else main.appendChild(pane);
  switchView("profile");
  const content = pane.querySelector(".murmur-profile-view-content");
  const close = () => { pane.remove(); switchView(previousView === "profile" ? "home" : previousView); };
  pane.querySelector(".murmur-profile-back").addEventListener("click", close);
  try {
    const [{ data: person, error: profileError }, { data: rows, error: postsError }] = await Promise.all([
      supabase.from("murmur_public_profiles").select("id,username,display_name,bio,avatar_url,created_at").eq("id", userId).maybeSingle(),
      supabase.from("posts").select("id,author_id,content,media_url,media_path,media_type,created_at").eq("author_id", userId).order("created_at", { ascending: false }).limit(30)
    ]);
    if (profileError) throw profileError;
    if (postsError) throw postsError;
    if (!person) throw new Error("This profile is unavailable.");
    const isMe = currentUser?.id === userId;
    // Notes are private to their owner; show the signed-in user's active note
    // at the top of their own profile without exposing private notes to others.
    const profileNotes = isMe ? await userNotes.listMine() : [];
    const latestNote = profileNotes[0] || null;
    const rawPosts = rows || [];
    const postIds = rawPosts.map(post => post.id).filter(Boolean);
    const [likeRows, commentRows] = postIds.length ? await Promise.all([
      supabase.from("post_likes").select("post_id").in("post_id", postIds),
      supabase.from("comments").select("post_id").in("post_id", postIds)
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (likeRows.error) throw likeRows.error;
    if (commentRows.error) throw commentRows.error;
    const countByPost = source => (source || []).reduce((counts, row) => {
      counts[row.post_id] = (counts[row.post_id] || 0) + 1;
      return counts;
    }, {});
    const likesByPost = countByPost(likeRows.data);
    const commentsByPost = countByPost(commentRows.data);
    const postRows = await Promise.all(rawPosts.map(async post => ({
      ...post,
      likeCount: likesByPost[post.id] || 0,
      commentCount: commentsByPost[post.id] || 0,
      mediaUrl: post.media_path ? await storage.url("murmur-posts", post.media_path).catch(() => post.media_url || null) : (post.media_url || null)
    })));
    const avatar = person.avatar_url ? '<button type="button" class="murmur-profile-avatar murmur-profile-avatar-open" aria-label="View profile picture"><img class="murmur-profile-avatar-image" src="' + safeText(person.avatar_url) + '" alt=""></button>' : '<div class="murmur-profile-avatar"><span class="murmur-profile-avatar-fallback">' + safeText((person.display_name || person.username || "?").slice(0,1).toUpperCase()) + '</span></div>';
    content.innerHTML = '<div class="murmur-profile-cover"></div><div class="murmur-profile-summary">' + avatar + '<div class="murmur-profile-title"><h2 id="profile-view-title">' + safeText(person.display_name || "Murmur user") + '</h2><p>@' + safeText(person.username || "") + '</p></div>' +
      (isMe ? '<button type="button" class="btn secondary murmur-profile-edit">Edit profile</button>' : '<button type="button" class="btn primary murmur-profile-message" data-profile-message="' + safeText(userId) + '">Message</button>') +
      '</div>' +
      (latestNote ? '<section class="murmur-profile-note" aria-label="Your note"><div class="murmur-profile-note-heading">Your note</div><button type="button" class="murmur-profile-note-content" data-edit-profile-note>' + safeText(latestNote.content) + '</button><small>Tap your note to edit or delete it</small></section>' : (isMe ? '<button type="button" class="murmur-profile-note-empty" data-edit-profile-note>Add a note</button>' : '')) +
      '<p class="murmur-profile-bio">' + safeText(person.bio || "No bio yet.") + '</p><div class="murmur-profile-stats"><strong>' + postRows.length + '</strong> posts</div><h3 class="murmur-profile-post-heading">Posts</h3><div class="murmur-profile-posts">' +
      (postRows.length ? postRows.map(post => '<article class="murmur-profile-post">' + (post.content ? '<p>' + safeText(post.content) + '</p>' : '') +
        (post.mediaUrl ? (post.media_type === "video" ? '<video controls playsinline preload="metadata" src="' + safeText(post.mediaUrl) + '"></video>' : '<img loading="lazy" src="' + safeText(post.mediaUrl) + '" alt="Post photo">') : '') +
        '<div class="murmur-profile-post-stats"><span><strong>' + post.likeCount + '</strong> likes</span><span><strong>' + post.commentCount + '</strong> comments</span></div>' +
        '<small>' + safeText(new Date(post.created_at).toLocaleString()) + '</small></article>').join("") : '<p class="empty-state">No posts yet.</p>') + '</div>';
    content.querySelector(".murmur-profile-avatar-open")?.addEventListener("click", event => {
      const source = event.currentTarget.querySelector("img")?.src;
      if (!source) return;
      const viewer = document.createElement("div");
      viewer.className = "murmur-photo-viewer";
      viewer.innerHTML = '<button type="button" class="murmur-photo-viewer-close" aria-label="Close picture">×</button><img alt="Profile picture">';
      viewer.querySelector("img").src = source;
      const dismiss = () => { viewer.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = keyEvent => { if (keyEvent.key === "Escape") dismiss(); };
      viewer.addEventListener("click", clickEvent => { if (clickEvent.target === viewer || clickEvent.target.closest(".murmur-photo-viewer-close")) dismiss(); });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(viewer);
      viewer.querySelector(".murmur-photo-viewer-close").focus();
    });
    content.querySelector(".murmur-profile-message")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Opening chat…";
      try {
        await openDirectChat(userId);
      } catch (error) {
        const message = error?.message || "Could not open this conversation. Please try again.";
        let notice = content.querySelector(".murmur-profile-chat-error");
        if (!notice) {
          notice = document.createElement("p");
          notice.className = "murmur-profile-chat-error";
          notice.setAttribute("role", "alert");
          button.insertAdjacentElement("afterend", notice);
        }
        notice.textContent = message;
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
    content.querySelector(".murmur-profile-edit")?.addEventListener("click", () => { close(); openProfileEditor(); });
    content.querySelector("[data-edit-profile-note]")?.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.className = "murmur-auth-modal murmur-note-modal";
      overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="profile-note-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2 id="profile-note-title">' + (latestNote ? "Edit your note" : "Create a note") + '</h2><label for="profile-note-content">Your note</label><textarea id="profile-note-content" maxlength="500" rows="5" placeholder="Write a short note…">' + safeText(latestNote?.content || "") + '</textarea><div class="note-editor-footer"><small data-note-count>0 / 500</small><button type="button" class="btn primary" data-save-profile-note>Save note</button></div>' + (latestNote ? '<button type="button" class="note-delete" data-delete-profile-note>Delete note</button>' : '') + '<p class="murmur-modal-error" role="alert"></p></section>';
      document.body.appendChild(overlay);
      const input = overlay.querySelector("#profile-note-content");
      const save = overlay.querySelector("[data-save-profile-note]");
      const errorBox = overlay.querySelector(".murmur-modal-error");
      const closeEditor = () => overlay.remove();
      overlay.querySelector(".murmur-modal-close")?.addEventListener("click", closeEditor);
      overlay.addEventListener("click", event => { if (event.target === overlay) closeEditor(); });
      const count = overlay.querySelector("[data-note-count]");
      const updateCount = () => { count.textContent = input.value.length + " / 500"; };
      updateCount();
      input.addEventListener("input", updateCount);
      save.addEventListener("click", async () => {
        const value = input.value.trim();
        if (!value) { errorBox.textContent = "Write something before saving."; input.focus(); return; }
        save.disabled = true;
        try {
          await userNotes.replaceMine({ content: value });
          closeEditor();
          await openPublicProfile(userId);
        } catch (error) { errorBox.textContent = error.message || "Could not save your note."; save.disabled = false; }
      });
      overlay.querySelector("[data-delete-profile-note]")?.addEventListener("click", async buttonEvent => {
        const button = buttonEvent.currentTarget;
        if (!window.confirm("Delete your note? This cannot be undone.")) return;
        button.disabled = true;
        try {
          await userNotes.removeMine();
          closeEditor();
          await openPublicProfile(userId);
        } catch (error) { errorBox.textContent = error.message || "Could not delete your note."; button.disabled = false; }
      });
      input.focus();
    });
  } catch (error) {
    content.innerHTML = '<p class="empty-state">Could not load this profile: ' + safeText(error.message) + '</p>';
  }
}

function openProfileEditor() {
  const overlay = document.createElement("div");
  overlay.className = "murmur-auth-modal murmur-profile-edit-modal";
  const p = currentProfile || {};
  const initial = (p.display_name || currentUser?.email || "M").slice(0,1).toUpperCase();
  const photo = p.avatar_url
    ? '<img class="murmur-edit-avatar-image" src="' + safeText(p.avatar_url) + '" alt="Current profile photo">'
    : '<span class="murmur-edit-avatar-fallback">' + safeText(initial) + '</span>';
  overlay.innerHTML = '<section class="murmur-profile-edit-card" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">' +
    '<button type="button" class="murmur-modal-close" aria-label="Close">×</button>' +
    '<header class="murmur-profile-edit-heading"><span class="murmur-profile-edit-eyebrow">YOUR PROFILE</span><h2 id="profile-edit-title">Edit profile</h2><p>Update how people see you on Murmur.</p></header>' +
    '<div class="murmur-edit-photo-row"><div class="murmur-edit-avatar" id="murmurEditAvatar">' + photo + '</div><div class="murmur-edit-photo-copy"><strong>Profile photo</strong><span>Choose an image from your device</span><button type="button" class="btn secondary murmur-choose-photo" id="murmurChoosePhoto">Choose photo</button><small class="murmur-edit-photo-name" id="murmurPhotoName">JPG, PNG, WebP or AVIF · up to 5 MB</small></div><input name="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden></div>' +
    '<div class="murmur-profile-edit-fields"><label>Display name<input name="display_name" maxlength="80" autocomplete="name" placeholder="Your name"></label>' +
    '<label>Username<input name="username" maxlength="24" autocomplete="username" placeholder="your.username"></label>' +
    '<label class="murmur-edit-bio-field">Bio<textarea name="bio" maxlength="240" rows="3" placeholder="Tell people a little about yourself"></textarea><small class="murmur-edit-field-hint">Up to 240 characters</small></label>' +
    '<label>School <span class="murmur-edit-optional">Optional</span><input name="school" maxlength="100" placeholder="Your school"></label>' +
    '<label>Location <span class="murmur-edit-optional">Optional</span><input name="location" maxlength="100" placeholder="Your city or area"></label></div>' +
    '<p class="murmur-modal-error" role="alert" aria-live="polite"></p><button type="button" class="btn primary murmur-profile-save">Save changes</button></section>';
  document.body.appendChild(overlay);
  const form = overlay.querySelector("section");
  form.querySelector('[name="display_name"]').value = p.display_name || "";
  form.querySelector('[name="username"]').value = p.username || "";
  form.querySelector('[name="bio"]').value = p.bio || "";
  form.querySelector('[name="school"]').value = p.school || "";
  form.querySelector('[name="location"]').value = p.location || "";
  const photoInput = form.querySelector('[name="avatar"]');
  const photoName = form.querySelector("#murmurPhotoName");
  let previewUrl = null;
  form.querySelector("#murmurChoosePhoto").addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!allowed.includes(file.type)) { photoInput.value = ""; photoName.textContent = "Choose a JPG, PNG, WebP or AVIF image."; return; }
    if (file.size > 5 * 1024 * 1024) { photoInput.value = ""; photoName.textContent = "Photo must be 5 MB or smaller."; return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    form.querySelector("#murmurEditAvatar").innerHTML = '<img class="murmur-edit-avatar-image" src="' + previewUrl + '" alt="Selected profile photo preview">';
    photoName.textContent = file.name;
  });
  const close = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); overlay.remove(); };
  form.querySelector(".murmur-modal-close").addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  form.querySelector(".murmur-profile-save").addEventListener("click", async event => {
    const button = event.currentTarget;
    const errorBox = form.querySelector(".murmur-modal-error");
    errorBox.textContent = "";
    const username = form.querySelector('[name="username"]').value.trim().replace(/^@/, "").toLowerCase();
    const display_name = form.querySelector('[name="display_name"]').value.trim();
    if (!display_name || !/^[a-z0-9_.]{3,24}$/.test(username)) {
      errorBox.textContent = "Enter a display name and a username with 3–24 letters, numbers, dots or underscores.";
      return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const patch = {
        display_name, username,
        bio: form.querySelector('[name="bio"]').value.trim(),
        school: form.querySelector('[name="school"]').value.trim(),
        location: form.querySelector('[name="location"]').value.trim()
      };
      const avatar = photoInput.files?.[0];
      if (avatar) patch.avatar_url = (await storage.uploadAvatar(avatar)).url;
      currentProfile = await profiles.update(patch);
      paintIdentity();
      close();
      if (document.querySelector(".murmur-profile-pane.active")) openPublicProfile(currentUser.id);
    } catch (error) {
      errorBox.textContent = error.message || "Could not save your profile. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Save changes";
    }
  });
}

function paintIdentity() {
  const name = currentProfile?.display_name || currentUser?.email || "Murmur user";
  const username = currentProfile?.username ? "@" + currentProfile.username : "";
  if ($("menuName")) $("menuName").textContent = name;
  if ($("menuUser")) $("menuUser").textContent = username;
  const avatarMarkup = currentProfile?.avatar_url
    ? '<img src="' + safeText(currentProfile.avatar_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
    : safeText(name.slice(0, 1).toUpperCase());
  if ($("composerAvatar")) $("composerAvatar").innerHTML = avatarMarkup;
  if ($("menuAvatar")) $("menuAvatar").innerHTML = avatarMarkup;
}

async function renderPostComments(postId, panel) {
  panel.innerHTML = '<p class="post-comments-loading">Loading comments…</p>';
  try {
    const rows = await comments.list(postId);
    const authorIds = [...new Set(rows.map(row => row.author_id))];
    let people = [];
    if (authorIds.length) {
      const { data, error } = await supabase.from("murmur_public_profiles")
        .select("id,display_name,username").in("id", authorIds);
      if (error) throw error;
      people = data || [];
    }
    const byId = new Map(people.map(person => [person.id, person]));
    panel.innerHTML = '<div class="post-comments-list">' +
      (rows.length ? rows.map(row => {
        const person = byId.get(row.author_id) || {};
        return '<article class="post-comment"><strong>' + safeText(person.display_name || "Murmur user") +
          '</strong><p>' + safeText(row.content) + '</p><small>' +
          safeText(new Date(row.created_at).toLocaleString()) + '</small></article>';
      }).join("") : '<p class="empty-state">No comments yet. Start the conversation.</p>') +
      '</div><form class="post-comment-form"><input name="comment" maxlength="1000" placeholder="Write a comment…" aria-label="Write a comment" required><button class="btn primary" type="submit">Send</button></form>';
    panel.querySelector("form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = form.querySelector('[name="comment"]');
      const button = form.querySelector("button");
      const content = input.value.trim();
      if (!content) return;
      button.disabled = true;
      try {
        await comments.create(postId, content);
        await renderPostComments(postId, panel);
        const count = panel.closest("[data-post-id]")?.querySelector("[data-comment-count]");
        if (count) count.textContent = String(Number(count.textContent || 0) + 1);
      } catch (error) {
        alert(error.message || "Your comment could not be sent.");
        button.disabled = false;
      }
    });
  } catch (error) {
    panel.innerHTML = '<p class="empty-state">Comments could not be loaded: ' + safeText(error.message) + '</p>';
  }
}

async function renderFeed() {
  const root = $("posts");
  if (!root) return;
  // Keep the current feed visible during background refreshes. Only show the
  // initial loading state when there are no posts rendered yet.
  if (!root.querySelector("[data-post-id]")) {
    root.innerHTML = '<p class="empty-state">Loading posts…</p>';
  }
  try {
    const rows = await posts.feed(0);
    if (!rows.length) {
      root.innerHTML = '<p class="empty-state">No posts yet. Share the first update.</p>';
      return;
    }
    const ids = [...new Set(rows.map(row => row.author_id))];
    const postIds = rows.map(row => row.id);
    const [{ data: people, error: peopleError }, { data: userData, error: userError }, likeRows, commentRows] = await Promise.all([
      supabase.from("murmur_public_profiles").select("id,display_name,username,avatar_url").in("id", ids),
      supabase.auth.getUser(),
      postLikes.listForPosts(postIds),
      supabase.from("comments").select("id,post_id").in("post_id", postIds)
    ]);
    if (peopleError) throw peopleError;
    if (userError) throw userError;
    if (commentRows.error) throw commentRows.error;
    const byId = new Map((people || []).map(person => [person.id, person]));
    const likeCounts = new Map();
    const likedByMe = new Set();
    for (const like of likeRows) {
      likeCounts.set(like.post_id, (likeCounts.get(like.post_id) || 0) + 1);
      if (like.user_id === userData.user?.id) likedByMe.add(like.post_id);
    }
    const commentCounts = new Map();
    for (const comment of commentRows.data || []) commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) || 0) + 1);
    const displayRows = await Promise.all(rows.map(async post => ({
      ...post,
      signedMediaUrl: post.media_path ? await storage.url("murmur-posts", post.media_path) : null
    })));
    root.innerHTML = displayRows.map(post => {
      const person = byId.get(post.author_id) || {};
      const author = safeText(person.display_name || "Murmur user");
      const handle = person.username ? "@" + safeText(person.username) : "";
      const media = post.signedMediaUrl ? (post.media_type === "video" ? '<video class="post-media" controls playsinline preload="metadata" src="' + safeText(post.signedMediaUrl) + '"></video>' : '<img class="post-media" loading="lazy" src="' + safeText(post.signedMediaUrl) + '" alt="Post attachment">') : "";
      const likes = likeCounts.get(post.id) || 0;
      const commentCount = commentCounts.get(post.id) || 0;
      const liked = likedByMe.has(post.id);
      return '<article class="post-card" data-post-id="' + safeText(post.id) + '">' +
        '<header class="post-head" data-open-profile="' + safeText(post.author_id) + '"><span class="avatar">' + safeText(author.slice(0,1).toUpperCase()) + '</span><div><strong>' + author + '</strong><small>' + handle + ' · ' + safeText(new Date(post.created_at).toLocaleString()) + '</small></div></header>' +
        (post.content ? '<p class="post-content">' + safeText(post.content) + '</p>' : '') + media +
        '<div class="murmur-post-stats"><span><strong data-like-count>' + likes + '</strong> likes</span><span><strong data-comment-count>' + commentCount + '</strong> comments</span></div>' +
        '<div class="murmur-post-actions"><button type="button" data-like-post="' + safeText(post.id) + '" aria-pressed="' + liked + '" class="' + (liked ? "is-liked" : "") + '">' + (liked ? "Liked" : "Like") + '</button><button type="button" data-open-comments="' + safeText(post.id) + '">Comment</button><button type="button" data-share-post="' + safeText(post.id) + '">Share</button></div>' +
        '<div class="murmur-post-comments" data-comments hidden></div></article>';
    }).join("");

    root.querySelectorAll("[data-like-post]").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      const card = button.closest("[data-post-id]");
      const count = card?.querySelector("[data-like-count]");
      const wasLiked = button.getAttribute("aria-pressed") === "true";
      const nextLiked = !wasLiked;
      const previousCount = Number(count?.textContent || 0);
      // Update this post immediately. A Like must never replace or reload the feed.
      button.setAttribute("aria-pressed", String(nextLiked));
      button.classList.toggle("is-liked", nextLiked);
      button.textContent = nextLiked ? "Liked" : "Like";
      if (count) count.textContent = String(Math.max(0, previousCount + (nextLiked ? 1 : -1)));
      button.disabled = true;
      try {
        await postLikes.toggle(button.dataset.likePost);
      } catch (error) {
        // Roll back only this button if the database rejects the change.
        button.setAttribute("aria-pressed", String(wasLiked));
        button.classList.toggle("is-liked", wasLiked);
        button.textContent = wasLiked ? "Liked" : "Like";
        if (count) count.textContent = String(previousCount);
        alert(error.message || "Could not update your like. Please try again.");
      } finally {
        button.disabled = false;
      }
    }));
    root.querySelectorAll("[data-open-comments]").forEach(button => button.addEventListener("click", async () => {
      const card = button.closest("[data-post-id]");
      const panel = card?.querySelector("[data-comments]");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await renderPostComments(button.dataset.openComments, panel);
    }));
    root.querySelectorAll("[data-share-post]").forEach(button => button.addEventListener("click", async () => {
      const url = location.origin + "/?post=" + encodeURIComponent(button.dataset.sharePost);
      try {
        if (navigator.share) await navigator.share({ title: "Murmur post", url });
        else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); alert("Post link copied."); }
        else prompt("Copy this post link:", url);
      } catch (error) { if (error.name !== "AbortError") alert("Could not share this post."); }
    }));
  } catch (error) {
    console.error("[Murmur feed]", error);
    root.innerHTML = '<div class="empty-state" role="alert"><p>Posts could not be loaded.</p><small>' + safeText(error?.message || "Please try again.") + '</small><button class="btn secondary" type="button" data-retry-feed>Try again</button></div>';
    root.querySelector("[data-retry-feed]")?.addEventListener("click", renderFeed, { once: true });
  }
}

let feedChannel = null;
function watchFeed() {
  if (feedChannel) supabase.removeChannel(feedChannel);
  feedChannel = supabase.channel("murmur-public-posts")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, payload => {
      // Keep existing post cards in place for row updates. Like actions
      // update their own button and count locally; inserts/deletes can refresh
      // the feed without making a Like trigger a full feed reload.
      if (payload.eventType === "UPDATE") {
        // Do not rebuild the feed for row updates. Like counters are often
        // maintained by a database trigger, and the Like handler already
        // updates this viewer's button and count immediately.
        return;
      }
      void renderFeed();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => {
      // Comment updates should refresh counts without flashing a full-page loader.
      void renderFeed();
    })
    .subscribe();
}

function showAccountRestriction(restriction) {
  const overlay = document.createElement("div");
  overlay.className = "murmur-auth-modal";
  const terminated = restriction.status === "terminated";
  const scheduled = restriction.status === "scheduled_deletion";
  const until = restriction.ends_at ? new Date(restriction.ends_at).toLocaleString() : "until further notice";
  const heading = terminated ? "Account terminated" : scheduled ? "Account deletion scheduled" : "Account suspended";
  const detail = terminated
    ? "This Murmur account has been terminated and permanently disabled. Password resets cannot restore access."
    : scheduled
      ? "This Murmur account is scheduled for permanent deletion. Contact Murmur support if you believe this is a mistake."
      : "This Murmur account is temporarily suspended. Access is restricted " + until + ".";
  overlay.innerHTML = '<section role="alertdialog" aria-modal="true"><h2>' + heading + '</h2><p>' + safeText(restriction.reason || detail) + '</p><p>' + safeText(detail) + '</p><button type="button" class="btn primary">Close</button></section>';
  document.body.appendChild(overlay);
  overlay.querySelector("button").addEventListener("click", () => overlay.remove());
}

let enteringUserId = null;
let enterAppTask = null;
let enteredUserId = null;

// Prevent auth and profile screens from spinning forever on stalled requests.
function withAuthTimeout(promise, label, milliseconds = 20000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " is taking too long. Check your connection and try again.")), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

async function enterApp(user) {
  if (!user?.id) throw new Error("Supabase did not return a valid user session.");
  if (enteredUserId === user.id && appPanel && !appPanel.hidden) return;
  if (enterAppTask && enteringUserId === user.id) return enterAppTask;
  enteringUserId = user.id;
  currentUser = user;
  let enterStage = "checking account access";
  enterAppTask = (async () => {
    try {
      setLoginLoading(true, "Checking your account access…");
      const restriction = await withAuthTimeout(accountRestrictions.current(), 'Account access check');
      if (restriction) {
        showAccountRestriction(restriction);
        await supabase.auth.signOut();
        return;
      }
      enterStage = "loading your profile";
      setLoginLoading(true, "Account found. Loading your Murmur profile…");
      currentProfile = await withAuthTimeout(loadProfile(user), 'Profile loading');

      // Authentication and profile loading are complete. Do not send a valid
      // signed-in user back to the login form because a non-critical UI module
      // or realtime subscription fails during startup.
      setLoginLoading(false);
      showApp();
      enteredUserId = user.id;
      try {
        paintIdentity();
      } catch (uiError) {
        console.error("[Murmur identity UI]", uiError);
      }
      try {
        watchFeed();
      } catch (feedError) {
        console.error("[Murmur realtime]", feedError);
      }
      window.dispatchEvent(new CustomEvent("murmur:supabase-user-ready"));
      void renderFeed().catch(error => console.error("[Murmur feed]", error));
    } catch (error) {
      enteredUserId = null;
      console.error("[Murmur profile]", { stage: enterStage, error });
      const detail = typeof error === "string" ? error :
        error?.message || error?.details || error?.hint || error?.code;
      setLoginLoading(false);
      showError(detail
        ? "Your account was found, but Murmur could not finish " + enterStage + ": " + detail
        : "Your account was found, but Murmur could not finish " + enterStage + ". Please try again.");
      showAuth();
    } finally {
      enterAppTask = null;
      enteringUserId = null;
    }
  })();
  return enterAppTask;
}

let loginInProgress = false;
async function login() {
  if (loginInProgress) return;
  showError("");
  setLoginLoading(false);
  const email = $("email")?.value.trim().toLowerCase();
  const password = $("password")?.value || "";
  if (!email || !password) return showError("Enter your email address and password.");
  loginInProgress = true;
  setLoginLoading(true, "Searching for your account in the database…");
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message || "")) {
        const resend = $("resendConfirmationBtn");
        if (resend) resend.hidden = false;
        throw new Error("Please confirm your email address using the link we sent before signing in.");
      }
      if (error.status === 400 || error.code === "invalid_credentials") {
        throw new Error("Email or password is incorrect. Check both fields and try again.");
      }
      if (/fetch|network|timeout/i.test(error.message || "")) {
        throw new Error("Cannot reach Supabase right now. Check your internet connection and try again.");
      }
      throw error;
    }
    if (!data?.user || !data?.session?.access_token || !data?.session?.refresh_token) {
      throw new Error("Supabase did not return a complete sign-in session. Please try again.");
    }
    setLoginLoading(true, "Account found. Securing your sign-in session…");
    // Explicitly persist the session returned by password sign-in before any
    // database/RLS request. This prevents the account check racing session storage.
    const { data: savedSession, error: sessionError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (sessionError) throw sessionError;
    if (!savedSession?.session?.user?.id) throw new Error("Your sign-in session could not be saved. Please try again.");
    setLoginLoading(true, "Account found. Checking your account and loading your profile…");
    await enterApp(savedSession.session.user);
  } catch (error) {
    console.error("[Murmur login]", error);
    // Supabase can establish the session even if a later client-side step
    // rejects. Recover from the persisted session before showing a login error.
    let recoveredUser = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      recoveredUser = sessionData?.session?.user || null;
    } catch (sessionError) {
      console.error("[Murmur session recovery]", sessionError);
    }
    if (recoveredUser?.id) {
      try {
        await enterApp(recoveredUser);
        if (enteredUserId === recoveredUser.id) return;
      } catch (recoveryError) {
        console.error("[Murmur login recovery]", recoveryError);
        error = recoveryError;
      }
    }
    const detail = error?.message || error?.details || error?.hint || error?.code;
    setLoginLoading(false);
    showError(detail
      ? "Murmur could not finish signing you in: " + detail
      : "Murmur could not finish signing you in. Please check your connection and try again.");
  } finally {
    loginInProgress = false;
    if (!enteredUserId) setLoginLoading(false);
  }
}

function openSignup() {
  const overlay = document.createElement("div");
  overlay.className = "murmur-signup-screen";
  overlay.innerHTML = `
    <header class="murmur-signup-top"><button type="button" class="murmur-signup-back" aria-label="Back to login">←</button><div class="murmur-signup-brand">Murmur</div><span class="murmur-signup-step-label">Create account</span></header>
    <main class="murmur-signup-main">
      <div class="murmur-signup-intro"><span class="murmur-signup-kicker">JOIN MURMUR</span><h1>Create your account</h1><p>Set up your account and profile to start connecting with people.</p></div>
      <nav class="murmur-signup-tabs" aria-label="Registration sections"><button type="button" class="active" data-signup-tab="account" aria-selected="true">1. Account</button><button type="button" data-signup-tab="profile" aria-selected="false">2. Profile</button></nav>
      <form class="murmur-signup-form" novalidate>
        <section class="murmur-signup-panel" data-signup-panel="account">
          <h2>Account details</h2><p class="murmur-signup-help">These details are used to create and secure your Murmur account.</p>
          <label>Full name<input name="name" maxlength="80" autocomplete="name" placeholder="Your full name" required></label>
          <label>Username<input name="username" maxlength="24" minlength="3" pattern="[A-Za-z0-9_.]{3,24}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Choose a username" required><small>3–24 letters, numbers, dots or underscores</small></label>
          <label>Email address<input name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required></label>
          <div class="murmur-signup-two-col"><label>Password<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters" required></label><label>Confirm password<input name="confirm_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Enter password again" required></label></div>
          <div class="murmur-signup-password-note">Use at least 8 characters. Never share your password.</div>
          <button type="button" class="btn primary murmur-signup-next">Continue to profile</button>
        </section>
        <section class="murmur-signup-panel" data-signup-panel="profile" hidden>
          <h2>Profile details</h2><p class="murmur-signup-help">Add a little information so friends can recognize you. You can update these details later.</p>
          <label>Bio <span class="murmur-signup-optional">Optional</span><textarea name="bio" maxlength="240" rows="3" placeholder="Tell people a little about yourself"></textarea><small>Up to 240 characters</small></label>
          <label>School <span class="murmur-signup-optional">Optional</span><input name="school" maxlength="100" placeholder="Your school"></label>
          <label>Location <span class="murmur-signup-optional">Optional</span><input name="location" maxlength="100" placeholder="Your city or area"></label>
          <label>Interests <span class="murmur-signup-optional">Optional</span><input name="interests" maxlength="200" placeholder="Music, games, sports..."></label>
          <div class="murmur-signup-actions"><button type="button" class="btn secondary murmur-signup-previous">Back</button><button type="submit" class="btn primary murmur-signup-submit">Create account</button></div>
        </section>
      </form>
      <p class="murmur-modal-error" role="alert" aria-live="polite"></p>
      <p class="murmur-signup-footnote">Already have an account? <button type="button" class="murmur-signup-login">Log in</button></p>
    </main>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector("form");
  const errorBox = overlay.querySelector(".murmur-modal-error");
  const showTab = tab => {
    overlay.querySelectorAll("[data-signup-panel]").forEach(panel => panel.hidden = panel.dataset.signupPanel !== tab);
    overlay.querySelectorAll("[data-signup-tab]").forEach(button => {
      const active = button.dataset.signupTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    overlay.querySelector(".murmur-signup-step-label").textContent = tab === "account" ? "Step 1 of 2" : "Step 2 of 2";
    overlay.querySelector(".murmur-signup-main").scrollTop = 0;
    errorBox.textContent = "";
  };
  const close = () => overlay.remove();
  overlay.querySelector(".murmur-signup-back").addEventListener("click", close);
  overlay.querySelector(".murmur-signup-login").addEventListener("click", close);
  overlay.querySelector('[data-signup-tab="account"]').addEventListener("click", () => showTab("account"));
  overlay.querySelector('[data-signup-tab="profile"]').addEventListener("click", () => {
    if (validateAccount()) showTab("profile");
  });
  function validateAccount() {
    const name = form.elements.name.value.trim();
    const username = form.elements.username.value.trim().replace(/^@/, "").toLowerCase();
    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    const confirm = form.elements.confirm_password.value;
    if (!name || !/^[a-z0-9_.]{3,24}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password !== confirm) {
      const message = password !== confirm
        ? "Your passwords do not match."
        : "Complete your name, valid username, email and password (at least 8 characters).";
      showTab("account");
      errorBox.textContent = message;
      return false;
    }
    return true;
  }
  overlay.querySelector(".murmur-signup-next").addEventListener("click", () => { if (validateAccount()) showTab("profile"); });
  overlay.querySelector(".murmur-signup-previous").addEventListener("click", () => showTab("account"));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!validateAccount()) return;
    const button = overlay.querySelector(".murmur-signup-submit");
    const name = form.elements.name.value.trim();
    const username = form.elements.username.value.trim().replace(/^@/, "").toLowerCase();
    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    button.disabled = true;
    button.textContent = "Creating account…";
    errorBox.textContent = "";
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: {
          full_name: name, username,
          bio: form.elements.bio.value.trim(),
          school: form.elements.school.value.trim(),
          location: form.elements.location.value.trim(),
          interests: form.elements.interests.value.trim()
        }, emailRedirectTo: location.origin + "/" }
      });
      if (error) throw error;
      if (data.session && data.user) {
        close();
        await enterApp(data.user);
        if (enteredUserId === data.user.id && appPanel && !appPanel.hidden) {
          const notice = document.createElement("div");
          notice.setAttribute("role", "status");
          notice.setAttribute("aria-live", "polite");
          notice.textContent = "Your account was created successfully.";
          notice.style.cssText = "position:fixed;z-index:10050;top:calc(env(safe-area-inset-top,0px) + 16px);left:50%;transform:translateX(-50%);width:min(calc(100% - 32px),420px);padding:14px 18px;border-radius:14px;background:#087f62;color:#fff;text-align:center;font-weight:700;box-shadow:0 8px 28px #0003";
          document.body.appendChild(notice);
          window.setTimeout(() => notice.remove(), 4500);
        }
      } else {
        errorBox.textContent = "Your account was created, but Supabase did not start a login session. Check that Email → Confirm email is turned off in your Supabase Auth settings, then try again.";
        button.disabled = false;
        button.textContent = "Try again";
      }
    } catch (error) {
      const message = String(error?.message || "Could not create your account. Please try again.");
      if (/duplicate key|profiles_username_key|unique constraint/i.test(message) && /username/i.test(message)) {
        errorBox.textContent = "That username is already taken. Choose another username.";
      } else if (/user already registered|already been registered|email.*already/i.test(message)) {
        errorBox.textContent = "An account already uses that email address. Log in or use a different email.";
      } else if (/password.*(weak|short)|at least 8 characters/i.test(message)) {
        errorBox.textContent = "Choose a stronger password with at least 8 characters.";
      } else if (/rate limit|too many requests/i.test(message)) {
        errorBox.textContent = "Too many sign-up attempts. Please wait a few minutes and try again.";
      } else if (/invalid email/i.test(message)) {
        errorBox.textContent = "Enter a valid email address.";
      } else {
        errorBox.textContent = message;
      }
    } finally {
      if (button.isConnected && !button.hidden) { button.disabled = false; button.textContent = "Create account"; }
    }
  });
  showTab("account");
}

function openForgotPasswordPage() {
  document.querySelector(".murmur-recovery-screen")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "murmur-recovery-screen";
  overlay.innerHTML = `
    <header class="murmur-recovery-top"><button type="button" data-recovery-back aria-label="Back to login">←</button><strong>Murmur</strong></header>
    <main class="murmur-recovery-card">
      <span class="murmur-recovery-eyebrow">ACCOUNT RECOVERY</span>
      <h1>Forgot password?</h1>
      <p>Enter the email address connected to your Murmur account. If it is registered, we’ll send you a secure password reset link.</p>
      <form data-forgot-form>
        <label for="murmurRecoveryEmail">Email address</label>
        <input id="murmurRecoveryEmail" name="email" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required>
        <button class="btn primary" type="submit">Send reset link</button>
      </form>
      <p class="murmur-recovery-status" role="status" aria-live="polite"></p>
      <div class="murmur-recovery-search" hidden role="status" aria-live="polite"><span class="murmur-recovery-spinner" aria-hidden="true"></span><span>Searching for your account in Murmur…</span></div>
      <p class="murmur-recovery-countdown" role="timer" aria-live="off"></p>
      <p class="murmur-recovery-footnote">If your account is suspended or terminated, changing your password will not restore access. Permanently deleted accounts cannot be recovered.</p>
    </main>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("[data-recovery-back]").addEventListener("click", close);
  overlay.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim().toLowerCase();
    const button = form.querySelector("button[type=submit]");
    const status = overlay.querySelector(".murmur-recovery-status");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.textContent = "Enter a valid email address.";
      form.elements.email.focus();
      return;
    }
    const searchState = overlay.querySelector(".murmur-recovery-search");
    const countdown = overlay.querySelector(".murmur-recovery-countdown");
    button.disabled = true;
    button.textContent = "Searching…";
    status.textContent = "";
    countdown.textContent = "";
    searchState.hidden = false;
    try {
      // The protected Edge Function checks account state before requesting a reset.
      const { data, error } = await withAuthTimeout(
        supabase.functions.invoke("murmur-password-reset-check", { body: { email } }),
        "Checking your Murmur account",
        25000
      );
      if (error) {
        let payload = null;
        try { payload = await error.context?.json?.(); } catch (_) {}
        if (payload?.message) {
          searchState.hidden = true;
          status.textContent = payload.message;
          if (payload.status === "rate_limited") button.dataset.cooldown = "300";
          button.textContent = "Try again";
          return;
        }
        throw error;
      }
      searchState.hidden = true;
      status.textContent = data?.message || "Murmur could not read the account check result. Please try again.";
      if (data?.status === "sent") {
        button.dataset.cooldown = "60";
        button.textContent = "Send another link";
      } else if (data?.status === "rate_limited") {
        button.dataset.cooldown = "300";
        button.textContent = "Send another link";
      } else {
        button.textContent = "Check another email";
      }
    } catch (error) {
      searchState.hidden = true;
      const message = String(error.message || "");
      const rateLimit = /rate limit|too many requests|over_email_send_rate_limit/i.test(message);
      const waitMatch = message.match(/after\s+(\d+)\s+seconds?/i);
      if (rateLimit) {
        button.dataset.cooldown = String(waitMatch ? Math.min(120, Math.max(1, Number(waitMatch[1]))) : 60);
        status.textContent = "Murmur is protecting your inbox. Please wait before requesting another reset email.";
        button.textContent = "Send another link";
      } else if (/taking too long|timeout/i.test(message)) {
        button.dataset.cooldown = "60";
        status.textContent = "The server is taking too long to respond. The request may still be processing. Wait a minute before trying again.";
        button.textContent = "Send another link";
      } else {
        status.textContent = "We could not request a reset link right now. Please check your connection and try again.";
        button.textContent = "Try again";
      }
    } finally {
      const cooldown = Number(button.dataset.cooldown || 0);
      delete button.dataset.cooldown;
      if (cooldown > 0) {
        let remaining = cooldown;
        const countdown = overlay.querySelector(".murmur-recovery-countdown");
        const showRemaining = () => {
          countdown.textContent = "You can request another reset link in " + remaining + " seconds.";
          button.textContent = "Send again in " + remaining + "s";
        };
        button.disabled = true;
        showRemaining();
        const timer = setInterval(() => {
          remaining -= 1;
          if (!button.isConnected || remaining <= 0) {
            clearInterval(timer);
            if (button.isConnected) {
              button.disabled = false;
              button.textContent = "Send another link";
              countdown.textContent = "You can request another reset link now.";
            }
          } else {
            showRemaining();
          }
        }, 1000);
      } else {
        button.disabled = false;
      }
    }
  });
  overlay.querySelector("#murmurRecoveryEmail").focus();
}

function openResetPasswordPage() {
  const existing = document.querySelector(".murmur-recovery-screen");
  if (existing?.querySelector("[data-new-password-form]")) {
    existing.querySelector("#murmurNewPassword")?.focus();
    return;
  }
  existing?.remove();
  const overlay = document.createElement("div");
  overlay.className = "murmur-recovery-screen";
  overlay.innerHTML = `
    <header class="murmur-recovery-top"><strong>Murmur</strong></header>
    <main class="murmur-recovery-card">
      <span class="murmur-recovery-eyebrow">SECURE YOUR ACCOUNT</span>
      <h1>Reset password</h1>
      <p>Create a new password for your Murmur account.</p>
      <form data-new-password-form>
        <label for="murmurNewPassword">New password</label>
        <input id="murmurNewPassword" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters" required>
        <label for="murmurConfirmPassword">Confirm new password</label>
        <input id="murmurConfirmPassword" name="confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Enter it again" required>
        <button class="btn primary" type="submit">Save new password</button>
      </form>
      <p class="murmur-recovery-status" role="status" aria-live="polite"></p>
    </main>`;
  document.body.appendChild(overlay);
  overlay.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.elements.password.value;
    const confirm = form.elements.confirm.value;
    const button = form.querySelector("button[type=submit]");
    const status = overlay.querySelector(".murmur-recovery-status");
    if (password.length < 8) { status.textContent = "Use at least 8 characters."; return; }
    if (password !== confirm) { status.textContent = "Your passwords do not match."; form.elements.confirm.focus(); return; }
    button.disabled = true;
    button.textContent = "Updating password…";
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      status.textContent = "Your password has been updated. You can now log in with your new password.";
      form.remove();
      history.replaceState(null, "", location.pathname);
      await supabase.auth.signOut();
      setTimeout(() => overlay.remove(), 2200);
    } catch (error) {
      status.textContent = /session|token|expired|invalid/i.test(String(error.message || ""))
        ? "This reset link is invalid or has expired. Request a new password reset link."
        : error.message || "Could not update your password. Please try again.";
      button.disabled = false;
      button.textContent = "Save new password";
    }
  });
  overlay.querySelector("#murmurNewPassword").focus();
}

async function resetPassword() {
  openForgotPasswordPage();
}

async function resendSignupConfirmation() {
  const email = $("email")?.value.trim().toLowerCase();
  if (!email) return showError("Enter your email address first.");
  const button = $("resendConfirmationBtn");
  if (button) button.disabled = true;
  try {
    const { error } = await withAuthTimeout(supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: location.origin + "/" }
    }), 'Resending the confirmation email');
    if (error) throw error;
    showError("If confirmation is still required, a new email has been requested. Check your inbox and spam folder.");
  } catch (error) {
    showError(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function showAuthRedirectError() {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const code = params.get("error_code") || hash.get("error_code");
  const description = params.get("error_description") || hash.get("error_description");
  if (!code && !description) return;
  showError(description || "Authentication could not be completed. Please try again.");
}

async function createPost() {
  const content = $("postInput")?.value.trim();
  if (!content && !pendingPostFile) return;
  const button = $("postBtn");
  if (button) button.disabled = true;
  try {
    let mediaPath = null, mediaType = null;
    if (pendingPostFile) {
      const uploaded = await storage.uploadMedia(pendingPostFile, "posts");
      mediaPath = uploaded.path;
      mediaType = pendingPostFile.type.startsWith("video/") ? "video" : "image";
    }
    await posts.create({ content, visibility: "public", mediaPath, mediaType });
    $("postInput").value = "";
    pendingPostFile = null;
    const status = $("postMediaStatus"); if (status) status.textContent = "";
    if (button) button.hidden = true;
    if ($("postMediaPicker")) $("postMediaPicker").value = "";
    if ($("postMediaStatus")) $("postMediaStatus").textContent = "";
    await renderFeed();
    switchView("home");
  } catch (error) { alert(error.message); }
  finally { if (button) button.disabled = false; }
}

function switchView(view, sourceButton = null) {
  const target = Array.from(document.querySelectorAll("[data-pane]")).find(pane => pane.dataset.pane === view);
  if (!target) return false;
  if (view !== "post") {
    const composer = $("postComposer");
    if ($("postMediaButton")) $("postMediaButton").hidden = true;
    composer?.classList.remove("is-editing");
    if ($("postInput")) $("postInput").value = "";
    if ($("postMediaPicker")) $("postMediaPicker").value = "";
    if ($("postMediaStatus")) $("postMediaStatus").textContent = "";
    if ($("postBtn")) $("postBtn").hidden = true;
    pendingPostFile = null;
  }
  document.querySelectorAll(".fb-nav [data-view]").forEach(item => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll("[data-pane]").forEach(pane => {
    const active = pane.dataset.pane === view;
    pane.classList.toggle("active", active);
    pane.hidden = !active;
  });
  window.dispatchEvent(new CustomEvent("murmur:view-changed", { detail: { view } }));
  if (view === "home") renderFeed();
  if (sourceButton?.closest(".fb-nav")) window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}


function openMenuDialog(title, bodyHtml, onReady) {
  document.querySelector(".murmur-menu-dialog")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "murmur-auth-modal murmur-menu-dialog";
  overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-label="' + safeText(title) + '"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2>' + safeText(title) + '</h2><div class="murmur-menu-dialog-body">' + bodyHtml + '</div></section>';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".murmur-modal-close")?.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  onReady?.(overlay, close);
  return overlay;
}

function applyMurmurTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  try { localStorage.setItem("murmur-theme", selected); } catch {}
  const button = $("themeBtn");
  if (button) button.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-moon"/></svg> ' + (selected === "dark" ? "Light mode" : "Dark mode");
}
try {
  applyMurmurTheme(localStorage.getItem("murmur-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
} catch { applyMurmurTheme("light"); }

function openAccountSettings() {
  const email = currentUser?.email || "";
  const overlay = openMenuDialog("Account settings",
    '<p>Signed in as <strong>' + safeText(email) + '</strong></p>' +
    '<label>New email address<input type="email" name="email" autocomplete="email" value="' + safeText(email) + '" maxlength="254"></label>' +
    '<button class="btn secondary" type="button" data-change-email>Update email</button>' +
    '<label>New password<input type="password" name="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters"></label>' +
    '<button class="btn primary" type="button" data-change-password>Update password</button>' +
    '<p class="murmur-modal-error" role="alert" aria-live="polite"></p>');
  const errorBox = overlay.querySelector(".murmur-modal-error");
  overlay.querySelector("[data-change-email]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const nextEmail = overlay.querySelector('[name="email"]').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) { errorBox.textContent = "Enter a valid email address."; return; }
    button.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ email: nextEmail });
      if (error) throw error;
      errorBox.textContent = "Email update requested. Check your inbox to confirm the change.";
    } catch (error) { errorBox.textContent = error.message || "Could not update email."; }
    finally { button.disabled = false; }
  });
  overlay.querySelector("[data-change-password]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const password = overlay.querySelector('[name="password"]').value;
    if (password.length < 8) { errorBox.textContent = "Use a password with at least 8 characters."; return; }
    button.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      overlay.querySelector('[name="password"]').value = "";
      errorBox.textContent = "Your password was updated.";
    } catch (error) { errorBox.textContent = error.message || "Could not update password."; }
    finally { button.disabled = false; }
  });
}

async function openBlockedPeople() {
  const overlay = openMenuDialog("Blocked people", '<p>Loading your blocked accounts…</p>');
  const body = overlay.querySelector(".murmur-menu-dialog-body");
  try {
    const { data, error } = await supabase.from("blocks").select("blocked_id,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    if (!data?.length) { body.innerHTML = '<p>You have not blocked anyone.</p>'; return; }
    const ids = data.map(row => row.blocked_id);
    const { data: people, error: peopleError } = await supabase.from("murmur_public_profiles").select("id,display_name,username").in("id", ids);
    if (peopleError) throw peopleError;
    const byId = new Map((people || []).map(person => [person.id, person]));
    body.innerHTML = data.map(row => {
      const person = byId.get(row.blocked_id) || {};
      return '<div class="murmur-blocked-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line,#ddd)"><span><strong>' + safeText(person.display_name || "Murmur user") + '</strong><small style="display:block;color:var(--muted)"> ' + safeText(person.username ? "@" + person.username : "") + '</small></span><button class="btn secondary" type="button" data-unblock="' + safeText(row.blocked_id) + '">Unblock</button></div>';
    }).join("");
    body.addEventListener("click", async event => {
      const button = event.target.closest("[data-unblock]");
      if (!button) return;
      button.disabled = true;
      try {
        const { error: removeError } = await supabase.from("blocks").delete().eq("blocked_id", button.dataset.unblock);
        if (removeError) throw removeError;
        button.closest(".murmur-blocked-row")?.remove();
        if (!body.querySelector(".murmur-blocked-row")) body.innerHTML = "<p>You have not blocked anyone.</p>";
      } catch (removeError) { button.disabled = false; alert(removeError.message || "Could not unblock this account."); }
    });
  } catch (error) {
    body.innerHTML = '<p role="alert">Could not load blocked people: ' + safeText(error.message) + '</p><button class="btn secondary" type="button" data-retry-blocked>Try again</button>';
    body.querySelector("[data-retry-blocked]")?.addEventListener("click", () => { overlay.remove(); openBlockedPeople(); });
  }
}

async function openAppPermissions() {
  const overlay = openMenuDialog("App permissions",
    '<p>Control what Murmur can access. Your browser or device will ask before granting access. Murmur only requests a permission when you choose its action.</p>' +
    '<div class="murmur-permission-list" data-permission-list></div>' +
    '<input type="file" data-permission-file-picker accept="image/*,video/*,application/pdf" multiple hidden>' +
    '<p class="murmur-modal-error" role="status" aria-live="polite"></p>' +
    '<p class="murmur-permission-note">You can revoke permissions later in your browser or device settings. Photos and files are selected individually; contacts are only available through a contact picker where supported.</p>');
  const list = overlay.querySelector("[data-permission-list]");
  const message = overlay.querySelector(".murmur-modal-error");
  const filePicker = overlay.querySelector("[data-permission-file-picker]");

  const definitions = [
    { key: "notifications", label: "Notifications", detail: "Receive supported Murmur alerts", action: "Enable" },
    { key: "camera", label: "Camera", detail: "Take profile pictures and photos", action: "Allow camera" },
    { key: "microphone", label: "Microphone", detail: "Record voice messages and use supported calls", action: "Allow microphone" },
    { key: "geolocation", label: "Location", detail: "Share your location only when you choose", action: "Allow location" },
    { key: "files", label: "Photos and files", detail: "Choose the specific files you want to upload", action: "Choose files" },
    { key: "contacts", label: "Contacts", detail: "Choose individual contacts; no full address-book access", action: "Choose contacts" }
  ];

  const statusText = value => ({
    granted: "Allowed",
    denied: "Blocked",
    prompt: "Not asked",
    default: "Not asked",
    unsupported: "Not supported",
    selected: "Selected by you",
    peruse: "Only when used"
  }[value] || value || "Unknown");

  async function readStatus(definition) {
    if (definition.key === "notifications") {
      if (!("Notification" in window)) return "unsupported";
      return Notification.permission === "default" ? "prompt" : Notification.permission;
    }
    if (definition.key === "files") return "peruse";
    if (definition.key === "contacts") return ("contacts" in navigator && navigator.contacts?.select) ? "peruse" : "unsupported";
    if (!navigator.permissions?.query) return "peruse";
    try {
      const permission = await navigator.permissions.query({ name: definition.key });
      return permission.state;
    } catch (_) {
      return "peruse";
    }
  }

  async function refreshStatuses() {
    const statuses = await Promise.all(definitions.map(readStatus));
    list.innerHTML = definitions.map((definition, index) => {
      const state = statuses[index];
      const isUnsupported = state === "unsupported";
      const actionLabel = state === "granted" && ["notifications", "camera", "microphone", "geolocation"].includes(definition.key)
        ? "Allowed" : definition.action;
      return '<div class="murmur-permission-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line,#ddd)">' +
        '<div style="min-width:0;flex:1"><strong>' + safeText(definition.label) + '</strong>' +
        '<small style="display:block;color:var(--muted);margin-top:3px">' + safeText(definition.detail) + '</small>' +
        '<small style="display:block;margin-top:5px">Status: <strong data-permission-status="' + safeText(definition.key) + '">' + safeText(statusText(state)) + '</strong></small></div>' +
        '<button class="btn secondary" type="button" data-permission-action="' + safeText(definition.key) + '"' +
        (isUnsupported ? " disabled" : "") + (actionLabel === "Allowed" ? " disabled" : "") + '>' + safeText(actionLabel) + '</button></div>';
    }).join("");
  }

  function showPermissionNotice(kind) {
    const copy = {
      notifications: ["Notifications", "Murmur wants to send notifications about messages, friend requests and important account activity. Your device may show an official permission prompt after you continue."],
      camera: ["Camera", "Murmur wants to use your camera when you take a profile picture or photo. The camera is only requested for this feature."],
      microphone: ["Microphone", "Murmur wants to use your microphone for voice messages and supported calls."],
      geolocation: ["Location", "Murmur wants to access your location when you choose to share it. This permission check does not save or share your coordinates."],
      files: ["Photos and files", "Murmur wants you to choose the specific photos, videos or documents you want to upload."],
      contacts: ["Contacts", "Murmur wants you to choose individual contacts to find friends. It does not access your full address book."]
    }[kind];
    if (!copy) return Promise.resolve(false);
    return new Promise(resolve => {
      const notice = document.createElement("div");
      notice.className = "murmur-auth-modal murmur-permission-consent";
      notice.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="murmurPermissionNoticeTitle"><h2 id="murmurPermissionNoticeTitle">Permission needed: ' + safeText(copy[0]) + '</h2><p>' + safeText(copy[1]) + '</p><p class="murmur-permission-note">You can choose Not now. Continue will open the official device or browser permission prompt when supported.</p><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px"><button type="button" class="btn secondary" data-consent-deny>Not now</button><button type="button" class="btn primary" data-consent-allow>Continue</button></div></section>';
      document.body.appendChild(notice);
      const finish = value => { notice.remove(); resolve(value); };
      notice.querySelector("[data-consent-deny]")?.addEventListener("click", () => finish(false), { once: true });
      notice.querySelector("[data-consent-allow]")?.addEventListener("click", () => finish(true), { once: true });
      notice.addEventListener('click', event => { if (event.target === notice) finish(false); });
    });
  }
  async function requestDevicePermission(kind) {
    if (!window.isSecureContext) throw new Error("Device permissions require HTTPS. Open Murmur using its secure HTTPS address.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone access are not supported in this browser.");
    const constraints = kind === "camera" ? { video: true } : { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach(track => track.stop());
  }

  function requestLocationPermission() {
    if (!window.isSecureContext) return Promise.reject(new Error("Location access requires HTTPS."));
    if (!navigator.geolocation) return Promise.reject(new Error("Location access is not supported by this browser."));
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(),
        error => reject(new Error(error.code === 1 ? "Location permission was denied. You can change it in your browser's site settings." : error.code === 3 ? "The location request timed out. Try again." : "Your device could not determine your location.")),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  async function requestContacts() {
    if (!navigator.contacts?.select) throw new Error("Contact picker is not supported on this browser or device.");
    // The user chooses exactly which contacts to share. Murmur does not save or transmit this selection here.
    await navigator.contacts.select(["name", "email", "tel"], { multiple: true });
  }

  filePicker.addEventListener("change", () => {
    const count = filePicker.files?.length || 0;
    message.textContent = count
      ? count + " file(s) selected. Nothing was uploaded. Choose files again when using an upload feature."
      : "No files were selected.";
    filePicker.value = "";
  });

  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-permission-action]");
    if (!button || button.disabled) return;
    const kind = button.dataset.permissionAction;
    button.disabled = true;
    message.textContent = "Waiting for your choice…";
    try {
      const consentGiven = await showPermissionNotice(kind);
      if (!consentGiven) {
        message.textContent = "Permission request cancelled. Murmur has not accessed this feature.";
        return;
      }
      if (kind === "notifications") {
        if (!("Notification" in window)) throw new Error("Notifications are not supported by this browser.");
        if (!window.isSecureContext) throw new Error("Notifications require HTTPS.");
        const permission = await Notification.requestPermission();
        message.textContent = permission === "granted"
          ? "Notifications are allowed. Murmur can now send supported browser notifications."
          : permission === "denied"
            ? "Notifications were blocked. Change this in your browser's site settings."
            : "No permission was granted. You can decide later.";
      } else if (kind === "camera" || kind === "microphone") {
        await requestDevicePermission(kind);
        message.textContent = kind === "camera"
          ? "Camera access was granted. The camera was immediately stopped; Murmur did not take a photo."
          : "Microphone access was granted. The microphone was immediately stopped; Murmur did not record audio.";
      } else if (kind === "geolocation") {
        await requestLocationPermission();
        message.textContent = "Location access was granted. Murmur did not save or share your coordinates.";
      } else if (kind === "files") {
        message.textContent = "Choose the files you want to make available. Selecting files here will not upload them.";
        filePicker.click();
      } else if (kind === "contacts") {
        await requestContacts();
        message.textContent = "Contact selection completed. Murmur did not save or transmit the selected contacts.";
      }
    } catch (error) {
      message.textContent = error?.message || "Permission could not be requested. Check your device or browser settings.";
    } finally {
      await refreshStatuses();
    }
  });

  await refreshStatuses();
}
function openPerformanceInfo() {
  const connection = navigator.connection?.effectiveType || "Not reported";
  const memory = navigator.deviceMemory ? navigator.deviceMemory + " GB" : "Not reported";
  const cores = navigator.hardwareConcurrency || "Not reported";
  openMenuDialog("Performance & connection",
    '<p>Connection: <strong>' + safeText(navigator.onLine ? "Online" : "Offline") + '</strong></p>' +
    '<p>Network type: <strong>' + safeText(connection) + '</strong></p>' +
    '<p>Device memory: <strong>' + safeText(memory) + '</strong></p>' +
    '<p>CPU threads: <strong>' + safeText(cores) + '</strong></p>' +
    '<p>For best performance, keep Murmur updated and use a stable connection.</p>');
}

function openDeleteAccountInfo() {
  openMenuDialog("Delete account",
    '<p>Account deletion must be securely processed on the server so your authentication account and personal data are removed together.</p><p>This app does not currently expose a verified self-service deletion endpoint. Your account has <strong>not</strong> been deleted.</p><p>Use the Help &amp; support section to submit a deletion request.</p>');
}

function handleMenuAction(action) {
  const views = { reels: "reels", friends: "friends", chats: "chats", alerts: "alerts", feeds: "home" };
  if (views[action]) { switchView(views[action]); return; }
  if (action === "performance") { openPerformanceInfo(); return; }
  if (action === "permissions") { openAppPermissions(); return; }
  if (action === "privacy") { location.href = "/privacy"; return; }
  if (action === "cookies") { location.href = "/cookies"; return; }
  if (action === "account-settings") { openAccountSettings(); return; }
  if (action === "help") {
    openMenuDialog("Help centre", '<p>For account access, chat, privacy or technical problems, use <strong>Report a problem</strong> so the Murmur team can review the details.</p><button class="btn primary" type="button" data-open-report>Report a problem</button>')
      .querySelector("[data-open-report]")?.addEventListener("click", openReportDialog);
    return;
  }
  if (action === "report") { openReportDialog(); return; }
  if (action === "add-account") {
    openMenuDialog("Add account", '<p>To use another Murmur account on this device, sign out of the current account and sign in with the other account.</p><button class="btn primary" type="button" data-switch-account>Sign out</button>')
      .querySelector("[data-switch-account]")?.addEventListener("click", async () => { const { error } = await supabase.auth.signOut(); if (error) alert(error.message); });
    return;
  }
  if (action === "saved" || action === "memories") {
    openMenuDialog(action === "saved" ? "Saved posts" : "Memories", '<p>This section is not available yet. Your account and existing posts have not been changed.</p>');
  }
}

function openReportDialog() {
  const overlay = openMenuDialog("Report a problem",
    '<label>What happened?<select name="reason"><option value="bug">App button or feature not working</option><option value="chat">Chat or messages</option><option value="account">Account or sign-in</option><option value="privacy">Privacy or safety</option><option value="other">Other</option></select></label>' +
    '<label>Details<textarea name="details" rows="4" maxlength="2000" placeholder="Describe what happened"></textarea></label>' +
    '<p class="murmur-modal-error" role="alert"></p><button class="btn primary" type="button" data-submit-report>Send report</button>');
  overlay.querySelector("[data-submit-report]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const reason = overlay.querySelector('[name="reason"]').value;
    const details = overlay.querySelector('[name="details"]').value.trim();
    const errorBox = overlay.querySelector(".murmur-modal-error");
    if (!details) { errorBox.textContent = "Describe the problem before sending."; return; }
    button.disabled = true;
    try {
      const { error } = await supabase.from("reports").insert({ reporter_id: currentUser.id, reason, details });
      if (error) throw error;
      errorBox.textContent = "Your report was sent. Thank you.";
      button.hidden = true;
    } catch (error) { errorBox.textContent = error.message || "Could not send your report."; }
    finally { button.disabled = false; }
  });
}

function wireNavigation() {
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    if (switchView(button.dataset.view, button)) event.preventDefault();
  });
  $("menuProfileBtn")?.addEventListener("click", () => openPublicProfile(currentUser?.id));
  $("composerAvatar")?.addEventListener("click", event => { event.stopPropagation(); openPublicProfile(currentUser?.id); });
  document.addEventListener("click", event => { const profileTarget = event.target.closest("[data-open-profile]"); if (profileTarget) openPublicProfile(profileTarget.getAttribute("data-open-profile")); });
  $("settingsPrivacyToggle")?.addEventListener("click", () => {
    const button = $("settingsPrivacyToggle");
    const panel = $("settingsPrivacyContent");
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
  });
  $("helpSupportToggle")?.addEventListener("click", () => {
    const button = $("helpSupportToggle");
    const panel = $("helpSupportContent");
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
  });
  document.addEventListener("click", event => {
    const action = event.target.closest("[data-menu-action]");
    if (action) { event.preventDefault(); handleMenuAction(action.dataset.menuAction); return; }
  });
  $("themeBtn")?.addEventListener("click", () => {
    applyMurmurTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  $("blockedBtn")?.addEventListener("click", openBlockedPeople);
  $("deleteAccountBtn")?.addEventListener("click", openDeleteAccountInfo);

  $("logoutBtn")?.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) showError(error.message);
  });
  const openPostView = () => {
    switchView("post");
    if ($("postMediaButton")) $("postMediaButton").hidden = false;
    $("postInput")?.focus();
  };
  $("openPostComposer")?.addEventListener("click", openPostView);
  $("hdrAdd")?.addEventListener("click", openPostView);
  $("hdrSearch")?.addEventListener("click", () => { switchView("friends"); document.querySelector('.fr-pill[data-frtab="suggest"]')?.click(); if ($("findBlock")) $("findBlock").hidden = false; if ($("peopleBlock")) $("peopleBlock").hidden = false; $("friendSearch")?.focus({ preventScroll: true }); });
  const postInput = $("postInput");
  const composer = $("postComposer");
  $("postMediaButton")?.addEventListener("click", () => $("postMediaPicker")?.click());
  $("postMediaPicker")?.addEventListener("change", event => {
    const picker = event.currentTarget;
    const file = picker.files?.[0] || null;
    if (file && file.size > 20 * 1024 * 1024) {
      alert("Choose a file under 20 MB.");
      picker.value = "";
      return;
    }
    pendingPostFile = file;
    if ($("postMediaStatus")) $("postMediaStatus").textContent = file ? "Selected: " + file.name : "";
    if ($("postBtn")) $("postBtn").hidden = !postInput?.value.trim() && !pendingPostFile;
  });
  postInput?.addEventListener("input", () => {
    if ($("postBtn")) $("postBtn").hidden = !postInput.value.trim() && !pendingPostFile;
  });
  $("postBtn")?.addEventListener("click", createPost);
}
function wireAuth() {
  initSupabaseSocial();
  $("loginBtn")?.addEventListener("click", login);
  $("password")?.addEventListener("keydown", event => { if (event.key === "Enter") login(); });
  $("createBtn")?.addEventListener("click", openSignup);
  $("resetBtn")?.addEventListener("click", resetPassword);
  $("resendConfirmationBtn")?.addEventListener("click", resendSignupConfirmation);
  const googleButton = $("googleCreateBtn");
  if (googleButton) {
    // Supabase Auth logs confirmed Google is not enabled for this project.
    // Do not send users into a guaranteed 400 OAuth failure until provider credentials are configured.
    googleButton.disabled = true;
    googleButton.setAttribute("aria-disabled", "true");
    googleButton.title = "Google sign-in is not configured yet. Use your email and password.";
    const googleLabel = googleButton.querySelector("span:last-child");
    if (googleLabel) googleLabel.textContent = "Google sign-in unavailable";
  }
}

function isPasswordRecoveryRoute() {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return query.get("password-reset") === "1" ||
    query.get("type") === "recovery" ||
    hash.get("type") === "recovery";
}

async function completePasswordResetIfNeeded() {
  if (!isPasswordRecoveryRoute()) return;
  // Supabase PKCE may still be exchanging the one-time code when this route loads.
  // getSession waits for client initialization and returns the exchanged session.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user) {
    openResetPasswordPage();
    return;
  }
  showAuth();
  showError("This password reset link is invalid or has expired. Request a new one.");
}

async function boot() {
  wireAuth();
  wireNavigation();
  showAuthRedirectError();

  // Register before getSession(): PASSWORD_RECOVERY can be emitted while the
  // PKCE callback is being processed during startup.
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      queueMicrotask(() => openResetPasswordPage());
      return;
    }
    if (event === "SIGNED_OUT" || !session?.user) {
      currentUser = null; currentProfile = null; enteredUserId = null;
      if (feedChannel) { supabase.removeChannel(feedChannel); feedChannel = null; }
      window.dispatchEvent(new CustomEvent("murmur:supabase-signed-out"));
      if (!isPasswordRecoveryRoute()) showAuth();
    } else if ((event === "SIGNED_IN" || event === "USER_UPDATED") && !isPasswordRecoveryRoute()) {
      queueMicrotask(() => enterApp(session.user));
    }
  });
  authSubscription = listener.subscription;

  let session = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    const staleSession = error?.status === 400 ||
      /invalid refresh token|refresh token.*(not found|invalid|already used)|refresh_token_not_found/i.test(String(error?.message || ""));
    if (!staleSession) throw error;
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    showAuth();
    showError("Your saved sign-in session expired. Please sign in again.");
  }

  if (isPasswordRecoveryRoute()) {
    showAuth();
    await completePasswordResetIfNeeded();
  } else if (session?.user) {
    await enterApp(session.user);
  } else {
    showAuth();
  }
}

boot().catch(error => {
  console.error("[Murmur startup]", error);
  if (splash) splash.hidden = true;
  showAuth();
  showError("Murmur could not connect to Supabase: " + error.message);
});

// Keep these feature data services available to future Supabase-only feature modules.
window.MurmurServices = Object.freeze({ posts, profiles, storage, friendships, stories, reels, userNotes, messages, conversations, comments, postLikes });
