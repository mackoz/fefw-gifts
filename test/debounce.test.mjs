import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from '../assets/js/debounce.js';

test('three rapid calls then advancing 120ms invokes the function once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 120);

  fn();
  fn();
  fn();
  t.mock.timers.tick(120);

  assert.equal(calls, 1);
});

test('it is invoked with the last call\'s arguments', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let seen = null;
  const fn = debounce((...args) => { seen = args; }, 120);

  fn('first');
  fn('second');
  fn('third');
  t.mock.timers.tick(120);

  assert.deepEqual(seen, ['third']);
});

test('advancing only 119ms does not invoke it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 120);

  fn();
  t.mock.timers.tick(119);

  assert.equal(calls, 0);
});

test('after it fires, a further call schedules and fires again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 120);

  fn();
  t.mock.timers.tick(120);
  assert.equal(calls, 1);

  fn();
  t.mock.timers.tick(120);
  assert.equal(calls, 2);
});
