/*
  Put this HTML on your page:
    <div id="messages"></div>
    <input id="chat-input" placeholder="Message, or /ban name reason">
    <script type="module" src="chat-moderation.js"></script>
*/

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"; // Supabase -> Project Settings -> API
const SUPABASE_KEY = "YOUR-ANON-PUBLIC-KEY";              // anon / publishable key. NEVER the service_role key
const SUPPORT_URL = "/help";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const input = document.querySelector("#chat-input");
const box = document.querySelector("#messages");

function addLine(text, cls = "") {
  const p = document.createElement("p");
  p.textContent = text; // textContent blocks injected HTML
  p.className = cls;
  box.append(p);
  box.scrollTop = box.scrollHeight;
}

// ---------- chat commands ----------
//  /ban alice spamming         /suspend alice 7 spamming   (7 days)
//  /terminate alice reason     /delete alice reason        /unban alice
const COMMANDS = { ban: "banned", suspend: "suspended", terminate: "terminated", delete: "deleted" };
const USAGE = "Usage: /ban | /suspend | /terminate | /delete <name> [days] [reason]  ·  /unban <name>";

async function runCommand(text) {
  const [cmd, name, ...rest] = text.slice(1).trim().split(/\s+/);
  const command = (cmd || "").toLowerCase();

  if (command === "unban" && name) {
    const { data, error } = await supabase.rpc("lift_actions", { p_username: name });
    return error ? "⚠️ " + error.message : `✅ Lifted ${data} action(s) on ${name}`;
  }

  const status = COMMANDS[command];
  if (!status || !name) return USAGE;

  let days = null; // only used by /suspend
  if (status === "suspended" && /^\d+$/.test(rest[0] || "")) days = Number(rest.shift());

  const { data, error } = await supabase.rpc("moderate", {
    p_username: name,
    p_status: status,
    p_reason: rest.join(" ") || null,
    p_days: days,
  });
  return error ? "⚠️ " + error.message : `✅ ${name} is now ${status} (case ${data})`;
}

// ---------- the pop-up the banned user sees ----------
const NOTICES = {
  suspended:  ["Account suspended",  "Your access is paused for now."],
  banned:     ["Account banned",     "You can no longer use this service."],
  terminated: ["Account terminated", "Your account has been closed."],
  deleted:    ["Account deleted",    "Your account and data were removed."],
};
const fmt = (d) => (d ? new Date(d).toLocaleDateString() : null);

function showAccountNotice(a) {
  const [title, msg] = NOTICES[a.status] || [];
  if (!title || document.querySelector("#account-notice")) return;

  const d = document.createElement("dialog");
  d.id = "account-notice";
  d.style.cssText = "max-width:420px;padding:24px;border-radius:12px";
  const add = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    d.append(e);
    return e;
  };

  add("h2", title);
  add("p", msg);
  [["Reason", a.reason], ["Date", fmt(a.created_at)], ["Ends", fmt(a.ends_on)],
   ["Appeal by", fmt(a.appeal_by)], ["Download data by", fmt(a.export_by)],
   ["Restore by", fmt(a.restore_by)], ["Case ID", "A-" + a.id]]
    .forEach(([k, v]) => v && add("p", `${k}: ${v}`));

  const help = add("a", "Contact support");
  help.href = `${SUPPORT_URL}?case=A-${a.id}`;
  help.style.cssText = "display:block;margin:12px 0";

  add("button", "OK").onclick = async () => {
    await supabase.auth.signOut();
    location.reload();
  };
  d.addEventListener("cancel", (e) => e.preventDefault()); // Esc can't close it
  document.body.append(d);
  d.showModal();
}

// Is my account blocked right now? (runs on page load and when a send is refused)
async function checkMyAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data } = await supabase.from("account_actions").select("*")
    .eq("user_id", user.id).is("lifted_at", null)
    .or(`ends_on.is.null,ends_on.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false }).limit(1);
  if (data?.length) showAccountNotice(data[0]);
}

// ---------- sending messages ----------
input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  if (text.startsWith("/")) return addLine(await runCommand(text), "system");

  const { error } = await supabase.from("messages").insert({ content: text });
  if (error) {
    addLine("⚠️ " + error.message, "system");
    if (error.code === "42501") checkMyAccount(); // refused by security rules -> blocked
  }
});

// ---------- start ----------
async function start() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return addLine("Log in first (see the bottom of this file).", "system");

  const { data: past } = await supabase.from("messages").select("username, content")
    .order("created_at", { ascending: false }).limit(50);
  (past || []).reverse().forEach((m) => addLine(`${m.username}: ${m.content}`));

  // live chat
  supabase.channel("chat")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" },
        ({ new: m }) => addLine(`${m.username}: ${m.content}`))
    .subscribe();

  // if someone bans YOU while you're online, the pop-up shows instantly
  supabase.channel("my-account")
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "account_actions", filter: `user_id=eq.${session.user.id}` },
        ({ new: row }) => showAccountNotice(row))
    .subscribe();

  checkMyAccount(); // already banned? show the pop-up right away
}
start();

// ---------- login (call from your login form, then reload) ----------
// await supabase.auth.signUp({ email, password, options: { data: { username: "alice" } } });
// await supabase.auth.signInWithPassword({ email, password });
