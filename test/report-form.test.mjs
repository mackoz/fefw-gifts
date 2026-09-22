import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportPayload, REACTION_PROMPTS } from '../assets/js/report-form.js';
import { createTurnstile } from '../assets/js/turnstile.js';
import { REACTIONS } from '../assets/js/confidence.js';

const FIELDS = { character: 'nydine', gift: 'grooming-kit', reaction: 'loved', turnstileToken: 'tok' };

test('the form offers exactly the five in-game tiers, in order', () => {
  assert.deepEqual(REACTION_PROMPTS.map((p) => p.value), REACTIONS);
  for (const prompt of REACTION_PROMPTS) assert.ok(prompt.label.length > 0);
});

test('a complete form produces the Worker payload', () => {
  const { errors, payload } = buildReportPayload(FIELDS);
  assert.deepEqual(errors, []);
  assert.deepEqual(payload, {
    character: 'nydine', gift: 'grooming-kit', reaction: 'loved',
    turnstileToken: 'tok',
  });
});

test('each missing field produces its own plain-language message', () => {
  assert.match(buildReportPayload({ ...FIELDS, character: '' }).errors[0], /character/i);
  assert.match(buildReportPayload({ ...FIELDS, gift: '' }).errors[0], /gift/i);
  assert.match(buildReportPayload({ ...FIELDS, reaction: '' }).errors[0], /game showed/i);
  assert.match(buildReportPayload({ ...FIELDS, turnstileToken: '' }).errors[0], /human/i);
});

test('a failed build yields no payload at all', () => {
  assert.equal(buildReportPayload({}).payload, null);
});

// --- Turnstile wrapper ---

function fakeTurnstile() {
  const widget = { options: null, resets: 0 };
  return {
    widget,
    global: {
      render(container, options) { widget.options = options; return 'widget-1'; },
      reset() { widget.resets += 1; },
    },
  };
}

test('an unconfigured site key leaves the wrapper switched off', async () => {
  const turnstile = createTurnstile({ siteKey: null });
  assert.equal(turnstile.configured, false);
  await assert.rejects(() => turnstile.mount(), /not configured/);
});

test('mounting renders once and the callback captures the token', async () => {
  const fake = fakeTurnstile();
  let loads = 0;
  const turnstile = createTurnstile({
    siteKey: 'site', container: {},
    loadScript: async () => { loads += 1; },
    getGlobal: () => fake.global,
  });

  await turnstile.mount();
  await turnstile.mount();
  assert.equal(loads, 1, 'the script is fetched once');
  assert.equal(fake.widget.resets, 1, 'a second mount resets rather than re-rendering');

  assert.equal(turnstile.token(), null);
  fake.widget.options.callback('fresh-token');
  assert.equal(turnstile.token(), 'fresh-token');
});

test('expiry and errors clear the token, so a stale one is never submitted', async () => {
  const fake = fakeTurnstile();
  const turnstile = createTurnstile({ siteKey: 'site', container: {}, loadScript: async () => {}, getGlobal: () => fake.global });
  await turnstile.mount();

  fake.widget.options.callback('t1');
  fake.widget.options['expired-callback']();
  assert.equal(turnstile.token(), null);

  fake.widget.options.callback('t2');
  fake.widget.options['error-callback']();
  assert.equal(turnstile.token(), null);
});

test('reset clears the token so each submission needs a fresh one', async () => {
  const fake = fakeTurnstile();
  const turnstile = createTurnstile({ siteKey: 'site', container: {}, loadScript: async () => {}, getGlobal: () => fake.global });
  await turnstile.mount();
  fake.widget.options.callback('t1');
  turnstile.reset();
  assert.equal(turnstile.token(), null);
});

test('a script that never provides the global is reported, not hung on', async () => {
  const turnstile = createTurnstile({ siteKey: 'site', container: {}, loadScript: async () => {}, getGlobal: () => undefined });
  await assert.rejects(() => turnstile.mount(), /failed to load/);
});

test('a failed load can be retried: the cache is cleared, not stuck rejected', async () => {
  const fake = fakeTurnstile();
  let calls = 0;
  const turnstile = createTurnstile({
    siteKey: 'site', container: {},
    loadScript: async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
    },
    getGlobal: () => fake.global,
  });

  await assert.rejects(() => turnstile.mount(), /network down/);
  await turnstile.mount();
  assert.equal(turnstile.token(), null);
  assert.equal(calls, 2, 'loadScript must be retried, not replayed from a cached rejection');
});
