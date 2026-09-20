import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveConfidence, REACTIONS, POSITIVE_REACTIONS } from '../assets/js/confidence.js';

const gift = (over = {}) => ({ id: 'g1', name: 'G', category: 'books', rarity: 'common', ...over });
const character = (over = {}) => ({ id: 'c1', name: 'C', giftable: true, categories: {}, rarityPreference: null, favorites: [], ...over });
const obs = (over = {}) => ({ id: 'o1', gift: 'g1', character: 'c1', reaction: 'liked', points: null, date: '2026-09-20', ...over });

test('no link and no observation is untested', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [] });
  assert.equal(c.state, 'UNTESTED');
  assert.equal(c.predicted, null);
  assert.equal(c.observationCount, 0);
});

test('a profile link with no observation predicts positively and keeps its provenance', () => {
  const character_ = character({ categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [] });
  assert.equal(c.state, 'PREDICTED');
  assert.equal(c.predicted, 'positive');
  assert.equal(c.provenance, 'profile');
});

test('a guide link carries its source so the UI can shade it as weaker', () => {
  const character_ = character({ categories: { books: { state: 'guide', source: 'polygon-2026-09-17' } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [] });
  assert.equal(c.provenance, 'guide');
  assert.equal(c.source, 'polygon-2026-09-17');
});

test('a refuted link predicts negatively', () => {
  const character_ = character({ categories: { books: { state: 'refuted', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [] });
  assert.equal(c.state, 'PREDICTED');
  assert.equal(c.predicted, 'negative');
});

test('a gift with no category can never be predicted', () => {
  const character_ = character({ categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift({ category: null }), observations: [] });
  assert.equal(c.state, 'UNTESTED');
});

test('an observation confirms and reports its reaction and points', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'loved', points: 40 })] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.reaction, 'loved');
  assert.equal(c.points, 40);
  assert.equal(c.observationCount, 1);
});

test('a double-points reaction is a favorite', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'favorite' })] });
  assert.equal(c.state, 'FAVORITE');
});

test('disagreeing observations are contested, not silently resolved', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'loved' }), obs({ id: 'o2', reaction: 'none' })] });
  assert.equal(c.state, 'CONTESTED');
  assert.equal(c.observationCount, 2);
});

test('agreeing observations are not contested', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'liked' }), obs({ id: 'o2', reaction: 'liked' })] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.observationCount, 2);
});

test('an observation contradicting a positive prediction is flagged as an exception', () => {
  const character_ = character({ categories: { horses: { state: 'guide', source: 'polygon-2026-09-17' } } });
  const c = deriveConfidence({ character: character_, gift: gift({ category: 'horses' }), observations: [obs({ reaction: 'none' })] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.reaction, 'none');
  assert.equal(c.isException, true);
});

test('an observation matching its prediction is not an exception', () => {
  const character_ = character({ categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [obs({ reaction: 'liked' })] });
  assert.equal(c.isException, false);
});

test('an off-profile like is an exception against a negative prediction', () => {
  const character_ = character({ categories: { books: { state: 'refuted', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [obs({ reaction: 'loved' })] });
  assert.equal(c.isException, true);
});

test('a rare-only character flags a common gift as a rarity mismatch', () => {
  const character_ = character({ rarityPreference: 'rare', categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift({ rarity: 'common' }), observations: [] });
  assert.equal(c.rarityMismatch, true);
  assert.equal(c.predicted, 'positive', 'rarity is a hint, not a hard gate: it must not flip the prediction');
});

test('uncommon-plus accepts uncommon and rare but not common', () => {
  const c_ = (rarity) => deriveConfidence({
    character: character({ rarityPreference: 'uncommon-plus', categories: { books: { state: 'profile', source: null } } }),
    gift: gift({ rarity }), observations: [],
  }).rarityMismatch;
  assert.equal(c_('common'), true);
  assert.equal(c_('uncommon'), false);
  assert.equal(c_('rare'), false);
});

test('unknown rarity never reports a mismatch', () => {
  const character_ = character({ rarityPreference: 'rare' });
  const c = deriveConfidence({ character: character_, gift: gift({ rarity: null }), observations: [] });
  assert.equal(c.rarityMismatch, false);
});

const CHAR = { id: 'c1', name: 'C', giftable: true, categories: { books: { state: 'guide', source: 's1' } }, rarityPreference: null };
const BOOK = { id: 'book', name: 'Book', category: 'books', rarity: 'common' };
const ROCK = { id: 'rock', name: 'Rock', category: null, rarity: null };
const PENDING_ROW = { id: 'r1', character: 'c1', gift: 'book', reaction: 'loved', points: 40 };

test('a pending report outranks a prediction without becoming a confirmation', () => {
  const c = deriveConfidence({ character: CHAR, gift: BOOK, observations: [], pending: [PENDING_ROW] });
  assert.equal(c.state, 'PENDING');
  assert.equal(c.pendingCount, 1);
  // The four things a pending report must never do.
  assert.equal(c.points, null);
  assert.equal(c.reaction, null);
  assert.equal(c.isException, false);
  assert.equal(c.observationCount, 0);
});

test('a pending report on a pair with no category link is still PENDING', () => {
  const c = deriveConfidence({ character: CHAR, gift: ROCK, observations: [], pending: [{ ...PENDING_ROW, gift: 'rock' }] });
  assert.equal(c.state, 'PENDING');
  assert.equal(c.predicted, null);
});

test('a pending report never downgrades a merged observation', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', points: 20 }];
  const c = deriveConfidence({ character: CHAR, gift: BOOK, observations, pending: [PENDING_ROW] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.points, 20);
  assert.equal(c.pendingCount, 1);
});

test('a pending report claiming a favourite does not make it one', () => {
  const c = deriveConfidence({ character: CHAR, gift: BOOK, observations: [], pending: [{ ...PENDING_ROW, reaction: 'favorite' }] });
  assert.equal(c.state, 'PENDING');
});

test('pending defaults to empty, so every existing caller is unaffected', () => {
  assert.equal(deriveConfidence({ character: CHAR, gift: BOOK, observations: [] }).pendingCount, 0);
});

test('the reaction vocabulary has one definition', () => {
  assert.deepEqual(REACTIONS, ['none', 'slight', 'liked', 'loved', 'favorite']);
  assert.deepEqual(POSITIVE_REACTIONS, REACTIONS.filter((r) => r !== 'none'));
});
