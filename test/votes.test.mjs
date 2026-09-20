import { test } from 'node:test';
import assert from 'node:assert/strict';
import { votedDirection, recordVote, readVotes } from '../assets/js/votes.js';
import { voteControlModel } from '../assets/js/vote-control.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
}

const hostileStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

const REPORT = { id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved' };

test('a browser that has not voted has no recorded direction', () => {
  assert.equal(votedDirection(fakeStorage(), 'r1'), null);
});

test('a vote is remembered and can be read back', () => {
  const storage = fakeStorage();
  recordVote(storage, 'r1', 'up');
  assert.equal(votedDirection(storage, 'r1'), 'up');
  assert.equal(votedDirection(storage, 'r2'), null);
});

test('a second vote on the same report replaces the first', () => {
  const storage = fakeStorage();
  recordVote(storage, 'r1', 'up');
  recordVote(storage, 'r1', 'down');
  assert.equal(votedDirection(storage, 'r1'), 'down');
});

test('storage that throws or holds junk degrades to "not voted"', () => {
  assert.equal(votedDirection(hostileStorage, 'r1'), null);
  assert.doesNotThrow(() => recordVote(hostileStorage, 'r1', 'up'));
  assert.deepEqual(readVotes(fakeStorage({ 'fefw-gifts-votes': 'not json' })), {});
  assert.deepEqual(readVotes(fakeStorage({ 'fefw-gifts-votes': 'null' })), {});
  assert.deepEqual(readVotes(undefined), {});
});

test('the control asks a question before a vote and thanks after', () => {
  const before = voteControlModel(REPORT, fakeStorage());
  assert.equal(before.voted, false);
  assert.match(before.prompt, /\?$/);

  const storage = fakeStorage();
  recordVote(storage, 'r1', 'down');
  const after = voteControlModel(REPORT, storage);
  assert.equal(after.voted, true);
  assert.equal(after.direction, 'down');
  assert.match(after.prompt, /thanks/i);
});

// The constraint the whole voting design rests on. If this fails, a tally has
// leaked onto the public site.
test('no tally reaches the model, even when the row is carrying one', () => {
  const model = voteControlModel({ ...REPORT, upvotes: 42, downvotes: 7 }, fakeStorage());
  assert.equal(JSON.stringify(model).includes('42'), false);
  assert.equal(JSON.stringify(model).includes('upvotes'), false);
  assert.doesNotMatch(model.prompt, /\d/);
});
