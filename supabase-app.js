/* Murmur — Supabase-only application bootstrap.
 * Authentication and the home feed use Supabase directly through the shared data layer.
 * No external identity bridge or fallback is loaded.
 */
import { supabase } from "./supabase-client.js";
import { posts, profiles, storage, friendships, stories, reels, userNotes, messages, conversations, accountRestrictions } from "./supabase-data.js";
import { initSupabaseSocial } from "./supabase-social.js";

const authModalStyles = document.createElement("style");
authModalStyles.textContent = ".murmur-auth-modal{position:fixed;inset:0;z-index:9999;background:#101828a8;display:grid;place-items:center;padding:18px}.murmur-auth-modal section{position:relative;width:min(100%,440px);max-height:90dvh;overflow:auto;background:var(--panel,#fff);color:var(--text,#17202a);border-radius:20px;padding:26px;box-shadow:0 20px 70px #0004}.murmur-auth-modal h2{margin:0 36px 20px 0}.murmur-auth-modal label{display:grid;gap:6px;margin:12px 0;font-size:14px;font-weight:600}.murmur-auth-modal input{width:100%;min-height:44px;border:1px solid var(--border,#d5dbe3);border-radius:10px;padding:10px;background:var(--input-bg,#fff);color:inherit}.murmur-modal-close{position:absolute;right:14px;top:12px;border:0;background:transparent;font-size:26px}.murmur-modal-error{color:#c62828;font-size:13px;min-height:18px}.murmur-signup-submit{width:100%;min-height:46px}";
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
  if ($("menuUser")) $("menuUser").textContent = [username, currentProfile?.public_id ? "ID: " + currentProfile.public_id : ""].filter(Boolean).join(" · ");
  if ($("composerAvatar")) $("composerAvatar").textContent = name.slice(0, 1).toUpperCase();
  if ($("menuAvatar")) $("menuAvatar").textContent = name.slice(0, 1).toUpperCase();
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
    const { data: people, error } = await supabase.from("murmur_public_profiles").select("id,display_name,username,avatar_url").in("id", ids);
    if (error) throw error;
    const byId = new Map((people || []).map(person => [person.id, person]));
    const displayRows = await Promise.all(rows.map(async post => ({
      ...post,
      signedMediaUrl: post.media_path ? await storage.url("murmur-posts", post.media_path) : null
    })));
    root.innerHTML = displayRows.map(post => {
      const person = byId.get(post.author_id) || {};
      const author = safeText(person.display_name || "Murmur user");
      const handle = person.username ? "@" + safeText(person.username) : "";
      const media = post.signedMediaUrl ? (post.media_type === "video" ? '<video class="post-media" controls playsinline preload="metadata" src="' + safeText(post.signedMediaUrl) + '"></video>' : '<img class="post-media" loading="lazy" src="' + safeText(post.signedMediaUrl) + '" alt="Post attachment">') : "";
      return '<article class="post-card" data-post-id="' + safeText(post.id) + '"><header class="post-head"><span class="avatar">' + safeText(author.slice(0,1).toUpperCase()) + '</span><div><strong>' + author + '</strong><small>' + handle + ' · ' + safeText(new Date(post.created_at).toLocaleString()) + '</small></div></header><p class="post-content">' + safeText(post.content || "") + '</p>' + media + '</article>';
    }).join("");
  } catch (error) {
    console.error("[Murmur feed]", error);
    root.innerHTML = '<p class="empty-state">Could not load posts. Check your Supabase connection and table permissions.</p>';
  }
}


let feedChannel = null;
function watchFeed() {
  if (feedChannel) supabase.removeChannel(feedChannel);
  feedChannel = supabase.channel("murmur-public-posts")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => renderFeed())
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

async function enterApp(user) {
  currentUser = user;
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
    await renderFeed();
    watchFeed();
    window.dispatchEvent(new CustomEvent("murmur:supabase-user-ready"));
  } catch (error) {
    console.error("[Murmur profile]", error);
    showError(error.message);
    showAuth();
  }
}

