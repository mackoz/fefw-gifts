import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { characterRows, characterIndexModel, characterSummary, signalHeading, provenanceNote } from '../assets/js/views/character.js';
import {
  sortByConfidence, stateLabel, stateClasses, badge, partitionRows, categoryChips, favouriteGifts, chip, reportButton, reportChip,
} from '../assets/js/views/shared.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { giftRows, giftIndexModel, missingItemButton } from '../assets/js/views/gift.js';
import { loadDataset } from '../scripts/validate.mjs';
import { category, gift, character, source } from '../test-support/fixtures.mjs';

// The character most tests observe: one id, one name, everything else default.
const tested = (over = {}) => character({ id: 'p1', name: 'P', ...over });

const dataset = {
  categories: [
    category(),
    category({ id: 'coffee', label: 'Coffee' }),
  ],
  gifts: [
    gift({ id: 'book', name: 'Book' }),
    gift({ id: 'brew', name: 'Brew', category: 'coffee' }),
    gift({ id: 'rock', name: 'Rock', category: null, rarity: null }),
  ],
  characters: [character({ categories: { books: { state: 'profile', source: null } } })],
  observations: [{ id: 'o1', gift: 'brew', character: 'c1', reaction: 'favorite', date: '2026-09-20' }],
  sources: [],
};

test('favorites sort above predictions, which sort above untested', () => {
  const idx = buildIndex(dataset);
  const rows = characterRows(idx, 'c1', DEFAULT_FILTERS);
  assert.deepEqual(rows.map((r) => r.gift.id), ['brew', 'book', 'rock']);
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

// A CONFIRMED slight or liked row used to share rank 1 with a CONFIRMED loved
// row, so "Tested: ..." and "Confirmed: Big gain" rows could interleave in
// whatever order the data happened to list them. Loved now sorts first within
// CONFIRMED, then liked, then slight, then none -- so a player scanning a
// character or gift table for loved results never has to hunt past a "Tested"
// row that data order happened to put above it.
test('sortByConfidence puts loved before liked before slight before none, within CONFIRMED', () => {
  const rows = [
    { gift: { id: 'a-slight' }, confidence: { state: 'CONFIRMED', reaction: 'slight' } },
    { gift: { id: 'b-loved' }, confidence: { state: 'CONFIRMED', reaction: 'loved' } },
    { gift: { id: 'c-none' }, confidence: { state: 'CONFIRMED', reaction: 'none' } },
    { gift: { id: 'd-liked' }, confidence: { state: 'CONFIRMED', reaction: 'liked' } },
    { gift: { id: 'e-favorite' }, confidence: { state: 'FAVORITE', reaction: 'favorite' } },
  ];
  assert.deepEqual(
    sortByConfidence(rows).map((r) => r.gift.id),
    ['e-favorite', 'b-loved', 'd-liked', 'a-slight', 'c-none'],
    'FAVORITE stays first; within CONFIRMED, loved, then liked, then slight, then none',
  );
});

test('sortByConfidence keeps original order for ties within the same reaction', () => {
  const rows = [
    { gift: { id: 'a' }, confidence: { state: 'CONFIRMED', reaction: 'slight' } },
    { gift: { id: 'b' }, confidence: { state: 'CONFIRMED', reaction: 'slight' } },
  ];
  assert.deepEqual(sortByConfidence(rows).map((r) => r.gift.id), ['a', 'b']);

  // Ties among PREDICTED rows, which carry no reaction, also keep their order.
  const predicted = [
    { gift: { id: 'a' }, confidence: { state: 'PREDICTED' } },
    { gift: { id: 'b' }, confidence: { state: 'PREDICTED' } },
  ];
  assert.deepEqual(sortByConfidence(predicted).map((r) => r.gift.id), ['a', 'b']);
});

// I-1: badge() classes a below-loved CONFIRMED row as state-liked/-slight/-none,
// never state-confirmed -- style.css draws state-confirmed with the loved
// tick and tint, and pairing that with a "Tested: ..." label would claim the
// pair reached the loved gain it did not (the exact contradiction the Matrix
// avoids with its own +/–/0 cells). A loved reaction keeps state-confirmed.
test('badge classes a below-loved result as state-liked/state-slight/state-none, never state-confirmed', () => {
  assert.match(stateClasses({ state: 'CONFIRMED', reaction: 'liked' }), /\bstate-liked\b/);
  assert.doesNotMatch(stateClasses({ state: 'CONFIRMED', reaction: 'liked' }), /\bstate-confirmed\b/);
  assert.match(stateClasses({ state: 'CONFIRMED', reaction: 'slight' }), /\bstate-slight\b/);
  assert.doesNotMatch(stateClasses({ state: 'CONFIRMED', reaction: 'slight' }), /\bstate-confirmed\b/);
  assert.match(stateClasses({ state: 'CONFIRMED', reaction: 'none' }), /\bstate-none\b/);
  assert.doesNotMatch(stateClasses({ state: 'CONFIRMED', reaction: 'none' }), /\bstate-confirmed\b/);
  assert.match(stateClasses({ state: 'CONFIRMED', reaction: 'loved' }), /\bstate-confirmed\b/);
  // provenance/is-exception/rarity-mismatch classes are untouched by this change.
  assert.match(
    stateClasses({ state: 'CONFIRMED', reaction: 'slight', isException: true, rarityMismatch: true, provenance: 'guide' }),
    /\bstate-slight\b.*\bprovenance-guide\b.*\bis-exception\b.*\brarity-mismatch\b/,
  );

  const slightBadge = badge({ state: 'CONFIRMED', reaction: 'slight' });
  assert.match(slightBadge.className, /\bstate-slight\b/);
  assert.doesNotMatch(slightBadge.className, /\bstate-confirmed\b/);
  assert.equal(slightBadge.textContent, 'Tested: Small gain');
});

// M2: a play-backed PREDICTED badge (no stored link, no source) explains
// itself the same way a guide prediction does, so a player can see why an
// untested item is "worth trying". A guide prediction keeps its own title,
// and a tested (CONFIRMED) badge gets none at all.
test('badge titles a play-backed prediction as found through play, keeps the guide title, and adds none once tested', () => {
  const ds = {
    categories: [category()],
    gifts: [
      gift({ id: 'a', name: 'A' }),
      gift({ id: 'b', name: 'B' }),
    ],
    characters: [
      character({ name: 'C1' }),
      character({ id: 'c2', name: 'C2', categories: { books: { state: 'guide', source: 'polygon-1' } } }),
    ],
    observations: [{ id: 'o1', gift: 'a', character: 'c1', reaction: 'loved', date: '2026-09-20' }],
    sources: [source()],
  };
  const idx = buildIndex(ds);

  const playBadge = badge(idx.confidenceFor('c1', 'b'), idx);
  assert.equal(playBadge.title, 'Found through play — nobody has tried this item yet.');

  const guideBadge = badge(idx.confidenceFor('c2', 'b'), idx);
  assert.equal(guideBadge.title, 'Prediction carried over from Polygon — no player has confirmed it.');

  const confirmedBadge = badge(idx.confidenceFor('c1', 'a'), idx);
  assert.equal(confirmedBadge.title, undefined);
});

test('giftRows lists giftable characters ranked by confidence', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [
      dataset.characters[0],
      character({ id: 'c2', name: 'D' }),
      character({ id: 'c3', name: 'E', giftable: false }),
    ],
  });
  const rows = giftRows(idx, 'book', DEFAULT_FILTERS);
  assert.deepEqual(rows.map((r) => r.character.id), ['c1', 'c2'], 'non-giftable characters are excluded');
  assert.equal(rows[0].confidence.state, 'PREDICTED');
});

import { matrixModel, SYMBOL, cellState, cellLabel, LEGEND, render as renderMatrix } from '../assets/js/views/matrix.js';

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
      gift({ id: 'cheap', name: 'Cheap Book', rarity: 'common' }),
      gift({ id: 'posh', name: 'Posh Book', rarity: 'rare' }),
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
  categories: [category()],
  gifts: [gift({ id: 'book', name: 'Book' })],
  characters: [character()],
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

// A category is "confirmed" when an approved observation shows the gift
// actually worked, independent of any stored link. `tea` carries no link at
// all here.
const testedBase = {
  categories: [category({ id: 'tea', label: 'Tea' })],
  gifts: [gift({ id: 'chamomile', name: 'Chamomile', category: 'tea', rarity: 'common' })],
  characters: [],
  observations: [],
  sources: [],
};

test('categoryChips promotes a category to tested on a loved observation, even unlinked', () => {
  const idx = buildIndex({
    ...testedBase,
    characters: [tested()],
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' }],
  });
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
    { id: 'tea', label: 'Tea', state: 'confirmed', source: null },
  ]);
});

