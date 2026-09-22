import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { characterRows } from '../assets/js/views/character.js';
import { sortByConfidence, stateLabel, partitionRows, categoryChips } from '../assets/js/views/shared.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { giftRows } from '../assets/js/views/gift.js';

const dataset = {
  categories: [
    { id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] },
    { id: 'coffee', label: 'Coffee', inGameDescriptor: null, aliases: [] },
  ],
  gifts: [
    { id: 'book', name: 'Book', category: 'books', rarity: 'common', description: '', sources: [] },
    { id: 'brew', name: 'Brew', category: 'coffee', rarity: 'common', description: '', sources: [] },
    { id: 'rock', name: 'Rock', category: null, rarity: null, description: '', sources: [] },
  ],
  characters: [{
    id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [],
    categories: { books: { state: 'profile', source: null } },
    rarityPreference: null, favorites: [], notes: null,
  }],
  observations: [{ id: 'o1', gift: 'brew', character: 'c1', reaction: 'favorite', date: '2026-09-20' }],
  sources: [],
};

test('favorites sort above predictions, which sort above untested', () => {
  const idx = buildIndex(dataset);
  const rows = characterRows(idx, 'c1', DEFAULT_FILTERS);
  assert.deepEqual(rows.map((r) => r.gift.id), ['brew', 'book', 'rock']);
});

test('every gift appears when no filter is applied', () => {
  const idx = buildIndex(dataset);
  assert.equal(characterRows(idx, 'c1', DEFAULT_FILTERS).length, 3);
});

test('hideUntested drops the uncategorised gift', () => {
  const idx = buildIndex(dataset);
  const rows = characterRows(idx, 'c1', { ...DEFAULT_FILTERS, hideUntested: true });
  assert.deepEqual(rows.map((r) => r.gift.id), ['brew', 'book']);
});

test('state labels never describe an untested pair as disliked', () => {
  for (const state of ['UNTESTED', 'PREDICTED', 'CONFIRMED', 'FAVORITE', 'CONTESTED']) {
    assert.doesNotMatch(stateLabel({ state, reaction: null }), /dislike|hates|bad gift/i);
  }
});

test('sortByConfidence is stable for equal states', () => {
  const rows = [
    { gift: { id: 'a' }, confidence: { state: 'PREDICTED' } },
    { gift: { id: 'b' }, confidence: { state: 'PREDICTED' } },
  ];
  assert.deepEqual(sortByConfidence(rows).map((r) => r.gift.id), ['a', 'b']);
});

test('giftRows lists giftable characters ranked by confidence', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [
      dataset.characters[0],
      { id: 'c2', name: 'D', giftable: true, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
      { id: 'c3', name: 'E', giftable: false, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
    ],
  });
  const rows = giftRows(idx, 'book', DEFAULT_FILTERS);
  assert.deepEqual(rows.map((r) => r.character.id), ['c1', 'c2'], 'non-giftable characters are excluded');
  assert.equal(rows[0].confidence.state, 'PREDICTED');
});

import { matrixModel, SYMBOL } from '../assets/js/views/matrix.js';

test('the matrix excludes non-giftable characters and keeps every gift by default', () => {
  const idx = buildIndex(dataset);
  const m = matrixModel(idx, DEFAULT_FILTERS, '');
  assert.deepEqual(m.characters.map((c) => c.id), ['c1']);
  assert.equal(m.gifts.length, 3);
  assert.equal(m.cellAt('brew', 'c1').state, 'FAVORITE');
});

test('hideUntested drops gift rows where no character has any signal', () => {
  const idx = buildIndex(dataset);
  const m = matrixModel(idx, { ...DEFAULT_FILTERS, hideUntested: true }, '');
  assert.deepEqual(m.gifts.map((g) => g.id), ['book', 'brew'], 'the uncategorised gift row is dropped');
});

test('search narrows the gift rows', () => {
  const idx = buildIndex(dataset);
  const m = matrixModel(idx, DEFAULT_FILTERS, 'brew');
  assert.deepEqual(m.gifts.map((g) => g.id), ['brew']);
});

import { favoritesModel } from '../assets/js/views/favorites.js';

test('a character with a confirmed favourite is listed as found', () => {
  const idx = buildIndex(dataset);
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.found.map((f) => f.character.id), ['c1']);
  assert.deepEqual(m.found[0].gifts.map((g) => g.id), ['brew']);
  assert.equal(m.unknown.length, 0);
});

test('a character with no favourite is listed as unknown with suggestions from liked categories', () => {
  const idx = buildIndex({ ...dataset, observations: [] });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.unknown.map((u) => u.character.id), ['c1']);
  assert.deepEqual(m.unknown[0].suggestions.map((g) => g.id), ['book'], 'only untested gifts in predicted categories');
});

test('suggestions rank rare items first', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [],
    gifts: [
      { id: 'cheap', name: 'Cheap Book', category: 'books', rarity: 'common', description: '', sources: [] },
      { id: 'posh', name: 'Posh Book', category: 'books', rarity: 'rare', description: '', sources: [] },
    ],
  });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.unknown[0].suggestions.map((g) => g.id), ['posh', 'cheap']);
});

test('a declared favorite counts as found even with no observation', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [],
    characters: [{ ...dataset.characters[0], favorites: ['book'] }],
  });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.found.map((f) => f.character.id), ['c1']);
  assert.deepEqual(m.found[0].gifts.map((g) => g.id), ['book']);
  assert.equal(m.unknown.length, 0);
});

test('found gifts are the union of observed and declared favourites, deduplicated', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], favorites: ['brew', 'book'] }],
  });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  // 'brew' is both observed FAVORITE and declared: it must appear exactly once.
  assert.deepEqual(m.found[0].gifts.map((g) => g.id), ['brew', 'book']);
});

