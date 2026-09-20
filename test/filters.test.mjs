import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesFilters, parseRoute, DEFAULT_FILTERS } from '../assets/js/filters.js';

const conf = (over = {}) => ({ state: 'PREDICTED', provenance: 'profile', ...over });

test('by default nothing is filtered out', () => {
  assert.equal(passesFilters(conf({ state: 'UNTESTED' }), DEFAULT_FILTERS), true);
});

test('hideUntested removes only untested pairs', () => {
  const f = { ...DEFAULT_FILTERS, hideUntested: true };
  assert.equal(passesFilters(conf({ state: 'UNTESTED' }), f), false);
  assert.equal(passesFilters(conf({ state: 'PREDICTED' }), f), true);
});

test('hideUnconfirmed removes predictions but keeps observed results', () => {
  const f = { ...DEFAULT_FILTERS, hideUnconfirmed: true };
  assert.equal(passesFilters(conf({ state: 'PREDICTED' }), f), false);
  assert.equal(passesFilters(conf({ state: 'CONFIRMED' }), f), true);
  assert.equal(passesFilters(conf({ state: 'FAVORITE' }), f), true);
  assert.equal(passesFilters(conf({ state: 'CONTESTED' }), f), true);
});

test('routes parse to a view and an optional id', () => {
  assert.deepEqual(parseRoute('#/character/dietrich'), { view: 'character', id: 'dietrich' });
  assert.deepEqual(parseRoute('#/gift/pastry-cookbook'), { view: 'gift', id: 'pastry-cookbook' });
  assert.deepEqual(parseRoute('#/matrix'), { view: 'matrix', id: null });
  assert.deepEqual(parseRoute('#/favorites'), { view: 'favorites', id: null });
});

test('an empty or unknown route falls back to the character view', () => {
  assert.deepEqual(parseRoute(''), { view: 'character', id: null });
  assert.deepEqual(parseRoute('#/nonsense'), { view: 'character', id: null });
});
