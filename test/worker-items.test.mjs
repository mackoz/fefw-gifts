import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/src/router.js';
import { insertItemReport, listItemReviews, decideItemReport, takeApprovedItems } from '../worker/src/item-reports.js';
import { listPending } from '../worker/src/reports.js';
import { fakeD1 } from '../worker/test-support/fake-d1.mjs';

const ORIGIN = 'https://mackoz.github.io';
const TOKEN = 'a-long-random-admin-token';
const NOW = '2026-09-23T12:00:00.000Z';

const env = (db) => ({ ALLOWED_ORIGINS: ORIGIN, TURNSTILE_SECRET: 'secret', ADMIN_TOKEN: TOKEN, DB: db });

function deps({ verified = true } = {}) {
  const verifications = [];
  return {
    verifications,
    fetch: async (url, init) => {
      verifications.push({ url, init });
      return new Response(JSON.stringify({ success: verified }), { status: 200 });
    },
    now: () => NOW,
    uuid: () => 'item-uuid',
  };
}

// Admin routes must never call out; a call would throw and surface as a 500.
const adminDeps = { fetch: async () => { throw new Error('admin routes must not call out'); }, now: () => NOW, uuid: () => 'item-uuid' };

const post = (path, body) => new Request(`https://api.test${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify(body),
});

const authed = (method, path, body) => new Request(`https://api.test${path}`, {
  method,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const REPORT = {
  name: '  Lantern   Oil ', category: 'horses', categoryLine: null, rarity: 'uncommon',
  character: 'alexandra', reaction: 'loved', turnstileToken: 'tok',
};

// --- POST /item-report ---

test('a verified item report is stored as pending with exactly these values', async () => {
  const db = fakeD1();
  const res = await handle(post('/item-report', REPORT), env(db), deps());
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO item_reports/);
  assert.match(db.calls[0].sql, /'pending'/);
  assert.deepEqual(db.calls[0].params, ['item-uuid', 'Lantern Oil', 'horses', null, 'uncommon', 'alexandra', 'loved', NOW]);
});

test('the response carries the id and status and never echoes the text', async () => {
  const res = await handle(post('/item-report', REPORT), env(fakeD1()), deps());
  const body = await res.text();
  assert.deepEqual(JSON.parse(body), { id: 'item-uuid', status: 'pending' });
  assert.doesNotMatch(body, /Lantern/i);
});

test('a typed line is stored in category_line with a null category', async () => {
  const db = fakeD1();
  await handle(post('/item-report', { ...REPORT, category: null, categoryLine: 'lovers of  lanterns' }), env(db), deps());
  assert.deepEqual(db.calls[0].params.slice(2, 4), [null, 'lovers of lanterns']);
});

test('an item report with no result stores nulls for both halves', async () => {
  const db = fakeD1();
  await handle(post('/item-report', { ...REPORT, character: null, reaction: null, rarity: null }), env(db), deps());
  assert.deepEqual(db.calls[0].params.slice(4, 7), [null, null, null]);
});

test('Turnstile is checked before the item payload, so an invalid body cannot probe the store', async () => {
  const db = fakeD1();
  const res = await handle(post('/item-report', { turnstileToken: 'tok' }), env(db), deps({ verified: false }));
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0);
});

test('the item report verification carries no IP address', async () => {
  const d = deps();
  await handle(post('/item-report', REPORT), env(fakeD1()), d);
  const sent = [...d.verifications[0].init.body].map(([key]) => key).sort();
  assert.deepEqual(sent, ['response', 'secret']);
});

for (const [label, patch, pattern] of [
  ['a bad name', { name: '<b>x</b>' }, /item name/i],
  ['both a category and a typed line', { categoryLine: 'lamp lovers' }, /not both/i],
  ['neither a category nor a typed line', { category: null }, /in-game/i],
  ['a bad category id', { category: 'Horses' }, /category must be a gift-guide id/],
  ['a bad typed line', { category: null, categoryLine: 'x' }, /in-game line/i],
  ['an unknown rarity', { rarity: 'epic' }, /rarity/i],
  ['a character without a reaction', { reaction: null }, /or neither/i],
  ['a reaction without a character', { character: null }, /or neither/i],
  ['a reaction outside the five tiers', { reaction: 'amazing' }, /reaction must be one of/],
]) {
  test(`a verified item report with ${label} is a 400 that stores nothing`, async () => {
    const db = fakeD1();
    const res = await handle(post('/item-report', { ...REPORT, ...patch }), env(db), deps());
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, pattern);
    assert.equal(db.calls.length, 0);
  });
}

