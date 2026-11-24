/* Murmur Reels: upload, publish, and playback. */
import { reels, storage } from "../supabase-data.js?v=20261124-3";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error?.message || "Could not load reels. Please try again.") + '</p>'; };
if (!document.getElementById("murmur-reels-runtime-style")) {
  const style = document.createElement("style");
  style.id = "murmur-reels-runtime-style";
  style.textContent = ".reel-composer{display:grid;gap:10px;padding:14px;background:#111923;color:#fff}.reel-composer label{display:grid;gap:6px;font-size:14px}.reel-composer input,.reel-composer textarea,.reel-composer select{width:100%;min-height:42px;padding:9px;border:1px solid #64748b;border-radius:9px;background:#fff;color:#111}.reel-composer button{min-height:42px;padding:8px 14px;border-radius:9px}.reel-upload-status{min-height:18px;margin:0;font-size:13px}.reel-info{z-index:1;pointer-events:none}.reel-info strong,.reel-info p{pointer-events:auto}";
  document.head.append(style);
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
    root.innerHTML = (displayRows.map(r => '<article class="reel" data-reel-id="' + esc(r.id) + '">' +
        (r.signedMediaUrl ? '<video controls playsinline preload="metadata" src="' + esc(r.signedMediaUrl) + '"></video>' : '<p class="empty-state">This reel has no playable video.</p>') +
        '<div class="reel-info"><strong>' + esc(r.title || "Reel") + '</strong><p class="reel-cap">' + esc(r.caption || "") + '</p></div></article>').join("") || '<p class="empty-state">No reels yet. Create the first one.</p>');
  } catch (error) { fail(root, error); }
}
