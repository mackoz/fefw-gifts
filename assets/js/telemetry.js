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

// The hash route doubles as the path, so PostHog's page reports read as
// /character/seteth rather than one page with a changing fragment. Only the
// referrer's hostname is kept, and only on the first pageview of a load. The
// query string is dropped from $current_url because ad click ids (fbclid,
// gclid) are per-click identifiers, and GitHub Pages ignores it anyway.
export function pageviewProperties({ location, referrer, first }) {
  const { view, id } = parseRoute(location.hash);
  const properties = {
    view,
    id,
    $current_url: `${location.origin}${location.pathname}${location.hash}`,
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
