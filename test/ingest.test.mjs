import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  toObservation, mergeObservations, skippedRowWarning,
  applyItemReports, fetchItemBatch, itemSkippedWarning, itemResultDroppedWarning, appendCategoryLines, ingestSummary,
} from '../scripts/ingest.mjs';
import { validate } from '../scripts/validate.mjs';

const ROW = {
  id: '9f1c2f7a-0000-4000-8000-000000000001',
  character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  created_at: '2026-09-20T09:30:00.000Z',
};

test('a report becomes an observation in the documented shape', () => {
  assert.deepEqual(toObservation(ROW), {
    id: '9f1c2f7a-0000-4000-8000-000000000001',
    gift: 'grooming-kit',
    character: 'nydine',
    reaction: 'loved',
    date: '2026-09-20',
  });
});

// The privacy rule, asserted rather than trusted.
test('nothing identifying and no free text survives the conversion', () => {
  const observation = toObservation({ ...ROW, reporter: 'someone', ip: '1.2.3.4', email: 'a@b.test' });
  for (const field of ['note', 'points', 'reporter', 'ip', 'email', 'user', 'author', 'submitter', 'upvotes', 'downvotes', 'status']) {
    assert.ok(!(field in observation), `${field} must not survive ingest`);
  }
});

test('rows are appended and the added ones are reported', () => {
  const { observations, added } = mergeObservations([{ id: 'old' }], [ROW]);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].id, 'old');
  assert.equal(added.length, 1);
});

test('a row already in the file is not appended twice', () => {
  const existing = [toObservation(ROW)];
  const { observations, added } = mergeObservations(existing, [ROW]);
  assert.equal(observations.length, 1);
  assert.deepEqual(added, []);
});

test('a duplicate inside one batch is only taken once', () => {
  const { added } = mergeObservations([], [ROW, ROW]);
  assert.equal(added.length, 1);
});

test('nothing to ingest leaves the file untouched', () => {
  const existing = [{ id: 'old' }];
  const { observations, added } = mergeObservations(existing, []);
  assert.deepEqual(observations, existing);
  assert.deepEqual(added, []);
});

// A NULL id can never be matched by the Worker's `UPDATE ... WHERE id IN (...)`,
// so it stays `approved` and is returned every night -- see the comment above
// mergeObservations(). It must not stall the good rows in the same batch.
test('a row with a null id is set aside, not merged, and does not block a good row', () => {
  const badRow = { ...ROW, id: null };
  const { observations, added, skipped } = mergeObservations([], [badRow, ROW]);
  assert.deepEqual(added, [toObservation(ROW)]);
  assert.deepEqual(skipped, [badRow]);
  assert.deepEqual(observations, [toObservation(ROW)]);
});

for (const [label, apply] of [
  ['missing', (row) => { const { id, ...rest } = row; return rest; }],
  ['an empty string', (row) => ({ ...row, id: '' })],
  ['a number', (row) => ({ ...row, id: 7 })],
]) {
  test(`a row whose id is ${label} is set aside, not merged, and does not block a good row`, () => {
    const badRow = apply(ROW);
    const { observations, added, skipped } = mergeObservations([], [badRow, ROW]);
    assert.deepEqual(added, [toObservation(ROW)]);
    assert.deepEqual(skipped, [badRow]);
    assert.deepEqual(observations, [toObservation(ROW)]);
  });
}

test('a batch where every row is skipped adds nothing and leaves existing untouched', () => {
  const existing = [{ id: 'old' }];
  const badRow = { ...ROW, id: null };
  const { observations, added, skipped } = mergeObservations(existing, [badRow]);
  assert.deepEqual(added, []);
  assert.deepEqual(skipped, [badRow]);
  assert.deepEqual(observations, existing);
});

test('skippedRowWarning escapes %, \\r and \\n in interpolated fields, leaving no raw newline', () => {
  const row = { character: '100%\nnydine\r', gift: 'grooming-kit', created_at: '2026-09-20T09:30:00.000Z' };
  const warning = skippedRowWarning(row);
  assert.ok(!warning.includes('\n'), 'result must contain no raw newline');
  assert.ok(!warning.includes('\r'), 'result must contain no raw carriage return');
  assert.ok(warning.includes('100%25%0Anydine%0D'));
  assert.match(warning, /^::warning title=Report skipped::/);
});

