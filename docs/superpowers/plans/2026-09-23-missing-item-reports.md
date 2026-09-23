# Missing-Item Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player anonymously report a gift item that `data/gifts.json` does not list, optionally with one result, have the maintainer correct and approve it on the review page, and have the nightly sync write only the approved values into `data/`.

**Architecture:** A second, parallel pipeline next to result reports. It has its own D1 table (`item_reports`), four new Worker routes, a missing-item mode in the existing report dialog, a "Missing items" section on the review page, and a second batch in `scripts/ingest.mjs`. One pure module, `assets/js/item-rules.js`, holds the validation and naming rules. The form, the Worker (imported by relative path, and bundled by wrangler), the review page and the sync all use it. Nothing in the result-report pipeline changes: `/pending`, votes and the overlay stay as they are.

**Tech Stack:** Vanilla ES modules, Cloudflare Workers + D1 + Turnstile, `node:test`, GitHub Actions. No npm dependencies and no build step.

**Spec:** `docs/superpowers/specs/2026-09-23-missing-item-reports-design.md` (binding). It extends `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md`. Read both before starting a task.

## Global Constraints

These are quoted from `CLAUDE.md` and apply to every task:

- "**No dependencies, ever.** `package.json` has no `dependencies` and no `devDependencies`, only scripts. If a task seems to need a package, stop and ask instead of adding one."
- "**No build step, ever.** Files are served exactly as committed."
- "**Deployment is gated on validation.** The `deploy` job declares `needs: test` … Never remove that dependency, and never add a deploy path that bypasses it."
- "**Browser modules must stay Node-importable.** Every file under `assets/js/` uses ESM `export`, has no top-level DOM access, and must be importable directly by `node:test`. DOM access lives inside functions that receive their elements as arguments."
- "**Worker modules stay Node-importable**, like the browser modules: no top-level `env` access and no Cloudflare-only globals at module scope, so `node:test` can import them directly."
- "**Observations are anonymous and never seeded.** `data/observations.json` entries carry no reporter, name, email, IP, or other identifying field … item-level results come only from real player reports, never from guides."
- "**The Worker collects no personal data.** No name, email, IP, hashed IP, session id or fingerprint, in the D1 schema, the Worker or the client. Turnstile is called without `remoteip`. Adding any of these is a design change, not a fix."
- "**Votes never reach the published site.** `GET /pending` must not select or return `upvotes`/`downvotes`, and no public view may render a tally in any form." This plan adds a rule: **`GET /pending` never reads `item_reports`**, and a test pins it.
- "**A pending report is not a confirmation.** It may not flip a pair to `CONFIRMED` or `FAVORITE`, contribute a reaction, count toward a tally, or produce a negative verdict. Only an approved observation merged into `data/` may." A pending *item* report is never shown publicly at all.
- "**Absence of a match is never a dislike.**"
- "**The site must work with the Worker unavailable or unconfigured.** `WORKER_URL` in `assets/js/config.js` may be null, and null is a supported state rather than a bug." Both missing-item entry points exist only when the API client is enabled.
- "**Wrangler is never installed.** It runs through `npx --yes wrangler …`, so `package.json` keeps no dependencies."
- "**Run `npm test` and `npm run validate` before committing.** Both must pass cleanly (no stray warnings) before any change lands."
- **CSS colours:** every colour resolves to a token from `assets/css/tokens.css`. The only literal colour in `style.css` is `rgb(0 0 0 / 0.6)` on `dialog::backdrop`. New CSS may use only existing tokens (`--ground`, `--raised`, `--ink`, `--muted`, `--rule`, `--edge`, `--confirmed`, `--warning`, …).
- **`hidden` needs a bare element.** `style.css` has no `[hidden] { display: none }` override, so an author `display` rule (e.g. `dialog label { display: block }`, `.reaction-choice`) beats the `hidden` attribute. Put `hidden` only on plain wrappers (`div`, `p`) that no rule gives a `display`.
- **Player text is only ever set with `textContent`** (or `value`), never `innerHTML`. That covers the review page too.
- **Naming rule:** display names capitalise every word ("Horse-Grooming Kit"), except exact in-game names the maintainer confirms ("History of a Master"). This is why `suggestName` is only a pre-fill that the maintainer can edit.
- **Never mutate the real Worker or the real `data/`** from a verification step. `/ingest` and `/ingest-items` mark rows ingested, so they are only ever called on a local stub. Browser checks never submit a valid form to the live Worker.
- **zsh-safe shell:** quote globs, never start a bare word with `=`, and do not rely on word-splitting.
- **Subagents implementing a task do not dispatch further subagents.**

## Shared interfaces (all tasks)

```js
// assets/js/item-rules.js — pure, ESM, no DOM
export const TEXT_PATTERN = /^[A-Za-z0-9 '\-’“”.]{2,40}$/;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const RARITIES = ['common', 'uncommon', 'rare'];
export function cleanText(value)            // non-string → null; else trim + collapse inner whitespace to one space
export function isValidText(value)          // TEXT_PATTERN.test(cleanText(value) ?? '')
export function normalizeName(s)            // lowercase, ’→', drop all non [a-z0-9]
export function slugify(s)                  // lowercase, drop '’“”", runs of non [a-z0-9] → '-', trim '-'
export function suggestName(s)              // capitalise the first letter of every word (split on space and hyphen)
export function findListedGift(gifts, name) // gift whose normalizeName(name) equals; else null
export function validateItemReport(body)    // → { errors, value: { name, category, categoryLine, rarity, character, reaction } | null }
export function validateItemApproval(body)  // → { errors, value: { decision: 'reject' }
                                            //   | { decision: 'approve', name, giftId, category, newCategory, rarity, includeResult } | null }

// worker/src/item-reports.js
insertItemReport(db, { id, name, category, categoryLine, rarity, character, reaction, createdAt })
listItemReviews(db, limit = 200)            // → rows: id, name, category, category_line, rarity, character, reaction, status, created_at
decideItemReport(db, id, value)             // → boolean
takeApprovedItems(db, limit = 200)          // → [{ id, approved (object | null), character, reaction, created_at }], marks them ingested

// Worker routes
POST /item-report        Turnstile   → 201 { id, status: 'pending' } | 400 | 403 | 413
GET  /item-review        admin       → 200 { reports: [...] }  no-store
POST /item-review/:id    admin       → 200 { id, status: 'approved'|'rejected' } | 400 | 404
POST /ingest-items       admin       → 200 { items: [...] }    no-store

// assets/js/api.js (createApi)
submitItemReport(payload), fetchItemReview(), decideItem(id, body)

// assets/js/report-form.js
MISSING_ITEM = '__missing-item__', NOT_LISTED = '__not-listed__', ITEM_SUCCESS
categoryLineOptions(categories) → [{ value, label }]
buildItemReportPayload(fields, { gifts }) → { errors, payload | null, listed | null }
createReportForm(...) → { open(characterId, giftId), openMissingItem(name) }

// assets/js/views/gift.js
missingItemButton(query)  // <button class="missing-item-button" data-name="…">

// assets/js/review.js
NEW_CATEGORY = '__new__'
groupItemReports(rows) → [{ key, reports }]
itemCardDefaults(group, categories) → { name, category, newCategory, rarity }
categoryIdClash(categories, id) → boolean
itemApprovalBody(values, { gifts, categories }) → { errors, body | null, listed | null }
itemReportSummary(row, categories, now) → string
mountReview({ ..., loadSiteData })

// scripts/ingest.mjs
applyItemReports(dataset, items) → { categories, gifts, observations, summary: { newGifts, newCategories, results }, skipped }
fetchItemBatch(workerUrl, adminToken, fetchImpl) → { items, warning | null }
itemSkippedWarning(item) → string
appendCategoryLines(text, entries) → string
ingestSummary({ added, summary }) → string
```

## File map

| File | Task | Responsibility |
|---|---|---|
| `assets/js/item-rules.js` (new) | 1 | The shared rules: text/id patterns, normalising, slugs, name suggestions, both validators |
| `test/item-rules.test.mjs` (new) | 1 | Unit tests plus real-data tests against `data/` |
| `worker/schema.sql` | 2 | Adds the `item_reports` table and its status index |
| `worker/src/item-reports.js` (new) | 2 | SQL for the item queue |
| `worker/src/router.js` | 2 | Four new routes |
| `worker/README.md` | 2 | Endpoint table, storage note, upgrade/deploy steps |
| `test/worker-items.test.mjs` (new), `test/worker-admin.test.mjs` | 2 | Route and store tests |
| `assets/js/api.js`, `test/api.test.mjs` | 3 | Client methods |
| `index.html`, `assets/js/report-form.js`, `assets/js/app.js`, `assets/js/views/gift.js`, `assets/css/style.css` | 4 | Player form and Gifts-tab entry point |
| `test/report-form.test.mjs`, `test/views.test.mjs`, `test/assets.test.mjs` | 4 | Form, view and markup tests |
| `review/index.html`, `assets/js/review.js`, `assets/css/style.css`, `test/review.test.mjs` | 5 | Review section |
| `scripts/ingest.mjs`, `.github/workflows/sync-reports.yml`, `test/ingest.test.mjs` | 6 | Nightly sync |
| `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md`, `CONTRIBUTING.md` | 7 | Docs |

Baseline before Task 1: `npm test` → 350 pass, 0 fail; `npm run validate` → `data valid`.

While this plan was being written, every code and test block in it was applied to a scratch copy of the repository. The full suite passed there (501 tests), and so did the end-to-end ingest script. An executor should still expect to adjust line numbers, but should not need to fix the code.

---

### Task 1: Shared rules (`assets/js/item-rules.js`)

**Files:**
- Create: `assets/js/item-rules.js`
- Test: `test/item-rules.test.mjs`

**Interfaces:**
- Consumes: `REACTIONS` from `assets/js/confidence.js`; `loadDataset` from `scripts/validate.mjs` (tests only).
- Produces: every export listed under "Shared interfaces" for `item-rules.js`. Error strings are plain English, and the ones a player can trigger are written for a player:
  - name: `The item name must be 2–40 characters: letters, numbers, spaces, apostrophes, hyphens, full stops or curly quotes.`
  - no line: `Pick the in-game “Primarily enjoyed by …” line, or type it if it isn’t listed.`
  - both lines: `Send either a listed in-game line or a typed one, not both.`
  - typed line: `The in-game line must be 2–40 characters: letters, numbers, spaces, apostrophes, hyphens, full stops or curly quotes.`
  - rarity: `Rarity must be common, uncommon or rare, or left as not sure.`
  - pair: `Pick both who you gave it to and how they reacted, or neither.`
  - approval decision: `decision must be "approve" or "reject"`

- [ ] **Step 1: Write the failing tests**

Create `test/item-rules.test.mjs`:

```js
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
  for (const bad of ['a', 'x'.repeat(41), '<b>hi</b>', 'semi;colon', 'emoji 🙂', 'tab\u0000null', '', null, undefined, 42]) {
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

test('every committed category id and in-game line fits the rules a new category must meet', async () => {
  const { categories } = await loadDataset('data');
  for (const category of categories) {
    assert.ok(ID_PATTERN.test(category.id), `${category.id}: id`);
    assert.ok(isValidText(category.inGameDescriptor), `${category.id}: inGameDescriptor`);
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/item-rules.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `assets/js/item-rules.js`.

- [ ] **Step 3: Implement `assets/js/item-rules.js`**

```js
import { REACTIONS } from './confidence.js';

// The rules for missing-item reports, in one place. The report form, the
// Worker (which imports this file by relative path -- wrangler bundles it),
// the review page and the nightly sync all use them, so a name the form
// accepts is a name every later step accepts too. Pure: no DOM, no network.

// Free text is new to this project. It is confined to short fields with a
// deliberately small character set: letters, digits, spaces and the
// punctuation real item names use (apostrophes straight and curly, hyphens,
// full stops, curly double quotes).
export const TEXT_PATTERN = /^[A-Za-z0-9 '\-’“”.]{2,40}$/;

// The same shape the data files use for every id.
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const RARITIES = ['common', 'uncommon', 'rare'];

const TEXT_RULE = '2–40 characters: letters, numbers, spaces, apostrophes, hyphens, full stops or curly quotes';
const NAME_ERROR = `The item name must be ${TEXT_RULE}.`;
const LINE_ERROR = `The in-game line must be ${TEXT_RULE}.`;
const NO_LINE_ERROR = 'Pick the in-game “Primarily enjoyed by …” line, or type it if it isn’t listed.';
const BOTH_LINES_ERROR = 'Send either a listed in-game line or a typed one, not both.';
const RARITY_ERROR = 'Rarity must be common, uncommon or rare, or left as not sure.';
const PAIR_ERROR = 'Pick both who you gave it to and how they reacted, or neither.';
const DECISION_ERROR = 'decision must be "approve" or "reject"';

// null and undefined both mean "not sent". Anything else was sent and must be
// valid -- an empty string included.
const present = (value) => value !== null && value !== undefined;
const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

export function cleanText(value) {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\s+/g, ' ');
}

export function isValidText(value) {
  return TEXT_PATTERN.test(cleanText(value) ?? '');
}

// For duplicate detection and grouping only, never for display: every
// spelling of one item -- "Horse-Grooming Kit", "horse grooming kit" --
// becomes the same key.
export function normalizeName(s) {
  return String(s ?? '').toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9]/g, '');
}