async function login() {
  showError("");
  const email = $("email")?.value.trim().toLowerCase();
  const password = $("password")?.value || "";
  if (!email || !password) return showError("Enter your email address and password.");
  $("loginBtn").disabled = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await enterApp(data.user);
  } catch (error) { showError(error.message); }
  finally { $("loginBtn").disabled = false; }
}

function openSignup() {
  const overlay = document.createElement("div");
  overlay.className = "murmur-auth-modal";
  overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="murmur-signup-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2 id="murmur-signup-title">Create your Murmur account</h2><label>Full name<input name="name" maxlength="80" autocomplete="name" required></label><label>Username<input name="username" maxlength="30" pattern="[A-Za-z0-9_.]+" autocomplete="username" required></label><label>Email<input name="email" type="email" maxlength="254" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><p class="murmur-modal-error" role="alert"></p><button type="button" class="btn primary murmur-signup-submit">Create account</button></section>';
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
    if (!name || !/^[a-z0-9_.]{3,30}$/.test(username) || !email || password.length < 8) {
      errorBox.textContent = "Enter your name, a username (3–30 letters, numbers, dots or underscores), a valid email and a password of at least 8 characters.";
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
        errorBox.textContent = "Account created. Check your email to confirm it, then sign in.";
      }
    } catch (error) { errorBox.textContent = error.message; }
    finally { button.disabled = false; }
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
    await renderFeed();
  } catch (error) { alert(error.message); }
  finally { if (button) button.disabled = false; }
}

function wireNavigation() {
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    const view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-pane]").forEach(pane => pane.classList.toggle("active", pane.dataset.pane === view));
    if (view === "home") renderFeed();
  }));
  $("menuProfileBtn")?.addEventListener("click", openProfileEditor);
  $("logoutBtn")?.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) showError(error.message);
  });
  $("hdrAdd")?.addEventListener("click", () => $("postInput")?.focus());
  if ($("postInput")) $("postInput").removeAttribute("readonly");
  $("postInput")?.addEventListener("input", () => { if ($("postBtn")) $("postBtn").hidden = !$("postInput").value.trim(); });
  $("postBtn")?.addEventListener("click", createPost);
  const composer = $("postInput")?.closest(".composer");
  if (composer && !$("postMediaButton")) {
    const mediaButton = document.createElement("button");
    mediaButton.type = "button"; mediaButton.id = "postMediaButton"; mediaButton.className = "btn secondary";
    mediaButton.textContent = "Add photo or video";
    const status = document.createElement("small"); status.id = "postMediaStatus"; status.setAttribute("aria-live", "polite");
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"; picker.hidden = true;
    mediaButton.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      const file = picker.files?.[0] || null;
      if (file && file.size > 20 * 1024 * 1024) { alert("Choose a file under 20 MB."); picker.value = ""; return; }
      pendingPostFile = file;
      status.textContent = file ? "Selected: " + file.name : "";
      if ($("postBtn")) $("postBtn").hidden = !($("postInput")?.value.trim() || pendingPostFile);
    });
    composer.append(mediaButton, picker, status);
  }
}

function wireAuth() {
  initSupabaseSocial();
  $("loginBtn")?.addEventListener("click", login);
  $("password")?.addEventListener("keydown", event => { if (event.key === "Enter") login(); });
  $("createBtn")?.addEventListener("click", openSignup);
  $("resetBtn")?.addEventListener("click", resetPassword);
  $("googleCreateBtn")?.addEventListener("click", async () => {
    showError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/", queryParams: { prompt: "select_account" } }
    });
    if (error) showError(error.message);
  });
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
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user) await enterApp(data.session.user);
  else showAuth();
  await completePasswordResetIfNeeded();
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) {
      currentUser = null; currentProfile = null; if (feedChannel) { supabase.removeChannel(feedChannel); feedChannel = null; } window.dispatchEvent(new CustomEvent("murmur:supabase-signed-out")); showAuth();
    } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
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
window.MurmurServices = Object.freeze({ posts, profiles, storage, friendships, stories, reels, userNotes, messages, conversations });
