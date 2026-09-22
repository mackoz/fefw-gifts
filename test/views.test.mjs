import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { characterRows, characterIndexModel, characterSummary, signalHeading } from '../assets/js/views/character.js';
import { sortByConfidence, stateLabel, partitionRows, categoryChips, chip, reportChip } from '../assets/js/views/shared.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { giftRows, giftIndexModel } from '../assets/js/views/gift.js';

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

import { matrixModel, SYMBOL, render as renderMatrix } from '../assets/js/views/matrix.js';

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
import * as characterView from '../assets/js/views/character.js';
import * as giftView from '../assets/js/views/gift.js';
import * as favoritesView from '../assets/js/views/favorites.js';

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

// chip() and reportChip() are the only DOM-touching exports under test here,
// so `document` gets just enough of a stand-in to construct an element and
// read back what el() sets on it -- no dependency, no real DOM.
function fakeElement(tag) {
  const attrs = {};
  return {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    dataset: {},
    children: [],
    setAttribute(name, value) { attrs[name] = value; },
    getAttribute(name) { return attrs[name] ?? null; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  };
}
globalThis.document = { createElement: (tag) => fakeElement(tag) };

// Walk the stub tree. Only the matrix test needs these; everything else here
// asserts on pure models.
function collect(node, match, found = []) {
  for (const child of node.children ?? []) {
    if (match(child)) found.push(child);
    collect(child, match, found);
  }
  return found;
}
function findFirst(node, match) {
  return collect(node, match)[0];
}

test('chip renders a link when given an href and a plain span otherwise', () => {
  const link = chip('Books', { href: '#/gift/book' });
  assert.equal(link.tagName, 'A');
  assert.equal(link.href, '#/gift/book');
  assert.match(link.className, /\bchip\b/);
  assert.equal(link.textContent, 'Books');

  const label = chip('Books');
  assert.equal(label.tagName, 'SPAN');
  assert.equal(label.href, undefined, 'a non-link chip must not look clickable');
});

// This is the contract character.js, gift.js and favorites.js all rely on:
// app.js's delegated click listener finds `.report-button` and reads these
// two dataset keys. Renaming the class or dropping a key makes every chip
// built from reportChip() go inert with no error and no test catching it.
test('reportChip carries the report-button class and both dataset ids', () => {
  const button = reportChip('nydine', 'grooming-kit', 'Grooming kit', {
    ariaLabel: 'Report a result for Grooming kit',
  });
  assert.match(button.className, /\bchip\b/);
  assert.match(button.className, /\bchip-action\b/);
  assert.match(button.className, /\breport-button\b/);
  assert.equal(button.dataset.character, 'nydine');
  assert.equal(button.dataset.gift, 'grooming-kit');
  assert.equal(button.getAttribute('aria-label'), 'Report a result for Grooming kit');
});

test('characterSummary reports the strongest true thing, never a negative', () => {
  const idx = buildIndex(dataset);
  // The fixture's c1 has one favourite observation on `brew`.
  assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), '1 favourite found');
});

test('characterSummary counts a declared favourite the Favourites tab would count', () => {
  const characters = [{ ...dataset.characters[0], favorites: ['rock'] }];
  const idx = buildIndex({ ...dataset, characters, observations: [] });
  assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), '1 favourite found');
});

test('characterSummary falls back through confirmed, predicted, then nothing', () => {
  const base = { ...dataset.characters[0], favorites: [] };

  const predictedOnly = buildIndex({ ...dataset, characters: [base], observations: [] });
  // c1 likes books, and `book` is a books item, so exactly one prediction.
  assert.equal(characterSummary(predictedOnly, predictedOnly.byCharacterId.get('c1')), '1 worth trying');

  const confirmed = buildIndex({
    ...dataset,
    characters: [base],
    observations: [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }],
  });
  assert.equal(characterSummary(confirmed, confirmed.byCharacterId.get('c1')), '1 confirmed');

  const bare = buildIndex({ ...dataset, characters: [{ ...base, categories: {} }], observations: [] });
  assert.equal(characterSummary(bare, bare.byCharacterId.get('c1')), 'nothing tested yet');
});

