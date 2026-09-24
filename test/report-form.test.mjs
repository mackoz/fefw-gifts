import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportPayload, REACTION_PROMPTS, reportCharacterOptions, createReportForm,
  buildItemReportPayload, categoryLineOptions, MISSING_ITEM, NOT_LISTED, ITEM_SUCCESS,
} from '../assets/js/report-form.js';
import { createTurnstile } from '../assets/js/turnstile.js';
import { REACTIONS } from '../assets/js/confidence.js';
import { loadDataset } from '../scripts/validate.mjs';

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

// --- Character options: the report dropdown must never leak a spoiler ---

const OPTION_FIXTURE = [
  { id: 'a', giftable: true, spoiler: false },
  { id: 's', giftable: true, spoiler: true },
  { id: 'n', giftable: false, spoiler: false },
  { id: 'ns', giftable: false, spoiler: true },
];

const ids = (list) => list.map((c) => c.id);

test('by default, spoilers are hidden and non-giftable characters never appear', () => {
  assert.deepEqual(ids(reportCharacterOptions(OPTION_FIXTURE)), ['a']);
});

test('hideSpoilers: true hides spoiler characters', () => {
  assert.deepEqual(ids(reportCharacterOptions(OPTION_FIXTURE, { hideSpoilers: true })), ['a']);
});

test('hideSpoilers: false lets spoiler characters through', () => {
  assert.deepEqual(ids(reportCharacterOptions(OPTION_FIXTURE, { hideSpoilers: false })), ['a', 's']);
});

test('against the real committed data, hiding spoilers yields only giftable non-spoiler characters', async () => {
  const { characters } = await loadDataset('data');
  const options = reportCharacterOptions(characters, { hideSpoilers: true });
  assert.ok(options.length > 0, 'expected at least one giftable, non-spoiler character');
  for (const c of options) {
    assert.equal(c.spoiler, false, `${c.id} must not be a spoiler`);
    assert.equal(c.giftable, true, `${c.id} must be giftable`);
  }
  assert.ok(!options.some((c) => c.id === 'bertrand'), 'Bertrand is a spoiler and must be hidden');
});

// --- createReportForm: behaviour, not just the source, of the character
// dropdown -- exercised against a minimal stub DOM (no dependencies) rather
// than a real <select>, since only one thing about a real select matters
// here: that resetting its children also resets its selected value.

// Shared by every element document.createElement is asked for (options,
// plus the label/input/text-node plumbing fillReactions() builds). Only
// .value/.textContent are ever asserted on; .append and .className exist so
// that unrelated plumbing doesn't throw.
function stubElement() {
  return { value: '', textContent: '', className: '', hidden: false, dataset: {}, append() {}, addEventListener() {} };
}

function stubSelect() {
  const listeners = {};
  return {
    options: [],
    _value: '',
    replaceChildren() {
      this.options = [];
      this._value = '';
    },
    append(...opts) {
      this.options.push(...opts);
    },
    get value() {
      return this._value;
    },
    set value(v) {
      this._value = this.options.some((o) => o.value === v) ? v : '';
    },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type) { return Promise.all((listeners[type] ?? []).map((fn) => fn({ preventDefault() {} }))); },
  };
}

// The elements only missing-item mode reads. The spoiler test below does not
// exercise that mode, so plain stand-ins are enough there.
function itemStubs() {
  const stub = () => ({
    value: '', textContent: '', hidden: false, dataset: {},
    addEventListener() {}, replaceChildren() {}, append() {}, querySelector: () => null,
  });
  return {
    characterField: stub(), reactionsLegend: stub(), itemFields: stub(), itemName: stub(),
    itemDuplicate: stub(), itemCategory: stubSelect(), itemLineField: stub(), itemLine: stub(),
    itemRarity: stub(), itemCharacter: stubSelect(),
  };
}