// --- Missing items ---

const DATASET = {
  categories: [{ id: 'horses', label: 'Horses', inGameDescriptor: 'those who love horses', aliases: [] }],
  gifts: [{ id: 'horse-grooming-kit', name: 'Horse-Grooming Kit', category: 'horses', rarity: null, description: '', sources: [] }],
  characters: [{
    id: 'alexandra', name: 'Alexandra', giftable: true, spoiler: false, traits: [],
    categories: {}, rarityPreference: null, favorites: [], notes: null,
  }],
  observations: [],
  sources: [],
};

const LANTERNS = { id: 'lanterns', label: 'Lanterns', inGameDescriptor: 'lantern lovers' };

const approvedItem = (id, approved = {}, extra = {}) => ({
  id, character: null, reaction: null, created_at: '2026-09-23T08:15:00.000Z',
  approved: { name: 'Lantern Oil', giftId: null, category: null, newCategory: null, rarity: null, includeResult: false, ...approved },
  ...extra,
});

const withResult = { character: 'alexandra', reaction: 'loved' };

test('a new category, then a gift in it, then its result -- and the whole result validates', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { newCategory: LANTERNS, rarity: 'rare', includeResult: true }, withResult)]);
  assert.deepEqual(out.categories.at(-1), { ...LANTERNS, aliases: [] });
  assert.deepEqual(out.gifts.at(-1), { id: 'lantern-oil', name: 'Lantern Oil', category: 'lanterns', rarity: 'rare', description: '', sources: [] });
  assert.deepEqual(out.observations, [{ id: 'i1', gift: 'lantern-oil', character: 'alexandra', reaction: 'loved', date: '2026-09-23' }]);
  assert.deepEqual(validate({ ...DATASET, categories: out.categories, gifts: out.gifts, observations: out.observations }).errors, []);
  assert.equal(out.summary.newGifts.length, 1);
  assert.match(out.summary.newGifts[0], /^Lantern Oil \(lantern-oil\)/);
  assert.match(out.summary.newCategories[0], /^Lanterns \(lanterns\)/);
  assert.equal(out.summary.results, 1);
  assert.deepEqual(out.skipped, []);
});

test('a listed category is used as the gift’s category, and no category at all is null', () => {
  assert.equal(applyItemReports(DATASET, [approvedItem('i1', { category: 'horses' })]).gifts.at(-1).category, 'horses');
  assert.equal(applyItemReports(DATASET, [approvedItem('i1')]).gifts.at(-1).category, null);
});

test('several reports of one item in a batch make one gift, and one observation per kept result', () => {
  const out = applyItemReports(DATASET, [
    approvedItem('i1', { category: 'horses', includeResult: true }, withResult),
    approvedItem('i2', { category: 'horses', includeResult: true }, { character: 'alexandra', reaction: 'liked' }),
    approvedItem('i3', { category: 'horses' }),
  ]);
  assert.equal(out.gifts.length, DATASET.gifts.length + 1);
  assert.deepEqual(out.observations.map((o) => o.id), ['i1', 'i2']);
  assert.equal(out.summary.newGifts.length, 1);
  assert.equal(out.summary.results, 2);
});

test('two spellings of one new item in the same batch add only one gift', () => {
  const out = applyItemReports(DATASET, [
    approvedItem('i1', { name: 'Lantern Oil', category: 'horses' }),
    approvedItem('i2', { name: 'Lanternoil', category: 'horses' }),
  ]);
  assert.equal(out.gifts.length, DATASET.gifts.length + 1);
  assert.equal(out.summary.newGifts.length, 1);
});

test('two reports creating the same new category add it once', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { newCategory: LANTERNS }), approvedItem('i2', { newCategory: LANTERNS })]);
  assert.equal(out.categories.filter((c) => c.id === 'lanterns').length, 1);
  assert.equal(out.summary.newCategories.length, 1);
});

test('a new category whose id already exists is reused, not duplicated, and the summary notes it', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { newCategory: { id: 'horses', label: 'Horses', inGameDescriptor: 'those who love horses' } })]);
  assert.equal(out.categories.length, DATASET.categories.length);
  assert.deepEqual(out.summary.newCategories, []);
  assert.deepEqual(out.summary.reusedCategories, ['reused existing category horses']);
});

