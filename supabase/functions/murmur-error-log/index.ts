import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra } });
const clean = (value: unknown, max: number) => String(value ?? "")
  .replace(/[\r\n\t]+/g, " ")
  .replace(/Bearer\s+\S+/gi, "[redacted]")
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
  .slice(0, max);

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function limit(db: ReturnType<typeof createAdminClient>, key: string, max: number) {
  const { data, error } = await db.rpc("consume_edge_rate_limit", {
    p_key: key, p_limit: max, p_window_seconds: 300,
  });
  if (error) throw error;
  return data === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!["POST", "GET", "DELETE"].includes(req.method)) return reply(405, { error: "Method not allowed." });

  try {
    const db = createAdminClient();
    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown")
      .split(",")[0].trim().slice(0, 80);
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    let user: { id: string; email?: string } | null = null;

    if (!token) return reply(401, { error: "A signed-in Supabase account is required." });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return reply(401, { error: "The Supabase session is invalid or expired." });
    user = { id: data.user.id, email: data.user.email };

    if (req.method === "POST") {
      if (!await limit(db, "murmur-error-ip:" + ip, 60)) {
        return reply(429, { error: "Error log limit reached. Try again in five minutes." }, { "Retry-After": "300" });
      }
      const actorKey = "supabase:" + user.id;
      if (!await limit(db, "murmur-error-user:" + user.id, 20)) {
        return reply(429, { error: "Error log limit reached. Try again in five minutes." }, { "Retry-After": "300" });
      }
      const body = await req.json().catch(() => ({}));
      const kind = ["crash", "handled", "resource", "database", "api", "network", "storage", "auth", "feature"].includes(body.kind)
        ? body.kind : "handled";
      const message = clean(body.message, 500) || "Unknown app error";
      const fingerprint = clean(body.fingerprint, 120) || message.toLowerCase().slice(0, 120);
      const { data: duplicates, error: duplicateError } = await db.from("murmur_error_logs")
        .select("id").eq("firebase_uid", actorKey).eq("fingerprint", fingerprint)
        .gte("created_at", new Date(Date.now() - 60_000).toISOString()).limit(1);
      if (duplicateError) throw duplicateError;
      if (duplicates?.length) return reply(200, { ok: true, duplicate: true });

      const { error } = await db.from("murmur_error_logs").insert({
        firebase_uid: actorKey,
        kind,
        message,
        fingerprint,
        code: clean(body.code, 100) || null,
        source: clean(body.source, 300) || null,
        line: Number.isInteger(body.line) && body.line >= 0 ? body.line : null,
        column_number: Number.isInteger(body.column_number ?? body.column) && (body.column_number ?? body.column) >= 0
          ? (body.column_number ?? body.column) : null,
        page: clean(body.page, 160) || null,
        user_agent: clean(body.user_agent || body.userAgent || req.headers.get("user-agent"), 240) || null,
        stack: clean(body.stack, 1400) || null,
      });
      if (error) throw error;
      return reply(201, { ok: true, identity: "supabase" });
    }

    if (!user) return reply(401, { error: "Sign in with your Supabase admin account." });
    const { data: admin, error: adminError } = await db.from("murmur_admin_allowlist")
      .select("user_id,email,role,enabled").eq("user_id", user.id).eq("enabled", true).maybeSingle();
    if (adminError) throw adminError;
    if (!admin || admin.role !== "super_admin" || admin.email?.toLowerCase() !== user.email?.toLowerCase()) {
      return reply(403, { error: "Enabled Supabase Super Admin access is required." });
    }
    if (!await limit(db, "murmur-error-admin:" + user.id, 60)) {
      return reply(429, { error: "Admin log request limit reached." }, { "Retry-After": "300" });
    }

    if (req.method === "GET") {
      const amount = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 300));
      const { data, error } = await db.from("murmur_error_logs").select("*")
        .order("created_at", { ascending: false }).limit(amount);
      if (error) throw error;
      return reply(200, { items: data || [] });
    }

    const id = new URL(req.url).searchParams.get("id");
    let deletion = db.from("murmur_error_logs").delete();
    deletion = id ? deletion.eq("id", id) : deletion.gte("created_at", "1970-01-01T00:00:00.000Z");
    const { error } = await deletion;
    if (error) throw error;
    return reply(200, { ok: true });
  } catch (error) {
    console.error("murmur-error-log backend failure", error instanceof Error ? error.message : error);
    return reply(500, { error: "Error log service is temporarily unavailable." });
  }
});
