import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXT_PATTERN, ID_PATTERN, RARITIES,
  cleanText, isValidText, normalizeName, slugify, suggestName, findListedGift,
  validateItemReport, validateItemApproval,
} from '../assets/js/item-rules.js';
import { REACTIONS } from '../assets/js/confidence.js';
import { loadDataset } from '../scripts/validate.mjs';

// --- Text ---

test('cleanText trims and collapses inner whitespace, and refuses non-strings', () => {
  assert.equal(cleanText('  Horse \t  grooming\nkit  '), 'Horse grooming kit');
  assert.equal(cleanText(''), '');
  for (const value of [null, undefined, 7, {}, ['a']]) assert.equal(cleanText(value), null);
});

test('the text rule accepts the punctuation real item names use', () => {
  for (const good of ['Trader’s Handbook', "Trader's Handbook", 'Special “Medicine”', 'Horse-Grooming Kit', 'St. Elmo', 'ab', 'x'.repeat(40), '  padded   name  ']) {
    assert.ok(isValidText(good), `expected ${JSON.stringify(good)} to pass`);
  }
});

test('the text rule rejects markup, odd characters and the wrong length', () => {
  for (const bad of ['a', 'x'.repeat(41), '<b>hi</b>', 'semi;colon', 'emoji 🙂', 'tab\u0000null', '', null, undefined, 42, 'a<b', '<b>', 'x>y']) {
    assert.ok(!isValidText(bad), `expected ${JSON.stringify(bad)} to fail`);
  }
});

test('the exported patterns are the ones the spec names', () => {
  assert.equal(TEXT_PATTERN.source, String.raw`^[A-Za-z0-9 '\-’“”.]{2,40}$`);
  assert.equal(ID_PATTERN.source, '^[a-z0-9][a-z0-9-]{0,63}$');
  assert.deepEqual(RARITIES, ['common', 'uncommon', 'rare']);
});

// --- Names ---

test('normalizeName makes spelling variants of one item equal', () => {
  assert.equal(normalizeName('Horse-Grooming Kit'), normalizeName('horse grooming kit'));
  assert.equal(normalizeName('Trader’s Handbook'), normalizeName("traders handbook"));
  assert.equal(normalizeName('Special “Medicine”'), 'specialmedicine');
  assert.equal(normalizeName(null), '');
});

test('slugify produces the ids gifts.json already uses', () => {
  assert.equal(slugify('Special “Medicine”'), 'special-medicine');
  assert.equal(slugify('Trader’s Handbook'), 'traders-handbook');
  assert.equal(slugify('Horse-Grooming Kit'), 'horse-grooming-kit');
  assert.equal(slugify('  St. Elmo  '), 'st-elmo');
  assert.equal(slugify("''"), '');
});

test('suggestName capitalises every word, including after a hyphen or an opening quote', () => {
  assert.equal(suggestName('horse-grooming kit'), 'Horse-Grooming Kit');
  assert.equal(suggestName('special “medicine”'), 'Special “Medicine”');
  assert.equal(suggestName("trader's handbook"), "Trader's Handbook");
  // The in-game exception ("History of a Master") is the maintainer's edit to make.
  assert.equal(suggestName('history of a master'), 'History Of A Master');
  // The rest of each word is left alone.
  assert.equal(suggestName('mcGuffin  box'), 'McGuffin Box');
  assert.equal(suggestName(null), '');
});

test('findListedGift matches on the normalised name, and only then', () => {
  const gifts = [{ id: 'horse-grooming-kit', name: 'Horse-Grooming Kit' }];
  assert.equal(findListedGift(gifts, 'horse grooming KIT').id, 'horse-grooming-kit');
  assert.equal(findListedGift(gifts, 'horse grooming'), null);
  assert.equal(findListedGift(gifts, ''), null, 'an empty name matches nothing');
  assert.equal(findListedGift(undefined, 'x'), null);
});

// --- Real data: the rules must fit what is already committed ---

