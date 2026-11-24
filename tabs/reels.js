/* Murmur Reels: upload, publish, and playback. */
import { reels, storage } from "../supabase-data.js?v=20261124-2";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error?.message || "Could not load reels. Please try again.") + '</p>'; };

function openReelComposer(root) {
  if (root.querySelector(".reel-composer")) return;
  const form = document.createElement("form");
  form.className = "reel-composer";
  form.innerHTML = '<label>Choose video<input name="video" type="file" accept="video/mp4,video/webm" required></label><label>Title<input name="title" type="text" maxlength="120" placeholder="Give your reel a title"></label><label>Caption<textarea name="caption" maxlength="2000" rows="3" placeholder="Write a caption"></textarea></label><label>Audience<select name="audience"><option value="public">Public</option><option value="friends">Friends</option><option value="private">Only me</option></select></label><p class="reel-upload-status" role="status"></p><button class="btn primary" type="submit">Publish reel</button><button class="btn secondary" type="button" data-reel-cancel>Cancel</button>';
  root.prepend(form);
  form.querySelector("[data-reel-cancel]").addEventListener("click", () => form.remove());
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".reel-upload-status");
    const file = form.elements.video.files?.[0];
    if (!file) { status.textContent = "Choose an MP4 or WebM video."; return; }
    button.disabled = true;
    status.textContent = "Uploading video…";
    let uploaded = null;
    try {
      const video = document.createElement("video");
      const duration = await new Promise(resolve => {
        video.preload = "metadata";
        video.onloadedmetadata = () => { const d = Number.isFinite(video.duration) ? Math.floor(video.duration) : null; URL.revokeObjectURL(video.src); resolve(d); };
        video.onerror = () => resolve(null);
        video.src = URL.createObjectURL(file);
      });
      uploaded = await storage.uploadMedia(file, "reels");
      status.textContent = "Publishing reel…";
      await reels.create({
        storagePath: uploaded.path,
        title: form.elements.title.value,
        caption: form.elements.caption.value,
        audience: form.elements.audience.value,
        durationSeconds: duration
      });
      form.remove();
      await renderReels();
    } catch (error) {
      if (uploaded?.path) await storage.remove("murmur-reels", uploaded.path).catch(() => null);
      status.textContent = error?.message || "Could not publish this reel.";
      button.disabled = false;
    }
  });
}

export async function renderReels() {
  const root = el("reelsFeed");
  if (!root) return;
  root.innerHTML = '<p class="empty-state">Loading reels…</p>';
  try {
    const rows = await reels.list();
    const displayRows = await Promise.all(rows.map(async reel => ({
      ...reel,
      signedMediaUrl: reel.storage_path ? await storage.url("murmur-reels", reel.storage_path) : reel.video_url
    })));
    root.innerHTML = '<div class="reels-actions"><button class="btn primary" type="button" data-create-reel>Create reel</button></div>' +
      (displayRows.map(r => '<article class="reel-card" data-reel-id="' + esc(r.id) + '">' +
        (r.signedMediaUrl ? '<video controls playsinline preload="metadata" src="' + esc(r.signedMediaUrl) + '"></video>' : '<p class="empty-state">This reel has no playable video.</p>') +
        '<strong>' + esc(r.title || "Reel") + '</strong><p>' + esc(r.caption || "") + '</p></article>').join("") || '<p class="empty-state">No reels yet. Create the first one.</p>');
    root.querySelector("[data-create-reel]")?.addEventListener("click", () => openReelComposer(root));
  } catch (error) { fail(root, error); }
}
