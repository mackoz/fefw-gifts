# Consolidate the Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut about 800 lines of repetition from `test/` without losing any coverage, and add tests for three invariants that nothing checks today.

**Architecture:** Four tasks.
1. Move repeated fixture literals into shared builders in `test-support/fixtures.mjs`.
2. Delete or fold the tests that fully duplicate another test.
3. Turn near-identical tests in `test/views.test.mjs` into tables, one `test()` per row, with the test names kept exactly.
4. Add tests for three invariants: `worker/schema.sql` has no identifying columns, Worker requests carry no telemetry id, and every module is Node-importable.

Files stay where they are. Nothing is merged across files.

**Tech Stack:** Node's built-in `node:test` and `node:assert/strict`, ESM. No dependencies.

**Spec:** This plan. It is based on a read-only audit of `test/` done on master `bf5c5b6`.

## Global Constraints

- **No dependencies, ever.** `package.json` has no `dependencies` and no `devDependencies`, only scripts.
- **No production code changes.** Only files under `test/`, the new `test-support/fixtures.mjs`, and the new test files are touched. If a new test fails because production code violates an invariant, do not fix the code: stop and report it.
- **Shared helpers must not live under `test/`.** `node --test` treats every `.mjs` under a `test/` directory as a test file. Helpers go in `test-support/`, following the existing `worker/test-support/fake-d1.mjs`.
- **Test names are the contract.** Every test name in the baseline must still exist after Tasks 1 and 3, spelled exactly the same. Task 2 removes only the names it lists, and Task 4 only adds names. A table-driven test must produce exactly the name the old test had.
- **One `test()` per table row.** Never assert a whole table inside a single `test()`: failures must name the case.
- **Keep the comments.** Many tests carry comments naming the invariant or the bug they caught. Move each comment with its case, above that row in the table.
- **Tests that guard invariants are not weakened.** The invariants are listed in `CLAUDE.md`. The tests below guard them. Their assertions may only be moved, never dropped or loosened, and their names must not change. Line numbers are as of `bf5c5b6`; find each test by its name.
  - No tally from /pending: worker-reports:43, worker-public:108 and :134, worker-items:128, votes:62, assets:178, ingest:27.
  - A pending report never confirms, contributes a reaction or gives a negative verdict: confidence:116–146; data:94; views:292, 312, 325, 489, 615, 831, 1498, 1518; weave:39; filters:37 and :42.
  - An unmatched pair is never a dislike: views:55 (including its branch pin), 292, 352, 897, 1741; confidence:9 and :38; weave:33.
  - No personal data: validate:39, 556, 567; ingest:27; worker-turnstile:40; worker-items:60 and :86; report-form:614.
  - Telemetry: telemetry:50, 54, 106, 139, 181, 214, 228, 248–272; report-form:588 and :614; assets:178 and :189.
  - Worker null or failing: api:25, 40, 60, 127; views:319, 1647 (and 1674, its non-vacuity check), 2150; assets:82; confidence:144; review:452.
- **Commit messages** are one plain sentence, sentence case, with no `feat:`-style prefix. For example: "Share test fixture builders across test files".
- **Before every commit:** `npm test` and `npm run validate` both pass with no stray warnings.

## Verification commands (used by every task)

Test-name snapshot, compared against the baseline in `$BASE`:

```bash
node --test --test-reporter=tap 2>/dev/null | grep -E '^ *(not )?ok [0-9]+ - ' \
  | sed -E 's/^ *(not )?ok [0-9]+ - //; s/ # .*$//' | sort > /tmp/names-now.txt
diff "$BASE/names-before.txt" /tmp/names-now.txt
```

`$BASE` is a local scratch directory holding `names-before.txt` (653 names) and `coverage-before.txt` (93.10% of lines across all files), both captured at `bf5c5b6` and not committed.

Coverage, which must not fall for any file in `assets/`, `scripts/` or `worker/`:

```bash
node --test --experimental-test-coverage 2>&1 | grep -E '^ℹ .*\|' | grep -v 'test/'
```

---

### Task 1: Shared fixture builders

