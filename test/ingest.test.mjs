import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toObservation, mergeObservations, skippedRowWarning } from '../scripts/ingest.mjs';

const ROW = {
  id: '9f1c2f7a-0000-4000-8000-000000000001',
  character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  created_at: '2026-09-20T09:30:00.000Z',
};

test('a report becomes an observation in the documented shape', () => {
  assert.deepEqual(toObservation(ROW), {
    id: '9f1c2f7a-0000-4000-8000-000000000001',
    gift: 'grooming-kit',
    character: 'nydine',
    reaction: 'loved',
    date: '2026-09-20',
  });
});

// The privacy rule, asserted rather than trusted.
test('nothing identifying and no free text survives the conversion', () => {
  const observation = toObservation({ ...ROW, reporter: 'someone', ip: '1.2.3.4', email: 'a@b.test' });
  for (const field of ['note', 'points', 'reporter', 'ip', 'email', 'user', 'author', 'submitter', 'upvotes', 'downvotes', 'status']) {
    assert.ok(!(field in observation), `${field} must not survive ingest`);
  }
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

// A NULL id can never be matched by the Worker's `UPDATE ... WHERE id IN (...)`,
// so it stays `approved` and is returned every night -- see the comment above
// mergeObservations(). It must not stall the good rows in the same batch.
test('a row with a null id is set aside, not merged, and does not block a good row', () => {
  const badRow = { ...ROW, id: null };
  const { observations, added, skipped } = mergeObservations([], [badRow, ROW]);
  assert.deepEqual(added, [toObservation(ROW)]);
  assert.deepEqual(skipped, [badRow]);
  assert.deepEqual(observations, [toObservation(ROW)]);
});

for (const [label, apply] of [
  ['missing', (row) => { const { id, ...rest } = row; return rest; }],
  ['an empty string', (row) => ({ ...row, id: '' })],
  ['a number', (row) => ({ ...row, id: 7 })],
]) {
  test(`a row whose id is ${label} is set aside, not merged, and does not block a good row`, () => {
    const badRow = apply(ROW);
    const { observations, added, skipped } = mergeObservations([], [badRow, ROW]);
    assert.deepEqual(added, [toObservation(ROW)]);
    assert.deepEqual(skipped, [badRow]);
    assert.deepEqual(observations, [toObservation(ROW)]);
  });
}

test('a batch where every row is skipped adds nothing and leaves existing untouched', () => {
  const existing = [{ id: 'old' }];
  const badRow = { ...ROW, id: null };
  const { observations, added, skipped } = mergeObservations(existing, [badRow]);
  assert.deepEqual(added, []);
  assert.deepEqual(skipped, [badRow]);
  assert.deepEqual(observations, existing);
});

test('skippedRowWarning escapes %, \\r and \\n in interpolated fields, leaving no raw newline', () => {
  const row = { character: '100%\nnydine\r', gift: 'grooming-kit', created_at: '2026-09-20T09:30:00.000Z' };
  const warning = skippedRowWarning(row);
  assert.ok(!warning.includes('\n'), 'result must contain no raw newline');
  assert.ok(!warning.includes('\r'), 'result must contain no raw carriage return');
  assert.ok(warning.includes('100%25%0Anydine%0D'));
  assert.match(warning, /^::warning title=Report skipped::/);
});
