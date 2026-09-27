# Anonymous Usage Telemetry

**Date:** 2026-09-27
**Status:** Approved design, awaiting spec review

## Problem

The site has no signal about how it is used: which characters and gifts people
look up, what they search for, whether the report form is opened and completed.
The maintainer has a PostHog account and wants counts like these.

The site also makes a privacy promise, written into `CLAUDE.md`, the main spec's
"Anonymity and abuse" section and `CONTRIBUTING.md`: no name, email, IP, hashed
IP, session id or fingerprint in the D1 schema, the Worker **or the client**.
Telemetry has to fit inside that promise, not beside it.

## Decision

**Anonymous counts, sent by our own module, through the existing proxy.**

- A small first-party module, `assets/js/telemetry.js`, builds each event and
  posts it to PostHog's capture API. The PostHog SDK is **not** loaded. Nothing
  is sent that this module does not construct explicitly, so there is no
  autocapture, session replay, surveys or heatmaps to be switched on by a later
  config change or SDK update.
- Events go to `https://t.mackoz.net`, the PostHog reverse proxy already used by
  uma-tools. It routes by the project key in the payload, so reusing it costs
  nothing and keeps ad-blockers from dropping most events. Its CORS preflight
  was checked on 2026-09-27: it allows a cross-origin `POST` with
  `content-type`.
- A **separate PostHog project** is used for fefw-gifts, not the uma-tools
  project. "Discard client IP data" is a project-wide setting; sharing a project
  would force a choice between uma-tools' GeoIP data and this site's promise.

Rejected: loading `posthog-js` from PostHog's CDN with privacy flags set (the
promise would rest on a dozen flags on a script we do not control, and tests
could not check it); routing through the Cloudflare Worker (a new route and new
traffic through the Worker for no gain once the proxy is reused).

## What is collected

### Identity

- `distinct_id` is `crypto.randomUUID()`, generated once when the module is
  created and held in memory only. It lives for one page load; a reload or a
  new tab gets a new one. It links the events of a single page load (so the
  report funnel can be read) and nothing else.
- Nothing is written to or read from `localStorage`, `sessionStorage`, cookies
  or IndexedDB by the telemetry module.
- Every event carries `$process_person_profile: false`, so PostHog creates no
  person profile, and `$geoip_disable: true`, so PostHog does not derive a
  location from the request IP.
- The request IP is discarded by the PostHog project setting **"Discard client
  IP data"**, which the maintainer turns on when creating the project. Code
  cannot enforce this; the setup step is documented in `README.md`.
- The telemetry id is **never** attached to a report, a vote, or any request to
  the Worker, and no report id is ever attached to a telemetry event. Browsing
  and contributing cannot be joined.

Consequence, accepted: PostHog cannot count unique or returning visitors,
sessions or bounce rate. It counts page loads and events.

### Events

Event names are camelCase, matching uma-tools.

| Event | When | Properties |
|---|---|---|
| `$pageview` | First render, and every `hashchange` | `view`, `id` (from `parseRoute`), `$current_url`, `$host`, `$pathname` (the hash route as a path, e.g. `/character/seteth`); on the first pageview of a page load only, `$referring_domain` (hostname of `document.referrer`, or `$direct`) |
| `search` | Search box idle for 1500 ms with a trimmed value of 2+ characters that differs from the last one sent | `query`: lower-cased, trimmed, cut to 60 characters |
| `filterToggled` | A `[data-filter]` checkbox changes | `filter` (its `data-filter` name), `on` (boolean) |
| `reportOpened` | The report dialog opens | none |
| `reportSubmitted` | The Worker answers a report submission | `kind`: `gift` or `item`; `outcome`: `ok` or `error` |
| `voteCast` | The Worker answers a vote | `outcome`: `ok` or `error` |

Deliberately absent: report contents (character, gift, reaction, item name),
report ids, vote direction, full referrer URLs, screen size, user agent string,
language. `voteCast` carries no direction so that no tally of any kind exists
anywhere, in keeping with "Peer validation by voting".

The `search` debounce is separate from, and longer than, the 120 ms render
debounce, so typing "seteth" sends one event rather than six prefixes.

## Module design

`assets/js/telemetry.js`, ESM, no top-level DOM or `window` access, importable
by `node:test`.

```js
// Pure: builds the JSON body for one event. No clock, no randomness, no I/O.
export function buildEvent({ key, distinctId, event, properties }) → object

// Decides whether telemetry runs at all.
export function telemetryEnabled({ key, location }) → boolean

// Returns { track(event, properties) }. track() never throws, never returns a
// promise the caller must handle, and is a no-op when disabled.
export function createTelemetry({ key, host, location, send, randomId }) → { track }
```

- `buildEvent` returns `{ api_key, event, distinct_id, properties }` where
  `properties` is the caller's properties merged under the fixed
  `$process_person_profile: false`, `$geoip_disable: true` and
  `$lib: 'fefw-gifts'`. Fixed keys win over caller keys.