test('an oversized item report is refused before it is parsed', async () => {
  const db = fakeD1();
  const res = await handle(post('/item-report', { ...REPORT, padding: 'x'.repeat(9000) }), env(db), deps());
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
});

// --- The public feed is untouched ---

test('listPending never reads item_reports', async () => {
  const db = fakeD1([{ results: [] }]);
  await listPending(db);
  assert.doesNotMatch(db.calls[0].sql, /item_reports/);
});

test('GET /pending issues exactly one statement, against reports only', async () => {
  const db = fakeD1([{ results: [] }]);
  await handle(new Request('https://api.test/pending', { headers: { Origin: ORIGIN } }), env(db), deps());
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM reports/);
  assert.doesNotMatch(db.calls[0].sql, /item_reports/);
});

// --- Store ---

test('insertItemReport binds every column in order', async () => {
  const db = fakeD1();
  await insertItemReport(db, { id: 'i1', name: 'Lantern Oil', category: null, categoryLine: 'lamp lovers', rarity: null, character: null, reaction: null, createdAt: NOW });
  assert.deepEqual(db.calls[0].params, ['i1', 'Lantern Oil', null, 'lamp lovers', null, null, null, NOW]);
});

test('listItemReviews selects pending rows oldest first and never the approved column', async () => {
  const db = fakeD1([{ results: [{ id: 'i1' }] }]);
  assert.deepEqual(await listItemReviews(db), [{ id: 'i1' }]);
  const { sql, params } = db.calls[0];
  const columns = sql.slice(sql.indexOf('SELECT') + 'SELECT'.length, sql.indexOf('FROM')).replace(/\s+/g, ' ').trim();
  assert.equal(columns, 'id, name, category, category_line, rarity, "character" AS character, reaction, status, created_at');
  assert.doesNotMatch(sql, /SELECT \*/);
  assert.match(sql, /FROM item_reports/);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /ORDER BY created_at ASC/);
  assert.doesNotMatch(sql, /approved/);
  assert.deepEqual(params, [200]);
});

test('listItemReviews survives a driver that returns no results array', async () => {
  assert.deepEqual(await listItemReviews(fakeD1([{}])), []);
});

const APPROVE = { decision: 'approve', name: 'Lantern Oil', giftId: null, category: 'horses', newCategory: null, rarity: 'uncommon', includeResult: true };

test('approving stores the approved values, without the decision, on a pending row only', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  assert.equal(await decideItemReport(db, 'i1', APPROVE), true);
  const { sql, params } = db.calls[0];
  assert.match(sql, /SET status = 'approved', approved = \?/);
  assert.match(sql, /AND status = 'pending'/);
  const { decision, ...stored } = APPROVE;
  assert.deepEqual(JSON.parse(params[0]), stored);
  assert.equal(params[1], 'i1');
});

test('rejecting moves a pending row and stores nothing else', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  assert.equal(await decideItemReport(db, 'i1', { decision: 'reject' }), true);
  assert.match(db.calls[0].sql, /SET status = 'rejected'/);
  assert.match(db.calls[0].sql, /AND status = 'pending'/);
  assert.doesNotMatch(db.calls[0].sql, /approved =/);
  assert.deepEqual(db.calls[0].params, ['i1']);
});

test('deciding a row that is no longer pending reports false', async () => {
  assert.equal(await decideItemReport(fakeD1([{ meta: { changes: 0 } }]), 'i1', { decision: 'reject' }), false);
});

test('decideItemReport refuses a decision it does not know', async () => {
  await assert.rejects(() => decideItemReport(fakeD1(), 'i1', { decision: 'maybe' }), /unknown item decision/);
});

