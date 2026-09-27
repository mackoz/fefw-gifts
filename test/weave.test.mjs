import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { weaveModel, weaveSummary } from '../assets/js/views/weave.js';
import { loadDataset } from '../scripts/validate.mjs';

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

test('a pending report is marked but never counted as loved', () => {
  const pending = [{ id: 'p1', character: 'c1', gift: 'rock', reaction: 'loved', created_at: '2026-09-21T00:00:00Z' }];
  const model = weaveModel(buildIndex(dataset, pending), DEFAULT_FILTERS);
  assert.equal(model.loved, 0, 'a pending report is not a confirmation');
  assert.ok(model.marks.some((m) => m.state === 'PENDING'), 'a pending report should still show on the weave');
});

test('an observed favourite counts as loved', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'favorite', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.loved, 1, 'a favourite is loved and more, so it counts in the loved total');
  assert.equal(model.favouritesFound, 1);
});

test('a declared favourite counts even though no player observed it', () => {
  // deriveConfidence never returns FAVORITE for a declared-but-unobserved
  // gift, so counting states alone would disagree with the Favourites tab.
  const characters = dataset.characters.map((c) => (c.id === 'c1' ? { ...c, favorites: ['book'] } : c));
  const model = weaveModel(buildIndex(clone({ characters })), DEFAULT_FILTERS);
  assert.equal(model.favouritesFound, 1);
  assert.equal(model.loved, 0, 'declaring a favourite is not a player confirmation');
});

test('a declared favourite naming an unknown gift does not count', () => {
  const characters = dataset.characters.map((c) => (c.id === 'c1' ? { ...c, favorites: ['no-such-gift'] } : c));
  const model = weaveModel(buildIndex(clone({ characters })), DEFAULT_FILTERS);
  assert.equal(model.favouritesFound, 0);
});

test('the summary is two sentences and never a middle-dot string', () => {
  const summary = weaveSummary(weaveModel(buildIndex(dataset), DEFAULT_FILTERS));
  assert.equal(summary, 'No pair loved yet, out of 2. 1 favourite still unfound.');
  assert.doesNotMatch(summary, /·/);
});

test('the summary switches to counts once a pair is loved', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-21' }];
  const summary = weaveSummary(weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS));
  assert.match(summary, /^1 of 2 pairs loved\./);
});

// A CONFIRMED pair whose reaction is liked, slight or "none" is a real,
// approved report, but none of them is the loved result a minmaxing player is
// after. Counting it under "N of M pairs loved" would claim a bond gain the
// report never made, and would contradict the character tile on the same
// page, which already says "tested". See characterSummary.
test('a below-loved confirmation is counted as tested, never as loved', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'none', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.loved, 0, 'a below-loved result is not counted as loved');
  assert.equal(model.tested, 1);
});

test('a slight reaction counts as tested, not loved', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'slight', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.loved, 0);
  assert.equal(model.tested, 1);
});

test('a liked reaction still counts as tested, not loved', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.loved, 0);
  assert.equal(model.tested, 1);
});

test('a loved reaction counts as loved and not as tested', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.loved, 1);
  assert.equal(model.tested, 0);
});

// A CONTESTED pair is real signal elsewhere, but reports disagree, so it must
// never count toward either bucket -- see CLAUDE.md's "A pending report is
// not a confirmation," which the same non-approval logic extends to a
// disagreement.
test('a contested pair counts toward neither loved nor tested', () => {
  const contestedDataset = clone({
    observations: [
      { id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-21' },
      { id: 'o2', character: 'c1', gift: 'book', reaction: 'none', date: '2026-09-22' },
    ],
  });
  const idx = buildIndex(contestedDataset);
  assert.equal(idx.confidenceFor('c1', 'book').state, 'CONTESTED');
  const model = weaveModel(idx, DEFAULT_FILTERS);
  assert.equal(model.loved, 0);
  assert.equal(model.tested, 0);
});

test('the summary gains its third sentence only when something was tested below loved', () => {
  const quiet = weaveSummary(weaveModel(buildIndex(dataset), DEFAULT_FILTERS));
  assert.doesNotMatch(quiet, /tested below loved/, 'nothing tested yet, so there is nothing to say');

  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'none', date: '2026-09-21' }];
  const summary = weaveSummary(weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS));
  assert.equal(summary, 'No pair loved yet, out of 2. 1 favourite still unfound. 1 more tested below loved.');
});

test('the summary omits the third sentence when loved is nonzero but tested is zero', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'loved', date: '2026-09-21' }];
  const summary = weaveSummary(weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS));
  assert.equal(summary, '1 of 2 pairs loved. 1 favourite still unfound.');
  assert.doesNotMatch(summary, /tested below loved/);
});

