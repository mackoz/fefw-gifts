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
  d.observations.push({ id: 'o1', gift: 'g', character: 'c', reaction: 'liked', points: null, date: '2026-09-20', reporter: 'someone' });
  const { errors } = validate(d);
  assert.ok(errors.some((e) => /forbidden identifying field: reporter/.test(e)));
});