test('createReportForm keeps the character dropdown in sync with the live filter, on every open', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => stubElement(), createTextNode: () => stubElement() };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  const character = stubSelect();
  const gift = stubSelect();
  const form = {
    reset() {
      character.value = '';
      gift.value = '';
    },
    addEventListener() {},
  };
  const dialog = { showModal() {}, close() {} };
  const reactions = { append() {}, querySelector: () => null };
  const status = { textContent: '', dataset: {} };
  const cancel = { addEventListener() {} };
  const submit = { disabled: false };
  const turnstile = { mount: async () => {}, reset() {}, token: () => '' };
  const api = { submitReport: async () => ({ ok: true }) };

  const index = {
    characters: OPTION_FIXTURE.filter((c) => c.id !== 'ns'),
    gifts: [{ id: 'g1', name: 'G1' }],
    categories: [],
  };

  const filters = { hideSpoilers: true };
  const reportForm = createReportForm({
    elements: { dialog, form, character, gift, reactions, status, cancel, submit, ...itemStubs() },
    index, api, turnstile,
    getFilters: () => filters,
  });

  await reportForm.open();
  assert.deepEqual(
    character.options.map((o) => o.value), ['', 'a'],
    'spoilers stay hidden by default',
  );

  filters.hideSpoilers = false;
  await reportForm.open();
  assert.deepEqual(
    character.options.map((o) => o.value), ['', 'a', 's'],
    'the filter is read at open time, not at creation time',
  );

  await reportForm.open('a', 'g1');
  assert.equal(character.value, 'a', 'the character preselection survives the refill');
  assert.equal(gift.value, 'g1', 'the gift preselection survives the refill');

  await reportForm.open();
  await reportForm.open();
  await reportForm.open();
  const blanks = character.options.filter((o) => o.value === '');
  assert.equal(blanks.length, 1, 'repeated opens leave exactly one placeholder option');
  const nonBlank = character.options.filter((o) => o.value !== '').map((o) => o.value);
  assert.equal(new Set(nonBlank).size, nonBlank.length, 'repeated opens must not duplicate options');
});

// --- Missing-item mode: pure parts ---

const ITEM_GIFTS = [{ id: 'horse-grooming-kit', name: 'Horse-Grooming Kit' }];
const ITEM_FIELDS = {
  name: '  lantern   oil ', category: 'horses', categoryLine: 'ignored unless not listed',
  rarity: '', character: '', reaction: '', turnstileToken: 'tok',
};

test('the in-game line options use the game’s words, sorted, and end with the escape hatch', () => {
  const options = categoryLineOptions([
    { id: 'horses', label: 'Horses', inGameDescriptor: 'those who love horses' },
    { id: 'books', label: 'Books', inGameDescriptor: 'book lovers' },
    { id: 'mystery', label: 'Mystery', inGameDescriptor: null },
  ]);
  assert.deepEqual(options, [
    { value: 'books', label: 'book lovers' },
    { value: 'mystery', label: 'Mystery' },
    { value: 'horses', label: 'those who love horses' },
    { value: NOT_LISTED, label: 'Not listed — type it' },
  ]);
});

test('a complete missing-item form produces the Worker payload, with absent fields as null', () => {
  const { errors, payload, listed } = buildItemReportPayload(ITEM_FIELDS, { gifts: ITEM_GIFTS });
  assert.deepEqual(errors, []);
  assert.equal(listed, null);
  assert.deepEqual(payload, {
    name: 'lantern oil', category: 'horses', categoryLine: null, rarity: null,
    character: null, reaction: null, turnstileToken: 'tok',
  });
});

test('"Not listed" sends the typed line instead of a category', () => {
  const { payload } = buildItemReportPayload(
    { ...ITEM_FIELDS, category: NOT_LISTED, categoryLine: ' lovers of   lanterns ', rarity: 'rare', character: 'alexandra', reaction: 'loved' },
    { gifts: ITEM_GIFTS },
  );
  assert.equal(payload.category, null);
  assert.equal(payload.categoryLine, 'lovers of lanterns');
  assert.equal(payload.rarity, 'rare');
  assert.equal(payload.character, 'alexandra');
  assert.equal(payload.reaction, 'loved');
});

