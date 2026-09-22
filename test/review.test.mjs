import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewRowModel, humanAge, TOKEN_KEY, mountReview } from '../assets/js/review.js';

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
    return { enabled: true, fetchReview: async () => ({ ok: true, data: { reports: [] } }) };
  };

  mountReview({ elements, storage, createClient });
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
    return { enabled: true, fetchReview: async () => ({ ok: true, data: { reports: [] } }) };
  };

  mountReview({ elements, storage, createClient });
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'seeded-token');
});
