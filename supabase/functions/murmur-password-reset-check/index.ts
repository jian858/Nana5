const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({
    error: "Use Supabase Auth's native password reset flow. This legacy account-check endpoint has been retired.",
    code: "LEGACY_ENDPOINT_RETIRED"
  }), { status: 410, headers: cors });
});
