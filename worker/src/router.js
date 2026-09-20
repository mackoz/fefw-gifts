import { corsHeaders, json } from './http.js';
import { verifyTurnstile } from './turnstile.js';
import { validateReport, insertReport, listPending, recordVote } from './reports.js';

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

// Generous next to a real report and small enough that a parser is never handed
// something interesting.
const MAX_BODY_BYTES = 8192;

async function readJson(request) {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooLarge: true, body: null };
  try {
    return { tooLarge: false, body: await request.json() };
  } catch {
    return { tooLarge: false, body: null };
  }
}

// Turnstile runs before anything else reads the payload, so an unverified
// caller cannot use validation messages to probe the endpoint.
async function guard(request, env, deps) {
  const { tooLarge, body } = await readJson(request);
  const cors = corsHeaders(request, env);
  if (tooLarge) return { error: json({ error: 'that request is too large' }, 413, cors) };
  if (body === null || typeof body !== 'object') {
    return { error: json({ error: 'expected a JSON body' }, 400, cors) };
  }

  const check = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, deps.fetch);
  if (!check.ok) {
    return { error: json({ error: 'could not verify that you are human', reason: check.reason }, 403, cors) };
  }
  return { body, cors };
}

async function postReport(request, env, deps) {
  const { error, body, cors } = await guard(request, env, deps);
  if (error) return error;

  const { errors, value } = validateReport(body);
  if (errors.length) return json({ error: errors[0], errors }, 400, cors);

  const id = deps.uuid();
  await insertReport(env.DB, { id, ...value, createdAt: deps.now() });
  return json({ id, status: 'pending' }, 201, cors);
}

async function postVote(request, env, deps) {
  const { error, body, cors } = await guard(request, env, deps);
  if (error) return error;

  if (typeof body.id !== 'string' || body.id === '' || body.id.length > 64) {
    return json({ error: 'a vote needs the id of a pending report' }, 400, cors);
  }
  if (body.direction !== 'up' && body.direction !== 'down') {
    return json({ error: 'direction must be "up" or "down"' }, 400, cors);
  }

  const recorded = await recordVote(env.DB, body.id, body.direction);
  if (!recorded) return json({ error: 'no pending report with that id' }, 404, cors);

  // The response deliberately carries no tally. The caller learns that its vote
  // landed and nothing more -- see the spec's "Peer validation by voting".
  return json({ recorded: true }, 200, cors);
}

async function getPending(request, env) {
  const rows = await listPending(env.DB);
  return json({ pending: rows }, 200, {
    ...corsHeaders(request, env),
    // A stale minute costs nothing: the overlay is a convenience layer, and the
    // alternative is hitting D1 on every page view.
    'Cache-Control': 'public, max-age=60',
  });
}

// Tasks 4 and 5 push their routes in here. `handle` takes the table as an
// argument so tests can drive the router with a stub table of their own.
export const ROUTES = [
  { method: 'POST', match: exact('/report'), handler: postReport },
  { method: 'POST', match: exact('/vote'), handler: postVote },
  { method: 'GET', match: exact('/pending'), handler: getPending },
];

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
