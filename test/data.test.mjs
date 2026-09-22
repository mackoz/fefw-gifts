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
