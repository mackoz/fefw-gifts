# Submissions, Peer Voting and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any player report an item-level gift result from the site itself, let other visitors vote on pending reports as a private maintainer signal, and give the maintainer a private page to approve reports into the repository.

**Architecture:** A Cloudflare Worker backed by D1 holds a queue of anonymous
reports. The published site fetches pending rows and overlays them on the
committed data as a new `PENDING` confidence state that is explicitly not a
confirmation. Votes adjust counters that only the admin-gated endpoints ever
return. A scheduled GitHub Action pulls approved rows, appends them to
`data/observations.json` and opens a pull request, so the repository stays the
single source of truth and the Worker stays a convenience layer over it.

**Tech Stack:** Vanilla ES modules, Cloudflare Workers + D1 + Turnstile,
`node:test`, GitHub Actions. No npm dependencies and no build step.

**Spec:** `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md` — the
**Contributions** section is the binding part for this plan.

## Global Constraints

- **No npm dependencies and no devDependencies.** `package.json` carries scripts
  only. Wrangler is invoked through `npx wrangler …` by the maintainer and is
  never installed into `package.json`. If a task seems to need a package, stop
  and rule on it rather than adding one.
- **No build step.** Every file is served exactly as committed.
- **Node floor is 22.** `npm test` is bare `node --test` with no path argument —
  a path argument resolves as a module specifier on Node 22 and breaks CI.
- **Browser modules stay Node-importable.** Everything under `assets/js/` uses
  ESM `export`, has no top-level DOM access, and must import cleanly in
  `node:test`. DOM access lives inside functions that receive their elements.
- **Worker modules stay Node-importable too.** No top-level `env` access and no
  Cloudflare-only globals at module scope. `Request`, `Response`, `URL`,
  `URLSearchParams` and `crypto.randomUUID` are standard in Node 22 and may be
  used freely; anything else is injected.
- **Absence of a match is never a dislike.** Only an actual observation may
  produce a negative result.
- **A `PENDING` report must not** flip a pair to `CONFIRMED` or `FAVORITE`,
  contribute `points`, count toward a confirmed-report tally, or produce a
  negative verdict on a pair.
- **Votes never reach the published site.** `GET /pending` must not select or
  return `upvotes`/`downvotes`, and no public view may render a tally. This is
  enforced at the SQL layer, not only in the UI.
- **No personal data anywhere.** No name, email, IP, hashed IP, session id,
  fingerprint or any other identifier in the D1 schema, the Worker, the client,
  or `data/observations.json`. Turnstile is called without `remoteip`.
- **The site must work completely with the Worker unavailable or unconfigured.**
  Committed data renders from GitHub Pages alone; a failed `/pending` skips the
  overlay silently and the form reports that submissions are unavailable.
- **Deployment stays gated on validation.** Never add a deploy path that
  bypasses `needs: test` in `.github/workflows/ci.yml`.
- **Run `npm test` and `npm run validate` before every commit.** Both must pass
  with no stray warnings.
- **Copy conventions:** user-visible text uses British spelling
  (“favourite”, “unauthorised”); identifiers and data values keep the
  American spelling already in the data (`favorite`).

---

## File Structure

**New — Cloudflare Worker (not served by Pages, deployed separately):**

| File | Responsibility |
|---|---|
| `worker/wrangler.toml` | Worker config: name, entry point, D1 binding, allowed origins. No secrets. |
| `worker/schema.sql` | The single `reports` table and its status index. |
| `worker/src/http.js` | CORS headers, allowed-origin parsing, JSON responses. |
| `worker/src/turnstile.js` | Turnstile token verification. |
| `worker/src/reports.js` | Payload validation and every D1 statement. |
| `worker/src/router.js` | Route table, handlers, admin-token gating. |
| `worker/src/index.js` | `export default { fetch }` — three lines, no logic. |
| `worker/README.md` | Operator setup: D1, Turnstile, secrets, deploy, rotation. |
| `worker/test-support/fake-d1.mjs` | D1-shaped stand-in for tests. Lives outside `test/` on purpose — Node's runner treats every file under a `test/` directory as a test file. |

**New — site:**

| File | Responsibility |
|---|---|
| `assets/js/config.js` | Public Worker URL and Turnstile site key. Null until deployed. |
| `assets/js/api.js` | The only module that talks to the Worker. Never throws. |
| `assets/js/overlay.js` | Groups pending rows by (character, gift) pair. Pure. |
| `assets/js/turnstile.js` | Wraps the Turnstile widget behind an injectable seam. |
| `assets/js/report-form.js` | Report payload building (pure) and dialog wiring. |
| `assets/js/votes.js` | `localStorage` record of which reports this browser voted on. |
| `assets/js/vote-control.js` | Vote control model (pure) and its DOM. |
| `assets/js/review.js` | The maintainer review page. |
| `review/index.html` | The `/review` route. Not linked from the nav, `noindex`. |
| `scripts/ingest.mjs` | Pulls approved rows into `data/observations.json`. |
| `.github/workflows/sync-reports.yml` | Scheduled ingest that opens a pull request. |

**Modified:**

| File | Change |
|---|---|
| `assets/js/confidence.js` | Accept `pending`; derive the `PENDING` state; export `REACTIONS`. |
| `assets/js/views/shared.js` | Rank, label and a report button for `PENDING`. |
| `assets/js/filters.js` | `hideUnconfirmed` keeps `PENDING`. |
| `assets/js/views/matrix.js` | `PENDING` symbol and legend. |
| `assets/js/views/character.js`, `views/gift.js` | Report buttons and vote controls. |
| `assets/js/data.js` | `buildIndex(dataset, pending)`. |
| `assets/js/app.js` | Create the API client, load the overlay, wire the dialogs. |
| `assets/css/style.css` | `PENDING` palette, dialog, vote and review styles. |
| `index.html` | Report button, report dialog, vote dialog, footer copy. |
| `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` | Document the new contribution path. |

---

### Task 1: Worker foundation — config, schema, CORS and routing

**Files:**
- Create: `worker/wrangler.toml`
- Create: `worker/schema.sql`
- Create: `worker/src/http.js`
- Create: `worker/src/router.js`
- Create: `worker/src/index.js`
- Test: `test/worker-http.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `allowedOrigins(env) -> string[]`
  - `corsHeaders(request, env) -> Record<string, string>`
  - `json(body, status = 200, headers = {}) -> Response`
  - `defaultDeps() -> { fetch, now, uuid }`
  - `handle(request, env, deps = defaultDeps(), routes = ROUTES) -> Promise<Response>`
  - `ROUTES: Array<{ method, match(pathname) -> object | null, handler }>` —
    exported and empty in this task; Tasks 4 and 5 push entries into it.
  - `exact(path)` and `oneParam(prefix, name)` route matchers.

- [ ] **Step 1: Write the failing test**

Create `test/worker-http.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, corsHeaders, json } from '../worker/src/http.js';
import { handle, exact, oneParam } from '../worker/src/router.js';

const ENV = { ALLOWED_ORIGINS: 'https://mackoz.github.io, https://example.test' };

const req = (method, url, headers = {}) => new Request(url, { method, headers });

test('allowedOrigins splits and trims the configured list', () => {
  assert.deepEqual(allowedOrigins(ENV), ['https://mackoz.github.io', 'https://example.test']);
  assert.deepEqual(allowedOrigins({}), []);
});

test('an allowed origin is echoed back', () => {
  const headers = corsHeaders(req('GET', 'https://api.test/pending', { Origin: 'https://mackoz.github.io' }), ENV);
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://mackoz.github.io');
  assert.equal(headers.Vary, 'Origin');
});

test('an unknown origin gets no allow header but still varies on Origin', () => {
  const headers = corsHeaders(req('GET', 'https://api.test/pending', { Origin: 'https://evil.test' }), ENV);
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(headers.Vary, 'Origin');
});

test('preflight is answered without reaching a handler', async () => {
  const res = await handle(req('OPTIONS', 'https://api.test/report', { Origin: 'https://mackoz.github.io' }), ENV, undefined, []);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://mackoz.github.io');
});

test('an unknown path is a JSON 404', async () => {
  const res = await handle(req('GET', 'https://api.test/nope'), ENV, undefined, []);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
});

test('a known path with the wrong method is a 405 that names the allowed ones', async () => {
  const routes = [{ method: 'POST', match: exact('/report'), handler: () => json({ ok: true }) }];
  const res = await handle(req('GET', 'https://api.test/report'), ENV, undefined, routes);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
});

test('a handler receives the path parameters it matched', async () => {
  const routes = [{
    method: 'POST',
    match: oneParam('/review', 'id'),
    handler: (request, env, deps, params) => json({ id: params.id }),
  }];
  const res = await handle(req('POST', 'https://api.test/review/abc-123'), ENV, undefined, routes);
  assert.deepEqual(await res.json(), { id: 'abc-123' });
});

test('oneParam rejects a missing or nested id', () => {
  const match = oneParam('/review', 'id');
  assert.equal(match('/review'), null);
  assert.equal(match('/review/'), null);
  assert.equal(match('/review/a/b'), null);
});

test('a thrown handler becomes a 500 that leaks nothing', async () => {
  const routes = [{ method: 'GET', match: exact('/boom'), handler: () => { throw new Error('secret detail'); } }];
  const res = await handle(req('GET', 'https://api.test/boom'), ENV, undefined, routes);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal error' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/worker-http.test.mjs`
Expected: FAIL — `Cannot find module '.../worker/src/http.js'`.

The 500 test writes the error to stderr through `console.error`. Silence it
inside that one test by stubbing the console, so the suite stays clean:

```js
  const original = console.error;
  console.error = () => {};
  try { /* the assertions above */ } finally { console.error = original; }
```

Apply that wrapper to the thrown-handler test when you write Step 1.

- [ ] **Step 3: Write `worker/src/http.js`**

```js
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
```

- [ ] **Step 4: Write `worker/src/router.js`**

```js
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
```

- [ ] **Step 5: Write `worker/src/index.js`**

```js
import { handle } from './router.js';

// Cloudflare's third argument is its own ExecutionContext, which this Worker
// does not use. The router's injectable dependencies are a separate thing and
// are left at their defaults here.
export default {
  fetch: (request, env) => handle(request, env),
};
```

- [ ] **Step 6: Write `worker/schema.sql`**

```sql
-- D1 schema for the report queue.
--
-- "character" is quoted everywhere it appears: SQLite tolerates it bare, but it
-- is a reserved word in standard SQL and quoting keeps every statement
-- greppable and portable.
--
-- There is deliberately no voter column, no submitter column and no IP column.
-- Reports and votes are anonymous by design -- see the spec's "Anonymity and
-- abuse" section. Adding an identifying column here is a design change, not an
-- implementation detail.
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  "character" TEXT NOT NULL,
  gift        TEXT NOT NULL,
  reaction    TEXT NOT NULL,
  points      INTEGER,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  upvotes     INTEGER NOT NULL DEFAULT 0,
  downvotes   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
```

- [ ] **Step 7: Write `worker/wrangler.toml`**

```toml
name = "fefw-gifts-api"
main = "src/index.js"
compatibility_date = "2026-09-01"

# ALLOWED_ORIGINS is a plain variable, not a secret: it is the list of sites a
# browser may call this Worker from, and it is public by nature. The real
# secrets -- TURNSTILE_SECRET and ADMIN_TOKEN -- are set with
# `npx wrangler secret put` and never appear in this file or in git.
[vars]
ALLOWED_ORIGINS = "https://mackoz.github.io"

[[d1_databases]]
binding = "DB"
database_name = "fefw-gifts"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

- [ ] **Step 8: Run the tests**

Run: `node --test test/worker-http.test.mjs`
Expected: PASS, 9 tests.

Then run the whole suite and the validator:

Run: `npm test && npm run validate`
Expected: PASS, no new warnings.

- [ ] **Step 9: Commit**

```bash
git add worker test/worker-http.test.mjs
git commit -m "Add the Worker foundation: config, schema, CORS and routing"
```

---

### Task 2: Turnstile verification

**Files:**
- Create: `worker/src/turnstile.js`
- Test: `test/worker-turnstile.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `verifyTurnstile(token, secret, fetchImpl) -> Promise<{ ok: boolean, reason: string | null }>`
  where `reason` is one of `'not-configured' | 'missing-token' | 'unreachable' | 'rejected'`.

- [ ] **Step 1: Write the failing test**

Create `test/worker-turnstile.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile } from '../worker/src/turnstile.js';

function fakeFetch(result) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body ?? {}), { status: result.status ?? 200 });
  };
  impl.calls = calls;
  return impl;
}

test('a missing secret is reported rather than treated as a pass', async () => {
  assert.deepEqual(await verifyTurnstile('tok', '', fakeFetch({ body: { success: true } })), { ok: false, reason: 'not-configured' });
});

test('a missing or oversized token never reaches Cloudflare', async () => {
  const impl = fakeFetch({ body: { success: true } });
  assert.deepEqual(await verifyTurnstile(undefined, 's', impl), { ok: false, reason: 'missing-token' });
  assert.deepEqual(await verifyTurnstile('x'.repeat(3000), 's', impl), { ok: false, reason: 'missing-token' });
  assert.equal(impl.calls.length, 0);
});

test('success true passes', async () => {
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch({ body: { success: true } })), { ok: true, reason: null });
});

test('success false is rejected', async () => {
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch({ body: { success: false } })), { ok: false, reason: 'rejected' });
});

test('a network failure or a bad status is unreachable, never a pass', async () => {
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch(new Error('down'))), { ok: false, reason: 'unreachable' });
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch({ status: 502, body: {} })), { ok: false, reason: 'unreachable' });
});

test('the verification request carries no IP address', async () => {
  const impl = fakeFetch({ body: { success: true } });
  await verifyTurnstile('tok', 'secret-value', impl);
  const sent = [...impl.calls[0].init.body].map(([key]) => key);
  assert.deepEqual(sent.sort(), ['response', 'secret']);
  assert.ok(!sent.includes('remoteip'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/worker-turnstile.test.mjs`
Expected: FAIL — `Cannot find module '.../worker/src/turnstile.js'`.

- [ ] **Step 3: Write the implementation**

```js
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Tokens are short-lived and single use. Anything longer than this is not a
// real token, so it is rejected without spending a request on it.
const MAX_TOKEN_LENGTH = 2048;

// `remoteip` is supported by Turnstile and deliberately not sent: the spec
// forbids collecting or transmitting visitor IP addresses, including for
// verification. Do not add it.
export async function verifyTurnstile(token, secret, fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (typeof secret !== 'string' || secret === '') return { ok: false, reason: 'not-configured' };
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'missing-token' };
  }

  let response;
  try {
    response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  // An unreachable or misbehaving verifier is never treated as a pass: the
  // failure mode of a broken check must be "nobody can submit", not "everybody
  // can".
  if (!response.ok) return { ok: false, reason: 'unreachable' };

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  return body?.success === true ? { ok: true, reason: null } : { ok: false, reason: 'rejected' };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/worker-turnstile.test.mjs`
Expected: PASS, 6 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/turnstile.js test/worker-turnstile.test.mjs
git commit -m "Verify Turnstile tokens without sending an IP address"
```

---

### Task 3: The reports store — payload validation and every D1 statement

**Files:**
- Create: `worker/src/reports.js`
- Create: `worker/test-support/fake-d1.mjs`
- Test: `test/worker-reports.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `REACTIONS: string[]`, `MAX_NOTE: 280`, `MAX_POINTS: 999`
  - `validateReport(input) -> { errors: string[], value: { character, gift, reaction, points, note } | null }`
  - `insertReport(db, { id, character, gift, reaction, points, note, createdAt }) -> Promise<void>`
  - `listPending(db, limit?) -> Promise<Array<{ id, character, gift, reaction, points, note, created_at }>>`
  - `listForReview(db, limit?) -> Promise<Array<{ …the above…, upvotes, downvotes }>>`
  - `recordVote(db, id, direction) -> Promise<boolean>` — throws on an unknown direction
  - `setStatus(db, id, status) -> Promise<boolean>`
  - `takeApproved(db, limit?) -> Promise<Array<row>>`
  - `fakeD1(responses) -> { calls, prepare }` from `worker/test-support/fake-d1.mjs`

**Why the fake lives outside `test/`:** Node's test runner treats *every* file
under a directory named `test` as a test file, so a helper placed there is
executed and counted as a passing zero-test file. `worker/test-support/` is not
matched by any default pattern. Verified on Node 26; do not move it.

- [ ] **Step 1: Write the fake D1 first — it is the test's fixture, not production code**

Create `worker/test-support/fake-d1.mjs`:

```js
// A D1-shaped stand-in. It records every statement and returns canned results
// in order; it does not execute SQL. These tests are about which statements the
// store issues and what it does with the rows that come back, not about
// SQLite's behaviour -- that belongs to Cloudflare.
export function fakeD1(responses = []) {
  const queue = [...responses];
  const calls = [];

  const execute = (sql, params) => {
    calls.push({ sql, params });
    return Promise.resolve(queue.shift() ?? { results: [], meta: { changes: 0 } });
  };

  return {
    calls,
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...args) { params = args; return statement; },
        all: () => execute(sql, params),
        run: () => execute(sql, params),
        first: () => execute(sql, params).then((result) => result.results?.[0] ?? null),
      };
      return statement;
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `test/worker-reports.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReport, insertReport, listPending, listForReview,
  recordVote, setStatus, takeApproved, MAX_NOTE,
} from '../worker/src/reports.js';
import { fakeD1 } from '../worker/test-support/fake-d1.mjs';

const GOOD = { character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: 40, note: ' rides an ornius ' };

test('a well-formed report validates and is trimmed', () => {
  const { errors, value } = validateReport(GOOD);
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: 40, note: 'rides an ornius' });
});