// Each row is a result that must leave the character with no category chip at
// all. `testedBase` has no stored link for `tea`, so "no chip" means nothing
// promoted it.
for (const { name, data, observations } of [
  // The report form's first option is "They didn't like it": a CONFIRMED "none"
  // reaction is a real, reviewed result, but not a positive one, so it must
  // never promote the category -- and with no stored link, no chip at all.
  {
    name: 'a CONFIRMED "none" reaction never counts as tested',
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'none', date: '2026-09-23' }],
  },
  // A `slight` reaction is a real, approved, positive result, but it is weaker
  // than `loved` and must not promote the category on its own -- only `loved`
  // does. See categoryVerdicts in shared.js.
  {
    name: 'a slight reaction does not count as confirmed',
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'slight', date: '2026-09-23' }],
  },
  // Same as `slight`: a real, approved, positive result that still stops short
  // of confirming the whole category.
  {
    name: 'a liked reaction does not count as confirmed',
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'liked', date: '2026-09-23' }],
  },
  // A gift with no category (e.g. `rock` in the main fixture) can never be
  // promoted, no matter how positive the result on it is -- there is no
  // category to add to the confirmed set.
  {
    name: 'a gift with no category is never promoted, even with an approved loved result',
    data: {
      categories: [],
      gifts: [gift({ id: 'mystery', name: 'Mystery', category: null, rarity: null })],
      sources: [],
    },
    observations: [{ id: 'o1', character: 'p1', gift: 'mystery', reaction: 'loved', date: '2026-09-23' }],
  },
  {
    name: 'a contested pair never counts as tested',
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'chamomile', reaction: 'none', date: '2026-09-23' },
    ],
  },
]) {
  test(name, () => {
    const idx = buildIndex({ ...testedBase, ...data, characters: [tested()], observations });
    assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), []);
  });
}

// A favourite reaction is specific to that item -- it says
// something about that ITEM, not its category, so it must never promote the
// whole category to confirmed. See categoryVerdicts's comment in shared.js,
// and CLAUDE.md's "A favourite is about the item; only loved results confirm
// a category." `chamomile` (from testedBase) is `common` on purpose: a
// favourite can happen on a gift of any rarity, and this is the fixture that
// proves the common case specifically, not just uncommon/rare ones.
test('categoryChips does not promote a category on a FAVORITE observation, even on a common gift', () => {
  assert.equal(testedBase.gifts[0].rarity, 'common', 'this test is only meaningful while chamomile stays common');
  const idx = buildIndex({
    ...testedBase,
    characters: [tested()],
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'favorite', date: '2026-09-23' }],
  });
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), []);
});

// A pending report is a real player's result, but nobody has reviewed it yet
// -- see CLAUDE.md's "A pending report is not a confirmation." It must not be
// able to promote a category on its own.
test('a pending report never counts as tested', () => {
  const idx = buildIndex(
    { ...testedBase, characters: [tested()] },
    [{ id: 'r1', character: 'p1', gift: 'chamomile', reaction: 'loved', created_at: '2026-09-23' }],
  );
  assert.equal(idx.confidenceFor('p1', 'chamomile').state, 'PENDING');
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), []);
});

test('a tested category with a guide link keeps the link’s source and is not duplicated', () => {
  const idx = buildIndex({
    ...testedBase,
    characters: [tested({ categories: { tea: { state: 'guide', source: 'polygon-1' } } })],
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' }],
    sources: [source()],
  });
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
    { id: 'tea', label: 'Tea', state: 'confirmed', source: 'polygon-1' },
  ]);
});

// A refuted link is a guide's guess that the gift will NOT land -- but an
// approved observation that it actually worked outranks that guess.
test('a refuted link with an approved positive result shows as tested, not dropped', () => {
  const idx = buildIndex({
    ...testedBase,
    characters: [tested({ categories: { tea: { state: 'refuted', source: 'polygon-1' } } })],
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' }],
    sources: [source()],
  });
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
    { id: 'tea', label: 'Tea', state: 'confirmed', source: 'polygon-1' },
  ]);
});

// Categories are deliberately out of alphabetical/insertion order here so the
// tested group's ordering (categories.json position) can't be confused with
// either. `books` is both linked and tested, so it must appear once, in the
// tested group, ahead of `coffee`, which stays a plain link chip.
test('tested chips are ordered by categories.json position and precede link-only chips', () => {
  const orderedDataset = {
    categories: [
      category({ id: 'tea', label: 'Tea' }),
      category(),
      category({ id: 'coffee', label: 'Coffee' }),
    ],
    gifts: [
      gift({ id: 'chamomile', name: 'Chamomile', category: 'tea' }),
      gift({ id: 'novel', name: 'Novel' }),
      gift({ id: 'espresso', name: 'Espresso', category: 'coffee' }),
    ],
    characters: [tested({
      categories: {
        books: { state: 'guide', source: 'polygon-1' },
        coffee: { state: 'guide', source: 'polygon-1' },
      },
    })],
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'novel', reaction: 'loved', date: '2026-09-23' },
    ],
    sources: [source()],
  };
  const idx = buildIndex(orderedDataset);
  const chips = categoryChips(idx, idx.byCharacterId.get('p1'));
  assert.deepEqual(chips.map((c) => ({ id: c.id, state: c.state })), [
    { id: 'tea', state: 'confirmed' },
    { id: 'books', state: 'confirmed' },
    { id: 'coffee', state: 'guide' },
  ]);
});

// A category with two gifts, so a loved result on one and something weaker
// on the other can coexist -- the single-gift `testedBase` fixture above
// cannot produce a mixed verdict at all.
const mixedBase = {
  categories: [category({ id: 'tea', label: 'Tea' })],
  gifts: [
    gift({ id: 'chamomile', name: 'Chamomile', category: 'tea' }),
    gift({ id: 'green-tea', name: 'Green Tea', category: 'tea', rarity: 'uncommon' }),
  ],
  characters: [],
  observations: [],
  sources: [],
};

// A category with a loved result and something weaker is not a uniform hit,
// but it is not nothing either -- see CLAUDE.md's "A favourite is about the
// item; only loved results confirm a category." One test per weaker reaction
// the report form can produce.
for (const weaker of ['slight', 'liked', 'none']) {
  test(`loved plus ${weaker} in the same category shows as mixed`, () => {
    const idx = buildIndex({
      ...mixedBase,
      characters: [tested()],
      observations: [
        { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
        { id: 'o2', character: 'p1', gift: 'green-tea', reaction: weaker, date: '2026-09-23' },
      ],
    });
    assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
      { id: 'tea', label: 'Tea', state: 'mixed', source: null },
    ]);
  });
}

// Alongside a loved result, none of these may drag the category down to mixed
// (and a reaction the code does not recognise must not either).
// Each row also checks the state of the second gift, so a row cannot pass just
// because the second gift was never counted at all.
for (const { name, pending = [], observations, state } of [
  // A FAVORITE result is about the item, not the category (see favouriteGifts),
  // so it must never drag a loved category down to mixed.
  {
    name: 'loved plus favorite in the same category stays confirmed, not mixed',
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'favorite', date: '2026-09-23' },
    ],
    state: 'FAVORITE',
  },
  // A pending or contested pair is real signal elsewhere, but neither is an
  // approved result -- see CLAUDE.md's "A pending report is not a
  // confirmation." Alongside a loved result, it must not turn the category
  // mixed.
  {
    name: 'loved plus a pending report in the same category stays confirmed',
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' }],
    pending: [{ id: 'r1', character: 'p1', gift: 'green-tea', reaction: 'none' }],
    state: 'PENDING',
  },
  {
    name: 'loved plus a contested pair in the same category stays confirmed',
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'loved', date: '2026-09-23' },
      { id: 'o3', character: 'p1', gift: 'green-tea', reaction: 'none', date: '2026-09-23' },
    ],
    state: 'CONTESTED',
  },
  // The second gift in the category has no observation at all -- the loved
  // result only predicts it (worth trying), which is not a result, so it must
  // not pull a loved category down to mixed either.
  {
    name: 'loved plus an untested gift in the same category stays confirmed',
    observations: [{ id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' }],
    state: 'PREDICTED',
  },
  // Today a CONFIRMED pair only ever carries `liked`,
  // `slight` or `none` -- `deriveConfidence` turns a `favorite` reaction into
  // its own FAVORITE state -- so treating "any non-loved CONFIRMED reaction"
  // as below-loved happens to agree with the explicit list. If a new reaction
  // tier is ever added without updating this list, it must NOT silently count
  // as below-loved. `unknown-tier` stands in for that not-yet-invented tier:
  // it bypasses the report form and validate.mjs (which would reject it), the
  // same way this file's other fixtures construct data directly.
  {
    name: 'an unrecognised CONFIRMED reaction is neither loved nor below-loved',
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'unknown-tier', date: '2026-09-23' },
    ],
    state: 'CONFIRMED',
  },
]) {
  test(name, () => {
    const idx = buildIndex({ ...mixedBase, characters: [tested()], observations }, pending);
    assert.equal(idx.confidenceFor('p1', 'green-tea').state, state);
    assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
      { id: 'tea', label: 'Tea', state: 'confirmed', source: null },
    ]);
  });
}

// Testing outranks a stored link the same way it does for a confirmed
// category (see the guide/refuted tests above): a mixed verdict still keeps
// the link's source rather than discarding it.
test('a mixed category with a guide link keeps the link’s source', () => {
  const idx = buildIndex({
    ...mixedBase,
    characters: [tested({ categories: { tea: { state: 'guide', source: 'polygon-1' } } })],
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'slight', date: '2026-09-23' },
    ],
    sources: [source()],
  });
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
    { id: 'tea', label: 'Tea', state: 'mixed', source: 'polygon-1' },
  ]);
});

