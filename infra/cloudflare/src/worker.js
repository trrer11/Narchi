const ALLOWED_PREFIXES = ["ifc/", "vendor/"];

function contentType(key) {
  if (key.endsWith(".wasm")) return "application/wasm";
  if (key.endsWith(".js") || key.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function assetHeaders(key, etag) {
  const headers = new Headers({
    "Content-Type": contentType(key),
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (etag) headers.set("ETag", etag);
  return headers;
}

export default {
  async fetch(request, env, context) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (key.includes("..") || !ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return new Response("Not Found", { status: 404 });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      return request.method === "HEAD"
        ? new Response(null, { status: cached.status, headers: cached.headers })
        : cached;
    }

    const object = await env.ASSETS.get(key, {
      onlyIf: { etagDoesNotMatch: request.headers.get("If-None-Match") || undefined },
    });
    if (!object) return new Response("Not Found", { status: 404 });
    if (!object.body) return new Response(null, { status: 304, headers: assetHeaders(key, object.httpEtag) });

    const response = new Response(request.method === "HEAD" ? null : object.body, {
      headers: assetHeaders(key, object.httpEtag),
    });
    if (request.method === "GET") context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
