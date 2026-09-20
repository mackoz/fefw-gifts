import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toObservation, mergeObservations, formatNotes } from '../scripts/ingest.mjs';

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

// formatNotes() feeds $GITHUB_OUTPUT, where a stray newline or a line matching
// the heredoc delimiter would let contributor text inject workflow outputs.
// The random per-write delimiter in report() is the actual defence; these
// tests pin the second layer: a note must never contribute a line of its own.
test("a note's embedded newlines never survive into the output", () => {
  const rows = [{ ...ROW, note: 'line one\nline two\r\nline three\tindented' }];
  const result = formatNotes(rows);
  const lines = result.split('\n');
  assert.equal(lines.length, 1, 'a single note must produce exactly one output line');
  assert.ok(!result.includes('\n\n'));
});

test('a note that contains the literal delimiter text cannot produce a line equal to it', () => {
  const rows = [{ ...ROW, note: 'NOTES_EOF' }];
  const result = formatNotes(rows);
  const lines = result.split('\n');
  for (const line of lines) {
    assert.notEqual(line, 'NOTES_EOF', 'the character/gift prefix must keep every line from matching a bare delimiter');
  }
});

test('rows without a note are skipped, and an empty input produces an empty string', () => {
  assert.equal(formatNotes([]), '');
  assert.equal(formatNotes([{ ...ROW, note: undefined }, { ...ROW, note: '' }]), '');
});
