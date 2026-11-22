/* Murmur Stories tab. Owns story rendering and story creation UI. */
import { stories, storage } from "../supabase-data.js?v=20261122-4";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };

export async function renderStories() {
  const roots = [el("storiesRow"), el("chatStoriesRow")].filter(Boolean);
  if (!roots.length) return;
  try {
    const rows = await stories.list();
    const displayRows = await Promise.all(rows.map(async story => ({
      ...story,
      signedMediaUrl: story.media_path ? await storage.url("murmur-stories", story.media_path) : null
    })));
    const storyMarkup = '<div class="story-heading"><strong>Stories</strong><button type="button" class="btn secondary" data-add-story>Share a story</button></div>' + (displayRows.length ? displayRows.map(s => '<article class="story-card">' + (s.signedMediaUrl ? (s.media_type === "video" ? '<video controls playsinline preload="metadata" src="' + esc(s.signedMediaUrl) + '"></video>' : '<img loading="lazy" src="' + esc(s.signedMediaUrl) + '" alt="Story media">') : '') + '<strong>' + esc(s.content || "Story") + '</strong><small>' + esc(new Date(s.created_at).toLocaleString()) + '</small></article>').join("") : '');
    roots.forEach(root => { root.innerHTML = storyMarkup; });
    roots.forEach(root => root.querySelector("[data-add-story]")?.addEventListener("click", () => {
      const picker = document.createElement("input");
      picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"; picker.hidden = true;
      document.body.appendChild(picker);
      picker.addEventListener("change", async () => {
        const file = picker.files?.[0] || null; picker.remove();
        const content = prompt("Add a caption to your story (optional, up to 2,000 characters):") || "";
        if (!file && !content.trim()) return;
        if (file && file.size > 20 * 1024 * 1024) return alert("Choose a story file under 20 MB.");
        try {
          let mediaPath = null, mediaType = null;
          if (file) {
            const uploaded = await storage.uploadMedia(file, "stories");
            mediaPath = uploaded.path;
            mediaType = file.type.startsWith("video/") ? "video" : "image";
          }
          await stories.create({ content, mediaPath, mediaType });
          await renderStories();
        } catch (error) { alert(error.message); }
      }, { once: true });
      picker.click();
    }));
  } catch (error) { roots.forEach(root => fail(root, error)); }
}
