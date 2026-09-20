// Shared HTTP helpers. Deliberately free of Cloudflare-only globals so
// `node:test` can import this file directly -- Request, Response and URL are
// all standard in Node 22.

export function allowedOrigins(env) {
  return String(env?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// `Vary: Origin` is set whether or not the origin is allowed. The body is the
// same either way but the allow header is not, and a shared cache that missed
// that would serve one site's CORS grant to another.
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