test('matches an existing gift by normalised name', () => {
  for (const name of ['Horse Grooming Kit', 'Horsegrooming Kit']) {
    const out = applyItemReports(DATASET, [approvedItem('i1', { name, includeResult: true }, withResult)]);
    assert.deepEqual(out.gifts, DATASET.gifts, name);
    assert.equal(out.observations[0].gift, 'horse-grooming-kit', name);
    assert.deepEqual(out.summary.newGifts, [], name);
  }
});

test('an approval naming an existing gift adds only the result', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { name: 'Horse-Grooming Kit', giftId: 'horse-grooming-kit', includeResult: true }, withResult)]);
  assert.deepEqual(out.gifts, DATASET.gifts);
  assert.deepEqual(out.categories, DATASET.categories);
  assert.equal(out.observations[0].gift, 'horse-grooming-kit');
});

test('includeResult false, or a report with no result, adds no observation', () => {
  assert.deepEqual(applyItemReports(DATASET, [approvedItem('i1', { includeResult: false }, withResult)]).observations, []);
  assert.deepEqual(applyItemReports(DATASET, [approvedItem('i1', { includeResult: true })]).observations, []);
});

// The privacy and approval rule, asserted rather than trusted: whatever else
// rides along on a row, only the maintainer's approved values are written.
test('only approved values reach the output; the player’s raw text never does', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { category: 'horses', includeResult: true }, {
    ...withResult, name: 'RAW lantern oyl', category_line: 'RAW typed line', reporter: 'RAW someone',
  })]);
  const written = JSON.stringify({ categories: out.categories, gifts: out.gifts, observations: out.observations });
  assert.doesNotMatch(written, /RAW/);
  for (const field of ['reporter', 'name', 'email', 'ip', 'user', 'author', 'submitter', 'status', 'approved']) {
    assert.ok(!(field in out.observations[0]), `${field} must not reach observations`);
  }
});

test('an item with no usable approval is set aside and does not block the rest', () => {
  const bad = [
    { id: 'no-approval', approved: null, character: null, reaction: null, created_at: '2026-09-23T08:15:00.000Z' },
    approvedItem('bad-name', { name: '<b>' }),
    approvedItem('', { name: 'Tea Set' }),
    approvedItem('two-targets', { category: 'horses', giftId: 'horse-grooming-kit' }),
  ];
  const out = applyItemReports(DATASET, [...bad, approvedItem('good')]);
  assert.deepEqual(out.skipped, bad.map((item) => ({ item, reason: 'no usable approval' })));
  assert.deepEqual(out.gifts.map((g) => g.id), ['horse-grooming-kit', 'lantern-oil']);
});

// P10: an approval can be structurally valid (it passed validateItemApproval
// when the maintainer approved it) and still be stale by the time the sync
// runs -- the gift, category or character it names may have been renamed or
// removed by hand since. A stale approval is set aside exactly like an
// invalid one, and must not block the rest of the batch.
test('an approval naming a gift that no longer exists is set aside and does not block the rest', () => {
  const bad = approvedItem('bad-gift', { giftId: 'no-such-gift' });
  const out = applyItemReports(DATASET, [bad, approvedItem('good')]);
  assert.deepEqual(out.skipped, [{ item: bad, reason: 'unknown gift no-such-gift' }]);
  assert.deepEqual(out.gifts.map((g) => g.id), ['horse-grooming-kit', 'lantern-oil']);
});

test('an approval naming a category that no longer exists, and is not created in this batch, is set aside', () => {
  const bad = approvedItem('bad-cat', { category: 'no-such-category' });
  const out = applyItemReports(DATASET, [bad, approvedItem('good')]);
  assert.deepEqual(out.skipped, [{ item: bad, reason: 'unknown category no-such-category' }]);
  assert.deepEqual(out.gifts.map((g) => g.id), ['horse-grooming-kit', 'lantern-oil']);
});

test('an approval whose category is created by a newCategory in the same batch is not stale', () => {
  const out = applyItemReports(DATASET, [
    approvedItem('i1', { newCategory: LANTERNS }),
    approvedItem('i2', { name: 'Something Else', category: 'lanterns', includeResult: true }, withResult),
  ]);
  assert.deepEqual(out.skipped, []);
  assert.equal(out.gifts.at(-1).category, 'lanterns');
});

