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

// `categories` is a map, not a list: Array.isArray would accept `[]` here,
// which is wrong-shaped for a map of category id to link, so the check must
// reject arrays too, not just non-objects.
for (const [label, value] of [['a number', 7], ['a boolean', true], ['an array', []]]) {
  test(`a character whose categories is ${label} is rejected`, () => {
    const d = base();
    d.characters.push(character({ categories: value }));
    const { errors } = validate(d);
    assert.deepEqual(errors, ['character c1: categories must be an object']);
  });
}

test('a character with no categories key is rejected', () => {
  const d = base();
  const c = character();
  delete c.categories;
  d.characters.push(c);
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: categories must be an object']);
});

test('a null category link is reported, not fatal', () => {
  const d = base();
  d.characters.push(character({ categories: { books: null } }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: category books link must be an object']);
});

test('a non-object category link is reported, not fatal', () => {
  const d = base();
  d.characters.push(character({ categories: { books: 'not a link' } }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: category books link must be an object']);
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

test('a null trait entry is reported, not fatal', () => {
  const d = base();
  d.characters.push(character({ traits: [null] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: trait entries must be objects']);
});

test('a non-object trait entry is reported, not fatal', () => {
  const d = base();
  d.characters.push(character({ traits: ['x'] }));
  const { errors } = validate(d);
  // Before the shape check this reported `trait "undefined" names unknown
  // category: undefined`, which named neither the entry nor a fixable cause.
  assert.deepEqual(errors, ['character c1: trait entries must be objects']);
});

test('a trait with no text is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: [{ category: null }] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: trait is missing text']);
});

test('a trait with empty text is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: [{ text: '', category: null }] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: trait is missing text']);
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
  // Exactly one error: the bad value is reported and then not iterated. A
  // string used to be walked character-by-character, inventing further errors
  // about traits that were never in the data.
  assert.deepEqual(errors, ['character c1: traits must be an array']);
});

// A wrong-typed list field must be REPORTED, not fatal. `?? []` guards only
// null and undefined, so an object or a number is not nullish and reached
// for...of, throwing a TypeError: the validator died with a stack trace and
// printed none of the errors it had already collected. CI still failed, so
// nothing invalid could deploy, but whoever had to fix the data got a crash
// instead of the reason. `{}` and `7` are the values that actually exercise
// that difference -- asArray(x) reports them without crashing where
// `x ?? []` would have died.
for (const [label, value] of [['an object', {}], ['a number', 7]]) {
  test(`a character whose traits is ${label} is reported, not fatal`, () => {
    const d = base();
    d.characters.push(character({ traits: value }));
    assert.deepEqual(validate(d).errors, ['character c1: traits must be an array']);
  });

  test(`a character whose favorites is ${label} is reported, not fatal`, () => {
    const d = base();
    d.characters.push(character({ favorites: value }));
    assert.deepEqual(validate(d).errors, ['character c1: favorites must be an array']);
  });

  test(`a gift whose sources is ${label} is reported, not fatal`, () => {
    const d = base();
    d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: null, description: '', sources: value });
    assert.deepEqual(validate(d).errors, ['gift g1: sources must be an array']);
  });
}

// `null` and a missing key are already nullish, so `x ?? []` handles them
// exactly as asArray(x) does -- reverting the fix to `x ?? []` would leave
// these three green too. They cannot distinguish the two implementations, so
// unlike the loop above they only prove the value is reported, not that
// dropping asArray() would be caught. Keep them split from that loop; folding
// them back together would quietly lose the "not fatal" coverage above.
for (const [label, apply] of [
  ['null', (obj, key) => { obj[key] = null; }],
  ['a missing key', (obj, key) => { delete obj[key]; }],
]) {
  test(`a character whose traits is ${label} is reported`, () => {
    const d = base();
    const c = character();
    apply(c, 'traits');
    d.characters.push(c);
    assert.deepEqual(validate(d).errors, ['character c1: traits must be an array']);
  });

  test(`a character whose favorites is ${label} is reported`, () => {
    const d = base();
    const c = character();
    apply(c, 'favorites');
    d.characters.push(c);
    assert.deepEqual(validate(d).errors, ['character c1: favorites must be an array']);
  });

  test(`a gift whose sources is ${label} is reported`, () => {
    const d = base();
    const g = { id: 'g1', name: 'G', category: 'books', rarity: null, description: '', sources: [] };
    apply(g, 'sources');
    d.gifts.push(g);
    assert.deepEqual(validate(d).errors, ['gift g1: sources must be an array']);
  });
}

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
