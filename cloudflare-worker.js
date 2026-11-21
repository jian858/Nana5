/* Murmur Cloudflare edge entry point.
 * Cloudflare Pages hosts the static application; Supabase provides auth and data.
 * No Vercel origin or third-party hosting dependency.
 */
const ORIGIN = "https://murmur-app-7jm.pages.dev";

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
    if (incoming.pathname === "/" || incoming.pathname.endsWith(".html") ||
        /\.(css|js|mjs|json|webmanifest)$/.test(incoming.pathname)) {
      responseHeaders.set("cache-control", "no-store, max-age=0");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
