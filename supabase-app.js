/* Murmur — Supabase-only application bootstrap.
 * Authentication and the home feed use Supabase directly through the shared data layer.
 * No external identity bridge or fallback is loaded.
 */
import { supabase } from "./supabase-client.js";
import { posts, profiles, storage, friendships, stories, reels, userNotes, messages, conversations, comments, postLikes, accountRestrictions } from "./supabase-data.js?v=20261122-1";
import { initSupabaseSocial } from "./supabase-social.js?v=20261122-9";

const authModalStyles = document.createElement("style");
authModalStyles.textContent = ".murmur-auth-modal{position:fixed;inset:0;z-index:9999;background:#101828a8;display:grid;place-items:center;padding:18px}.murmur-auth-modal section{position:relative;width:min(100%,440px);max-height:90dvh;overflow:auto;background:var(--panel,#fff);color:var(--text,#17202a);border-radius:20px;padding:26px;box-shadow:0 20px 70px #0004}.murmur-auth-modal h2{margin:0 36px 20px 0}.murmur-auth-modal label{display:grid;gap:6px;margin:12px 0;font-size:14px;font-weight:600}.murmur-auth-modal input{width:100%;min-height:44px;border:1px solid var(--border,#d5dbe3);border-radius:10px;padding:10px;background:var(--input-bg,#fff);color:inherit}.murmur-modal-close{position:absolute;right:14px;top:12px;border:0;background:transparent;font-size:26px}.murmur-modal-error{color:#c62828;font-size:13px;min-height:18px}.murmur-signup-submit{width:100%;min-height:46px}.murmur-auth-modal textarea,.murmur-auth-modal select{width:100%;min-height:44px;border:1px solid var(--border,#d5dbe3);border-radius:10px;padding:10px;background:var(--input-bg,#fff);color:inherit;font:inherit}.murmur-menu-dialog .btn{margin:8px 0;min-height:44px}.murmur-menu-dialog p{line-height:1.55}.murmur-menu-dialog-body{overflow-wrap:anywhere}";
document.head.appendChild(authModalStyles);
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
  if (authError) authError.textContent = String(message || "Something went wrong. Please try again.");
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
      supabase.from("posts").select("id,author_id,content,media_path,media_type,created_at").eq("author_id", userId).order("created_at", { ascending: false }).limit(30)
    ]);
    if (profileError) throw profileError;
    if (postsError) throw postsError;
    if (!person) throw new Error("This profile is unavailable.");
    const isMe = currentUser?.id === userId;
    // Notes are private to their owner; show the signed-in user's active note
    // at the top of their own profile without exposing private notes to others.
    const profileNotes = isMe ? await userNotes.listMine() : [];
    const latestNote = profileNotes[0] || null;
    const postRows = await Promise.all((rows || []).map(async post => ({
      ...post,
      mediaUrl: post.media_path ? await storage.url("murmur-posts", post.media_path).catch(() => null) : null
    })));
    const avatar = person.avatar_url ? '<img class="murmur-profile-avatar-image" src="' + safeText(person.avatar_url) + '" alt="">' : '<span class="murmur-profile-avatar-fallback">' + safeText((person.display_name || person.username || "?").slice(0,1).toUpperCase()) + '</span>';
    content.innerHTML = '<div class="murmur-profile-cover"></div><div class="murmur-profile-summary"><div class="murmur-profile-avatar">' + avatar + '</div><div class="murmur-profile-title"><h2 id="profile-view-title">' + safeText(person.display_name || "Murmur user") + '</h2><p>@' + safeText(person.username || "") + '</p></div>' +
      (isMe ? '<button type="button" class="btn secondary murmur-profile-edit">Edit profile</button>' : '') +
      '</div>' +
      (latestNote ? '<section class="murmur-profile-note" aria-label="Your note"><div class="murmur-profile-note-heading">Your note</div><button type="button" class="murmur-profile-note-content" data-edit-profile-note>' + safeText(latestNote.content) + '</button><small>Tap your note to edit or delete it</small></section>' : (isMe ? '<button type="button" class="murmur-profile-note-empty" data-edit-profile-note>Add a note</button>' : '')) +
      '<p class="murmur-profile-bio">' + safeText(person.bio || "No bio yet.") + '</p><div class="murmur-profile-stats"><strong>' + postRows.length + '</strong> posts</div><h3 class="murmur-profile-post-heading">Posts</h3><div class="murmur-profile-posts">' +
      (postRows.length ? postRows.map(post => '<article class="murmur-profile-post">' + (post.content ? '<p>' + safeText(post.content) + '</p>' : '') +
        (post.mediaUrl ? (post.media_type === "video" ? '<video controls playsinline preload="metadata" src="' + safeText(post.mediaUrl) + '"></video>' : '<img loading="lazy" src="' + safeText(post.mediaUrl) + '" alt="Post photo">') : '') +
        '<small>' + safeText(new Date(post.created_at).toLocaleString()) + '</small></article>').join("") : '<p class="empty-state">No posts yet.</p>') + '</div>';
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
  overlay.className = "murmur-auth-modal";
  const p = currentProfile || {};
  overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="profile-edit-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2 id="profile-edit-title">Edit profile</h2><label>Display name<input name="display_name" maxlength="80"></label><label>Username<input name="username" maxlength="24"></label><label>Bio<textarea name="bio" maxlength="240" rows="3"></textarea></label><label>School<input name="school" maxlength="100"></label><label>Location<input name="location" maxlength="100"></label><label>Profile photo<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/avif"></label><p class="murmur-modal-error" role="alert"></p><button type="button" class="btn primary murmur-profile-save">Save profile</button></section>';
  document.body.appendChild(overlay);
  const form = overlay.querySelector("section");
  form.querySelector('[name="display_name"]').value = p.display_name || "";
  form.querySelector('[name="username"]').value = p.username || "";
  form.querySelector('[name="bio"]').value = p.bio || "";
  form.querySelector('[name="school"]').value = p.school || "";
  form.querySelector('[name="location"]').value = p.location || "";
  const close = () => overlay.remove();
  form.querySelector(".murmur-modal-close").addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  form.querySelector(".murmur-profile-save").addEventListener("click", async event => {
    const button = event.currentTarget;
    const errorBox = form.querySelector(".murmur-modal-error");
    const username = form.querySelector('[name="username"]').value.trim().replace(/^@/, "").toLowerCase();
    const display_name = form.querySelector('[name="display_name"]').value.trim();
    if (!display_name || !/^[a-z0-9_.]{3,24}$/.test(username)) {
      errorBox.textContent = "Enter a display name and a username with 3–24 letters, numbers, dots or underscores.";
      return;
    }
    button.disabled = true;
    try {
      const patch = {
        display_name, username,
        bio: form.querySelector('[name="bio"]').value.trim(),
        school: form.querySelector('[name="school"]').value.trim(),
        location: form.querySelector('[name="location"]').value.trim()
      };
      const avatar = form.querySelector('[name="avatar"]').files?.[0];
      if (avatar) {
        if (avatar.size > 10 * 1024 * 1024) throw new Error("Profile photos must be under 10 MB.");
        patch.avatar_url = (await storage.uploadAvatar(avatar)).url;
      }
      currentProfile = await profiles.update(patch);
      paintIdentity();
      close();
    } catch (error) { errorBox.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function paintIdentity() {
  const name = currentProfile?.display_name || currentUser?.email || "Murmur user";
  const username = currentProfile?.username ? "@" + currentProfile.username : "";
  if ($("menuName")) $("menuName").textContent = name;
  if ($("menuUser")) $("menuUser").textContent = username;
  if ($("composerAvatar")) $("composerAvatar").textContent = name.slice(0, 1).toUpperCase();
  if ($("menuAvatar")) $("menuAvatar").textContent = name.slice(0, 1).toUpperCase();
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
  root.innerHTML = '<p class="empty-state">Loading posts…</p>';
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

    root.querySelectorAll("[data-like-post]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await postLikes.toggle(button.dataset.likePost); await renderFeed(); }
      catch (error) { alert(error.message || "Could not update your like."); button.disabled = false; }
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
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => renderFeed())
    .on("postgres_changes", { event: "*", schema: "public", table: "post_likes" }, () => renderFeed())
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => renderFeed())
    .subscribe();
}

function showAccountRestriction(restriction) {
  const overlay = document.createElement("div");
  overlay.className = "murmur-auth-modal";
  const until = restriction.ends_at ? new Date(restriction.ends_at).toLocaleString() : "until further notice";
  overlay.innerHTML = '<section role="alertdialog" aria-modal="true"><h2>Account access restricted</h2><p>' + safeText(restriction.reason || "Your account is temporarily restricted by Murmur administrators.") + '</p><p>Access is restricted ' + safeText(until) + '.</p><button type="button" class="btn primary">Close</button></section>';
  document.body.appendChild(overlay);
  overlay.querySelector("button").addEventListener("click", () => overlay.remove());
}

let enteringUserId = null;
let enterAppTask = null;
let enteredUserId = null;

async function enterApp(user) {
  if (!user?.id) throw new Error("Supabase did not return a valid user session.");
  if (enteredUserId === user.id && appPanel && !appPanel.hidden) return;
  if (enterAppTask && enteringUserId === user.id) return enterAppTask;
  enteringUserId = user.id;
  currentUser = user;
  enterAppTask = (async () => {
    try {
      const restriction = await accountRestrictions.current();
      if (restriction) {
        showAccountRestriction(restriction);
        await supabase.auth.signOut();
        return;
      }
      currentProfile = await loadProfile(user);
      showApp();
      paintIdentity();
      enteredUserId = user.id;
      // Show the app as soon as the account/profile is ready. Feed queries and
      // media URL signing must never hold the full-screen startup loader open.
      watchFeed();
      window.dispatchEvent(new CustomEvent("murmur:supabase-user-ready"));
      void renderFeed();
    } catch (error) {
      enteredUserId = null;
      console.error("[Murmur profile]", error);
      showError(error.message || "Your account was verified, but Murmur could not load your profile.");
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
  const email = $("email")?.value.trim().toLowerCase();
  const password = $("password")?.value || "";
  if (!email || !password) return showError("Enter your email address and password.");
  loginInProgress = true;
  const button = $("loginBtn");
  if (button) button.disabled = true;
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
    if (!data?.user) throw new Error("Supabase did not return a user. Please try signing in again.");
    await enterApp(data.user);
  } catch (error) {
    console.error("[Murmur login]", error);
    showError(error.message || "Sign-in failed. Please try again.");
  } finally {
    loginInProgress = false;
    if (button) button.disabled = false;
  }
}

function openSignup() {
  const overlay = document.createElement("div");
  overlay.className = "murmur-auth-modal";
  overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="murmur-signup-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2 id="murmur-signup-title">Create your Murmur account</h2><label>Full name<input name="name" maxlength="80" autocomplete="name" required></label><label>Username<input name="username" maxlength="24" minlength="3" pattern="[A-Za-z0-9_.]{3,24}" autocomplete="username" autocapitalize="none" spellcheck="false" required></label><label>Email<input name="email" type="email" maxlength="254" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><p class="murmur-modal-error" role="alert"></p><button type="button" class="btn primary murmur-signup-submit">Create account</button><button type="button" class="btn secondary murmur-resend-confirmation" hidden>Resend confirmation email</button></section>';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".murmur-modal-close").addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.querySelector(".murmur-signup-submit").addEventListener("click", async event => {
    const button = event.currentTarget;
    const form = overlay.querySelector("section");
    const name = form.querySelector('[name="name"]').value.trim();
    const username = form.querySelector('[name="username"]').value.trim().replace(/^@/, "").toLowerCase();
    const email = form.querySelector('[name="email"]').value.trim().toLowerCase();
    const password = form.querySelector('[name="password"]').value;
    const errorBox = overlay.querySelector(".murmur-modal-error");
    if (!name || !/^[a-z0-9_.]{3,24}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      errorBox.textContent = "Enter your name, a valid email, a username with 3–24 letters, numbers, dots or underscores, and a password of at least 8 characters.";
      return;
    }
    button.disabled = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name, username }, emailRedirectTo: location.origin + "/" }
      });
      if (error) throw error;
      if (data.session && data.user) {
        await loadProfile(data.user);
        close();
        await enterApp(data.user);
      } else {
        errorBox.textContent = "Account created. Check your inbox and spam folder for the Murmur confirmation email. Confirm your address before signing in.";
        const resend = form.querySelector(".murmur-resend-confirmation");
        if (resend) resend.hidden = false;
      }
    } catch (error) {
      const message = String(error?.message || "Could not create your account. Please try again.");
      errorBox.textContent = /duplicate key|already exists|profiles_username_key|unique constraint/i.test(message)
        ? "That username is already taken. Choose another username."
        : message;
    } finally { button.disabled = false; }
  });
  overlay.querySelectorAll("input").forEach(input => input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); overlay.querySelector(".murmur-signup-submit")?.click(); }
  }));
  const resendButton = overlay.querySelector(".murmur-resend-confirmation");
  resendButton?.addEventListener("click", async () => {
    const email = overlay.querySelector('[name="email"]').value.trim().toLowerCase();
    const errorBox = overlay.querySelector(".murmur-modal-error");
    if (!email) { errorBox.textContent = "Enter your email address first."; return; }
    resendButton.disabled = true;
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: location.origin + "/" }
      });
      if (error) throw error;
      errorBox.textContent = "If confirmation is still required, a new email has been requested. Check your inbox and spam folder.";
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      resendButton.disabled = false;
    }
  });
}

