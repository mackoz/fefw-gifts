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

test('an oversized body with no Content-Length header is still refused', async () => {
  const db = fakeD1();
  const request = new Request('https://api.test/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ ...REPORT, note: 'x'.repeat(9000) }),
  });
  const res = await handle(request, env(db), deps());
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
});

test('an oversized body with a non-numeric Content-Length is still refused', async () => {
  const db = fakeD1();
  const request = new Request('https://api.test/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Content-Length': 'banana' },
    body: JSON.stringify({ ...REPORT, note: 'x'.repeat(9000) }),
  });
  const res = await handle(request, env(db), deps());
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
});

test('a body that lies by understating its Content-Length is still refused', async () => {
  const db = fakeD1();
  const request = new Request('https://api.test/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Content-Length': '10' },
    body: JSON.stringify({ ...REPORT, note: 'x'.repeat(9000) }),
  });
  const res = await handle(request, env(db), deps());
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
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