test('every committed gift name passes the text rule and slugifies to its own id', async () => {
  const { gifts } = await loadDataset('data');
  for (const gift of gifts) {
    assert.ok(isValidText(gift.name), `${gift.id}: name fails the text rule`);
    assert.equal(slugify(gift.name), gift.id, `${gift.id}: slugify(name) differs from the id`);
  }
});

test('no two committed gifts normalise to the same name', async () => {
  const { gifts } = await loadDataset('data');
  const seen = new Map();
  for (const gift of gifts) {
    const key = normalizeName(gift.name);
    assert.ok(!seen.has(key), `${gift.id} and ${seen.get(key)} normalise equal`);
    seen.set(key, gift.id);
  }
});

test('every committed category id fits the rule a new category must meet', async () => {
  const { categories } = await loadDataset('data');
  for (const category of categories) {
    assert.ok(ID_PATTERN.test(category.id), `${category.id}: id`);
  }
});

// --- validateItemReport ---

const REPORT = { name: '  Lantern   oil ', category: 'horses', categoryLine: null, rarity: 'uncommon', character: 'alexandra', reaction: 'loved' };

test('a well-formed item report validates and its name is cleaned', () => {
  const { errors, value } = validateItemReport(REPORT);
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { name: 'Lantern oil', category: 'horses', categoryLine: null, rarity: 'uncommon', character: 'alexandra', reaction: 'loved' });
});

test('a typed line is accepted in place of a category, and cleaned', () => {
  const { errors, value } = validateItemReport({ ...REPORT, category: null, categoryLine: ' lovers of   lanterns ' });
  assert.deepEqual(errors, []);
  assert.equal(value.category, null);
  assert.equal(value.categoryLine, 'lovers of lanterns');
});

test('rarity and the result are optional, and absent means null', () => {
  const { errors, value } = validateItemReport({ name: 'Lantern Oil', category: 'horses' });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { name: 'Lantern Oil', category: 'horses', categoryLine: null, rarity: null, character: null, reaction: null });
});

for (const [label, patch, pattern] of [
  ['a one-letter name', { name: 'L' }, /item name/i],
  ['a name with markup', { name: '<b>Lamp</b>' }, /item name/i],
  ['a name with no letter or digit', { name: "'' --" }, /item name/i],
  ['a missing name', { name: undefined }, /item name/i],
  ['both a category and a typed line', { categoryLine: 'lamp lovers' }, /not both/i],
  ['neither a category nor a typed line', { category: null }, /in-game/i],
  ['a category that is not an id', { category: 'Horses!' }, /category must be a gift-guide id/],
  ['an empty category string', { category: '' }, /category must be a gift-guide id/],
  ['a typed line with markup', { category: null, categoryLine: '<i>x</i>' }, /in-game line/i],
  ['an unknown rarity', { rarity: 'epic' }, /rarity/i],
  ['a character without a reaction', { reaction: null }, /both .* or neither/i],
  ['a reaction without a character', { character: null }, /both .* or neither/i],
  ['a character that is not an id', { character: 'Alexandra' }, /character must be a gift-guide id/],
  ['a reaction outside the five tiers', { reaction: 'amazing' }, /reaction must be one of/],
]) {
  test(`validateItemReport rejects ${label}, with no value`, () => {
    const { errors, value } = validateItemReport({ ...REPORT, ...patch });
    assert.ok(errors.some((e) => pattern.test(e)), `errors were: ${errors.join(' | ')}`);
    assert.equal(value, null);
  });
}

test('validateItemReport survives a body that is not an object', () => {
  for (const body of [null, undefined, 'x', 7]) {
    assert.equal(validateItemReport(body).value, null);
  }
});

test('every reaction tier is accepted', () => {
  for (const reaction of REACTIONS) assert.deepEqual(validateItemReport({ ...REPORT, reaction }).errors, []);
});

// --- validateItemApproval ---