// A refuted link is a guide's guess that the gift will NOT land -- but a
// mixed verdict is still testing, and testing outranks a refuted guess the
// same way a confirmed verdict does.
test('a mixed verdict replaces a refuted link rather than being dropped', () => {
  const idx = buildIndex({
    ...mixedBase,
    characters: [tested({ categories: { tea: { state: 'refuted', source: 'polygon-1' } } })],
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'liked', date: '2026-09-23' },
    ],
    sources: [source()],
  });
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('p1')), [
    { id: 'tea', label: 'Tea', state: 'mixed', source: 'polygon-1' },
  ]);
});

// Confirmed leads, then mixed, then whatever stored links are left over --
// each group sorted by categories.json position, never by insertion order.
test('categoryChips orders confirmed chips, then mixed chips, then stored links', () => {
  const orderedDataset = {
    categories: [
      category({ id: 'tea', label: 'Tea' }),
      category(),
      category({ id: 'herbs', label: 'Herbs' }),
      category({ id: 'coffee', label: 'Coffee' }),
    ],
    gifts: [
      gift({ id: 'chamomile', name: 'Chamomile', category: 'tea' }),
      gift({ id: 'green-tea', name: 'Green Tea', category: 'tea', rarity: 'uncommon' }),
      gift({ id: 'novel', name: 'Novel' }),
      gift({ id: 'basil', name: 'Basil', category: 'herbs' }),
      gift({ id: 'espresso', name: 'Espresso', category: 'coffee' }),
    ],
    characters: [tested({ categories: { coffee: { state: 'guide', source: 'polygon-1' } } })],
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'slight', date: '2026-09-23' },
      { id: 'o3', character: 'p1', gift: 'novel', reaction: 'loved', date: '2026-09-23' },
      { id: 'o4', character: 'p1', gift: 'basil', reaction: 'loved', date: '2026-09-23' },
    ],
    sources: [source()],
  };
  const idx = buildIndex(orderedDataset);
  const chips = categoryChips(idx, idx.byCharacterId.get('p1'));
  assert.deepEqual(chips.map((c) => ({ id: c.id, state: c.state })), [
    { id: 'books', state: 'confirmed' },
    { id: 'herbs', state: 'confirmed' },
    { id: 'tea', state: 'mixed' },
    { id: 'coffee', state: 'guide' },
  ]);
});

// The ordering test above has only one mixed chip, so
// dropping `.sort(byPosition)` on mixed chips specifically would still pass
// it. Here `tea`'s gifts come first in `index.gifts` (and so would be the
// first category the loop encounters and adds to the `loved`/`mixed` sets),
// but `tea` sits AFTER `poems` in categories.json -- so relying on gift or
// Set-insertion order instead of `.sort(byPosition)` would render
// [tea, poems], the wrong way round.
test('mixed chips are sorted by categories.json position, not by gift or insertion order', () => {
  const orderedDataset = {
    categories: [
      category({ id: 'poems', label: 'Poems' }),
      category({ id: 'tea', label: 'Tea' }),
    ],
    gifts: [
      gift({ id: 'green-tea', name: 'Green Tea', category: 'tea' }),
      gift({ id: 'chamomile', name: 'Chamomile', category: 'tea' }),
      gift({ id: 'poem-a', name: 'Poem A', category: 'poems' }),
      gift({ id: 'poem-b', name: 'Poem B', category: 'poems' }),
    ],
    characters: [tested()],
    observations: [
      { id: 'o1', character: 'p1', gift: 'green-tea', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'chamomile', reaction: 'slight', date: '2026-09-23' },
      { id: 'o3', character: 'p1', gift: 'poem-a', reaction: 'loved', date: '2026-09-23' },
      { id: 'o4', character: 'p1', gift: 'poem-b', reaction: 'liked', date: '2026-09-23' },
    ],
    sources: [],
  };
  const idx = buildIndex(orderedDataset);
  const chips = categoryChips(idx, idx.byCharacterId.get('p1'));
  assert.deepEqual(chips.map((c) => c.id), ['poems', 'tea']);
});

// favouriteGifts mirrors favoritesModel's found-list union, one character at
// a time, so a card or profile can never disagree with the Favourites tab.
test('favouriteGifts: observed only', () => {
  const idx = buildIndex(dataset);
  // c1's one observation is a FAVORITE on `brew`.
  assert.deepEqual(favouriteGifts(idx, idx.byCharacterId.get('c1')).map((g) => g.id), ['brew']);
});

test('favouriteGifts: declared only', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [],
    characters: [{ ...dataset.characters[0], favorites: ['book'] }],
  });
  assert.deepEqual(favouriteGifts(idx, idx.byCharacterId.get('c1')).map((g) => g.id), ['book']);
});

test('favouriteGifts: observed and declared overlap without duplicating', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], favorites: ['brew', 'book'] }],
  });
  // 'brew' is both observed FAVORITE and declared: it must appear exactly once.
  assert.deepEqual(favouriteGifts(idx, idx.byCharacterId.get('c1')).map((g) => g.id), ['brew', 'book']);
});

test('favouriteGifts drops an unknown declared id rather than crashing', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [],
    characters: [{ ...dataset.characters[0], favorites: ['no-such-gift'] }],
  });
  assert.deepEqual(favouriteGifts(idx, idx.byCharacterId.get('c1')), []);
});

test('favouriteGifts on a character with no id counts only declared favourites', () => {
  const idx = buildIndex(dataset);
  assert.deepEqual(favouriteGifts(idx, { favorites: ['book'] }).map((g) => g.id), ['book']);
});