async function resetPassword() {
  const email = $("email")?.value.trim().toLowerCase();
  if (!email) return showError("Enter your email address first.");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/?password-reset=1" });
    if (error) throw error;
    showError("If an account exists for that email, a password reset link has been sent.");
  } catch (error) { showError(error.message); }
}

async function resendSignupConfirmation() {
  const email = $("email")?.value.trim().toLowerCase();
  if (!email) return showError("Enter your email address first.");
  const button = $("resendConfirmationBtn");
  if (button) button.disabled = true;
  try {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: location.origin + "/" }
    });
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
  let notification = "Not supported by this browser";
  if ("Notification" in window) notification = Notification.permission;
  const overlay = openMenuDialog("App permissions",
    '<p>Notifications: <strong data-permission-status>' + safeText(notification) + '</strong></p>' +
    '<p>Allow Murmur notifications in this browser to receive supported alerts.</p>' +
    '<button class="btn primary" type="button" data-enable-notifications>Enable notifications</button>' +
    '<p class="murmur-modal-error" role="status" aria-live="polite"></p>');
  overlay.querySelector("[data-enable-notifications]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    const status = overlay.querySelector("[data-permission-status]");
    const message = overlay.querySelector(".murmur-modal-error");
    if (!("Notification" in window)) { message.textContent = "This browser does not support web notifications."; return; }
    button.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      status.textContent = permission;
      message.textContent = permission === "granted" ? "Notifications are allowed. Murmur can now request browser notifications." : "Permission was not granted. You can change this in your browser site settings.";
    } finally { button.disabled = false; }
  });
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

