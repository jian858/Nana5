/* Murmur Cloudflare edge connection.
 * Cloudflare serves the existing Supabase-backed app through its edge network.
 * Vercel remains the source origin; Supabase remains auth/database/storage.
 */
const ORIGIN = "https://murmurrr.vercel.app";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    const upstreamRequest = new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    });
    const upstream = await fetch(upstreamRequest);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("x-murmur-edge", "cloudflare");
    responseHeaders.set("x-content-type-options", "nosniff");
    responseHeaders.set("referrer-policy", "strict-origin-when-cross-origin");
    // Always revalidate app shell and code so deployments do not leave stale CSS/JS.
    if (incoming.pathname === "/" || incoming.pathname.endsWith(".html") ||
        /\\.(css|js|mjs|json|webmanifest)$/.test(incoming.pathname)) {
      responseHeaders.set("cache-control", "no-store, max-age=0");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
