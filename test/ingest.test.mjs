import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toObservation, mergeObservations } from '../scripts/ingest.mjs';

const ROW = {
  id: '9f1c2f7a-0000-4000-8000-000000000001',
  character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  points: 40, note: 'rides an ornius', created_at: '2026-09-20T09:30:00.000Z',
};

test('a report becomes an observation in the documented shape', () => {
  assert.deepEqual(toObservation(ROW), {
    id: '9f1c2f7a-0000-4000-8000-000000000001',
    gift: 'grooming-kit',
    character: 'nydine',
    reaction: 'loved',
    points: 40,
    date: '2026-09-20',
  });
});

// The privacy rule, asserted rather than trusted.
test('nothing identifying and no free text survives the conversion', () => {
  const observation = toObservation({ ...ROW, reporter: 'someone', ip: '1.2.3.4', email: 'a@b.test' });
  for (const field of ['note', 'reporter', 'ip', 'email', 'user', 'author', 'submitter', 'upvotes', 'downvotes', 'status']) {
    assert.ok(!(field in observation), `${field} must not survive ingest`);
  }
});

test('a missing points value becomes null, not undefined', () => {
  const observation = toObservation({ ...ROW, points: undefined });
  assert.equal(observation.points, null);
  assert.ok('points' in observation);
});

test('rows are appended and the added ones are reported', () => {
  const { observations, added } = mergeObservations([{ id: 'old' }], [ROW]);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].id, 'old');
  assert.equal(added.length, 1);
});

test('a row already in the file is not appended twice', () => {
  const existing = [toObservation(ROW)];
  const { observations, added } = mergeObservations(existing, [ROW]);
  assert.equal(observations.length, 1);
  assert.deepEqual(added, []);
});

test('a duplicate inside one batch is only taken once', () => {
  const { added } = mergeObservations([], [ROW, ROW]);
  assert.equal(added.length, 1);
});

test('nothing to ingest leaves the file untouched', () => {
  const existing = [{ id: 'old' }];
  const { observations, added } = mergeObservations(existing, []);
  assert.deepEqual(observations, existing);
  assert.deepEqual(added, []);
});
