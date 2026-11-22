/* Murmur Reels tab. Owns reel rendering. */
import { reels, storage } from "../supabase-data.js?v=20261122-4";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };

export async function renderReels() {
  const root = el("reelsFeed");
  if (!root) return;
  try {
    const rows = await reels.list();
    const displayRows = await Promise.all(rows.map(async reel => ({
      ...reel,
      signedMediaUrl: reel.storage_path ? await storage.url("murmur-reels", reel.storage_path) : reel.video_url
    })));
    root.innerHTML = displayRows.map(r => '<article class="reel-card"><video controls playsinline preload="metadata" src="' + esc(r.signedMediaUrl || "") + '"></video><strong>' + esc(r.title || "Reel") + '</strong><p>' + esc(r.caption || "") + '</p></article>').join("") || '<p class="empty-state">No reels yet.</p>';
  } catch (error) { fail(root, error); }
}
