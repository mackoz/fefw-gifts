# Anonymous Usage Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count page views, searches, filter toggles and report/vote outcomes in PostHog, anonymously, without loading any third-party script.

**Architecture:** A first-party ESM module, `assets/js/telemetry.js`, builds PostHog capture-API bodies and posts them with `fetch` to the `t.mackoz.net` proxy. It is pure apart from an injected `send` and `randomId`, so `node:test` covers it fully. `app.js` owns the listeners and calls `telemetry.track`; `report-form.js` receives an `onTelemetry` callback and never imports telemetry.

**Tech Stack:** Plain browser ESM, `node:test`, PostHog capture API (`POST /i/v0/e/`). No dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-09-27-telemetry-design.md`

## Global Constraints

- "**No dependencies, ever.** `package.json` has no `dependencies` and no `devDependencies`, only scripts." Do not add `posthog-js` or anything else.
- "**No build step, ever.** Files are served exactly as committed."
- "**Browser modules must stay Node-importable.** Every file under `assets/js/` uses ESM `export`, has no top-level DOM access, and must be importable directly by `node:test`."
- "**The site must work with the Worker unavailable or unconfigured.**" Likewise telemetry: `POSTHOG_KEY` null, a blocked request or a PostHog outage must leave the page behaving exactly as today.
- "**Votes never reach the published site.** … no public view may render a tally in any form." `voteCast` carries no direction.
- Telemetry id is `crypto.randomUUID()`, in memory, per page load. `telemetry.js` never touches `localStorage`, `sessionStorage`, cookies or IndexedDB, and never creates a `<script>` element.
- Every event carries `$process_person_profile: false`, `$geoip_disable: true`, `$lib: 'fefw-gifts'`; these override caller properties.
- No report contents, report ids, vote direction or full referrer URLs in any event. The telemetry id is never added to a report, vote or Worker request.
- Event names are camelCase: `$pageview`, `search`, `filterToggled`, `reportOpened`, `reportSubmitted`, `voteCast`.
- Telemetry is enabled only when `POSTHOG_KEY` is a non-empty string, `location.protocol === 'https:'`, and `location.hostname` is not `localhost`, `127.0.0.1` or `[::1]`.
- `POSTHOG_KEY = 'phc_qp9gwfJwRJRPrqZq7bQDwEr5ARv9rPGBAi6ntwWija9T'`, `POSTHOG_HOST = 'https://t.mackoz.net'`, endpoint `${POSTHOG_HOST}/i/v0/e/`.
- Commit messages follow the repo's style: a plain sentence in the imperative, no `feat:` prefix.
- "**Run `npm test` and `npm run validate` before committing.** Both must pass cleanly (no stray warnings)."

---

### Task 1: The telemetry module

**Files:**
- Create: `assets/js/telemetry.js`
- Test: `test/telemetry.test.mjs`

**Interfaces:**
- Consumes: `parseRoute(hash) → { view, id }` from `assets/js/filters.js` (existing).
- Produces:
  - `buildEvent({ key, distinctId, event, properties }) → { api_key, event, distinct_id, properties }`
  - `telemetryEnabled({ key, location }) → boolean`
  - `createTelemetry({ key, host, location, send?, randomId? }) → { enabled: boolean, track(event: string, properties?: object): void }`
  - `pageviewProperties({ location, referrer, first }) → object`
  - `referrerDomain(referrer) → string` (hostname, or `'$direct'`)
  - `searchQuery(raw) → string | null`
  - `createSearchReporter(track) → (raw: string) => void`
  - `SEARCH_IDLE_MS = 1500`, `SEARCH_MAX_LENGTH = 60`

- [ ] **Step 1: Write the failing tests**

Create `test/telemetry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildEvent, telemetryEnabled, createTelemetry, pageviewProperties, referrerDomain,
  searchQuery, createSearchReporter, SEARCH_IDLE_MS, SEARCH_MAX_LENGTH,
} from '../assets/js/telemetry.js';

const SITE = {
  protocol: 'https:',
  hostname: 'mackoz.github.io',
  host: 'mackoz.github.io',
  href: 'https://mackoz.github.io/fefw-gifts/#/character/seteth',
  hash: '#/character/seteth',
};

const PRIVACY = { $process_person_profile: false, $geoip_disable: true, $lib: 'fefw-gifts' };

