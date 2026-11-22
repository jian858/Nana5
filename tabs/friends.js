/* Murmur Friends tab: friend list, incoming requests and people search. */
import { supabase } from "../supabase-client.js";
import { friendships } from "../supabase-data.js?v=20261122-4";
const el = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fail = (container, error) => { if (container) container.innerHTML = '<p class="empty-state">' + esc(error.message || "Could not load this section.") + '</p>'; };
const avatarMarkup = (person, label = "View profile") => {
  const name = person?.display_name || person?.username || "Murmur user";
  const initial = esc(name.slice(0, 1).toUpperCase());
  const image = person?.avatar_url
    ? '<img src="' + esc(person.avatar_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.textContent=\'' + initial + '\'">'
    : initial;
  return '<span class="avatar" role="img" aria-label="' + esc(label) + '" style="display:inline-flex;align-items:center;justify-content:center;overflow:hidden;border-radius:50%;flex:0 0 auto">' + image + '</span>';
};
export async function renderFriends() {
  const list = el("friendsList");
  const search = el("searchResults");
  if (list) list.innerHTML = "<p>Loading friends…</p>";
  try {
    const rows = await friendships.people("accepted");
    if (list) list.innerHTML = rows.length ? rows.map(row => {
      const p = row.person || {};
      return '<article class="friend-row">' + avatarMarkup(p, "Friend profile picture") + '<div><strong>' + esc(p.display_name || "Murmur user") + '</strong><small>@' + esc(p.username || "") + '</small></div><button class="btn secondary" type="button" data-chat-user="' + esc(p.id) + '">Message</button></article>';
    }).join("") : '<p class="empty-state">Your friends will appear here.</p>';

    if (search) search.innerHTML = "";
    const incoming = await friendships.incoming();
    const reqList = el("reqList");
    if (el("reqCard")) el("reqCard").hidden = !incoming.length;
    if (el("reqCount")) el("reqCount").textContent = incoming.length ? String(incoming.length) : "";
    const requesterIds = [...new Set(incoming.map(row => row.requester_id))];
    const { data: requesters, error: requesterError } = requesterIds.length
      ? await supabase.from("murmur_public_profiles").select("id,display_name,username,avatar_url").in("id", requesterIds)
      : { data: [], error: null };
    if (requesterError) throw requesterError;
    const requesterById = new Map((requesters || []).map(person => [person.id, person]));
    if (reqList) reqList.innerHTML = incoming.map(row => {
      const person = requesterById.get(row.requester_id) || {};
      const name = person.display_name || (person.username ? "@" + person.username : "Someone");
      return '<div class="friend-row"><button type="button" class="friend-request-profile" data-open-profile="' + esc(row.requester_id) + '" aria-label="View ' + esc(name) + ' profile" style="border:0;background:transparent;padding:0;cursor:pointer">' + avatarMarkup(person, "Open profile") + '</button><div><button type="button" class="people-profile-name" data-open-profile="' + esc(row.requester_id) + '">' + esc(name) + '</button><small>@' + esc(person.username || "") + ' · Friend request</small></div><button class="btn primary" type="button" data-accept="' + esc(row.requester_id) + '">Accept</button></div>';
    }).join("");
    reqList?.querySelectorAll("[data-accept]").forEach(button => button.addEventListener("click", async () => {
      try { await friendships.setStatus(button.dataset.accept, "accepted"); await renderFriends(); }
      catch (error) { alert(error.message); }
    }));
  } catch (error) { fail(list, error); }
}
let peopleSearchRun = 0;
export async function searchPeople() {
  const input = el("friendSearch");
  const button = el("friendSearchBtn");
  const target = el("searchResults");
  const term = (input?.value || "").trim().replace(/^@+/, "");
  if (!target) return;
  const run = ++peopleSearchRun;
  if (el("peopleBlock")) el("peopleBlock").hidden = false;
  if (!term) {
    target.innerHTML = '<p class="empty-state">Type a name or username to find people.</p>';
    return;
  }

  const originalLabel = button?.textContent || "Search";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = '<span class="people-search-spinner" aria-hidden="true"></span><span>Searching</span>';
  }
  target.setAttribute("aria-busy", "true");
  target.innerHTML = '<div class="people-search-loading"><span class="people-search-spinner" aria-hidden="true"></span><span>Searching the database…</span></div>';

  try {
    // Escape PostgREST OR/filter punctuation and LIKE wildcards while retaining
    // partial-name matching for both display names and usernames.
    const safe = term.replace(/[\\%_(),]/g, " ").replace(/\s+/g, " ").trim();
    if (!safe) {
      target.innerHTML = '<p class="empty-state">Enter a valid name or username to search.</p>';
      return;
    }
    const pattern = "%" + safe + "%";
    const { data, error } = await supabase.from("murmur_public_profiles")
      .select("id,username,display_name,avatar_url")
      .or("username.ilike." + pattern + ",display_name.ilike." + pattern)
      .limit(20);
    if (error) throw error;
    if (run !== peopleSearchRun) return;
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const currentUserId = sessionData?.session?.user?.id;
    const matches = (data || []).filter(person => person.id !== currentUserId);
    target.innerHTML = matches.map(person =>
      '<div class="friend-row"><button class="avatar" type="button" data-open-profile="' + esc(person.id) + '" aria-label="View profile" style="padding:0;overflow:hidden;border-radius:50%;flex:0 0 auto">' + (person.avatar_url ? '<img src="' + esc(person.avatar_url) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.remove();this.parentElement.textContent=\'' + esc((person.display_name || person.username || "?").slice(0,1).toUpperCase()) + '\'">' : esc((person.display_name || person.username || "?").slice(0,1).toUpperCase())) + '</button><div><button class="people-profile-name" type="button" data-open-profile="' + esc(person.id) + '">' + esc(person.display_name || "Murmur user") + '</button><small>@' + esc(person.username || "") + '</small></div><div class="friend-actions"><button class="btn secondary" type="button" data-chat-user="' + esc(person.id) + '">Message</button><button class="btn secondary" type="button" data-request="' + esc(person.id) + '">Add friend</button></div></div>'
    ).join("") || '<p class="empty-state">No account found. Try another name or username.</p>';

    target.querySelectorAll("[data-request]").forEach(action => action.addEventListener("click", async () => {
      action.disabled = true;
      try { await friendships.request(action.dataset.request); action.textContent = "Request sent"; }
      catch (error) { action.disabled = false; alert(error.message); }
    }));
  } catch (error) {
    if (run === peopleSearchRun) fail(target, error);
  } finally {
    if (run === peopleSearchRun) {
      target.removeAttribute("aria-busy");
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = originalLabel;
      }
    }
  }
}
