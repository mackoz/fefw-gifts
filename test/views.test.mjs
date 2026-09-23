import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { characterRows, characterIndexModel, characterSummary, signalHeading, provenanceNote } from '../assets/js/views/character.js';
import { sortByConfidence, stateLabel, partitionRows, categoryChips, chip, reportButton, reportChip } from '../assets/js/views/shared.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { giftRows, giftIndexModel, missingItemButton } from '../assets/js/views/gift.js';

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

// `predicted` has to be supplied, and it has to include 'negative'. A refuted
// category link is a guide's guess that the gift will NOT land, and
// stateLabel's PREDICTED + predicted: 'negative' arm is the only branch in the
// function that could ever word a pair negatively. The fixture used to leave
// `predicted` undefined, so that arm never ran: swapping its production string
// for "Dislikes this" left this guard green. It is the one branch this test
// exists for.
test('state labels never describe an untested pair as disliked', () => {
  for (const state of ['UNTESTED', 'PREDICTED', 'CONFIRMED', 'FAVORITE', 'CONTESTED']) {
    for (const predicted of ['negative', 'positive', null]) {
      const label = stateLabel({ state, reaction: null, predicted });
      assert.doesNotMatch(label, /dislike|hates|bad gift/i, `${state} with a ${predicted} prediction`);
    }
  }
  // Pins the branch itself, so it cannot be deleted and leave the loop above
  // scanning a string nobody renders.
  assert.equal(stateLabel({ state: 'PREDICTED', reaction: null, predicted: 'negative' }), 'Predicted: probably no gain');
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

import { matrixModel, SYMBOL, cellState, cellLabel, render as renderMatrix } from '../assets/js/views/matrix.js';

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

// A character's category chips mix three different claims -- a guide's guess,
// an in-game profile listing, and something a player actually found -- and the
// note must say which is which rather than calling everything "carried over".
// See CLAUDE.md's "Guide-derived links always carry provenance."
const provenanceIndex = buildIndex({
  categories: [
    { id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] },
    { id: 'coffee', label: 'Coffee', inGameDescriptor: null, aliases: [] },
    { id: 'tea', label: 'Tea', inGameDescriptor: null, aliases: [] },
    { id: 'drinks', label: 'Fermented Drinks', inGameDescriptor: null, aliases: [] },
    { id: 'snacks', label: 'Snacks', inGameDescriptor: null, aliases: [] },
  ],
  gifts: [],
  characters: [],
  observations: [],
  sources: [
    { id: 'polygon-1', title: '', author: null, publisher: 'Polygon', url: '', retrieved: '2026-09-20' },
    { id: 'game8-1', title: '', author: null, publisher: 'Game8', url: '', retrieved: '2026-09-23' },
  ],
});

const guideChip = (id, label, source) => ({ id, label, state: 'guide', source });
const discoveredChip = (id, label) => ({ id, label, state: 'discovered', source: null });
const profileChip = (id, label) => ({ id, label, state: 'profile', source: null });

test('provenanceNote: guide-only, one publisher', () => {
  const chips = [guideChip('books', 'Books', 'polygon-1')];
  assert.equal(
    provenanceNote(provenanceIndex, chips),
    'Category preferences carried over from Polygon. They’re predictions until a player confirms an item.',
  );
});

test('provenanceNote: guide-only, two publishers', () => {
  const chips = [guideChip('books', 'Books', 'polygon-1'), guideChip('coffee', 'Coffee', 'game8-1')];
  assert.equal(
    provenanceNote(provenanceIndex, chips),
    'Category preferences carried over from Polygon and Game8. They’re predictions until a player confirms an item.',
  );
});

test('provenanceNote: guide plus one discovered', () => {
  const chips = [discoveredChip('drinks', 'Fermented Drinks'), guideChip('books', 'Books', 'polygon-1')];
  assert.equal(
    provenanceNote(provenanceIndex, chips),
    'Fermented Drinks was found through play. The rest are carried over from Polygon and are predictions until a player confirms an item.',
  );
});

test('provenanceNote: guide plus two discovered', () => {
  const chips = [
    discoveredChip('books', 'Books'),
    discoveredChip('coffee', 'Coffee'),
    guideChip('tea', 'Tea', 'polygon-1'),
  ];
  assert.equal(
    provenanceNote(provenanceIndex, chips),
    'Books and Coffee were found through play. The rest are carried over from Polygon and are predictions until a player confirms an item.',
  );
});

test('provenanceNote: guide plus three discovered', () => {
  const chips = [
    discoveredChip('books', 'Books'),
    discoveredChip('coffee', 'Coffee'),
    discoveredChip('tea', 'Tea'),
    guideChip('snacks', 'Snacks', 'polygon-1'),
  ];
  assert.equal(
    provenanceNote(provenanceIndex, chips),
    'Books, Coffee and Tea were found through play. The rest are carried over from Polygon and are predictions until a player confirms an item.',
  );
});

test('provenanceNote: discovered only', () => {
  const chips = [discoveredChip('books', 'Books')];
  assert.equal(provenanceNote(provenanceIndex, chips), 'Found through play.');
});

test('provenanceNote: profile only, one', () => {
  const chips = [profileChip('snacks', 'Snacks')];
  assert.equal(provenanceNote(provenanceIndex, chips), 'Snacks is on the in-game profile.');
});

test('provenanceNote: discovered plus profile, no guide', () => {
  const chips = [discoveredChip('drinks', 'Fermented Drinks'), profileChip('snacks', 'Snacks')];
  assert.equal(
    provenanceNote(provenanceIndex, chips),
    'Fermented Drinks was found through play. Snacks is on the in-game profile.',
  );
});

test('provenanceNote: empty chips returns an empty string', () => {
  assert.equal(provenanceNote(provenanceIndex, []), '');
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
// The fixture has to reach the branches this guards. `dataset` alone has one
// character who already owns a favourite, so favorites.js's suggestionChips
// never runs (nothing is unknown) and gift.js's untestedBlock never runs (its
// only row is PREDICTED, not UNTESTED) -- the two branches most likely to leak
// a report control were not executed at all. c2 has a category link but no
// favourite and no observation, which puts a suggestion chip in the hunt and
// an untested chip on the gift page.
const degradedDataset = {
  ...dataset,
  characters: [
    dataset.characters[0],
    {
      id: 'c2', name: 'D', giftable: true, spoiler: false, traits: [],
      categories: { coffee: { state: 'profile', source: null } },
      rarityPreference: null, favorites: [], notes: null,
    },
  ],
};

test('with submissions off, no view renders a report control', () => {
  const idx = buildIndex(degradedDataset);
  const off = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined };

  // Guards against the fixture silently drifting back to one that never
  // reaches suggestionChips or untestedBlock.
  const hunt = favoritesModel(idx, DEFAULT_FILTERS);
  assert.ok(hunt.unknown.some((u) => u.suggestions.length > 0), 'fixture must reach favorites.js suggestionChips');
  assert.ok(partitionRows(giftRows(idx, 'book', DEFAULT_FILTERS)).untested.length > 0,
    'fixture must reach gift.js untestedBlock');

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
  const idx = buildIndex(degradedDataset);
  const on = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: true, storage: undefined };

  // Every view the degradation test above sweeps that can render a control has
  // to render one here, or the assertion over there passes vacuously.
  for (const [name, render, state] of [
    ['character detail', characterView.render, { ...on, id: 'c1' }],
    ['gift detail', giftView.render, { ...on, id: 'book' }],
    ['favourites', favoritesView.render, on],
  ]) {
    const container = fakeElement('div');
    render(container, idx, state);
    const triggers = collect(container, (n) => (n.className ?? '').includes('report-button'));
    assert.ok(triggers.length > 0, `${name} renders no report control with submissions on`);
    for (const t of triggers) {
      assert.ok(t.dataset.character && t.dataset.gift, `${name}: every report control carries both ids app.js reads`);
    }
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

// A cross-module contract, not a formatting test. app.js's one delegated
// listener finds a trigger with closest('.report-button') and reads
// dataset.character / dataset.gift. Both builders in shared.js must emit that
// exact class: renaming the literal in reportButton() left every per-row
// Report button inert with the whole suite still green, because nothing
// pinned the string.
test('reportButton and reportChip both emit the .report-button class app.js closes on', () => {
  for (const [name, node] of [
    ['reportButton', reportButton('nydine', 'grooming-kit')],
    ['reportChip', reportChip('nydine', 'grooming-kit', 'Grooming kit')],
  ]) {
    assert.match(node.className, /\breport-button\b/, `${name} must carry the class app.js looks for`);
    assert.equal(node.tagName, 'BUTTON', `${name} must be a button`);
    assert.equal(node.dataset.character, 'nydine', `${name} must carry the character id`);
    assert.equal(node.dataset.gift, 'grooming-kit', `${name} must carry the gift id`);
  }
});

// A2: a CONFIRMED pair whose reaction is not positive means a player tested
// this and it did nothing. Drawing it as the confirmed ✔ under a legend
// reading "confirmed" claims the gift works -- the opposite of the report.
test('cellState separates a no-gain confirmation from a confirmed one', () => {
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'none' }), 'TESTED');
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'liked' }), 'CONFIRMED');
  assert.equal(cellState({ state: 'FAVORITE', reaction: 'favorite' }), 'FAVORITE');
  assert.equal(cellState({ state: 'UNTESTED', reaction: null }), 'UNTESTED');
  assert.equal(cellState({ state: 'PENDING', reaction: null }), 'PENDING');
  assert.notEqual(SYMBOL.TESTED, SYMBOL.CONFIRMED, 'the pseudo-state needs its own symbol or the split is invisible');
  // The tooltip must not swing the other way and deny the report it marks.
  assert.doesNotMatch(cellLabel({ state: 'CONFIRMED', reaction: 'none' }), /not tested/i);
});

