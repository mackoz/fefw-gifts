import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { loadDataset } from '../scripts/validate.mjs';

const dataset = {
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [{ id: 'g1', name: 'Book', category: 'books', rarity: 'common', description: '', sources: [] }],
  characters: [{ id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [], categories: { books: { state: 'profile', source: null } }, rarityPreference: null, favorites: [], notes: null }],
  observations: [{ id: 'o1', gift: 'g1', character: 'c1', reaction: 'loved', date: '2026-09-20' }],
  sources: [],
};

test('lookups resolve entities by id', () => {
  const idx = buildIndex(dataset);
  assert.equal(idx.byCharacterId.get('c1').name, 'C');
  assert.equal(idx.byGiftId.get('g1').name, 'Book');
  assert.equal(idx.byCategoryId.get('books').label, 'Books');
});

test('observationsFor returns only the matching pair', () => {
  const idx = buildIndex(dataset);
  assert.equal(idx.observationsFor('c1', 'g1').length, 1);
  assert.equal(idx.observationsFor('c1', 'nope').length, 0);
});

test('confidenceFor wires the pair through deriveConfidence', () => {
  const idx = buildIndex(dataset);
  const c = idx.confidenceFor('c1', 'g1');
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.reaction, 'loved');
});

test('the real committed dataset builds and derives without throwing', async () => {
  const idx = buildIndex(await loadDataset('data'));
  assert.ok(idx.characters.length > 0, 'expected characters');
  assert.ok(idx.gifts.length > 0, 'expected gifts');
  for (const ch of idx.characters) {
    for (const g of idx.gifts) assert.ok(idx.confidenceFor(ch.id, g.id).state);
  }
});

// Two gifts sharing a category, two characters: buildIndex must derive loved
// categories per (character, gift) pair from `observations` only, and pass
// them into confidenceFor as a play link -- never mutating character.categories.
const lovedDataset = (over = {}) => ({
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [
    { id: 'a', name: 'A', category: 'books', rarity: 'common', description: '', sources: [] },
    { id: 'b', name: 'B', category: 'books', rarity: 'common', description: '', sources: [] },
  ],
  characters: [
    { id: 'c1', name: 'C1', giftable: true, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
    { id: 'c2', name: 'C2', giftable: true, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
  ],
  observations: [],
  sources: [],
  ...over,
});

test('a loved result on one gift predicts the rest of its category through play, for that character only', () => {
  const idx = buildIndex(lovedDataset({ observations: [{ id: 'o1', gift: 'a', character: 'c1', reaction: 'loved', date: '2026-09-20' }] }));
  const b = idx.confidenceFor('c1', 'b');
  assert.equal(b.state, 'PREDICTED');
  assert.equal(b.predicted, 'positive');
  assert.equal(b.provenance, 'discovered');
  assert.equal(b.source, null);
  assert.equal(idx.confidenceFor('c2', 'b').state, 'UNTESTED');
});

test('a favourite reaction never makes a play link -- a favourite is about the item', () => {
  const idx = buildIndex(lovedDataset({ observations: [{ id: 'o1', gift: 'a', character: 'c1', reaction: 'favorite', date: '2026-09-20' }] }));
  assert.equal(idx.confidenceFor('c1', 'b').state, 'UNTESTED');
});

test('a below-loved reaction never makes a play link', () => {
  for (const reaction of ['liked', 'slight', 'none']) {
    const idx = buildIndex(lovedDataset({ observations: [{ id: 'o1', gift: 'a', character: 'c1', reaction, date: '2026-09-20' }] }));
    assert.equal(idx.confidenceFor('c1', 'b').state, 'UNTESTED', reaction);
  }
});

test('a contested pair never makes a play link', () => {
  const idx = buildIndex(lovedDataset({
    observations: [
      { id: 'o1', gift: 'a', character: 'c1', reaction: 'loved', date: '2026-09-20' },
      { id: 'o2', gift: 'a', character: 'c1', reaction: 'slight', date: '2026-09-21' },
    ],
  }));
  assert.equal(idx.confidenceFor('c1', 'a').state, 'CONTESTED');
  assert.equal(idx.confidenceFor('c1', 'b').state, 'UNTESTED');
});

test('a pending loved report never makes a play link', () => {
  const idx = buildIndex(lovedDataset(), [{ id: 'p1', character: 'c1', gift: 'a', reaction: 'loved' }]);
  assert.equal(idx.confidenceFor('c1', 'a').state, 'PENDING');
  assert.equal(idx.confidenceFor('c1', 'b').state, 'UNTESTED');
});

test('buildIndex never writes a play link back into character.categories', () => {
  const ds = lovedDataset({ observations: [{ id: 'o1', gift: 'a', character: 'c1', reaction: 'loved', date: '2026-09-20' }] });
  const before = structuredClone(ds.characters.find((c) => c.id === 'c1').categories);
  const idx = buildIndex(ds);
  idx.confidenceFor('c1', 'b');
  idx.confidenceFor('c1', 'a');
  assert.deepEqual(idx.byCharacterId.get('c1').categories, before);
});
