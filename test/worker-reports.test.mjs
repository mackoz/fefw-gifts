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

// Unmoderated free text from an anonymous submitter: it must never reach the
// public feed, so it must never even be selected.
test('listPending never selects the note column either', async () => {
  const db = fakeD1([{ results: [{ id: 'r1' }] }]);
  await listPending(db);
  assert.doesNotMatch(db.calls[0].sql, /\bnote\b/);
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