for (const [label, patch, pattern] of [
  ['an already-listed name', { name: 'horse grooming kit' }, /already listed as Horse-Grooming Kit/],
  ['no name', { name: '' }, /item name/i],
  ['no in-game line', { category: '' }, /in-game/i],
  ['"Not listed" with nothing typed', { category: NOT_LISTED, categoryLine: ' ' }, /in-game line/i],
  ['a character without a reaction', { character: 'alexandra' }, /or neither/],
  ['a reaction without a character', { reaction: 'loved' }, /or neither/],
  ['no Turnstile token', { turnstileToken: '' }, /human/i],
]) {
  test(`a missing-item form with ${label} is refused with a message and no payload`, () => {
    const { errors, payload } = buildItemReportPayload({ ...ITEM_FIELDS, ...patch }, { gifts: ITEM_GIFTS });
    assert.ok(errors.some((e) => pattern.test(e)), `errors were: ${errors.join(' | ')}`);
    assert.equal(payload, null);
  });
}

test('an already-listed name is the first thing the player is told, with the gift to link to', () => {
  const { errors, listed } = buildItemReportPayload({ ...ITEM_FIELDS, name: 'Horse-Grooming Kit', category: '' }, { gifts: ITEM_GIFTS });
  assert.match(errors[0], /already listed/);
  assert.equal(listed.id, 'horse-grooming-kit');
});

// --- Missing-item mode: behaviour, against the same kind of stub DOM ---

function stubControl(extra = {}) {
  const listeners = {};
  return {
    value: '', textContent: '', className: '', hidden: false, disabled: false, href: '',
    dataset: {}, children: [],
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type) { return Promise.all((listeners[type] ?? []).map((fn) => fn({ preventDefault() {} }))); },
    ...extra,
  };
}

const ITEM_INDEX = {
  characters: [
    { id: 'alexandra', name: 'Alexandra', giftable: true, spoiler: false },
    { id: 'bertrand', name: 'Bertrand', giftable: true, spoiler: true },
  ],
  gifts: ITEM_GIFTS,
  categories: [
    { id: 'horses', label: 'Horses', inGameDescriptor: 'those who love horses' },
    { id: 'books', label: 'Books', inGameDescriptor: 'book lovers' },
  ],
};

function formHarness(t, { submitItemReport = async () => ({ ok: true, status: 201, data: { id: 'i1', status: 'pending' }, error: null }) } = {}) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tag) => stubControl({ tagName: tag.toUpperCase() }),
    createTextNode: (text) => ({ textContent: text }),
  };
  t.after(() => { globalThis.document = originalDocument; });

  const radio = { reaction: '', rarity: '' };
  const calls = { submitItemReport: [], submitReport: [], resets: 0, refreshed: 0 };
  const el = {
    character: stubSelect(), gift: stubSelect(), itemCategory: stubSelect(), itemCharacter: stubSelect(),
    characterField: stubControl(), reactionsLegend: stubControl(), itemFields: stubControl({ hidden: true }),
    itemName: stubControl(), itemDuplicate: stubControl({ hidden: true }), itemLineField: stubControl({ hidden: true }),
    itemLine: stubControl(), status: stubControl(), cancel: stubControl(), submit: stubControl(),
    reactions: stubControl({ querySelector: () => (radio.reaction ? { value: radio.reaction } : null) }),
    itemRarity: stubControl({ querySelector: () => ({ value: radio.rarity }) }),
    dialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
  };
  el.form = stubControl({
    reset() {
      for (const select of [el.character, el.gift, el.itemCategory, el.itemCharacter]) select.value = '';
      el.itemName.value = '';
      el.itemLine.value = '';
      radio.reaction = '';
      radio.rarity = '';
    },
  });

  const filters = { hideSpoilers: true };
  const reportForm = createReportForm({
    elements: el,
    index: ITEM_INDEX,
    api: {
      submitItemReport: async (payload) => { calls.submitItemReport.push(payload); return submitItemReport(payload); },
      submitReport: async (payload) => { calls.submitReport.push(payload); return { ok: true, status: 201, data: {}, error: null }; },
    },
    turnstile: { mount: async () => {}, reset() { calls.resets += 1; }, token: () => 'tok' },
    onSubmitted: () => { calls.refreshed += 1; },
    getFilters: () => filters,
  });

  return {
    reportForm, el, radio, calls, filters,
    // fillReactions appends the "not given" wrapper last.
    notGiven: () => el.reactions.children.at(-1),
    submit: () => el.form.fire('submit'),
  };
}

