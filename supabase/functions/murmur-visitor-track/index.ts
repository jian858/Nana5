import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Server configuration is incomplete.");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const body = await req.json().catch(() => ({}));
    const visitorId = String(body.visitor_id || body.p_visitor_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) {
      return reply(400, { error: "A valid visitor ID is required." });
    }

    const rawPath = String(body.page_path || body.p_page_path || "/").split("?")[0].split("#")[0];
    const pagePath = rawPath.startsWith("/") && rawPath.length <= 120 && /^\/[a-zA-Z0-9/_-]*$/.test(rawPath)
      ? rawPath : "/";

    const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
    const ip = forwarded.split(",")[0].trim().slice(0, 80);
    if (ip) {
      const { data: allowed, error: rateError } = await db.rpc("consume_edge_rate_limit", {
        p_key: "murmur-visitor-edge-ip:" + ip,
        p_limit: 200,
        p_window_seconds: 300,
      });
      if (rateError) throw rateError;
      if (allowed !== true) return reply(200, { recorded: false, throttled: true });
    }

    const { data, error } = await db.rpc("record_murmur_visit", {
      p_visitor_id: visitorId,
      p_page_path: pagePath,
    });
    if (error) throw error;
    return reply(200, { recorded: data === true, throttled: data === false });
  } catch (error) {
    console.error("murmur-visitor-track failure", error instanceof Error ? error.message : error);
    return reply(503, { error: "Visitor tracking is temporarily unavailable." });
  }
});