// New gift and category ids. Matches every slug already in gifts.json, which
// a real-data test pins.
export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['’“”"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The review page's pre-fill: the project capitalises every word. It is only
// a suggestion, because exact in-game names are the exception the maintainer
// keeps ("History of a Master").
export function suggestName(s) {
  return (cleanText(s) ?? '').replace(
    /(^|[ -])([“"']?)([a-z])/g,
    (match, separator, quote, letter) => `${separator}${quote}${letter.toUpperCase()}`,
  );
}

export function findListedGift(gifts, name) {
  const key = normalizeName(name);
  if (key === '') return null;
  return (Array.isArray(gifts) ? gifts : []).find((gift) => normalizeName(gift.name) === key) ?? null;
}

// A name must also contain at least one letter or digit: "''" passes the
// character set but would group with nothing and slugify to an empty id.
function checkName(value, errors) {
  const name = cleanText(value);
  if (!isValidText(name) || normalizeName(name) === '') errors.push(NAME_ERROR);
  return name;
}

function checkRarity(body, errors) {
  const rarity = present(body?.rarity) ? body.rarity : null;
  if (rarity !== null && !RARITIES.includes(rarity)) errors.push(RARITY_ERROR);
  return rarity;
}

// What the Worker accepts from a player. Exactly one of `category` (a listed
// id) and `categoryLine` (the typed in-game line). The result is optional, but
// it takes both halves or neither.
export function validateItemReport(body) {
  const errors = [];
  const name = checkName(body?.name, errors);

  let category = null;
  let categoryLine = null;
  const hasCategory = present(body?.category);
  const hasLine = present(body?.categoryLine);
  if (hasCategory && hasLine) errors.push(BOTH_LINES_ERROR);
  else if (!hasCategory && !hasLine) errors.push(NO_LINE_ERROR);
  else if (hasCategory) {
    if (isId(body.category)) category = body.category;
    else errors.push('category must be a gift-guide id');
  } else {
    categoryLine = cleanText(body.categoryLine);
    if (!isValidText(categoryLine)) errors.push(LINE_ERROR);
  }

  const rarity = checkRarity(body, errors);

  const hasCharacter = present(body?.character);
  const hasReaction = present(body?.reaction);
  if (hasCharacter !== hasReaction) errors.push(PAIR_ERROR);
  else if (hasCharacter) {
    if (!isId(body.character)) errors.push('character must be a gift-guide id');
    if (!REACTIONS.includes(body.reaction)) errors.push(`reaction must be one of: ${REACTIONS.join(', ')}`);
  }

  if (errors.length) return { errors, value: null };
  return {
    errors,
    value: {
      name, category, categoryLine, rarity,
      character: hasCharacter ? body.character : null,
      reaction: hasReaction ? body.reaction : null,
    },
  };
}

// What the review page sends for one report. An approval names at most one of
// an existing gift, a listed category or a new category -- and may name none,
// when nobody knows the category yet.
export function validateItemApproval(body) {
  if (body?.decision === 'reject') return { errors: [], value: { decision: 'reject' } };
  if (body?.decision !== 'approve') return { errors: [DECISION_ERROR], value: null };

  const errors = [];
  const name = checkName(body.name, errors);

  const targets = ['giftId', 'category', 'newCategory'].filter((key) => present(body[key]));
  if (targets.length > 1) errors.push('send at most one of giftId, category and newCategory');

  const giftId = present(body.giftId) ? body.giftId : null;
  if (giftId !== null && !isId(giftId)) errors.push('giftId must be a gift-guide id');

  const category = present(body.category) ? body.category : null;
  if (category !== null && !isId(category)) errors.push('category must be a gift-guide id');

  let newCategory = null;
  if (present(body.newCategory)) {
    const proposed = body.newCategory;
    if (typeof proposed !== 'object' || Array.isArray(proposed)) {
      errors.push('newCategory must be an object with id, label and inGameDescriptor');
    } else {
      newCategory = {
        id: proposed.id,
        label: cleanText(proposed.label),
        inGameDescriptor: cleanText(proposed.inGameDescriptor),
      };
      if (!isId(newCategory.id)) errors.push('newCategory.id must be a gift-guide id');
      if (!isValidText(newCategory.label)) errors.push(`newCategory.label must be ${TEXT_RULE}`);
      if (!isValidText(newCategory.inGameDescriptor)) errors.push(`newCategory.inGameDescriptor must be ${TEXT_RULE}`);
    }
  }

  const rarity = checkRarity(body, errors);

  if (typeof body.includeResult !== 'boolean') errors.push('includeResult must be true or false');

  if (errors.length) return { errors, value: null };
  return {
    errors,
    value: { decision: 'approve', name, giftId, category, newCategory, rarity, includeResult: body.includeResult },
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/item-rules.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Run the full suite and the validator**

Run: `npm test && npm run validate`
Expected: every test passes (350 + the new ones), then `data valid`.

- [ ] **Step 6: Mutation check**

Apply each mutation on its own, run `node --test test/item-rules.test.mjs`, and confirm at least one test goes red. Revert before the next one.
1. In `validateItemReport`, change `if (hasCharacter !== hasReaction)` to `if (false)` (this drops both-or-neither).
2. In `validateItemReport`, change `else if (!hasCategory && !hasLine) errors.push(NO_LINE_ERROR);` to `else if (false) {}` (this allows neither category nor line).
3. In `slugify`, delete the `.replace(/['’“”"]/g, '')` line. The real-data slug test should fail on `traders-handbook`.
4. In `checkName`, delete `|| normalizeName(name) === ''`.
5. In `validateItemApproval`, change `targets.length > 1` to `targets.length > 2`.
6. In `TEXT_PATTERN`, add `<>` to the character class.

Then run `git status --porcelain`. Expected: only `?? assets/js/item-rules.js` and `?? test/item-rules.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add assets/js/item-rules.js test/item-rules.test.mjs
git commit -m "Add the shared rules for missing-item reports"
```

---

### Task 2: Worker, D1 table and routes

**Files:**
- Modify: `worker/schema.sql` (append)
- Create: `worker/src/item-reports.js`
- Modify: `worker/src/router.js` (imports at lines 1-6; new handlers after `postIngest` at ~186; `ROUTES` at 190-197)
- Modify: `worker/README.md`
- Create: `test/worker-items.test.mjs`
- Modify: `test/worker-admin.test.mjs:17`

**Interfaces:**
- Consumes: `validateItemReport`, `validateItemApproval` from `../../assets/js/item-rules.js` (Task 1). The router already has `guard`, `readJson`, `refuseUnlessAdmin`, `exact`, `oneParam`, `ADMIN_HEADERS` and `json`.
- Produces: the four routes and the `worker/src/item-reports.js` exports, as listed under "Shared interfaces". Row shapes:
  - `GET /item-review` → `{ reports: [{ id, name, category, category_line, rarity, character, reaction, status, created_at }] }`, pending only, oldest first, at most 200. `approved` is never selected.
  - `POST /ingest-items` → `{ items: [{ id, approved, character, reaction, created_at }] }`. `approved` is the parsed object `{ name, giftId, category, newCategory, rarity, includeResult }`, or `null` if the stored JSON cannot be parsed.

**Worker-import question (settled during planning).** The Worker imports `../../assets/js/item-rules.js` directly, so there is no copy of the rules. Evidence: `worker/wrangler.toml` sets no `no_bundle`, `rules` or `find_additional_modules`. A probe with wrangler 4.137.0 used a scratch copy of this layout: `worker/src/index.js` importing `../../assets/js/item-rules.js`, which imports `./confidence.js`. Running `npx --yes wrangler deploy --dry-run --outdir … --config worker/wrangler.toml` bundled both files, and the outdir `index.js` contained `normalizeName` and `REACTIONS`. The plan's own Task 1-2 code was also applied to a scratch copy of the repo and dry-run with the real `worker/wrangler.toml`. That bundled cleanly, with the D1 binding listed, and the output contains `normalizeName` and `item_reports`. Step 9 re-checks this on the real tree. **If Step 9 fails**, switch to the fallback:
1. Copy `assets/js/item-rules.js` to `worker/src/item-rules.js`, and change its import to `import { REACTIONS } from './reports.js';`.
2. Point the router's import at `./item-rules.js`.
3. Add this test to `test/worker-items.test.mjs`. It checks that the two copies are identical apart from that one import line:
   ```js
   import { readFileSync } from 'node:fs';
   test('the Worker copy of the rules matches the site copy apart from its import', () => {
     const strip = (text) => text.replace(/^import \{ REACTIONS \} from '[^']+';\n/m, '');
     const site = readFileSync(new URL('../assets/js/item-rules.js', import.meta.url), 'utf8');
     const worker = readFileSync(new URL('../worker/src/item-rules.js', import.meta.url), 'utf8');
     assert.equal(strip(worker), strip(site));
   });
   ```

- [ ] **Step 1: Write the failing tests**

Create `test/worker-items.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/src/router.js';
import { insertItemReport, listItemReviews, decideItemReport, takeApprovedItems } from '../worker/src/item-reports.js';
import { listPending } from '../worker/src/reports.js';
import { fakeD1 } from '../worker/test-support/fake-d1.mjs';

const ORIGIN = 'https://mackoz.github.io';
const TOKEN = 'a-long-random-admin-token';
const NOW = '2026-09-23T12:00:00.000Z';

const env = (db) => ({ ALLOWED_ORIGINS: ORIGIN, TURNSTILE_SECRET: 'secret', ADMIN_TOKEN: TOKEN, DB: db });

function deps({ verified = true } = {}) {
  const verifications = [];
  return {
    verifications,
    fetch: async (url, init) => {
      verifications.push({ url, init });
      return new Response(JSON.stringify({ success: verified }), { status: 200 });
    },
    now: () => NOW,
    uuid: () => 'item-uuid',
  };
}

// Admin routes must never call out; a call would throw and surface as a 500.
const adminDeps = { fetch: async () => { throw new Error('admin routes must not call out'); }, now: () => NOW, uuid: () => 'item-uuid' };

const post = (path, body) => new Request(`https://api.test${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify(body),
});

const authed = (method, path, body) => new Request(`https://api.test${path}`, {
  method,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const REPORT = {
  name: '  Lantern   Oil ', category: 'horses', categoryLine: null, rarity: 'uncommon',
  character: 'alexandra', reaction: 'loved', turnstileToken: 'tok',
};

// --- POST /item-report ---

test('a verified item report is stored as pending with exactly these values', async () => {
  const db = fakeD1();
  const res = await handle(post('/item-report', REPORT), env(db), deps());
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO item_reports/);
  assert.match(db.calls[0].sql, /'pending'/);
  assert.deepEqual(db.calls[0].params, ['item-uuid', 'Lantern Oil', 'horses', null, 'uncommon', 'alexandra', 'loved', NOW]);
});

test('the response carries the id and status and never echoes the text', async () => {
  const res = await handle(post('/item-report', REPORT), env(fakeD1()), deps());
  const body = await res.text();
  assert.deepEqual(JSON.parse(body), { id: 'item-uuid', status: 'pending' });
  assert.doesNotMatch(body, /Lantern/i);
});

test('a typed line is stored in category_line with a null category', async () => {
  const db = fakeD1();
  await handle(post('/item-report', { ...REPORT, category: null, categoryLine: 'lovers of  lanterns' }), env(db), deps());
  assert.deepEqual(db.calls[0].params.slice(2, 4), [null, 'lovers of lanterns']);
});

test('an item report with no result stores nulls for both halves', async () => {
  const db = fakeD1();
  await handle(post('/item-report', { ...REPORT, character: null, reaction: null, rarity: null }), env(db), deps());
  assert.deepEqual(db.calls[0].params.slice(4, 7), [null, null, null]);
});

test('Turnstile is checked before the item payload, so an invalid body cannot probe the store', async () => {
  const db = fakeD1();
  const res = await handle(post('/item-report', { turnstileToken: 'tok' }), env(db), deps({ verified: false }));
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0);
});

test('the item report verification carries no IP address', async () => {
  const d = deps();
  await handle(post('/item-report', REPORT), env(fakeD1()), d);
  const sent = [...d.verifications[0].init.body].map(([key]) => key).sort();
  assert.deepEqual(sent, ['response', 'secret']);
});

for (const [label, patch, pattern] of [
  ['a bad name', { name: '<b>x</b>' }, /item name/i],
  ['both a category and a typed line', { categoryLine: 'lamp lovers' }, /not both/i],
  ['neither a category nor a typed line', { category: null }, /in-game/i],
  ['a bad category id', { category: 'Horses' }, /category must be a gift-guide id/],
  ['a bad typed line', { category: null, categoryLine: 'x' }, /in-game line/i],
  ['an unknown rarity', { rarity: 'epic' }, /rarity/i],
  ['a character without a reaction', { reaction: null }, /or neither/i],
  ['a reaction without a character', { character: null }, /or neither/i],
  ['a reaction outside the five tiers', { reaction: 'amazing' }, /reaction must be one of/],
]) {
  test(`a verified item report with ${label} is a 400 that stores nothing`, async () => {
    const db = fakeD1();
    const res = await handle(post('/item-report', { ...REPORT, ...patch }), env(db), deps());
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, pattern);
    assert.equal(db.calls.length, 0);
  });
}

test('an oversized item report is refused before it is parsed', async () => {
  const db = fakeD1();
  const res = await handle(post('/item-report', { ...REPORT, padding: 'x'.repeat(9000) }), env(db), deps());
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
});

// --- The public feed is untouched ---

test('listPending never reads item_reports', async () => {
  const db = fakeD1([{ results: [] }]);
  await listPending(db);
  assert.doesNotMatch(db.calls[0].sql, /item_reports/);
});

test('GET /pending issues exactly one statement, against reports only', async () => {
  const db = fakeD1([{ results: [] }]);
  await handle(new Request('https://api.test/pending', { headers: { Origin: ORIGIN } }), env(db), deps());
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM reports/);
  assert.doesNotMatch(db.calls[0].sql, /item_reports/);
});

// --- Store ---

test('insertItemReport binds every column in order', async () => {
  const db = fakeD1();
  await insertItemReport(db, { id: 'i1', name: 'Lantern Oil', category: null, categoryLine: 'lamp lovers', rarity: null, character: null, reaction: null, createdAt: NOW });
  assert.deepEqual(db.calls[0].params, ['i1', 'Lantern Oil', null, 'lamp lovers', null, null, null, NOW]);
});

test('listItemReviews selects pending rows oldest first and never the approved column', async () => {
  const db = fakeD1([{ results: [{ id: 'i1' }] }]);
  assert.deepEqual(await listItemReviews(db), [{ id: 'i1' }]);
  const { sql, params } = db.calls[0];
  assert.match(sql, /FROM item_reports/);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /ORDER BY created_at ASC/);
  assert.doesNotMatch(sql, /approved/);
  assert.deepEqual(params, [200]);
});

test('listItemReviews survives a driver that returns no results array', async () => {
  assert.deepEqual(await listItemReviews(fakeD1([{}])), []);
});

const APPROVE = { decision: 'approve', name: 'Lantern Oil', giftId: null, category: 'horses', newCategory: null, rarity: 'uncommon', includeResult: true };

test('approving stores the approved values, without the decision, on a pending row only', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  assert.equal(await decideItemReport(db, 'i1', APPROVE), true);
  const { sql, params } = db.calls[0];
  assert.match(sql, /SET status = 'approved', approved = \?/);
  assert.match(sql, /AND status = 'pending'/);
  const { decision, ...stored } = APPROVE;
  assert.deepEqual(JSON.parse(params[0]), stored);
  assert.equal(params[1], 'i1');
});

test('rejecting moves a pending row and stores nothing else', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  assert.equal(await decideItemReport(db, 'i1', { decision: 'reject' }), true);
  assert.match(db.calls[0].sql, /SET status = 'rejected'/);
  assert.match(db.calls[0].sql, /AND status = 'pending'/);
  assert.doesNotMatch(db.calls[0].sql, /approved =/);
  assert.deepEqual(db.calls[0].params, ['i1']);
});

test('deciding a row that is no longer pending reports false', async () => {
  assert.equal(await decideItemReport(fakeD1([{ meta: { changes: 0 } }]), 'i1', { decision: 'reject' }), false);
});

test('decideItemReport refuses a decision it does not know', async () => {
  await assert.rejects(() => decideItemReport(fakeD1(), 'i1', { decision: 'maybe' }), /unknown item decision/);
});

test('takeApprovedItems parses the approval and marks every row ingested', async () => {
  const rows = [
    { id: 'a', approved: JSON.stringify({ name: 'Lantern Oil' }), character: null, reaction: null, created_at: NOW },
    { id: 'b', approved: '{not json', character: 'alexandra', reaction: 'loved', created_at: NOW },
  ];
  const db = fakeD1([{ results: rows }, { meta: { changes: 2 } }]);
  const items = await takeApprovedItems(db);
  assert.deepEqual(items.map((item) => item.approved), [{ name: 'Lantern Oil' }, null]);
  assert.match(db.calls[0].sql, /status = 'approved'/);
  assert.deepEqual(db.calls[0].params, [200]);
  assert.match(db.calls[1].sql, /UPDATE item_reports SET status = 'ingested' WHERE id IN \(\?, \?\)/);
  assert.deepEqual(db.calls[1].params, ['a', 'b']);
});

test('takeApprovedItems issues no update when there is nothing to take', async () => {
  const db = fakeD1([{ results: [] }]);
  assert.deepEqual(await takeApprovedItems(db), []);
  assert.equal(db.calls.length, 1);
});

// --- Admin routes ---