const APPROVAL = { decision: 'approve', name: ' Lantern  Oil ', category: 'horses', rarity: 'uncommon', includeResult: true };

test('a reject needs nothing else', () => {
  assert.deepEqual(validateItemApproval({ decision: 'reject', name: 'ignored' }), { errors: [], value: { decision: 'reject' } });
});

test('an approval with a listed category validates to the full shape', () => {
  assert.deepEqual(validateItemApproval(APPROVAL), {
    errors: [],
    value: { decision: 'approve', name: 'Lantern Oil', giftId: null, category: 'horses', newCategory: null, rarity: 'uncommon', includeResult: true },
  });
});

test('an approval may name no category at all, and rarity may be unknown', () => {
  const { errors, value } = validateItemApproval({ decision: 'approve', name: 'Lantern Oil', rarity: null, includeResult: false });
  assert.deepEqual(errors, []);
  assert.equal(value.category, null);
  assert.equal(value.giftId, null);
  assert.equal(value.newCategory, null);
  assert.equal(value.rarity, null);
});

test('an approval may point at an existing gift instead', () => {
  const { errors, value } = validateItemApproval({ decision: 'approve', name: 'Horse-Grooming Kit', giftId: 'horse-grooming-kit', rarity: null, includeResult: true });
  assert.deepEqual(errors, []);
  assert.equal(value.giftId, 'horse-grooming-kit');
});

test('an approval may create a category, whose text is cleaned', () => {
  const { errors, value } = validateItemApproval({
    decision: 'approve', name: 'Lantern Oil', rarity: 'rare', includeResult: true,
    newCategory: { id: 'lanterns', label: ' Lanterns ', inGameDescriptor: 'lantern   lovers' },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.newCategory, { id: 'lanterns', label: 'Lanterns', inGameDescriptor: 'lantern lovers' });
});

for (const [label, patch, pattern] of [
  ['giftId and category together', { giftId: 'horse-grooming-kit' }, /at most one/],
  ['category and newCategory together', { newCategory: { id: 'x', label: 'Xx', inGameDescriptor: 'xx lovers' } }, /at most one/],
  ['a bad giftId', { category: null, giftId: 'Not An Id' }, /giftId/],
  ['a bad category', { category: 'Horses' }, /category must be a gift-guide id/],
  ['a newCategory that is not an object', { category: null, newCategory: 'lanterns' }, /newCategory/],
  ['a newCategory with a bad id', { category: null, newCategory: { id: 'Lan terns', label: 'Lanterns', inGameDescriptor: 'lantern lovers' } }, /newCategory\.id/],
  ['a newCategory with a bad label', { category: null, newCategory: { id: 'lanterns', label: '<b>', inGameDescriptor: 'lantern lovers' } }, /newCategory\.label/],
  ['a newCategory with a bad line', { category: null, newCategory: { id: 'lanterns', label: 'Lanterns', inGameDescriptor: '' } }, /newCategory\.inGameDescriptor/],
  ['a bad name', { name: 'x' }, /item name/i],
  ['an unknown rarity', { rarity: 'mythic' }, /rarity/i],
  ['includeResult that is not a boolean', { includeResult: 'yes' }, /includeResult/],
  ['includeResult missing', { includeResult: undefined }, /includeResult/],
]) {
  test(`validateItemApproval rejects ${label}`, () => {
    const { errors, value } = validateItemApproval({ ...APPROVAL, ...patch });
    assert.ok(errors.some((e) => pattern.test(e)), `errors were: ${errors.join(' | ')}`);
    assert.equal(value, null);
  });
}

test('an unknown or inherited decision is refused', () => {
  for (const decision of ['maybe', '__proto__', 'constructor', undefined]) {
    const { errors, value } = validateItemApproval({ ...APPROVAL, decision });
    assert.match(errors[0], /decision must be "approve" or "reject"/, String(decision));
    assert.equal(value, null);
  }
  assert.equal(validateItemApproval(null).value, null);
});
