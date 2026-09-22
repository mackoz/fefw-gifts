import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../scripts/validate.mjs';

const base = () => ({
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [],
  characters: [],
  observations: [],
  sources: [{ id: 's1', title: 'T', author: null, publisher: 'P', url: 'https://e.x', retrieved: '2026-09-20' }],
});

test('a minimal valid dataset produces no errors', () => {
  assert.deepEqual(validate(base()).errors, []);
});

test('duplicate category ids are rejected', () => {
  const d = base();
  d.categories.push({ id: 'books', label: 'Books again', inGameDescriptor: null, aliases: [] });
  const { errors } = validate(d);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate category id: books/);
});

test('duplicate source ids are rejected', () => {
  const d = base();
  d.sources.push({ id: 's1', title: 'T2', author: null, publisher: 'P', url: 'https://e.y', retrieved: '2026-09-20' });
  const { errors } = validate(d);
  assert.match(errors[0], /duplicate source id: s1/);
});

test('a category missing its label is rejected', () => {
  const d = base();
  d.categories.push({ id: 'coffee', inGameDescriptor: null, aliases: [] });
  const { errors } = validate(d);
  assert.match(errors[0], /category coffee: missing label/);
});

test('observations must not carry identifying fields', () => {
  const d = base();
  d.observations.push({ id: 'o1', gift: 'g', character: 'c', reaction: 'liked', date: '2026-09-20', reporter: 'someone' });
  const { errors } = validate(d);
  assert.ok(errors.some((e) => /forbidden identifying field: reporter/.test(e)));
});

test('a gift referencing an unknown category is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'nope', rarity: 'common', description: '', sources: [] });
  const { errors } = validate(d);
  assert.match(errors[0], /gift g1: unknown category: nope/);
});

test('a gift with a null category is allowed as not yet recorded', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: null, rarity: null, description: '', sources: [] });
  assert.deepEqual(validate(d).errors, []);
});

test('an invalid rarity is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: 'legendary', description: '', sources: [] });
  const { errors } = validate(d);
  assert.match(errors[0], /gift g1: invalid rarity: legendary/);
});

test('a gift referencing an unknown source is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: 'rare', description: '', sources: ['ghost'] });
  const { errors } = validate(d);
  assert.match(errors[0], /gift g1: unknown source: ghost/);
});

test('duplicate gift ids are rejected', () => {
  const d = base();
  const g = { id: 'g1', name: 'G', category: 'books', rarity: 'rare', description: '', sources: [] };
  d.gifts.push(g, { ...g, name: 'G2' });
  const { errors } = validate(d);
  assert.ok(errors.some((e) => /duplicate gift id: g1/.test(e)));
});

const character = (over = {}) => ({
  id: 'c1', name: 'C', giftable: true, spoiler: false,
  traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null, ...over,
});

test('a character category link with an unknown category is rejected', () => {
  const d = base();
  d.characters.push(character({ categories: { nope: { state: 'profile', source: null } } }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: unknown category: nope/);
});

test('a guide-state link without a source is rejected', () => {
  const d = base();
  d.characters.push(character({ categories: { books: { state: 'guide', source: null } } }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: category books has state "guide" but no source/);
});

test('an invalid link state is rejected', () => {
  const d = base();
  d.characters.push(character({ categories: { books: { state: 'maybe', source: null } } }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: invalid state for books: maybe/);
});

test('a trait may name a valid category or be explicitly null', () => {
  const d = base();
  d.characters.push(character({ traits: [{ text: 'poetry', category: 'books' }, { text: 'his little sister', category: null }] }));
  assert.deepEqual(validate(d).errors, []);
});

test('a trait naming an unknown category is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: [{ text: 'x', category: 'nope' }] }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: trait "x" names unknown category: nope/);
});

test('a favorite referencing an unknown gift is rejected', () => {
  const d = base();
  d.characters.push(character({ favorites: ['ghost-gift'] }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: unknown favorite gift: ghost-gift/);
});

test('a character with no traits key is rejected', () => {
  const d = base();
  const c = character();
  delete c.traits;
  d.characters.push(c);
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: traits must be an array']);
});

test('a character with an empty traits array produces no error', () => {
  const d = base();
  d.characters.push(character({ traits: [] }));
  assert.deepEqual(validate(d).errors, []);
});

test('a character whose traits is not an array is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: 'x' }));
  const { errors } = validate(d);
  // The redundant `?? []` at :77 is deliberately left in place (see the fix
  // brief), so a non-array, non-nullish `traits` like a string still gets
  // iterated character-by-character and may add further errors of its own.
  // What matters here is that the new check still fires.
  assert.ok(errors.includes('character c1: traits must be an array'));
});

test('an invalid rarityPreference is rejected', () => {
  const d = base();
  d.characters.push(character({ rarityPreference: 'shiny' }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: invalid rarityPreference: shiny/);
});

test('an observation against a non-giftable character is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: null, description: '', sources: [] });
  d.characters.push(character({ giftable: false }));
  d.observations.push({ id: 'o1', gift: 'g1', character: 'c1', reaction: 'liked', date: '2026-09-20' });
  const { errors } = validate(d);
  assert.match(errors[0], /observation o1: character c1 is not giftable/);
});

test('an observation with an unknown gift or invalid reaction is rejected', () => {
  const d = base();
  d.characters.push(character());
  d.observations.push({ id: 'o1', gift: 'ghost', character: 'c1', reaction: 'meh', date: '2026-09-20' });
  const { errors } = validate(d);
  assert.ok(errors.some((e) => /observation o1: unknown gift: ghost/.test(e)));
  assert.ok(errors.some((e) => /observation o1: invalid reaction: meh/.test(e)));
});