test('points and note are optional and normalise to null', () => {
  const { value } = validateReport({ character: 'a', gift: 'b', reaction: 'none' });
  assert.deepEqual(value, { character: 'a', gift: 'b', reaction: 'none', points: null, note: null });
});

test('an empty-string note is null, not an empty string', () => {
  assert.equal(validateReport({ character: 'a', gift: 'b', reaction: 'none', note: '   ' }).value.note, null);
});

test('a long note is truncated rather than rejected', () => {
  const { value } = validateReport({ character: 'a', gift: 'b', reaction: 'none', note: 'x'.repeat(400) });
  assert.equal(value.note.length, MAX_NOTE);
});

test('ids must look like data-file ids', () => {
  for (const bad of ['', 'Has Spaces', 'UPPER', '../etc', 'x'.repeat(70)]) {
    assert.ok(validateReport({ ...GOOD, character: bad }).errors.length > 0, `expected ${bad} to be rejected`);
  }
});

test('the reaction must be one of the five in-game tiers', () => {
  assert.ok(validateReport({ ...GOOD, reaction: 'amazing' }).errors.length > 0);
  assert.deepEqual(validateReport({ ...GOOD, reaction: 'favorite' }).errors, []);
});

test('points must be a whole number in range', () => {
  for (const bad of [-1, 1000, 2.5, 'lots']) {
    assert.ok(validateReport({ ...GOOD, points: bad }).errors.length > 0, `expected ${bad} to be rejected`);
  }
});

test('a failed validation returns no value at all', () => {
  assert.equal(validateReport({}).value, null);
});

test('insertReport writes a pending row with zeroed counters', async () => {
  const db = fakeD1();
  await insertReport(db, { id: 'r1', ...validateReport(GOOD).value, createdAt: '2026-09-20T00:00:00.000Z' });
  const [call] = db.calls;
  assert.match(call.sql, /INSERT INTO reports/);
  assert.match(call.sql, /'pending'/);
  assert.deepEqual(call.params, ['r1', 'nydine', 'grooming-kit', 'loved', 40, 'rides an ornius', '2026-09-20T00:00:00.000Z']);
});

// This is the constraint the whole voting design rests on. If it ever fails,
// vote counts have become reachable from a public endpoint.
test('listPending never selects a vote column', async () => {
  const db = fakeD1([{ results: [{ id: 'r1' }] }]);
  const rows = await listPending(db);
  assert.doesNotMatch(db.calls[0].sql, /upvotes|downvotes/);
  assert.deepEqual(rows, [{ id: 'r1' }]);
});

test('listPending survives a driver that returns no results array', async () => {
  assert.deepEqual(await listPending(fakeD1([{}])), []);
});

test('listForReview does select the votes and orders by score', async () => {
  const db = fakeD1([{ results: [] }]);
  await listForReview(db);
  assert.match(db.calls[0].sql, /upvotes/);
  assert.match(db.calls[0].sql, /ORDER BY \(upvotes - downvotes\) DESC/);
});

test('recordVote increments the column the direction names', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  assert.equal(await recordVote(db, 'r1', 'up'), true);
  assert.match(db.calls[0].sql, /upvotes = upvotes \+ 1/);
  assert.deepEqual(db.calls[0].params, ['r1']);
});

test('recordVote refuses a direction it does not know', async () => {
  await assert.rejects(() => recordVote(fakeD1(), 'r1', 'sideways'), /unknown vote direction/);
});

test('a vote on a row that is not pending changes nothing and says so', async () => {
  assert.equal(await recordVote(fakeD1([{ meta: { changes: 0 } }]), 'gone', 'down'), false);
});

test('setStatus only moves rows that are still pending', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  assert.equal(await setStatus(db, 'r1', 'approved'), true);
  assert.match(db.calls[0].sql, /status = 'pending'/);
  assert.deepEqual(db.calls[0].params, ['approved', 'r1']);
});

test('takeApproved returns the rows and marks every one of them ingested', async () => {
  const db = fakeD1([{ results: [{ id: 'a' }, { id: 'b' }] }, { meta: { changes: 2 } }]);
  const rows = await takeApproved(db);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[1].sql, /SET status = 'ingested'/);
  assert.deepEqual(db.calls[1].params, ['a', 'b']);
});

test('takeApproved issues no update when there is nothing to take', async () => {
  const db = fakeD1([{ results: [] }]);
  assert.deepEqual(await takeApproved(db), []);
  assert.equal(db.calls.length, 1);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/worker-reports.test.mjs`
Expected: FAIL — `Cannot find module '.../worker/src/reports.js'`.

- [ ] **Step 4: Write the implementation**

Create `worker/src/reports.js`:

```js
export const REACTIONS = ['none', 'slight', 'liked', 'loved', 'favorite'];
export const MAX_NOTE = 280;
export const MAX_POINTS = 999;

// The same shape the data files use. The Worker holds no copy of the dataset,
// so it cannot check that an id exists -- only that it could. An id that names
// nothing simply never matches a pair in the overlay, and `npm run validate`
// rejects it for good when the sync job tries to commit it.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateReport(input) {
  const errors = [];
  const character = typeof input?.character === 'string' ? input.character.trim() : '';
  const gift = typeof input?.gift === 'string' ? input.gift.trim() : '';
  const reaction = typeof input?.reaction === 'string' ? input.reaction.trim() : '';

  if (!ID_PATTERN.test(character)) errors.push('character must be a gift-guide id');
  if (!ID_PATTERN.test(gift)) errors.push('gift must be a gift-guide id');
  if (!REACTIONS.includes(reaction)) errors.push(`reaction must be one of: ${REACTIONS.join(', ')}`);

  let points = null;
  const rawPoints = input?.points;
  if (rawPoints !== null && rawPoints !== undefined && rawPoints !== '') {
    const parsed = typeof rawPoints === 'number' ? rawPoints : Number(rawPoints);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_POINTS) {
      errors.push(`points must be a whole number between 0 and ${MAX_POINTS}`);
    } else {
      points = parsed;
    }
  }

  // A note is truncated rather than rejected: losing the tail of a long note is
  // a far better outcome than losing the report it came with.
  let note = null;
  if (typeof input?.note === 'string' && input.note.trim() !== '') {
    note = input.note.trim().slice(0, MAX_NOTE);
  }

  return { errors, value: errors.length ? null : { character, gift, reaction, points, note } };
}

export async function insertReport(db, { id, character, gift, reaction, points, note, createdAt }) {
  await db.prepare(
    `INSERT INTO reports (id, "character", gift, reaction, points, note, status, upvotes, downvotes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?)`,
  ).bind(id, character, gift, reaction, points, note, createdAt).run();
}

// The public overlay shape. The vote columns are not merely omitted from the
// response -- they are never selected. That is what makes "votes never reach
// the published site" true at the API boundary rather than a habit the UI is
// trusted to keep.
export async function listPending(db, limit = 500) {
  const { results } = await db.prepare(
    `SELECT id, "character" AS character, gift, reaction, points, note, created_at
       FROM reports
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?`,
  ).bind(limit).all();
  return results ?? [];
}

