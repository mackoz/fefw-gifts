import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { weaveModel, weaveSummary } from '../assets/js/views/weave.js';

const dataset = {
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [
    { id: 'book', name: 'Book', category: 'books', rarity: null, description: '', sources: [] },
    { id: 'rock', name: 'Rock', category: null, rarity: null, description: '', sources: [] },
  ],
  characters: [
    { id: 'c1', name: 'C1', giftable: true, spoiler: false, traits: [], categories: { books: { state: 'guide', source: null } }, rarityPreference: null, favorites: [], notes: null },
    { id: 'c2', name: 'C2', giftable: true, spoiler: true, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
    { id: 'c3', name: 'C3', giftable: false, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
  ],
  observations: [],
  sources: [],
};

const clone = (extra) => ({ ...dataset, ...extra });

test('rows count only giftable characters the filters admit', () => {
  const model = weaveModel(buildIndex(dataset), DEFAULT_FILTERS);
  // c2 is a spoiler and hideSpoilers defaults on; c3 is not giftable.
  assert.equal(model.rows, 1);
  assert.equal(model.columns, 2);
  assert.equal(model.pairs, 2);
});

test('untested pairs produce no mark', () => {
  const model = weaveModel(buildIndex(dataset), DEFAULT_FILTERS);
  // c1 x book is PREDICTED; c1 x rock has no category link, so it is UNTESTED.
  assert.deepEqual(model.marks, [{ x: 0, y: 0, state: 'PREDICTED' }]);
});

test('a pending report is marked but never counted as confirmed', () => {
  const pending = [{ id: 'p1', character: 'c1', gift: 'rock', reaction: 'loved', created_at: '2026-09-21T00:00:00Z' }];
  const model = weaveModel(buildIndex(dataset, pending), DEFAULT_FILTERS);
  assert.equal(model.confirmed, 0, 'a pending report is not a confirmation');
  assert.ok(model.marks.some((m) => m.state === 'PENDING'), 'a pending report should still show on the weave');
});

test('an observed favourite counts as confirmed', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'favorite', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.confirmed, 1);
  assert.equal(model.favouritesFound, 1);
});

test('a declared favourite counts even though no player observed it', () => {
  // deriveConfidence never returns FAVORITE for a declared-but-unobserved
  // gift, so counting states alone would disagree with the Favourites tab.
  const characters = dataset.characters.map((c) => (c.id === 'c1' ? { ...c, favorites: ['book'] } : c));
  const model = weaveModel(buildIndex(clone({ characters })), DEFAULT_FILTERS);
  assert.equal(model.favouritesFound, 1);
  assert.equal(model.confirmed, 0, 'declaring a favourite is not a player confirmation');
});

test('a declared favourite naming an unknown gift does not count', () => {
  const characters = dataset.characters.map((c) => (c.id === 'c1' ? { ...c, favorites: ['no-such-gift'] } : c));
  const model = weaveModel(buildIndex(clone({ characters })), DEFAULT_FILTERS);
  assert.equal(model.favouritesFound, 0);
});

test('the summary is two sentences and never a middle-dot string', () => {
  const summary = weaveSummary(weaveModel(buildIndex(dataset), DEFAULT_FILTERS));
  assert.equal(summary, 'No pair confirmed yet, out of 2. 1 favourite still unfound.');
  assert.doesNotMatch(summary, /·/);
});

test('the summary switches to counts once something is confirmed', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }];
  const summary = weaveSummary(weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS));
  assert.match(summary, /^1 of 2 pairs confirmed\./);
});

// A CONFIRMED pair whose reaction is not positive means a player tested this
// and it did nothing. Counting it under "N of M pairs confirmed" would make
// the masthead claim N gifts that work, and would contradict the character
// tile on the same page, which already says "tested". See characterSummary.
test('a no-gain confirmation is counted as tested, never as confirmed', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'none', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.confirmed, 0, 'a reported no support gain is not a confirmation that the gift works');
  assert.equal(model.tested, 1);
});

test('a positive confirmation still counts as confirmed and not as tested', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.confirmed, 1);
  assert.equal(model.tested, 0);
});

test('the summary gains its third sentence only when something was tested with no gain', () => {
  const quiet = weaveSummary(weaveModel(buildIndex(dataset), DEFAULT_FILTERS));
  assert.doesNotMatch(quiet, /no support gain/, 'nothing tested yet, so there is nothing to say');

  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'none', date: '2026-09-21' }];
  const summary = weaveSummary(weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS));
  assert.equal(summary, 'No pair confirmed yet, out of 2. 1 favourite still unfound. 1 tested with no support gain.');
});