- `telemetryEnabled` is true only when `key` is a non-empty string **and**
  `location.protocol === 'https:'` **and** `location.hostname` is not
  `localhost`, `127.0.0.1` or `[::1]`. Local development and file previews
  therefore send nothing.
- `send(url, body)` is injected. The browser default is
  `fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
  body, keepalive: true, credentials: 'omit' })`, with the promise's rejection
  swallowed. `url` is `${host}/i/v0/e/`.
- `randomId` is injected (default `() => crypto.randomUUID()`) so tests are
  deterministic.
- `track` wraps building and sending in `try/catch`; a throwing `send` or a
  missing `crypto` disables nothing else on the page.

### Configuration

`assets/js/config.js` gains:

```js
export const POSTHOG_KEY = 'phc_qp9gwfJwRJRPrqZq7bQDwEr5ARv9rPGBAi6ntwWija9T'; // project 631311, US Cloud
export const POSTHOG_HOST = 'https://t.mackoz.net';
```

Null is a supported state, exactly like `WORKER_URL`: telemetry is off and the
site is unchanged. The key is public by design (it can only write events), and
the fefw-gifts project (631311) already exists with "Discard client IP data"
on and autocapture, heatmaps and web vitals off, as of 2026-09-27.

### Wiring

- `assets/js/app.js` creates the telemetry instance and emits `$pageview`,
  `search` and `filterToggled` from the listeners it already owns.
- `createReportForm` in `assets/js/report-form.js` gains an optional
  `onTelemetry(event, properties)` option defaulting to a no-op; it calls it on
  open and after the submission's outcome is known. The vote handler in
  `app.js` emits `voteCast` after the Worker answers. DOM modules receive the
  callback; they do not import telemetry.
- `review/index.html` does not load telemetry. Maintainer activity is not
  usage.
- Telemetry is created after the first render is scheduled and never awaited,
  so it cannot delay committed data from rendering.

## Failure behaviour

Blocked by an ad-blocker, proxy down, PostHog down, key null, offline: in every
case the page behaves exactly as it does today. No console errors are raised by
telemetry beyond what the browser itself logs for a blocked request.

## Rule and documentation changes

- **`CLAUDE.md`** gains a bullet:
  > **Telemetry is anonymous counts only.** `assets/js/telemetry.js` sends
  > events with a random, in-memory, per-page-load id and
  > `$process_person_profile: false`; it never reads or writes browser storage
  > or cookies, never loads a third-party script, and its id is never attached
  > to a report, a vote or a Worker request. Adding a persistent id, a person
  > profile, autocapture or session replay is a design change, not a fix.

  The existing "Worker collects no personal data" bullet is unchanged; the
  per-page-load id is permitted only by the new bullet's terms.
- **Main spec**, "Anonymity and abuse": one paragraph pointing to this spec and
  stating what is counted.
- **`CONTRIBUTING.md`**: after the anonymity paragraph, one sentence saying the
  site counts page views and a few button presses anonymously, with no
  identifier that survives a reload and nothing tied to a report.
- **`README.md`**: a short setup note: create a PostHog project, turn on
  "Discard client IP data", put its key in `POSTHOG_KEY`.

## Testing

New `test/telemetry.test.mjs`:

- `buildEvent` output has exactly the keys `api_key`, `event`, `distinct_id`,
  `properties`; fixed properties are present and override caller attempts to
  set them.
- `telemetryEnabled` is false for a null or empty key, `http:`, `file:`,
  `localhost`, `127.0.0.1`, `[::1]`; true for `https://mackoz.github.io`.
- `createTelemetry(...).track` is a no-op when disabled (injected `send` never
  called); calls `send` once with `${host}/i/v0/e/` when enabled; does not throw
  when `send` throws; uses the same `distinct_id` for every event from one
  instance and a different one for a second instance.
- A source-level guard: `assets/js/telemetry.js` contains no `localStorage`,
  `sessionStorage`, `document.cookie`, `indexedDB` or `<script` string, so a
  later edit that reaches for storage fails the suite.
- The payload builders in `report-form.js` and the Worker request code do not
  include `distinct_id` or any telemetry field (asserted on
  `buildReportPayload` and `buildItemReportPayload` output).
- The test file imports `assets/js/telemetry.js` directly, which is itself the
  check that it stays Node-importable.

Wiring in `app.js` and `report-form.js` is checked in a browser against a key
for the new project, confirming events arrive in PostHog with no person profile
and no GeoIP properties.

## Out of scope

- Unique-visitor, retention, session or bounce metrics.
- Search result counts ("searched and found nothing"). Views do not currently
  expose a count; revisit if search terms alone prove insufficient.
- Honouring Do Not Track / Global Privacy Control: decided against, since
  nothing identifying is collected.
- A consent banner: not needed for anonymous, storage-free counting.