// A character whose only category link is refuted has a guide guess that the
// gift will NOT land. That must never surface as "worth trying" -- see
// suggestionsFor in favorites.js, which this is made to agree with.
test('characterSummary does not count a refuted-category prediction as worth trying', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], categories: { books: { state: 'refuted', source: 'polygon' } } }],
    observations: [],
  });
  assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), 'nothing tested yet');
});

test('characterIndexModel hides non-giftable characters and honours search', () => {
  const characters = [
    { ...dataset.characters[0], id: 'aa', name: 'Aada' },
    { ...dataset.characters[0], id: 'bb', name: 'Bruno' },
    { ...dataset.characters[0], id: 'cc', name: 'Cass', giftable: false },
  ];
  const idx = buildIndex({ ...dataset, characters });
  assert.deepEqual(characterIndexModel(idx, DEFAULT_FILTERS, '').map((e) => e.character.id), ['aa', 'bb']);
  assert.deepEqual(characterIndexModel(idx, DEFAULT_FILTERS, 'bru').map((e) => e.character.id), ['bb']);
});

test('characterIndexModel carries the category chips for each character', () => {
  const idx = buildIndex(dataset);
  const [entry] = characterIndexModel(idx, DEFAULT_FILTERS, '');
  assert.deepEqual(entry.categories.map((c) => c.label), ['Books']);
});

test('signalHeading never claims knowledge over a table of pure guesswork', () => {
  assert.equal(signalHeading([{ confidence: { state: 'PREDICTED', predicted: 'positive' } }]), 'Worth trying');
  // All guesses, but one says the gift will NOT land: not "worth trying", and
  // emphatically not something we know.
  assert.equal(
    signalHeading([
      { confidence: { state: 'PREDICTED', predicted: 'positive' } },
      { confidence: { state: 'PREDICTED', predicted: 'negative' } },
    ]),
    'Predictions',
  );
  assert.equal(
    signalHeading([
      { confidence: { state: 'PREDICTED', predicted: 'positive' } },
      { confidence: { state: 'CONFIRMED' } },
    ]),
    'What we know',
  );
  // A pending report is a real player's result, but nobody has reviewed it
  // yet, so it is not "What we know" either -- see I2 in the fix brief: this
  // assertion used to expect 'What we know' here, which was the bug.
  assert.equal(signalHeading([{ confidence: { state: 'PENDING' } }]), 'Awaiting review');
});

// A refuted-category prediction is a guess the gift will NOT land. Counting it
// toward "Worth trying" would invite players to spend gifts on items a guide
// says will not work -- the inverse of this project's core rule. But the
// answer is not "What we know" either: these rows are still pure guesswork,
// and that heading may only appear over something somebody observed.
test('signalHeading does not call a refuted-category prediction "worth trying"', () => {
  assert.equal(
    signalHeading([{ confidence: { state: 'PREDICTED', predicted: 'negative' } }]),
    'Predictions',
  );
  assert.equal(
    signalHeading([
      { confidence: { state: 'PREDICTED', predicted: 'positive' } },
      { confidence: { state: 'PREDICTED', predicted: 'negative' } },
    ]),
    'Predictions',
  );
});

// A single pending report is a real player's result, but nobody has reviewed
// it yet -- so a character page with nothing else must not print "What we
// know" over a row whose own badge says "awaiting review". See I2 in the fix
// brief.
test('signalHeading returns "Awaiting review" for a pending-only table, but "What we know" once something is observed', () => {
  assert.equal(signalHeading([{ confidence: { state: 'PENDING' } }]), 'Awaiting review');
  assert.equal(
    signalHeading([
      { confidence: { state: 'PENDING' } },
      { confidence: { state: 'CONFIRMED' } },
    ]),
    'What we know',
  );
  assert.equal(
    signalHeading([
      { confidence: { state: 'PENDING' } },
      { confidence: { state: 'CONTESTED' } },
    ]),
    'What we know',
  );
});

