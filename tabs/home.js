/* Murmur Home tab: feed, comments, likes, sharing and live post updates. */
import { supabase } from "../supabase-client.js?v=20261124-2";
import { posts, comments, postLikes } from "../supabase-data.js?v=20261124-2";
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
      const list = panel.querySelector(".post-comments-list");
      const empty = list?.querySelector(".empty-state");
      empty?.remove();
      const optimistic = document.createElement("article");
      optimistic.className = "post-comment is-pending";
      optimistic.dataset.optimisticComment = "true";
      optimistic.innerHTML = "<strong>You</strong><p></p><small>Sending…</small>";
      optimistic.querySelector("p").textContent = content;
      list?.append(optimistic);
      const count = panel.closest("[data-post-id]")?.querySelector("[data-comment-count]");
      const previousCount = Number(count?.textContent || 0);
      if (count) count.textContent = String(previousCount + 1);
      input.value = "";
      button.disabled = true;
      try {
        await comments.create(postId, content);
        await renderPostComments(postId, panel);
      } catch (error) {
        optimistic.remove();
        if (count) count.textContent = String(previousCount);
        if (list && !list.querySelector(".post-comment")) list.innerHTML = '<p class="empty-state">No comments yet. Start the conversation.</p>';
        input.value = content;
        alert(error.message || "Your comment could not be sent. Your comment was restored.");
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    panel.innerHTML = '<p class="empty-state">Comments could not be loaded: ' + safeText(error.message) + '</p>';
  }
}

let feedRenderSequence = 0;