test('the matrix renders a no-gain confirmation with neither the confirmed tick nor its tint', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [{ id: 'o1', gift: 'book', character: 'c1', reaction: 'none', date: '2026-09-20' }],
  });
  const container = fakeElement('div');
  renderMatrix(container, idx, { filters: DEFAULT_FILTERS, search: 'book', submissionsEnabled: false });

  const cells = collect(container, (n) => n.tagName === 'TD' && (n.className ?? '').startsWith('cell-'));
  assert.equal(cells.length, 1, 'the search should narrow this to one gift row and one character column');
  assert.match(cells[0].className, /\bcell-tested\b/);
  assert.doesNotMatch(cells[0].className, /\bcell-confirmed\b/);
  assert.equal(cells[0].textContent, SYMBOL.TESTED);
  assert.doesNotMatch(cells[0].title, /^.*: Confirmed: reported$/);

  // The key has to explain the symbol the grid just drew.
  const swatch = findFirst(container, (n) => (n.className ?? '').includes('cell-tested') && (n.className ?? '').includes('legend-swatch'));
  assert.ok(swatch, 'the legend needs a row for the tested pseudo-state');
});

// A3: both hunt sections render a name followed by a chip list, so with the
// Worker unconfigured the chips are bare gift links in both. Without a label
// per row a prediction reads as a known favourite.
test('the favourites hunt labels a suggestion "worth trying" and a solved row a known favourite', () => {
  const idx = buildIndex(degradedDataset);
  const container = fakeElement('div');
  favoritesView.render(container, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined });
  const hints = collect(container, (n) => n.className === 'hunt-hint').map((n) => n.textContent);
  // Unknown section first, then Found: c2 is a prediction, c1 has a favourite.
  assert.deepEqual(hints, ['worth trying', 'known favourite']);
});