// A pending report is a real player's result, but nobody has reviewed it
// yet -- see CLAUDE.md's "A pending report is not a confirmation." It must
// not be able to make a favourite on its own.
test('a pending favourite report is not a favourite', () => {
  const idx = buildIndex(OVERLAY_DATASET, [{ id: 'r1', character: 'c1', gift: 'book', reaction: 'favorite' }]);
  assert.equal(idx.confidenceFor('c1', 'book').state, 'PENDING');
  assert.deepEqual(favouriteGifts(idx, idx.byCharacterId.get('c1')), []);
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

// Renders a view into a fresh fake container and returns the container. Every
// view's render takes (container, index, state).
function renderView(render, idx, state) {
  const container = fakeElement('div');
  render(container, idx, state);
  return container;
}

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

// Each row builds one index from the shared `dataset` plus its overrides and
// compares the one summary string for c1.
for (const { name, over = {}, expected } of [
  {
    name: 'characterSummary reports the strongest true thing, never a negative',
    // The fixture's c1 has one favourite observation on `brew`.
    expected: '1 favourite',
  },
  {
    name: 'characterSummary counts a declared favourite the Favourites tab would count',
    over: { characters: [{ ...dataset.characters[0], favorites: ['rock'] }], observations: [] },
    expected: '1 favourite',
  },
  // A character whose only category link is refuted has a guide guess that the
  // gift will NOT land. That must never surface as "worth trying" -- see
  // suggestionsFor in favorites.js, which this is made to agree with.
  {
    name: 'characterSummary does not count a refuted-category prediction as worth trying',
    over: {
      characters: [{ ...dataset.characters[0], categories: { books: { state: 'refuted', source: 'polygon' } } }],
      observations: [],
    },
    expected: 'nothing tested yet',
  },
  // A `slight` result alongside a `loved` one must not inflate the loved count
  // -- only the loved gift counts, and the slight one is silently absorbed
  // rather than surfaced, since a favourite-free "N loved" summary has nowhere
  // to mention "tested" too. See characterSummary's file comment.
  {
    name: 'characterSummary counts loved separately from a slight result on another gift',
    over: {
      observations: [
        { id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-23' },
        { id: 'o2', character: 'c1', gift: 'brew', reaction: 'slight', date: '2026-09-23' },
      ],
    },
    expected: '1 loved',
  },
  {
    name: 'characterSummary counts liked and slight together as "N tested" when nothing is loved',
    over: {
      observations: [
        { id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-23' },
        { id: 'o2', character: 'c1', gift: 'brew', reaction: 'slight', date: '2026-09-23' },
      ],
    },
    expected: '2 tested, none loved yet',
  },
  // A favourite is about one specific item; a loved count is about how many
  // gifts overall land a big bond gain. Neither replaces the other, so both
  // show at once once both are true.
  {
    name: 'characterSummary reports a favourite alongside a loved count, not instead of it',
    over: {
      gifts: [...dataset.gifts, gift({ id: 'tome', name: 'Tome' })],
      observations: [
        { id: 'o1', character: 'c1', gift: 'brew', reaction: 'favorite', date: '2026-09-20' },
        { id: 'o2', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-23' },
        { id: 'o3', character: 'c1', gift: 'tome', reaction: 'loved', date: '2026-09-23' },
      ],
    },
    expected: '1 favourite, 2 loved',
  },
  // A gift can be both a declared favourite AND carry its
  // own approved `loved` observation -- contradictory data the validator
  // doesn't cross-check. Before this fix it counted in both buckets, reading
  // "1 favourite, 1 loved" for what is really one item.
  {
    name: 'characterSummary does not double-count a loved gift that is also a favourite',
    over: {
      characters: [{ ...dataset.characters[0], favorites: ['book'] }],
      observations: [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-23' }],
    },
    expected: '1 favourite',
  },
  // "2 favourites, N loved" pluralisation is never
  // exercised elsewhere, so hard-coding the singular "favourite" would survive
  // every other test here.
  {
    name: 'characterSummary pluralises "favourites" alongside a loved count',
    // Favourites: observed `brew` (FAVORITE) plus declared `rock` -- two distinct items.
    over: {
      gifts: [...dataset.gifts, gift({ id: 'tome', name: 'Tome' })],
      characters: [{ ...dataset.characters[0], favorites: ['rock'] }],
      observations: [
        { id: 'o1', character: 'c1', gift: 'brew', reaction: 'favorite', date: '2026-09-20' },
        { id: 'o2', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-23' },
        { id: 'o3', character: 'c1', gift: 'tome', reaction: 'loved', date: '2026-09-23' },
      ],
    },
    expected: '2 favourites, 2 loved',
  },
  {
    name: 'characterSummary pluralises "favourites" with no loved results either',
    over: {
      characters: [{ ...dataset.characters[0], favorites: ['rock'] }],
      observations: [{ id: 'o1', character: 'c1', gift: 'brew', reaction: 'favorite', date: '2026-09-20' }],
    },
    expected: '2 favourites',
  },
]) {
  test(name, () => {
    const idx = buildIndex({ ...dataset, ...over });
    assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), expected);
  });
}

// This one builds four indexes and makes four assertions, so it stays a single test.
test('characterSummary falls back through loved, tested, predicted, then nothing', () => {
  const base = { ...dataset.characters[0], favorites: [] };

  const predictedOnly = buildIndex({ ...dataset, characters: [base], observations: [] });
  // c1 likes books, and `book` is a books item, so exactly one prediction.
  assert.equal(characterSummary(predictedOnly, predictedOnly.byCharacterId.get('c1')), '1 worth trying');

  // A `liked` reaction is a real, approved CONFIRMED result, but it is not a
  // `loved` one -- see the minmax-bond rationale in characterSummary's
  // comment -- so it falls into "tested", not "loved".
  const tested = buildIndex({
    ...dataset,
    characters: [base],
    observations: [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }],
  });
  assert.equal(characterSummary(tested, tested.byCharacterId.get('c1')), '1 tested, none loved yet');

  const loved = buildIndex({
    ...dataset,
    characters: [base],
    observations: [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-21' }],
  });
  assert.equal(characterSummary(loved, loved.byCharacterId.get('c1')), '1 loved');

  const bare = buildIndex({ ...dataset, characters: [{ ...base, categories: {} }], observations: [] });
  assert.equal(characterSummary(bare, bare.byCharacterId.get('c1')), 'nothing tested yet');
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
  // c1's one observation is a FAVORITE on `brew` (coffee) -- a favourite is
  // about that item, not its category, so coffee stays unconfirmed and
  // unlinked, leaving only the profile-linked `books` chip.
  assert.deepEqual(entry.categories.map((c) => ({ label: c.label, state: c.state })), [
    { label: 'Books', state: 'profile' },
  ]);
});

test('characterIndexModel carries the favourite gifts for each character, in order', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], favorites: ['book'] }],
  });
  const [entry] = characterIndexModel(idx, DEFAULT_FILTERS, '');
  // Observed 'brew' (FAVORITE) leads, since it comes first in index.gifts
  // order; the declared 'book' follows.
  assert.deepEqual(entry.favourites.map((g) => g.id), ['brew', 'book']);
});

// Render-level check on the index card: c1's favourite ('brew', observed
// FAVORITE) must render first, ahead of its one category chip ('books',
// profile-linked), inside a single list carrying both the chip-list and
// character-chips classes.
test('the index card renders favourite chips before category chips, in one character-chips list', () => {
  const idx = buildIndex(dataset);
  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false });

  const list = findFirst(container, (n) => (n.className ?? '').includes('character-chips'));
  assert.ok(list, 'the card should render a character-chips list');
  assert.match(list.className, /\bchip-list\b/);

  const chips = list.children.map((li) => li.children[0]);
  assert.deepEqual(chips.map((c) => c.textContent), ['Brew', 'Books']);
  assert.match(chips[0].className, /\bchip-favourite\b/, 'the favourite chip leads');
  assert.equal(chips[0].href, '#/gift/brew');
  assert.doesNotMatch(chips[1].className, /\bchip-favourite\b/, 'a category chip is not a favourite chip');
});

// Render-level check on the detail page: the Favourites heading and list must
// come before "Reported to like", and the favourite chip must carry the same
// chip-favourite class the Favourites tab uses.
test('the character detail page renders a Favourites block before Reported to like', () => {
  const idx = buildIndex(dataset);
  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'c1' });

  const headings = collect(container, (n) => n.tagName === 'H3').map((n) => n.textContent);
  assert.deepEqual(
    headings.filter((h) => h === 'Favourites' || h === 'Reported to like'),
    ['Favourites', 'Reported to like'],
    'Favourites must precede Reported to like',
  );

  const favouriteChip = findFirst(container, (n) => (n.className ?? '').includes('chip-favourite'));
  assert.ok(favouriteChip, 'the page should render a favourite chip');
  assert.equal(favouriteChip.textContent, 'Brew');
  assert.equal(favouriteChip.href, '#/gift/brew');

  const favouritesList = findFirst(container, (n) => (n.className ?? '').includes('character-chips')
    && n.children.some((li) => li.children[0]?.className?.includes('chip-favourite')));
  assert.equal(favouritesList.getAttribute('role'), 'list');
});

// renderPicker's card guard is `entry.favourites.length || entry.categories.length`.
// No other fixture pairs a declared favourite with zero category chips, so a
// mutant that drops the favourites half of the guard (rendering the chip list
// only when there is a category chip) passed every other test in this file.
test('the index card renders a favourite chip even when it has no category chips', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], categories: {}, favorites: ['book'] }],
    observations: [],
  });
  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false });

  const list = findFirst(container, (n) => (n.className ?? '').includes('character-chips'));
  assert.ok(list, 'a favourite with zero category chips must still render the chip list');
  const chips = list.children.map((li) => li.children[0]);
  assert.deepEqual(chips.map((c) => c.textContent), ['Book']);
  assert.match(chips[0].className, /\bchip-favourite\b/);
});

// renderProfile's Favourites block is guarded by `favourites.length > 0`.
// A mutant that weakens this to `>= 0` renders an empty Favourites heading and
// list on every character page, and no existing test caught it.
test('a character detail page with no favourites renders no Favourites heading', () => {
  const idx = buildIndex({ ...dataset, observations: [] });
  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'c1' });

  const heading = findFirst(container, (n) => n.tagName === 'H3' && n.textContent === 'Favourites');
  assert.equal(heading, undefined, 'no favourites means no Favourites heading');
});

// renderProfile calls chipList(chips) with no favourites argument for
// "Reported to like" -- a mutant that passes favourites through as well would
// duplicate the star chip(s) under that heading, and no existing test caught it.
test('the "Reported to like" list carries no favourite chips, even when the page has some', () => {
  const idx = buildIndex(dataset);
  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'c1' });

  const lists = collect(container, (n) => (n.className ?? '').includes('character-chips'));
  assert.equal(lists.length, 2, 'a Favourites list and a Reported-to-like list');
  const reportedToLike = lists[1];
  const hasFavouriteChip = reportedToLike.children.some((li) => li.children[0]?.className?.includes('chip-favourite'));
  assert.equal(hasFavouriteChip, false, 'the Reported to like list must not duplicate favourite chips');
});