// Groups raw observations by (character, gift) -- restricted to giftable
// characters -- and tallies each PAIR once, the way deriveConfidence's own
// CONFIRMED/CONTESTED split works, but computed straight from the raw
// observations array rather than through confidenceFor/buildIndex, so the
// real-data test below stays an independent cross-check rather than
// re-testing the code it's meant to verify. Two players reporting the same
// pair with the same reaction must count once, not twice -- deriveConfidence
// collapses `reactions` to a Set before deciding CONFIRMED, so counting raw
// observations one-for-one would overcount any pair with more than one
// report. A pair with differing reactions is CONTESTED in the real model and
// counts toward neither loved nor tested, so it must count toward neither
// here either, or this "independent" tally would disagree with weaveModel by
// design the moment the data ever contains a genuine disagreement.
function tallyPairsByReaction(observations, giftableIds) {
  const reactionsByPair = new Map();
  for (const o of observations) {
    if (!giftableIds.has(o.character)) continue;
    const key = `${o.character}\u0000${o.gift}`;
    if (!reactionsByPair.has(key)) reactionsByPair.set(key, new Set());
    reactionsByPair.get(key).add(o.reaction);
  }

  let loved = 0;
  let tested = 0;
  for (const reactions of reactionsByPair.values()) {
    if (reactions.size > 1) continue; // Contested: counts toward neither bucket.
    const [reaction] = reactions;
    if (reaction === 'loved' || reaction === 'favorite') loved += 1;
    else if (reaction === 'liked' || reaction === 'slight' || reaction === 'none') tested += 1;
  }
  return { loved, tested };
}

test('tallyPairsByReaction counts a duplicated pair once and a contested pair not at all', () => {
  const giftableIds = new Set(['c1']);
  // Two players independently reported the same pair with the same reaction:
  // must count once, not twice.
  const duplicated = [
    { id: 'o1', character: 'c1', gift: 'book', reaction: 'loved' },
    { id: 'o2', character: 'c1', gift: 'book', reaction: 'loved' },
  ];
  assert.deepEqual(tallyPairsByReaction(duplicated, giftableIds), { loved: 1, tested: 0 });

  // Two players disagree on the same pair: contested, counts toward neither.
  const contested = [
    { id: 'o1', character: 'c1', gift: 'book', reaction: 'loved' },
    { id: 'o2', character: 'c1', gift: 'book', reaction: 'none' },
  ];
  assert.deepEqual(tallyPairsByReaction(contested, giftableIds), { loved: 0, tested: 0 });

  // A non-giftable character's observations never count.
  const notGiftable = [{ id: 'o1', character: 'c2', gift: 'book', reaction: 'loved' }];
  assert.deepEqual(tallyPairsByReaction(notGiftable, giftableIds), { loved: 0, tested: 0 });

  // Two distinct pairs, one loved and one tested, tally independently.
  const mixed = [
    { id: 'o1', character: 'c1', gift: 'book', reaction: 'loved' },
    { id: 'o2', character: 'c1', gift: 'brew', reaction: 'slight' },
  ];
  assert.deepEqual(tallyPairsByReaction(mixed, giftableIds), { loved: 1, tested: 1 });
});

// Cross-checks the masthead against independently-derived counts from the
// real dataset, rather than hard-coding today's numbers -- those numbers will
// keep changing as more observations land. Tallied per pair (see
// tallyPairsByReaction above), not per observation: a per-observation count
// would double-count a pair two players both reported, and would count a
// contested pair's observations as if they were agreement, either of which
// would fail this test on perfectly valid new data and block that data PR's
// deploy (see CLAUDE.md's "Deployment is gated on validation").
test('weaveSummary on the real dataset matches counts derived independently from observations.json', async () => {
  const dataset = await loadDataset('data');
  const idx = buildIndex(dataset);
  const filters = { ...DEFAULT_FILTERS, hideSpoilers: false };
  const model = weaveModel(idx, filters);

  const giftableIds = new Set(dataset.characters.filter((c) => c.giftable).map((c) => c.id));
  const { loved: expectedLoved, tested: expectedTested } = tallyPairsByReaction(dataset.observations, giftableIds);

  assert.equal(model.loved, expectedLoved);
  assert.equal(model.tested, expectedTested);

  const summary = weaveSummary(model);
  assert.match(summary, new RegExp(`${expectedLoved.toLocaleString('en-GB')} of `));
  if (expectedTested > 0) {
    assert.match(summary, new RegExp(`${expectedTested.toLocaleString('en-GB')} more tested below loved\\.$`));
  } else {
    assert.doesNotMatch(summary, /tested below loved/);
  }
});
