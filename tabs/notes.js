/* Murmur Notes tab. Owns note rendering and editing UI. */
import { supabase } from "../supabase-client.js?v=20261124-2";
import { userNotes } from "../supabase-data.js?v=20261124-2";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };

export async function renderNotes() {
  const root = el("noteRow");
  if (!root) return;
  try {
    const [{ data: authData, error: authError }, rows] = await Promise.all([
      supabase.auth.getUser(), userNotes.listMine()
    ]);
    if (authError) throw authError;
    const user = authData.user;
    if (!user) throw new Error("Sign in again to create a note.");
    let profile = {};
    try {
      const { data } = await supabase.from("murmur_public_profiles")
        .select("display_name,avatar_url").eq("id", user.id).maybeSingle();
      profile = data || {};
    } catch (_) {}
    const avatarUrl = profile.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
    const name = profile.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "You";
    const latest = rows[0] || null;
    root.innerHTML = '<button type="button" class="note-avatar-button" data-add-note title="' + (latest ? 'Edit or delete your note' : 'Create a note') + '" aria-label="' + (latest ? 'Edit or delete your note' : 'Create a note') + '">' +
      '<span class="note-action-label">' + esc(latest?.content || "Create note") + '</span>' +
      '<span class="note-avatar-circle">' + (avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="">' : '<span>' + esc(name.slice(0,1).toUpperCase()) + '</span>') +
      '</span>' +
      '</button>';
    root.querySelectorAll("[data-add-note]").forEach(noteButton => noteButton.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.className = "murmur-auth-modal murmur-note-modal";
      overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="note-title"><button type="button" class="murmur-modal-close" aria-label="Close">×</button><h2 id="note-title">' + (latest ? 'Edit your note' : 'Create a note') + '</h2><label for="note-content">Your note</label><textarea id="note-content" maxlength="500" rows="5" placeholder="What’s on your mind?">' + esc(latest?.content || "") + '</textarea><div class="note-editor-footer"><small data-note-count>0 / 500</small><button type="button" class="btn primary" data-save-note>Save note</button></div>' + (latest ? '<button type="button" class="note-delete" data-delete-current>Delete note</button>' : '') + '<p class="murmur-modal-error" role="alert"></p></section>';
      document.body.appendChild(overlay);
      const input = overlay.querySelector("#note-content");
      const save = overlay.querySelector("[data-save-note]");
      const errorBox = overlay.querySelector(".murmur-modal-error");
      const close = () => overlay.remove();
      overlay.querySelector(".murmur-modal-close")?.addEventListener("click", close);
      overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
      overlay.querySelector("[data-note-count]").textContent = input.value.length + " / 500";
      input.addEventListener("input", () => { overlay.querySelector("[data-note-count]").textContent = input.value.length + " / 500"; });
      save.addEventListener("click", async () => {
        const content = input.value.trim();
        if (!content) { errorBox.textContent = "Write something before saving."; input.focus(); return; }
        save.disabled = true;
        try {
          await userNotes.replaceMine({ content });
          close(); await renderNotes();
        } catch (error) { errorBox.textContent = error.message || "Could not save your note."; save.disabled = false; }
      });
      overlay.querySelector("[data-delete-current]")?.addEventListener("click", async () => {
        try { await userNotes.removeMine(); close(); await renderNotes(); }
        catch (error) { errorBox.textContent = error.message || "Could not delete your note."; }
      });
      input.focus();
    }));
  } catch (error) { fail(root, error); }
}