test('the gift select ends with the missing-item option, and choosing it swaps the fields', async (t) => {
  const h = formHarness(t);
  await h.reportForm.open();
  const last = h.el.gift.options.at(-1);
  assert.equal(last.value, MISSING_ITEM);
  assert.equal(last.textContent, 'My item isn’t listed…');
  assert.equal(h.el.itemFields.hidden, true, 'result mode hides the item fields');
  assert.equal(h.el.characterField.hidden, false);
  assert.equal(h.notGiven().hidden, true);

  h.el.gift.value = MISSING_ITEM;
  await h.el.gift.fire('change');
  assert.equal(h.el.itemFields.hidden, false);
  assert.equal(h.el.characterField.hidden, true, 'the result-mode character field makes way');
  assert.equal(h.notGiven().hidden, false, 'the result can be un-chosen');
  assert.match(h.el.reactionsLegend.textContent, /optional/);

  h.el.gift.value = 'horse-grooming-kit';
  await h.el.gift.fire('change');
  assert.equal(h.el.itemFields.hidden, true);
  assert.equal(h.el.characterField.hidden, false);
  assert.equal(h.el.reactionsLegend.textContent, 'What did the game show?');
});

test('"Not listed — type it" reveals the typed line, and nothing else does', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('Lantern Oil');
  assert.equal(h.el.itemCategory.options.at(-1).value, NOT_LISTED);
  assert.equal(h.el.itemLineField.hidden, true);
  h.el.itemCategory.value = NOT_LISTED;
  await h.el.itemCategory.fire('change');
  assert.equal(h.el.itemLineField.hidden, false);
  h.el.itemCategory.value = 'horses';
  await h.el.itemCategory.fire('change');
  assert.equal(h.el.itemLineField.hidden, true);
});

test('openMissingItem opens straight into missing-item mode with the name pre-filled', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('  Lantern   Oil ');
  assert.equal(h.el.dialog.open, true);
  assert.equal(h.el.gift.value, MISSING_ITEM);
  assert.equal(h.el.itemName.value, 'Lantern Oil');
  assert.equal(h.el.itemFields.hidden, false);
});

test('the "gave it to" list respects Hide spoilers, read at open time', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('Lantern Oil');
  assert.deepEqual(h.el.itemCharacter.options.map((o) => o.value), ['', 'alexandra']);
  h.filters.hideSpoilers = false;
  await h.reportForm.openMissingItem('Lantern Oil');
  assert.deepEqual(h.el.itemCharacter.options.map((o) => o.value), ['', 'alexandra', 'bertrand']);
});

test('a listed name shows the duplicate note with a link to that gift, live', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('horse grooming kit');
  assert.equal(h.el.itemDuplicate.hidden, false);
  const link = h.el.itemDuplicate.children.find((node) => node.tagName === 'A');
  assert.equal(link.href, '#/gift/horse-grooming-kit');
  assert.equal(link.textContent, 'Horse-Grooming Kit');

  h.el.itemName.value = 'Lantern Oil';
  await h.el.itemName.fire('input');
  assert.equal(h.el.itemDuplicate.hidden, true);
});

test('a listed name blocks sending', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('Horse-Grooming Kit');
  h.el.itemCategory.value = 'horses';
  await h.submit();
  assert.match(h.el.status.textContent, /already listed/);
  assert.equal(h.calls.submitItemReport.length, 0);
});