test('the item review queue comes back uncached and without calling out', async () => {
  const rows = [{ id: 'i1', name: 'Lantern Oil', category: 'horses', category_line: null, rarity: null, character: null, reaction: null, status: 'pending', created_at: NOW }];
  const res = await handle(authed('GET', '/item-review'), env(fakeD1([{ results: rows }])), adminDeps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reports: rows });
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('approving an item report echoes the new status', async () => {
  const db = fakeD1([{ meta: { changes: 1 } }]);
  const res = await handle(authed('POST', '/item-review/i1', APPROVE), env(db), adminDeps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: 'i1', status: 'approved' });
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('rejecting an item report echoes rejected', async () => {
  const res = await handle(authed('POST', '/item-review/i1', { decision: 'reject' }), env(fakeD1([{ meta: { changes: 1 } }])), adminDeps);
  assert.deepEqual(await res.json(), { id: 'i1', status: 'rejected' });
});

test('deciding an item report twice is a 404', async () => {
  const res = await handle(authed('POST', '/item-review/i1', { decision: 'reject' }), env(fakeD1([{ meta: { changes: 0 } }])), adminDeps);
  assert.equal(res.status, 404);
});

test('an invalid approval is a 400 that touches nothing', async () => {
  for (const body of [
    { ...APPROVE, giftId: 'horse-grooming-kit' },
    { ...APPROVE, includeResult: 'yes' },
    { decision: 'maybe' },
    { decision: '__proto__' },
    null,
  ]) {
    const db = fakeD1();
    const res = await handle(authed('POST', '/item-review/i1', body ?? undefined), env(db), adminDeps);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(db.calls.length, 0, JSON.stringify(body));
  }
});

test('a slash-smuggling item id never reaches the store', async () => {
  const db = fakeD1();
  const res = await handle(authed('POST', '/item-review/a%2Fb', { decision: 'reject' }), env(db), adminDeps);
  assert.notEqual(res.status, 200);
  assert.equal(db.calls.length, 0);
});

test('ingest-items hands over the approved rows and marks them, uncached', async () => {
  const db = fakeD1([{ results: [{ id: 'a', approved: '{"name":"Lantern Oil"}', character: null, reaction: null, created_at: NOW }] }, { meta: { changes: 1 } }]);
  const res = await handle(authed('POST', '/ingest-items'), env(db), adminDeps);
  assert.deepEqual(await res.json(), { items: [{ id: 'a', approved: { name: 'Lantern Oil' }, character: null, reaction: null, created_at: NOW }] });
  assert.match(db.calls[1].sql, /SET status = 'ingested'/);
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('the item admin routes refuse a missing or wrong token', async () => {
  for (const [method, path] of [['GET', '/item-review'], ['POST', '/item-review/i1'], ['POST', '/ingest-items']]) {
    const bare = await handle(new Request(`https://api.test${path}`, { method }), env(fakeD1()), adminDeps);
    assert.equal(bare.status, 401, `${method} ${path} without a token`);
    const wrong = new Request(`https://api.test${path}`, { method, headers: { Authorization: `Bearer ${'b'.repeat(TOKEN.length)}` } });
    assert.equal((await handle(wrong, env(fakeD1()), adminDeps)).status, 401, `${method} ${path} with a wrong token`);
  }
});
```

Also, in `test/worker-admin.test.mjs`, replace line 17:

```js
  for (const [method, path] of [['GET', '/review'], ['POST', '/review/r1'], ['POST', '/ingest']]) {
```

with:

```js
  for (const [method, path] of [
    ['GET', '/review'], ['POST', '/review/r1'], ['POST', '/ingest'],
    ['GET', '/item-review'], ['POST', '/item-review/i1'], ['POST', '/ingest-items'],
  ]) {
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/worker-items.test.mjs test/worker-admin.test.mjs`
Expected: `worker-items` fails with `ERR_MODULE_NOT_FOUND` for `worker/src/item-reports.js`. In `worker-admin`, "every admin route refuses a missing token" fails because `GET /item-review` returns 404, not 401.

- [ ] **Step 3: Append the table to `worker/schema.sql`**

Append, after the existing `reports_status_idx` line:

```sql

-- Missing-item reports: a separate queue with its own lifecycle, so nothing
-- here can reach GET /pending, the votes or the public overlay. Free text lives
-- only in `name` and `category_line`, both at most 40 characters of a small
-- character set (assets/js/item-rules.js), and none of it is public before the
-- maintainer approves it. `approved` holds the maintainer's edited values as
-- JSON; the nightly sync writes those, never the raw text.
--
-- The same rule as `reports`: no vote columns, no identifying columns.
CREATE TABLE IF NOT EXISTS item_reports (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  category_line TEXT,
  rarity        TEXT,
  "character"   TEXT,
  reaction      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|ingested
  approved      TEXT,                            -- JSON: the values the maintainer approved
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS item_reports_status_idx ON item_reports (status);
```

- [ ] **Step 4: Create `worker/src/item-reports.js`**

```js
// The missing-item queue. Deliberately a separate module and a separate table
// from reports.js: nothing here is reachable from GET /pending, and nothing in
// reports.js reads item_reports. A test pins both halves.

export async function insertItemReport(db, { id, name, category, categoryLine, rarity, character, reaction, createdAt }) {
  await db.prepare(
    `INSERT INTO item_reports (id, name, category, category_line, rarity, "character", reaction, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).bind(id, name, category, categoryLine, rarity, character, reaction, createdAt).run();
}

// The maintainer's view. Every column except `approved`, which a pending row
// never has anyway.
export async function listItemReviews(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, name, category, category_line, rarity, "character" AS character,
            reaction, status, created_at
       FROM item_reports
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(limit).all();
  return results ?? [];
}

// `AND status = 'pending'` makes every decision idempotent, as setStatus does
// for results: a second click changes nothing and reports false. `value` has
// already passed validateItemApproval; the decision itself is not stored.
export async function decideItemReport(db, id, value) {
  if (value?.decision === 'reject') {
    const { meta } = await db.prepare(
      `UPDATE item_reports SET status = 'rejected' WHERE id = ? AND status = 'pending'`,
    ).bind(id).run();
    return (meta?.changes ?? 0) > 0;
  }
  if (value?.decision === 'approve') {
    const { decision, ...approved } = value;
    const { meta } = await db.prepare(
      `UPDATE item_reports SET status = 'approved', approved = ? WHERE id = ? AND status = 'pending'`,
    ).bind(JSON.stringify(approved), id).run();
    return (meta?.changes ?? 0) > 0;
  }
  throw new Error(`unknown item decision: ${value?.decision}`);
}

// A row whose JSON will not parse is still handed over (as null) and still
// marked ingested. If it were left `approved`, it would come back and fail
// every night. The sync logs it and sets it aside instead.
function parseApproved(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The same trade as takeApproved: the rows are marked ingested in the same
// call, so scripts/ingest.mjs logs them before it does anything that can fail.
export async function takeApprovedItems(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, approved, "character" AS character, reaction, created_at
       FROM item_reports
      WHERE status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(limit).all();

  const rows = results ?? [];
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(', ');
  await db.prepare(
    `UPDATE item_reports SET status = 'ingested' WHERE id IN (${placeholders})`,
  ).bind(...rows.map((row) => row.id)).run();

  return rows.map((row) => ({ ...row, approved: parseApproved(row.approved) }));
}
```

- [ ] **Step 5: Wire the routes in `worker/src/router.js`**

Add these imports after the existing `reports.js` import (lines 3-6):

```js
import {
  insertItemReport, listItemReviews, decideItemReport, takeApprovedItems,
} from './item-reports.js';
// Imported from the site's own module so the form, the Worker, the review page
// and the sync can never disagree about a rule. Wrangler bundles it; see
// worker/README.md.
import { validateItemReport, validateItemApproval } from '../../assets/js/item-rules.js';
```

Add these handlers directly after `postIngest` (after line 186):

```js
async function postItemReport(request, env, deps) {
  const { error, body, cors } = await guard(request, env, deps);
  if (error) return error;

  const { errors, value } = validateItemReport(body);
  if (errors.length) return json({ error: errors[0], errors }, 400, cors);

  const id = deps.uuid();
  await insertItemReport(env.DB, { id, ...value, createdAt: deps.now() });
  // Never echoes the name or the typed line back.
  return json({ id, status: 'pending' }, 201, cors);
}

async function getItemReview(request, env) {
  const refusal = refuseUnlessAdmin(request, env);
  if (refusal) return refusal;
  const reports = await listItemReviews(env.DB);
  return json({ reports }, 200, { ...corsHeaders(request, env), ...ADMIN_HEADERS });
}

async function postItemDecision(request, env, deps, params) {
  const refusal = refuseUnlessAdmin(request, env);
  if (refusal) return refusal;

  const cors = { ...corsHeaders(request, env), ...ADMIN_HEADERS };
  const { tooLarge, body } = await readJson(request);
  if (tooLarge) return json({ error: 'that request is too large' }, 413, cors);

  const { errors, value } = validateItemApproval(body);
  if (errors.length) return json({ error: errors[0], errors }, 400, cors);

  const changed = await decideItemReport(env.DB, params.id, value);
  if (!changed) return json({ error: 'no pending item report with that id' }, 404, cors);
  return json({ id: params.id, status: value.decision === 'approve' ? 'approved' : 'rejected' }, 200, cors);
}

async function postIngestItems(request, env) {
  const refusal = refuseUnlessAdmin(request, env);
  if (refusal) return refusal;
  const items = await takeApprovedItems(env.DB);
  return json({ items }, 200, { ...corsHeaders(request, env), ...ADMIN_HEADERS });
}
```

Replace the `ROUTES` comment and table (lines 188-197) with:

```js
// `handle` takes the table as an argument so tests can drive the router with a
// stub table of their own. The item routes are separate paths on purpose:
// `/review/items` would be captured by `/review/:id`, and a new field on
// `/ingest` would be marked ingested and dropped by a sync script that
// predates it.
export const ROUTES = [
  { method: 'POST', match: exact('/report'), handler: postReport },
  { method: 'POST', match: exact('/vote'), handler: postVote },
  { method: 'GET', match: exact('/pending'), handler: getPending },
  { method: 'GET', match: exact('/review'), handler: getReview },
  { method: 'POST', match: oneParam('/review', 'id'), handler: postDecision },
  { method: 'POST', match: exact('/ingest'), handler: postIngest },
  { method: 'POST', match: exact('/item-report'), handler: postItemReport },
  { method: 'GET', match: exact('/item-review'), handler: getItemReview },
  { method: 'POST', match: oneParam('/item-review', 'id'), handler: postItemDecision },
  { method: 'POST', match: exact('/ingest-items'), handler: postIngestItems },
];
```

- [ ] **Step 6: Run the Worker tests and confirm they pass**

Run: `node --test test/worker-items.test.mjs test/worker-admin.test.mjs test/worker-public.test.mjs test/worker-reports.test.mjs test/worker-http.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 7: Update `worker/README.md`**

Replace the "What it stores" section (lines 7-12) with:

```markdown
## What it stores

Two tables (see `schema.sql`):

- `reports` holds result reports: the report content, a status, two vote
  counters and a timestamp.
- `item_reports` holds missing-item reports: the item name, either a listed
  category id or the typed in-game line, a rarity, an optional character and
  reaction, a status, the maintainer's approved values (JSON) and a timestamp.
  It has no vote columns. Nothing in it is public before approval.

Neither table holds a name, email address, IP address, hashed IP, session id
or any other identifier, and Turnstile is called without `remoteip`. Adding an
identifying column is a design change, not a fix.
```

Replace the endpoints table and the paragraph under it (lines 16-26) with:

```markdown
| Route | Access | Purpose |
|---|---|---|
| `POST /report` | Turnstile | Insert a pending result report. |
| `POST /vote` | Turnstile | Increment one counter on a pending row. |
| `GET /pending` | Public | Pending result reports for the site overlay, **without vote counts**. |
| `GET /review` | Admin token | Pending rows **with** vote counts, best score first. |
| `POST /review/:id` | Admin token | `{"decision":"approve"}` or `{"decision":"reject"}`. |
| `POST /ingest` | Admin token | Return approved rows and mark them ingested. |
| `POST /item-report` | Turnstile | Insert a pending missing-item report. Never echoes its text. |
| `GET /item-review` | Admin token | Pending missing-item reports, oldest first. |
| `POST /item-review/:id` | Admin token | `{"decision":"reject"}` or `{"decision":"approve", name, giftId?, category?, newCategory?, rarity, includeResult}`. |
| `POST /ingest-items` | Admin token | Return approved missing-item reports and mark them ingested. |

Vote counts are never selected by `GET /pending`, and `GET /pending` never reads
`item_reports`. Both are enforced in the SQL in `src/reports.js` rather than in
the UI, and tests assert them. Do not add either.

The item rules (text pattern, ids, rarity, both-or-neither) live in
`assets/js/item-rules.js`, which the Worker imports by relative path. Wrangler
bundles it into the deployed script, so the site and the Worker cannot drift
apart.
```

Add this section directly before "## Reviewing":

````markdown
## Adding missing-item reports to an existing deployment

This change is additive and backward-compatible, but the order matters. From
the pull request's branch, **before merging**:

1. Create the new table. `schema.sql` only uses `CREATE … IF NOT EXISTS`, so
   re-running it leaves `reports` and its rows untouched:

   ```sh
   npx --yes wrangler d1 execute fefw-gifts --remote --file worker/schema.sql --config worker/wrangler.toml
   ```

2. Deploy the Worker:

   ```sh
   npm run worker:deploy
   ```

Then merge. If you merge first, the site shows the missing-item form while
the Worker returns 404 for `/item-report`. The nightly sync is not affected
either way: it treats a 404 from `/ingest-items` as a warning.

No Cloudflare dashboard change is needed. The Turnstile widget already covers
`mackoz.github.io`, and no secret changes.
````

In "The ingest trade-off" section, add this paragraph at the end:

```markdown
`POST /ingest-items` makes the same trade for missing-item reports, and the
sync script logs that batch too (`console.log(JSON.stringify(items, null, 2))`)
before anything can fail.
```

- [ ] **Step 8: Run the full suite and the validator**

Run: `npm test && npm run validate`
Expected: all pass; `data valid`.

- [ ] **Step 9: Verify that wrangler bundles the cross-directory import**

Run:

```bash
rm -rf /tmp/fefw-worker-dryrun
npx --yes wrangler deploy --dry-run --outdir /tmp/fefw-worker-dryrun --config worker/wrangler.toml
grep -c "normalizeName" /tmp/fefw-worker-dryrun/index.js
grep -c "item_reports" /tmp/fefw-worker-dryrun/index.js
rm -rf /tmp/fefw-worker-dryrun
```

Expected: wrangler prints `--dry-run: exiting now.` and does not upload anything. Both `grep -c` counts are ≥ 1. If the dry run fails to resolve `../../assets/js/item-rules.js`, apply the fallback described under **Interfaces** above, re-run Steps 6 and 8, then re-run this step.

- [ ] **Step 10: Mutation check**

Apply each mutation on its own, run `node --test test/worker-items.test.mjs test/worker-admin.test.mjs`, and confirm at least one test goes red. Revert before the next one.
1. In `listPending` (`worker/src/reports.js`), change `FROM reports` to `FROM reports LEFT JOIN item_reports ON 0`. The "never reads item_reports" tests should go red.
2. At the top of `postItemReport`, before the `guard(...)` call, insert `const early = validateItemReport((await readJson(request.clone())).body); if (early.errors.length) return json({ error: early.errors[0] }, 400, corsHeaders(request, env));`. The "Turnstile is checked before the item payload" test should go red, because it now gets a 400 where it expects a 403.
3. In `decideItemReport`, delete `AND status = 'pending'` from the approve statement.
4. In `listItemReviews`, change the select list to `SELECT *`.
5. Remove `refuseUnlessAdmin` from `postIngestItems`.
6. In `takeApprovedItems`, delete the `UPDATE … 'ingested'` statement.

Then run `git status --porcelain`. Expected: only this task's files are listed (`worker/schema.sql`, `worker/src/item-reports.js`, `worker/src/router.js`, `worker/README.md`, `test/worker-items.test.mjs`, `test/worker-admin.test.mjs`).

- [ ] **Step 11: Commit**

```bash
git add worker/schema.sql worker/src/item-reports.js worker/src/router.js worker/README.md test/worker-items.test.mjs test/worker-admin.test.mjs
git commit -m "Add the missing-item queue, its routes and its deployment notes to the Worker"
```

---
### Task 3: API client methods

**Files:**
- Modify: `assets/js/api.js:67-74`
- Test: `test/api.test.mjs` (append)

**Interfaces:**
- Consumes: the private `call(path, { method, body, admin })` already inside `createApi`, and the routes from Task 2.
- Produces, on the object `createApi()` returns:
  - `submitItemReport(payload)` → `POST /item-report`, no token.
  - `fetchItemReview()` → `GET /item-review`, admin.
  - `decideItem(id, body)` → `POST /item-review/${encodeURIComponent(id)}` with `body` sent exactly as given, admin.
  All three resolve to `{ ok, status, data, error }` and never reject. A disabled client (no base URL) answers every one with `ok: false` and the "not set up" error.

- [ ] **Step 1: Write the failing tests**

Append to `test/api.test.mjs`:

```js
test('the missing-item calls are answered by a disabled client too', async () => {
  const api = createApi({ baseUrl: null });
  for (const result of [
    await api.submitItemReport({}),
    await api.fetchItemReview(),
    await api.decideItem('i1', { decision: 'reject' }),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.error, /not set up/i);
  }
});

test('submitItemReport posts the payload to /item-report without the admin token', async () => {
  const fetchImpl = stubFetch(() => new Response(JSON.stringify({ id: 'i1', status: 'pending' }), { status: 201 }));
  const api = createApi({ baseUrl: 'https://api.test', token: 'sekrit', fetchImpl });
  const payload = {
    name: 'Lantern Oil', category: 'horses', categoryLine: null, rarity: null,
    character: null, reaction: null, turnstileToken: 't',
  };
  const result = await api.submitItemReport(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { id: 'i1', status: 'pending' });
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.test/item-report');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.Authorization, undefined, 'a player call must never carry the admin token');
  assert.deepEqual(JSON.parse(init.body), payload);
});

test('the item review calls carry the token, encode the id and send the body as given', async () => {
  const fetchImpl = stubFetch(() => ok({ reports: [] }));
  const api = createApi({ baseUrl: 'https://api.test', token: 'sekrit', fetchImpl });
  const body = { decision: 'approve', name: 'Lantern Oil', category: 'horses', rarity: null, includeResult: true };

  await api.fetchItemReview();
  await api.decideItem('a/b', body);

  assert.equal(fetchImpl.calls[0].url, 'https://api.test/item-review');
  assert.equal(fetchImpl.calls[0].init.method, 'GET');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer sekrit');

  assert.equal(fetchImpl.calls[1].url, 'https://api.test/item-review/a%2Fb');
  assert.equal(fetchImpl.calls[1].init.method, 'POST');
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, 'Bearer sekrit');
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), body);
});

test('a refused item report shows the Worker message as-is', async () => {
  const fetchImpl = stubFetch(() => new Response(JSON.stringify({ error: 'Pick both who you gave it to and how they reacted, or neither.' }), { status: 400 }));
  const result = await createApi({ baseUrl: 'https://api.test', fetchImpl }).submitItemReport({});
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /or neither/);
});

test('an unreachable Worker on an item report reads as a service problem', async () => {
  const fetchImpl = stubFetch(() => { throw new Error('offline'); });
  const result = await createApi({ baseUrl: 'https://api.test', fetchImpl }).submitItemReport({});
  assert.equal(result.ok, false);
  assert.match(result.error, /could not reach/i);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/api.test.mjs`
Expected: the new tests FAIL with `TypeError: api.submitItemReport is not a function`, and the equivalents for the other two methods.

- [ ] **Step 3: Implement**

In `assets/js/api.js`, replace lines 67-74 (from `submitReport:` through the end of `decide`) with:

```js
    submitReport: (report) => call('/report', { method: 'POST', body: report }),
    sendVote: (vote) => call('/vote', { method: 'POST', body: vote }),
    // A missing-item report. It never appears on the site until approved, so
    // there is nothing to fetch back for the overlay.
    submitItemReport: (report) => call('/item-report', { method: 'POST', body: report }),

    // Admin. Used only by the review page; harmless here without a token.
    fetchReview: () => call('/review', { admin: true }),
    decide: (id, decision) => call(`/review/${encodeURIComponent(id)}`, {
      method: 'POST', body: { decision }, admin: true,
    }),
    fetchItemReview: () => call('/item-review', { admin: true }),
    // `body` is the whole decision ({ decision: 'reject' } or an approval),
    // sent as given: the Worker validates it with the shared item rules.
    decideItem: (id, body) => call(`/item-review/${encodeURIComponent(id)}`, {
      method: 'POST', body, admin: true,
    }),
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/api.test.mjs`
Expected: PASS.

- [ ] **Step 5: Full suite and validator**

Run: `npm test && npm run validate`
Expected: all pass; `data valid`.

- [ ] **Step 6: Mutation check**

Apply each mutation on its own, run `node --test test/api.test.mjs`, and confirm at least one test goes red. Revert before the next one.
1. Add `admin: true` to `submitItemReport`'s options.
2. Remove `admin: true` from `fetchItemReview`.
3. In `decideItem`, replace `encodeURIComponent(id)` with `id`.
4. In `decideItem`, send `body: { decision: body.decision }` instead of `body`.

Then run `git status --porcelain`. Expected: only `assets/js/api.js` and `test/api.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add assets/js/api.js test/api.test.mjs
git commit -m "Add the missing-item calls to the API client"
```

---

### Task 4: The player's form and the Gifts-tab entry point

**Files:**
- Modify: `index.html:103-111` (report dialog fields)
- Modify: `assets/js/report-form.js` (whole file; the full replacement is below)
- Modify: `assets/js/app.js` (state ~35-42, search listener ~102-105, `createReportForm` elements ~136-155, delegated listener ~160-163)
- Modify: `assets/js/views/gift.js` (new export, `renderPicker` ~42-47)
- Modify: `assets/css/style.css` (`#report-reactions` ~488, `.dialog-status` ~507, `.dialog-actions button, .report-button` ~521)
- Test: `test/report-form.test.mjs`, `test/views.test.mjs`, `test/assets.test.mjs`

**Interfaces:**
- Consumes: `cleanText`, `findListedGift`, `validateItemReport` (Task 1); `api.submitItemReport` (Task 3); `reportCharacterOptions` (already in `report-form.js`).
- Produces:
  - `report-form.js`: `MISSING_ITEM = '__missing-item__'`, `NOT_LISTED = '__not-listed__'`, `ITEM_SUCCESS = 'Thanks — it’ll appear on the site once it’s reviewed.'`, `categoryLineOptions(categories)`, `buildItemReportPayload(fields, { gifts })`, and `createReportForm(...)` returning `{ open(characterId, giftId), openMissingItem(name) }`.
  - `createReportForm` needs these extra `elements`: `characterField`, `reactionsLegend`, `itemFields`, `itemName`, `itemDuplicate`, `itemCategory`, `itemLineField`, `itemLine`, `itemRarity`, `itemCharacter`.
  - `views/gift.js`: `missingItemButton(query)` returns `<button type="button" class="missing-item-button" data-name="…">`. The view reads `state.searchText`, which is the search as typed. The existing `state.search` is lower-cased and is only used for matching.

**Design decisions settled here (the spec leaves them open):**
- There is one dialog with two modes. In missing-item mode the top Character field (`#report-character-field`) is hidden. The item block has its own optional "Gave it to" select (`#report-item-character`), so the item facts come before the optional result. The reactions fieldset is shared, and its legend reads "They… (optional)" in this mode.
- A radio button cannot be unticked, so missing-item mode adds a sixth choice, "I haven’t given it to anyone yet" (`value=""`). Without it, a player who ticked a reaction by mistake could never get back to "neither".
- After a successful item report the dialog stays open and shows `ITEM_SUCCESS`, because nothing public changes. It is cleared but left in missing-item mode. `onSubmitted` (the overlay refresh) is not called.
- The status line keeps `.dialog-status`. `data-tone="success"` colours it with `--confirmed` instead of `--warning`.

- [ ] **Step 1: Write the failing form tests**

In `test/report-form.test.mjs`:

(a) Replace the import line (line 3) with:

```js
import {
  buildReportPayload, REACTION_PROMPTS, reportCharacterOptions, createReportForm,
  buildItemReportPayload, categoryLineOptions, MISSING_ITEM, NOT_LISTED, ITEM_SUCCESS,
} from '../assets/js/report-form.js';
```

(b) Replace `stubElement` and `stubSelect` (lines 78-100) with:

```js
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
```

(c) In the existing test `createReportForm keeps the character dropdown in sync…`, replace `const status = { textContent: '' };` with `const status = { textContent: '', dataset: {} };`, and replace the `index` and `createReportForm` blocks with:

```js
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
```

(d) Append these new tests after that test, before the `// --- Turnstile wrapper ---` comment:

```js
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
```

- [ ] **Step 2: Run the form tests and confirm they fail**

Run: `node --test test/report-form.test.mjs`
Expected: FAIL. The import of `buildItemReportPayload` is not exported (`SyntaxError: The requested module … does not provide an export named 'buildItemReportPayload'`).

- [ ] **Step 3: Replace `assets/js/report-form.js`**

Replace the whole file with the following. `REACTION_PROMPTS`, `buildReportPayload` and `reportCharacterOptions` behave exactly as before.

```js
import { REACTIONS } from './confidence.js';
import { cleanText, findListedGift, validateItemReport } from './item-rules.js';

// The player-facing wording for each tier, in the game's own terms. The values
// are the five tiers from confidence.js; a test keeps the two in step.
export const REACTION_PROMPTS = [
  { value: 'none', label: 'They didn’t like it — no support gained' },
  { value: 'slight', label: 'They kind of liked it — small gain' },
  { value: 'liked', label: 'They liked it — moderate gain' },
  { value: 'loved', label: 'They really liked it — big gain' },
  { value: 'favorite', label: 'They really liked it, with two yellow arrows — double points' },
];

// Option values that can never collide with a data id: ID_PATTERN has no "_".
export const MISSING_ITEM = '__missing-item__';
export const NOT_LISTED = '__not-listed__';

export const ITEM_SUCCESS = 'Thanks — it’ll appear on the site once it’s reviewed.';

const HUMAN_CHECK = 'Complete the “I’m human” check first.';

// Pure. Mirrors the Worker's own validation so a contributor is told what is
// wrong before a request is spent -- the Worker still re-checks everything,
// because a browser check is a courtesy, not a control.
export function buildReportPayload({ character, gift, reaction, turnstileToken } = {}) {
  const errors = [];
  if (!character) errors.push('Pick which character received the gift.');
  if (!gift) errors.push('Pick which gift you gave.');
  if (!REACTIONS.includes(reaction)) errors.push('Pick what the game showed you.');

  if (!turnstileToken) errors.push(HUMAN_CHECK);

  if (errors.length) return { errors, payload: null };
  return {
    errors,
    payload: {
      character, gift, reaction,
      turnstileToken,
    },
  };
}

// Pure. Same rule as every view: a spoiler character is left out while
// spoilers are hidden, and a non-giftable character never appears regardless.
// Defaults to hiding spoilers (fail closed).
export function reportCharacterOptions(characters, { hideSpoilers = true } = {}) {
  return characters.filter((c) => c.giftable && !(hideSpoilers && c.spoiler));
}

// Pure. The in-game line select: our categories by the words the game shows
// (the label when we have none), sorted, then the way out for a line we do
// not have yet.
export function categoryLineOptions(categories) {
  const listed = (Array.isArray(categories) ? categories : [])
    .map((category) => ({ value: category.id, label: category.inGameDescriptor || category.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  return [...listed, { value: NOT_LISTED, label: 'Not listed — type it' }];
}

// Pure. The missing-item twin of buildReportPayload. The rules are
// item-rules.js's, so the form refuses exactly what the Worker would. An item
// that is already listed is the first thing the player hears about; `listed`
// comes back so the caller can link to it.
export function buildItemReportPayload({
  name, category, categoryLine, rarity, character, reaction, turnstileToken,
} = {}, { gifts = [] } = {}) {
  const body = {
    name: cleanText(name) ?? '',
    category: category && category !== NOT_LISTED ? category : null,
    categoryLine: category === NOT_LISTED ? (cleanText(categoryLine) ?? '') : null,
    rarity: rarity || null,
    character: character || null,
    reaction: reaction || null,
  };

  const listed = findListedGift(gifts, body.name);
  const errors = listed ? [`That’s already listed as ${listed.name}.`] : [];
  errors.push(...validateItemReport(body).errors);
  if (!turnstileToken) errors.push(HUMAN_CHECK);

  if (errors.length) return { errors, payload: null, listed };
  return { errors, payload: { ...body, turnstileToken }, listed };
}

function option(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

function fillOptions(select, options, placeholder) {
  select.replaceChildren();
  select.append(option('', placeholder));
  for (const { value, label } of options) select.append(option(value, label));
}

function fillSelect(select, items, placeholder) {
  fillOptions(select, items.map((item) => ({ value: item.id, label: item.name })), placeholder);
}

// Returns the "not given" choice, which only missing-item mode shows: there
// the result is optional, and a radio cannot be unticked, so without it a
// player who picked a reaction by mistake could never get back to "neither".
// It is a <div> so that `hidden` works -- .reaction-choice sets a display.
function fillReactions(fieldset) {
  for (const prompt of REACTION_PROMPTS) {
    const label = document.createElement('label');
    label.className = 'reaction-choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'reaction';
    input.value = prompt.value;
    label.append(input, document.createTextNode(` ${prompt.label}`));
    fieldset.append(label);
  }

  const notGiven = document.createElement('div');
  notGiven.hidden = true;
  const label = document.createElement('label');
  label.className = 'reaction-choice';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'reaction';
  input.value = '';
  label.append(input, document.createTextNode(' I haven’t given it to anyone yet'));
  notGiven.append(label);
  fieldset.append(notGiven);
  return notGiven;
}

// Wires the dialog. `elements` is every node the form needs, passed in rather
// than looked up, so this module keeps no top-level DOM access.
//
// One dialog, two modes. The gift select's last option switches it into
// missing-item mode; `openMissingItem` opens it there directly.
export function createReportForm({
  elements, index, api, turnstile, onSubmitted = () => {},
  getFilters = () => ({ hideSpoilers: true }),
}) {
  const {
    dialog, form, character, characterField, gift, reactions, reactionsLegend, status, cancel, submit,
    itemFields, itemName, itemDuplicate, itemCategory, itemLineField, itemLine, itemRarity, itemCharacter,
  } = elements;

  const characterOptions = () => reportCharacterOptions(index.characters, { hideSpoilers: getFilters().hideSpoilers });

  fillSelect(character, characterOptions(), 'Choose a character…');
  fillSelect(gift, index.gifts, 'Choose a gift…');
  // Last, so every listed gift is in front of it.
  gift.append(option(MISSING_ITEM, 'My item isn’t listed…'));
  fillOptions(itemCategory, categoryLineOptions(index.categories), 'Choose the line the game shows…');
  const notGiven = fillReactions(reactions);

  const missingMode = () => gift.value === MISSING_ITEM;
  const checkedValue = (group, name) => group.querySelector(`input[name="${name}"]:checked`)?.value ?? '';

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  // Only wrappers are hidden, never a label: `dialog label` sets a display,
  // which beats the hidden attribute.
  function syncMode() {
    const missing = missingMode();
    itemFields.hidden = !missing;
    characterField.hidden = missing;
    notGiven.hidden = !missing;
    itemLineField.hidden = !(missing && itemCategory.value === NOT_LISTED);
    reactionsLegend.textContent = missing ? 'They… (optional)' : 'What did the game show?';
  }

  // Live, so a player learns the item is already listed before filling in the
  // rest, and gets a link to it.
  function syncDuplicate() {
    const listed = missingMode() ? findListedGift(index.gifts, itemName.value) : null;
    itemDuplicate.hidden = !listed;
    if (!listed) {
      itemDuplicate.replaceChildren();
      return;
    }
    const link = document.createElement('a');
    link.href = `#/gift/${listed.id}`;
    link.textContent = listed.name;
    link.addEventListener('click', () => dialog.close());
    itemDuplicate.replaceChildren(document.createTextNode('That’s already listed as '), link, document.createTextNode('.'));
  }

  gift.addEventListener('change', () => {
    syncMode();
    syncDuplicate();
  });
  itemCategory.addEventListener('change', syncMode);
  itemName.addEventListener('input', syncDuplicate);
  cancel.addEventListener('click', () => dialog.close());

  async function send(payload, submitCall) {
    submit.disabled = true;
    setStatus('Sending…');
    const result = await submitCall(payload);
    submit.disabled = false;

    // A spent token cannot be reused whether the request succeeded or failed,
    // so the widget is reset either way.
    turnstile.reset();

    if (!result.ok) setStatus(result.error);
    return result.ok;
  }

  async function submitResult() {
    const { errors, payload } = buildReportPayload({
      character: character.value,
      gift: gift.value,
      reaction: checkedValue(reactions, 'reaction'),
      turnstileToken: turnstile.token(),
    });
    if (errors.length) {
      setStatus(errors[0]);
      return;
    }
    if (!(await send(payload, (p) => api.submitReport(p)))) return;

    setStatus('');
    dialog.close();
    form.reset();
    onSubmitted();
  }

  async function submitItem() {
    const { errors, payload } = buildItemReportPayload({
      name: itemName.value,
      category: itemCategory.value,
      categoryLine: itemLine.value,
      rarity: checkedValue(itemRarity, 'rarity'),
      character: itemCharacter.value,
      reaction: checkedValue(reactions, 'reaction'),
      turnstileToken: turnstile.token(),
    }, { gifts: index.gifts });
    if (errors.length) {
      setStatus(errors[0]);
      return;
    }
    if (!(await send(payload, (p) => api.submitItemReport(p)))) return;

    // Nothing public changes -- an item report is hidden until approved -- so
    // the dialog stays open to say it arrived, and onSubmitted (the overlay
    // refresh) is not called. It is cleared but stays in missing-item mode
    // for a player with several finds.
    form.reset();
    gift.value = MISSING_ITEM;
    syncMode();
    syncDuplicate();
    setStatus(ITEM_SUCCESS, 'success');
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    return missingMode() ? submitItem() : submitResult();
  });

  // Rebuilt on every open rather than once at creation, since the filter
  // toggle is a runtime control (app.js) and both character selects must
  // reflect its current value, not the value at page load. Reset first, then
  // pre-fill: this covers Cancel, Escape and any other close path at once --
  // otherwise a cancelled report's answers survive into the next one.
  function prepare() {
    fillSelect(character, characterOptions(), 'Choose a character…');
    fillSelect(itemCharacter, characterOptions(), 'Not given to anyone yet');
    form.reset();
    setStatus('');
  }

  async function show() {
    syncMode();
    syncDuplicate();
    dialog.showModal();
    try {
      await turnstile.mount();
    } catch {
      setStatus('The “I’m human” check could not load. Try again in a moment.');
    }
  }

  return {
    async open(characterId = '', giftId = '') {
      prepare();
      character.value = characterId;
      gift.value = giftId;
      await show();
    },

    async openMissingItem(name = '') {
      prepare();
      gift.value = MISSING_ITEM;
      itemName.value = cleanText(name) ?? '';
      await show();
    },
  };
}
```

- [ ] **Step 4: Run the form tests and confirm they pass**

Run: `node --test test/report-form.test.mjs`
Expected: PASS, including the unchanged spoiler test and the Turnstile tests.

- [ ] **Step 5: Write the failing view and markup tests**

In `test/views.test.mjs`, change line 7 to:

```js
import { giftRows, giftIndexModel, missingItemButton } from '../assets/js/views/gift.js';
```

and append at the end of the file:

```js
// The Gifts tab's second entry point into a missing-item report. Like the
// report controls above, it must not exist with submissions off.
test('a search that matches no gift offers to report it, but only with submissions on', () => {
  const idx = buildIndex(dataset);
  const base = { filters: DEFAULT_FILTERS, search: 'lantern oil', searchText: 'Lantern Oil', storage: undefined };

  const on = fakeElement('div');
  giftView.render(on, idx, { ...base, submissionsEnabled: true });
  const buttons = collect(on, (n) => (n.className ?? '').includes('missing-item-button'));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].tagName, 'BUTTON');
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].dataset.name, 'Lantern Oil', 'carries the query as typed, not lower-cased');
  assert.equal(buttons[0].textContent, 'Report ‘Lantern Oil’ as a missing item');

  const off = fakeElement('div');
  giftView.render(off, idx, { ...base, submissionsEnabled: false });
  assert.equal(collect(off, (n) => n.tagName === 'BUTTON').length, 0, 'no button with submissions off');
});