// A mixed chip is visually identical to a profile chip
// (and confirmed to discovered), and font weight/border style -- the only
// visual cues -- reach no screen reader at all. Every category chip needs a
// hover title and a hidden text suffix naming its actual state; a favourite
// chip gets only the title, since the CSS already speaks "Favourite:" as
// alt text and a hidden suffix too would repeat it.
test('every character chip carries a state title, and a hidden suffix except favourites', () => {
  const idx = buildIndex({
    categories: [
      category({ id: 'tea', label: 'Tea' }),
      category({ id: 'coffee', label: 'Coffee' }),
      category(),
    ],
    gifts: [
      gift({ id: 'chamomile', name: 'Chamomile', category: 'tea' }),
      gift({ id: 'green-tea', name: 'Green Tea', category: 'tea' }),
      gift({ id: 'espresso', name: 'Espresso', category: 'coffee' }),
      gift({ id: 'novel', name: 'Novel' }),
      gift({ id: 'trinket', name: 'Trinket', category: null, rarity: 'rare' }),
    ],
    characters: [tested({ categories: { books: { state: 'guide', source: 'polygon-1' } }, favorites: ['trinket'] })],
    observations: [
      { id: 'o1', character: 'p1', gift: 'chamomile', reaction: 'loved', date: '2026-09-23' },
      { id: 'o2', character: 'p1', gift: 'green-tea', reaction: 'slight', date: '2026-09-23' },
      { id: 'o3', character: 'p1', gift: 'espresso', reaction: 'loved', date: '2026-09-23' },
    ],
    sources: [source()],
  });

  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'p1' });

  const lists = collect(container, (n) => (n.className ?? '').includes('character-chips'));
  assert.equal(lists.length, 2, 'a Favourites list and a Reported-to-like list');
  const [favouritesList, reportedToLike] = lists;

  const favouriteChip = favouritesList.children[0].children[0];
  assert.equal(favouriteChip.title, 'Favourite');
  assert.equal(
    collect(favouriteChip, (n) => (n.className ?? '').includes('visually-hidden')).length,
    0,
    'a favourite chip gets no hidden suffix',
  );

  const byLabel = Object.fromEntries(reportedToLike.children.map((li) => {
    const node = li.children[0];
    return [node.textContent, node];
  }));

  assert.equal(byLabel.Coffee.title, 'loved in testing');
  assert.equal(collect(byLabel.Coffee, (n) => (n.className ?? '').includes('visually-hidden'))[0].textContent, ', loved in testing');

  assert.equal(byLabel.Tea.title, 'mixed results');
  assert.equal(collect(byLabel.Tea, (n) => (n.className ?? '').includes('visually-hidden'))[0].textContent, ', mixed results');

  assert.equal(byLabel.Books.title, 'predicted from a guide');
  assert.equal(collect(byLabel.Books, (n) => (n.className ?? '').includes('visually-hidden'))[0].textContent, ', predicted from a guide');
});

// A character's category chips mix three different claims -- a guide's guess,
// an in-game profile listing, and something a player actually found -- and the
// note must say which is which rather than calling everything "carried over".
// See CLAUDE.md's "Guide-derived links always carry provenance."
const provenanceIndex = buildIndex({
  categories: [
    category(),
    category({ id: 'coffee', label: 'Coffee' }),
    category({ id: 'tea', label: 'Tea' }),
    category({ id: 'drinks', label: 'Fermented Drinks' }),
    category({ id: 'snacks', label: 'Snacks' }),
  ],
  gifts: [],
  characters: [],
  observations: [],
  sources: [
    source(),
    source({ id: 'game8-1', publisher: 'Game8', retrieved: '2026-09-23' }),
  ],
});

const guideChip = (id, label, source) => ({ id, label, state: 'guide', source });
const discoveredChip = (id, label) => ({ id, label, state: 'discovered', source: null });
const profileChip = (id, label) => ({ id, label, state: 'profile', source: null });
const confirmedChip = (id, label, source = null) => ({ id, label, state: 'confirmed', source });
const mixedChip = (id, label) => ({ id, label, state: 'mixed', source: null });

for (const { name, chips, expected } of [
  {
    name: 'guide-only, one publisher',
    chips: [guideChip('books', 'Books', 'polygon-1')],
    expected: 'Category preferences carried over from Polygon. They’re predictions until a player reports loving an item in that category.',
  },
  {
    name: 'guide-only, two publishers',
    chips: [guideChip('books', 'Books', 'polygon-1'), guideChip('coffee', 'Coffee', 'game8-1')],
    expected: 'Category preferences carried over from Polygon and Game8. They’re predictions until a player reports loving an item in that category.',
  },
  {
    name: 'guide plus one discovered',
    chips: [discoveredChip('drinks', 'Fermented Drinks'), guideChip('books', 'Books', 'polygon-1')],
    expected: 'Fermented Drinks was found through play. The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
  {
    name: 'guide plus two discovered',
    chips: [
      discoveredChip('books', 'Books'),
      discoveredChip('coffee', 'Coffee'),
      guideChip('tea', 'Tea', 'polygon-1'),
    ],
    expected: 'Books and Coffee were found through play. The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
  {
    name: 'guide plus three discovered',
    chips: [
      discoveredChip('books', 'Books'),
      discoveredChip('coffee', 'Coffee'),
      discoveredChip('tea', 'Tea'),
      guideChip('snacks', 'Snacks', 'polygon-1'),
    ],
    expected: 'Books, Coffee and Tea were found through play. The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
  {
    name: 'discovered only',
    chips: [discoveredChip('books', 'Books')],
    expected: 'Found through play.',
  },
  {
    name: 'profile only, one',
    chips: [profileChip('snacks', 'Snacks')],
    expected: 'Snacks is on the in-game profile.',
  },
  {
    name: 'discovered plus profile, no guide',
    chips: [discoveredChip('drinks', 'Fermented Drinks'), profileChip('snacks', 'Snacks')],
    expected: 'Fermented Drinks was found through play. Snacks is on the in-game profile.',
  },
  {
    name: 'empty chips returns an empty string',
    chips: [],
    expected: '',
  },
  {
    name: 'confirmed only, one category',
    chips: [confirmedChip('books', 'Books')],
    expected: 'Books has at least one gift loved in testing.',
  },
  {
    name: 'confirmed only, two categories',
    chips: [confirmedChip('books', 'Books'), confirmedChip('coffee', 'Coffee')],
    expected: 'Each has at least one gift loved in testing.',
  },
  {
    name: 'confirmed plus guide demotes the guide sentence to "the rest"',
    chips: [confirmedChip('books', 'Books'), guideChip('coffee', 'Coffee', 'polygon-1')],
    expected: 'Books has at least one gift loved in testing. The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
  {
    name: 'confirmed plus discovered no longer says "Found through play."',
    chips: [confirmedChip('books', 'Books'), discoveredChip('coffee', 'Coffee')],
    expected: 'Books has at least one gift loved in testing. Coffee was found through play.',
  },
  // The confirmed-only sentence's "only group" check must actually look at
  // profile chips, not just discovered/guide -- otherwise a confirmed category
  // sitting next to a profile one would wrongly take the bare "Each has..."
  // form instead of naming the category.
  {
    name: 'confirmed plus profile',
    chips: [confirmedChip('books', 'Books'), profileChip('snacks', 'Snacks')],
    expected: 'Books has at least one gift loved in testing. Snacks is on the in-game profile.',
  },
  {
    name: 'two confirmed categories plus guide uses "each have"',
    chips: [confirmedChip('books', 'Books'), confirmedChip('coffee', 'Coffee'), guideChip('tea', 'Tea', 'polygon-1')],
    expected: 'Books and Coffee each have at least one gift loved in testing. The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
  // Same "each have" form, but the other group present is profile rather than
  // guide -- pins that the "only group" check for 2+ confirmed chips reads
  // profile too, not just discovered/guide (see the M-2 test above for the
  // 1-chip case).
  {
    name: 'two confirmed categories plus profile uses "each have"',
    chips: [confirmedChip('books', 'Books'), confirmedChip('coffee', 'Coffee'), profileChip('snacks', 'Snacks')],
    expected: 'Books and Coffee each have at least one gift loved in testing. Snacks is on the in-game profile.',
  },
  {
    name: 'mixed only, one category',
    chips: [mixedChip('books', 'Books')],
    expected: 'Books has mixed results: at least one gift was loved, others less so.',
  },
  // The spec's own worked example: confirmed Cooking, mixed Books, guide
  // Fishing -- pins the exact sentence order and wording across all three
  // groups at once.
  {
    name: 'confirmed plus mixed plus guide reads in strength order',
    chips: [confirmedChip('cooking', 'Cooking'), mixedChip('books', 'Books'), guideChip('fishing', 'Fishing', 'polygon-1')],
    expected: 'Cooking has at least one gift loved in testing. Books has mixed results: at least one gift was loved, others less so. '
      + 'The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
  // A mixed chip is still a "stronger than a stored link" group -- alongside
  // it, discovered must use its labelled form, never the bare "Found through
  // play." reserved for when discovered is the only group.
  {
    name: 'discovered plus mixed uses the labelled discovered form',
    chips: [discoveredChip('drinks', 'Fermented Drinks'), mixedChip('books', 'Books')],
    expected: 'Books has mixed results: at least one gift was loved, others less so. Fermented Drinks was found through play.',
  },
  // Same guard on the guide side: a mixed chip must demote the guide sentence
  // to "The rest are ..." exactly like a confirmed, discovered or profile chip
  // would.
  {
    name: 'guide plus mixed uses "The rest are ..." form',
    chips: [guideChip('books', 'Books', 'polygon-1'), mixedChip('coffee', 'Coffee')],
    expected: 'Coffee has mixed results: at least one gift was loved, others less so. '
      + 'The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  },
]) {
  test(`provenanceNote: ${name}`, () => {
    assert.equal(provenanceNote(provenanceIndex, chips), expected);
  });
}

// These two assert more than the note's text, so they stay their own tests.
test('provenanceNote: mixed only, two categories', () => {
  const chips = [mixedChip('books', 'Books'), mixedChip('coffee', 'Coffee')];
  const note = provenanceNote(provenanceIndex, chips);
  assert.equal(note, 'Books and Coffee have mixed results: at least one gift was loved, others less so.');
  // A mixed-only note is neither an "Each has..." confirmed note nor a bare
  // discovered one -- mixed is its own group with its own sentence.
  assert.doesNotMatch(note, /Each has/);
  assert.doesNotMatch(note, /Found through play/);
});

// Removing the `mixed.length === 0 &&` guard from the
// 2+ confirmed "only group" check survives every other test here, because a
// mixed chip alongside 2+ confirmed ones still reads as (technically) true
// under the bare "Each has..." wording. Pins that a mixed chip must still
// force the labelled "X and Y each have..." form, exactly like a discovered,
// profile or guide chip would.
test('provenanceNote: two confirmed categories plus a mixed chip uses "each have", not "Each has"', () => {
  const chips = [confirmedChip('books', 'Books'), confirmedChip('coffee', 'Coffee'), mixedChip('tea', 'Tea')];
  const note = provenanceNote(provenanceIndex, chips);
  assert.equal(
    note,
    'Books and Coffee each have at least one gift loved in testing. Tea has mixed results: at least one gift was loved, others less so.',
  );
  assert.doesNotMatch(note, /Each has/);
});

// A refuted-category prediction is a guess the gift will NOT land. Counting it
// toward "Worth trying" would invite players to spend gifts on items a guide
// says will not work -- the inverse of this project's core rule. But the
// answer is not "What we know" either: these rows are still pure guesswork,
// and that heading may only appear over something somebody observed.
test('signalHeading does not call a refuted-category prediction "worth trying"', () => {
  // A lone positive prediction is "Worth trying", and one observed row
  // alongside a guess is what earns "What we know".
  assert.equal(signalHeading([{ confidence: { state: 'PREDICTED', predicted: 'positive' } }]), 'Worth trying');
  assert.equal(
    signalHeading([
      { confidence: { state: 'PREDICTED', predicted: 'positive' } },
      { confidence: { state: 'CONFIRMED' } },
    ]),
    'What we know',
  );
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
    gifts: [gift({ id: 'b1', name: 'B1', category: null, rarity: null })],
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

// A CONFIRMED row is a real observation, but only a `loved` reaction is the
// big bond gain a minmaxing player is hunting for -- see characterSummary's
// comment. The report form's first option is "They didn't like it", so a
// CONFIRMED "none" reaction is common, and counting it toward "N loved" would
// read as N gifts that work. `liked` and `slight` are real and positive, but
// still fall short of `loved`, so both land in "tested" alongside "none". See
// I3 in the fix brief for the original none-vs-confirmed split this extends.
test('characterSummary reports a liked, slight or neutral-reaction confirmation as "tested", never "loved"', () => {
  const base = {
    ...dataset,
    gifts: [gift({ id: 'b1', name: 'B1', category: null, rarity: null })],
    characters: [{ ...dataset.characters[0], categories: {}, favorites: [] }],
  };

  for (const reaction of ['none', 'slight', 'liked']) {
    const idx = buildIndex({
      ...base,
      observations: [{ id: 'o1', character: 'c1', gift: 'b1', reaction, date: '2026-09-22' }],
    });
    assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), '1 tested, none loved yet', `a ${reaction} reaction must read as tested`);
  }

  const loved = buildIndex({
    ...base,
    observations: [{ id: 'o1', character: 'c1', gift: 'b1', reaction: 'loved', date: '2026-09-22' }],
  });
  assert.equal(characterSummary(loved, loved.byCharacterId.get('c1')), '1 loved');
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
  const container = renderView(renderMatrix, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false });

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
    character({ id: 'c2', name: 'D', categories: { coffee: { state: 'profile', source: null } } }),
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
    const container = renderView(render, idx, state);
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
    const container = renderView(render, idx, state);
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
    const container = renderView(render, idx, state);
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
  // character.js, gift.js and favorites.js build their chips with reportChip(),
  // so it must also keep the chip look and honour a caller's aria-label.
  const chipNode = reportChip('nydine', 'grooming-kit', 'Grooming kit', {
    ariaLabel: 'Report a result for Grooming kit',
  });
  assert.match(chipNode.className, /\bchip\b/);
  assert.match(chipNode.className, /\bchip-action\b/);
  assert.match(chipNode.className, /\breport-button\b/);
  assert.equal(chipNode.getAttribute('aria-label'), 'Report a result for Grooming kit');
});

// A2: a CONFIRMED pair whose reaction is liked, slight or "none" is a real,
// approved report, but none of them is the loved result a minmaxing player is
// after. Drawing any of them as the loved ✔ under a legend reading "loved"
// claims a bond gain the report never made -- see the SYMBOL/cellState
// comment in matrix.js. Each below-loved reaction gets its own pseudo-state
// (LIKED/SLIGHT/NONE), so liked, slight and no-gain results read differently
// from each other, not just from loved.
test('cellState gives liked, slight and no-gain results distinct pseudo-states, and leaves a loved result alone', () => {
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'liked' }), 'LIKED');
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'slight' }), 'SLIGHT');
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'none' }), 'NONE');
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'loved' }), 'CONFIRMED');
  assert.equal(cellState({ state: 'FAVORITE', reaction: 'favorite' }), 'FAVORITE');
  assert.equal(cellState({ state: 'UNTESTED', reaction: null }), 'UNTESTED');
  assert.equal(cellState({ state: 'PENDING', reaction: null }), 'PENDING');
  assert.equal(cellState({ state: 'CONTESTED', reaction: null }), 'CONTESTED');
  assert.equal(cellState({ state: 'PREDICTED', reaction: null }), 'PREDICTED');
  // An unrecognised reaction on a CONFIRMED pair must not silently count as
  // below-loved -- see the M-9 test on characterSummary's identical list.
  assert.equal(cellState({ state: 'CONFIRMED', reaction: 'unknown-tier' }), 'CONFIRMED');
  // Every below-loved state needs its own symbol, distinct from loved's ✔ and
  // from each other, or the three-way split is invisible.
  const symbols = [SYMBOL.LIKED, SYMBOL.SLIGHT, SYMBOL.NONE, SYMBOL.CONFIRMED];
  assert.equal(new Set(symbols).size, symbols.length, 'liked, slight, none and loved must each have their own symbol');
  // The tooltip must not swing the other way and deny the report it marks.
  assert.doesNotMatch(cellLabel({ state: 'CONFIRMED', reaction: 'none' }), /not tested/i);
});