function recorder() {
  const sent = [];
  return { sent, send: (url, body) => { sent.push({ url, body: JSON.parse(body) }); } };
}

function enabled(overrides = {}) {
  const r = recorder();
  const telemetry = createTelemetry({
    key: 'phc_x', host: 'https://t.example', location: SITE, send: r.send, randomId: () => 'id-1',
    ...overrides,
  });
  return { telemetry, sent: r.sent };
}

// --- buildEvent

test('buildEvent produces exactly the capture API body', () => {
  assert.deepEqual(
    buildEvent({ key: 'phc_x', distinctId: 'id-1', event: 'search', properties: { query: 'seteth' } }),
    { api_key: 'phc_x', event: 'search', distinct_id: 'id-1', properties: { query: 'seteth', ...PRIVACY } },
  );
});

test('an event with no properties still carries the privacy properties', () => {
  assert.deepEqual(buildEvent({ key: 'k', distinctId: 'd', event: 'reportOpened' }).properties, PRIVACY);
});

test('the privacy properties cannot be overridden by a caller', () => {
  const { properties } = buildEvent({
    key: 'k', distinctId: 'd', event: 'e',
    properties: { $process_person_profile: true, $geoip_disable: false, $lib: 'posthog-js' },
  });
  assert.deepEqual(properties, PRIVACY);
});

// --- telemetryEnabled

test('telemetry runs only with a key, over https, off local hosts', () => {
  assert.equal(telemetryEnabled({ key: 'phc_x', location: SITE }), true);
  for (const key of [null, undefined, '']) {
    assert.equal(telemetryEnabled({ key, location: SITE }), false, `key ${key}`);
  }
  for (const location of [
    { ...SITE, protocol: 'http:' },
    { ...SITE, protocol: 'file:', hostname: '' },
    { ...SITE, hostname: 'localhost' },
    { ...SITE, hostname: '127.0.0.1' },
    { ...SITE, hostname: '[::1]' },
    undefined,
  ]) {
    assert.equal(telemetryEnabled({ key: 'phc_x', location }), false, JSON.stringify(location));
  }
});

// --- createTelemetry

test('a disabled instance never sends', () => {
  const { telemetry, sent } = enabled({ key: null });
  assert.equal(telemetry.enabled, false);
  telemetry.track('search', { query: 'seteth' });
  assert.deepEqual(sent, []);
});

test('an enabled instance posts each event to the capture endpoint', () => {
  const { telemetry, sent } = enabled();
  assert.equal(telemetry.enabled, true);
  telemetry.track('filterToggled', { filter: 'hideSpoilers', on: false });
  assert.deepEqual(sent, [{
    url: 'https://t.example/i/v0/e/',
    body: buildEvent({ key: 'phc_x', distinctId: 'id-1', event: 'filterToggled', properties: { filter: 'hideSpoilers', on: false } }),
  }]);
});

test('one instance keeps one id for its page load; a new instance gets a new one', () => {
  const r = recorder();
  let n = 0;
  const make = () => createTelemetry({
    key: 'phc_x', host: 'https://t.example', location: SITE, send: r.send, randomId: () => `id-${++n}`,
  });
  const first = make();
  first.track('a');
  first.track('b');
  make().track('c');
  assert.deepEqual(r.sent.map((s) => s.body.distinct_id), ['id-1', 'id-1', 'id-2']);
});

test('a throwing send never reaches the caller', () => {
  const { telemetry } = enabled({ send: () => { throw new Error('blocked'); } });
  assert.doesNotThrow(() => telemetry.track('search', { query: 'seteth' }));
});

test('an id that cannot be generated switches telemetry off instead of throwing', () => {
  const { telemetry, sent } = enabled({ randomId: () => { throw new Error('no crypto'); } });
  assert.equal(telemetry.enabled, false);
  telemetry.track('search', { query: 'seteth' });
  assert.deepEqual(sent, []);
});

// A later edit that reaches for storage or a third-party script fails here.
test('the module never touches browser storage or loads a script', async () => {
  const source = await readFile(new URL('../assets/js/telemetry.js', import.meta.url), 'utf8');
  for (const banned of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', 'createElement', '<script']) {
    assert.ok(!source.includes(banned), `telemetry.js mentions ${banned}`);
  }
});

// --- pageviews

