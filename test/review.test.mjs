import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewRowModel, humanAge, TOKEN_KEY, mountReview,
  groupItemReports, itemCardDefaults, categoryIdClash, itemApprovalBody, itemReportSummary, NEW_CATEGORY,
} from '../assets/js/review.js';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const ROW = {
  id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  upvotes: 5, downvotes: 2,
  created_at: '2026-09-20T09:00:00.000Z',
};

test('a row becomes something a maintainer can scan', () => {
  const model = reviewRowModel(ROW, NOW);
  assert.equal(model.id, 'r1');
  assert.equal(model.pair, 'nydine · grooming-kit');
  assert.equal(model.reaction, 'loved');
  assert.equal(model.score, 3);
  assert.equal(model.votes, '5 up / 2 down');
  assert.equal(model.age, '3 hours ago');
});

test('missing counters do not produce NaN or "undefined"', () => {
  const model = reviewRowModel({ id: 'r2', character: 'a', gift: 'b', reaction: 'none', created_at: '2026-09-20T12:00:00.000Z' }, NOW);
  assert.equal(model.score, 0);
  assert.equal(model.votes, '0 up / 0 down');
});

test('an unparseable timestamp degrades to a readable placeholder', () => {
  assert.equal(reviewRowModel({ ...ROW, created_at: 'whenever' }, NOW).age, 'unknown age');
});

test('ages read in the largest sensible unit', () => {
  assert.equal(humanAge(30 * 1000), 'just now');
  assert.equal(humanAge(60 * 1000), '1 minute ago');
  assert.equal(humanAge(5 * 60 * 1000), '5 minutes ago');
  assert.equal(humanAge(60 * 60 * 1000), '1 hour ago');
  assert.equal(humanAge(26 * 60 * 60 * 1000), '1 day ago');
  assert.equal(humanAge(72 * 60 * 60 * 1000), '3 days ago');
});

test('a clock skew into the future is not rendered as a negative age', () => {
  assert.equal(humanAge(-5000), 'just now');
});

test('the token key is namespaced to this site', () => {
  assert.match(TOKEN_KEY, /^fefw-gifts-/);
});

// A stand-in element with just enough surface for review.js: children, a
// few properties, and listeners a test can fire. No DOM library.
function fakeNode(tag) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), className: '', textContent: '', value: '', type: '',
    checked: false, hidden: false, disabled: false, dataset: {}, children: [],
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type) { return Promise.all((listeners[type] ?? []).map((fn) => fn({ preventDefault() {} }))); },
  };
}

// review.js builds its cards with document.createElement, and nothing in this
// file needs a real one. node --test runs each file in its own process, so
// this stub does not leak into other suites.
globalThis.document = { createElement: (tag) => fakeNode(tag) };

// Minimal DOM-free stubs: mountReview only needs addEventListener, a
// settable `value`/`textContent`, and replaceChildren -- no real DOM library.
function fakeElements() {
  const listeners = {};
  return {
    listeners,
    elements: {
      tokenForm: { addEventListener: (type, fn) => { listeners[type] = fn; } },
      tokenInput: { value: '' },
      forget: { addEventListener: (type, fn) => { listeners[`forget:${type}`] = fn; } },
      refresh: { addEventListener: (type, fn) => { listeners[`refresh:${type}`] = fn; } },
      status: { textContent: '' },
      list: { replaceChildren: () => {} },
      itemCount: { textContent: '' },
      itemStatus: { textContent: '' },
      itemList: fakeNode('ul'),
    },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('a maintainer can use the page for the session even when storage throws on every access', async () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const { listeners, elements } = fakeElements();
  const calls = [];
  const createClient = ({ token }) => {
    calls.push(token);
    return {
      enabled: true,
      fetchReview: async () => ({ ok: true, data: { reports: [] } }),
      fetchItemReview: async () => ({ ok: true, status: 200, data: { reports: [] }, error: null }),
    };
  };
  const loadSiteData = async () => ({ gifts: [], categories: [] });

  mountReview({ elements, storage, createClient, loadSiteData });
  await flush();
  assert.equal(calls.length, 0, 'no token yet, so no client should be created on mount');

  elements.tokenInput.value = 'admin-token-123';
  listeners.submit({ preventDefault() {} });
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'admin-token-123');
});