test('a search that finds a gift, or no search at all, offers no missing-item report', () => {
  const idx = buildIndex(dataset);
  for (const search of ['bre', '']) {
    const container = fakeElement('div');
    giftView.render(container, idx, { filters: DEFAULT_FILTERS, search, searchText: search, submissionsEnabled: true, storage: undefined });
    assert.equal(collect(container, (n) => (n.className ?? '').includes('missing-item-button')).length, 0, JSON.stringify(search));
  }
});

test('the missing-item button falls back to the matching text when no typed text is given', () => {
  const idx = buildIndex(dataset);
  const container = fakeElement('div');
  giftView.render(container, idx, { filters: DEFAULT_FILTERS, search: 'zz', submissionsEnabled: true, storage: undefined });
  assert.equal(collect(container, (n) => (n.className ?? '').includes('missing-item-button'))[0].dataset.name, 'zz');
});

test('missingItemButton carries its query where app.js reads it', () => {
  const button = missingItemButton('Lantern Oil');
  assert.equal(button.className, 'missing-item-button');
  assert.equal(button.dataset.name, 'Lantern Oil');
});
```

Append to `test/assets.test.mjs`:

```js
const MISSING_ITEM_IDS = [
  'report-character-field', 'report-reactions-legend', 'report-item-fields', 'report-item-name',
  'report-item-duplicate', 'report-item-category', 'report-item-line-field', 'report-item-line',
  'report-rarity', 'report-item-character',
];

