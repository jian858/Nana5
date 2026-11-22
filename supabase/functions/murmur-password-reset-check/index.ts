import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function makeDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is incomplete.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function rateLimit(db: ReturnType<typeof makeDb>, key: string, limit: number) {
  const { data, error } = await db.rpc("consume_edge_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: 300,
  });
  if (error) throw error;
  return data === true;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

const allowedOrigins = new Set([
  "https://murmur-app-7jm.pages.dev",
  "https://murmurrr.vercel.app",
  "https://mumur-eta.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply(400, { status: "invalid_email", message: "Enter a valid email address." });
    }

    const db = makeDb();
    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
    const emailKey = await digest(email);
    if (!await rateLimit(db, "murmur-recovery-ip:" + ip, 10) ||
        !await rateLimit(db, "murmur-recovery-email:" + emailKey, 3)) {
      return new Response(JSON.stringify({
        status: "rate_limited",
        message: "Too many recovery attempts. Please wait five minutes before trying again."
      }), { status: 429, headers: { ...cors, "Retry-After": "300" } });
    }

    // Admin lookup stays on the server. Never return user IDs or profile data.
    let matchedUser: { id: string; email?: string } | null = null;
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data.users || [];
      matchedUser = users.find((u) => (u.email || "").toLowerCase() === email) || null;
      if (matchedUser || users.length < 1000) break;
    }

    if (!matchedUser) {
      const { data: deleted, error } = await db.rpc("murmur_is_permanently_deleted_email", { p_email: email });
      if (error) throw error;
      if (deleted === true) {
        return reply(200, {
          status: "permanently_deleted",
          message: "This Murmur account was permanently deleted. It cannot be recovered and no password reset link was sent."
        });
      }
      return reply(200, {
        status: "not_found",
        message: "We couldn't find a Murmur account with this email address. No password reset link was sent."
      });
    }

    const [{ data: restrictions, error: restrictionError }, { data: profile, error: profileError }] = await Promise.all([
      db.from("account_restrictions")
        .select("status,reason,starts_at,ends_at,scheduled_delete_at,created_at")
        .eq("user_id", matchedUser.id)
        .in("status", ["suspended", "terminated", "scheduled_deletion", "deleted"])
        .order("created_at", { ascending: false })
        .limit(5),
      db.from("profiles").select("is_suspended,suspension_reason").eq("id", matchedUser.id).maybeSingle()
    ]);
    if (restrictionError) throw restrictionError;
    if (profileError) throw profileError;

    const now = Date.now();
    const active = (restrictions || []).find((r) => {
      const start = r.starts_at ? new Date(r.starts_at).getTime() : 0;
      const end = r.ends_at ? new Date(r.ends_at).getTime() : null;
      return start <= now && (end === null || end > now);
    });

    if (active?.status === "terminated") {
      return reply(200, {
        status: "terminated",
        message: "This Murmur account has been terminated and permanently disabled. Password reset is unavailable. Contact Murmur support if you believe this is a mistake."
      });
    }
    if (active?.status === "suspended" || (profile?.is_suspended && !active)) {
      const until = active?.ends_at ? new Date(active.ends_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : null;
      return reply(200, {
        status: "suspended",
        message: until
          ? "This Murmur account is suspended until " + until + ". Password reset is unavailable while the suspension is active."
          : "This Murmur account is suspended. Password reset is unavailable while the suspension is active."
      });
    }
    if (active?.status === "scheduled_deletion") {
      const when = active.scheduled_delete_at ? new Date(active.scheduled_delete_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : null;
      return reply(200, {
        status: "scheduled_deletion",
        message: when
          ? "This Murmur account is scheduled for permanent deletion on " + when + ". A password reset link cannot be sent."
          : "This Murmur account is scheduled for permanent deletion. A password reset link cannot be sent."
      });
    }
    if (active?.status === "deleted") {
      return reply(200, {
        status: "permanently_deleted",
        message: "This Murmur account was permanently deleted. It cannot be recovered and no password reset link was sent."
      });
    }

    const requestOrigin = req.headers.get("origin") || "";
    const redirectOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : "https://murmur-app-7jm.pages.dev";
    const { error: resetError } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: redirectOrigin + "/?password-reset=1"
    });
    if (resetError) {
      const msg = String(resetError.message || "");
      if (/rate limit|too many requests|over_email_send_rate_limit/i.test(msg)) {
        return new Response(JSON.stringify({
          status: "rate_limited",
          message: "Murmur is protecting your inbox. Wait before requesting another reset email."
        }), { status: 429, headers: { ...cors, "Retry-After": "60" } });
      }
      throw resetError;
    }

    return reply(200, {
      status: "sent",
      message: "Your account was found and is eligible for recovery. A password reset link has been requested. Check your inbox and spam folder."
    });
  } catch (error) {
    console.error("murmur-password-reset-check:", error);
    return reply(500, { status: "error", message: "Murmur could not finish checking this account. Please try again later." });
  }
});