test('takeApprovedItems parses the approval and marks every row ingested', async () => {
  const rows = [
    { id: 'a', approved: JSON.stringify({ name: 'Lantern Oil' }), character: null, reaction: null, created_at: NOW },
    { id: 'b', approved: '{not json', character: 'alexandra', reaction: 'loved', created_at: NOW },
  ];
  const db = fakeD1([{ results: rows }, { meta: { changes: 2 } }]);
  const items = await takeApprovedItems(db);
  assert.deepEqual(items.map((item) => item.approved), [{ name: 'Lantern Oil' }, null]);
  assert.match(db.calls[0].sql, /status = 'approved'/);
  assert.deepEqual(db.calls[0].params, [200]);
  assert.match(db.calls[1].sql, /UPDATE item_reports SET status = 'ingested' WHERE id IN \(\?, \?\)/);
  assert.deepEqual(db.calls[1].params, ['a', 'b']);
});

test('takeApprovedItems issues no update when there is nothing to take', async () => {
  const db = fakeD1([{ results: [] }]);
  assert.deepEqual(await takeApprovedItems(db), []);
  assert.equal(db.calls.length, 1);
});

// --- Admin routes ---

test('the item review queue comes back uncached and without calling out', async () => {
  const rows = [{ id: 'i1', name: 'Lantern Oil', category: 'horses', category_line: null, rarity: null, character: null, reaction: null, status: 'pending', created_at: NOW }];
  const res = await handle(authed('GET', '/item-review'), env(fakeD1([{ results: rows }])), adminDeps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reports: rows });
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('approving an item report echoes the new status', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  const res = await handle(authed('POST', '/item-review/i1', APPROVE), env(db), adminDeps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: 'i1', status: 'approved' });
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('rejecting an item report echoes rejected', async () => {
  const res = await handle(authed('POST', '/item-review/i1', { decision: 'reject' }), env(fakeD1([{ meta: { changes: 1 } }])), adminDeps);
  assert.deepEqual(await res.json(), { id: 'i1', status: 'rejected' });
});

test('deciding an item report twice is a 404', async () => {
  const res = await handle(authed('POST', '/item-review/i1', { decision: 'reject' }), env(fakeD1([{ meta: { changes: 0 } }])), adminDeps);
  assert.equal(res.status, 404);
});

test('an invalid approval is a 400 that touches nothing', async () => {
  for (const body of [
    { ...APPROVE, giftId: 'horse-grooming-kit' },
    { ...APPROVE, includeResult: 'yes' },
    { decision: 'maybe' },
    { decision: '__proto__' },
    null,
  ]) {
    const db = fakeD1();
    const res = await handle(authed('POST', '/item-review/i1', body ?? undefined), env(db), adminDeps);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(db.calls.length, 0, JSON.stringify(body));
  }
});

test('a slash-smuggling item id never reaches the store', async () => {
  const db = fakeD1();
  const res = await handle(authed('POST', '/item-review/a%2Fb', { decision: 'reject' }), env(db), adminDeps);
  assert.notEqual(res.status, 200);
  assert.equal(db.calls.length, 0);
});

test('ingest-items hands over the approved rows and marks them, uncached', async () => {
  const db = fakeD1([{ results: [{ id: 'a', approved: '{"name":"Lantern Oil"}', character: null, reaction: null, created_at: NOW }] }, { meta: { changes: 1 } }]);
  const res = await handle(authed('POST', '/ingest-items'), env(db), adminDeps);
  assert.deepEqual(await res.json(), { items: [{ id: 'a', approved: { name: 'Lantern Oil' }, character: null, reaction: null, created_at: NOW }] });
  assert.match(db.calls[1].sql, /SET status = 'ingested'/);
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

// The missing-token case for these three routes is covered by the extended
// loop in test/worker-admin.test.mjs (per controller ruling P4). Only the
// wrong-token case is pinned here, so nothing is duplicated between the files.
test('the item admin routes refuse a wrong token', async () => {
  for (const [method, path] of [['GET', '/item-review'], ['POST', '/item-review/i1'], ['POST', '/ingest-items']]) {
    const wrong = new Request(`https://api.test${path}`, { method, headers: { Authorization: `Bearer ${'b'.repeat(TOKEN.length)}` } });
    assert.equal((await handle(wrong, env(fakeD1()), adminDeps)).status, 401, `${method} ${path} with a wrong token`);
  }
});