async function completePasswordResetIfNeeded() {
  const params = new URLSearchParams(location.search);
  if (params.get("password-reset") !== "1") return;
  const password = prompt("Enter your new password (at least 8 characters):");
  if (!password) return;
  if (password.length < 8) { showError("Your new password must be at least 8 characters."); return; }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) showError(error.message);
  else { showError("Your password has been updated."); history.replaceState(null, "", location.pathname); }
}
async function boot() {
  wireAuth();
  wireNavigation();
  showAuthRedirectError();
  let session = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    const staleSession = error?.status === 400 ||
      /invalid refresh token|refresh token.*(not found|invalid|already used)|refresh_token_not_found/i.test(String(error?.message || ""));
    if (!staleSession) throw error;
    // A revoked/expired saved refresh token must not trap the app on startup.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    showAuth();
    showError("Your saved sign-in session expired. Please sign in again.");
  }
  if (session?.user) await enterApp(session.user);
  else showAuth();
  await completePasswordResetIfNeeded();
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) {
      currentUser = null; currentProfile = null; enteredUserId = null; if (feedChannel) { supabase.removeChannel(feedChannel); feedChannel = null; } window.dispatchEvent(new CustomEvent("murmur:supabase-signed-out")); showAuth();
    } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      queueMicrotask(() => enterApp(session.user));
    }
  });
  authSubscription = listener.subscription;
}

boot().catch(error => {
  console.error("[Murmur startup]", error);
  if (splash) splash.hidden = true;
  showAuth();
  showError("Murmur could not connect to Supabase: " + error.message);
});

// Keep these feature data services available to future Supabase-only feature modules.
window.MurmurServices = Object.freeze({ posts, profiles, storage, friendships, stories, reels, userNotes, messages, conversations, comments, postLikes });