test('a pageview names the route as a path, with no referrer after the first', () => {
  assert.deepEqual(pageviewProperties({ location: SITE, referrer: 'https://www.reddit.com/r/fe', first: false }), {
    view: 'character',
    id: 'seteth',
    $current_url: SITE.href,
    $host: 'mackoz.github.io',
    $pathname: '/character/seteth',
  });
});

test('the first pageview carries the referring domain and nothing more of the referrer', () => {
  const props = pageviewProperties({
    location: SITE, referrer: 'https://www.reddit.com/r/fe/comments/abc?utm=1', first: true,
  });
  assert.equal(props.$referring_domain, 'www.reddit.com');
  assert.ok(!Object.values(props).some((v) => String(v).includes('/r/fe')), 'no referrer path');
});

test('a route with no id, or no hash at all, is still a path', () => {
  const matrix = { ...SITE, hash: '#/matrix', href: 'https://mackoz.github.io/fefw-gifts/#/matrix' };
  assert.equal(pageviewProperties({ location: matrix, first: false }).$pathname, '/matrix');
  assert.equal(pageviewProperties({ location: matrix, first: false }).id, null);
  const bare = { ...SITE, hash: '', href: 'https://mackoz.github.io/fefw-gifts/' };
  assert.equal(pageviewProperties({ location: bare, first: false }).$pathname, '/character');
});

test('referrerDomain keeps the hostname only and falls back to $direct', () => {
  assert.equal(referrerDomain('https://www.reddit.com/r/fe?x=1'), 'www.reddit.com');
  assert.equal(referrerDomain(''), '$direct');
  assert.equal(referrerDomain(undefined), '$direct');
  assert.equal(referrerDomain('not a url'), '$direct');
});

// --- search

test('search waits for a pause well past the 120 ms render debounce', () => {
  assert.equal(SEARCH_IDLE_MS, 1500);
});

test('searchQuery trims, lower-cases, caps, and ignores one-letter queries', () => {
  assert.equal(searchQuery('  Seteth '), 'seteth');
  assert.equal(searchQuery('a'), null);
  assert.equal(searchQuery('   '), null);
  assert.equal(searchQuery('x'.repeat(100)), 'x'.repeat(SEARCH_MAX_LENGTH));
  assert.equal(SEARCH_MAX_LENGTH, 60);
});