test('the report dialog ships the missing-item fields, hidden until chosen', () => {
  const html = read('../index.html');
  const dialog = html.slice(html.indexOf('<dialog id="report-dialog"'), html.indexOf('</dialog>'));
  for (const id of MISSING_ITEM_IDS) assert.match(dialog, new RegExp(`id="${id}"`), `missing #${id}`);
  // `hidden` only works on a wrapper no rule gives a display.
  assert.match(dialog, /<div id="report-item-fields" hidden>/, 'the item block must start hidden, on a div');
  assert.match(dialog, /<div id="report-item-line-field" hidden>/, 'the typed line must start hidden, on a div');
  assert.match(dialog, /name="rarity" value="" checked/, '"Not sure" must be the default rarity');
  assert.match(dialog, /Only the site maintainer sees this until it’s approved\./);
  assert.match(dialog, /id="report-item-name"[^>]*maxlength="40"/);
  assert.match(dialog, /id="report-item-line"[^>]*maxlength="40"/);
});

// app.js has no behavioural test, so this pins the wiring report-form.js
// cannot see from inside: every element is passed in, and the Gifts-tab
// button reaches openMissingItem with the name it carries.
test('app.js hands the missing-item elements to the form and wires the Gifts-tab button', () => {
  const app = sourceOf('app.js');
  for (const id of MISSING_ITEM_IDS) {
    assert.match(app, new RegExp(`getElementById\\('${id}'\\)`), `app.js never looks up #${id}`);
  }
  assert.match(app, /closest\('\.missing-item-button'\)/, 'the delegated listener must find the Gifts-tab button');
  assert.match(app, /openMissingItem\(\w+\.dataset\.name\)/, 'and open the dialog with its name');
  assert.match(app, /state\.searchText = e\.target\.value\.trim\(\)/, 'the typed search must reach the view');
});
```

- [ ] **Step 6: Run them and confirm they fail**

Run: `node --test test/views.test.mjs test/assets.test.mjs`
Expected: FAIL. The `views` file fails to load because `missingItemButton` is not exported. The two new `assets` tests fail on the missing ids.

- [ ] **Step 7: Add the entry point to `assets/js/views/gift.js`**

After `giftIndexModel` (after line 36), add:

```js
// The Gifts tab's way into a missing-item report. Like reportButton, it does
// nothing itself: app.js's delegated listener reads `dataset.name` and opens
// the report dialog in missing-item mode with the name pre-filled.
export function missingItemButton(query) {
  const button = el('button', 'missing-item-button', `Report ‘${query}’ as a missing item`);
  button.type = 'button';
  button.dataset.name = query;
  return button;
}
```

In `renderPicker`, replace the `if (groups.length === 0) { … }` block (lines 42-47) with:

```js
  if (groups.length === 0) {
    container.append(emptyState(state.search
      ? `No gift’s name matches “${state.search}”.`
      : 'No gifts have been recorded yet.'));
    // Only with the Worker configured: with submissions off there is nowhere
    // to send a report, and the page must look as it did before. The typed
    // text is offered, not the lower-cased copy used for matching.
    if (state.search && state.submissionsEnabled) {
      container.append(missingItemButton(state.searchText || state.search));
    }
    return;
  }
```

- [ ] **Step 8: Update `index.html`**

Replace lines 103-111 (from `<label for="report-character">` through the closing `</fieldset>` of `#report-reactions`) with:

```html
      <div id="report-character-field">
        <label for="report-character">Character</label>
        <select id="report-character" required></select>
      </div>

      <label for="report-gift">Gift</label>
      <select id="report-gift" required></select>

      <div id="report-item-fields" hidden>
        <p class="dialog-intro">
          Only the site maintainer sees this until it’s approved.
        </p>

        <label for="report-item-name">Item name, exactly as the game shows it</label>
        <input type="text" id="report-item-name" maxlength="40" autocomplete="off">
        <p id="report-item-duplicate" class="dialog-status" hidden></p>

        <label for="report-item-category">Its “Primarily enjoyed by …” line</label>
        <select id="report-item-category"></select>

        <div id="report-item-line-field" hidden>
          <label for="report-item-line">Type the rest of the line</label>
          <input type="text" id="report-item-line" maxlength="40" autocomplete="off">
        </div>

        <fieldset id="report-rarity">
          <legend>Rarity</legend>
          <label class="reaction-choice"><input type="radio" name="rarity" value="common"> Common</label>
          <label class="reaction-choice"><input type="radio" name="rarity" value="uncommon"> Uncommon</label>
          <label class="reaction-choice"><input type="radio" name="rarity" value="rare"> Rare</label>
          <label class="reaction-choice"><input type="radio" name="rarity" value="" checked> Not sure</label>
        </fieldset>

        <label for="report-item-character">Gave it to (optional)</label>
        <select id="report-item-character"></select>
      </div>

      <fieldset id="report-reactions">
        <legend id="report-reactions-legend">What did the game show?</legend>
      </fieldset>
```

- [ ] **Step 9: Wire `assets/js/app.js`**

(a) In `state` (lines 35-42), add `searchText: '',` directly after `search: '',`.

(b) Replace the search listener (lines 102-105) with:

```js
  document.getElementById('search').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    // As typed, for the missing-item pre-fill. The lower-cased copy above is
    // for matching only.
    state.searchText = e.target.value.trim();
    render();
  }, 120));
```

(c) In the `createReportForm({ elements: { … } })` call, add these entries after `submit: document.getElementById('report-submit'),`:

```js
      characterField: document.getElementById('report-character-field'),
      reactionsLegend: document.getElementById('report-reactions-legend'),
      itemFields: document.getElementById('report-item-fields'),
      itemName: document.getElementById('report-item-name'),
      itemDuplicate: document.getElementById('report-item-duplicate'),
      itemCategory: document.getElementById('report-item-category'),
      itemLineField: document.getElementById('report-item-line-field'),
      itemLine: document.getElementById('report-item-line'),
      itemRarity: document.getElementById('report-rarity'),
      itemCharacter: document.getElementById('report-item-character'),
```

(d) Replace the delegated report listener (lines 159-163) with:

```js
  // One listener for every per-row button, so a re-render costs nothing.
  container.addEventListener('click', (event) => {
    const button = event.target.closest('.report-button');
    if (button) reportForm.open(button.dataset.character, button.dataset.gift);
    // The Gifts tab's "Report ‘…’ as a missing item" (views/gift.js).
    const missing = event.target.closest('.missing-item-button');
    if (missing) reportForm.openMissingItem(missing.dataset.name);
  });
```

- [ ] **Step 10: Style it in `assets/css/style.css`, using existing tokens only**

(a) Replace the selector line `#report-reactions {` with:

```css
#report-reactions,
#report-rarity {
```

(b) Directly after the `.dialog-status { … }` rule, add:

```css
/* A missing-item report changes nothing public, so its confirmation is the
   only feedback the player gets. It should not look like an error. */
.dialog-status[data-tone="success"] {
  color: var(--confirmed);
}
```

(c) Replace the selector lines `.dialog-actions button,` / `.report-button {` with:

```css
.dialog-actions button,
.report-button,
.missing-item-button {
```

and add this rule directly after `.report-button:hover { … }`:

```css
/* The Gifts tab's "Report ‘…’ as a missing item", under the empty search. */
.missing-item-button {
  margin-top: 12px;
}

.missing-item-button:hover {
  border-color: var(--ink);
}
```

- [ ] **Step 11: Run the tests and confirm they pass**

Run: `node --test test/report-form.test.mjs test/views.test.mjs test/assets.test.mjs`
Expected: PASS.

- [ ] **Step 12: Full suite and validator**

Run: `npm test && npm run validate`
Expected: all pass; `data valid`.

- [ ] **Step 13: Browser check (without submitting to the live Worker)**

`assets/js/config.js` points at the live Worker, so the form is enabled locally. The Worker's `ALLOWED_ORIGINS` does not include `127.0.0.1`, and the Turnstile widget does not cover that hostname either. Even so, **never press Submit on a fully valid form**. Pressing Submit on a form that fails client validation is fine, because `buildItemReportPayload` stops it before any request is made.

1. Start the server in the background: `python3 /tmp/fefw-serve.py` (it serves `http://127.0.0.1:8139/`).
2. Open `http://127.0.0.1:8139/?cb=1#/gift`. The cache-buster goes before the hash.
3. Type `lantern oil` in the search box. Expected: "No gift’s name matches “lantern oil”." with a **Report ‘lantern oil’ as a missing item** button under it.
4. Click it. Expected: the dialog opens with the top Character field hidden, the gift select on "My item isn’t listed…", the name pre-filled `lantern oil`, "Only the site maintainer sees this until it’s approved.", rarity on "Not sure", and the reactions legend "They… (optional)" with "I haven’t given it to anyone yet" as the last choice.
5. Change the name to `horse grooming kit`. Expected: "That’s already listed as Horse-Grooming Kit." appears, with a link. Click the link. Expected: the dialog closes and the gift page opens.
6. Reopen the dialog from the tab bar's **Report a result**. Expected: result mode, with Character visible and no item fields. Choose "My item isn’t listed…". Expected: it switches mode. Choose "Not listed — type it". Expected: the typed-line input appears.
7. Choose a "Gave it to" character, leave the reaction empty, and press Submit. Expected: "Pick both who you gave it to and how they reacted, or neither." and no network request (check DevTools → Network).
8. Check the layout at widths 320, 390 and 1280. Expected: no horizontal page scroll, the dialog fits, and the inputs span the dialog width.
9. Toggle **Hide spoilers** off, reopen in missing-item mode, and confirm Bertrand appears in "Gave it to". Toggle it back on, and confirm he is gone.
10. With submissions off: temporarily set `export const WORKER_URL = null;` in `assets/js/config.js`, reload with `?cb=2#/gift`, and search `lantern oil`. Expected: the empty message and **no** button, and the tab bar shows "Report a result on GitHub". Then revert with `git checkout -- assets/js/config.js` and confirm `git diff --quiet -- assets/js/config.js` exits 0.
11. Stop the server.

- [ ] **Step 14: Mutation check**

Apply each mutation on its own, run `node --test test/report-form.test.mjs test/views.test.mjs test/assets.test.mjs`, and confirm at least one test goes red. Revert before the next one.
1. In `views/gift.js`, drop `&& state.submissionsEnabled` from the entry-point condition.
2. In `buildItemReportPayload`, replace `const errors = listed ? [...] : [];` with `const errors = [];` (this lets a duplicate through).
3. In `syncMode`, change `itemFields.hidden = !missing;` to `itemFields.hidden = false;`.
4. In `prepare`, fill `itemCharacter` from `index.characters` instead of `characterOptions()` (this leaks spoilers).
5. In `submitItem`, call `onSubmitted()` after the success message.
6. In `app.js`, delete the two `missing` lines from the delegated listener.

Then run `git status --porcelain`. Expected: only `index.html`, `assets/js/report-form.js`, `assets/js/app.js`, `assets/js/views/gift.js`, `assets/css/style.css`, `test/report-form.test.mjs`, `test/views.test.mjs` and `test/assets.test.mjs`.

- [ ] **Step 15: Commit**

```bash
git add index.html assets/js/report-form.js assets/js/app.js assets/js/views/gift.js assets/css/style.css test/report-form.test.mjs test/views.test.mjs test/assets.test.mjs
git commit -m "Let players report a missing item from the report dialog and the Gifts tab"
```

---
### Task 5: The review page's "Missing items" section

**Files:**
- Modify: `review/index.html` (new `<section>` after `#review-list`, and three new elements passed to `mountReview`)
- Modify: `assets/js/review.js` (whole file; the full replacement is below)
- Modify: `assets/css/style.css` (a new block directly after `.review-reject { … }`)
- Test: `test/review.test.mjs`, `test/assets.test.mjs`

**Interfaces:**
- Consumes: `cleanText`, `normalizeName`, `slugify`, `suggestName`, `findListedGift`, `validateItemApproval` (Task 1); `api.fetchItemReview()` and `api.decideItem(id, body)` (Task 3); the `GET /item-review` row shape (Task 2): `{ id, name, category, category_line, rarity, character, reaction, status, created_at }`.
- Produces (in `assets/js/review.js`):
  - `NEW_CATEGORY = '__new__'`
  - `groupItemReports(rows)` → `[{ key, reports }]`. `key` is `normalizeName(name)`. Each group's reports are sorted oldest first, and the group whose oldest report is oldest comes first.
  - `itemCardDefaults(group, categories)` → `{ name, category, newCategory, rarity }`:
    - `name` is `suggestName` of the most frequent cleaned spelling. Ties go to the earliest.
    - `category` is set only when every report on the card has the same listed id that exists in `categories`. Otherwise it is `null`.
    - `newCategory` is `{ id: slugify(line), label: suggestName(line), inGameDescriptor: line }` when every report typed a line, using the most frequent cleaned line. Otherwise it is `null`.
    - `rarity` is the most frequent non-null value, else `null`.
  - `categoryIdClash(categories, id)` → boolean.
  - `itemApprovalBody({ name, category, newCategory, rarity }, { gifts, categories })` → `{ errors, body | null, listed | null }`. `category` is the select value: `''`, a listed id, or `NEW_CATEGORY`. When the name matches a listed gift, the body carries `giftId` and no category. The body always has `includeResult: false`; the caller sets it per report.
  - `itemReportSummary(row, categories, now)` → one line: `“name” · line: … | typed line: “…” · rarity | rarity not sure · gave to X: reaction | no result · age`.
  - `mountReview({ elements, storage, createClient, now, loadSiteData })`. `elements` gains `itemCount`, `itemStatus` and `itemList`. `loadSiteData()` → `Promise<{ gifts, categories }>`, and defaults to fetching `../data/gifts.json` and `../data/categories.json`.
- Card controls carry stable class hooks, which the tests use: `item-card`, `review-pair`, `item-name`, `item-listed`, `item-category`, `item-new-category` (div), `item-new-label`, `item-new-id`, `item-new-line`, `item-rarity`, `item-include-box`, `item-approve`, `item-reject-card`, `item-reject`, `item-status`.

**Behaviour settled here:**
- The heading count is the number of **cards** (distinct items), not reports. The status line gives both.
- **Approve** sends one `decideItem` per report on the card, in order. A 404 means that report was already decided (by an earlier, partly failed attempt at this card, or in another tab), so the loop carries on. Any other failure stops the loop and shows the error on the card. After a full run the section reloads.
- A report with no result has no checkbox, and its approval always carries `includeResult: false`.

- [ ] **Step 1: Write the failing tests**

In `test/review.test.mjs`:

(a) Replace the import line (line 3) with:

```js
import {
  reviewRowModel, humanAge, TOKEN_KEY, mountReview,
  groupItemReports, itemCardDefaults, categoryIdClash, itemApprovalBody, itemReportSummary, NEW_CATEGORY,
} from '../assets/js/review.js';
```

(b) Replace `fakeElements` (lines 49-64) with the following. It adds `fakeNode` and the three item elements.

```js
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
```

(c) Append:

```js
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
```

Append to `test/assets.test.mjs`:

```js
test('the review page ships the missing-items section and hands it to mountReview', () => {
  const html = read('../review/index.html');
  for (const id of ['item-review-count', 'item-review-status', 'item-review-list']) {
    assert.match(html, new RegExp(`id="${id}"`), `review page is missing #${id}`);
    assert.match(html, new RegExp(`getElementById\\('${id}'\\)`), `mountReview is never given #${id}`);
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/review.test.mjs test/assets.test.mjs`
Expected: FAIL. `review.test.mjs` fails to load (`does not provide an export named 'groupItemReports'`), and the new `assets` test fails on the missing ids.

- [ ] **Step 3: Replace `assets/js/review.js`**

Everything above `// --- Missing items ---` is the current file unchanged. Only `mountReview` changes.

