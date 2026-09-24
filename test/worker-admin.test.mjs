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
  for (const [method, path] of [
    ['GET', '/review'], ['POST', '/review/r1'], ['POST', '/ingest'],
    ['GET', '/item-review'], ['POST', '/item-review/i1'], ['POST', '/ingest-items'],
  ]) {
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
  const rows = [{ id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved', upvotes: 3, downvotes: 1, created_at: '2026-09-20T00:00:00.000Z' }];
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

test('an inherited key is rejected like any other bad decision', async () => {
  for (const decision of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
    const db = fakeD1();
    const res = await handle(authed('POST', '/review/r1', { decision }), env(db), deps);
    assert.equal(res.status, 400, decision);
    assert.equal(db.calls.length, 0, decision);
  }
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

test('a slash-smuggling id never reaches setStatus', async () => {
  const db = fakeD1();
  const res = await handle(authed('POST', '/review/a%2Fb', { decision: 'approve' }), env(db), deps);
  assert.notEqual(res.status, 200);
  assert.equal(db.calls.length, 0);
});

test('a malformed percent-escape in the id does not throw', async () => {
  const db = fakeD1();
  const res = await handle(authed('POST', '/review/%zz', { decision: 'approve' }), env(db), deps);
  assert.notEqual(res.status, 500);
  assert.equal(db.calls.length, 0);
});