export async function renderFeed() {
  const root = $("posts");
  if (!root) return;
  const renderId = ++feedRenderSequence;
  // Preserve already-rendered posts during refresh. First-time visitors get a
  // lightweight loading state while only the essential feed data is fetched.
  if (!root.querySelector("[data-post-id]")) {
    root.innerHTML = '<p class="empty-state" role="status">Loading your home feed…</p>';
  }
  try {
    const rows = await posts.feed(0);
    if (renderId !== feedRenderSequence) return;
    if (!rows.length) {
      root.innerHTML = '<p class="empty-state">No posts yet. Share the first update.</p>';
      return;
    }

    const ids = [...new Set(rows.map(row => row.author_id).filter(Boolean))];
    const [{ data: people, error: peopleError }, { data: userData, error: userError }] = await Promise.all([
      supabase.from("murmur_public_profiles").select("id,display_name,username,avatar_url").in("id", ids),
      supabase.auth.getSession()
    ]);
    if (renderId !== feedRenderSequence) return;
    if (peopleError) throw peopleError;
    if (userError) throw userError;

    const byId = new Map((people || []).map(person => [person.id, person]));
    const currentUserId = userData.session?.user?.id;
    // Paint the useful part of the feed now. Counts, liked state and signed
    // media URLs are deliberately hydrated after the cards are on screen.
    root.innerHTML = rows.map(post => {
      const person = byId.get(post.author_id) || {};
      const author = safeText(person.display_name || "Murmur user");
      const handle = person.username ? "@" + safeText(person.username) : "";
      const initial = safeText(author.slice(0, 1).toUpperCase());
      const avatar = person.avatar_url
        ? '<span class="avatar" role="img" aria-label="' + author + ' profile picture" data-fallback="' + initial + '" style="overflow:hidden;border-radius:50%"><img src="' + safeText(person.avatar_url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent=this.parentElement.dataset.fallback"></span>'
        : '<span class="avatar" role="img" aria-label="' + author + ' profile picture">' + initial + '</span>';
      const media = post.media_path
        ? '<div class="post-media-pending" data-post-media aria-label="Loading post media"></div>'
        : "";
      return '<article class="post-card" data-post-id="' + safeText(post.id) + '">' +
        '<header class="post-head" data-open-profile="' + safeText(post.author_id) + '">' + avatar + '<div><strong>' + author + '</strong><small>' + handle + ' · ' + safeText(new Date(post.created_at).toLocaleString()) + '</small></div></header>' +
        (post.content ? '<p class="post-content">' + safeText(post.content) + '</p>' : '') + media +
        '<div class="murmur-post-stats"><span><strong data-like-count>—</strong> likes</span><span><strong data-comment-count>—</strong> comments</span></div>' +
        '<div class="murmur-post-actions"><button type="button" data-like-post="' + safeText(post.id) + '" aria-pressed="false" class="">Like</button><button type="button" data-open-comments="' + safeText(post.id) + '">Comment</button><button type="button" data-share-post="' + safeText(post.id) + '">Share</button></div>' +
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
      button.setAttribute("aria-pressed", String(nextLiked));
      button.classList.toggle("is-liked", nextLiked);
      button.textContent = nextLiked ? "Liked" : "Like";
      if (count) count.textContent = String(Math.max(0, previousCount + (nextLiked ? 1 : -1)));
      button.disabled = true;
      try {
        await postLikes.toggle(button.dataset.likePost);
      } catch (error) {
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

    // Hydrate secondary information without blocking the first paint.
    const postIds = rows.map(post => post.id);
    const mediaPaths = [...new Set(rows.map(post => post.media_path).filter(Boolean))];
    void Promise.allSettled([
      postLikes.listForPosts(postIds),
      supabase.from("comments").select("post_id").in("post_id", postIds),
      mediaPaths.length
        ? supabase.storage.from("murmur-posts").createSignedUrls(mediaPaths, 3600)
        : Promise.resolve({ data: [], error: null })
    ]).then(results => {
      if (renderId !== feedRenderSequence || !root.isConnected) return;
      const [likesResult, commentsResult, mediaResult] = results;
      if (likesResult.status === "fulfilled") {
        const likeCounts = new Map();
        const likedByMe = new Set();
        for (const like of likesResult.value || []) {
          likeCounts.set(like.post_id, (likeCounts.get(like.post_id) || 0) + 1);
          if (like.user_id === currentUserId) likedByMe.add(like.post_id);
        }
        for (const post of rows) {
          const card = root.querySelector('[data-post-id="' + CSS.escape(post.id) + '"]');
          const count = card?.querySelector("[data-like-count]");
          const button = card?.querySelector("[data-like-post]");
          if (count) count.textContent = String(likeCounts.get(post.id) || 0);
          if (button && !button.disabled) {
            const liked = likedByMe.has(post.id);
            button.setAttribute("aria-pressed", String(liked));
            button.classList.toggle("is-liked", liked);
            button.textContent = liked ? "Liked" : "Like";
          }
        }
      } else console.warn("[Murmur feed likes]", likesResult.reason);

      if (commentsResult.status === "fulfilled" && !commentsResult.value.error) {
        const commentCounts = new Map();
        for (const comment of commentsResult.value.data || []) {
          commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) || 0) + 1);
        }
        for (const post of rows) {
          const count = root.querySelector('[data-post-id="' + CSS.escape(post.id) + '"] [data-comment-count]');
          if (count) count.textContent = String(commentCounts.get(post.id) || 0);
        }
      } else if (commentsResult.status === "rejected") {
        console.warn("[Murmur feed comments]", commentsResult.reason);
      }

      if (mediaResult.status === "fulfilled" && !mediaResult.value.error) {
        const signedByPath = new Map((mediaResult.value.data || []).map(item => [item.path, item.signedUrl]));
        for (const post of rows) {
          if (!post.media_path) continue;
          const url = signedByPath.get(post.media_path);
          const holder = root.querySelector('[data-post-id="' + CSS.escape(post.id) + '"] [data-post-media]');
          if (!holder || !url) continue;
          if (post.media_type === "video") {
            const video = document.createElement("video");
            video.className = "post-media";
            video.controls = true;
            video.playsInline = true;
            video.preload = "none";
            video.src = url;
            holder.replaceWith(video);
          } else {
            const img = document.createElement("img");
            img.className = "post-media";
            img.loading = "lazy";
            img.decoding = "async";
            img.alt = "Post attachment";
            img.src = url;
            holder.replaceWith(img);
          }
        }
      } else if (mediaResult.status === "rejected") {
        console.warn("[Murmur feed media]", mediaResult.reason);
      }
    });
  } catch (error) {
    if (renderId !== feedRenderSequence) return;
    console.error("[Murmur feed]", error);
    root.innerHTML = '<div class="empty-state" role="alert"><p>Posts could not be loaded.</p><small>' + safeText(error?.message || "Please try again.") + '</small><button class="btn secondary" type="button" data-retry-feed>Try again</button></div>';
    root.querySelector("[data-retry-feed]")?.addEventListener("click", renderFeed, { once: true });
  }
}

let feedChannel = null;
export function stopWatchingFeed() {
  if (feedChannel) { supabase.removeChannel(feedChannel); feedChannel = null; }
}

export function watchFeed() {
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