```js
import { createApi } from './api.js';
import { el } from './views/shared.js';
import {
  cleanText, normalizeName, slugify, suggestName, findListedGift, validateItemApproval,
} from './item-rules.js';

export const TOKEN_KEY = 'fefw-gifts-admin-token';

// The category select's "Create new category…". Not a valid id, so it can
// never be mistaken for one.
export const NEW_CATEGORY = '__new__';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function humanAge(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < MINUTE) return 'just now';
  if (milliseconds < HOUR) return plural(Math.floor(milliseconds / MINUTE), 'minute');
  if (milliseconds < DAY) return plural(Math.floor(milliseconds / HOUR), 'hour');
  return plural(Math.floor(milliseconds / DAY), 'day');
}

function ageOf(createdAt, now) {
  const created = Date.parse(createdAt);
  return Number.isNaN(created) ? 'unknown age' : humanAge(now - created);
}

export function reviewRowModel(row, now = Date.now()) {
  const upvotes = Number(row.upvotes ?? 0);
  const downvotes = Number(row.downvotes ?? 0);
  return {
    id: row.id,
    pair: `${row.character} · ${row.gift}`,
    reaction: row.reaction,
    score: upvotes - downvotes,
    votes: `${upvotes} up / ${downvotes} down`,
    age: ageOf(row.created_at, now),
  };
}

function readStoredToken(storage) {
  try { return storage?.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

// Best effort. A browser that refuses to persist the token must still allow the
// maintainer to use the page for this session -- see the in-memory `token`.
function persistToken(storage, value) {
  try {
    if (value) storage?.setItem(TOKEN_KEY, value);
    else storage?.removeItem(TOKEN_KEY);
  } catch { /* the session continues without persistence */ }
}

function renderRow(model, onDecide) {
  const item = el('li', 'review-row');
  item.append(el('p', 'review-pair', model.pair));
  item.append(el('p', 'review-meta', [
    model.reaction,
    model.votes,
    model.age,
  ].filter(Boolean).join(' · ')));

  const actions = el('div', 'review-actions');
  for (const [decision, label] of [['approve', 'Approve'], ['reject', 'Reject']]) {
    const button = el('button', `review-${decision}`, label);
    button.type = 'button';
    button.addEventListener('click', () => onDecide(model.id, decision, button));
    actions.append(button);
  }
  item.append(actions);
  return item;
}

// --- Missing items ---
//
// Everything a player typed is rendered with textContent (via el()) or as an
// input's value, never as markup.

// Ties go to the value seen first, which -- rows being oldest first -- is the
// earliest report's.
function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function groupItemReports(rows) {
  const ordered = [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const groups = new Map();
  for (const row of ordered) {
    const key = normalizeName(row?.name);
    if (!groups.has(key)) groups.set(key, { key, reports: [] });
    groups.get(key).reports.push(row);
  }
  // A Map keeps insertion order, and rows went in oldest first, so the group
  // with the oldest report comes first.
  return [...groups.values()];
}

export function itemCardDefaults(group, categories = []) {
  const { reports } = group;
  const known = new Set(categories.map((category) => category.id));

  const ids = reports.map((row) => row.category ?? null);
  const agreed = ids.every((id) => id !== null && id === ids[0]) && known.has(ids[0]) ? ids[0] : null;

  const lines = reports.map((row) => cleanText(row.category_line));
  const typed = lines.every(Boolean) ? mostFrequent(lines) : null;

  return {
    name: suggestName(mostFrequent(reports.map((row) => cleanText(row.name)))),
    category: agreed,
    newCategory: typed ? { id: slugify(typed), label: suggestName(typed), inGameDescriptor: typed } : null,
    rarity: mostFrequent(reports.map((row) => row.rarity ?? null)),
  };
}

export function categoryIdClash(categories, id) {
  return (Array.isArray(categories) ? categories : []).some((category) => category.id === id);
}

// The body for one POST /item-review/:id, minus the per-report includeResult,
// which the caller sets. An already-listed name wins over every category
// control: approving then adds only the results, and the gift, its category
// and its rarity stay as the repository has them.
export function itemApprovalBody({ name, category, newCategory, rarity } = {}, { gifts = [], categories = [] } = {}) {
  const listed = findListedGift(gifts, name);
  const body = { decision: 'approve', name: cleanText(name) ?? '', rarity: rarity || null, includeResult: false };
  const errors = [];

  if (listed) {
    body.giftId = listed.id;
  } else if (category === NEW_CATEGORY) {
    const id = cleanText(newCategory?.id) ?? '';
    if (categoryIdClash(categories, id)) {
      errors.push(`A category with the id “${id}” already exists — pick it from the list instead.`);
    }
    body.newCategory = {
      id,
      label: cleanText(newCategory?.label) ?? '',
      inGameDescriptor: cleanText(newCategory?.inGameDescriptor) ?? '',
    };
  } else if (category) {
    body.category = category;
  }

  errors.push(...validateItemApproval(body).errors);
  if (errors.length) return { errors, body: null, listed };
  return { errors, body, listed };
}

export function itemReportSummary(row, categories = [], now = Date.now()) {
  const listed = categories.find((category) => category.id === row.category);
  let line = 'no line';
  if (row.category) line = `line: ${listed?.inGameDescriptor ?? listed?.label ?? row.category}`;
  else if (row.category_line) line = `typed line: “${row.category_line}”`;
  const result = row.character && row.reaction ? `gave to ${row.character}: ${row.reaction}` : 'no result';
  return [`“${row.name}”`, line, row.rarity ?? 'rarity not sure', result, ageOf(row.created_at, now)].join(' · ');
}

// The site's own lists, relative to review/index.html. Inside a function, so
// the module keeps no top-level network or DOM access.
async function defaultLoadSiteData() {
  const [gifts, categories] = await Promise.all(['gifts', 'categories'].map(async (name) => {
    const response = await fetch(`../data/${name}.json`);
    if (!response.ok) throw new Error(`failed to load ${name}.json: ${response.status}`);
    return response.json();
  }));
  return { gifts, categories };
}

function textInput(className, value) {
  const node = el('input', className);
  node.type = 'text';
  node.value = value;
  return node;
}

function selectInput(className, options, value) {
  const node = el('select', className);
  for (const [optionValue, text] of options) {
    const option = el('option', null, text);
    option.value = optionValue;
    node.append(option);
  }
  node.value = value;
  return node;
}

function field(text, control) {
  const label = el('label', 'item-field', text);
  label.append(control);
  return label;
}

function actionButton(className, text, onClick) {
  const button = el('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function renderItemCard(group, { gifts, categories, now, decideItems }) {
  const defaults = itemCardDefaults(group, categories);
  const count = group.reports.length;
  const card = el('li', 'review-row item-card');
  card.append(el('p', 'review-pair', `${defaults.name} — reported ${count} time${count === 1 ? '' : 's'}`));

  const status = el('p', 'dialog-status item-status');
  const includes = new Map();
  const reportList = el('ul', 'item-reports');
  reportList.setAttribute('role', 'list');
  for (const row of group.reports) {
    const entry = el('li', 'item-report');
    entry.append(el('p', 'review-meta', itemReportSummary(row, categories, now)));
    const actions = el('div', 'review-actions');
    if (row.character && row.reaction) {
      const box = el('input', 'item-include-box');
      box.type = 'checkbox';
      box.checked = true;
      includes.set(row.id, box);
      const label = el('label', 'item-include');
      label.append(box, ' Include result');
      actions.append(label);
    }
    actions.append(actionButton('review-reject item-reject', 'Reject', () => decideItems([[row.id, { decision: 'reject' }]], status)));
    entry.append(actions);
    reportList.append(entry);
  }
  card.append(reportList);

  const name = textInput('item-name', defaults.name);
  const listedNote = el('p', 'review-meta item-listed');
  const sorted = [...categories].sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const category = selectInput('item-category', [
    ['', 'Category unknown'],
    ...sorted.map((c) => [c.id, c.label]),
    [NEW_CATEGORY, 'Create new category…'],
  ], defaults.newCategory ? NEW_CATEGORY : (defaults.category ?? ''));
  const newLabel = textInput('item-new-label', defaults.newCategory?.label ?? '');
  const newId = textInput('item-new-id', defaults.newCategory?.id ?? '');
  const newLine = textInput('item-new-line', defaults.newCategory?.inGameDescriptor ?? '');
  // A bare div, so nothing overrides its `hidden`.
  const newFields = el('div', 'item-new-category');
  newFields.append(field('New category label', newLabel), field('New category id', newId), field('In-game line', newLine));
  const rarity = selectInput('item-rarity', [
    ['', 'Rarity unknown'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'],
  ], defaults.rarity ?? '');

  // The id follows the label until the maintainer types one of their own.
  let idEdited = false;
  newId.addEventListener('input', () => { idEdited = true; });
  newLabel.addEventListener('input', () => {
    if (!idEdited) newId.value = slugify(newLabel.value);
  });

  function sync() {
    const listed = findListedGift(gifts, name.value);
    listedNote.textContent = listed ? `Already listed as ${listed.name} — approving adds only the results.` : '';
    category.disabled = Boolean(listed);
    rarity.disabled = Boolean(listed);
    newFields.hidden = Boolean(listed) || category.value !== NEW_CATEGORY;
  }
  name.addEventListener('input', sync);
  category.addEventListener('change', sync);
  sync();

  card.append(field('Name', name), listedNote, field('Category', category), newFields, field('Rarity', rarity));

  function approve() {
    const { errors, body } = itemApprovalBody({
      name: name.value,
      category: category.value,
      rarity: rarity.value,
      newCategory: { id: newId.value, label: newLabel.value, inGameDescriptor: newLine.value },
    }, { gifts, categories });
    if (errors.length) {
      status.textContent = errors[0];
      return undefined;
    }
    return decideItems(
      group.reports.map((row) => [row.id, { ...body, includeResult: includes.get(row.id)?.checked === true }]),
      status,
    );
  }

  const actions = el('div', 'review-actions');
  actions.append(
    actionButton('review-approve item-approve', 'Approve', approve),
    actionButton('review-reject item-reject-card', 'Reject card', () => decideItems(
      group.reports.map((row) => [row.id, { decision: 'reject' }]),
      status,
    )),
  );
  card.append(actions, status);
  return card;
}

// `createClient` and `loadSiteData` are injected so the page's wiring can be
// exercised without a network; they default to the real API client and the
// site's own data files.
export function mountReview({
  elements, storage, createClient = createApi, now = () => Date.now(), loadSiteData = defaultLoadSiteData,
}) {
  const { tokenForm, tokenInput, forget, status, list, refresh, itemCount, itemStatus, itemList } = elements;
  let api = null;
  // The session's source of truth. Storage only seeds it and mirrors it, so a
  // private window or blocked site data costs persistence, never access.
  let token = readStoredToken(storage);
  // Fetched once per page load: the site's lists only change on a deploy.
  let siteData = null;
  let deciding = false;

  function setStatus(message) {
    status.textContent = message;
  }

  function clearItems(message = '') {
    itemList.replaceChildren();
    itemCount.textContent = '0';
    itemStatus.textContent = message;
  }

  async function load() {
    if (!token) {
      list.replaceChildren();
      clearItems();
      setStatus('Paste your admin token to see the queue.');
      return;
    }

    api = createClient({ token });
    if (!api.enabled) {
      clearItems();
      setStatus('This site is not pointed at a Worker yet — see worker/README.md.');
      return;
    }

    setStatus('Loading…');
    const result = await api.fetchReview();
    if (!result.ok) {
      clearItems();
      // 401 is by far the likeliest failure, and "wrong token" is more useful
      // than the status code.
      setStatus(result.status === 401 ? 'That token was not accepted.' : result.error);
      return;
    }

    const rows = Array.isArray(result.data?.reports) ? result.data.reports : [];
    list.replaceChildren(...rows.map((row) => renderRow(reviewRowModel(row, now()), decide)));
    setStatus(rows.length === 0 ? 'Nothing waiting.' : `${rows.length} report(s) waiting, best score first.`);

    await loadItems();
  }

  async function loadItems() {
    itemStatus.textContent = 'Loading…';
    if (!siteData) {
      try {
        siteData = await loadSiteData();
      } catch {
        clearItems('Could not load the site’s gift and category lists, which the missing-item cards need. Try Refresh.');
        return;
      }
    }

    const result = await api.fetchItemReview();
    if (!result.ok) {
      // A Worker deployed before this feature answers 404 here.
      clearItems(result.status === 404
        ? 'The Worker has no missing-item queue yet — redeploy it (see worker/README.md).'
        : result.error);
      return;
    }

    const rows = Array.isArray(result.data?.reports) ? result.data.reports : [];
    const groups = groupItemReports(rows);
    const context = { ...siteData, now: now(), decideItems };
    itemList.replaceChildren(...groups.map((group) => renderItemCard(group, context)));
    itemCount.textContent = String(groups.length);
    itemStatus.textContent = groups.length === 0
      ? 'No missing items waiting.'
      : `${rows.length} report(s) about ${groups.length} item(s), oldest first.`;
  }

  // One request per report, in order. A 404 means that report was already
  // decided -- by an earlier, partly failed attempt at this same card, or in
  // another tab -- so it is skipped rather than treated as a failure. Anything
  // else stops the run and stays on the card; there is no reload to hide it.
  async function decideItems(pairs, cardStatus) {
    if (deciding) return;
    deciding = true;
    cardStatus.textContent = 'Saving…';
    try {
      for (const [id, body] of pairs) {
        const result = await api.decideItem(id, body);
        if (!result.ok && result.status !== 404) {
          cardStatus.textContent = result.error;
          return;
        }
      }
    } finally {
      deciding = false;
    }
    await loadItems();
  }

  async function decide(id, decision, button) {
    button.disabled = true;
    const result = await api.decide(id, decision);
    if (!result.ok) {
      button.disabled = false;
      setStatus(result.error);
      return;
    }
    await load();
  }

  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    token = tokenInput.value.trim();
    persistToken(storage, token);
    tokenInput.value = '';
    load();
  });

  forget.addEventListener('click', () => {
    token = '';
    persistToken(storage, '');
    api = null;
    load();
  });

  refresh.addEventListener('click', load);

  load();
}
```

- [ ] **Step 4: Add the section to `review/index.html`**

After `<ul id="review-list" class="review-list" role="list"></ul>` (line 41), add:

```html

    <section class="item-review" aria-labelledby="item-review-title">
      <h2 id="item-review-title">Missing items (<span id="item-review-count">0</span>)</h2>
      <p class="toggle-note">
        Items players found that the guide does not list. None of this is
        public. Fix the name and category before approving: the nightly sync
        writes exactly what you approve, never what was typed.
      </p>
      <p id="item-review-status" class="empty-state" role="status" aria-live="polite"></p>
      <ul id="item-review-list" class="review-list" role="list"></ul>
    </section>
```

In the inline module script, add these entries to the `elements` object after `list: document.getElementById('review-list'),`:

```js
        itemCount: document.getElementById('item-review-count'),
        itemStatus: document.getElementById('item-review-status'),
        itemList: document.getElementById('item-review-list'),
```

- [ ] **Step 5: Style it in `assets/css/style.css`, using existing tokens only**

Directly after the line `.review-reject  { color: var(--warning); }`, add:

```css
/* --- Missing items (maintainer only) ---
   One card per item, sized for a phone like the rest of this page. */

.item-review {
  margin-top: 32px;
}

.item-reports {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.item-report {
  padding: 6px 0;
  border-top: 1px solid var(--rule);
}

.item-field {
  display: block;
  margin-top: 10px;
  font-weight: 600;
}

.item-field input,
.item-field select {
  display: block;
  width: 100%;
  min-height: 44px;
  margin-top: 4px;
  padding: 8px 11px;
  border: 1px solid var(--edge);
  background: var(--raised);
  color: var(--ink);
  font: inherit;
  font-weight: 400;
}

.item-include {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `node --test test/review.test.mjs test/assets.test.mjs`
Expected: PASS, including the two existing `mountReview` storage tests. They now fall through to the default `loadSiteData`, whose relative-URL `fetch` rejects in Node. That rejection is caught and becomes an item-status message.

- [ ] **Step 7: Full suite and validator**

Run: `npm test && npm run validate`
Expected: all pass; `data valid`.

- [ ] **Step 8: Browser check against a local stub Worker (never the live one)**

1. Create `"${TMPDIR:-/tmp}/fefw-review-stub.mjs"` (outside the repo):

   ```js
   // A stand-in Worker for the review page, on 127.0.0.1:8788. It logs every
   // decision it is sent and changes nothing anywhere.
   import http from 'node:http';

   const ORIGIN = 'http://127.0.0.1:8139';
   const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600e3).toISOString();
   const row = (id, name, extra) => ({ id, name, category: null, category_line: null, rarity: null, character: null, reaction: null, status: 'pending', created_at: at(5), ...extra });
   const ITEMS = [
     row('i1', 'lantern oil', { category: 'horses', rarity: 'rare', character: 'alexandra', reaction: 'loved', created_at: at(30) }),
     row('i2', 'Lantern-Oil', { category: 'horses', created_at: at(20) }),
     row('i3', 'tea set', { category_line: 'those who love tea', rarity: 'common' }),
     row('i4', 'horse groming kit', { category: 'horses', character: 'alexandra', reaction: 'liked' }),
   ];

   http.createServer((req, res) => {
     const headers = {
       'Access-Control-Allow-Origin': ORIGIN,
       'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
       'Access-Control-Allow-Headers': 'Content-Type, Authorization',
       'Content-Type': 'application/json',
     };
     if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
     let body = '';
     req.on('data', (chunk) => { body += chunk; });
     req.on('end', () => {
       if (req.method === 'POST') console.log(req.method, req.url, body);
       let reply = { error: 'not found' };
       let status = 404;
       if (req.url === '/review') { status = 200; reply = { reports: [] }; }
       if (req.url === '/item-review') { status = 200; reply = { reports: ITEMS }; }
       if (req.url.startsWith('/item-review/') && req.method === 'POST') {
         status = 200;
         reply = { id: decodeURIComponent(req.url.split('/')[2]), status: JSON.parse(body).decision === 'approve' ? 'approved' : 'rejected' };
       }
       res.writeHead(status, headers);
       res.end(JSON.stringify(reply));
     });
   }).listen(8788, '127.0.0.1', () => console.log('stub Worker on http://127.0.0.1:8788'));
   ```

2. Start it in the background with `node "${TMPDIR:-/tmp}/fefw-review-stub.mjs"`, and start `python3 /tmp/fefw-serve.py` in the background too.
3. Temporarily set `export const WORKER_URL = 'http://127.0.0.1:8788';` in `assets/js/config.js`. **Do not commit this.**
4. Open `http://127.0.0.1:8139/review/?cb=1`, paste any token (for example `local`), and press **Use it**. Expected: "Missing items (3)", with cards for Lantern Oil (reported 2 times), Tea Set, and Horse Groming Kit. The first card has "Include result" on the first report only, Category preselected to Horses, and Rarity Rare. The Tea Set card shows the new-category fields: label `Those Who Love Tea`, id `those-who-love-tea`, in-game line `those who love tea`.
5. On the Horse Groming Kit card, change the name to `Horse-Grooming Kit`. Expected: "Already listed as Horse-Grooming Kit — approving adds only the results.", with Category and Rarity disabled.
6. On the Tea Set card, set the id to `horses` and press **Approve**. Expected: "A category with the id “horses” already exists — pick it from the list instead." and nothing in the stub's log. Set it to `tea`, then press **Approve**. Expected: the stub logs `POST /item-review/i3 {"decision":"approve",…,"newCategory":{"id":"tea",…},…}`.
7. On the Lantern Oil card, untick "Include result" and press **Approve**. Expected: two log lines, both `"includeResult":false`.
8. Check the layout at widths 320, 390 and 1280. Expected: no horizontal page scroll, inputs full width, touch targets at least 44px tall.
9. Press **Forget it**. Then revert the config with `git checkout -- assets/js/config.js`, confirm `git diff --quiet -- assets/js/config.js` exits 0, and stop both servers.

