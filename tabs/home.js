/* Murmur Home tab: feed, comments, likes, sharing and live post updates. */
import { supabase } from "../supabase-client.js";
import { posts, comments, postLikes } from "../supabase-data.js?v=20261122-4";
const $ = id => document.getElementById(id);
const safeText = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
export async function renderPostComments(postId, panel) {
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

export async function renderFeed() {
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
      supabase.auth.getSession(),
      postLikes.listForPosts(postIds),
      supabase.from("comments").select("post_id").in("post_id", postIds)
    ]);
    if (peopleError) throw peopleError;
    if (userError) throw userError;
    if (commentRows.error) throw commentRows.error;
    const byId = new Map((people || []).map(person => [person.id, person]));
    const likeCounts = new Map();
    const likedByMe = new Set();
    for (const like of likeRows) {
      likeCounts.set(like.post_id, (likeCounts.get(like.post_id) || 0) + 1);
      if (like.user_id === userData.session?.user?.id) likedByMe.add(like.post_id);
    }
    const commentCounts = new Map();
    for (const comment of commentRows.data || []) commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) || 0) + 1);
    let signedByPath = new Map();
    const mediaPaths = rows.map(post => post.media_path).filter(Boolean);
    if (mediaPaths.length) {
      const { data: signedRows, error: signedError } = await supabase.storage.from("murmur-posts").createSignedUrls([...new Set(mediaPaths)], 3600);
      if (!signedError) signedByPath = new Map((signedRows || []).map(item => [item.path, item.signedUrl]));
    }
    const displayRows = rows.map(post => ({
      ...post,
      signedMediaUrl: post.media_path ? (signedByPath.get(post.media_path) || null) : null
    }));
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
export export function stopWatchingFeed() {
  if (feedChannel) { supabase.removeChannel(feedChannel); feedChannel = null; }
}

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
    // Comment changes are reflected in the open post locally. Avoid rebuilding
    // the entire feed for every comment event: that destroys scroll position
    // and forces all post cards/media to be recreated.
    .subscribe();
}