**Files:**
- Create: `test-support/fixtures.mjs`
- Modify: `test/confidence.test.mjs`, `test/validate.test.mjs`, `test/data.test.mjs`, `test/ingest.test.mjs`, `test/weave.test.mjs`, `test/views.test.mjs`

**Interfaces:**
- Produces: `category(over)`, `gift(over)`, `character(over)`, `observation(over)`, `source(over)` and `dataset(over)`, all exported from `test-support/fixtures.mjs`. Each returns a **new** object on every call, with any `over` fields merged over the defaults.

What these files repeat today:
- The full character literal appears 18 times: 3 in data, 2 in ingest, 1 in validate, 3 in weave and 9 in views.
- The category literal appears 34 times and the gift literal 52 times.
- There are three separate `character()` builders: `confidence.test.mjs:6`, `validate.test.mjs:81`, and `testedCharacter` at `views.test.mjs:389`.
- The Polygon source literal `{ id: 'polygon-1', … publisher: 'Polygon' … }` appears 10 times in views.

- [ ] **Step 1: Create `test-support/fixtures.mjs`**

```js
// Builders for the dataset shapes the tests share. Each call returns a fresh
// object, because tests mutate what they build; pass overrides for anything a
// test depends on rather than relying on a default staying put.

export const category = (over = {}) => ({
  id: 'books', label: 'Books', inGameDescriptor: null, aliases: [], ...over,
});

export const gift = (over = {}) => ({
  id: 'g1', name: 'G', category: 'books', rarity: 'common', description: '', sources: [], ...over,
});

export const character = (over = {}) => ({
  id: 'c1', name: 'C', giftable: true, spoiler: false,
  traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null, ...over,
});

export const observation = (over = {}) => ({
  id: 'o1', gift: 'g1', character: 'c1', reaction: 'liked', date: '2026-09-20', ...over,
});

// The guide source most fixtures cite.
export const source = (over = {}) => ({
  id: 'polygon-1', title: '', author: null, publisher: 'Polygon', url: '', retrieved: '2026-09-20', ...over,
});

export const dataset = (over = {}) => ({
  categories: [], gifts: [], characters: [], observations: [], sources: [], ...over,
});
```

- [ ] **Step 2: Replace the local builders and repeated literals, one file at a time**