test('a working storage still seeds the token at mount, so persistence is not lost in the normal case', async () => {
  const store = new Map([[TOKEN_KEY, 'seeded-token']]);
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
  const { elements } = fakeElements();
  const calls = [];
  const createClient = ({ token }) => {
    calls.push(token);
    return {
      enabled: true,
      fetchReview: async () => ({ ok: true, data: { reports: [] } }),
      fetchItemReview: async () => ({ ok: true, status: 200, data: { reports: [] }, error: null }),
    };
  };
  const loadSiteData = async () => ({ gifts: [], categories: [] });

  mountReview({ elements, storage, createClient, loadSiteData });
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'seeded-token');
});

// --- Missing items: pure parts ---

const CATEGORIES = [
  { id: 'horses', label: 'Horses', inGameDescriptor: 'those who love horses', aliases: [] },
  { id: 'books', label: 'Books', inGameDescriptor: 'book lovers', aliases: [] },
];
const GIFTS = [{ id: 'horse-grooming-kit', name: 'Horse-Grooming Kit' }];

const itemRow = (id, name, extra = {}) => ({
  id, name, category: null, category_line: null, rarity: null, character: null, reaction: null,
  status: 'pending', created_at: '2026-09-20T09:00:00.000Z', ...extra,
});

test('item reports group by normalised name, oldest group first, each group oldest first', () => {
  const groups = groupItemReports([
    itemRow('b', 'Tea Set', { created_at: '2026-09-20T08:00:00.000Z' }),
    itemRow('c', 'lantern  oil', { created_at: '2026-09-20T10:00:00.000Z' }),
    itemRow('a', 'Lantern-Oil', { created_at: '2026-09-20T07:00:00.000Z' }),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['lanternoil', 'teaset']);
  assert.deepEqual(groups[0].reports.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(groupItemReports(undefined), []);
});

test('a card pre-fills the most frequent spelling, capitalised', () => {
  const group = { reports: [itemRow('a', 'lantern oil'), itemRow('b', 'Lantern-Oil'), itemRow('c', 'lantern  oil')] };
  assert.equal(itemCardDefaults(group, CATEGORIES).name, 'Lantern Oil');
});

test('a category is pre-selected only when every report agrees on a listed one', () => {
  const agree = { reports: [itemRow('a', 'x', { category: 'horses' }), itemRow('b', 'x', { category: 'horses' })] };
  assert.equal(itemCardDefaults(agree, CATEGORIES).category, 'horses');
  for (const group of [
    { reports: [itemRow('a', 'x', { category: 'horses' }), itemRow('b', 'x', { category: 'books' })] },
    { reports: [itemRow('a', 'x', { category: 'horses' }), itemRow('b', 'x', { category_line: 'horse fans' })] },
    { reports: [itemRow('a', 'x', { category: 'retired-category' })] },
  ]) {
    assert.equal(itemCardDefaults(group, CATEGORIES).category, null);
  }
});

test('a new category is proposed from the typed line only when every report typed one', () => {
  const typed = { reports: [
    itemRow('a', 'x', { category_line: 'lovers of lanterns' }),
    itemRow('b', 'x', { category_line: 'lovers  of lanterns' }),
    itemRow('c', 'x', { category_line: 'lantern lovers' }),
  ] };
  assert.deepEqual(itemCardDefaults(typed, CATEGORIES).newCategory, {
    id: 'lovers-of-lanterns', label: 'Lovers Of Lanterns', inGameDescriptor: 'lovers of lanterns',
  });
  const mixed = { reports: [itemRow('a', 'x', { category_line: 'lovers of lanterns' }), itemRow('b', 'x', { category: 'horses' })] };
  assert.equal(itemCardDefaults(mixed, CATEGORIES).newCategory, null);
});

test('rarity pre-fills the most frequent known value, else unknown', () => {
  const group = { reports: [itemRow('a', 'x', { rarity: 'rare' }), itemRow('b', 'x', { rarity: 'common' }), itemRow('c', 'x', { rarity: 'common' }), itemRow('d', 'x')] };
  assert.equal(itemCardDefaults(group, CATEGORIES).rarity, 'common');
  assert.equal(itemCardDefaults({ reports: [itemRow('a', 'x'), itemRow('b', 'x')] }, CATEGORIES).rarity, null);
});

test('a new category id that is already taken is a clash', () => {
  assert.equal(categoryIdClash(CATEGORIES, 'horses'), true);
  assert.equal(categoryIdClash(CATEGORIES, 'lanterns'), false);
  assert.equal(categoryIdClash(undefined, 'horses'), false);
});

test('an approval for an already-listed name carries the gift id and no category', () => {
  const { errors, body, listed } = itemApprovalBody({ name: 'horse grooming kit', category: 'books', rarity: 'rare' }, { gifts: GIFTS, categories: CATEGORIES });
  assert.deepEqual(errors, []);
  assert.equal(listed.id, 'horse-grooming-kit');
  assert.equal(body.giftId, 'horse-grooming-kit');
  assert.equal('category' in body, false);
  assert.equal('newCategory' in body, false);
});

test('an approval sends a listed category, a new one, or none', () => {
  const ctx = { gifts: GIFTS, categories: CATEGORIES };
  assert.equal(itemApprovalBody({ name: 'Lantern Oil', category: 'horses', rarity: '' }, ctx).body.category, 'horses');
  assert.deepEqual(
    itemApprovalBody({ name: 'Lantern Oil', category: NEW_CATEGORY, rarity: '', newCategory: { id: 'lanterns', label: ' Lanterns ', inGameDescriptor: 'lantern lovers' } }, ctx).body.newCategory,
    { id: 'lanterns', label: 'Lanterns', inGameDescriptor: 'lantern lovers' },
  );
  const none = itemApprovalBody({ name: 'Lantern Oil', category: '', rarity: '' }, ctx).body;
  assert.equal('category' in none, false);
  assert.equal(none.rarity, null);
  assert.equal(none.decision, 'approve');
});

test('a clashing new category id, or a bad name, blocks the approval', () => {
  const ctx = { gifts: GIFTS, categories: CATEGORIES };
  const clash = itemApprovalBody({ name: 'Lantern Oil', category: NEW_CATEGORY, rarity: '', newCategory: { id: 'horses', label: 'Horses Two', inGameDescriptor: 'horse fans' } }, ctx);
  assert.match(clash.errors[0], /already exists/);
  assert.equal(clash.body, null);
  assert.match(itemApprovalBody({ name: '<b>', category: '', rarity: '' }, ctx).errors[0], /item name/i);
});

test('each report reads as one line the maintainer can scan', () => {
  assert.equal(
    itemReportSummary(itemRow('a', 'lantern oil', { category: 'horses', rarity: 'rare', character: 'alexandra', reaction: 'loved' }), CATEGORIES, NOW),
    '“lantern oil” · line: those who love horses · rare · gave to alexandra: loved · 3 hours ago',
  );
  assert.equal(
    itemReportSummary(itemRow('b', 'lantern oil', { category_line: 'lovers of lanterns', created_at: 'whenever' }), CATEGORIES, NOW),
    '“lantern oil” · typed line: “lovers of lanterns” · rarity not sure · no result · unknown age',
  );
});

// --- Missing items: the section, driven through mountReview ---

function collect(node, match, found = []) {
  for (const child of node.children ?? []) {
    if (child && typeof child === 'object') {
      if (match(child)) found.push(child);
      collect(child, match, found);
    }
  }
  return found;
}
const byClass = (node, name) => collect(node, (n) => (n.className ?? '').split(' ').includes(name));

async function mountItems(rows, {
  decideItem = async () => ({ ok: true, status: 200, data: {}, error: null }),
  loadSiteData = async () => ({ gifts: GIFTS, categories: CATEGORIES }),
} = {}) {
  const { elements } = fakeElements();
  const decisions = [];
  let itemFetches = 0;
  const createClient = () => ({
    enabled: true,
    fetchReview: async () => ({ ok: true, status: 200, data: { reports: [] }, error: null }),
    fetchItemReview: async () => { itemFetches += 1; return { ok: true, status: 200, data: { reports: rows }, error: null }; },
    decideItem: async (id, body) => { decisions.push([id, body]); return decideItem(id, body); },
  });
  const store = new Map([[TOKEN_KEY, 'tok']]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };

  mountReview({ elements, storage, createClient, now: () => NOW, loadSiteData });
  await flush();
  return { elements, decisions, cards: () => byClass(elements.itemList, 'item-card'), itemFetches: () => itemFetches };
}

test('the section shows one card per item, with how often it was reported', async () => {
  const h = await mountItems([
    itemRow('a', 'lantern oil', { category: 'horses' }),
    itemRow('b', 'Lantern Oil', { category: 'horses', created_at: '2026-09-20T09:30:00.000Z' }),
    itemRow('c', 'Tea Set', { category_line: 'tea lovers', created_at: '2026-09-20T10:00:00.000Z' }),
  ]);
  assert.equal(h.elements.itemCount.textContent, '2');
  assert.equal(h.cards().length, 2);
  assert.equal(byClass(h.cards()[0], 'review-pair')[0].textContent, 'Lantern Oil — reported 2 times');
  assert.match(h.elements.itemStatus.textContent, /3 report\(s\) about 2 item\(s\)/);
});

test('Approve sends one decision per report, with the same values and each report’s own includeResult', async () => {
  const h = await mountItems([
    itemRow('a', 'lantern oil', { category: 'horses', rarity: 'rare', character: 'alexandra', reaction: 'loved' }),
    itemRow('b', 'Lantern Oil', { category: 'horses', created_at: '2026-09-20T09:10:00.000Z' }),
    itemRow('c', 'lantern oil', { category: 'horses', character: 'alexandra', reaction: 'liked', created_at: '2026-09-20T09:20:00.000Z' }),
  ]);
  const card = h.cards()[0];
  const boxes = byClass(card, 'item-include-box');
  assert.equal(boxes.length, 2, 'only reports with a result get a checkbox');
  assert.ok(boxes.every((box) => box.checked), 'ticked by default');
  boxes[1].checked = false;

  await byClass(card, 'item-approve')[0].fire('click');

  const same = { decision: 'approve', name: 'Lantern Oil', category: 'horses', rarity: 'rare' };
  assert.deepEqual(h.decisions, [
    ['a', { ...same, includeResult: true }],
    ['b', { ...same, includeResult: false }],
    ['c', { ...same, includeResult: false }],
  ]);
  assert.equal(h.itemFetches(), 2, 'the section reloads after a full run');
});

test('an edited name that is already listed approves as results for that gift', async () => {
  const h = await mountItems([itemRow('a', 'Horse Groming Kit', { category: 'horses', character: 'alexandra', reaction: 'loved' })]);
  const card = h.cards()[0];
  const name = byClass(card, 'item-name')[0];
  name.value = 'horse grooming kit';
  await name.fire('input');
  assert.match(byClass(card, 'item-listed')[0].textContent, /Already listed as Horse-Grooming Kit — approving adds only the results/);
  assert.equal(byClass(card, 'item-category')[0].disabled, true);

  await byClass(card, 'item-approve')[0].fire('click');
  const [[id, body]] = h.decisions;
  assert.equal(id, 'a');
  assert.equal(body.giftId, 'horse-grooming-kit');
  assert.equal('category' in body, false);
  assert.equal(body.includeResult, true);
});

test('a typed line proposes a new category, and a clashing id is blocked before anything is sent', async () => {
  const h = await mountItems([itemRow('a', 'Lantern Oil', { category_line: 'those who love lanterns' })]);
  const card = h.cards()[0];
  assert.equal(byClass(card, 'item-category')[0].value, NEW_CATEGORY);
  assert.equal(byClass(card, 'item-new-category')[0].hidden, false);
  assert.equal(byClass(card, 'item-new-id')[0].value, 'those-who-love-lanterns');

  byClass(card, 'item-new-id')[0].value = 'horses';
  await byClass(card, 'item-approve')[0].fire('click');
  assert.deepEqual(h.decisions, []);
  assert.match(byClass(card, 'item-status')[0].textContent, /already exists/);

  byClass(card, 'item-new-id')[0].value = 'lanterns';
  await byClass(card, 'item-approve')[0].fire('click');
  assert.deepEqual(h.decisions[0][1].newCategory, { id: 'lanterns', label: 'Those Who Love Lanterns', inGameDescriptor: 'those who love lanterns' });
});

test('the new category id follows the label until the maintainer edits it', async () => {
  const h = await mountItems([itemRow('a', 'Lantern Oil', { category_line: 'lamp lovers' })]);
  const card = h.cards()[0];
  const label = byClass(card, 'item-new-label')[0];
  const id = byClass(card, 'item-new-id')[0];
  label.value = 'Lamp Oils';
  await label.fire('input');
  assert.equal(id.value, 'lamp-oils');
  id.value = 'oil';
  await id.fire('input');
  label.value = 'Other';
  await label.fire('input');
  assert.equal(id.value, 'oil');
});

test('Reject card rejects every report on it; a per-report Reject removes only that one', async () => {
  const rows = [itemRow('a', 'Lantern Oil', { category: 'horses' }), itemRow('b', 'lantern oil', { category: 'horses', created_at: '2026-09-20T09:10:00.000Z' })];
  const whole = await mountItems(rows);
  await byClass(whole.cards()[0], 'item-reject-card')[0].fire('click');
  assert.deepEqual(whole.decisions, [['a', { decision: 'reject' }], ['b', { decision: 'reject' }]]);

  const one = await mountItems(rows);
  await byClass(one.cards()[0], 'item-reject')[1].fire('click');
  assert.deepEqual(one.decisions, [['b', { decision: 'reject' }]]);
});

test('an already-decided report does not stop the card, but a real failure does', async () => {
  const rows = [itemRow('a', 'Lantern Oil', { category: 'horses' }), itemRow('b', 'lantern oil', { category: 'horses', created_at: '2026-09-20T09:10:00.000Z' })];

  const decided = await mountItems(rows, { decideItem: async (id) => (id === 'a' ? { ok: false, status: 404, data: null, error: 'no pending item report with that id' } : { ok: true, status: 200, data: {}, error: null }) });
  await byClass(decided.cards()[0], 'item-approve')[0].fire('click');
  assert.equal(decided.decisions.length, 2);
  assert.equal(decided.itemFetches(), 2);

  const broken = await mountItems(rows, { decideItem: async () => ({ ok: false, status: 500, data: null, error: 'internal error' }) });
  const card = broken.cards()[0];
  await byClass(card, 'item-approve')[0].fire('click');
  assert.equal(broken.decisions.length, 1, 'stops at the first real failure');
  assert.equal(byClass(card, 'item-status')[0].textContent, 'internal error');
  assert.equal(broken.itemFetches(), 1, 'no reload hides the error');
});

test('without the site’s data files the section says so instead of guessing', async () => {
  const h = await mountItems([itemRow('a', 'Lantern Oil', { category: 'horses' })], {
    loadSiteData: async () => { throw new Error('404'); },
  });
  assert.equal(h.cards().length, 0);
  assert.match(h.elements.itemStatus.textContent, /could not load/i);
});