// P10 (revised): a category proposed by an approval that never became a real
// approval at all -- here, one whose body is itself malformed -- must not be
// treated as "created in this batch" for a later approval that names it. The
// new-category id set is recomputed from the survivors, so this is caught in
// the same pass rather than requiring a special case.
test('a category proposed only by an approval that is itself set aside does not excuse another approval naming it', () => {
  const a = approvedItem('a', { newCategory: LANTERNS, giftId: 'no-such-gift' });
  const b = approvedItem('b', { name: 'Something Else', category: 'lanterns' });
  const out = applyItemReports(DATASET, [a, b]);
  assert.deepEqual(out.skipped, [
    { item: a, reason: 'no usable approval' },
    { item: b, reason: 'unknown category lanterns' },
  ]);
  assert.deepEqual(out.categories, DATASET.categories);
  assert.deepEqual(validate({ ...DATASET, categories: out.categories, gifts: out.gifts, observations: out.observations }).errors, []);
});

// P10: a result can be stale even when the rest of the approval is not -- the
// character it names may have been renamed, removed or made non-giftable by
// hand since the maintainer approved it. Unlike a stale gift or category,
// this drops only the result: the gift (and any category it created) is
// still written, because the item itself was real and approved.
test('a result naming a character that no longer exists drops only the result, and the gift is still created', () => {
  const bad = approvedItem('bad-char', { category: 'horses', includeResult: true }, { character: 'ghost', reaction: 'loved' });
  const out = applyItemReports(DATASET, [bad, approvedItem('good')]);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.droppedResults, [{ item: bad, reason: 'unknown character ghost' }]);
  assert.deepEqual(out.observations, []);
  assert.deepEqual(out.gifts.map((g) => g.id), ['horse-grooming-kit', 'lantern-oil']);
});

test('a result naming a character that is no longer giftable drops only the result, and the gift is still created', () => {
  const dataset = { ...DATASET, characters: [...DATASET.characters, {
    id: 'ghost-npc', name: 'Ghost', giftable: false, spoiler: false, traits: [],
    categories: {}, rarityPreference: null, favorites: [], notes: null,
  }] };
  const bad = approvedItem('bad-giftable', { category: 'horses', includeResult: true }, { character: 'ghost-npc', reaction: 'loved' });
  const out = applyItemReports(dataset, [bad, approvedItem('good')]);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.droppedResults, [{ item: bad, reason: "character ghost-npc can't be given gifts" }]);
  assert.deepEqual(out.observations, []);
  assert.deepEqual(out.gifts.map((g) => g.id), ['horse-grooming-kit', 'lantern-oil']);
});

test('the input dataset is not mutated, and re-running the same batch adds nothing', () => {
  const before = structuredClone(DATASET);
  const items = [approvedItem('i1', { newCategory: LANTERNS, includeResult: true }, withResult)];
  const first = applyItemReports(DATASET, items);
  assert.deepEqual(DATASET, before);
  const again = applyItemReports({ ...DATASET, ...first }, items);
  assert.deepEqual(again.summary, { newGifts: [], newCategories: [], reusedCategories: ['reused existing category lanterns'], results: 0 });
});

// --- Fetching the item batch ---

function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return handler(); };
  impl.calls = calls;
  return impl;
}

test('the item batch is fetched with the admin token and returned', async () => {
  const fetchImpl = stubFetch(() => new Response(JSON.stringify({ items: [{ id: 'i1' }] }), { status: 200 }));
  assert.deepEqual(await fetchItemBatch('https://api.test', 'tok', fetchImpl), { items: [{ id: 'i1' }], warning: null });
  assert.equal(fetchImpl.calls[0].url, 'https://api.test/ingest-items');
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok');
});

test('a Worker without the route is a warning that says to redeploy, never a failure', async () => {
  const { items, warning } = await fetchItemBatch('https://api.test', 'tok', stubFetch(() => new Response('{"error":"not found"}', { status: 404 })));
  assert.deepEqual(items, []);
  assert.match(warning, /^::warning title=Missing items not synced::/);
  assert.match(warning, /redeploy/);
});