Rules:
- Import from `'../test-support/fixtures.mjs'`.
- A builder call must produce an object **deep-equal to the literal it replaces**. Pass overrides for every field that differs, for example `character({ id: 'p1' })` in place of `testedCharacter()`, or `gift({ rarity: 'rare' })`.
- One difference is allowed: the shared builder may add keys the old local builder lacked (for example, confidence's `gift` had no `description` or `sources`). This is allowed only where the code under test ignores those keys, and **never** in `validate.test.mjs` or `ingest.test.mjs`, which test shapes.
- Leave a literal alone if it is deliberately malformed or unusual. Validate tests that build broken shapes keep their literals.
- Keep every fixture value a test relies on. `views.test.mjs` relies on the chamomile gift staying `rarity: 'common'` (see the comment above "categoryChips does not promote a category on a FAVORITE observation, even on a common gift"), and on mixedBase's `uncommon`.
- Delete the local `character`, `gift`, `obs` and `testedCharacter` builders once nothing uses them. If a file still needs a local variant, define it as a one-line wrapper around the shared builder.

- [ ] **Step 3: Verify**

Run `npm test`. Expected: 653 pass, 0 fail.
Run the name snapshot diff. Expected: **no output** (names unchanged).
Run coverage. Expected: no file's line coverage lower than in `coverage-before.txt`.
Run `npm run validate`. Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add test-support/fixtures.mjs test/
git commit -m "Share test fixture builders across test files"
```

---

### Task 2: Delete or fold duplicate tests

**Files:**
- Modify: `test/validate.test.mjs`, `test/views.test.mjs`, `test/worker-items.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. Later tasks rely only on the test names removed here being gone.

Handle each duplicate as listed. For every **fold**, first check which assertions the removed test makes that the surviving test does not, and copy those into the surviving test. Only then delete the removed test.

| Remove | Keep | Action |
|---|---|---|
| `a character with no traits key is rejected` (validate) | the `a character whose traits is ${label} is reported` loop, whose `'a missing key'` row covers it | delete |
| `an observation with no id is rejected` (validate) | the `a ${name} element whose id is ${label} is rejected` BAD_IDS loop | delete only if the loop really has an observation row with a missing id; otherwise leave it and say so in your report |
| `every gift appears when no filter is applied` (views) | `favorites sort above predictions, which sort above untested`, which already asserts all 3 ids | delete |
| `sortByConfidence is stable for equal states` (views) | `sortByConfidence keeps original order for ties within the same reaction` | fold, then delete |
| `signalHeading never claims knowledge over a table of pure guesswork` (views) | `signalHeading does not call a refuted-category prediction "worth trying"` and `signalHeading returns "Awaiting review" for a pending-only table, but "What we know" once something is observed` | fold any assertion missing from those two, then delete |
| the liked/loved cases inside `characterSummary falls back through loved, tested, predicted, then nothing` (views) | `characterSummary reports a liked, slight or neutral-reaction confirmation as "tested", never "loved"` | remove only the repeated cases; the test itself stays |
| `reportChip carries the report-button class and both dataset ids` (views) | `reportButton and reportChip both emit the .report-button class app.js closes on` | move the aria-label assertion into the kept test, then delete |
| `listPending never reads item_reports` (worker-items) | `GET /pending issues exactly one statement, against reports only` | fold every assertion, then delete. Both guard `/pending`, and the kept test must end up at least as strict as both were. |

- [ ] **Step 1: Make each change in the table.**
- [ ] **Step 2: Verify**

Run `npm test`. Expected: 0 fail, and fewer tests than 653 by exactly the number of names you removed.
Run the name snapshot diff. Expected: only `<` lines, and exactly the names removed above.
Run coverage. Expected: no file's line coverage lower than before.
Run `npm run validate`. Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add test/
git commit -m "Remove tests that repeat another test's assertions"
```

---

### Task 3: Turn near-identical `views.test.mjs` tests into tables

**Files:**
- Modify: `test/views.test.mjs`

**Interfaces:**
- Consumes: the builders from `test-support/fixtures.mjs` (Task 1).
- Produces: nothing new.

Groups to convert (find them by name):
1. **`provenanceNote`**: the 22 tests named `provenanceNote: …`, starting at `provenanceNote: guide-only, one publisher`. They differ only in the chips passed in and the expected string.
2. **`categoryChips` cases that produce no chip**:
   - `categoryChips does not promote a category on a FAVORITE observation, even on a common gift`
   - `a CONFIRMED "none" reaction never counts as tested`
   - `a slight reaction does not count as confirmed`
   - `a liked reaction does not count as confirmed`
   - `a gift with no category is never promoted, even with an approved loved result`
   - `a contested pair never counts as tested`
   - `a pending report never counts as tested`
3. **Loved plus another result stays confirmed**:
   - `loved plus favorite in the same category stays confirmed, not mixed`
   - `loved plus a pending report in the same category stays confirmed`
   - `loved plus a contested pair in the same category stays confirmed`
   - `loved plus an untested gift in the same category stays confirmed`
   - `an unrecognised CONFIRMED reaction is neither loved nor below-loved`, but only if it fits the same shape; otherwise leave it
4. **`characterSummary` string-equality tests**: the roughly 12 tests between `characterSummary reports the strongest true thing, never a negative` and the end of the `characterSummary reports contested and pending results rather than silence` group. Convert only the ones that build an index and compare one string.
5. **Render boilerplate**: about 21 tests repeat `fakeElement('div')` followed by a render call and a lookup. Add one local `renderView(render, model)` helper in `views.test.mjs` that returns the container, and use it.

Pattern (keep each test's name exactly as it was):

```js
for (const { name, chips, expected } of [
  // A comment that sat above the old test goes above its row.
  { name: 'guide-only, one publisher', chips: [/* … */], expected: '…' },
  // …
]) {
  test(`provenanceNote: ${name}`, () => {
    assert.equal(provenanceNote(chips /* , … as the originals called it */), expected);
  });
}
```

If a case in a group needs setup or assertions the others don't, leave it as its own `test()`. Don't bend the table to fit it.

- [ ] **Step 1: Convert group 1, then run `npm test` and the name diff.** Expected: 0 fail, no diff output.
- [ ] **Step 2: Convert groups 2 and 3, then run the same checks.** Expected: 0 fail, no diff output.
- [ ] **Step 3: Convert group 4, then run the same checks.** Expected: 0 fail, no diff output.
- [ ] **Step 4: Add `renderView` for group 5, then run the same checks.** Expected: 0 fail, no diff output.
- [ ] **Step 5: Run coverage and `npm run validate`.** Expected: coverage no lower than before; validate passes. Report `wc -l test/views.test.mjs` before and after.
- [ ] **Step 6: Commit**

```bash
git add test/views.test.mjs
git commit -m "Table-drive the repetitive view tests"
```

---

### Task 4: Test the three unguarded invariants

**Files:**
- Create: `test/schema.test.mjs`, `test/importable.test.mjs`
- Modify: `test/api.test.mjs` (add one test at the end; `stubFetch` and `ok` already exist at the top of the file)

**Interfaces:**
- Consumes: `createApi` from `assets/js/api.js`. Its methods are `fetchPending()`, `submitReport(report)`, `sendVote(vote)`, `submitItemReport(report)`, `fetchReview()`, `decide(id, decision)`, `fetchItemReview()` and `decideItem(id, body)`. It is created with `createApi({ baseUrl, token, fetchImpl })`.
- Produces: new tests only.

- [ ] **Step 1: Create `test/schema.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// CLAUDE.md: "The Worker collects no personal data." The schema comments say an
// identifying column is a design change; this makes adding one fail loudly.
const schema = await readFile(new URL('../worker/schema.sql', import.meta.url), 'utf8');

function columns(sql) {
  const body = sql.replace(/--.*$/gm, '');
  const found = [];
  for (const [, table, cols] of body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
    for (const line of cols.split(',')) {
      const m = line.trim().match(/^"?(\w+)"?/);
      if (m) found.push(`${table}.${m[1]}`);
    }
  }
  return found;
}

const COLUMNS = columns(schema);

// `item_reports.name` is the missing item's name, not a person's.
const IDENTIFYING = /(^|_)(ip|ips|email|user|username|reporter|submitter|voter|session|fingerprint|device|cookie|agent|ua|address|hash|hashed)(_|$)/i;

test('the schema parser finds the columns it should, so the check is not vacuous', () => {
  for (const known of ['reports.id', 'reports.character', 'reports.upvotes', 'item_reports.name', 'item_reports.approved']) {
    assert.ok(COLUMNS.includes(known), `missing ${known} from ${COLUMNS.join(', ')}`);
  }
});

test('no D1 column identifies a person', () => {
  for (const column of COLUMNS) {
    assert.doesNotMatch(column.split('.')[1], IDENTIFYING, column);
  }
});
```

- [ ] **Step 2: Add to the end of `test/api.test.mjs`**

```js
// CLAUDE.md: the telemetry id "is never attached to a report, a vote or a
// Worker request". report-form.test.mjs checks the payload keys; this checks
// the rest of every request api.js can send.
test('no Worker request carries a telemetry id, in its URL, headers or credentials', async () => {
  const fetchImpl = stubFetch(() => ok({ pending: [] }));
  const api = createApi({ baseUrl: 'https://worker.example', token: 'tok', fetchImpl });
  await api.fetchPending();
  await api.submitReport({ character: 'c1', gift: 'g1', reaction: 'loved' });
  await api.sendVote({ id: 'r1', direction: 'up' });
  await api.submitItemReport({ name: 'Lantern Oil' });
  await api.fetchReview();
  await api.decide('r1', 'approve');
  await api.fetchItemReview();
  await api.decideItem('i1', { decision: 'reject' });

  assert.equal(fetchImpl.calls.length, 8, 'every api method reached fetch');
  for (const { url, init } of fetchImpl.calls) {
    assert.equal(new URL(url).search, '', `${url} carries a query string`);
    for (const name of Object.keys(init.headers ?? {})) {
      assert.ok(['Content-Type', 'Authorization'].includes(name), `${url} sends header ${name}`);
    }
    assert.notEqual(init.credentials, 'include', `${url} sends cookies`);
  }
});

test('api.js never imports telemetry', async () => {
  const source = await readFile(new URL('../assets/js/api.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /telemetry/i);
});
```

Add `import { readFile } from 'node:fs/promises';` to the imports if it is not already there. If a method's argument shape is wrong for `createApi`, fix the arguments, not `api.js`.

- [ ] **Step 3: Create `test/importable.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

// CLAUDE.md: browser and Worker modules must be importable directly by
// node:test, with no top-level DOM access and no Cloudflare-only globals at
// module scope. Other test files import most modules for their own reasons;
// this imports every one on purpose, including those nothing else imports.
const ROOTS = ['assets/js', 'worker/src'];

// app.js is the browser entry point: it calls main() at load, which reaches
// the DOM and fetches data. assets.test.mjs checks it by source instead.
const ENTRY_POINTS = new Set(['assets/js/app.js']);

const MODULES = [];
for (const root of ROOTS) {
  for (const entry of await readdir(new URL(`../${root}/`, import.meta.url), { recursive: true })) {
    if (entry.endsWith('.js')) MODULES.push(`${root}/${entry}`);
  }
}
MODULES.sort();

test('the importability check sees every module, so it is not vacuous', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'no DOM stub is installed');
  for (const known of ['assets/js/views/shared.js', 'assets/js/api.js', 'worker/src/index.js', 'worker/src/router.js']) {
    assert.ok(MODULES.includes(known), `missing ${known}`);
  }
});

for (const path of MODULES.filter((p) => !ENTRY_POINTS.has(p))) {
  test(`${path} imports under plain Node`, async () => {
    await import(new URL(`../${path}`, import.meta.url));
  });
}
```

- [ ] **Step 4: Run the new tests**

```bash
node --test test/schema.test.mjs test/importable.test.mjs test/api.test.mjs
```

Expected: all pass. If any import test or the schema test fails, **stop**. Do not change production code, and report the failing module or column with its error: it is an invariant violation for the maintainer to decide on.

- [ ] **Step 5: Full verification**

Run `npm test`. Expected: 0 fail.
Run the name snapshot diff. Expected: only `>` lines, and only the new names.
Run `npm run validate`. Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add test/schema.test.mjs test/importable.test.mjs test/api.test.mjs
git commit -m "Test the schema, Worker requests and module imports against the privacy and importability invariants"
```

## Outcome

- **Result:** 653 tests became 679. 7 duplicates were removed and 33 tests added, all passing. Per-file line coverage is no lower than at baseline, and every baseline test name survives except the 7 removed.
- **Lines:** existing test files shrank by about 170 lines, not the 800 estimated. Most of the repetition was data, comments and expected strings, which tables can't remove. Counting the new tests and fixtures, net test code fell by about 30 lines.
- **Task 2 deviation:** the liked/loved cases in "characterSummary falls back through loved, tested, predicted, then nothing" were kept, not removed. They alone prove that tested and loved outrank a live prediction. The PREDICTED tie case from the removed stability test was folded into the kept one.
- **Task 3 deviation:** `renderView` takes `(render, idx, state)`, following the existing render calls. A `tested()` wrapper replaces the repeated `character({ id: 'p1', name: 'P', ... })` calls.
- **Task 4 deviations:**
  - The schema parser is case-insensitive and accepts any `CREATE ... TABLE` form.
  - Two extra schema tests fail on any `ALTER TABLE`, and on a `CREATE TABLE` count that differs from the parsed table count.
  - The header check normalises through `new Headers(...)`.
  - The code blocks above show the original plan, not the final code.
- **Follow-ups not done:**
  - Pin the schema's exact column set instead of a denylist.
  - Pin the vote payload's key set in app.js, which is where a telemetry id could actually leak (`api.sendVote({ ...vote, turnstileToken })`).
  - Adopt the `observation` and `dataset` builders in views and weave.
  - Decide whether CLAUDE.md should name `assets/js/app.js` as the entry point exempt from the no-top-level-DOM rule.
