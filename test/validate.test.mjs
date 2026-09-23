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

// catId is a string key, so checking it can never throw regardless of the
// link's own shape -- both errors must surface in one run rather than the
// unknown category staying hidden behind the shape error until someone fixes
// the link and reruns CI.
test('an unknown category with a malformed link reports both problems', () => {
  const d = base();
  d.characters.push(character({ categories: { nope: null } }));
  const { errors } = validate(d);
  assert.deepEqual(errors, [
    'character c1: unknown category: nope',
    'character c1: category nope link must be an object',
  ]);
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

// The loop above (a number, a boolean, an array) cannot distinguish asObject()
// from the `value ?? {}` idiom it replaces: none of those values can throw or
// yield entries from Object.entries, so a mutation back to `?? {}` would leave
// them all green. What discriminates is a value Object.entries CAN walk: a
// string (each character becomes an ['index', char] entry) or a non-empty
// array (each element becomes an ['index', element] entry).
test('a character whose categories is a string is rejected, not walked character by character', () => {
  const d = base();
  d.characters.push(character({ categories: 'ab' }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: categories must be an object']);
});

test('a character whose categories is a non-empty array is rejected, not walked element by element', () => {
  const d = base();
  d.characters.push(character({ categories: [{ state: 'guide', source: 's1' }] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: categories must be an object']);
});

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
  assert.match(errors[0], /character c1: traits\[0\] names unknown category: nope/);
});

// A trait that omits `category` entirely -- not even an explicit null -- used
// to fall into the unknown-category branch because `undefined !== null`,
// producing a second, unfixable error alongside the real one about missing
// text. One malformed entry must report only what is actually wrong with it.
test('a trait with no category key reports only the missing text, not a phantom unknown category', () => {
  const d = base();
  d.characters.push(character({ traits: [{}] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: traits[0]: text must be a non-empty string']);
});

test('a null trait entry is reported, not fatal', () => {
  const d = base();
  d.characters.push(character({ traits: [null] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: traits[0] must be an object']);
});

test('a non-object trait entry is reported, not fatal', () => {
  const d = base();
  d.characters.push(character({ traits: ['x'] }));
  const { errors } = validate(d);
  // Before the shape check this reported `trait "undefined" names unknown
  // category: undefined`, which named neither the entry nor a fixable cause.
  assert.deepEqual(errors, ['character c1: traits[0] must be an object']);
});

test('a trait with no text is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: [{ category: null }] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: traits[0]: text must be a non-empty string']);
});

test('a trait with empty text is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: [{ text: '', category: null }] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['character c1: traits[0]: text must be a non-empty string']);
});

// A value that is truthy but not a string is what discriminates `typeof
// t.text !== 'string'` from a weaker `!t.text` check -- both `42` and `{}`
// are truthy, so `!t.text` would let them through the gate.
for (const [label, value] of [['a number', 42], ['an object', {}]]) {
  test(`a trait whose text is ${label} is rejected`, () => {
    const d = base();
    d.characters.push(character({ traits: [{ text: value, category: null }] }));
    const { errors } = validate(d);
    assert.deepEqual(errors, ['character c1: traits[0]: text must be a non-empty string']);
  });
}

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

// --- Shape prelude: the five top-level collections must be arrays --------

const FILE_NAMES = ['categories', 'gifts', 'characters', 'observations', 'sources'];

for (const name of FILE_NAMES) {
  test(`a non-array ${name} collection is rejected`, () => {
    const d = base();
    d[name] = 7;
    const { errors } = validate(d);
    assert.deepEqual(errors, [`${name} must be an array`]);
  });
}

// Pins the early return: without it, a gift naming a category while
// `categories` is unreadable would still walk the gift loop and add a second,
// spurious "unknown category" error on top of the real one.
test('a non-array categories does not cascade into an unknown-category error from a gift', () => {
  const d = base();
  d.categories = 7;
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: null, description: '', sources: [] });
  const { errors } = validate(d);
  assert.deepEqual(errors, ['categories must be an array']);
});

// --- Shape prelude: each element must be an object -----------------------

for (const name of FILE_NAMES) {
  test(`a null element in ${name} is rejected by position`, () => {
    const d = base();
    d[name] = [null];
    const { errors } = validate(d);
    assert.deepEqual(errors, [`${name}[0] must be an object`]);
  });
}

// Pins the two clauses `null` alone cannot. `typeof [] === 'object'`, so an
// array element only trips `|| Array.isArray(item)`; `typeof 'x' === 'string'`,
// so a string element only trips `typeof item !== 'object'`. Each case
// isolates one clause: dropping either from the shape check leaves the other
// case's error alone unpinned, and null cannot substitute for either.
for (const name of FILE_NAMES) {
  for (const [label, value] of [['an array', []], ['a string', 'x']]) {
    test(`${label} element in ${name} is rejected by position`, () => {
      const d = base();
      d[name] = [value];
      const { errors } = validate(d);
      assert.deepEqual(errors, [`${name}[0] must be an object`]);
    });
  }
}

// --- Shape prelude: each element needs a non-empty string id -------------

// Each factory returns a fully valid entry for that collection: placed into
// base() -- together with whatever it references -- the dataset validates
// with zero errors (see the loop just below). observations needs a real gift
// and a giftable character to point at, so its factory adds them to the
// dataset it is handed rather than naming ids ('g', 'c') that exist nowhere;
// the other factories ignore that argument, having nothing to reference.
const VALID_ITEM = {
  categories: () => ({ id: 'x', label: 'L', inGameDescriptor: null, aliases: [] }),
  gifts: () => ({ id: 'x', name: 'G', category: null, rarity: null, description: '', sources: [] }),
  characters: () => character({ id: 'x' }),
  observations: (d) => {
    d.gifts.push({ id: 'g', name: 'G', category: null, rarity: null, description: '', sources: [] });
    d.characters.push(character({ id: 'c' }));
    return { id: 'x', gift: 'g', character: 'c', reaction: 'liked', date: '2026-09-20' };
  },
  sources: () => ({ id: 'x', title: 'T', author: null, publisher: 'P', url: 'https://e.x', retrieved: '2026-09-20' }),
};

// Holds the word "VALID" in VALID_ITEM true: each entry, placed into base(),
// produces no errors at all. This is what a gift named 'g' and a character
// named 'c' that didn't exist anywhere used to fail silently -- the bad-id
// tests below never reached far enough to notice, because the corrupted id
// stopped validation before the reference checks ever ran.
for (const name of FILE_NAMES) {
  test(`VALID_ITEM.${name}, placed into base(), validates with zero errors`, () => {
    const d = base();
    const item = VALID_ITEM[name](d);
    d[name] = [...d[name], item];
    assert.deepEqual(validate(d).errors, []);
  });
}

const BAD_IDS = [
  ['a number', (item) => { item.id = 7; }], // catches a `!item.id` weakening
  ['an empty string', (item) => { item.id = ''; }], // catches dropping the length check
  ['null', (item) => { item.id = null; }],
  ['a missing key', (item) => { delete item.id; }],
];

for (const name of FILE_NAMES) {
  for (const [label, apply] of BAD_IDS) {
    test(`a ${name} element whose id is ${label} is rejected`, () => {
      const d = base();
      const item = VALID_ITEM[name](d);
      apply(item);
      d[name] = [item];
      const { errors } = validate(d);
      assert.deepEqual(errors, [`${name}[0]: id must be a non-empty string`]);
    });
  }
}

test('a character with a bad id and no name produces only the id error', () => {
  const d = base();
  const c = character({ id: 7 });
  delete c.name;
  d.characters.push(c);
  const { errors } = validate(d);
  assert.deepEqual(errors, ['characters[0]: id must be a non-empty string']);
});

test('an observation with no id is rejected', () => {
  const d = base();
  d.observations.push({ gift: 'g', character: 'c', reaction: 'liked', date: '2026-09-20' });
  const { errors } = validate(d);
  assert.deepEqual(errors, ['observations[0]: id must be a non-empty string']);
});

// A bad entry is excluded, and anything that points at it would then report
// "unknown". Against the real data, deleting one source's id produced 102
// errors with the cause on line one. Validation stops after the shape pass so
// the cause comes back alone. Each fixture below points at the broken entry;
// without the stop, each would report one "unknown ..." error on top.
test('a category with a bad id stops validation before its references cascade', () => {
  const d = base();
  d.categories = [{ label: 'Books', inGameDescriptor: null, aliases: [] }];
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: null, description: '', sources: [] });
  d.characters.push(character({ categories: { books: { state: 'profile', source: null } } }));
  const { errors } = validate(d);
  assert.deepEqual(errors, ['categories[0]: id must be a non-empty string']);
});

test('a source with a bad id stops validation before its references cascade', () => {
  const d = base();
  d.sources = [{ title: 'T', author: null, publisher: 'P', url: 'https://e.x', retrieved: '2026-09-20' }];
  d.gifts.push({ id: 'g1', name: 'G', category: null, rarity: null, description: '', sources: ['s1'] });
  const { errors } = validate(d);
  assert.deepEqual(errors, ['sources[0]: id must be a non-empty string']);
});

// The cost of stopping, stated as a test so it reads as a decision rather
// than a bug: an unrelated problem elsewhere waits for the next run.
test('a shape error defers unrelated errors to the next run, by design', () => {
  const d = base();
  d.characters.push(character({ id: 7 }), character({ id: 'c2', giftable: 'yes' }));
  assert.deepEqual(validate(d).errors, ['characters[0]: id must be a non-empty string']);
  d.characters[0].id = 'c1';
  assert.deepEqual(validate(d).errors, ['character c2: giftable must be a boolean']);
});

// The privacy check runs inside the per-element pass itself, so unlike the
// reference checks above it is never deferred by an unrelated shape error
// elsewhere in the dataset -- both problems come back in the same run.
test('a shape error in one collection does not skip the privacy check on another', () => {
  const d = base();
  d.categories.push({ label: 'No id', inGameDescriptor: null, aliases: [] }); // categories[1]: no id
  d.observations.push({ id: 'o1', gift: 'g', character: 'c', reaction: 'liked', date: '2026-09-20', name: 'someone' });
  const { errors } = validate(d);
  assert.deepEqual(errors, [
    'categories[1]: id must be a non-empty string',
    'observations[0]: forbidden identifying field: name',
  ]);
});

test('an observation with a bad id and a forbidden field reports both, in that order', () => {
  const d = base();
  d.observations.push({ gift: 'g', character: 'c', reaction: 'liked', date: '2026-09-20', reporter: 'someone' });
  const { errors } = validate(d);
  assert.deepEqual(errors, [
    'observations[0]: id must be a non-empty string',
    'observations[0]: forbidden identifying field: reporter',
  ]);
});

// --- giftable and spoiler must be booleans --------------------------------

for (const field of ['giftable', 'spoiler']) {
  test(`a character with a missing ${field} is rejected`, () => {
    const d = base();
    const c = character();
    delete c[field];
    d.characters.push(c);
    const { errors } = validate(d);
    assert.deepEqual(errors, [`character c1: ${field} must be a boolean`]);
  });

  test(`a character whose ${field} is the truthy string "yes" is rejected`, () => {
    const d = base();
    d.characters.push(character({ [field]: 'yes' }));
    const { errors } = validate(d);
    assert.deepEqual(errors, [`character c1: ${field} must be a boolean`]);
  });

  test(`a character whose ${field} is true is accepted`, () => {
    const d = base();
    d.characters.push(character({ [field]: true }));
    assert.deepEqual(validate(d).errors, []);
  });

  test(`a character whose ${field} is false is accepted`, () => {
    const d = base();
    d.characters.push(character({ [field]: false }));
    assert.deepEqual(validate(d).errors, []);
  });
}

// --- trait errors carry their position ------------------------------------

test('two bad traits on one character are each reported at their own position', () => {
  const d = base();
  d.characters.push(character({ traits: [null, { text: '', category: null }] }));
  const { errors } = validate(d);
  assert.deepEqual(errors, [
    'character c1: traits[0] must be an object',
    'character c1: traits[1]: text must be a non-empty string',
  ]);
});