// cellLabel is now just stateLabel, so the matrix hover and the
// character/gift tables can never say two different things (or two different
// casings) about the same reaction.
test('cellLabel is stateLabel: one label per result across the matrix and the tables', () => {
  assert.equal(cellLabel({ state: 'CONFIRMED', reaction: 'none' }), 'Tested: No support gain');
  assert.equal(cellLabel({ state: 'CONFIRMED', reaction: 'slight' }), 'Tested: Small gain');
  assert.equal(cellLabel({ state: 'CONFIRMED', reaction: 'liked' }), 'Tested: Moderate gain');
  assert.equal(cellLabel({ state: 'CONFIRMED', reaction: 'loved' }), 'Confirmed: Big gain');
});

// A mutated guard that answered only for CONFIRMED (e.g.
// `cellState(confidence) !== 'CONFIRMED'`) turned every other cell's hover
// into "…: undefined" and nothing caught it. Every other state's title must
// be its real stateLabel text, never undefined.
test('cellLabel is never undefined for a non-CONFIRMED state', () => {
  assert.equal(cellLabel({ state: 'FAVORITE', reaction: 'favorite' }), 'Favourite — double points');
  assert.equal(cellLabel({ state: 'PENDING', reaction: null }), 'Reported — awaiting review');
  assert.equal(cellLabel({ state: 'PREDICTED', reaction: null, predicted: 'positive' }), 'Predicted — not yet confirmed');
  assert.equal(cellLabel({ state: 'UNTESTED', reaction: null }), 'Not tested yet');
});

test('the LEGEND gives loved and each below-loved reaction its own row, in order', () => {
  const labels = Object.fromEntries(LEGEND);
  assert.equal(labels.CONFIRMED, 'loved');
  assert.equal(labels.LIKED, 'liked (moderate gain)');
  assert.equal(labels.SLIGHT, 'slight (small gain)');
  assert.equal(labels.NONE, 'no support gain');
  assert.equal(labels.TESTED, undefined, 'the single TESTED row is gone, replaced by LIKED/SLIGHT/NONE');
  // Object.fromEntries above loses row order, so it can't catch the rows
  // being reshuffled (e.g. NONE before LIKED). LEGEND's own array order is
  // what the legend renders in, top to bottom.
  assert.deepEqual(
    LEGEND.map(([state]) => state),
    ['FAVORITE', 'CONFIRMED', 'LIKED', 'SLIGHT', 'NONE', 'CONTESTED', 'PENDING', 'PREDICTED', 'UNTESTED'],
  );
});

// A render-only mutation (drawing slight and liked with the cell-confirmed
// class while still marking none correctly) survived the old test, which only
// ever exercised the `none` reaction. Looping over all three below-loved
// reactions closes that gap.
const BELOW_LOVED_LABEL = { none: 'Tested: No support gain', slight: 'Tested: Small gain', liked: 'Tested: Moderate gain' };