test('a row with more than one known favourite says favourites', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], favorites: ['book'] }],
  });
  const container = fakeElement('div');
  favoritesView.render(container, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined });
  const hints = collect(container, (n) => n.className === 'hunt-hint').map((n) => n.textContent);
  assert.deepEqual(hints, ['known favourites']);
});

// C1: Safari/VoiceOver drops the implicit list role once list-style: none
// meets display: grid/flex, which is exactly what .matrix-legend and
// .hunt-list do.
test('every list the stylesheet un-lists keeps an explicit list role', () => {
  const idx = buildIndex(degradedDataset);
  const state = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined };

  const matrix = fakeElement('div');
  renderMatrix(matrix, idx, state);
  const legend = findFirst(matrix, (n) => n.className === 'matrix-legend');
  assert.equal(legend.getAttribute('role'), 'list', 'the matrix legend needs role="list"');

  const hunt = fakeElement('div');
  favoritesView.render(hunt, idx, state);
  const lists = collect(hunt, (n) => n.className === 'hunt-list');
  assert.equal(lists.length, 2, 'the hunt renders an unknown list and a found list');
  for (const list of lists) assert.equal(list.getAttribute('role'), 'list', 'every .hunt-list needs role="list"');
});

// The validator now rejects a missing traits key (see I1 in the fix brief),
// but the view has to survive it too: real data can still reach the browser
// out of band (a stale cache, a hand-edited file), and renderProfile must not
// throw. It should render the page and simply omit the Profile section.
test('a character with no traits key renders without throwing and omits the Profile section', () => {
  const { traits, ...noTraits } = dataset.characters[0];
  const idx = buildIndex({ ...dataset, characters: [noTraits] });

  const container = fakeElement('div');
  assert.doesNotThrow(() => {
    characterView.render(container, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'c1' });
  });
  const heading = findFirst(container, (n) => n.tagName === 'H3' && n.textContent === 'Profile');
  assert.equal(heading, undefined, 'no traits means no Profile heading');
});