test('every other item-batch failure is a warning too, so results still sync', async () => {
  for (const [label, handler, pattern] of [
    ['a 500', () => new Response('{}', { status: 500 }), /returned 500/],
    ['a network error', () => { throw new Error('offline\nnow'); }, /could not reach/],
    ['a body that is not JSON', () => new Response('nope', { status: 200 }), /not JSON/],
  ]) {
    const { items, warning } = await fetchItemBatch('https://api.test', 'tok', stubFetch(handler));
    assert.deepEqual(items, [], label);
    assert.match(warning, /^::warning title=Missing items not synced::/, label);
    assert.match(warning, pattern, label);
    assert.ok(!warning.includes('\n'), `${label}: a warning must stay on one line`);
  }
  const { items } = await fetchItemBatch('https://api.test', 'tok', stubFetch(() => new Response('{"items":"nope"}', { status: 200 })));
  assert.deepEqual(items, []);
});

test('itemSkippedWarning escapes its interpolated id and reason, leaving no raw newline', () => {
  const warning = itemSkippedWarning({ id: 'a\nb%' }, 'unknown gift x\ry%');
  assert.ok(!warning.includes('\n'), 'result must contain no raw newline');
  assert.ok(!warning.includes('\r'), 'result must contain no raw carriage return');
  assert.ok(warning.includes('a%0Ab%25'));
  assert.ok(warning.includes('unknown gift x%0Dy%25'));
  assert.match(warning, /^::warning title=Missing item skipped::/);
});

test('itemResultDroppedWarning escapes its interpolated id and reason, leaving no raw newline', () => {
  const warning = itemResultDroppedWarning({ id: 'a\nb%' }, 'unknown character x\ry%');
  assert.ok(!warning.includes('\n'), 'result must contain no raw newline');
  assert.ok(!warning.includes('\r'), 'result must contain no raw carriage return');
  assert.ok(warning.includes('a%0Ab%25'));
  assert.ok(warning.includes('unknown character x%0Dy%25'));
  assert.match(warning, /^::warning title=Missing-item result dropped::/);
});

// --- Writing ---

test('new categories are appended in the file’s own style, leaving every existing line alone', async () => {
  const original = await readFile(new URL('../data/categories.json', import.meta.url), 'utf8');
  const next = appendCategoryLines(original, [LANTERNS]);
  assert.ok(next.startsWith(original.slice(0, original.lastIndexOf('}') + 1)), 'existing lines must be untouched');
  assert.match(next, /\n {2}\{ "id": "lanterns", "label": "Lanterns", "inGameDescriptor": "lantern lovers", "aliases": \[\] \}\n\]\n$/);
  assert.deepEqual(JSON.parse(next), [...JSON.parse(original), { ...LANTERNS, aliases: [] }]);
  assert.equal(appendCategoryLines(original, []), original);
  assert.deepEqual(JSON.parse(appendCategoryLines('[\n]\n', [LANTERNS])), [{ ...LANTERNS, aliases: [] }]);
});

test('the pull request body lists every new item and category for the maintainer to check', () => {
  const body = ingestSummary({
    added: 2,
    summary: { newGifts: ['Lantern Oil (lantern-oil) — category: lanterns, rarity: rare'], newCategories: ['Lanterns (lanterns) — “lantern lovers”'], results: 1 },
  });
  assert.match(body, /^2 approved result report\(s\) from the submission Worker\./);
  assert.match(body, /\*\*New items \(1\)\*\*/);
  assert.match(body, /^- Lantern Oil \(lantern-oil\)/m);
  assert.match(body, /\*\*New categories \(1\)\*\*/);
  assert.match(body, /^- Lanterns \(lanterns\)/m);
  assert.match(body, /1 result\(s\) from missing-item reports\./);
  assert.doesNotMatch(ingestSummary({ added: 1, summary: { newGifts: [], newCategories: [], results: 0 } }), /New items|New categories|missing-item/);
});

test('the pull request body notes a reused category', () => {
  const body = ingestSummary({
    added: 0,
    summary: { newGifts: [], newCategories: [], reusedCategories: ['reused existing category horses'], results: 0 },
  });
  assert.match(body, /\*\*Reused categories \(1\)\*\*/);
  assert.match(body, /^- reused existing category horses/m);
});
