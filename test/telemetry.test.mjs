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