// Render-level check that renderProfile actually wires provenanceNote in,
// not just that the pure function is correct in isolation.
test('the character detail view renders the provenance note text from provenanceNote', () => {
  const idx = buildIndex({
    categories: [
      { id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] },
      { id: 'drinks', label: 'Fermented Drinks', inGameDescriptor: null, aliases: [] },
    ],
    gifts: [],
    characters: [{
      id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [],
      categories: {
        drinks: { state: 'discovered', source: null },
        books: { state: 'guide', source: 'polygon-1' },
      },
      rarityPreference: null, favorites: [], notes: null,
    }],
    observations: [],
    sources: [{ id: 'polygon-1', title: '', author: null, publisher: 'Polygon', url: '', retrieved: '2026-09-20' }],
  });

  const container = fakeElement('div');
  characterView.render(container, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'c1' });
  const note = findFirst(container, (n) => (n.className ?? '').includes('provenance-note'));
  assert.equal(
    note.textContent,
    'Fermented Drinks was found through play. The rest are carried over from Polygon and are predictions until a player confirms an item.',
  );
});

// The Gifts tab's second entry point into a missing-item report. Like the
// report controls above, it must not exist with submissions off.
test('a search that matches no gift offers to report it, but only with submissions on', () => {
  const idx = buildIndex(dataset);
  const base = { filters: DEFAULT_FILTERS, search: 'lantern oil', searchText: 'Lantern Oil', storage: undefined };

  const on = fakeElement('div');
  giftView.render(on, idx, { ...base, submissionsEnabled: true });
  const buttons = collect(on, (n) => (n.className ?? '').includes('missing-item-button'));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].tagName, 'BUTTON');
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].dataset.name, 'Lantern Oil', 'carries the query as typed, not lower-cased');
  assert.equal(buttons[0].textContent, 'Report ‘Lantern Oil’ as a missing item');

  const off = fakeElement('div');
  giftView.render(off, idx, { ...base, submissionsEnabled: false });
  assert.equal(collect(off, (n) => n.tagName === 'BUTTON').length, 0, 'no button with submissions off');
});

test('a search that finds a gift, or no search at all, offers no missing-item report', () => {
  const idx = buildIndex(dataset);
  for (const search of ['bre', '']) {
    const container = fakeElement('div');
    giftView.render(container, idx, { filters: DEFAULT_FILTERS, search, searchText: search, submissionsEnabled: true, storage: undefined });
    assert.equal(collect(container, (n) => (n.className ?? '').includes('missing-item-button')).length, 0, JSON.stringify(search));
  }
});

test('the missing-item button falls back to the matching text when no typed text is given', () => {
  const idx = buildIndex(dataset);
  const container = fakeElement('div');
  giftView.render(container, idx, { filters: DEFAULT_FILTERS, search: 'zz', submissionsEnabled: true, storage: undefined });
  assert.equal(collect(container, (n) => (n.className ?? '').includes('missing-item-button'))[0].dataset.name, 'zz');
});

test('missingItemButton carries its query where app.js reads it', () => {
  const button = missingItemButton('Lantern Oil');
  assert.equal(button.className, 'missing-item-button');
  assert.equal(button.dataset.name, 'Lantern Oil');
});