test('the search reporter sends a query only when it differs from the last one sent', () => {
  const calls = [];
  const report = createSearchReporter((event, properties) => calls.push([event, properties]));
  report('Seteth');
  report('seteth ');
  report('s');
  report('dietrich');
  report('seteth');
  assert.deepEqual(calls, [
    ['search', { query: 'seteth' }],
    ['search', { query: 'dietrich' }],
    ['search', { query: 'seteth' }],
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/telemetry.test.mjs`
Expected: FAIL, with `Cannot find module` for `assets/js/telemetry.js`.

- [ ] **Step 3: Write the module**

Create `assets/js/telemetry.js`. Keep the comments free of the banned words the source guard checks for (`localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `createElement`, `<script`); say "browser storage" instead.

```js
import { parseRoute } from './filters.js';

// Anonymous usage counts, posted straight to PostHog's capture API. See
// docs/superpowers/specs/2026-09-27-telemetry-design.md. The PostHog SDK is
// deliberately not loaded: nothing is sent that this module does not build,
// and it never reads or writes browser storage. The id is random, held in
// memory, and lives for one page load.

export const SEARCH_IDLE_MS = 1500;
export const SEARCH_MAX_LENGTH = 60;

// Spread last in buildEvent, so no caller can switch them off.
const PRIVACY_PROPERTIES = {
  $process_person_profile: false,
  $geoip_disable: true,
  $lib: 'fefw-gifts',
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const DISABLED = Object.freeze({ enabled: false, track() {} });

export function buildEvent({ key, distinctId, event, properties = {} }) {
  return {
    api_key: key,
    event,
    distinct_id: distinctId,
    properties: { ...properties, ...PRIVACY_PROPERTIES },
  };
}

// Local runs and file previews send nothing, so they never show up as usage.
export function telemetryEnabled({ key, location }) {
  return typeof key === 'string' && key.length > 0
    && location?.protocol === 'https:'
    && !LOCAL_HOSTNAMES.has(location.hostname);
}

function postJson(url, body) {
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'omit',
  }).catch(() => {});
}

// track() never throws and returns nothing to await: a blocked request or a
// PostHog outage must leave the page exactly as it would be without telemetry.
export function createTelemetry({
  key, host, location, send = postJson, randomId = () => crypto.randomUUID(),
} = {}) {
  if (!telemetryEnabled({ key, location })) return DISABLED;
  let distinctId;
  try {
    distinctId = randomId();
  } catch {
    return DISABLED;
  }
  const url = `${host}/i/v0/e/`;
  return {
    enabled: true,
    track(event, properties) {
      try {
        send(url, JSON.stringify(buildEvent({ key, distinctId, event, properties })));
      } catch {
        // Telemetry is optional; the page is not.
      }
    },
  };
}

export function referrerDomain(referrer) {
  try {
    return new URL(referrer).hostname || '$direct';
  } catch {
    return '$direct';
  }
}

// The hash route doubles as the path, so PostHog's page reports read as
// /character/seteth rather than one page with a changing fragment. Only the
// referrer's hostname is kept, and only on the first pageview of a load.
export function pageviewProperties({ location, referrer, first }) {
  const { view, id } = parseRoute(location.hash);
  const properties = {
    view,
    id,
    $current_url: location.href,
    $host: location.host,
    $pathname: id ? `/${view}/${id}` : `/${view}`,
  };
  if (first) properties.$referring_domain = referrerDomain(referrer);
  return properties;
}

export function searchQuery(raw) {
  const query = String(raw ?? '').trim().toLowerCase();
  if (query.length < 2) return null;
  return query.slice(0, SEARCH_MAX_LENGTH);
}

// Called from a debounce, so it sees settled queries; the dedupe stops a
// refocus or a trailing space from counting the same search twice.
export function createSearchReporter(track) {
  let last = null;
  return (raw) => {
    const query = searchQuery(raw);
    if (query === null || query === last) return;
    last = query;
    track('search', { query });
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/telemetry.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite and validation**

Run: `npm test && npm run validate`
Expected: both pass with no warnings.

- [ ] **Step 6: Commit**

```bash
git add assets/js/telemetry.js test/telemetry.test.mjs
git commit -m "Add an anonymous telemetry module that posts to PostHog's capture API"
```

---

### Task 2: Report form reports its outcomes

**Files:**
- Modify: `assets/js/report-form.js` (`createReportForm`, currently lines 137-312)
- Test: `test/report-form.test.mjs` (`formHarness`, currently lines 278-326; new tests appended at the end of the file)

**Interfaces:**
- Consumes: nothing from Task 1. The form takes a plain callback and must not import `telemetry.js`.
- Produces: `createReportForm({ …, onTelemetry = () => {} })`. It calls `onTelemetry('reportOpened')` on every open (both `open` and `openMissingItem`), and `onTelemetry('reportSubmitted', { kind: 'gift' | 'item', outcome: 'ok' | 'error' })` once the Worker has answered a submission. It is not called when the form is refused locally before sending. Task 3 passes `telemetry.track` here.

- [ ] **Step 1: Let the harness record telemetry calls**

In `test/report-form.test.mjs`, inside `formHarness`:

Change
```js
  const calls = { submitItemReport: [], submitReport: [], resets: 0, refreshed: 0 };
```
to
```js
  const calls = { submitItemReport: [], submitReport: [], resets: 0, refreshed: 0, telemetry: [] };
```

and in the `createReportForm({ … })` call inside `formHarness`, after `getFilters: () => filters,` add:
```js
    onTelemetry: (event, properties) => { calls.telemetry.push([event, properties]); },
```

- [ ] **Step 2: Write the failing tests**

Append to the end of `test/report-form.test.mjs`:

```js
// --- telemetry: counts only, never contents

test('opening the dialog, either way, is counted once per open', async (t) => {
  const h = formHarness(t);
  await h.reportForm.open();
  await h.reportForm.openMissingItem('Lantern Oil');
  assert.deepEqual(h.calls.telemetry, [['reportOpened', undefined], ['reportOpened', undefined]]);
});

test('a result report counts its outcome once the Worker answers, and nothing about its contents', async (t) => {
  const h = formHarness(t);
  await h.reportForm.open('alexandra', 'horse-grooming-kit');
  h.radio.reaction = 'liked';
  await h.submit();
  assert.deepEqual(h.calls.telemetry.at(-1), ['reportSubmitted', { kind: 'gift', outcome: 'ok' }]);
});

test('a refused item report is counted as an error', async (t) => {
  const h = formHarness(t, { submitItemReport: async () => ({ ok: false, status: 403, data: null, error: 'could not verify that you are human' }) });
  await h.reportForm.openMissingItem('Lantern Oil');
  h.el.itemCategory.value = 'horses';
  await h.submit();
  assert.deepEqual(h.calls.telemetry.at(-1), ['reportSubmitted', { kind: 'item', outcome: 'error' }]);
});

test('a form refused before sending is not counted as a submission', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('Lantern Oil');
  h.el.itemCategory.value = 'horses';
  h.el.itemCharacter.value = 'alexandra';
  await h.submit();
  assert.match(h.el.status.textContent, /or neither/);
  assert.ok(!h.calls.telemetry.some(([event]) => event === 'reportSubmitted'));
});

test('report payloads carry no telemetry or session field', () => {
  const { payload: result } = buildReportPayload(FIELDS);
  const { payload: item } = buildItemReportPayload(
    { name: 'Lantern Oil', category: 'horses', turnstileToken: 'tok' },
    { gifts: [] },
  );
  for (const payload of [result, item]) {
    assert.ok(payload, 'the payload builds');
    for (const key of Object.keys(payload)) assert.doesNotMatch(key, /distinct|telemetry|posthog|session/i);
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/report-form.test.mjs`
Expected: the first four new tests FAIL (`calls.telemetry` stays empty). The payload test passes already, which is expected: it pins today's behaviour.

- [ ] **Step 4: Implement**

In `assets/js/report-form.js`:

Change the `createReportForm` signature from
```js
export function createReportForm({
  elements, index, api, turnstile, onSubmitted = () => {},
  getFilters = () => ({ hideSpoilers: true }),
}) {
```
to
```js
// `onTelemetry(event, properties)` receives counts only -- which kind of report
// and whether the Worker took it, never what was reported. app.js hands it
// telemetry.track; this module does not import telemetry itself.
export function createReportForm({
  elements, index, api, turnstile, onSubmitted = () => {},
  getFilters = () => ({ hideSpoilers: true }),
  onTelemetry = () => {},
}) {
```

Change `send` from
```js
  async function send(payload, submitCall) {
    submit.disabled = true;
    setStatus('Sending…');
    const result = await submitCall(payload);
    submit.disabled = false;
```
to
```js
  async function send(payload, submitCall, kind) {
    submit.disabled = true;
    setStatus('Sending…');
    const result = await submitCall(payload);
    submit.disabled = false;
    onTelemetry('reportSubmitted', { kind, outcome: result.ok ? 'ok' : 'error' });
```

In `submitResult`, change
```js
    if (!(await send(payload, (p) => api.submitReport(p)))) return;
```
to
```js
    if (!(await send(payload, (p) => api.submitReport(p), 'gift'))) return;
```

In `submitItem`, change
```js
    if (!(await send(payload, (p) => api.submitItemReport(p)))) return;
```
to
```js
    if (!(await send(payload, (p) => api.submitItemReport(p), 'item'))) return;
```

In `show`, make the first line of the function body:
```js
    onTelemetry('reportOpened');
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/report-form.test.mjs`
Expected: PASS, all tests, including every pre-existing one.

- [ ] **Step 6: Run the full suite and validation**

Run: `npm test && npm run validate`
Expected: both pass with no warnings.

- [ ] **Step 7: Commit**

```bash
git add assets/js/report-form.js test/report-form.test.mjs
git commit -m "Let the report form report opens and submission outcomes as counts"
```

---

### Task 3: Configure and wire telemetry into the page

**Files:**
- Modify: `assets/js/config.js`
- Modify: `assets/js/app.js`

**Interfaces:**
- Consumes: from Task 1, `createTelemetry`, `pageviewProperties`, `createSearchReporter`, `SEARCH_IDLE_MS`. From Task 2, the `onTelemetry` option of `createReportForm`.
- Produces: nothing other tasks use.

There is no unit test for this task. `app.js` runs `main()` on import and is the one module that touches the DOM at the top level. It is covered by the full suite still passing, and by Task 5's end-to-end check.

- [ ] **Step 1: Add the configuration**

Append to `assets/js/config.js`:

```js

// Anonymous usage counts (docs/superpowers/specs/2026-09-27-telemetry-design.md).
// The key is PostHog's write-only project token, public by design, for the
// fefw-gifts project (631311, US Cloud). Null switches telemetry off and is a
// supported state, like WORKER_URL. The host is the PostHog proxy shared with
// uma-tools; it routes by the key, not by site.
export const POSTHOG_KEY = 'phc_qp9gwfJwRJRPrqZq7bQDwEr5ARv9rPGBAi6ntwWija9T';
export const POSTHOG_HOST = 'https://t.mackoz.net';
```

- [ ] **Step 2: Import telemetry in `app.js`**

Change
```js
import { TURNSTILE_SITE_KEY } from './config.js';
```
to
```js
import { TURNSTILE_SITE_KEY, POSTHOG_KEY, POSTHOG_HOST } from './config.js';
import { createTelemetry, pageviewProperties, createSearchReporter, SEARCH_IDLE_MS } from './telemetry.js';
```

- [ ] **Step 3: Create the instance and count pageviews, searches and filters**

In `main()`, replace this block:
```js
  addEventListener('hashchange', render);
  document.getElementById('search').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    // As typed, for the missing-item pre-fill. The lower-cased copy above is
    // for matching only.
    state.searchText = e.target.value.trim();
    render();
  }, 120));
  for (const box of document.querySelectorAll('[data-filter]')) {
    box.checked = state.filters[box.dataset.filter];
    box.addEventListener('change', () => {
      state.filters[box.dataset.filter] = box.checked;
      render();
    });
  }
  render();
```
with:
```js
  // Synchronous and I/O-free until track() is called, and track() is never
  // awaited, so telemetry cannot hold up the first render.
  const telemetry = createTelemetry({ key: POSTHOG_KEY, host: POSTHOG_HOST, location: globalThis.location });
  let firstPageview = true;
  function trackPageview() {
    telemetry.track('$pageview', pageviewProperties({ location, referrer: document.referrer, first: firstPageview }));
    firstPageview = false;
  }

  addEventListener('hashchange', () => {
    render();
    trackPageview();
  });
  const search = document.getElementById('search');
  search.addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    // As typed, for the missing-item pre-fill. The lower-cased copy above is
    // for matching only.
    state.searchText = e.target.value.trim();
    render();
  }, 120));
  // Its own, longer debounce: typing "seteth" is one search, not six prefixes.
  const reportSearch = createSearchReporter(telemetry.track);
  search.addEventListener('input', debounce((e) => reportSearch(e.target.value), SEARCH_IDLE_MS));
  for (const box of document.querySelectorAll('[data-filter]')) {
    box.checked = state.filters[box.dataset.filter];
    box.addEventListener('change', () => {
      state.filters[box.dataset.filter] = box.checked;
      render();
      telemetry.track('filterToggled', { filter: box.dataset.filter, on: box.checked });
    });
  }
  render();
  trackPageview();
```

- [ ] **Step 4: Pass the callback to the report form**

In the `createReportForm({ … })` call in `main()`, after `getFilters: () => state.filters,` add:
```js
    onTelemetry: telemetry.track,
```

- [ ] **Step 5: Count vote outcomes**

In the `vote-form` submit handler, change
```js
    voteSubmit.disabled = false;
    voteTurnstile.reset();
```
to
```js
    voteSubmit.disabled = false;
    voteTurnstile.reset();
    // Outcome only. A direction would make PostHog hold a tally, which the
    // voting design forbids anywhere.
    telemetry.track('voteCast', { outcome: result.ok ? 'ok' : 'error' });
```

- [ ] **Step 6: Check the page still loads locally, and sends nothing from localhost**

Run `python3 -m http.server 8000` from the repo root and open `http://localhost:8000/` in a browser. (`review/index.html` loads only `review.js`, so the review page gets no telemetry without any change.) Then click through Character, Gifts, Matrix and Favourites, type in the search box and toggle a filter. Expected: the page behaves exactly as before, the console shows no errors, and the Network tab shows **no** request to `t.mackoz.net`, because localhost is disabled by design.

- [ ] **Step 7: Run the full suite and validation**

Run: `npm test && npm run validate`
Expected: both pass with no warnings.

- [ ] **Step 8: Commit**

```bash
git add assets/js/config.js assets/js/app.js
git commit -m "Count pageviews, searches, filter toggles and report and vote outcomes"
```

---

### Task 4: Record the rule and tell contributors

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md` ("### Anonymity and abuse", which ends just before "### Structural changes")
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add the rule to `CLAUDE.md`**

Directly after the bullet beginning `- **The Worker collects no personal data.**` (it ends `…is a design change, not a fix.`), insert:

```markdown
- **Telemetry is anonymous counts only.** `assets/js/telemetry.js` sends
  events with a random, in-memory, per-page-load id and
  `$process_person_profile: false`; it never reads or writes browser storage
  or cookies, never loads a third-party script, and its id is never attached
  to a report, a vote or a Worker request. Adding a persistent id, a person
  profile, autocapture or session replay is a design change, not a fix. See
  `docs/superpowers/specs/2026-09-27-telemetry-design.md`.
```

- [ ] **Step 2: Add a paragraph to the main spec**

In `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md`, at the end of "### Anonymity and abuse" (after the paragraph ending `Collecting less is the
better trade.` and before `### Structural changes`), insert:

```markdown

**Usage counts are anonymous too.** The site counts page views, searches,
filter toggles and report and vote outcomes in PostHog. Each page load gets a
random id held in memory; there is no person profile, no GeoIP, no browser
storage, and the id never reaches the Worker. See
`2026-09-27-telemetry-design.md`.
```

- [ ] **Step 3: Tell contributors in `CONTRIBUTING.md`**

After the paragraph that ends `There is no credit
mechanism, by choice.`, insert a new paragraph:

```markdown

Separately, the site counts page views, searches and button presses to see how
it is used. Those counts carry no identifier that survives a reload and are
never linked to a report or a vote.
```

- [ ] **Step 4: Add a setup note to `README.md`**

Insert a new section directly before `## Contributing`:

```markdown
## Usage counts

The site sends anonymous usage counts to PostHog (project 631311, US Cloud)
through the `t.mackoz.net` proxy; see
`docs/superpowers/specs/2026-09-27-telemetry-design.md` for exactly what is
sent. Nothing is sent from `localhost` or plain `http:`, so local runs never
show up. Setting `POSTHOG_KEY` to `null` in `assets/js/config.js` switches it
off.

If the PostHog project is ever recreated, turn on **Settings → Privacy →
Discard client IP data**, and leave autocapture, heatmaps, web vitals and
session replay off. The site does not load the PostHog SDK, but those switches
are the guard against anyone adding it later.

```

- [ ] **Step 5: Run the full suite and validation**

Run: `npm test && npm run validate`
Expected: both pass with no warnings.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-20-fefw-gifts-design.md CONTRIBUTING.md README.md
git commit -m "Record the anonymous-telemetry rule and tell contributors what is counted"
```

---

### Task 5: End-to-end check against PostHog (main session, not delegated)

**Files:** none changed.

- [ ] **Step 1: Send one real event through the proxy from Node**

Run from the repo root:
```bash
node --input-type=module -e "
import { createTelemetry } from './assets/js/telemetry.js';
import { POSTHOG_KEY, POSTHOG_HOST } from './assets/js/config.js';
const t = createTelemetry({
  key: POSTHOG_KEY, host: POSTHOG_HOST,
  location: { protocol: 'https:', hostname: 'setup-check.invalid' },
  send: async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); console.log(r.status, await r.text()); },
});
t.track('telemetryCheck', { note: 'plan task 5' });
"
```
Expected: `200` and a body like `{"status":"Ok"}`.

- [ ] **Step 2: Confirm how it landed in PostHog**

In PostHog, open project 631311 → Activity, and find `telemetryCheck`. Expected: it has `$lib = fefw-gifts` and `$process_person_profile = false`, no `$ip`, and no `$geoip_*` properties, and no person profile was created for its distinct id.

- [ ] **Step 3: After deploy, confirm the live site sends the expected events**

Once merged and deployed, open the live site with the Network tab filtered to `t.mackoz.net`. Load a character, switch views, search, toggle a filter. Expected: one `POST /i/v0/e/` per `$pageview`, `search` (after 1.5 s idle) and `filterToggled`, each with the same `distinct_id`; reload, and the `distinct_id` changes.