for (const [reaction, cellState_, symbol] of [['none', 'none', '0'], ['slight', 'slight', '–'], ['liked', 'liked', '+']]) {
  test(`the matrix renders a ${reaction} confirmation as cell-${cellState_} with neither the loved tick nor its tint`, () => {
    const idx = buildIndex({
      ...dataset,
      observations: [{ id: 'o1', gift: 'book', character: 'c1', reaction, date: '2026-09-20' }],
    });
    const container = renderView(renderMatrix, idx, { filters: DEFAULT_FILTERS, search: 'book', submissionsEnabled: false });

    const cells = collect(container, (n) => n.tagName === 'TD' && (n.className ?? '').startsWith('cell-'));
    assert.equal(cells.length, 1, 'the search should narrow this to one gift row and one character column');
    assert.match(cells[0].className, new RegExp(`\\bcell-${cellState_}\\b`));
    assert.doesNotMatch(cells[0].className, /\bcell-confirmed\b/);
    assert.equal(cells[0].textContent, symbol);
    // The exact title, not just "doesn't look like a denial": this is the one
    // mutation the display-state title bug (passing the pseudo-state to
    // cellLabel instead of the raw confidence) would produce -- stateLabel
    // would fall through to "Not tested yet" for every one of these cells.
    // Both the title and the aria-label carry it, since a <td>'s title is not
    // reliably announced by a screen reader.
    const expectedTitle = `C and Book: ${BELOW_LOVED_LABEL[reaction]}`;
    assert.equal(cells[0].title, expectedTitle);
    assert.equal(cells[0].getAttribute('aria-label'), expectedTitle);

    // The key has to explain the symbol the grid just drew, with the same glyph.
    const swatch = findFirst(container, (n) => (n.className ?? '').includes(`cell-${cellState_}`) && (n.className ?? '').includes('legend-swatch'));
    assert.ok(swatch, `the legend needs a row for the ${reaction} pseudo-state`);
    assert.equal(swatch.textContent, symbol, `the ${reaction} legend swatch must show the same glyph as the cell`);
  });
}

// A slight result is a real, approved CONFIRMED result, but it is not loved --
// "Hide untested pairs" filters on confidence.state (which stays CONFIRMED),
// never on cellState's render-only below-loved pseudo-states, so it must
// still survive that filter.
test('"Hide untested pairs" keeps a slight (below-loved) pair, not just a loved one', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [{ id: 'o1', gift: 'book', character: 'c1', reaction: 'slight', date: '2026-09-20' }],
  });
  const m = matrixModel(idx, { ...DEFAULT_FILTERS, hideUntested: true }, '');
  assert.ok(m.gifts.some((g) => g.id === 'book'), '"Hide untested pairs" must not drop a below-loved confirmed pair');
  assert.equal(m.cellAt('book', 'c1').state, 'CONFIRMED');
});

// A3: both hunt sections render a name followed by a chip list, so with the
// Worker unconfigured the chips are bare gift links in both. Without a label
// per row a prediction reads as a known favourite.
test('the favourites hunt labels a suggestion "worth trying" and a solved row a known favourite', () => {
  const idx = buildIndex(degradedDataset);
  const container = renderView(favoritesView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined });
  const hints = collect(container, (n) => n.className === 'hunt-hint').map((n) => n.textContent);
  // Unknown section first, then Found: c2 is a prediction, c1 has a favourite.
  assert.deepEqual(hints, ['worth trying', 'known favourite']);
});

test('a row with more than one known favourite says favourites', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [{ ...dataset.characters[0], favorites: ['book'] }],
  });
  const container = renderView(favoritesView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined });
  const hints = collect(container, (n) => n.className === 'hunt-hint').map((n) => n.textContent);
  assert.deepEqual(hints, ['known favourites']);
});

// C1: Safari/VoiceOver drops the implicit list role once list-style: none
// meets display: grid/flex, which is exactly what .matrix-legend and
// .hunt-list do.
test('every list the stylesheet un-lists keeps an explicit list role', () => {
  const idx = buildIndex(degradedDataset);
  const state = { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, storage: undefined };

  const matrix = renderView(renderMatrix, idx, state);
  const legend = findFirst(matrix, (n) => n.className === 'matrix-legend');
  assert.equal(legend.getAttribute('role'), 'list', 'the matrix legend needs role="list"');

  const hunt = renderView(favoritesView.render, idx, state);
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
      category(),
      category({ id: 'drinks', label: 'Fermented Drinks' }),
    ],
    gifts: [],
    characters: [character({
      categories: {
        drinks: { state: 'discovered', source: null },
        books: { state: 'guide', source: 'polygon-1' },
      },
    })],
    observations: [],
    sources: [source()],
  });

  const container = renderView(characterView.render, idx, { filters: DEFAULT_FILTERS, search: '', submissionsEnabled: false, id: 'c1' });
  const note = findFirst(container, (n) => (n.className ?? '').includes('provenance-note'));
  assert.equal(
    note.textContent,
    'Fermented Drinks was found through play. The rest are carried over from Polygon and are predictions until a player reports loving an item in that category.',
  );
});

// Against the real committed dataset: a category chip is confirmed exactly
// when the character has an approved loved result on a gift in that
// category -- never by a favourite alone, however that favourite is
// reported. `hasLoved` derives the expected state independently of
// `categoryChips` so this stays true regardless of what data is added later:
// a future loved book for Fabio, or a future loved weapon for Lysander,
// would correctly flip that category to confirmed, and this test would
// still pass. The favourite-item assertions below additionally confirm each
// favourite sits inside the category it is being checked against, so the
// "not confirmed by the favourite" checks aren't vacuous.
function hasLoved(idx, characterId, categoryId) {
  return idx.gifts.some((gift) => {
    if (gift.category !== categoryId) return false;
    const confidence = idx.confidenceFor(characterId, gift.id);
    return confidence.state === 'CONFIRMED' && confidence.reaction === 'loved';
  });
}

test('the real dataset confirms categories from loved results only, keeping favourites about the item', async () => {
  const idx = buildIndex(await loadDataset('data'));

  const ninae = idx.byCharacterId.get('ninae');
  assert.deepEqual(favouriteGifts(idx, ninae).map((g) => g.id), ['eastern-black-silk']);
  const ninaeChips = categoryChips(idx, ninae);
  assert.ok(ninaeChips.every((c) => c.state !== 'confirmed'), 'no confirmed chip without a loved result');
  assert.deepEqual([...ninaeChips.map((c) => c.id)].sort(), ['fashion', 'flowers', 'paintings']);

  const fabio = idx.byCharacterId.get('fabio');
  assert.deepEqual(favouriteGifts(idx, fabio).map((g) => g.id), ['history-of-a-master']);
  assert.equal(idx.byGiftId.get('history-of-a-master').category, 'books');
  const fabioConfirmedIds = categoryChips(idx, fabio).filter((c) => c.state === 'confirmed').map((c) => c.id);
  assert.ok(fabioConfirmedIds.includes('coffee'));
  assert.ok(fabioConfirmedIds.includes('fermented-drinks'));
  assert.equal(
    fabioConfirmedIds.includes('books'),
    hasLoved(idx, 'fabio', 'books'),
    'books is confirmed only by a loved books result, never by the favourite',
  );

  const lysander = idx.byCharacterId.get('lysander');
  assert.deepEqual(favouriteGifts(idx, lysander).map((g) => g.id), ['rugged-blade']);
  assert.equal(idx.byGiftId.get('rugged-blade').category, 'weapons');
  const lysanderConfirmedIds = categoryChips(idx, lysander).filter((c) => c.state === 'confirmed').map((c) => c.id);
  assert.ok(lysanderConfirmedIds.includes('military'));
  assert.equal(
    lysanderConfirmedIds.includes('weapons'),
    hasLoved(idx, 'lysander', 'weapons'),
    'weapons is confirmed only by a loved weapons result, never by the favourite',
  );
});

// A reaction below 'loved' that still counts as an approved result, kept as
// a literal here rather than imported so the expectation can't move in step
// with the app's own list.
const BELOW_LOVED = ['liked', 'slight', 'none'];

// Every category chip on every giftable character, checked against a state
// computed independently from confidenceFor: a loved result confirms, a
// loved-plus-below-loved result goes mixed, and anything else falls back to
// the stored link. The only coverage guard here is backed by 57 chips today,
// so a new valid result can't turn this test red.
test('on the real dataset, every character’s category chips follow the loved / mixed rule', async () => {
  const idx = buildIndex(await loadDataset('data'));
  let confirmedSeen = 0;

  for (const ch of idx.characters) {
    if (!ch.giftable) continue;
    const chips = categoryChips(idx, ch);
    const chipIds = chips.map((c) => c.id);
    assert.deepEqual(chipIds, [...new Set(chipIds)], `${ch.id} has duplicate chip ids`);

    for (const category of idx.categories) {
      const id = category.id;
      const loved = idx.gifts.some((gift) => {
        if (gift.category !== id) return false;
        const confidence = idx.confidenceFor(ch.id, gift.id);
        return confidence.state === 'CONFIRMED' && confidence.reaction === 'loved';
      });
      const below = idx.gifts.some((gift) => {
        if (gift.category !== id) return false;
        const confidence = idx.confidenceFor(ch.id, gift.id);
        return confidence.state === 'CONFIRMED' && BELOW_LOVED.includes(confidence.reaction);
      });

      let expected;
      if (loved && below) expected = 'mixed';
      else if (loved) expected = 'confirmed';
      else if (ch.categories?.[id] && ch.categories[id].state !== 'refuted') expected = ch.categories[id].state;
      else expected = undefined;

      if (expected === 'confirmed') confirmedSeen += 1;

      const actual = chips.find((c) => c.id === id)?.state;
      assert.equal(actual, expected, `${ch.id} / ${id}`);
    }
  }

  assert.ok(confirmedSeen > 0, 'expected at least one confirmed chip across the dataset');
});

