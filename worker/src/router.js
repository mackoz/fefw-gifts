import { corsHeaders, json } from './http.js';

// The injectable side effects. Handlers never touch the network, the clock or
// a UUID source directly, so a test can drive every route without any of them.
export function defaultDeps() {
  return {
    fetch: (...args) => globalThis.fetch(...args),
    now: () => new Date().toISOString(),
    uuid: () => crypto.randomUUID(),
  };
}

// A matcher returns the path parameters it captured (`{}` when there are none)
// or null when the path does not belong to it.
export const exact = (path) => (pathname) => (pathname === path ? {} : null);

export const oneParam = (prefix, name) => (pathname) => {
  if (!pathname.startsWith(`${prefix}/`)) return null;
  const value = pathname.slice(prefix.length + 1);
  if (!value || value.includes('/')) return null;
  return { [name]: decodeURIComponent(value) };
};

// Tasks 4 and 5 push their routes in here. `handle` takes the table as an
// argument so tests can drive the router with a stub table of their own.
export const ROUTES = [];

export async function handle(request, env, deps = defaultDeps(), routes = ROUTES) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const { pathname } = new URL(request.url);
  const onPath = routes.filter((route) => route.match(pathname) !== null);
  if (onPath.length === 0) return json({ error: 'not found' }, 404, cors);

  const route = onPath.find((candidate) => candidate.method === request.method);
  if (!route) {
    return json({ error: 'method not allowed' }, 405, {
      ...cors,
      Allow: [...new Set(onPath.map((candidate) => candidate.method))].join(', '),
    });
  }

  try {
    return await route.handler(request, env, deps, route.match(pathname));
  } catch (err) {
    // The Worker's own logs keep the detail; the browser gets nothing useful
    // to an attacker.
    console.error(err);
    return json({ error: 'internal error' }, 500, cors);
  }
}
