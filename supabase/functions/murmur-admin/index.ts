const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({
    error: "This legacy Firebase endpoint has been retired. Use the Supabase-only Murmur application.",
    code: "LEGACY_ENDPOINT_RETIRED"
  }), { status: 410, headers: cors });
});