// Both mean somebody HAS tested this character, so neither may fall through to
// "nothing tested yet" -- and neither may read as a confirmation.
test('characterSummary reports contested and pending results rather than silence', () => {
  const bare = {
    ...dataset,
    gifts: [{ id: 'b1', name: 'B1', category: null, rarity: null, description: '', sources: [] }],
    characters: [{ ...dataset.characters[0], categories: {}, favorites: [] }],
    observations: [],
  };
  const pending = buildIndex(bare, [{ id: 'p1', character: 'c1', gift: 'b1', reaction: 'loved', created_at: '2026-09-22' }]);
  assert.equal(characterSummary(pending, pending.byCharacterId.get('c1')), '1 awaiting review');

  const contested = buildIndex({ ...bare, observations: [
    { id: 'o1', character: 'c1', gift: 'b1', reaction: 'loved', date: '2026-09-22' },
    { id: 'o2', character: 'c1', gift: 'b1', reaction: 'none', date: '2026-09-22' },
  ] });
  assert.equal(characterSummary(contested, contested.byCharacterId.get('c1')), '1 contested');

  const nothing = buildIndex(bare);
  assert.equal(characterSummary(nothing, nothing.byCharacterId.get('c1')), 'nothing tested yet');
});

// A CONFIRMED row is a real observation, but only a positive reaction means
// the gift worked. The report form's first option is "They didn't like it",
// so a CONFIRMED "none" reaction is common, and counting it toward "N
// confirmed" would read as N gifts that work. See I3 in the fix brief.
test('characterSummary reports a neutral-reaction confirmation as "tested", not "confirmed"', () => {
  const base = {
    ...dataset,
    gifts: [{ id: 'b1', name: 'B1', category: null, rarity: null, description: '', sources: [] }],
    characters: [{ ...dataset.characters[0], categories: {}, favorites: [] }],
  };

  const tested = buildIndex({
    ...base,
    observations: [{ id: 'o1', character: 'c1', gift: 'b1', reaction: 'none', date: '2026-09-22' }],
  });
  assert.equal(characterSummary(tested, tested.byCharacterId.get('c1')), '1 tested');

  const confirmed = buildIndex({
    ...base,
    observations: [{ id: 'o1', character: 'c1', gift: 'b1', reaction: 'liked', date: '2026-09-22' }],
  });
  assert.equal(characterSummary(confirmed, confirmed.byCharacterId.get('c1')), '1 confirmed');
});

test('giftIndexModel groups by category, alphabetically', () => {
  const idx = buildIndex(dataset);
  const groups = giftIndexModel(idx, '');
  assert.deepEqual(groups.map((g) => g.label), ['Books', 'Coffee', 'Category not recorded yet']);
  assert.deepEqual(groups[0].gifts.map((g) => g.id), ['book']);
});

test('the uncategorised group sorts last and is identified by a null id', () => {
  const idx = buildIndex(dataset);
  const groups = giftIndexModel(idx, '');
  const last = groups.at(-1);
  assert.equal(last.id, null);
  assert.deepEqual(last.gifts.map((g) => g.id), ['rock']);
});

test('giftIndexModel filters by search and drops groups that empty out', () => {
  const idx = buildIndex(dataset);
  const groups = giftIndexModel(idx, 'roc');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, null);
});

test('giftIndexModel returns nothing when the search matches nothing', () => {
  const idx = buildIndex(dataset);
  assert.deepEqual(giftIndexModel(idx, 'zzzz'), []);
});