test('the result is both or neither: a character alone is refused, both together are sent', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('Lantern Oil');
  h.el.itemCategory.value = 'horses';
  h.el.itemCharacter.value = 'alexandra';
  await h.submit();
  assert.match(h.el.status.textContent, /or neither/);
  assert.equal(h.calls.submitItemReport.length, 0);

  h.radio.reaction = 'loved';
  await h.submit();
  assert.equal(h.calls.submitItemReport.length, 1);
  assert.equal(h.calls.submitItemReport[0].character, 'alexandra');
  assert.equal(h.calls.submitItemReport[0].reaction, 'loved');
});

test('a complete missing-item report is sent once and the dialog says so without refreshing anything', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('lantern oil');
  h.el.itemCategory.value = NOT_LISTED;
  h.el.itemLine.value = 'lovers of lanterns';
  h.radio.rarity = 'rare';
  await h.submit();

  assert.deepEqual(h.calls.submitItemReport, [{
    name: 'lantern oil', category: null, categoryLine: 'lovers of lanterns', rarity: 'rare',
    character: null, reaction: null, turnstileToken: 'tok',
  }]);
  assert.deepEqual(h.calls.submitReport, [], 'never sent as a result report');
  assert.equal(h.calls.resets, 1, 'the spent Turnstile token is reset');
  assert.equal(h.el.status.textContent, ITEM_SUCCESS);
  assert.equal(h.el.status.dataset.tone, 'success');
  assert.equal(h.el.dialog.open, true, 'the dialog stays open to say it was received');
  assert.equal(h.calls.refreshed, 0, 'nothing public changed, so the overlay is not refreshed');
  assert.equal(h.el.gift.value, MISSING_ITEM, 'ready for another find');
  assert.equal(h.el.itemName.value, '');
});

test('a refused missing-item report shows the Worker message and keeps what was typed', async (t) => {
  const h = formHarness(t, { submitItemReport: async () => ({ ok: false, status: 403, data: null, error: 'could not verify that you are human' }) });
  await h.reportForm.openMissingItem('Lantern Oil');
  h.el.itemCategory.value = 'horses';
  await h.submit();
  assert.equal(h.el.status.textContent, 'could not verify that you are human');
  assert.equal(h.el.itemName.value, 'Lantern Oil');
  assert.equal(h.calls.resets, 1);
});

test('result mode still sends a result report, closes, and refreshes the overlay', async (t) => {
  const h = formHarness(t);
  await h.reportForm.open('alexandra', 'horse-grooming-kit');
  h.radio.reaction = 'liked';
  await h.submit();
  assert.equal(h.calls.submitReport.length, 1);
  assert.equal(h.calls.submitItemReport.length, 0);
  assert.equal(h.el.dialog.open, false);
  assert.equal(h.calls.refreshed, 1);
});

// A leftover ITEM_SUCCESS from a previous find must not still be showing once
// the player has moved on to reporting a result against a listed gift --
// switching modes is as good a sign as any that the message is stale.
test('an item success message is cleared once the player switches to a listed gift', async (t) => {
  const h = formHarness(t);
  await h.reportForm.openMissingItem('lantern oil');
  h.el.itemCategory.value = 'horses';
  await h.submit();
  assert.equal(h.el.status.textContent, ITEM_SUCCESS);
  assert.equal(h.el.status.dataset.tone, 'success');

  h.el.gift.value = 'horse-grooming-kit';
  await h.el.gift.fire('change');
  assert.equal(h.el.status.textContent, '');
  assert.notEqual(h.el.status.dataset.tone, 'success');
});

test('an error status is not cleared by a mode change', async (t) => {
  const h = formHarness(t, { submitItemReport: async () => ({ ok: false, status: 403, data: null, error: 'could not verify that you are human' }) });
  await h.reportForm.openMissingItem('Lantern Oil');
  h.el.itemCategory.value = 'horses';
  await h.submit();
  assert.equal(h.el.status.textContent, 'could not verify that you are human');
  assert.notEqual(h.el.status.dataset.tone, 'success');

  h.el.gift.value = 'horse-grooming-kit';
  await h.el.gift.fire('change');
  assert.equal(h.el.status.textContent, 'could not verify that you are human', 'an error message survives a mode change');
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