- [ ] **Step 9: Mutation check**

Apply each mutation on its own, run `node --test test/review.test.mjs`, and confirm at least one test goes red. Revert before the next one.
1. In `groupItemReports`, use `const key = String(row?.name);` instead of `normalizeName(row?.name)`.
2. In `itemCardDefaults`, pre-select `ids[0]` when it is known, whether or not the reports agree.
3. In `itemApprovalBody`, delete the `categoryIdClash` check.
4. In `approve()`, send `includeResult: true` for every report.
5. In `decideItems`, stop on a 404 too (drop `&& result.status !== 404`).
6. In `itemApprovalBody`, delete the `if (listed) { body.giftId = listed.id; } else` branch head, so a listed name falls through to the category controls.

Then run `git status --porcelain`. Expected: only `review/index.html`, `assets/js/review.js`, `assets/css/style.css`, `test/review.test.mjs` and `test/assets.test.mjs`.

- [ ] **Step 10: Commit**

```bash
git add review/index.html assets/js/review.js assets/css/style.css test/review.test.mjs test/assets.test.mjs
git commit -m "Add a Missing items section to the review page"
```

---
### Task 6: Nightly sync

**Files:**
- Modify: `scripts/ingest.mjs` (whole file; the full replacement is below)
- Modify: `.github/workflows/sync-reports.yml` (whole file; the full replacement is below)
- Test: `test/ingest.test.mjs` (append), plus an end-to-end script kept outside the repo

**Interfaces:**
- Consumes: `slugify`, `normalizeName`, `validateItemApproval` (Task 1); the `POST /ingest-items` response `{ items: [{ id, approved, character, reaction, created_at }] }` (Task 2); the existing `toObservation`, `mergeObservations`, `skippedRowWarning`, `loadDataset` and `validate`.
- Produces (in `scripts/ingest.mjs`):
  - `applyItemReports(dataset, items)` → `{ categories, gifts, observations, summary: { newGifts: string[], newCategories: string[], results: number }, skipped: item[] }`. It is pure, does not mutate `dataset`, and applies in the order category → gift → observation.
  - `fetchItemBatch(workerUrl, adminToken, fetchImpl)` → `{ items, warning: string | null }`. It never throws.
  - `itemSkippedWarning(item)` → one `::warning` line, escaped.
  - `appendCategoryLines(text, entries)` → `categories.json` text with the new one-line entries appended. Existing lines are left byte-for-byte as they are.
  - `ingestSummary({ added, summary })` → the Markdown body for the pull request.
  - `main()` writes `added=N` and `items=N` to `$GITHUB_OUTPUT`, where `items` = new gifts + new categories + item results. It writes the summary to `$INGEST_SUMMARY` when that is set.

**Decisions settled here (the spec leaves them open):**
- **Any `/ingest-items` failure is a warning, not only a 404.** The spec makes a 404 a `::warning` "so result syncing never depends on this feature". A 500, a network error or a non-JSON body are treated the same way, for the same reason: by then `/ingest` has already marked that night's result rows ingested, and failing the run would throw them away. A 404 gets its own message telling the maintainer to redeploy.
- **An existing gift is matched by slug *or* by normalised name.** The spec says "if that id already exists, the item is treated as that existing gift". Matching on `normalizeName` as well stops "Lanternoil" from being added next to an existing "Lantern Oil" (different slugs, same normalised name). That duplicate would fail the real-data uniqueness test from Task 1 in the sync job's own `npm test`.
- **`categories.json` is hand-aligned**, so it is never re-serialised. New categories are appended as one-line entries in the file's own style. `gifts.json` and `observations.json` round-trip byte-for-byte through `JSON.stringify(…, null, 2) + '\n'` (checked while writing this plan), so they are written the usual way.
- **An approval that fails `validateItemApproval` is set aside** with a warning, like a result row with no id. It is not applied. The raw batch is already in the log.

- [ ] **Step 1: Write the failing unit tests**

Append to `test/ingest.test.mjs`:

```js
import { readFile } from 'node:fs/promises';
import {
  applyItemReports, fetchItemBatch, itemSkippedWarning, appendCategoryLines, ingestSummary,
} from '../scripts/ingest.mjs';
import { validate } from '../scripts/validate.mjs';

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

test('two reports creating the same new category add it once', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { newCategory: LANTERNS }), approvedItem('i2', { newCategory: LANTERNS })]);
  assert.equal(out.categories.filter((c) => c.id === 'lanterns').length, 1);
  assert.equal(out.summary.newCategories.length, 1);
});

test('a new category whose id already exists is not added again', () => {
  const out = applyItemReports(DATASET, [approvedItem('i1', { newCategory: { id: 'horses', label: 'Horses', inGameDescriptor: 'those who love horses' } })]);
  assert.equal(out.categories.length, DATASET.categories.length);
  assert.deepEqual(out.summary.newCategories, []);
});

test('an item whose slug or normalised name is already listed is that gift, not a duplicate', () => {
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
  assert.deepEqual(out.skipped, bad);
  assert.deepEqual(out.gifts.map((g) => g.id), ['horse-grooming-kit', 'lantern-oil']);
});

test('the input dataset is not mutated, and re-running the same batch adds nothing', () => {
  const before = structuredClone(DATASET);
  const items = [approvedItem('i1', { newCategory: LANTERNS, includeResult: true }, withResult)];
  const first = applyItemReports(DATASET, items);
  assert.deepEqual(DATASET, before);
  const again = applyItemReports({ ...DATASET, ...first }, items);
  assert.deepEqual(again.summary, { newGifts: [], newCategories: [], results: 0 });
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

test('itemSkippedWarning escapes its interpolated id', () => {
  const warning = itemSkippedWarning({ id: 'a\nb%' });
  assert.ok(!warning.includes('\n'));
  assert.ok(warning.includes('a%0Ab%25'));
  assert.match(warning, /^::warning title=Missing item skipped::/);
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/ingest.test.mjs`
Expected: FAIL (`does not provide an export named 'applyItemReports'`).

- [ ] **Step 3: Replace `scripts/ingest.mjs`**

`toObservation`, `mergeObservations`, `escapeWorkflowValue` and `skippedRowWarning` are unchanged, including their comments. The code below reproduces them with their comments shortened; **keep the current comments on those four functions word for word**.

```js
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDataset, validate } from './validate.mjs';
import { normalizeName, slugify, validateItemApproval } from '../assets/js/item-rules.js';

// The observation shape from the spec's data model, and nothing else.
export function toObservation(row) {
  return {
    id: row.id,
    gift: row.gift,
    character: row.character,
    reaction: row.reaction,
    date: String(row.created_at ?? '').slice(0, 10),
  };
}

// (Keep the existing comment block above mergeObservations unchanged.)
export function mergeObservations(existing, rows) {
  const seen = new Set(existing.map((observation) => observation.id));
  const added = [];
  const skipped = [];
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id.length === 0) {
      skipped.push(row);
      continue;
    }
    const observation = toObservation(row);
    if (seen.has(observation.id)) continue;
    seen.add(observation.id);
    added.push(observation);
  }
  return { observations: [...existing, ...added], added, skipped };
}

// (Keep the existing comment block above escapeWorkflowValue unchanged.)
function escapeWorkflowValue(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function skippedRowWarning(row) {
  const character = escapeWorkflowValue(row.character);
  const gift = escapeWorkflowValue(row.gift);
  const createdAt = escapeWorkflowValue(row.created_at);
  return `::warning title=Report skipped::approved report with no usable id (character=${character}, gift=${gift}, created_at=${createdAt}) was not ingested; it will be returned every night until its id is fixed in D1`;
}

// --- Missing items ---

// Pure. Applies one night's approved missing-item reports to the dataset, in
// the spec's order: new categories, then new gifts (which may name a category
// created a moment ago), then results. Only the maintainer's approved values
// are read -- the player's raw name and typed line are not even in the
// Worker's response -- and every approval is re-checked here, because a row
// edited by hand in D1 must not reach data/ either.
export function applyItemReports(dataset, items) {
  const categories = [...dataset.categories];
  const gifts = [...dataset.gifts];
  const summary = { newGifts: [], newCategories: [], results: 0 };
  const skipped = [];

  const approvals = [];
  for (const item of Array.isArray(items) ? items : []) {
    const approved = item?.approved;
    const check = approved !== null && typeof approved === 'object' && !Array.isArray(approved)
      ? validateItemApproval({ ...approved, decision: 'approve' })
      : { errors: ['no approval'], value: null };
    if (typeof item?.id !== 'string' || item.id === '' || check.errors.length) {
      skipped.push(item);
      continue;
    }
    approvals.push({ item, approved: check.value });
  }

  // 1. Categories.
  const categoryIds = new Set(categories.map((category) => category.id));
  for (const { approved } of approvals) {
    const proposed = approved.newCategory;
    if (!proposed || categoryIds.has(proposed.id)) continue;
    categories.push({ id: proposed.id, label: proposed.label, inGameDescriptor: proposed.inGameDescriptor, aliases: [] });
    categoryIds.add(proposed.id);
    summary.newCategories.push(`${proposed.label} (${proposed.id}) — “${proposed.inGameDescriptor}”`);
  }

  // 2. Gifts. An item already listed -- by slug, or by a normalised name the
  // slug misses ("Lanternoil" beside "Lantern Oil") -- is that gift, so
  // several reports of one item in a batch yield one gift.
  const results = [];
  for (const { item, approved } of approvals) {
    let giftId = approved.giftId;
    if (giftId === null) {
      const slug = slugify(approved.name);
      const key = normalizeName(approved.name);
      const existing = gifts.find((gift) => gift.id === slug || normalizeName(gift.name) === key);
      if (existing) {
        giftId = existing.id;
      } else {
        const category = approved.newCategory?.id ?? approved.category ?? null;
        gifts.push({ id: slug, name: approved.name, category, rarity: approved.rarity, description: '', sources: [] });
        giftId = slug;
        summary.newGifts.push(`${approved.name} (${slug}) — category: ${category ?? 'not recorded'}, rarity: ${approved.rarity ?? 'not recorded'}`);
      }
    }

    // 3. Results: only when the maintainer kept one and both halves exist.
    if (approved.includeResult && item.character && item.reaction) {
      results.push({ id: item.id, gift: giftId, character: item.character, reaction: item.reaction, created_at: item.created_at });
    }
  }

  // The report id becomes the observation id, exactly as for result reports,
  // so a re-run cannot duplicate a row.
  const merged = mergeObservations(dataset.observations, results);
  summary.results = merged.added.length;
  return { categories, gifts, observations: merged.observations, summary, skipped };
}

const ITEMS_NOT_SYNCED = '::warning title=Missing items not synced::';

// Never throws and never fails the run. By the time this is called, /ingest
// has already marked the night's result rows ingested, so failing here would
// throw them away -- result syncing must never depend on this feature.
export async function fetchItemBatch(workerUrl, adminToken, fetchImpl = (...args) => globalThis.fetch(...args)) {
  let response;
  try {
    response = await fetchImpl(`${workerUrl}/ingest-items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  } catch (err) {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}could not reach /ingest-items (${escapeWorkflowValue(err?.message)}); result reports are unaffected` };
  }

  if (response.status === 404) {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}the Worker has no /ingest-items route yet -- redeploy it (see worker/README.md); result reports are unaffected` };
  }
  if (!response.ok) {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}/ingest-items returned ${response.status}; result reports are unaffected` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}/ingest-items answered with a body that is not JSON; any rows it marked ingested must be re-entered by hand` };
  }
  return { items: Array.isArray(body?.items) ? body.items : [], warning: null };
}

export function itemSkippedWarning(item) {
  return `::warning title=Missing item skipped::approved item report ${escapeWorkflowValue(item?.id)} has no usable approval and was not synced; the logged batch above is the only copy`;
}

// categories.json is aligned by hand, so it is never re-serialised: new
// entries are appended as one-line objects in the file's own style, and every
// existing byte stays where it was.
export function appendCategoryLines(text, entries) {
  if (entries.length === 0) return text;
  const head = text.slice(0, text.lastIndexOf(']')).replace(/\s+$/, '');
  const separator = head.endsWith('[') ? '' : ',';
  const lines = entries.map((c) => `  { "id": ${JSON.stringify(c.id)}, "label": ${JSON.stringify(c.label)}, "inGameDescriptor": ${JSON.stringify(c.inGameDescriptor)}, "aliases": [] }`);
  return `${head}${separator}\n${lines.join(',\n')}\n]\n`;
}

// The pull request body. Every new item and category is listed, because the
// maintainer approved each one on a phone and is now looking at it in a diff.
export function ingestSummary({ added, summary }) {
  const lines = [`${added} approved result report(s) from the submission Worker.`];
  if (summary.newGifts.length > 0) {
    lines.push('', `**New items (${summary.newGifts.length})** — check each name against the game before merging:`, ...summary.newGifts.map((line) => `- ${line}`));
  }
  if (summary.newCategories.length > 0) {
    lines.push('', `**New categories (${summary.newCategories.length})** — check the label, id and in-game line:`, ...summary.newCategories.map((line) => `- ${line}`));
  }
  if (summary.results > 0) lines.push('', `${summary.results} result(s) from missing-item reports.`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const workerUrl = (process.env.WORKER_URL ?? '').replace(/\/+$/, '');
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  const dataDir = process.env.DATA_DIR ?? 'data';

  if (!workerUrl || !adminToken) {
    console.error('WORKER_URL and ADMIN_TOKEN must both be set');
    process.exit(1);
  }

  const response = await fetch(`${workerUrl}/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    console.error(`the Worker returned ${response.status}`);
    process.exit(1);
  }

  const { reports } = await response.json();
  const rows = Array.isArray(reports) ? reports : [];

  // Printed before anything can fail: takeApproved has already marked these rows
  // ingested in D1, so if validation or the pull request fails afterwards this
  // log is the only copy left.
  console.log(JSON.stringify(rows, null, 2));

  // The same for missing items: takeApprovedItems marks them in the same call.
  const { items, warning } = await fetchItemBatch(workerUrl, adminToken);
  console.log(JSON.stringify(items, null, 2));
  if (warning) console.log(warning);

  const dataset = await loadDataset(dataDir);
  const merged = mergeObservations(dataset.observations, rows);

  // Emitted before the early return below, so a night where every row is
  // skipped still surfaces a warning instead of silently logging "nothing to
  // ingest". This does not fail the run: the pull-request step only runs on
  // success, and failing here would throw away every good row in the same
  // batch along with the bad one.
  for (const row of merged.skipped) console.log(skippedRowWarning(row));

  const applied = applyItemReports({ ...dataset, observations: merged.observations }, items);
  for (const item of applied.skipped) console.log(itemSkippedWarning(item));

  const { summary } = applied;
  const itemChanges = summary.newGifts.length + summary.newCategories.length + summary.results;
  if (merged.added.length === 0 && itemChanges === 0) {
    console.log('nothing to ingest');
    await report(0, 0);
    return;
  }

  // Validate the merged dataset in memory and write only if it is clean. A bad
  // row must never reach the working tree, let alone a pull request.
  const { errors } = validate({ ...dataset, categories: applied.categories, gifts: applied.gifts, observations: applied.observations });
  if (errors.length) {
    console.error(`${errors.length} validation error(s); nothing written:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  // Only the files that changed are written, so an unchanged file is not
  // rewritten.
  if (summary.newCategories.length > 0) {
    const categoriesPath = path.join(dataDir, 'categories.json');
    const text = await readFile(categoriesPath, 'utf8');
    await writeFile(categoriesPath, appendCategoryLines(text, applied.categories.slice(dataset.categories.length)));
  }
  if (summary.newGifts.length > 0) {
    await writeFile(path.join(dataDir, 'gifts.json'), `${JSON.stringify(applied.gifts, null, 2)}\n`);
  }
  if (applied.observations.length !== dataset.observations.length) {
    await writeFile(path.join(dataDir, 'observations.json'), `${JSON.stringify(applied.observations, null, 2)}\n`);
  }

  console.log(`ingested ${merged.added.length} result report(s); ${summary.newGifts.length} new item(s), ${summary.newCategories.length} new categor(y/ies), ${summary.results} item result(s)`);
  if (process.env.INGEST_SUMMARY) {
    await writeFile(process.env.INGEST_SUMMARY, ingestSummary({ added: merged.added.length, summary }));
  }
  await report(merged.added.length, itemChanges);
}

// Hands the counts to the workflow. Writing to GITHUB_OUTPUT is a no-op
// locally, so the script behaves the same either way.
async function report(added, items) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `added=${added}\nitems=${items}\n`);
}

