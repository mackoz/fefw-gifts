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
export function telemetryEnabled({ key, host, location }) {
  return typeof key === 'string' && key.length > 0
    && typeof host === 'string' && host.startsWith('https://')
    && location?.protocol === 'https:'
    && !LOCAL_HOSTNAMES.has(location.hostname);
}

// text/plain keeps this a CORS simple request, so no preflight round-trip
// precedes every event (and keepalive never meets a preflight). PostHog
// parses the body as JSON regardless of the content type; checked against
// the capture endpoint on 2026-09-27.
function postEvent(url, body) {
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body,
    keepalive: true,
    credentials: 'omit',
  }).catch(() => {});
}

// track() never throws and returns nothing to await: a blocked request or a
// PostHog outage must leave the page exactly as it would be without telemetry.
export function createTelemetry({
  key, host, location, send = postEvent, randomId = () => crypto.randomUUID(),
} = {}) {
  if (!telemetryEnabled({ key, host, location })) return DISABLED;
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

// Every character and gift id in data/ is kebab-case (verified against the
// committed dataset in test/telemetry.test.mjs), so anything else that lands
// in the hash -- a typo, a stray extra segment, pasted or typed text -- is
// not a real id and must not reach PostHog as one.
export const ROUTE_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

// The hash route doubles as the path, so PostHog's page reports read as
// /character/seteth rather than one page with a changing fragment. Only the
// referrer's hostname is kept, and only on the first pageview of a load.
// $current_url is rebuilt from the parsed route rather than copied from
// location.hash, so neither a query string (ad click ids like fbclid, gclid)
// nor arbitrary hash text reaches PostHog -- only a view name and an id that
// matches ROUTE_ID_PATTERN.
export function pageviewProperties({ location, referrer, first }) {
  const { view, id: rawId } = parseRoute(location.hash);
  const id = typeof rawId === 'string' && ROUTE_ID_PATTERN.test(rawId) ? rawId : null;
  const $pathname = id ? `/${view}/${id}` : `/${view}`;
  const properties = {
    view,
    id,
    $current_url: `${location.origin}${location.pathname}#${$pathname}`,
    $host: location.host,
    $pathname,
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