// Every giftable character's card summary, built independently from
// confidenceFor and ch.favorites rather than pinned per character, covering
// every branch characterSummary can return. The coverage guards only require
// a favourite, a loved-only character and a worth-trying character to exist
// -- each backed by ten or more characters today -- so a new valid result
// can't turn this test red.
test('on the real dataset, every character’s card summary is built from loved and favourite results', async () => {
  const idx = buildIndex(await loadDataset('data'));
  const branchesSeen = new Set();
  let sawFavourite = false;

  for (const ch of idx.characters) {
    if (!ch.giftable) continue;

    const favouriteIds = new Set();
    for (const gift of idx.gifts) {
      if (idx.confidenceFor(ch.id, gift.id).state === 'FAVORITE') favouriteIds.add(gift.id);
    }
    for (const id of ch.favorites ?? []) {
      if (idx.byGiftId.has(id)) favouriteIds.add(id);
    }
    const f = favouriteIds.size;
    if (f > 0) sawFavourite = true;

    let loved = 0;
    let tested = 0;
    let contested = 0;
    let pending = 0;
    let predicted = 0;
    for (const gift of idx.gifts) {
      const confidence = idx.confidenceFor(ch.id, gift.id);
      if (confidence.state === 'CONFIRMED' && confidence.reaction === 'loved' && !favouriteIds.has(gift.id)) {
        loved += 1;
      } else if (confidence.state === 'CONFIRMED' && BELOW_LOVED.includes(confidence.reaction)) {
        tested += 1;
      } else if (confidence.state === 'CONTESTED') contested += 1;
      else if (confidence.state === 'PENDING') pending += 1;
      else if (confidence.state === 'PREDICTED' && confidence.predicted === 'positive') predicted += 1;
    }

    const s = f === 1 ? '' : 's';
    let expected;
    let branch;
    if (f > 0 && loved > 0) { expected = `${f} favourite${s}, ${loved} loved`; branch = 'favourites and loved'; }
    else if (f > 0) { expected = `${f} favourite${s}`; branch = 'favourites only'; }
    else if (loved > 0) { expected = `${loved} loved`; branch = 'loved only'; }
    else if (tested > 0) { expected = `${tested} tested, none loved yet`; branch = 'tested'; }
    else if (contested > 0) { expected = `${contested} contested`; branch = 'contested'; }
    else if (pending > 0) { expected = `${pending} awaiting review`; branch = 'pending'; }
    else if (predicted > 0) { expected = `${predicted} worth trying`; branch = 'worth trying'; }
    else { expected = 'nothing tested yet'; branch = 'nothing tested yet'; }

    branchesSeen.add(branch);
    assert.equal(characterSummary(idx, ch), expected, ch.id);
  }

  assert.ok(sawFavourite, 'expected at least one character with a favourite');
  for (const branch of ['loved only', 'worth trying']) {
    assert.ok(branchesSeen.has(branch), `expected at least one character in the "${branch}" branch`);
  }
});

// A loved result on any gift in a category predicts the rest of that category
// as worth trying, in place of a missing/guide/refuted stored link -- computed
// here independently of buildIndex, against the real committed data.
test('on the real dataset, every untested gift in a category a character loved is worth trying', async () => {
  const idx = buildIndex(await loadDataset('data'));

  const lovedByCharacter = new Map();
  for (const characterId of idx.byCharacterId.keys()) {
    const loved = new Set();
    for (const gift of idx.gifts) {
      if (!gift.category) continue;
      const obs = idx.observationsFor(characterId, gift.id);
      if (obs.length > 0 && obs.every((o) => o.reaction === 'loved')) loved.add(gift.category);
    }
    lovedByCharacter.set(characterId, loved);
  }

  let checked = 0;
  for (const ch of idx.characters) {
    if (!ch.giftable) continue;
    const loved = lovedByCharacter.get(ch.id);
    if (!loved || loved.size === 0) continue;

    for (const gift of idx.gifts) {
      if (!gift.category || !loved.has(gift.category)) continue;
      if (idx.observationsFor(ch.id, gift.id).length > 0) continue;
      if (idx.pendingFor(ch.id, gift.id).length > 0) continue;

      const confidence = idx.confidenceFor(ch.id, gift.id);
      assert.equal(confidence.state, 'PREDICTED', `${ch.id} / ${gift.id}`);
      assert.equal(confidence.predicted, 'positive', `${ch.id} / ${gift.id}`);

      const stored = ch.categories?.[gift.category];
      if (stored && (stored.state === 'profile' || stored.state === 'discovered')) {
        assert.equal(confidence.provenance, stored.state, `${ch.id} / ${gift.id}`);
      } else {
        assert.equal(confidence.provenance, 'discovered', `${ch.id} / ${gift.id}`);
      }
      checked += 1;
    }
  }

  // Every such pair in the committed data today is checked above; any
  // positive count is a valid guard so a future edit to data/ can't turn this
  // test red by accident.
  assert.ok(checked > 0, 'expected at least one play-backed prediction in the real dataset');
});

// The Gifts tab's second entry point into a missing-item report. Like the
// report controls above, it must not exist with submissions off.
test('a search that matches no gift offers to report it, but only with submissions on', () => {
  const idx = buildIndex(dataset);
  const base = { filters: DEFAULT_FILTERS, search: 'lantern oil', searchText: 'Lantern Oil', storage: undefined };

  const on = renderView(giftView.render, idx, { ...base, submissionsEnabled: true });
  const buttons = collect(on, (n) => (n.className ?? '').includes('missing-item-button'));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].tagName, 'BUTTON');
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].dataset.name, 'Lantern Oil', 'carries the query as typed, not lower-cased');
  assert.equal(buttons[0].textContent, 'Report ‘Lantern Oil’ as a missing item');

  const off = renderView(giftView.render, idx, { ...base, submissionsEnabled: false });
  assert.equal(collect(off, (n) => n.tagName === 'BUTTON').length, 0, 'no button with submissions off');
});

test('a search that finds a gift, or no search at all, offers no missing-item report', () => {
  const idx = buildIndex(dataset);
  for (const search of ['bre', '']) {
    const container = renderView(giftView.render, idx, { filters: DEFAULT_FILTERS, search, searchText: search, submissionsEnabled: true, storage: undefined });
    assert.equal(collect(container, (n) => (n.className ?? '').includes('missing-item-button')).length, 0, JSON.stringify(search));
  }
});

test('the missing-item button falls back to the matching text when no typed text is given', () => {
  const idx = buildIndex(dataset);
  const container = renderView(giftView.render, idx, { filters: DEFAULT_FILTERS, search: 'zz', submissionsEnabled: true, storage: undefined });
  assert.equal(collect(container, (n) => (n.className ?? '').includes('missing-item-button'))[0].dataset.name, 'zz');
});

test('missingItemButton carries its query where app.js reads it', () => {
  const button = missingItemButton('Lantern Oil');
  assert.equal(button.className, 'missing-item-button');
  assert.equal(button.dataset.name, 'Lantern Oil');
});

// A guide pick is about one item: it predicts that item and nothing else, so
// it must never add or change a category chip.
test('a guide pick does not create a category chip', () => {
  const d = {
    categories: [category()],
    gifts: [gift({ id: 'a', name: 'A' })],
    characters: [character()],
    observations: [],
    sources: [],
    'guide-gifts': [{ character: 'c1', gift: 'a', sources: ['s1'] }],
  };
  const idx = buildIndex(d);
  assert.equal(idx.confidenceFor('c1', 'a').state, 'PREDICTED');
  assert.deepEqual(categoryChips(idx, idx.byCharacterId.get('c1')), []);
});

test('the real dataset shows every untested guide pick as a positive prediction and changes no chip', async () => {
  const dataset = await loadDataset('data');
  const idx = buildIndex(dataset);
  const without = buildIndex({ ...dataset, 'guide-gifts': [] });
  assert.ok(dataset['guide-gifts'].length > 0, 'expected guide picks');

  for (const row of dataset['guide-gifts']) {
    if (idx.observationsFor(row.character, row.gift).length > 0) continue;
    if (idx.pendingFor(row.character, row.gift).length > 0) continue;
    const confidence = idx.confidenceFor(row.character, row.gift);
    assert.equal(confidence.state, 'PREDICTED', `${row.character} / ${row.gift}`);
    assert.equal(confidence.predicted, 'positive', `${row.character} / ${row.gift}`);
  }

  for (const ch of idx.characters) {
    assert.deepEqual(
      categoryChips(idx, ch),
      categoryChips(without, without.byCharacterId.get(ch.id)),
      `${ch.id}: chips must not depend on guide picks`,
    );
  }
});