// CLI entry point: `npm run ingest`. Importing this file runs nothing.
if (import.meta.filename === process.argv[1]) {
  await main();
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `node --test test/ingest.test.mjs`
Expected: PASS, including every pre-existing ingest test.

- [ ] **Step 5: Replace `.github/workflows/sync-reports.yml`**

```yaml
name: sync-reports

# Pulls approved result reports and approved missing-item reports out of the
# Worker and opens a pull request adding them to data/. Nothing merges
# automatically: the repository stays the source of truth, and a human still
# says yes.
on:
  schedule:
    - cron: '17 6 * * *'
  workflow_dispatch:

permissions: {}

jobs:
  sync:
    # A fork has neither the secrets nor a reason to run this.
    if: github.repository == 'mackoz/fefw-gifts'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Pull approved reports
        id: ingest
        env:
          WORKER_URL: ${{ secrets.WORKER_URL }}
          ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
          INGEST_SUMMARY: ${{ runner.temp }}/ingest-summary.md
        run: npm run ingest

      # A pull request opened with GITHUB_TOKEN does not start another workflow,
      # so validation runs here instead. The deploy gate is untouched either
      # way: deploy only ever runs on a push to master, and that push does
      # trigger ci.yml.
      - name: Validate and test the result
        if: success() && (steps.ingest.outputs.added != '0' || steps.ingest.outputs.items != '0')
        run: npm run validate && npm test

      - name: Open a pull request
        if: success() && (steps.ingest.outputs.added != '0' || steps.ingest.outputs.items != '0')
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ADDED: ${{ steps.ingest.outputs.added }}
          ITEMS: ${{ steps.ingest.outputs.items }}
          INGEST_SUMMARY: ${{ runner.temp }}/ingest-summary.md
        run: |
          BRANCH="reports/$(date -u +%Y-%m-%d-%H%M)"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git checkout -b "$BRANCH"
          # The script writes only the files that changed, so staging all
          # three picks up exactly those.
          git add data/observations.json data/gifts.json data/categories.json
          git commit -m "Sync ${ADDED} approved report(s) and ${ITEMS} missing-item change(s)"
          git push origin "$BRANCH"
          gh pr create --base master --head "$BRANCH" \
            --title "Sync ${ADDED} approved report(s) and ${ITEMS} missing-item change(s)" \
            --body-file "$INGEST_SUMMARY"
```

Check that it parses:

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/sync-reports.yml"); puts y["jobs"]["sync"]["steps"].map { |s| s["name"] }.compact'`
Expected: prints `Pull approved reports`, `Validate and test the result`, `Open a pull request`.

- [ ] **Step 6: Full suite and validator**

Run: `npm test && npm run validate`
Expected: all pass; `data valid`.

- [ ] **Step 7: End-to-end run of the real script against a stub Worker, on a scratch copy of `data/`**

This runs the real `scripts/ingest.mjs`. It never touches the real Worker, because the real `/ingest` marks rows ingested, and it never touches the real `data/`.

Create `"${TMPDIR:-/tmp}/fefw-ingest-e2e.mjs"` (outside the repo):

```js
// Runs the REAL scripts/ingest.mjs against a stub node:http Worker, on scratch
// copies of data/. Never the real Worker and never the real data/.
import http from 'node:http';
import { mkdtemp, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';

const REPO = process.argv[2];
assert.ok(REPO, 'usage: node fefw-ingest-e2e.mjs /path/to/repo');

const replies = {};
const server = http.createServer((req, res) => {
  const reply = req.method === 'POST' && req.headers.authorization === 'Bearer stub-token'
    ? replies[req.url] ?? { status: 404, body: { error: 'not found' } }
    : { status: 401, body: { error: 'unauthorised' } };
  res.writeHead(reply.status, { 'Content-Type': 'application/json' });
  res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const workerUrl = `http://127.0.0.1:${server.address().port}`;

const FILES = ['categories', 'gifts', 'observations'];
const original = Object.fromEntries(await Promise.all(FILES.map(async (name) => [name, await readFile(path.join(REPO, 'data', `${name}.json`), 'utf8')])));

async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), 'fefw-ingest-e2e-'));
  await cp(path.join(REPO, 'data'), path.join(dir, 'data'), { recursive: true });
  return dir;
}

function run(dir) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, 'scripts', 'ingest.mjs')], {
      cwd: REPO,
      env: {
        ...process.env,
        WORKER_URL: workerUrl,
        ADMIN_TOKEN: 'stub-token',
        DATA_DIR: path.join(dir, 'data'),
        GITHUB_OUTPUT: path.join(dir, 'out.txt'),
        INGEST_SUMMARY: path.join(dir, 'summary.md'),
      },
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

const read = (dir, name) => readFile(path.join(dir, 'data', `${name}.json`), 'utf8');

const RESULT = { id: 'e2e-result-1', character: 'alexandra', gift: 'yarc-milk', reaction: 'liked', created_at: '2026-09-23T07:00:00.000Z' };
const APPROVED = {
  name: 'Lantern Oil', giftId: null, category: null,
  newCategory: { id: 'lanterns', label: 'Lanterns', inGameDescriptor: 'lantern lovers' },
  rarity: 'rare', includeResult: true,
};
const ITEMS = [
  { id: 'e2e-item-1', approved: APPROVED, character: 'alexandra', reaction: 'loved', created_at: '2026-09-23T08:00:00.000Z' },
  { id: 'e2e-item-2', approved: { ...APPROVED, includeResult: false }, character: null, reaction: null, created_at: '2026-09-23T09:00:00.000Z' },
];

try {
  // A. Both batches land: one category, one gift, two observations.
  {
    replies['/ingest'] = { status: 200, body: { reports: [RESULT] } };
    replies['/ingest-items'] = { status: 200, body: { items: ITEMS } };
    const dir = await scratch();
    const { code, stdout, stderr } = await run(dir);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /e2e-item-1/, 'the raw item batch is logged before anything can fail');
    const categories = await read(dir, 'categories');
    assert.ok(categories.startsWith(original.categories.slice(0, original.categories.lastIndexOf('}') + 1)), 'existing category lines untouched');
    assert.equal(JSON.parse(categories).at(-1).id, 'lanterns');
    assert.deepEqual(JSON.parse(await read(dir, 'gifts')).at(-1), { id: 'lantern-oil', name: 'Lantern Oil', category: 'lanterns', rarity: 'rare', description: '', sources: [] });
    assert.deepEqual(JSON.parse(await read(dir, 'observations')).slice(-2).map((o) => o.id), ['e2e-result-1', 'e2e-item-1']);
    const out = await readFile(path.join(dir, 'out.txt'), 'utf8');
    assert.match(out, /^added=1$/m);
    assert.match(out, /^items=3$/m);
    const summary = await readFile(path.join(dir, 'summary.md'), 'utf8');
    assert.match(summary, /Lantern Oil \(lantern-oil\)/);
    assert.match(summary, /Lanterns \(lanterns\)/);
    console.log('A ok: result and item batches both landed');
  }

  // B. An old Worker: /ingest-items is a 404. Results still land; nothing else changes.
  {
    replies['/ingest'] = { status: 200, body: { reports: [RESULT] } };
    delete replies['/ingest-items'];
    const dir = await scratch();
    const { code, stdout, stderr } = await run(dir);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /::warning title=Missing items not synced::.*redeploy/);
    assert.equal(await read(dir, 'gifts'), original.gifts);
    assert.equal(await read(dir, 'categories'), original.categories);
    assert.equal(JSON.parse(await read(dir, 'observations')).at(-1).id, 'e2e-result-1');
    assert.match(await readFile(path.join(dir, 'out.txt'), 'utf8'), /^items=0$/m);
    console.log('B ok: a 404 is a warning and results still sync');
  }

  // C. A validation failure writes nothing and exits 1.
  {
    replies['/ingest'] = { status: 200, body: { reports: [] } };
    replies['/ingest-items'] = { status: 200, body: { items: [{ ...ITEMS[0], approved: { ...APPROVED, newCategory: null, giftId: 'no-such-gift' } }] } };
    const dir = await scratch();
    const { code, stderr } = await run(dir);
    assert.equal(code, 1);
    assert.match(stderr, /validation error/);
    for (const name of FILES) assert.equal(await read(dir, name), original[name], `${name} must be untouched`);
    console.log('C ok: invalid data writes nothing');
  }

  // D. Nothing to do.
  {
    replies['/ingest'] = { status: 200, body: { reports: [] } };
    replies['/ingest-items'] = { status: 200, body: { items: [] } };
    const dir = await scratch();
    const { code, stdout } = await run(dir);
    assert.equal(code, 0);
    assert.match(stdout, /nothing to ingest/);
    const out = await readFile(path.join(dir, 'out.txt'), 'utf8');
    assert.match(out, /^added=0$/m);
    assert.match(out, /^items=0$/m);
    console.log('D ok: an empty night changes nothing');
  }
} finally {
  server.close();
}
```

Run:

```bash
node "${TMPDIR:-/tmp}/fefw-ingest-e2e.mjs" "$PWD"
git status --porcelain -- data
```

Expected: `A ok …`, `B ok …`, `C ok …`, `D ok …`, and the `git status` prints nothing (the real `data/` is untouched).

- [ ] **Step 8: Mutation check**

Apply each mutation on its own and confirm at least one check goes red. Run `node --test test/ingest.test.mjs` for mutations 1-6, and the end-to-end script for mutations 7-8. Revert before the next one.
1. In `applyItemReports`, drop the `existing` lookup, so every approval pushes a gift. The "several reports of one item" test should go red.
2. In `applyItemReports`, drop `approved.includeResult &&`.
3. In `applyItemReports`, write the gift's category as `approved.category ?? null`, ignoring `newCategory`.
4. In `applyItemReports`, skip the `validateItemApproval` re-check (`const check = { errors: [], value: approved }`).
5. In `fetchItemBatch`, replace the 404 branch's `return` with `throw new Error('404')`.
6. In `appendCategoryLines`, return `` `${JSON.stringify(JSON.parse(text).concat(entries.map((c) => ({ ...c, aliases: [] }))), null, 2)}\n` `` instead.
7. In `main`, delete `console.log(JSON.stringify(items, null, 2));`. Scenario A should go red.
8. In `main`, move the three `writeFile` calls above the `validate(...)` call. Scenario C should go red.

Then run `git status --porcelain`. Expected: only `scripts/ingest.mjs`, `.github/workflows/sync-reports.yml` and `test/ingest.test.mjs`.

- [ ] **Step 9: Commit**

```bash
git add scripts/ingest.mjs .github/workflows/sync-reports.yml test/ingest.test.mjs
git commit -m "Sync approved missing-item reports into data/ alongside result reports"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md:340-345` ("Structural changes")
- Modify: `CONTRIBUTING.md` (new section after "Reporting a gift result"; one line in "Structural changes")

**Interfaces:**
- Consumes: the finished feature (Tasks 1-6).
- Produces: nothing code depends on.

- [ ] **Step 1: Update the base spec's "Structural changes"**

Replace:

```markdown
Adding a category, correcting a gift's rarity, or fixing a character's traits are
rare, structural edits rather than volume data. These go through the GitHub issue
forms in `.github/ISSUE_TEMPLATE/`, documented in `CONTRIBUTING.md`. They are not
worth a web form.
```

with:

```markdown
Adding a category, correcting a gift's rarity, or fixing a character's traits are
rare, structural edits rather than volume data. These go through the GitHub issue
forms in `.github/ISSUE_TEMPLATE/`, documented in `CONTRIBUTING.md`. They are not
worth a web form.

**Superseded for missing items.** An item `gifts.json` does not list turned out
not to be rare, so players now report one from the site, anonymously and hidden
until the maintainer approves it. See
[`2026-09-23-missing-item-reports-design.md`](2026-09-23-missing-item-reports-design.md).
Category edits, rarity corrections to existing items and trait fixes still go
through the issue forms.
```

- [ ] **Step 2: Update `CONTRIBUTING.md`**

Insert this section before `## Structural changes`:

```markdown
## Reporting a missing item

The item list is put together from guides and our own play, and it is not
complete. If you have an item the site does not list, report it from the site.
You can choose **My item isn’t listed…** at the bottom of the report form's
gift list, or search for it on the Gifts tab and press
**Report ‘…’ as a missing item**.

The form asks for:

- the item's name, exactly as the game shows it
- its "Primarily enjoyed by …" line (type it if it isn't in our list)
- its rarity, if you know it
- optionally, who you gave it to and how they reacted

It is anonymous, like a result report: nothing about you is stored. Unlike a
result report, **nothing you type appears on the site until the maintainer has
read it**. The maintainer corrects the name and category if needed and approves
it, and it reaches `data/gifts.json` in the next nightly sync's pull request.
```

In `## Structural changes`, add this bullet as the first item of the list:

```markdown
- **Adding an item the site does not list.** Use the site's missing-item form
  (above) rather than an issue. It needs no account.
```

- [ ] **Step 3: Check the links and run the suite**

Run:

```bash
test -f docs/superpowers/specs/2026-09-23-missing-item-reports-design.md && echo "spec link ok"
grep -n "Superseded for missing items" docs/superpowers/specs/2026-09-20-fefw-gifts-design.md
grep -n "Reporting a missing item" CONTRIBUTING.md
npm test && npm run validate
```

Expected: `spec link ok`, one match for each grep, all tests pass, and `data valid`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-20-fefw-gifts-design.md CONTRIBUTING.md
git commit -m "Document missing-item reports for contributors"
```

---

### Final verification (after Task 7)

- [ ] Run: `npm test && npm run validate`. Expected: 0 failures, `data valid`, and no stray warnings.
- [ ] Re-run Task 2 Step 9 (the wrangler dry run). Expected: it bundles, and `normalizeName` is in the output.
- [ ] Re-run Task 6 Step 7 (the end-to-end script). Expected: A-D ok, and `git status --porcelain -- data` is empty.
- [ ] Run: `git grep -n "item_reports" -- worker/src/reports.js`. Expected: no output (`/pending` stays blind to the new table).
- [ ] Run: `git grep -nE "remoteip|innerHTML" -- assets/js worker/src`. Expected: only the existing warning comment in `worker/src/turnstile.js`.
- [ ] Run: `git grep -nE "#[0-9a-fA-F]{3,6}\b|rgba?\(" -- assets/css/style.css`. Expected: only `rgb(0 0 0 / 0.6)`.
- [ ] Deployment is **not** part of this plan's execution. It is the maintainer's step, from the PR branch before merging, as recorded in `worker/README.md`: `npx --yes wrangler d1 execute fefw-gifts --remote --file worker/schema.sql --config worker/wrangler.toml`, then `npm run worker:deploy`.

---

## Spec coverage

| Spec section | Where |
|---|---|
| Problem / Decisions 1-5 (separate pipeline, item facts + optional result, "Not listed — type it", hidden until approved, maintainer fixes before approving) | Tasks 2, 4, 5, 6 |
| Shared rules (text rule, ids, rarity, reaction, `normalizeName`, `slugify`, `suggestName`, one module imported by the Worker) | Task 1; Worker import checked in Task 2 Step 9 |
| 1. Entry points: gift select's last option; Gifts-tab empty search; only with `WORKER_URL` set | Task 4 (Steps 3, 7, 9; views test) |
| 1. Fields (name + live duplicate check with link; in-game line select + typed line; rarity with "not sure"; optional pair, spoiler-aware, both or neither; Turnstile reset) | Task 4 |
| 1. Copy ("Only the site maintainer sees this…"), payload shape, success message, nothing public changes | Task 4 |
| 2. Schema (`item_reports`, index, `IF NOT EXISTS`, no vote or identifying columns) | Task 2 Step 3 |
| 2. Endpoints `POST /item-report`, `GET /item-review`, `POST /item-review/:id`, `POST /ingest-items` (auth, validation, idempotency, `no-store`) | Task 2; client in Task 3 |
| 2. Unchanged guarantees (`/pending` never touches `item_reports`, no `remoteip`, 8 KB cap, Turnstile fails closed) | Task 2 tests; Final verification |
| 3. Review page (section and count, grouping, per-card edit form and pre-fills, new category with clash check, include-result ticks, existing-gift check, Approve / Reject card / per-report Reject) | Task 5 |
| 4. Nightly sync (both calls, 404 warning, raw logs first, category → gift → observation, dedupe, `toObservation`/`mergeObservations`, `validate()` or write nothing, approved values only, `sources: []`) | Task 6 |
| 4. Workflow (runs if either batch added anything, commits changed files, PR body lists new items and categories, no auto-merge) | Task 6 Step 5 |
| Anonymity and abuse (four ≤ 40-char fields, restrictive set, never public before approval, no voting) | Tasks 1, 2, 5 |
| Deployment (two commands, order, no dashboard change, recorded in `worker/README.md`) | Task 2 Step 7 |
| Testing (every listed item, the end-to-end run, mutation checks) | Tests in every task; E2E in Task 6 Step 7; mutation step in every task |
| Supersedes the base spec's "Structural changes" line, for items only | Task 7 |
| Out of scope (public display or voting of pending items, editing existing items, descriptions, images, rate limiting, changes to result reports) | Not implemented; the Global Constraints and the `/pending` test guard it |