// The gutter column exists to stop the sticky corner clipping the first
// rotated header. Its cost is one extra cell per row, and the failure mode if
// someone adds it to the header but not the body (or vice versa) is a matrix
// whose columns are silently off by one -- every cell showing the wrong
// character. Nothing else in the suite renders matrix DOM.
test('every matrix row carries the same number of cells as the header', () => {
  const idx = buildIndex(dataset);
  const container = fakeElement('div');
  renderMatrix(container, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false });

  const table = findFirst(container, (n) => n.className === 'matrix');
  assert.ok(table, 'render should produce a .matrix table');

  const rows = collect(table, (n) => n.tagName === 'TR');
  assert.ok(rows.length >= 2, `expected a header row and at least one body row, got ${rows.length}`);

  const widths = rows.map((row) => row.children.length);
  const [header, ...body] = widths;
  for (const [i, w] of body.entries()) {
    assert.equal(w, header, `body row ${i} has ${w} cells against a ${header}-cell header`);
  }

  // corner + gutter + one column per giftable, non-spoiler character
  const characters = matrixModel(idx, DEFAULT_FILTERS, '').characters.length;
  assert.equal(header, characters + 2, 'header should be corner + gutter + one cell per character');
  assert.equal(collect(table, (n) => n.className === 'lead-in').length, rows.length,
    'exactly one gutter cell per row, header included');
});

// The load-bearing degradation rule from CLAUDE.md: with the Worker
// unconfigured the committed data must still render and every report control
// must become a plain link. It spans three view modules that each build their
// own chips, so it is exactly the kind of rule that rots in one file while the
// other two stay right. Asserting it here beats discovering it in production.
test('with submissions off, no view renders a report control', () => {
  const idx = buildIndex(dataset);
  const off = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined };

  for (const [name, render, state] of [
    ['characters index', characterView.render, off],
    ['character detail', characterView.render, { ...off, id: 'c1' }],
    ['gifts index', giftView.render, off],
    ['gift detail', giftView.render, { ...off, id: 'book' }],
    ['favourites', favoritesView.render, off],
  ]) {
    const container = fakeElement('div');
    render(container, idx, state);
    const triggers = collect(container, (n) => (n.className ?? '').includes('report-button'));
    assert.equal(triggers.length, 0, `${name} rendered ${triggers.length} report controls with submissions off`);
    const buttons = collect(container, (n) => n.tagName === 'BUTTON');
    assert.equal(buttons.length, 0, `${name} rendered a bare button with submissions off`);
  }
});

test('with submissions on, the detail views do render report controls', () => {
  const idx = buildIndex(dataset);
  const on = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: true, storage: undefined, id: 'c1' };
  const container = fakeElement('div');
  characterView.render(container, idx, on);
  const triggers = collect(container, (n) => (n.className ?? '').includes('report-button'));
  assert.ok(triggers.length > 0, 'the previous test would pass vacuously if nothing ever renders one');
  for (const t of triggers) {
    assert.ok(t.dataset.character && t.dataset.gift, 'every report control carries both ids app.js reads');
  }
});

// C2 in the fix brief: the page hides horizontal overflow, so an overflowing
// gift/character table needs its own scroller or the Report column is
// unreachable on a phone. Both giftTable() (character.js) and
// characterTable() (gift.js) must wrap their <table> in a .table-scroll div.
test('the character and gift detail tables are wrapped in a .table-scroll', () => {
  const idx = buildIndex(dataset);
  const on = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: true, storage: undefined };

  for (const [name, render, state] of [
    ['character detail', characterView.render, { ...on, id: 'c1' }],
    ['gift detail', giftView.render, { ...on, id: 'book' }],
  ]) {
    const container = fakeElement('div');
    render(container, idx, state);
    const scroller = findFirst(container, (n) => (n.className ?? '').includes('table-scroll'));
    assert.ok(scroller, `${name} should render a .table-scroll wrapper`);
    const table = collect(scroller, (n) => (n.className ?? '').includes('gift-table'));
    assert.equal(table.length, 1, `${name}'s .gift-table should be inside its .table-scroll wrapper`);
  }
});
