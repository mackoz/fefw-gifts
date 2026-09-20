import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewRowModel, humanAge, TOKEN_KEY } from '../assets/js/review.js';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const ROW = {
  id: 'r1', character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
  points: 40, note: 'rides an ornius', upvotes: 5, downvotes: 2,
  created_at: '2026-09-20T09:00:00.000Z',
};

test('a row becomes something a maintainer can scan', () => {
  const model = reviewRowModel(ROW, NOW);
  assert.equal(model.id, 'r1');
  assert.equal(model.pair, 'nydine · grooming-kit');
  assert.equal(model.reaction, 'loved');
  assert.equal(model.points, 40);
  assert.equal(model.note, 'rides an ornius');
  assert.equal(model.score, 3);
  assert.equal(model.votes, '5 up / 2 down');
  assert.equal(model.age, '3 hours ago');
});

test('missing counters, points and notes do not produce NaN or "undefined"', () => {
  const model = reviewRowModel({ id: 'r2', character: 'a', gift: 'b', reaction: 'none', created_at: '2026-09-20T12:00:00.000Z' }, NOW);
  assert.equal(model.score, 0);
  assert.equal(model.votes, '0 up / 0 down');
  assert.equal(model.points, null);
  assert.equal(model.note, null);
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