test('an unknown gift id in favorites is ignored rather than crashing', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [],
    characters: [{ ...dataset.characters[0], favorites: ['no-such-gift'] }],
  });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.unknown.map((u) => u.character.id), ['c1']);
});

import { detailStatus } from '../assets/js/views/character.js';

test('the character detail route reports why it cannot show a gift table', () => {
  const giftable = { id: 'c1', name: 'C', giftable: true, spoiler: false };
  assert.equal(detailStatus(undefined, DEFAULT_FILTERS), 'missing', 'a mistyped id must not dereference');
  assert.equal(detailStatus(giftable, DEFAULT_FILTERS), 'ok');
  assert.equal(
    detailStatus({ ...giftable, giftable: false }, DEFAULT_FILTERS),
    'not-giftable',
    'a character who cannot receive gifts gets no gift table',
  );
  assert.equal(
    detailStatus({ ...giftable, spoiler: true }, DEFAULT_FILTERS),
    'hidden-spoiler',
    'hideSpoilers applies on the detail route, not just the picker',
  );
  assert.equal(detailStatus({ ...giftable, spoiler: true }, { ...DEFAULT_FILTERS, hideSpoilers: false }), 'ok');
});

test('pending sorts below contested and above predicted', () => {
  const rows = ['PREDICTED', 'UNTESTED', 'PENDING', 'CONTESTED', 'CONFIRMED', 'FAVORITE']
    .map((state) => ({ confidence: { state } }));
  assert.deepEqual(
    sortByConfidence(rows).map((r) => r.confidence.state),
    ['FAVORITE', 'CONFIRMED', 'CONTESTED', 'PENDING', 'PREDICTED', 'UNTESTED'],
  );
});

test('a pending pair is labelled as awaiting review, never as confirmed', () => {
  const label = stateLabel({ state: 'PENDING' });
  assert.match(label, /awaiting review/i);
  assert.doesNotMatch(label, /confirmed|dislike/i);
});

test('the matrix has a symbol for pending that no other state uses', () => {
  assert.ok(SYMBOL.PENDING);
  const used = Object.values(SYMBOL).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
});

const OVERLAY_DATASET = {
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [{ id: 'book', name: 'Book', category: 'books', rarity: 'common', description: '', sources: [] }],
  characters: [{ id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null }],
  observations: [],
  sources: [],
};

test('a pending report reaches confidenceFor through the index', () => {
  const idx = buildIndex(OVERLAY_DATASET, [{ id: 'r1', character: 'c1', gift: 'book', reaction: 'loved' }]);
  assert.equal(idx.confidenceFor('c1', 'book').state, 'PENDING');
  assert.deepEqual(idx.pendingFor('c1', 'book').map((r) => r.id), ['r1']);
  assert.deepEqual(idx.pendingFor('c1', 'nothing'), []);
});

test('an index built without an overlay behaves exactly as before', () => {
  const idx = buildIndex(OVERLAY_DATASET);
  assert.equal(idx.confidenceFor('c1', 'book').state, 'UNTESTED');
  assert.deepEqual(idx.pendingFor('c1', 'book'), []);
});

test('a pending favourite report does not close a favourites-hunt slot', () => {
  const idx = buildIndex(OVERLAY_DATASET, [{ id: 'r1', character: 'c1', gift: 'book', reaction: 'favorite' }]);
  const { found, unknown } = favoritesModel(idx, DEFAULT_FILTERS);
  assert.equal(found.length, 0);
  assert.equal(unknown.length, 1);
});

test('partitionRows splits signal from untested and preserves order', () => {
  const rows = [
    { gift: { id: 'a' }, confidence: { state: 'FAVORITE' } },
    { gift: { id: 'b' }, confidence: { state: 'PREDICTED' } },
    { gift: { id: 'c' }, confidence: { state: 'UNTESTED' } },
    { gift: { id: 'd' }, confidence: { state: 'PENDING' } },
    { gift: { id: 'e' }, confidence: { state: 'UNTESTED' } },
  ];
  const { signal, untested } = partitionRows(rows);
  assert.deepEqual(signal.map((r) => r.gift.id), ['a', 'b', 'd']);
  assert.deepEqual(untested.map((r) => r.gift.id), ['c', 'e']);
});

test('partitionRows on an all-untested character yields an empty signal half', () => {
  const rows = [{ gift: { id: 'a' }, confidence: { state: 'UNTESTED' } }];
  const { signal, untested } = partitionRows(rows);
  assert.deepEqual(signal, []);
  assert.equal(untested.length, 1);
});

test('categoryChips resolves labels and drops refuted links', () => {
  const idx = buildIndex(dataset);
  const character = {
    categories: {
      books: { state: 'guide', source: 'polygon' },
      coffee: { state: 'refuted', source: 'polygon' },
    },
  };
  const chips = categoryChips(idx, character);
  // A refuted link is not a like -- it must never render as one.
  assert.deepEqual(chips.map((c) => c.id), ['books']);
  assert.equal(chips[0].label, 'Books');
  assert.equal(chips[0].state, 'guide');
});

test('categoryChips falls back to the raw id rather than inventing a label', () => {
  const idx = buildIndex(dataset);
  const chips = categoryChips(idx, { categories: { unknown: { state: 'guide', source: null } } });
  assert.equal(chips[0].label, 'unknown');
});

test('categoryChips tolerates a character with no categories key', () => {
  const idx = buildIndex(dataset);
  assert.deepEqual(categoryChips(idx, {}), []);
});
