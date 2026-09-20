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