// The maintainer's view, and the only place a tally is ever produced.
export async function listForReview(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, "character" AS character, gift, reaction, points, note,
            upvotes, downvotes, created_at
       FROM reports
      WHERE status = 'pending'
      ORDER BY (upvotes - downvotes) DESC, created_at ASC
      LIMIT ?`,
  ).bind(limit).all();
  return results ?? [];
}

export async function recordVote(db, id, direction) {
  // The column name is interpolated, so the allowlist above it is load-bearing:
  // `direction` can only ever be one of two literals by the time it is used.
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`unknown vote direction: ${direction}`);
  }
  const column = direction === 'up' ? 'upvotes' : 'downvotes';
  const { meta } = await db.prepare(
    `UPDATE reports SET ${column} = ${column} + 1 WHERE id = ? AND status = 'pending'`,
  ).bind(id).run();
  return (meta?.changes ?? 0) > 0;
}

// `AND status = 'pending'` makes approve and reject idempotent: a second click,
// or a second maintainer, changes nothing and reports false.
export async function setStatus(db, id, status) {
  const { meta } = await db.prepare(
    `UPDATE reports SET status = ? WHERE id = ? AND status = 'pending'`,
  ).bind(status, id).run();
  return (meta?.changes ?? 0) > 0;
}

// Hands the approved rows to the sync job and marks them ingested in the same
// call, as the spec specifies. The trade: if the resulting pull request is
// closed without merging, those rows are not offered again and must be
// re-entered by hand. `worker/README.md` records that.
export async function takeApproved(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, "character" AS character, gift, reaction, points, note, created_at
       FROM reports
      WHERE status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(limit).all();

  const rows = results ?? [];
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(', ');
  await db.prepare(
    `UPDATE reports SET status = 'ingested' WHERE id IN (${placeholders})`,
  ).bind(...rows.map((row) => row.id)).run();

  return rows;
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/worker-reports.test.mjs`
Expected: PASS, 18 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/reports.js worker/test-support test/worker-reports.test.mjs
git commit -m "Add the report store, with vote counts unreachable from the public query"
```

---

### Task 4: Public endpoints — `POST /report`, `POST /vote`, `GET /pending`

**Files:**
- Modify: `worker/src/router.js` (add handlers and push three entries into `ROUTES`)
- Test: `test/worker-public.test.mjs`

**Interfaces:**
- Consumes: `exact`, `ROUTES`, `handle`, `json`, `corsHeaders` (Task 1);
  `verifyTurnstile` (Task 2); `validateReport`, `insertReport`, `listPending`,
  `recordVote` (Task 3).
- Produces: three live routes. `POST /report` responds `201 { id, status: 'pending' }`.
  `POST /vote` responds `200 { recorded: true }`. `GET /pending` responds
  `200 { pending: [...] }`. Task 7's client depends on exactly these shapes.

- [ ] **Step 1: Write the failing test**

Create `test/worker-public.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/src/router.js';
import { fakeD1 } from '../worker/test-support/fake-d1.mjs';

const ORIGIN = 'https://mackoz.github.io';

function env(db, extra = {}) {
  return { ALLOWED_ORIGINS: ORIGIN, TURNSTILE_SECRET: 'secret', DB: db, ...extra };
}

function deps({ verified = true } = {}) {
  return {
    fetch: async () => new Response(JSON.stringify({ success: verified }), { status: 200 }),
    now: () => '2026-09-20T12:00:00.000Z',
    uuid: () => 'fixed-uuid',
  };
}

const post = (path, body) => new Request(`https://api.test${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify(body),
});

const REPORT = { character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: 40, turnstileToken: 'tok' };

test('a verified report is stored as pending and its id comes back', async () => {
  const db = fakeD1();
  const res = await handle(post('/report', REPORT), env(db), deps());
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: 'fixed-uuid', status: 'pending' });
  assert.match(db.calls[0].sql, /INSERT INTO reports/);
});

test('a failed Turnstile check stores nothing', async () => {
  const db = fakeD1();
  const res = await handle(post('/report', REPORT), env(db), deps({ verified: false }));
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0);
});

test('Turnstile is checked before the payload, so an invalid body cannot probe the store', async () => {
  const db = fakeD1();
  const res = await handle(post('/report', { turnstileToken: 'tok' }), env(db), deps({ verified: false }));
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0);
});

test('a verified but invalid report is a 400 that says what is wrong', async () => {
  const res = await handle(post('/report', { ...REPORT, reaction: 'amazing' }), env(fakeD1()), deps());
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /reaction must be one of/);
});

test('a body that is not JSON is a 400, not a 500', async () => {
  const request = new Request('https://api.test/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: 'not json',
  });
  assert.equal((await handle(request, env(fakeD1()), deps())).status, 400);
});

test('an oversized body is refused before it is parsed', async () => {
  const request = new Request('https://api.test/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Content-Length': '99999' },
    body: JSON.stringify(REPORT),
  });
  assert.equal((await handle(request, env(fakeD1()), deps())).status, 413);
});

test('a vote increments a counter and returns no tally whatsoever', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  const res = await handle(post('/vote', { id: 'r1', direction: 'up', turnstileToken: 'tok' }), env(db), deps());
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, JSON.stringify({ recorded: true }));
  assert.doesNotMatch(body, /upvote|downvote|score|count/i);
});

test('a vote with an unknown direction is a 400 and touches nothing', async () => {
  const db = fakeD1();
  assert.equal((await handle(post('/vote', { id: 'r1', direction: 'sideways', turnstileToken: 'tok' }), env(db), deps())).status, 400);
  assert.equal(db.calls.length, 0);
});

test('a vote on a report that is no longer pending is a 404', async () => {
  const db = fakeD1([{ meta: { changes: 0 } }]);
  assert.equal((await handle(post('/vote', { id: 'gone', direction: 'down', turnstileToken: 'tok' }), env(db), deps())).status, 404);
});

test('an unverified vote is refused', async () => {
  const db = fakeD1();
  assert.equal((await handle(post('/vote', { id: 'r1', direction: 'up', turnstileToken: 'tok' }), env(db), deps({ verified: false }))).status, 403);
  assert.equal(db.calls.length, 0);
});

test('the public pending feed carries no vote information at all', async () => {
  const rows = [{ id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: 40, note: null, created_at: '2026-09-20T00:00:00.000Z' }];
  const db = fakeD1([{ results: rows }]);
  const request = new Request('https://api.test/pending', { headers: { Origin: ORIGIN } });
  const res = await handle(request, env(db), deps());
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.deepEqual(JSON.parse(body), { pending: rows });
  assert.doesNotMatch(body, /upvotes|downvotes/);
  assert.match(res.headers.get('Cache-Control'), /max-age=60/);
});

test('pending requires no Turnstile token', async () => {
  const db = fakeD1([{ results: [] }]);
  const request = new Request('https://api.test/pending', { headers: { Origin: ORIGIN } });
  assert.equal((await handle(request, env(db), deps({ verified: false }))).status, 200);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/worker-public.test.mjs`
Expected: FAIL — every route answers 404, because `ROUTES` is still empty.

- [ ] **Step 3: Add the handlers to `worker/src/router.js`**

Add these imports at the top of the file:

```js
import { verifyTurnstile } from './turnstile.js';
import { validateReport, insertReport, listPending, recordVote } from './reports.js';
```

Add the helpers and handlers below the matchers and above `export const ROUTES`:

```js
// Generous next to a real report and small enough that a parser is never handed
// something interesting.
const MAX_BODY_BYTES = 8192;

async function readJson(request) {
  // The declared length is a cheap first filter, but it is not trusted: a
  // request with no Content-Length (chunked encoding) or a non-numeric one
  // would otherwise skip the check entirely. The byte cap below is the real
  // guard, and it runs before any parsing.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooLarge: true, body: null };

  let buffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return { tooLarge: false, body: null };
  }
  if (buffer.byteLength > MAX_BODY_BYTES) return { tooLarge: true, body: null };

  try {
    return { tooLarge: false, body: JSON.parse(new TextDecoder().decode(buffer)) };
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
```

Then fill the route table:

```js
export const ROUTES = [
  { method: 'POST', match: exact('/report'), handler: postReport },
  { method: 'POST', match: exact('/vote'), handler: postVote },
  { method: 'GET', match: exact('/pending'), handler: getPending },
];
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/worker-public.test.mjs`
Expected: PASS, 12 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/router.js test/worker-public.test.mjs
git commit -m "Add the public report, vote and pending endpoints"
```

---

### Task 5: Admin endpoints and the operator guide

**Files:**
- Modify: `worker/src/router.js` (three more handlers and route entries)
- Create: `worker/README.md`
- Modify: `package.json` (add a `worker:deploy` convenience script)
- Test: `test/worker-admin.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–4, plus `listForReview`, `setStatus` and
  `takeApproved` from Task 3.
- Produces: `GET /review -> { reports: [...] }`, `POST /review/:id -> { id, status }`,
  `POST /ingest -> { reports: [...] }`. All three require
  `Authorization: Bearer <ADMIN_TOKEN>`. Task 10's review page and Task 11's
  sync script depend on exactly these shapes.

- [ ] **Step 1: Write the failing test**

Create `test/worker-admin.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/src/router.js';
import { fakeD1 } from '../worker/test-support/fake-d1.mjs';

const TOKEN = 'a-long-random-admin-token';
const env = (db) => ({ ALLOWED_ORIGINS: 'https://mackoz.github.io', ADMIN_TOKEN: TOKEN, DB: db });
const deps = { fetch: async () => { throw new Error('admin routes must not call out'); }, now: () => '2026-09-20T12:00:00.000Z', uuid: () => 'fixed-uuid' };

const authed = (method, path, body) => new Request(`https://api.test${path}`, {
  method,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('every admin route refuses a missing token', async () => {
  for (const [method, path] of [['GET', '/review'], ['POST', '/review/r1'], ['POST', '/ingest']]) {
    const res = await handle(new Request(`https://api.test${path}`, { method }), env(fakeD1()), deps);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('a wrong token of the same length is refused', async () => {
  const wrong = new Request('https://api.test/review', { headers: { Authorization: `Bearer ${'b'.repeat(TOKEN.length)}` } });
  assert.equal((await handle(wrong, env(fakeD1()), deps)).status, 401);
});

test('an unconfigured Worker refuses rather than letting everyone in', async () => {
  const res = await handle(authed('GET', '/review'), { ALLOWED_ORIGINS: '', DB: fakeD1() }, deps);
  assert.equal(res.status, 503);
});

test('the review queue comes back with its vote counts, uncached', async () => {
  const rows = [{ id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: 40, note: null, upvotes: 3, downvotes: 1, created_at: '2026-09-20T00:00:00.000Z' }];
  const res = await handle(authed('GET', '/review'), env(fakeD1([{ results: rows }])), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reports: rows });
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('approving a report moves it and echoes the new status', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  const res = await handle(authed('POST', '/review/r1', { decision: 'approve' }), env(db), deps);
  assert.deepEqual(await res.json(), { id: 'r1', status: 'approved' });
  assert.deepEqual(db.calls[0].params, ['approved', 'r1']);
});

test('rejecting works the same way', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  await handle(authed('POST', '/review/r1', { decision: 'reject' }), env(db), deps);
  assert.deepEqual(db.calls[0].params, ['rejected', 'r1']);
});

test('an unknown decision is a 400', async () => {
  const db = fakeD1();
  assert.equal((await handle(authed('POST', '/review/r1', { decision: 'maybe' }), env(db), deps)).status, 400);
  assert.equal(db.calls.length, 0);
});

test('deciding twice is reported honestly rather than pretended', async () => {
  const res = await handle(authed('POST', '/review/r1', { decision: 'approve' }), env(fakeD1([{ meta: { changes: 0 } }])), deps);
  assert.equal(res.status, 404);
});

test('ingest hands over the approved rows and marks them, uncached', async () => {
  const db = fakeD1([{ results: [{ id: 'a' }] }, { meta: { changes: 1 } }]);
  const res = await handle(authed('POST', '/ingest'), env(db), deps);
  assert.deepEqual(await res.json(), { reports: [{ id: 'a' }] });
  assert.match(db.calls[1].sql, /SET status = 'ingested'/);
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('the admin routes never contact Turnstile', async () => {
  // `deps.fetch` throws. A 200 proves nothing reached out, and the router's
  // catch-all would have turned a call into a 500.
  assert.equal((await handle(authed('GET', '/review'), env(fakeD1([{ results: [] }])), deps)).status, 200);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/worker-admin.test.mjs`
Expected: FAIL — the admin paths are not in `ROUTES`, so every case gets a 404.

- [ ] **Step 3: Add the admin handlers to `worker/src/router.js`**

Extend the `./reports.js` import with `listForReview, setStatus, takeApproved`,
then add above `export const ROUTES`:

```js
// Workers expose no timingSafeEqual, so compare every byte and accumulate --
// the loop must not return early. The length check in front of it does leak the
// token's length, which is an acceptable trade for a single random secret.
function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  if (presented.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < presented.length; i += 1) {
    difference |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

// Returns a Response when the caller must be turned away, and null when it may
// proceed. A Worker with no ADMIN_TOKEN configured refuses everyone rather than
// admitting everyone -- an unset secret must never read as an open door.
function refuseUnlessAdmin(request, env) {
  const cors = corsHeaders(request, env);
  if (typeof env.ADMIN_TOKEN !== 'string' || env.ADMIN_TOKEN === '') {
    return json({ error: 'review is not configured' }, 503, cors);
  }
  const header = request.headers.get('Authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokenMatches(presented, env.ADMIN_TOKEN)) {
    return json({ error: 'unauthorised' }, 401, cors);
  }
  return null;
}

const ADMIN_HEADERS = { 'Cache-Control': 'no-store' };

async function getReview(request, env) {
  const refusal = refuseUnlessAdmin(request, env);
  if (refusal) return refusal;
  const reports = await listForReview(env.DB);
  return json({ reports }, 200, { ...corsHeaders(request, env), ...ADMIN_HEADERS });
}

const DECISIONS = { approve: 'approved', reject: 'rejected' };

async function postDecision(request, env, deps, params) {
  const refusal = refuseUnlessAdmin(request, env);
  if (refusal) return refusal;

  const cors = { ...corsHeaders(request, env), ...ADMIN_HEADERS };
  const { tooLarge, body } = await readJson(request);
  if (tooLarge) return json({ error: 'that request is too large' }, 413, cors);

  const status = DECISIONS[body?.decision];
  if (!status) return json({ error: 'decision must be "approve" or "reject"' }, 400, cors);

  const changed = await setStatus(env.DB, params.id, status);
  if (!changed) return json({ error: 'no pending report with that id' }, 404, cors);
  return json({ id: params.id, status }, 200, cors);
}

async function postIngest(request, env) {
  const refusal = refuseUnlessAdmin(request, env);
  if (refusal) return refusal;
  const reports = await takeApproved(env.DB);
  return json({ reports }, 200, { ...corsHeaders(request, env), ...ADMIN_HEADERS });
}
```

Then extend the route table:

```js
export const ROUTES = [
  { method: 'POST', match: exact('/report'), handler: postReport },
  { method: 'POST', match: exact('/vote'), handler: postVote },
  { method: 'GET', match: exact('/pending'), handler: getPending },
  { method: 'GET', match: exact('/review'), handler: getReview },
  { method: 'POST', match: oneParam('/review', 'id'), handler: postDecision },
  { method: 'POST', match: exact('/ingest'), handler: postIngest },
];
```

- [ ] **Step 4: Add the deploy convenience script to `package.json`**

Add to `"scripts"`, keeping the file free of `dependencies` and
`devDependencies`:

```json
    "worker:deploy": "npx --yes wrangler deploy --config worker/wrangler.toml"
```

`npx --yes` fetches Wrangler for the one command and installs nothing into this
repository, which keeps the zero-dependency rule intact.

- [ ] **Step 5: Write `worker/README.md`**

````markdown
# The submissions Worker

A Cloudflare Worker and a D1 database holding anonymous gift-result reports
until a maintainer approves them into `data/observations.json`. The published
site works without it; nothing here is required to read the guide.

## What it stores

One table, `reports` (see `schema.sql`). It holds the report content, a status,
two vote counters and a timestamp. It holds **no** name, email, IP address,
hashed IP, session id or any other identifier, and Turnstile is called without
`remoteip`. Adding an identifying column is a design change, not a fix.

## Endpoints

| Route | Access | Purpose |
|---|---|---|
| `POST /report` | Turnstile | Insert a pending row. |
| `POST /vote` | Turnstile | Increment one counter on a pending row. |
| `GET /pending` | Public | Pending rows for the site overlay, **without vote counts**. |
| `GET /review` | Admin token | Pending rows **with** vote counts, best score first. |
| `POST /review/:id` | Admin token | `{"decision":"approve"}` or `{"decision":"reject"}`. |
| `POST /ingest` | Admin token | Return approved rows and mark them ingested. |

Vote counts are never selected by `GET /pending`. That is enforced in the SQL in
`src/reports.js`, not in the UI, and a test asserts it. Do not add them.

## First-time setup

1. **Create the database**

   ```sh
   npx --yes wrangler d1 create fefw-gifts
   ```

   Copy the printed `database_id` into `wrangler.toml`.

2. **Create the table**

   ```sh
   npx --yes wrangler d1 execute fefw-gifts --remote --file worker/schema.sql --config worker/wrangler.toml
   ```

3. **Create a Turnstile widget** in the Cloudflare dashboard
   (Turnstile → Add widget), with the hostname `mackoz.github.io`. Keep both
   keys: the **site key** is public and goes in `assets/js/config.js`; the
   **secret key** is a Worker secret.

4. **Generate an admin token** — long and random, never reused:

   ```sh
   node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
   ```

5. **Set the secrets** (they are prompted for, never passed as arguments, so
   they stay out of your shell history):

   ```sh
   npx --yes wrangler secret put TURNSTILE_SECRET --config worker/wrangler.toml
   npx --yes wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml
   ```

6. **Deploy**

   ```sh
   npm run worker:deploy
   ```

   Note the `https://….workers.dev` URL it prints.

7. **Point the site at it** — put the Worker URL and the Turnstile site key in
   `assets/js/config.js` and commit. Until you do, the site runs in its
   no-submissions mode and everything else works normally.

8. **Add the GitHub Actions secrets** — in the repository's
   Settings → Secrets and variables → Actions, add `WORKER_URL` and
   `ADMIN_TOKEN` (the same token as step 4). The nightly sync job needs both.

## Reviewing

Open `https://mackoz.github.io/fefw-gifts/review/`, paste the admin token once,
and approve or reject. The page is not linked from the site and carries
`noindex`, but it is not secret: everything on it comes from the admin-gated
endpoints, so without the token it shows nothing.

**Known limitation, accepted deliberately.** The token sits in `localStorage` on
a public origin, so anyone holding it can approve anything. For a single
maintainer that is a reasonable trade. Keep it long and random, only ever use it
over HTTPS, and rotate it if it leaks:

```sh
npx --yes wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml   # set the new value
```

then update the `ADMIN_TOKEN` Actions secret and clear the old token from the
review page. Putting Cloudflare Access in front of `/review` is the upgrade path
if this stops being acceptable.

## The ingest trade-off

`POST /ingest` returns the approved rows **and marks them ingested in the same
call**. If the pull request it produces is closed without merging, those rows
will not be offered again and have to be re-entered by hand. Merge the sync pull
request or, if you close it, re-add the rows yourself.

## Local development

```sh
npx --yes wrangler dev --config worker/wrangler.toml
```

Point `assets/js/config.js` at `http://127.0.0.1:8787` and add that origin to
`ALLOWED_ORIGINS` in `wrangler.toml` while you work. Revert both before
committing.
````

- [ ] **Step 6: Run the tests**

Run: `node --test test/worker-admin.test.mjs`
Expected: PASS, 10 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker package.json test/worker-admin.test.mjs
git commit -m "Add the admin-gated review and ingest endpoints, and the operator guide"
```

---

### Task 6: The `PENDING` confidence state

**Files:**
- Modify: `assets/js/confidence.js`
- Modify: `assets/js/views/shared.js:1` (`STATE_RANK`) and `stateLabel`
- Modify: `assets/js/filters.js:9` (`OBSERVED`)
- Modify: `assets/js/views/matrix.js:27` (`SYMBOL`) and `:42` (the legend)
- Modify: `assets/css/style.css`
- Test: `test/confidence.test.mjs`, `test/filters.test.mjs`, `test/views.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `deriveConfidence({ character, gift, observations, pending })` — `pending`
    defaults to `[]`; the result gains a `pendingCount: number` key.
  - `REACTIONS` exported from `assets/js/confidence.js`.
  - The state string `'PENDING'` is now valid everywhere a state appears.

This task changes only the core and its presentation. Nothing fetches a pending
row yet — Task 7 does the wiring.

- [ ] **Step 1: Write the failing tests**

In `test/confidence.test.mjs`, **extend the existing import line** — a second
`import { deriveConfidence }` in the same file is a duplicate declaration and a
SyntaxError:

```js
import { deriveConfidence, REACTIONS, POSITIVE_REACTIONS } from '../assets/js/confidence.js';
```

Then append:

```js
const CHAR = { id: 'c1', name: 'C', giftable: true, categories: { books: { state: 'guide', source: 's1' } }, rarityPreference: null };
const BOOK = { id: 'book', name: 'Book', category: 'books', rarity: 'common' };
const ROCK = { id: 'rock', name: 'Rock', category: null, rarity: null };
const PENDING_ROW = { id: 'r1', character: 'c1', gift: 'book', reaction: 'loved', points: 40 };

test('a pending report outranks a prediction without becoming a confirmation', () => {
  const c = deriveConfidence({ character: CHAR, gift: BOOK, observations: [], pending: [PENDING_ROW] });
  assert.equal(c.state, 'PENDING');
  assert.equal(c.pendingCount, 1);
  // The four things a pending report must never do.
  assert.equal(c.points, null);
  assert.equal(c.reaction, null);
  assert.equal(c.isException, false);
  assert.equal(c.observationCount, 0);
});

test('a pending report on a pair with no category link is still PENDING', () => {
  const c = deriveConfidence({ character: CHAR, gift: ROCK, observations: [], pending: [{ ...PENDING_ROW, gift: 'rock' }] });
  assert.equal(c.state, 'PENDING');
  assert.equal(c.predicted, null);
});

test('a pending report never downgrades a merged observation', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', points: 20 }];
  const c = deriveConfidence({ character: CHAR, gift: BOOK, observations, pending: [PENDING_ROW] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.points, 20);
  assert.equal(c.pendingCount, 1);
});

test('a pending report claiming a favourite does not make it one', () => {
  const c = deriveConfidence({ character: CHAR, gift: BOOK, observations: [], pending: [{ ...PENDING_ROW, reaction: 'favorite' }] });
  assert.equal(c.state, 'PENDING');
});

test('pending defaults to empty, so every existing caller is unaffected', () => {
  assert.equal(deriveConfidence({ character: CHAR, gift: BOOK, observations: [] }).pendingCount, 0);
});

test('the reaction vocabulary has one definition', () => {
  assert.deepEqual(REACTIONS, ['none', 'slight', 'liked', 'loved', 'favorite']);
  assert.deepEqual(POSITIVE_REACTIONS, REACTIONS.filter((r) => r !== 'none'));
});
```

Append to `test/filters.test.mjs`:

```js
test('hiding unconfirmed predictions keeps pending player reports', () => {
  assert.equal(passesFilters({ state: 'PENDING' }, { ...DEFAULT_FILTERS, hideUnconfirmed: true }), true);
  assert.equal(passesFilters({ state: 'PREDICTED' }, { ...DEFAULT_FILTERS, hideUnconfirmed: true }), false);
});

test('hiding untested pairs does not hide a pending one', () => {
  assert.equal(passesFilters({ state: 'PENDING' }, { ...DEFAULT_FILTERS, hideUntested: true }), true);
});
```

Append to `test/views.test.mjs`:

```js
import { SYMBOL } from '../assets/js/views/matrix.js';

test('pending sorts below contested and above predicted', () => {
  const rows = ['PREDICTED', 'UNTESTED', 'PENDING', 'CONTESTED', 'CONFIRMED', 'FAVORITE']
    .map((state) => ({ confidence: { state } }));
  assert.deepEqual(
    sortByConfidence(rows).map((r) => r.confidence.state),
    ['FAVORITE', 'CONFIRMED', 'CONTESTED', 'PENDING', 'PREDICTED', 'UNTESTED'],
  );
});

test('a pending pair is labelled as awaiting review, never as confirmed', () => {
  const label = stateLabel({ state: 'PENDING' });
  assert.match(label, /awaiting review/i);
  assert.doesNotMatch(label, /confirmed|dislike/i);
});

test('the matrix has a symbol for pending that no other state uses', () => {
  assert.ok(SYMBOL.PENDING);
  const used = Object.values(SYMBOL).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/confidence.test.mjs test/filters.test.mjs test/views.test.mjs`
Expected: FAIL — `REACTIONS` and `SYMBOL` are not exported, `pendingCount` is
undefined, and `PENDING` sorts as `undefined`.

- [ ] **Step 3: Update `assets/js/confidence.js`**

Add the shared vocabulary at the top, beside the existing exports:

```js
// The five tiers the game itself displays, in increasing order. One definition,
// shared by the confidence core and the report form.
export const REACTIONS = ['none', 'slight', 'liked', 'loved', 'favorite'];
export const POSITIVE_REACTIONS = ['slight', 'liked', 'loved', 'favorite'];
```

Change the signature and the early return:

```js
export function deriveConfidence({ character, gift, observations, pending = [] }) {
```

Add `pendingCount` to the result object, after `observationCount`:

```js
    observationCount: observations.length,
    pendingCount: pending.length,
```

Replace the no-observations branch with:

```js
  if (observations.length === 0) {
    // A pending report is a real player's result, so it outranks a guide's
    // guess -- but it is not a confirmation. `reaction` and `points` stay null
    // deliberately: an unreviewed report contributes neither. Only an approved
    // observation merged into the repository may do that.
    if (pending.length > 0) {
      result.state = 'PENDING';
      return result;
    }
    // A prediction exists only when a category link does. Absence of a link is
    // never a negative -- see the spec's "Pair confidence" section.
    if (link) result.state = 'PREDICTED';
    return result;
  }
```

Leave the rest of the function alone: when observations exist they decide the
state, and a pending report neither raises nor lowers it.

- [ ] **Step 4: Update `assets/js/views/shared.js`**

```js
// PENDING sits between the observed states and the guesses: a real player
// reported it, but nobody has reviewed it yet.
const STATE_RANK = { FAVORITE: 0, CONFIRMED: 1, CONTESTED: 2, PENDING: 3, PREDICTED: 4, UNTESTED: 5 };
```

Add a case to `stateLabel`, above `case 'PREDICTED'`:

```js
    case 'PENDING': return 'Reported — awaiting review';
```

- [ ] **Step 5: Update `assets/js/filters.js`**

```js
// What survives "hide unconfirmed predictions". PENDING is in the list because
// it is a player's own report rather than a guide's guess -- which does not make
// it a confirmation, only something other than a prediction.
const OBSERVED = new Set(['CONFIRMED', 'FAVORITE', 'CONTESTED', 'PENDING']);
```

- [ ] **Step 6: Update `assets/js/views/matrix.js`**

Export the symbol table so a test can check it, and add the new state:

```js
export const SYMBOL = { FAVORITE: '★', CONFIRMED: '✔', CONTESTED: '?', PENDING: '•', PREDICTED: '~', UNTESTED: '' };
```

Update the legend line:

```js
  container.append(el('p', 'legend', '★ favourite · ✔ confirmed · ? reports disagree · • reported, awaiting review · ~ predicted, unconfirmed · blank not tested'));
```

- [ ] **Step 7: Update `assets/css/style.css`**

Add to the light `:root` block, after the contested pair:

```css
  --color-pending: #0f6d78;
  --color-pending-bg: #e0f4f6;
```

Add to the dark block, in the same position:

```css
    --color-pending: #63cbd6;
    --color-pending-bg: #0d3035;
```

Add `.state-pending` to the shared pill selector list, then its own rule beside
the other states:

```css
.state-pending {
  color: var(--color-pending);
  background: var(--color-pending-bg);
  border-color: currentColor;
}
.state-pending::before {
  /* Matches the matrix legend's "•". Not "~": that is a guide's guess, and this
     is a player's unreviewed result. */
  content: "\2022";
  font-weight: 700;
}
```

Add the matrix tint beside the others:

```css
.matrix td.cell-pending   { background: var(--color-pending-bg);   color: var(--color-pending); }
```

- [ ] **Step 8: Run the tests**

Run: `node --test test/confidence.test.mjs test/filters.test.mjs test/views.test.mjs`
Expected: PASS.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add assets/js/confidence.js assets/js/filters.js assets/js/views/shared.js assets/js/views/matrix.js assets/css/style.css test
git commit -m "Add the PENDING confidence state, ranked below confirmed and above predicted"
```

---

### Task 7: The API client and the pending overlay

**Files:**
- Create: `assets/js/config.js`
- Create: `assets/js/api.js`
- Create: `assets/js/overlay.js`
- Modify: `assets/js/data.js`
- Modify: `assets/js/app.js`
- Test: `test/api.test.mjs`

**Interfaces:**
- Consumes: the Worker shapes from Tasks 4 and 5 — `{ pending: [...] }`,
  `{ id, status }`, `{ recorded: true }`, `{ reports: [...] }`.
- Produces:
  - `WORKER_URL: string | null`, `TURNSTILE_SITE_KEY: string | null`
  - `buildPendingIndex(rows) -> { pendingFor(characterId, giftId): row[], all: row[] }`
  - `createApi({ baseUrl, token, fetchImpl, timeoutMs }) -> { enabled, fetchPending, submitReport, sendVote, fetchReview, decide }`
    where `submitReport`, `sendVote`, `fetchReview` and `decide` each resolve to
    `{ ok, status, data, error }` and never reject.
  - `buildIndex(dataset, pending = [])` — `index.pendingFor` is now available,
    and `index.confidenceFor` accounts for pending rows.

- [ ] **Step 1: Write the failing test**

Create `test/api.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../assets/js/api.js';
import { buildPendingIndex } from '../assets/js/overlay.js';
import { WORKER_URL } from '../assets/js/config.js';

const ROW = { id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: 40, note: null, created_at: '2026-09-20T00:00:00.000Z' };

function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  impl.calls = calls;
  return impl;
}

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('the committed config ships with submissions switched off', () => {
  assert.equal(WORKER_URL, null);
});

test('a client with no base URL is disabled and still answers every call', async () => {
  const api = createApi({ baseUrl: null });
  assert.equal(api.enabled, false);
  assert.deepEqual(await api.fetchPending(), []);
  const result = await api.submitReport({});
  assert.equal(result.ok, false);
  assert.match(result.error, /not set up/i);
});

test('a trailing slash on the base URL does not double up', async () => {
  const fetchImpl = stubFetch(() => ok({ pending: [] }));
  await createApi({ baseUrl: 'https://api.test/', fetchImpl }).fetchPending();
  assert.equal(fetchImpl.calls[0].url, 'https://api.test/pending');
});

test('fetchPending returns the rows', async () => {
  const api = createApi({ baseUrl: 'https://api.test', fetchImpl: stubFetch(() => ok({ pending: [ROW] })) });
  assert.deepEqual(await api.fetchPending(), [ROW]);
});

test('fetchPending swallows every failure, because the overlay is optional', async () => {
  const cases = [
    () => { throw new Error('offline'); },
    () => new Response('not json', { status: 200 }),
    () => new Response('{}', { status: 500 }),
    () => ok({ pending: 'nope' }),
    () => ok({}),
  ];
  for (const handler of cases) {
    const api = createApi({ baseUrl: 'https://api.test', fetchImpl: stubFetch(handler) });
    assert.deepEqual(await api.fetchPending(), [], handler.toString());
  }
});

test('submitReport posts JSON and passes the id back', async () => {
  const fetchImpl = stubFetch(() => new Response(JSON.stringify({ id: 'r1', status: 'pending' }), { status: 201 }));
  const api = createApi({ baseUrl: 'https://api.test', fetchImpl });
  const result = await api.submitReport({ character: 'a', gift: 'b', reaction: 'liked', turnstileToken: 't' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'r1', status: 'pending' });
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.test/report');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body).character, 'a');
});

test('the server error message is what the contributor is shown', async () => {
  const fetchImpl = stubFetch(() => new Response(JSON.stringify({ error: 'reaction must be one of: none, slight' }), { status: 400 }));
  const result = await createApi({ baseUrl: 'https://api.test', fetchImpl }).submitReport({});
  assert.equal(result.ok, false);
  assert.match(result.error, /reaction must be one of/);
});

test('a network failure reads as a service problem, not as the user being wrong', async () => {
  const fetchImpl = stubFetch(() => { throw new Error('offline'); });
  const result = await createApi({ baseUrl: 'https://api.test', fetchImpl }).sendVote({ id: 'r1', direction: 'up' });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not reach/i);
});

test('only the admin calls carry the token', async () => {
  const fetchImpl = stubFetch(() => ok({ reports: [] }));
  const api = createApi({ baseUrl: 'https://api.test', token: 'sekrit', fetchImpl });
  await api.fetchPending();
  await api.fetchReview();
  await api.decide('r1', 'approve');
  assert.equal(fetchImpl.calls[0].init.headers?.Authorization, undefined);
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, 'Bearer sekrit');
  assert.equal(fetchImpl.calls[2].url, 'https://api.test/review/r1');
  assert.deepEqual(JSON.parse(fetchImpl.calls[2].init.body), { decision: 'approve' });
});

test('the overlay groups rows by pair', () => {
  const overlay = buildPendingIndex([ROW, { ...ROW, id: 'r2' }, { ...ROW, id: 'r3', gift: 'other' }]);
  assert.deepEqual(overlay.pendingFor('nydine', 'grooming-kit').map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(overlay.pendingFor('nydine', 'other').map((r) => r.id), ['r3']);
  assert.deepEqual(overlay.pendingFor('nobody', 'nothing'), []);
  assert.equal(overlay.all.length, 3);
});

test('the overlay ignores anything malformed rather than throwing', () => {
  const overlay = buildPendingIndex([null, {}, { character: 'a' }, { character: 'a', gift: 'b' }, 'nope']);
  assert.equal(overlay.all.length, 1);
  assert.deepEqual(buildPendingIndex(undefined).all, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/api.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/js/api.js'`.

- [ ] **Step 3: Write `assets/js/config.js`**

```js
// Public configuration, committed on purpose. The Worker URL and the Turnstile
// site key are both meant to be readable in the page source; the secrets that
// matter (TURNSTILE_SECRET, ADMIN_TOKEN) live in Cloudflare and never appear
// here.
//
// Null means "submissions are not set up". The site then renders the committed
// data exactly as it did before this feature existed, which is the graceful
// degradation the spec requires -- so this file is safe to leave as it is until
// the Worker is actually deployed. See worker/README.md.
export const WORKER_URL = null;
export const TURNSTILE_SITE_KEY = null;
```

- [ ] **Step 4: Write `assets/js/overlay.js`**

```js
// Groups the Worker's pending rows by (character, gift) so the confidence core
// can ask about one pair at a time. Pure, and defensive: these rows come off
// the network, and a malformed one must cost its own row and nothing else.
export function buildPendingIndex(rows) {
  const byPair = new Map();
  const all = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.character !== 'string' || typeof row.gift !== 'string') continue;
    if (!row.character || !row.gift) continue;

    const key = `${row.character}\u0000${row.gift}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(row);
    all.push(row);
  }

  return {
    all,
    pendingFor: (characterId, giftId) => byPair.get(`${characterId}\u0000${giftId}`) ?? [],
  };
}
```

- [ ] **Step 5: Write `assets/js/api.js`**

```js
import { WORKER_URL } from './config.js';

const TIMEOUT_MS = 5000;

// The only module that talks to the Worker. Every method resolves; none reject.
// A contribution service that is down must never stop the guide rendering.
export function createApi({
  baseUrl = WORKER_URL,
  token = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const base = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : '';
  const enabled = base !== '';

  async function call(path, { method = 'GET', body, admin = false } = {}) {
    if (!enabled) {
      return { ok: false, status: 0, data: null, error: 'Submissions are not set up yet.' };
    }

    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (admin && token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, status: 0, data: null, error: 'Could not reach the submission service.' };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        // The Worker's message is written for a player, so show it as-is when
        // there is one.
        error: data?.error ?? `The submission service returned ${response.status}.`,
      };
    }
    return { ok: true, status: response.status, data, error: null };
  }

  return {
    enabled,

    // Returns rows or an empty array. Never throws, never reports a failure:
    // a missing overlay is invisible by design.
    async fetchPending() {
      const { ok, data } = await call('/pending');
      return ok && Array.isArray(data?.pending) ? data.pending : [];
    },

    submitReport: (report) => call('/report', { method: 'POST', body: report }),
    sendVote: (vote) => call('/vote', { method: 'POST', body: vote }),

    // Admin. Used only by the review page; harmless here without a token.
    fetchReview: () => call('/review', { admin: true }),
    decide: (id, decision) => call(`/review/${encodeURIComponent(id)}`, {
      method: 'POST', body: { decision }, admin: true,
    }),
  };
}
```

- [ ] **Step 6: Update `assets/js/data.js`**

Import the overlay and thread it through:

```js
import { deriveConfidence } from './confidence.js';
import { buildPendingIndex } from './overlay.js';
```

```js
// `pending` is the Worker overlay and defaults to empty, so the index builds
// identically when the Worker is unavailable or not yet configured.
export function buildIndex(dataset, pending = []) {
```

Inside, after the observation map is built:

```js
  const overlay = buildPendingIndex(pending);
```

Add `pendingFor` to the index literal, beside `observationsFor`:

```js
    pendingFor: overlay.pendingFor,
```

And pass it into the confidence call:

```js
  index.confidenceFor = (characterId, giftId) => deriveConfidence({
    character: index.byCharacterId.get(characterId),
    gift: index.byGiftId.get(giftId),
    observations: index.observationsFor(characterId, giftId),
    pending: overlay.pendingFor(characterId, giftId),
  });
```

- [ ] **Step 7: Update `assets/js/app.js`**

```js
import { fetchDataset, buildIndex } from './data.js';
import { parseRoute, DEFAULT_FILTERS } from './filters.js';
import { createApi } from './api.js';
import * as characterView from './views/character.js';
import * as giftView from './views/gift.js';
import * as matrixView from './views/matrix.js';
import * as favoritesView from './views/favorites.js';

const VIEW_MODULES = {
  character: characterView,
  gift: giftView,
  matrix: matrixView,
  favorites: favoritesView,
};

const api = createApi();

const state = {
  filters: { ...DEFAULT_FILTERS },
  search: '',
  index: null,
  dataset: null,
  api,
  submissionsEnabled: api.enabled,
};

function render() { /* unchanged */ }

// Re-reads the overlay and rebuilds the index. Called after a report lands so
// the contributor sees their own submission appear straight away.
async function refreshPending() {
  state.index = buildIndex(state.dataset, await api.fetchPending());
  render();
}

async function main() {
  const container = document.getElementById('view');
  try {
    state.dataset = await fetchDataset();
  } catch (err) {
    container.textContent = `Could not load the gift data: ${err.message}`;
    return;
  }

  // The overlay is fetched separately and never awaited before the first paint
  // matters: committed data renders whether or not the Worker answers.
  state.index = buildIndex(state.dataset, []);

  addEventListener('hashchange', render);
  /* …the existing search and filter listeners, unchanged… */
  render();

  if (api.enabled) {
    api.fetchPending().then((pending) => {
      if (pending.length === 0) return;
      state.index = buildIndex(state.dataset, pending);
      render();
    });
  }
}

main();
```

Keep `render` and the listener block exactly as they are today; only the
surrounding wiring changes.

- [ ] **Step 8: Prove the overlay reaches the views**

Append to `test/views.test.mjs`, extending its existing import line with
`favoritesModel` from `'../assets/js/views/favorites.js'`:

```js
const OVERLAY_DATASET = {
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [{ id: 'book', name: 'Book', category: 'books', rarity: 'common', description: '', sources: [] }],
  characters: [{ id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null }],
  observations: [],
  sources: [],
};

test('a pending report reaches confidenceFor through the index', () => {
  const idx = buildIndex(OVERLAY_DATASET, [{ id: 'r1', character: 'c1', gift: 'book', reaction: 'loved', points: 40 }]);
  assert.equal(idx.confidenceFor('c1', 'book').state, 'PENDING');
  assert.deepEqual(idx.pendingFor('c1', 'book').map((r) => r.id), ['r1']);
  assert.deepEqual(idx.pendingFor('c1', 'nothing'), []);
});

test('an index built without an overlay behaves exactly as before', () => {
  const idx = buildIndex(OVERLAY_DATASET);
  assert.equal(idx.confidenceFor('c1', 'book').state, 'UNTESTED');
  assert.deepEqual(idx.pendingFor('c1', 'book'), []);
});

test('a pending favourite report does not close a favourites-hunt slot', () => {
  const idx = buildIndex(OVERLAY_DATASET, [{ id: 'r1', character: 'c1', gift: 'book', reaction: 'favorite', points: 80 }]);
  const { found, unknown } = favoritesModel(idx, DEFAULT_FILTERS);
  assert.equal(found.length, 0);
  assert.equal(unknown.length, 1);
});
```

- [ ] **Step 9: Run the tests**

Run: `node --test test/api.test.mjs test/views.test.mjs`
Expected: PASS — 11 in `api.test.mjs`, and the three new cases above.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 10: Check it in a browser**

Run: `python3 -m http.server 8000` and open `http://localhost:8000/`.
Expected: every view renders exactly as before, and the console is clean.
`WORKER_URL` is null, so no request is made to the Worker.

- [ ] **Step 11: Commit**

```bash
git add assets/js/config.js assets/js/api.js assets/js/overlay.js assets/js/data.js assets/js/app.js test
git commit -m "Fetch pending reports and overlay them on the committed data"
```

---

### Task 8: The report form

**Files:**
- Create: `assets/js/turnstile.js`
- Create: `assets/js/report-form.js`
- Modify: `index.html`
- Modify: `assets/js/views/shared.js` (add `reportButton`)
- Modify: `assets/js/views/character.js`, `assets/js/views/gift.js`
- Modify: `assets/js/app.js` (open the dialog, refresh after a submission)
- Modify: `assets/css/style.css`
- Test: `test/report-form.test.mjs`

**Interfaces:**
- Consumes: `createApi` (Task 7), `REACTIONS` (Task 6), `TURNSTILE_SITE_KEY` (Task 7).
- Produces:
  - `createTurnstile({ siteKey, container, loadScript, getGlobal }) -> { configured, mount(), token(), reset() }`
  - `REACTION_PROMPTS: Array<{ value, label }>`
  - `buildReportPayload(fields) -> { errors: string[], payload: object | null }`
  - `createReportForm({ elements, index, api, turnstile, onSubmitted }) -> { open(characterId, giftId) }`
  - `reportButton(characterId, giftId) -> HTMLButtonElement` with
    `dataset.character` and `dataset.gift`, from `views/shared.js`.

- [ ] **Step 1: Write the failing test**

Create `test/report-form.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportPayload, REACTION_PROMPTS } from '../assets/js/report-form.js';
import { createTurnstile } from '../assets/js/turnstile.js';
import { REACTIONS } from '../assets/js/confidence.js';

const FIELDS = { character: 'nydine', gift: 'grooming-kit', reaction: 'loved', points: '40', note: ' rides an ornius ', turnstileToken: 'tok' };

test('the form offers exactly the five in-game tiers, in order', () => {
  assert.deepEqual(REACTION_PROMPTS.map((p) => p.value), REACTIONS);
  for (const prompt of REACTION_PROMPTS) assert.ok(prompt.label.length > 0);
});

test('a complete form produces the Worker payload', () => {
  const { errors, payload } = buildReportPayload(FIELDS);
  assert.deepEqual(errors, []);
  assert.deepEqual(payload, {
    character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
    points: 40, note: 'rides an ornius', turnstileToken: 'tok',
  });
});

test('points and note are optional and come through as null', () => {
  const { payload } = buildReportPayload({ ...FIELDS, points: '', note: '' });
  assert.equal(payload.points, null);
  assert.equal(payload.note, null);
});

test('each missing field produces its own plain-language message', () => {
  assert.match(buildReportPayload({ ...FIELDS, character: '' }).errors[0], /character/i);
  assert.match(buildReportPayload({ ...FIELDS, gift: '' }).errors[0], /gift/i);
  assert.match(buildReportPayload({ ...FIELDS, reaction: '' }).errors[0], /game showed/i);
  assert.match(buildReportPayload({ ...FIELDS, turnstileToken: '' }).errors[0], /human/i);
});

test('points outside the game’s range are refused', () => {
  for (const points of ['-1', '1000', '2.5', 'lots']) {
    assert.ok(buildReportPayload({ ...FIELDS, points }).errors.length > 0, points);
  }
});

test('an over-long note is refused rather than silently cut', () => {
  assert.match(buildReportPayload({ ...FIELDS, note: 'x'.repeat(281) }).errors[0], /280/);
});

test('a failed build yields no payload at all', () => {
  assert.equal(buildReportPayload({}).payload, null);
});

// --- Turnstile wrapper ---

function fakeTurnstile() {
  const widget = { options: null, resets: 0 };
  return {
    widget,
    global: {
      render(container, options) { widget.options = options; return 'widget-1'; },
      reset() { widget.resets += 1; },
    },
  };
}

test('an unconfigured site key leaves the wrapper switched off', async () => {
  const turnstile = createTurnstile({ siteKey: null });
  assert.equal(turnstile.configured, false);
  await assert.rejects(() => turnstile.mount(), /not configured/);
});

test('mounting renders once and the callback captures the token', async () => {
  const fake = fakeTurnstile();
  let loads = 0;
  const turnstile = createTurnstile({
    siteKey: 'site', container: {},
    loadScript: async () => { loads += 1; },
    getGlobal: () => fake.global,
  });

  await turnstile.mount();
  await turnstile.mount();
  assert.equal(loads, 1, 'the script is fetched once');
  assert.equal(fake.widget.resets, 1, 'a second mount resets rather than re-rendering');

  assert.equal(turnstile.token(), null);
  fake.widget.options.callback('fresh-token');
  assert.equal(turnstile.token(), 'fresh-token');
});

test('expiry and errors clear the token, so a stale one is never submitted', async () => {
  const fake = fakeTurnstile();
  const turnstile = createTurnstile({ siteKey: 'site', container: {}, loadScript: async () => {}, getGlobal: () => fake.global });
  await turnstile.mount();

  fake.widget.options.callback('t1');
  fake.widget.options['expired-callback']();
  assert.equal(turnstile.token(), null);

  fake.widget.options.callback('t2');
  fake.widget.options['error-callback']();
  assert.equal(turnstile.token(), null);
});

test('reset clears the token so each submission needs a fresh one', async () => {
  const fake = fakeTurnstile();
  const turnstile = createTurnstile({ siteKey: 'site', container: {}, loadScript: async () => {}, getGlobal: () => fake.global });
  await turnstile.mount();
  fake.widget.options.callback('t1');
  turnstile.reset();
  assert.equal(turnstile.token(), null);
});

test('a script that never provides the global is reported, not hung on', async () => {
  const turnstile = createTurnstile({ siteKey: 'site', container: {}, loadScript: async () => {}, getGlobal: () => undefined });
  await assert.rejects(() => turnstile.mount(), /failed to load/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/report-form.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/js/report-form.js'`.

- [ ] **Step 3: Write `assets/js/turnstile.js`**

```js
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function defaultLoadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(script);
  });
}

// Wraps Cloudflare's widget so nothing else in the site touches the global, and
// so the plumbing can be driven by a test without a network or a DOM.
//
// The widget is rendered once and reset between submissions: a Turnstile token
// is single use, so reusing one would be rejected by the Worker.
export function createTurnstile({
  siteKey,
  container,
  loadScript = defaultLoadScript,
  getGlobal = () => globalThis.turnstile,
} = {}) {
  const configured = typeof siteKey === 'string' && siteKey !== '';
  let loading = null;
  let widgetId = null;
  let token = null;

  async function ready() {
    if (!configured) throw new Error('turnstile is not configured');
    if (!loading) loading = loadScript(SCRIPT_URL);
    await loading;
    const global = getGlobal();
    if (!global) throw new Error('turnstile failed to load');
    return global;
  }

  return {
    configured,

    // Safe to call every time the dialog opens.
    async mount() {
      const global = await ready();
      if (widgetId !== null) {
        token = null;
        global.reset(widgetId);
        return;
      }
      widgetId = global.render(container, {
        sitekey: siteKey,
        callback: (value) => { token = value; },
        // A token that has expired or errored must never be submitted: the
        // Worker would reject it and the contributor would see a confusing
        // failure on a form they filled in correctly.
        'expired-callback': () => { token = null; },
        'error-callback': () => { token = null; },
      });
    },

    token: () => token,

    reset() {
      token = null;
      if (widgetId === null) return;
      try {
        getGlobal()?.reset(widgetId);
      } catch {
        // A widget that will not reset is a spent one; the next mount replaces it.
      }
    },
  };
}
```

- [ ] **Step 4: Write `assets/js/report-form.js`**

```js
import { REACTIONS } from './confidence.js';

export const MAX_POINTS = 999;

// The player-facing wording for each tier, in the game's own terms. The values
// are the five tiers from confidence.js; a test keeps the two in step.
export const REACTION_PROMPTS = [
  { value: 'none', label: 'They didn’t like it — no support gained' },
  { value: 'slight', label: 'They kind of liked it — small gain' },
  { value: 'liked', label: 'They liked it — moderate gain' },
  { value: 'loved', label: 'They really liked it — big gain' },
  { value: 'favorite', label: 'They really liked it, with two yellow arrows — double points' },
];

const MAX_NOTE = 280;

// Pure. Mirrors the Worker's own validation so a contributor is told what is
// wrong before a request is spent -- the Worker still re-checks everything,
// because a browser check is a courtesy, not a control.
export function buildReportPayload({ character, gift, reaction, points, note, turnstileToken } = {}) {
  const errors = [];
  if (!character) errors.push('Pick which character received the gift.');
  if (!gift) errors.push('Pick which gift you gave.');
  if (!REACTIONS.includes(reaction)) errors.push('Pick what the game showed you.');

  let parsedPoints = null;
  if (points !== '' && points !== null && points !== undefined) {
    const value = Number(points);
    if (!Number.isInteger(value) || value < 0 || value > MAX_POINTS) {
      errors.push(`Support points must be a whole number from 0 to ${MAX_POINTS}, or left blank.`);
    } else {
      parsedPoints = value;
    }
  }

  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (trimmedNote.length > MAX_NOTE) errors.push(`Keep the note under ${MAX_NOTE} characters.`);

  if (!turnstileToken) errors.push('Complete the “I’m human” check first.');

  if (errors.length) return { errors, payload: null };
  return {
    errors,
    payload: {
      character, gift, reaction,
      points: parsedPoints,
      note: trimmedNote === '' ? null : trimmedNote,
      turnstileToken,
    },
  };
}

function fillSelect(select, items, placeholder) {
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.append(blank);
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
}

function fillReactions(fieldset) {
  for (const prompt of REACTION_PROMPTS) {
    const label = document.createElement('label');
    label.className = 'reaction-choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'reaction';
    input.value = prompt.value;
    label.append(input, document.createTextNode(` ${prompt.label}`));
    fieldset.append(label);
  }
}

// Wires the dialog. `elements` is every node the form needs, passed in rather
// than looked up, so this module keeps no top-level DOM access.
export function createReportForm({ elements, index, api, turnstile, onSubmitted = () => {} }) {
  const { dialog, form, character, gift, reactions, points, note, status, cancel, submit } = elements;

  fillSelect(character, index.characters.filter((c) => c.giftable), 'Choose a character…');
  fillSelect(gift, index.gifts, 'Choose a gift…');
  fillReactions(reactions);

  cancel.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = {
      character: character.value,
      gift: gift.value,
      reaction: reactions.querySelector('input[name="reaction"]:checked')?.value ?? '',
      points: points.value,
      note: note.value,
      turnstileToken: turnstile.token(),
    };

    const { errors, payload } = buildReportPayload(fields);
    if (errors.length) {
      status.textContent = errors[0];
      return;
    }

    submit.disabled = true;
    status.textContent = 'Sending…';
    const result = await api.submitReport(payload);
    submit.disabled = false;

    // A spent token cannot be reused whether the request succeeded or failed,
    // so the widget is reset either way.
    turnstile.reset();

    if (!result.ok) {
      status.textContent = result.error;
      return;
    }

    status.textContent = '';
    dialog.close();
    form.reset();
    onSubmitted();
  });

  return {
    async open(characterId = '', giftId = '') {
      status.textContent = '';
      character.value = characterId;
      gift.value = giftId;
      dialog.showModal();
      try {
        await turnstile.mount();
      } catch {
        status.textContent = 'The “I’m human” check could not load. Try again in a moment.';
      }
    },
  };
}
```

- [ ] **Step 5: Add `reportButton` to `assets/js/views/shared.js`**

```js
// A per-pair report trigger. It carries its ids in dataset attributes and does
// nothing itself: app.js listens once on the container and opens the dialog.
export function reportButton(characterId, giftId) {
  const button = el('button', 'report-button', 'Report');
  button.type = 'button';
  button.dataset.character = characterId;
  button.dataset.gift = giftId;
  button.setAttribute('aria-label', 'Report a result for this pair');
  return button;
}
```

- [ ] **Step 6: Add the button to the character and gift views**

In `assets/js/views/character.js`, import `reportButton`, add `'Report'` to the
header list, and append a final cell to each row:

```js
    const actionCell = el('td');
    if (state.submissionsEnabled) actionCell.append(reportButton(character.id, gift.id));
    row.append(actionCell);
```

Do the same in `assets/js/views/gift.js`, with `reportButton(character.id, gift.id)`.

The matrix keeps no buttons: at 80 rows by 53 columns a control per cell would
double the grid's weight for a control nobody can hit on a phone.

- [ ] **Step 7: Add the dialog to `index.html`**

Replace the `<!-- Plan 2 insertion point -->` comment and the GitHub report link
in the toolbar with:

```html
      <button type="button" id="report-open" class="report-link" hidden>Report a result</button>
      <a class="report-link" id="report-fallback" href="https://github.com/mackoz/fefw-gifts/issues/new/choose">Report a result on GitHub</a>
```

And add, just before the closing `</body>`:

```html
  <dialog id="report-dialog" aria-labelledby="report-title">
    <form id="report-form">
      <h2 id="report-title">Report a result</h2>
      <p class="dialog-intro">
        Report only what the game itself showed you. There is no account and no
        sign-up, and nothing about you is stored — not a name, not an email, not
        an IP address.
      </p>

      <label for="report-character">Character</label>
      <select id="report-character" required></select>

      <label for="report-gift">Gift</label>
      <select id="report-gift" required></select>

      <fieldset id="report-reactions">
        <legend>What did the game show?</legend>
      </fieldset>

      <label for="report-points">Support points gained (optional)</label>
      <input id="report-points" type="number" min="0" max="999" inputmode="numeric">

      <label for="report-note">Anything unusual worth noting? (optional)</label>
      <input id="report-note" type="text" maxlength="280">
      <p class="field-note">Reports are published. Don’t put anything personal in here.</p>

      <div id="report-turnstile"></div>
      <p id="report-status" class="dialog-status" role="status" aria-live="polite"></p>

      <menu class="dialog-actions">
        <button type="button" id="report-cancel">Cancel</button>
        <button type="submit" id="report-submit">Submit</button>
      </menu>
    </form>
  </dialog>
```

Also update the footer sentence, replacing "In-site submission isn’t built yet —
until it is, report a result on GitHub." with:

```html
      Reporting a result takes a few seconds and needs no account.
      Structural corrections still go through
      <a href="https://github.com/mackoz/fefw-gifts/issues/new/choose">GitHub issues</a>.
```

- [ ] **Step 8: Wire it up in `assets/js/app.js`**

```js
import { TURNSTILE_SITE_KEY } from './config.js';
import { createTurnstile } from './turnstile.js';
import { createReportForm } from './report-form.js';
```

At the end of `main()`, after the first `render()`:

```js
  // Both controls ship in the markup and exactly one survives, so the page is
  // never briefly wrong while JavaScript boots.
  const openButton = document.getElementById('report-open');
  const fallback = document.getElementById('report-fallback');
  if (!api.enabled) return;
  openButton.hidden = false;
  fallback.hidden = true;

  const reportForm = createReportForm({
    elements: {
      dialog: document.getElementById('report-dialog'),
      form: document.getElementById('report-form'),
      character: document.getElementById('report-character'),
      gift: document.getElementById('report-gift'),
      reactions: document.getElementById('report-reactions'),
      points: document.getElementById('report-points'),
      note: document.getElementById('report-note'),
      status: document.getElementById('report-status'),
      cancel: document.getElementById('report-cancel'),
      submit: document.getElementById('report-submit'),
    },
    index: state.index,
    api,
    turnstile: createTurnstile({
      siteKey: TURNSTILE_SITE_KEY,
      container: document.getElementById('report-turnstile'),
    }),
    onSubmitted: refreshPending,
  });

  openButton.addEventListener('click', () => reportForm.open());

  // One listener for every per-row button, so a re-render costs nothing.
  container.addEventListener('click', (event) => {
    const button = event.target.closest('.report-button');
    if (button) reportForm.open(button.dataset.character, button.dataset.gift);
  });
```

`createReportForm` reads `index.characters` and `index.gifts`, which are the
same arrays across rebuilds, so the selects survive `refreshPending`.

- [ ] **Step 9: Style the dialog in `assets/css/style.css`**

```css
/* --- Dialogs ---
   The report and vote dialogs. Sized for a phone first: reports get written
   right after playing, on the device that is to hand. */

dialog {
  width: min(32rem, calc(100vw - 32px));
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.5);
}

dialog h2 {
  margin-top: 0;
}

dialog label {
  display: block;
  margin-top: 12px;
  font-weight: 600;
}

dialog select,
dialog input[type="number"],
dialog input[type="text"] {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
}

#report-reactions {
  margin-top: 16px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

.reaction-choice {
  display: block;
  font-weight: 400;
  margin: 6px 0;
}

.field-note {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: var(--color-muted);
}

.dialog-intro {
  color: var(--color-muted);
  font-size: 0.9rem;
}

/* Reserves its line so the dialog does not jump when a message appears. */
.dialog-status {
  min-height: 1.5em;
  margin: 12px 0 0;
  color: var(--color-warning);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 16px 0 0;
  padding: 0;
}

.dialog-actions button,
.report-button {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}

.report-button {
  font-size: 0.85rem;
}
```

- [ ] **Step 10: Run the tests**

Run: `node --test test/report-form.test.mjs`
Expected: PASS, 12 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 11: Check it in a browser**

Run: `python3 -m http.server 8000` and open `http://localhost:8000/`.
Expected: `WORKER_URL` is still null, so the GitHub fallback link shows and no
report buttons appear. Nothing regressed and the console is clean.

Then temporarily set `WORKER_URL = 'http://127.0.0.1:8787'` in
`assets/js/config.js`, reload, and confirm the "Report a result" button appears,
the dialog opens, both selects are populated, all five tiers are listed, and
submitting with nothing filled in shows "Pick which character received the
gift." **Revert `config.js` before committing.**

- [ ] **Step 12: Commit**

```bash
git add assets index.html test/report-form.test.mjs
git commit -m "Add the in-page report form, behind Turnstile"
```

---

### Task 9: Peer voting on pending reports

**Files:**
- Create: `assets/js/votes.js`
- Create: `assets/js/vote-control.js`
- Modify: `index.html` (the vote confirmation dialog)
- Modify: `assets/js/views/character.js`, `assets/js/views/gift.js`
- Modify: `assets/js/app.js`
- Modify: `assets/css/style.css`
- Test: `test/votes.test.mjs`

**Interfaces:**
- Consumes: `index.pendingFor` (Task 7), `api.sendVote` (Task 7), the Turnstile
  wrapper (Task 8).
- Produces:
  - `votedDirection(storage, reportId) -> 'up' | 'down' | null`
  - `recordVote(storage, reportId, direction) -> object`
  - `voteControlModel(report, storage) -> { reportId, voted, direction, prompt }`
  - `voteControl(model) -> HTMLElement` with two `.vote-button` children
    carrying `dataset.report` and `dataset.direction`.

**Design note, binding:** votes are a maintainer triage signal. No tally,
score, count or percentage may appear anywhere on the public site, in any
form, including a title attribute. The control shows a prompt before voting and
an acknowledgement after, and nothing else.

Turnstile is required on every vote, and a widget per row is unworkable. So a
click opens one small confirmation dialog that hosts a single shared widget.

- [ ] **Step 1: Write the failing test**

Create `test/votes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { votedDirection, recordVote, readVotes } from '../assets/js/votes.js';
import { voteControlModel } from '../assets/js/vote-control.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
}

const hostileStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

const REPORT = { id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved' };

test('a browser that has not voted has no recorded direction', () => {
  assert.equal(votedDirection(fakeStorage(), 'r1'), null);
});

test('a vote is remembered and can be read back', () => {
  const storage = fakeStorage();
  recordVote(storage, 'r1', 'up');
  assert.equal(votedDirection(storage, 'r1'), 'up');
  assert.equal(votedDirection(storage, 'r2'), null);
});

test('a second vote on the same report replaces the first', () => {
  const storage = fakeStorage();
  recordVote(storage, 'r1', 'up');
  recordVote(storage, 'r1', 'down');
  assert.equal(votedDirection(storage, 'r1'), 'down');
});

test('storage that throws or holds junk degrades to "not voted"', () => {
  assert.equal(votedDirection(hostileStorage, 'r1'), null);
  assert.doesNotThrow(() => recordVote(hostileStorage, 'r1', 'up'));
  assert.deepEqual(readVotes(fakeStorage({ 'fefw-gifts-votes': 'not json' })), {});
  assert.deepEqual(readVotes(fakeStorage({ 'fefw-gifts-votes': 'null' })), {});
  assert.deepEqual(readVotes(undefined), {});
});

test('the control asks a question before a vote and thanks after', () => {
  const before = voteControlModel(REPORT, fakeStorage());
  assert.equal(before.voted, false);
  assert.match(before.prompt, /\?$/);

  const storage = fakeStorage();
  recordVote(storage, 'r1', 'down');
  const after = voteControlModel(REPORT, storage);
  assert.equal(after.voted, true);
  assert.equal(after.direction, 'down');
  assert.match(after.prompt, /thanks/i);
});

// The constraint the whole voting design rests on. If this fails, a tally has
// leaked onto the public site.
test('no tally reaches the model, even when the row is carrying one', () => {
  const model = voteControlModel({ ...REPORT, upvotes: 42, downvotes: 7 }, fakeStorage());
  assert.equal(JSON.stringify(model).includes('42'), false);
  assert.equal(JSON.stringify(model).includes('upvotes'), false);
  assert.doesNotMatch(model.prompt, /\d/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/votes.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/js/votes.js'`.

- [ ] **Step 3: Write `assets/js/votes.js`**

```js
const KEY = 'fefw-gifts-votes';

// Every access is wrapped. localStorage throws in a private window and when a
// site's data is blocked, and a vote button is not worth breaking a page over.
//
// This is UX hygiene, not security: it stops an accidental double-click and a
// casual repeat, and a private window bypasses it trivially. Turnstile and
// maintainer review are what actually contain abuse -- see the spec's
// "Anonymity and abuse" section.
export function readVotes(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function votedDirection(storage, reportId) {
  return readVotes(storage)[reportId] ?? null;
}

export function recordVote(storage, reportId, direction) {
  const votes = { ...readVotes(storage), [reportId]: direction };
  try {
    storage?.setItem(KEY, JSON.stringify(votes));
  } catch {
    // Nothing to do and nothing to tell the visitor: the vote itself landed on
    // the Worker, and this record is only a convenience.
  }
  return votes;
}
```

- [ ] **Step 4: Write `assets/js/vote-control.js`**

```js
import { el } from './views/shared.js';
import { votedDirection } from './votes.js';

const BEFORE = 'A player reported this. Does it match what you have seen?';
const AFTER = 'Thanks — noted for the maintainer.';

// Pure. Deliberately reads only `report.id` from the row: even if a future
// endpoint change started returning counts, none could reach the page through
// here. No tally, score or count may ever appear in this model.
export function voteControlModel(report, storage) {
  const direction = votedDirection(storage, report.id);
  return {
    reportId: report.id,
    voted: direction !== null,
    direction,
    prompt: direction === null ? BEFORE : AFTER,
  };
}

export function voteControl(model) {
  const wrapper = el('div', 'vote-control');
  wrapper.append(el('span', 'vote-prompt', model.prompt));
  if (model.voted) return wrapper;

  for (const [direction, label] of [['up', 'Matches'], ['down', 'Doesn’t match']]) {
    const button = el('button', 'vote-button', label);
    button.type = 'button';
    button.dataset.report = model.reportId;
    button.dataset.direction = direction;
    wrapper.append(button);
  }
  return wrapper;
}
```

- [ ] **Step 5: Render the control on pending rows**

In `assets/js/views/character.js`, inside the row loop, after the status badge:

```js
    if (confidence.state === 'PENDING' && state.submissionsEnabled) {
      for (const report of index.pendingFor(character.id, gift.id)) {
        statusCell.append(voteControl(voteControlModel(report, state.storage)));
      }
    }
```

Do the same in `assets/js/views/gift.js`, with `index.pendingFor(character.id, gift.id)`.

Import `voteControl` and `voteControlModel` from `../vote-control.js` in both.

The matrix stays symbols only, for the same reason it has no report buttons.

- [ ] **Step 6: Add the vote dialog to `index.html`**

Before `</body>`, beside the report dialog:

```html
  <dialog id="vote-dialog" aria-labelledby="vote-title">
    <form id="vote-form">
      <h2 id="vote-title">Confirm your response</h2>
      <p class="dialog-intro">
        This helps the maintainer decide what to check first. It never changes
        what the site shows, and nothing about you is stored.
      </p>
      <div id="vote-turnstile"></div>
      <p id="vote-status" class="dialog-status" role="status" aria-live="polite"></p>
      <menu class="dialog-actions">
        <button type="button" id="vote-cancel">Cancel</button>
        <button type="submit" id="vote-submit">Send</button>
      </menu>
    </form>
  </dialog>
```

- [ ] **Step 7: Wire the dialog in `assets/js/app.js`**

Add `storage` to the state so views can read it without touching a global:

```js
// Handed to the views rather than read from a global, so the vote control stays
// testable and a blocked localStorage is one try/catch, not a crash.
state.storage = (() => { try { return globalThis.localStorage; } catch { return undefined; } })();
```

Then, in the block that already runs only when `api.enabled`:

```js
  const voteDialog = document.getElementById('vote-dialog');
  const voteStatus = document.getElementById('vote-status');
  const voteSubmit = document.getElementById('vote-submit');
  const voteTurnstile = createTurnstile({
    siteKey: TURNSTILE_SITE_KEY,
    container: document.getElementById('vote-turnstile'),
  });
  let pendingVote = null;

  document.getElementById('vote-cancel').addEventListener('click', () => voteDialog.close());

  document.getElementById('vote-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = voteTurnstile.token();
    if (!token) {
      voteStatus.textContent = 'Complete the “I’m human” check first.';
      return;
    }

    voteSubmit.disabled = true;
    const result = await api.sendVote({ ...pendingVote, turnstileToken: token });
    voteSubmit.disabled = false;
    voteTurnstile.reset();

    if (!result.ok) {
      voteStatus.textContent = result.error;
      return;
    }

    // Recorded locally only after the Worker accepted it, so a failed send can
    // be retried.
    recordVote(state.storage, pendingVote.id, pendingVote.direction);
    voteDialog.close();
    render();
  });

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('.vote-button');
    if (!button) return;
    pendingVote = { id: button.dataset.report, direction: button.dataset.direction };
    voteStatus.textContent = '';
    voteDialog.showModal();
    try {
      await voteTurnstile.mount();
    } catch {
      voteStatus.textContent = 'The “I’m human” check could not load. Try again in a moment.';
    }
  });
```

Import `recordVote` from `./votes.js`. This can share the existing container
click listener from Task 8 or sit beside it; both are fine, since each handler
returns early when its own selector does not match.

- [ ] **Step 8: Style the control in `assets/css/style.css`**

```css
/* --- Peer voting ---
   A prompt and two buttons. There is deliberately no count, score or bar here:
   votes are a private maintainer signal, and a visible tally would read as
   confirmation -- exactly the manufactured confidence this project exists to
   eliminate. Do not add one. */

.vote-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.vote-prompt {
  color: var(--color-muted);
  font-size: 0.8rem;
  max-width: 32ch;
}

.vote-button {
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
```

- [ ] **Step 9: Run the tests**

Run: `node --test test/votes.test.mjs`
Expected: PASS, 6 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add assets index.html test/votes.test.mjs
git commit -m "Let visitors vote on pending reports, as a private maintainer signal"
```

---

### Task 10: The maintainer review page

**Files:**
- Create: `review/index.html`
- Create: `assets/js/review.js`
- Modify: `assets/css/style.css`
- Test: `test/review.test.mjs`

**Interfaces:**
- Consumes: `createApi({ baseUrl, token })` with `fetchReview` and `decide` (Task 7).
- Produces:
  - `TOKEN_KEY = 'fefw-gifts-admin-token'`
  - `humanAge(milliseconds) -> string`
  - `reviewRowModel(row, now) -> { id, pair, reaction, points, note, score, votes, age }`
  - `mountReview({ elements, storage, createClient })` — the page's wiring.

Vote counts **are** shown here. This is the one place they belong: the page is
admin-gated, and ordering the queue is the entire purpose of collecting them.

- [ ] **Step 1: Write the failing test**

Create `test/review.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewRowModel, humanAge, TOKEN_KEY } from '../assets/js/review.js';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const ROW = {
  id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  points: 40, note: 'rides an ornius', upvotes: 5, downvotes: 2,
  created_at: '2026-09-20T09:00:00.000Z',
};

test('a row becomes something a maintainer can scan', () => {
  const model = reviewRowModel(ROW, NOW);
  assert.equal(model.id, 'r1');
  assert.equal(model.pair, 'nydine · grooming-kit');
  assert.equal(model.reaction, 'loved');
  assert.equal(model.points, 40);
  assert.equal(model.note, 'rides an ornius');
  assert.equal(model.score, 3);
  assert.equal(model.votes, '5 up / 2 down');
  assert.equal(model.age, '3 hours ago');
});

test('missing counters, points and notes do not produce NaN or "undefined"', () => {
  const model = reviewRowModel({ id: 'r2', character: 'a', gift: 'b', reaction: 'none', created_at: '2026-09-20T12:00:00.000Z' }, NOW);
  assert.equal(model.score, 0);
  assert.equal(model.votes, '0 up / 0 down');
  assert.equal(model.points, null);
  assert.equal(model.note, null);
});

test('an unparseable timestamp degrades to a readable placeholder', () => {
  assert.equal(reviewRowModel({ ...ROW, created_at: 'whenever' }, NOW).age, 'unknown age');
});

test('ages read in the largest sensible unit', () => {
  assert.equal(humanAge(30 * 1000), 'just now');
  assert.equal(humanAge(60 * 1000), '1 minute ago');
  assert.equal(humanAge(5 * 60 * 1000), '5 minutes ago');
  assert.equal(humanAge(60 * 60 * 1000), '1 hour ago');
  assert.equal(humanAge(26 * 60 * 60 * 1000), '1 day ago');
  assert.equal(humanAge(72 * 60 * 60 * 1000), '3 days ago');
});

test('a clock skew into the future is not rendered as a negative age', () => {
  assert.equal(humanAge(-5000), 'just now');
});

test('the token key is namespaced to this site', () => {
  assert.match(TOKEN_KEY, /^fefw-gifts-/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/review.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/js/review.js'`.

- [ ] **Step 3: Write `assets/js/review.js`**

```js
import { createApi } from './api.js';
import { el } from './views/shared.js';

export const TOKEN_KEY = 'fefw-gifts-admin-token';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function humanAge(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < MINUTE) return 'just now';
  if (milliseconds < HOUR) return plural(Math.floor(milliseconds / MINUTE), 'minute');
  if (milliseconds < DAY) return plural(Math.floor(milliseconds / HOUR), 'hour');
  return plural(Math.floor(milliseconds / DAY), 'day');
}

export function reviewRowModel(row, now = Date.now()) {
  const upvotes = Number(row.upvotes ?? 0);
  const downvotes = Number(row.downvotes ?? 0);
  const created = Date.parse(row.created_at);
  return {
    id: row.id,
    pair: `${row.character} · ${row.gift}`,
    reaction: row.reaction,
    points: row.points ?? null,
    note: row.note ?? null,
    score: upvotes - downvotes,
    votes: `${upvotes} up / ${downvotes} down`,
    age: Number.isNaN(created) ? 'unknown age' : humanAge(now - created),
  };
}

function readToken(storage) {
  try { return storage?.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

function writeToken(storage, token) {
  try {
    if (token) storage?.setItem(TOKEN_KEY, token);
    else storage?.removeItem(TOKEN_KEY);
  } catch { /* the page still works for this session without persisting it */ }
}

function renderRow(model, onDecide) {
  const item = el('li', 'review-row');
  item.append(el('p', 'review-pair', model.pair));
  item.append(el('p', 'review-meta', [
    model.reaction,
    model.points === null ? null : `${model.points} pts`,
    model.votes,
    model.age,
  ].filter(Boolean).join(' · ')));
  if (model.note) item.append(el('p', 'review-note', model.note));

  const actions = el('div', 'review-actions');
  for (const [decision, label] of [['approve', 'Approve'], ['reject', 'Reject']]) {
    const button = el('button', `review-${decision}`, label);
    button.type = 'button';
    button.addEventListener('click', () => onDecide(model.id, decision, button));
    actions.append(button);
  }
  item.append(actions);
  return item;
}

// `createClient` is injected so the page's wiring can be exercised without a
// network; it defaults to the real API client.
export function mountReview({ elements, storage, createClient = createApi, now = () => Date.now() }) {
  const { tokenForm, tokenInput, forget, status, list, refresh } = elements;
  let api = null;

  function setStatus(message) {
    status.textContent = message;
  }

  async function load() {
    const token = readToken(storage);
    if (!token) {
      list.replaceChildren();
      setStatus('Paste your admin token to see the queue.');
      return;
    }

    api = createClient({ token });
    if (!api.enabled) {
      setStatus('This site is not pointed at a Worker yet — see worker/README.md.');
      return;
    }

    setStatus('Loading…');
    const result = await api.fetchReview();
    if (!result.ok) {
      // 401 is by far the likeliest failure, and "wrong token" is more useful
      // than the status code.
      setStatus(result.status === 401 ? 'That token was not accepted.' : result.error);
      return;
    }

    const rows = Array.isArray(result.data?.reports) ? result.data.reports : [];
    list.replaceChildren(...rows.map((row) => renderRow(reviewRowModel(row, now()), decide)));
    setStatus(rows.length === 0 ? 'Nothing waiting.' : `${rows.length} report(s) waiting, best score first.`);
  }

  async function decide(id, decision, button) {
    button.disabled = true;
    const result = await api.decide(id, decision);
    if (!result.ok) {
      button.disabled = false;
      setStatus(result.error);
      return;
    }
    await load();
  }

  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    writeToken(storage, tokenInput.value.trim());
    tokenInput.value = '';
    load();
  });

  forget.addEventListener('click', () => {
    writeToken(storage, '');
    api = null;
    load();
  });

  refresh.addEventListener('click', load);

  load();
}
```

- [ ] **Step 4: Write `review/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Review queue — Fortune's Weave Gift Guide</title>
  <link rel="stylesheet" href="../assets/css/style.css">
</head>
<body>
  <noscript>
    This page needs JavaScript enabled.
  </noscript>

  <header class="site-header">
    <h1>Review queue</h1>
    <p class="tagline">
      Pending reports, best vote score first. Nothing here is public: every row
      comes from an endpoint that requires the admin token, and the vote counts
      shown here never appear on the site itself.
    </p>
    <nav><a href="../">Back to the guide</a></nav>
  </header>

  <main>
    <form id="token-form" class="toolbar">
      <label class="filter-toggle" for="token-input">Admin token</label>
      <input id="token-input" type="password" autocomplete="off" spellcheck="false" placeholder="Paste it once">
      <button type="submit">Use it</button>
      <button type="button" id="token-forget">Forget it</button>
      <button type="button" id="review-refresh">Refresh</button>
      <p class="toggle-note">
        The token is kept in this browser's local storage. Anyone who gets it can
        approve anything — only use it on a device you trust, and rotate it if it
        leaks.
      </p>
    </form>

    <p id="review-status" class="empty-state" role="status" aria-live="polite"></p>
    <ul id="review-list" class="review-list"></ul>
  </main>

  <script type="module">
    import { mountReview, TOKEN_KEY } from '../assets/js/review.js';

    const storage = (() => { try { return globalThis.localStorage; } catch { return undefined; } })();

    mountReview({
      storage,
      elements: {
        tokenForm: document.getElementById('token-form'),
        tokenInput: document.getElementById('token-input'),
        forget: document.getElementById('token-forget'),
        refresh: document.getElementById('review-refresh'),
        status: document.getElementById('review-status'),
        list: document.getElementById('review-list'),
      },
    });
  </script>
</body>
</html>
```

- [ ] **Step 5: Style the queue in `assets/css/style.css`**

```css
/* --- Review queue (maintainer only) ---
   Sized for a phone: reports get read right after a play session. */

.review-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.review-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.review-pair {
  margin: 0;
  font-weight: 600;
}

.review-meta {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: 0.85rem;
}

.review-note {
  margin: 6px 0 0;
  font-style: italic;
}

.review-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.review-actions button {
  flex: 1 1 auto;
  /* A comfortable touch target, because this page is used on a phone. */
  min-height: 44px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: var(--color-bg);
  font: inherit;
  cursor: pointer;
}

.review-approve { color: var(--color-confirmed); }
.review-reject  { color: var(--color-warning); }
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/review.test.mjs`
Expected: PASS, 6 tests.

Run: `npm test && npm run validate`
Expected: PASS.

- [ ] **Step 7: Check it in a browser**

Run: `python3 -m http.server 8000` and open `http://localhost:8000/review/`.
Expected: the heading, the token field, and "This site is not pointed at a
Worker yet" — because `WORKER_URL` is null. No console errors. Narrow the window
to phone width and confirm the toolbar wraps and the buttons stay reachable.

- [ ] **Step 8: Commit**

```bash
git add review assets/js/review.js assets/css/style.css test/review.test.mjs
git commit -m "Add the private review page for approving pending reports"
```

---

### Task 11: The ingest script, the sync workflow, and the docs

**Files:**
- Create: `scripts/ingest.mjs`
- Create: `.github/workflows/sync-reports.yml`
- Modify: `package.json` (add an `ingest` script)
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`
- Test: `test/ingest.test.mjs`

**Interfaces:**
- Consumes: `POST /ingest -> { reports: [...] }` (Task 5); `validate` and
  `loadDataset` from `scripts/validate.mjs`.
- Produces:
  - `toObservation(row) -> { id, gift, character, reaction, points, date }`
  - `mergeObservations(existing, rows) -> { observations, added }`

**The note is deliberately dropped.** `data/observations.json` has no field for
it, and a note is free text from an anonymous contributor that would otherwise
be committed to a public repository unread. The maintainer reads notes on the
review page, and the pull request body repeats them, so anything worth keeping
can be added by hand.

- [ ] **Step 1: Write the failing test**

Create `test/ingest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toObservation, mergeObservations } from '../scripts/ingest.mjs';

const ROW = {
  id: '9f1c2f7a-0000-4000-8000-000000000001',
  character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  points: 40, note: 'rides an ornius', created_at: '2026-09-20T09:30:00.000Z',
};

test('a report becomes an observation in the documented shape', () => {
  assert.deepEqual(toObservation(ROW), {
    id: '9f1c2f7a-0000-4000-8000-000000000001',
    gift: 'grooming-kit',
    character: 'nydine',
    reaction: 'loved',
    points: 40,
    date: '2026-09-20',
  });
});

// The privacy rule, asserted rather than trusted.
test('nothing identifying and no free text survives the conversion', () => {
  const observation = toObservation({ ...ROW, reporter: 'someone', ip: '1.2.3.4', email: 'a@b.test' });
  for (const field of ['note', 'reporter', 'ip', 'email', 'user', 'author', 'submitter', 'upvotes', 'downvotes', 'status']) {
    assert.ok(!(field in observation), `${field} must not survive ingest`);
  }
});

test('a missing points value becomes null, not undefined', () => {
  const observation = toObservation({ ...ROW, points: undefined });
  assert.equal(observation.points, null);
  assert.ok('points' in observation);
});

test('rows are appended and the added ones are reported', () => {
  const { observations, added } = mergeObservations([{ id: 'old' }], [ROW]);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].id, 'old');
  assert.equal(added.length, 1);
});

test('a row already in the file is not appended twice', () => {
  const existing = [toObservation(ROW)];
  const { observations, added } = mergeObservations(existing, [ROW]);
  assert.equal(observations.length, 1);
  assert.deepEqual(added, []);
});

test('a duplicate inside one batch is only taken once', () => {
  const { added } = mergeObservations([], [ROW, ROW]);
  assert.equal(added.length, 1);
});

test('nothing to ingest leaves the file untouched', () => {
  const existing = [{ id: 'old' }];
  const { observations, added } = mergeObservations(existing, []);
  assert.deepEqual(observations, existing);
  assert.deepEqual(added, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ingest.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/ingest.mjs'`.

- [ ] **Step 3: Write `scripts/ingest.mjs`**

```js
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDataset, validate } from './validate.mjs';

// The observation shape from the spec's data model, and nothing else.
//
// The submitted note is deliberately left behind: observations.json has no
// field for it, and it is free text from an anonymous contributor that would
// otherwise be committed unread. The maintainer sees notes on the review page,
// and this script puts them in the pull request body instead.
export function toObservation(row) {
  return {
    id: row.id,
    gift: row.gift,
    character: row.character,
    reaction: row.reaction,
    points: row.points ?? null,
    date: String(row.created_at ?? '').slice(0, 10),
  };
}

// The report id becomes the observation id, so re-running after a half-finished
// sync cannot duplicate a row.
export function mergeObservations(existing, rows) {
  const seen = new Set(existing.map((observation) => observation.id));
  const added = [];
  for (const row of rows) {
    const observation = toObservation(row);
    if (seen.has(observation.id)) continue;
    seen.add(observation.id);
    added.push(observation);
  }
  return { observations: [...existing, ...added], added };
}

async function main() {
  const workerUrl = (process.env.WORKER_URL ?? '').replace(/\/+$/, '');
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  const dataDir = process.env.DATA_DIR ?? 'data';

  if (!workerUrl || !adminToken) {
    console.error('WORKER_URL and ADMIN_TOKEN must both be set');
    process.exit(1);
  }

  const response = await fetch(`${workerUrl}/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    console.error(`the Worker returned ${response.status}`);
    process.exit(1);
  }

  const { reports } = await response.json();
  const rows = Array.isArray(reports) ? reports : [];

  const observationsPath = path.join(dataDir, 'observations.json');
  const existing = JSON.parse(await readFile(observationsPath, 'utf8'));
  const { observations, added } = mergeObservations(existing, rows);

  if (added.length === 0) {
    console.log('nothing to ingest');
    await report(0, []);
    return;
  }

  // Validate the merged dataset in memory and write only if it is clean. A bad
  // row must never reach the working tree, let alone a pull request.
  const dataset = await loadDataset(dataDir);
  const { errors } = validate({ ...dataset, observations });
  if (errors.length) {
    console.error(`${errors.length} validation error(s); nothing written:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
  console.log(`ingested ${added.length} observation(s)`);
  await report(added.length, rows);
}

// Hands the count and the notes to the workflow. Writing to GITHUB_OUTPUT is a
// no-op locally, so the script behaves the same either way.
async function report(count, rows) {
  const notes = rows
    .filter((row) => row.note)
    .map((row) => `- ${row.character} / ${row.gift}: ${String(row.note).replace(/\s+/g, ' ')}`)
    .join('\n');

  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `added=${count}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `notes<<NOTES_EOF\n${notes}\nNOTES_EOF\n`);
}

// CLI entry point: `npm run ingest`. Importing this file runs nothing.
if (import.meta.filename === process.argv[1]) {
  await main();
}
```

- [ ] **Step 4: Add the script to `package.json`**

```json
    "ingest": "node scripts/ingest.mjs"
```

- [ ] **Step 5: Write `.github/workflows/sync-reports.yml`**

```yaml
name: sync-reports

# Pulls approved reports out of the Worker and opens a pull request adding them
# to data/observations.json. Nothing merges automatically: the repository stays
# the source of truth, and a human still says yes.
on:
  schedule:
    - cron: '17 6 * * *'
  workflow_dispatch:

permissions: {}

jobs:
  sync:
    # A fork has neither the secrets nor a reason to run this.
    if: github.repository == 'mackoz/fefw-gifts'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Pull approved reports
        id: ingest
        env:
          WORKER_URL: ${{ secrets.WORKER_URL }}
          ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
        run: npm run ingest

      # A pull request opened with GITHUB_TOKEN does not start another workflow,
      # so validation runs here instead. The deploy gate is untouched either
      # way: deploy only ever runs on a push to master, and that push does
      # trigger ci.yml.
      - name: Validate and test the result
        if: steps.ingest.outputs.added != '0'
        run: npm run validate && npm test

      - name: Open a pull request
        if: steps.ingest.outputs.added != '0'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ADDED: ${{ steps.ingest.outputs.added }}
          NOTES: ${{ steps.ingest.outputs.notes }}
        run: |
          BRANCH="reports/$(date -u +%Y-%m-%d-%H%M)"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          git add data/observations.json
          git commit -m "Add ${ADDED} approved player report(s)"
          git push origin "$BRANCH"
          printf '%s\n\n%s\n\n%s\n' \
            "${ADDED} approved report(s) from the submission Worker." \
            "Notes left by contributors (not committed — add anything worth keeping by hand):" \
            "${NOTES:-none}" \
            | gh pr create --base master --head "$BRANCH" \
                --title "Add ${ADDED} approved player report(s)" --body-file -
```

- [ ] **Step 6: Update `CONTRIBUTING.md`**

Replace the opening of "Reporting a gift result" with the in-site path, and keep
the GitHub issue form as the fallback:

```markdown
## Reporting a gift result

The quickest way is the **Report a result** button on the site. It needs no
account and no sign-up. Pick the character and the gift, say what the game
showed you, and submit.

Your report is anonymous. Nothing about you is stored — not a name, not an
email, not an IP address, not a session identifier. There is no credit
mechanism, by choice.

A report appears on the site straight away marked **awaiting review**, which is
not the same as confirmed: it contributes no points and settles nothing until a
maintainer approves it and it is merged into `data/observations.json`.

While it is waiting, other visitors can say whether it matches what they have
seen. Those responses are private: they help the maintainer decide what to check
first and never change anything the site shows.

If the site's form is unavailable, the GitHub issue form below still works.
```

- [ ] **Step 7: Update `README.md`**

In "Contributing", say the in-site form is the primary path and issues are for
structural changes. Add a short "How a report becomes data" list:

```markdown
### How a report becomes data

1. A player submits a result on the site. It is stored as **pending** in a
   Cloudflare Worker, never in this repository.
2. The site shows it as *awaiting review*. It is not a confirmation: it
   contributes no points and produces no verdict.
3. Other visitors can privately agree or disagree, which orders the
   maintainer's queue and nothing else.
4. The maintainer approves it on a private review page.
5. A nightly job opens a pull request adding it to `data/observations.json`.
6. On merge it becomes canonical and drops out of the pending overlay.

The repository is the source of truth at every step. The Worker is a
convenience layer over it, and the site works completely without it.
```

- [ ] **Step 8: Update `CLAUDE.md`**

Add these bullets:

```markdown
- **Votes never reach the published site.** `GET /pending` must not select or
  return `upvotes`/`downvotes`, and no public view may render a tally in any
  form. It is enforced in the SQL in `worker/src/reports.js`, and tests assert
  it. A visible tally would read as confirmation and manufacture confidence out
  of guesswork — see the spec's "Peer validation by voting".
- **A pending report is not a confirmation.** It may not flip a pair to
  `CONFIRMED` or `FAVORITE`, contribute points, count toward a tally, or produce
  a negative verdict. Only an approved observation merged into `data/` may.
- **The Worker collects no personal data.** No name, email, IP, hashed IP,
  session id or fingerprint, in the D1 schema, the Worker or the client.
  Turnstile is called without `remoteip`. Adding any of these is a design
  change, not a fix.
- **The site must work with the Worker unavailable or unconfigured.**
  `assets/js/config.js` ships with `WORKER_URL = null`, which is a supported
  state, not a bug.
- **Worker modules stay Node-importable**, like the browser modules: no
  top-level `env` access and no Cloudflare-only globals at module scope, so
  `node:test` can import them directly.
- **Wrangler is never installed.** It runs through `npx --yes wrangler …`, so
  `package.json` keeps no dependencies.
```

- [ ] **Step 9: Run the tests**

Run: `node --test test/ingest.test.mjs`
Expected: PASS, 7 tests.

Run: `npm test && npm run validate`
Expected: PASS.

Check the workflow parses:

Run: `node -e "require('fs').readFileSync('.github/workflows/sync-reports.yml','utf8')"`
and read it once yourself for shell-quoting mistakes — there is no YAML linter
available and adding one would mean adding a dependency.

- [ ] **Step 10: Commit**

```bash
git add scripts/ingest.mjs .github/workflows/sync-reports.yml package.json README.md CONTRIBUTING.md CLAUDE.md test/ingest.test.mjs
git commit -m "Sync approved reports into the repository through a pull request"
```

---

## Operator setup (after the plan is implemented)

None of this is code, and none of it blocks implementation — the site ships in
its no-submissions mode until it is done. It needs a Cloudflare account.

1. Create the D1 database and run `worker/schema.sql` against it.
2. Create a Turnstile widget for `mackoz.github.io`.
3. Generate a long random admin token.
4. Set the `TURNSTILE_SECRET` and `ADMIN_TOKEN` Worker secrets.
5. Deploy the Worker and note its URL.
6. Put the Worker URL and the Turnstile **site** key in `assets/js/config.js`
   and commit — this is the switch that turns submissions on.
7. Add `WORKER_URL` and `ADMIN_TOKEN` as GitHub Actions secrets.

`worker/README.md` carries the exact commands.

## Deliberate deviations from the spec

Each of these is a decision, not an oversight. Do not "fix" them during
implementation; raise them if you disagree.

- **The spec says a report button sits on "every character, gift and matrix
  cell". This plan puts one on character and gift rows only.** At 80 rows by 53
  columns the matrix would carry over four thousand buttons, roughly doubling
  the heaviest page's DOM for a target too small to hit on a phone. The matrix
  cell already links nowhere; a reader who wants to report goes through the
  character or gift page. If the matrix is later made cell-clickable, the button
  belongs there.
- **Vote controls are on character and gift rows only, for the same reason.**
- **The submitted `note` is not committed.** `data/observations.json` has no
  field for it and the spec's data model does not define one. Dropping it keeps
  anonymous free text out of a public repository; the maintainer reads notes in
  the review page and in the sync pull request body, and adds anything worth
  keeping by hand. See Task 11.

## Known limitations, accepted

- **The admin token lives in `localStorage` on a public origin.** Anyone holding
  it can approve anything. Accepted for a single maintainer; the token must be
  long, random, HTTPS-only and rotated if it leaks. Cloudflare Access in front
  of `/review` is the upgrade path.
- **`POST /ingest` marks rows ingested as it returns them.** A pull request
  closed without merging loses those rows, which must then be re-entered by
  hand.
- **`localStorage` vote tracking is bypassed by a private window.** It is UX
  hygiene, not a control. Turnstile stops volume abuse and maintainer review is
  the real backstop.
- **The Worker cannot check that a character or gift id exists**, because it
  holds no copy of the dataset. An unknown id matches nothing in the overlay and
  is rejected by `npm run validate` before it can be committed.
- **The sync pull request does not itself run CI**, because a pull request
  opened with `GITHUB_TOKEN` starts no workflow. The workflow validates and
  tests before opening it, and the deploy gate is unaffected: deploy runs only
  on a push to `master`, which does trigger `ci.yml`.
