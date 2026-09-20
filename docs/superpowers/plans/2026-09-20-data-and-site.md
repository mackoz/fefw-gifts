# Fortune's Weave Gift Guide — Data & Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable GitHub Pages site that renders category-level gift predictions and item-level confirmations for Fire Emblem: Fortune's Weave, backed by validated JSON in the repo.

**Architecture:** Five hand-editable JSON files under `data/` are the single source of truth. A pure function derives a confidence state for every (character, gift) pair from those files. Four views render that derivation. No build step: browser ES modules load the JSON at runtime, and the same modules are imported directly by `node:test`.

**Tech Stack:** Vanilla HTML/CSS/JavaScript (ES modules), Node 26 built-in test runner (`node:test`), GitHub Actions for validation, GitHub Pages for hosting. Zero runtime and zero test dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md`

## Global Constraints

- **No dependencies.** `package.json` declares `"type": "module"` and scripts only. No `dependencies`, no `devDependencies`. If a task seems to need a package, stop and ask.
- **No build step.** Files are served exactly as committed. GitHub Pages deploys from the branch root.
- **Node 26+** for `node:test`. Run tests with `npm test`, validation with `npm run validate`.
- **Browser modules must be importable by Node.** Every file under `assets/js/` uses ESM `export`, contains no top-level DOM access, and is importable in a test. DOM access lives inside functions that receive their elements as arguments.
- **Absence of a match is never a dislike.** Only an observation may produce a negative. Any code path that renders a mismatch as "dislikes" is a bug.
- **No artwork.** Character and item names only. Never reference or embed Nintendo image assets.
- **Anonymity.** `data/observations.json` entries carry no reporter, name, email, IP, or any other identifying field. The validator enforces this.
- **Item-level results are never seeded.** `data/observations.json` ships empty (`[]`). Only real player reports populate it.
- **Guide-derived data is always marked.** Any character-category link imported from a published guide has `state: "guide"` and a non-null `source` that exists in `data/sources.json`.
- Reaction tiers are exactly: `none`, `slight`, `liked`, `loved`, `favorite`.
- Rarity tiers are exactly: `common`, `uncommon`, `rare` (or `null` when not yet recorded).

---

### Task 1: Repo scaffolding, category vocabulary, and the validator core

**Files:**
- Create: `package.json`, `.nojekyll`, `.gitignore`, `LICENSE`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- Create: `data/categories.json`, `data/sources.json`, `data/observations.json`
- Create: `scripts/validate.mjs`
- Test: `test/validate.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `validate(dataset) -> {errors: string[]}` exported from `scripts/validate.mjs`, where `dataset` is `{categories, gifts, characters, observations, sources}`. Every later task adds rules to this same function and asserts through this same signature. Also produces `loadDataset(dir) -> Promise<dataset>` from the same module.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fefw-gifts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Community gift guide for Fire Emblem: Fortune's Weave",
  "scripts": {
    "test": "node --test test/",
    "validate": "node scripts/validate.mjs data"
  }
}
```

- [ ] **Step 2: Create supporting repo files**

`.nojekyll` — empty file. Required or GitHub Pages will ignore paths beginning with an underscore and run Jekyll needlessly.

`.gitignore`:
```
node_modules/
.DS_Store
*.log
.wrangler/
```

`LICENSE` — MIT, copyright holder "fefw-gifts contributors", year 2026.

- [ ] **Step 3: Create `data/categories.json`**

The closed vocabulary. `inGameDescriptor` is the phrase that appears in item text where known, otherwise `null`.

```json
[
  { "id": "fashion",          "label": "Fashion",          "inGameDescriptor": null, "aliases": ["clothing", "jewellery", "jewelry", "gemstones"] },
  { "id": "beauty",           "label": "Beauty",           "inGameDescriptor": "those who appreciate beauty", "aliases": ["paintings", "art"] },
  { "id": "flowers",          "label": "Flowers",          "inGameDescriptor": null, "aliases": ["bouquets"] },
  { "id": "cooking",          "label": "Cooking",          "inGameDescriptor": "people who love to cook", "aliases": ["cookbooks", "food"] },
  { "id": "fermented-drinks", "label": "Fermented drinks", "inGameDescriptor": null, "aliases": ["ghosh", "shosh", "booze", "alcohol"] },
  { "id": "beverages",        "label": "Beverages",        "inGameDescriptor": null, "aliases": ["tea", "milk", "cervi"] },
  { "id": "coffee",           "label": "Coffee",           "inGameDescriptor": null, "aliases": [] },
  { "id": "training",         "label": "Training",         "inGameDescriptor": "training enthusiasts", "aliases": ["exercise"] },
  { "id": "weapons",          "label": "Weapons",          "inGameDescriptor": null, "aliases": [] },
  { "id": "military",         "label": "Military",         "inGameDescriptor": null, "aliases": ["medals", "tactics"] },
  { "id": "horses",           "label": "Horses",           "inGameDescriptor": null, "aliases": ["steeds", "mounts"] },
  { "id": "books",            "label": "Books",            "inGameDescriptor": "book lovers", "aliases": ["reading", "poetry"] },
  { "id": "board-games",      "label": "Board games",      "inGameDescriptor": null, "aliases": [] },
  { "id": "vegetables",       "label": "Vegetables",       "inGameDescriptor": null, "aliases": ["seeds", "bulbs"] },
  { "id": "crafting",         "label": "Crafting",         "inGameDescriptor": null, "aliases": ["sewing", "carving"] },
  { "id": "fishing",          "label": "Fishing",          "inGameDescriptor": null, "aliases": [] },
  { "id": "archery",          "label": "Archery",          "inGameDescriptor": null, "aliases": ["bows", "arrows"] },
  { "id": "agriculture",      "label": "Agriculture",      "inGameDescriptor": null, "aliases": ["farming"] },
  { "id": "travel",           "label": "Travel",           "inGameDescriptor": null, "aliases": ["rucksacks"] },
  { "id": "spicy-foods",      "label": "Spicy foods",      "inGameDescriptor": null, "aliases": ["seasonings"] }
]
```

- [ ] **Step 4: Create `data/sources.json` and `data/observations.json`**

`data/sources.json`:
```json
[
  {
    "id": "polygon-2026-09-17",
    "title": "Best gifts for each character in Fire Emblem: Fortune's Weave",
    "author": "Josh Broadwell",
    "publisher": "Polygon",
    "url": "https://www.polygon.com/fire-emblem-fortunes-weave-best-gifts-each-character/",
    "retrieved": "2026-09-20"
  },
  {
    "id": "game8-items",
    "title": "List of All Items",
    "author": null,
    "publisher": "Game8",
    "url": "https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/621281",
    "retrieved": "2026-09-20"
  }
]
```

`data/observations.json` ships empty. This is deliberate — item-level results are never seeded:
```json
[]
```

- [ ] **Step 5: Write the failing test**

Create `test/validate.test.mjs`:

```js
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/validate.mjs'`

- [ ] **Step 7: Write `scripts/validate.mjs`**

```js
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FILES = ['categories', 'gifts', 'characters', 'observations', 'sources'];

// Fields that would identify a contributor. Observations are anonymous by design;
// see the spec's "Anonymity and abuse" section.
const FORBIDDEN_OBSERVATION_FIELDS = ['reporter', 'name', 'email', 'ip', 'user', 'author', 'submitter'];

export async function loadDataset(dir) {
  const entries = await Promise.all(
    FILES.map(async (name) => [name, JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'))]),
  );
  return Object.fromEntries(entries);
}

function checkDuplicates(items, kind, errors) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`duplicate ${kind} id: ${item.id}`);
    seen.add(item.id);
  }
}

export function validate(dataset) {
  const errors = [];
  const { categories, sources, observations } = dataset;

  checkDuplicates(categories, 'category', errors);
  checkDuplicates(sources, 'source', errors);

  for (const c of categories) {
    if (!c.label) errors.push(`category ${c.id}: missing label`);
    if (!Array.isArray(c.aliases)) errors.push(`category ${c.id}: aliases must be an array`);
  }

  for (const o of observations) {
    for (const field of FORBIDDEN_OBSERVATION_FIELDS) {
      if (field in o) errors.push(`observation ${o.id}: forbidden identifying field: ${field}`);
    }
  }

  return { errors };
}

// CLI entry point: `npm run validate`
if (import.meta.filename === process.argv[1]) {
  const dir = process.argv[2] ?? 'data';
  const { errors } = validate(await loadDataset(dir));
  if (errors.length) {
    console.error(`${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('data valid');
}
```

- [ ] **Step 8: Run tests and validation**

Run: `npm test`
Expected: PASS, 5 tests.

Run: `npm run validate`
Expected: `data valid`, exit 0.

- [ ] **Step 9: Write `README.md`, `CLAUDE.md` and `CONTRIBUTING.md`**

`README.md` covers: what the site is, the guess-versus-confirmed distinction, the live URL `https://mackoz.github.io/fefw-gifts/`, how to run tests and validation locally, the data file layout, and a **Sources** section crediting every entry in `data/sources.json` by title, author and publisher.

`CLAUDE.md` covers, for future agent sessions: no dependencies and no build step ever; browser modules must stay Node-importable; absence of a match is never a dislike; observations are anonymous and never seeded; guide-derived links always carry `state: "guide"` and a source; run `npm test` and `npm run validate` before committing.

`CONTRIBUTING.md` covers: how to report a gift result once the form exists, and how to open an issue or PR for structural changes (new category, wrong rarity, wrong trait).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add repo scaffolding, category vocabulary and validator core"
```

---

### Task 2: Gift catalogue

**Files:**
- Create: `data/gifts.json`
- Modify: `scripts/validate.mjs`
- Modify: `test/validate.test.mjs`

**Interfaces:**
- Consumes: `validate(dataset)` and the category ids from Task 1.
- Produces: `data/gifts.json`, an array of `{id, name, category, rarity, description, sources}` where `category` is a category id or `null`, and `rarity` is `"common" | "uncommon" | "rare" | null`. Later tasks index gifts by `id`.

- [ ] **Step 1: Write the failing test**

Append to `test/validate.test.mjs`:

```js
test('a gift referencing an unknown category is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'nope', rarity: 'common', description: '', sources: [] });
  const { errors } = validate(d);
  assert.match(errors[0], /gift g1: unknown category: nope/);
});

test('a gift with a null category is allowed as not yet recorded', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: null, rarity: null, description: '', sources: [] });
  assert.deepEqual(validate(d).errors, []);
});

test('an invalid rarity is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: 'legendary', description: '', sources: [] });
  const { errors } = validate(d);
  assert.match(errors[0], /gift g1: invalid rarity: legendary/);
});

test('a gift referencing an unknown source is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: 'rare', description: '', sources: ['ghost'] });
  const { errors } = validate(d);
  assert.match(errors[0], /gift g1: unknown source: ghost/);
});

test('duplicate gift ids are rejected', () => {
  const d = base();
  const g = { id: 'g1', name: 'G', category: 'books', rarity: 'rare', description: '', sources: [] };
  d.gifts.push(g, { ...g, name: 'G2' });
  const { errors } = validate(d);
  assert.ok(errors.some((e) => /duplicate gift id: g1/.test(e)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — the new gift assertions fail because no gift rules exist yet.

- [ ] **Step 3: Add gift rules to `scripts/validate.mjs`**

First, declare these three lookups immediately after `const errors = [];` at the top of `validate`, so Task 3 can reuse them:

```js
  const RARITIES = new Set(['common', 'uncommon', 'rare']);
  const categoryIds = new Set(categories.map((c) => c.id));
  const sourceIds = new Set(sources.map((s) => s.id));
```

Then add this block after the existing category loop and before the `return`:

```js
  checkDuplicates(dataset.gifts, 'gift', errors);

  for (const g of dataset.gifts) {
    if (!g.name) errors.push(`gift ${g.id}: missing name`);
    if (g.category !== null && !categoryIds.has(g.category)) {
      errors.push(`gift ${g.id}: unknown category: ${g.category}`);
    }
    if (g.rarity !== null && !RARITIES.has(g.rarity)) {
      errors.push(`gift ${g.id}: invalid rarity: ${g.rarity}`);
    }
    for (const s of g.sources ?? []) {
      if (!sourceIds.has(s)) errors.push(`gift ${g.id}: unknown source: ${s}`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 10 tests.

- [ ] **Step 5: Create `data/gifts.json`**

Use these item names, sourced from the Game8 item list. Generate ids by lowercasing and hyphenating the name.

```
Yarc Milk, Ginji Cervi, Rustic Ghosh, Strategy Manuscript, Wing Fletching,
Strong Cervi, Southern Ghosh, Home-Recipe Book, Rare Spices, Kitten Figurine,
Flexible Fishing Rod, Honey Milk, Eastern Black Silk, Jamel Milk, Mane Ornament,
Red-Rose Bouquet, Potted Vegetables, Pastry Cookbook, Protection Figurine,
The Works of Dante, Eastern Love Story, Training Weights, Weak Cervi,
Young Ghosh, Young Shosh, Mature Shosh, Village Recipes, Sturdy Rucksack,
Trader's Handbook, Full Sewing Kit, Gaudy Bangle, Pack of Pastels, Fodlan Tea,
Dual Fish Knives, Skin Balm, Exquisite Ring, Simple Pastries, Mellow Pastries,
Coffee Pastries, Saraminian Sweets, Garum, Alecto Garum, Sun Ghosh,
Energizing Ghosh, Secret Ghosh, Aromatic Shosh, Common Coffee, Select Coffee,
Southern Coffee, Huge Fish Eyeball, Shield Portrait, Tales of Adventure,
Herbal Recipe Guide, Sharp Fishhook, Mature Ghosh, Light Shosh, Jade Ghosh,
Pickled Vegetables, Strong Seasonings, Dagda Beard Grass, Training Bracelet,
Mature Dried Cervi, Volcano Ghosh, Orgus Coffee, Fragrant Pastries,
Candy Crystals, Rancid Garum, Blue Shosh, Solomon Coffee, Brined Fish Guts,
Rare Southern Seeds, Outdoor Cooking Set, Morfis Tea, Horse-Grooming Kit,
Crafting Knives, Joint-Relief Gloves, Decorative Arrows, Eastern Board Games,
Blue-Rose Bouquet, Portrait of Yu Phas
```

Note: the source list contains both "Candly Crystals" and "Candy Crystals". These are the same item; the first is a typo. Include it once as `candy-crystals`.

Set `category` **only where the item name makes it unambiguous** — `Common Coffee` is `coffee`, `Sharp Fishhook` is `fishing`, `Blue-Rose Bouquet` is `flowers`, `Training Weights` is `training`, `Decorative Arrows` is `archery`, `Horse-Grooming Kit` is `horses`, `Eastern Board Games` is `board-games`. **Set `category: null` wherever there is any doubt.** A wrong tag silently corrupts every prediction downstream; `null` simply renders as untested and asks a contributor to fill it in. Prefer `null`.

Set `rarity: null` for every item. Rarity is an in-game icon distinction that cannot be inferred from a name, and guessing it would be fabrication.

Set `sources: ["game8-items"]` on every item, and `description: ""`.

- [ ] **Step 6: Run validation**

Run: `npm run validate`
Expected: `data valid`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add data/gifts.json scripts/validate.mjs test/validate.test.mjs
git commit -m "Add gift catalogue and gift validation rules"
```

---

### Task 3: Character roster and seeded predictions

**Files:**
- Create: `data/characters.json`
- Modify: `scripts/validate.mjs`
- Modify: `test/validate.test.mjs`

**Interfaces:**
- Consumes: `validate(dataset)`, category ids, source ids, gift ids.
- Produces: `data/characters.json`, an array of `{id, name, giftable, spoiler, traits, categories, rarityPreference, favorites, notes}`. `categories` maps a category id to `{state, source}`. `traits` is an array of `{text, category}` where `category` may be `null` for flavor traits.

- [ ] **Step 1: Write the failing test**

Append to `test/validate.test.mjs`:

```js
const character = (over = {}) => ({
  id: 'c1', name: 'C', giftable: true, spoiler: false,
  traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null, ...over,
});

test('a character category link with an unknown category is rejected', () => {
  const d = base();
  d.characters.push(character({ categories: { nope: { state: 'profile', source: null } } }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: unknown category: nope/);
});

test('a guide-state link without a source is rejected', () => {
  const d = base();
  d.characters.push(character({ categories: { books: { state: 'guide', source: null } } }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: category books has state "guide" but no source/);
});

test('an invalid link state is rejected', () => {
  const d = base();
  d.characters.push(character({ categories: { books: { state: 'maybe', source: null } } }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: invalid state for books: maybe/);
});

test('a trait may name a valid category or be explicitly null', () => {
  const d = base();
  d.characters.push(character({ traits: [{ text: 'poetry', category: 'books' }, { text: 'his little sister', category: null }] }));
  assert.deepEqual(validate(d).errors, []);
});

test('a trait naming an unknown category is rejected', () => {
  const d = base();
  d.characters.push(character({ traits: [{ text: 'x', category: 'nope' }] }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: trait "x" names unknown category: nope/);
});

test('a favorite referencing an unknown gift is rejected', () => {
  const d = base();
  d.characters.push(character({ favorites: ['ghost-gift'] }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: unknown favorite gift: ghost-gift/);
});

test('an invalid rarityPreference is rejected', () => {
  const d = base();
  d.characters.push(character({ rarityPreference: 'shiny' }));
  const { errors } = validate(d);
  assert.match(errors[0], /character c1: invalid rarityPreference: shiny/);
});

test('an observation against a non-giftable character is rejected', () => {
  const d = base();
  d.gifts.push({ id: 'g1', name: 'G', category: 'books', rarity: null, description: '', sources: [] });
  d.characters.push(character({ giftable: false }));
  d.observations.push({ id: 'o1', gift: 'g1', character: 'c1', reaction: 'liked', points: null, date: '2026-09-20' });
  const { errors } = validate(d);
  assert.match(errors[0], /observation o1: character c1 is not giftable/);
});

test('an observation with an unknown gift or invalid reaction is rejected', () => {
  const d = base();
  d.characters.push(character());
  d.observations.push({ id: 'o1', gift: 'ghost', character: 'c1', reaction: 'meh', points: null, date: '2026-09-20' });
  const { errors } = validate(d);
  assert.ok(errors.some((e) => /observation o1: unknown gift: ghost/.test(e)));
  assert.ok(errors.some((e) => /observation o1: invalid reaction: meh/.test(e)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — the character and observation assertions fail.

- [ ] **Step 3: Add character and observation rules to `scripts/validate.mjs`**

Append this block after the gift loop from Task 2 and before the existing
forbidden-field loop, which stays exactly as it is:

```js
  const STATES = new Set(['guide', 'profile', 'discovered', 'refuted']);
  const RARITY_PREFS = new Set(['any', 'uncommon-plus', 'rare']);
  const REACTIONS = new Set(['none', 'slight', 'liked', 'loved', 'favorite']);
  const giftIds = new Set(dataset.gifts.map((g) => g.id));

  checkDuplicates(dataset.characters, 'character', errors);

  for (const ch of dataset.characters) {
    if (!ch.name) errors.push(`character ${ch.id}: missing name`);

    for (const [catId, link] of Object.entries(ch.categories ?? {})) {
      if (!categoryIds.has(catId)) errors.push(`character ${ch.id}: unknown category: ${catId}`);
      if (!STATES.has(link.state)) errors.push(`character ${ch.id}: invalid state for ${catId}: ${link.state}`);
      // Guide-derived links must always be attributable, so they can be audited or removed wholesale.
      if (link.state === 'guide' && !link.source) {
        errors.push(`character ${ch.id}: category ${catId} has state "guide" but no source`);
      }
      if (link.source && !sourceIds.has(link.source)) {
        errors.push(`character ${ch.id}: unknown source: ${link.source}`);
      }
    }

    for (const t of ch.traits ?? []) {
      if (t.category !== null && !categoryIds.has(t.category)) {
        errors.push(`character ${ch.id}: trait "${t.text}" names unknown category: ${t.category}`);
      }
    }

    for (const f of ch.favorites ?? []) {
      if (!giftIds.has(f)) errors.push(`character ${ch.id}: unknown favorite gift: ${f}`);
    }

    if (ch.rarityPreference !== null && !RARITY_PREFS.has(ch.rarityPreference)) {
      errors.push(`character ${ch.id}: invalid rarityPreference: ${ch.rarityPreference}`);
    }
  }

  const charById = new Map(dataset.characters.map((c) => [c.id, c]));
  checkDuplicates(observations, 'observation', errors);

  for (const o of observations) {
    if (!giftIds.has(o.gift)) errors.push(`observation ${o.id}: unknown gift: ${o.gift}`);
    const ch = charById.get(o.character);
    if (!ch) errors.push(`observation ${o.id}: unknown character: ${o.character}`);
    else if (!ch.giftable) errors.push(`observation ${o.id}: character ${o.character} is not giftable`);
    if (!REACTIONS.has(o.reaction)) errors.push(`observation ${o.id}: invalid reaction: ${o.reaction}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 19 tests.

- [ ] **Step 5: Create `data/characters.json`**

Roster, from the published character lists. Ids are lowercased, hyphenated names.

```
Alexandra, Anatolia, Anna, Aurora, Benditz, Bertrand, Bonaventure, Buccar, Cai,
Catania, Centurio, Creek, Dadao, Dante, Diego, Dietrich, Eshmel, Esmeralda,
Fabio, Fianna, Fortuna, Gaitz, Goliath, Guzran, Halvin, Hong Hua, Inyoni, Io,
Jasmine, Jester, Kalla, Kiroc, Leda, Lilian, Loretta, Ludia, Lysander, Majide,
Maria, Mars, Mikaela, Mu, Nathan, Nezha, Ninae, Noctula, Nuzzuo, Nydine,
Olympia, Orchel, Peppe, Peter, Raksha, Seteth, Sha Lan, Simon, Sirocco, Sofia,
Solel, Sothis, Talimun, The Lady of Lillies, Theodora, Tialla, Tobias, Troy,
Ultand, Ursula, Yang Jie, Zarcone
```

For each character set:
- `giftable: true` only for those the Polygon guide lists as receiving gifts. Set `false` for the rest (Fortuna, Raksha, Solel, Sothis, The Lady of Lillies and any other not listed there).
- `spoiler: false` for all. Spoiler marking needs someone who has finished the game; guessing would either spoil people or cry wolf. Leave it to a later contribution.
- `traits: []`. Profile traits are Phase 2 and must be read off the game, not copied from a guide.
- `rarityPreference: null`, except `"rare"` for Catania and `"uncommon-plus"` for Anatolia, which the Polygon guide states explicitly.
- `favorites: []` for everyone. These are the Favorites Hunt and are never seeded.
- `notes`: for Bertrand, `"In Act 1, only Cai can give Bertrand gifts."`; `null` otherwise.
- `categories`: seeded from the Polygon guide, every entry `{ "state": "guide", "source": "polygon-2026-09-17" }`.

Map the guide's prose to category ids. For example Dietrich's "pastries and other sweets, paintings, anything labeled for those who appreciate beauty" becomes `cooking` and `beauty`; Io's "horse items" becomes `horses`; Guzran's "fermented drinks (ghosh and shosh)" becomes `fermented-drinks`. Where the guide names a specific item rather than a category, record the category that item belongs to — **not** the item. Item-level claims are exactly what this project exists to confirm, so seeding them as fact is forbidden. Where the guide's wording does not map cleanly onto a category id, omit the link rather than inventing one.

- [ ] **Step 6: Run validation**

Run: `npm run validate`
Expected: `data valid`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add data/characters.json scripts/validate.mjs test/validate.test.mjs
git commit -m "Add character roster with guide-seeded category predictions"
```

---

### Task 4: Confidence derivation

**Files:**
- Create: `assets/js/confidence.js`
- Test: `test/confidence.test.mjs`

**Interfaces:**
- Consumes: the shapes from Tasks 1–3.
- Produces:
  - `RARITY_ORDER = { common: 0, uncommon: 1, rare: 2 }`
  - `POSITIVE_REACTIONS = ['slight', 'liked', 'loved', 'favorite']`
  - `deriveConfidence({ character, gift, observations }) -> Confidence`

`Confidence` is exactly:
```js
{
  state: 'FAVORITE' | 'CONFIRMED' | 'CONTESTED' | 'PREDICTED' | 'UNTESTED',
  reaction: 'none' | 'slight' | 'liked' | 'loved' | 'favorite' | null,
  points: number | null,
  predicted: 'positive' | 'negative' | null,
  provenance: 'guide' | 'profile' | 'discovered' | 'refuted' | null,
  source: string | null,
  isException: boolean,
  rarityMismatch: boolean,
  observationCount: number,
}
```

`observations` is only those for this exact (character, gift) pair. Every later view consumes this object and nothing else.

- [ ] **Step 1: Write the failing test**

Create `test/confidence.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveConfidence } from '../assets/js/confidence.js';

const gift = (over = {}) => ({ id: 'g1', name: 'G', category: 'books', rarity: 'common', ...over });
const character = (over = {}) => ({ id: 'c1', name: 'C', giftable: true, categories: {}, rarityPreference: null, favorites: [], ...over });
const obs = (over = {}) => ({ id: 'o1', gift: 'g1', character: 'c1', reaction: 'liked', points: null, date: '2026-09-20', ...over });

test('no link and no observation is untested', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [] });
  assert.equal(c.state, 'UNTESTED');
  assert.equal(c.predicted, null);
  assert.equal(c.observationCount, 0);
});

test('a profile link with no observation predicts positively and keeps its provenance', () => {
  const character_ = character({ categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [] });
  assert.equal(c.state, 'PREDICTED');
  assert.equal(c.predicted, 'positive');
  assert.equal(c.provenance, 'profile');
});

test('a guide link carries its source so the UI can shade it as weaker', () => {
  const character_ = character({ categories: { books: { state: 'guide', source: 'polygon-2026-09-17' } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [] });
  assert.equal(c.provenance, 'guide');
  assert.equal(c.source, 'polygon-2026-09-17');
});

test('a refuted link predicts negatively', () => {
  const character_ = character({ categories: { books: { state: 'refuted', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [] });
  assert.equal(c.state, 'PREDICTED');
  assert.equal(c.predicted, 'negative');
});

test('a gift with no category can never be predicted', () => {
  const character_ = character({ categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift({ category: null }), observations: [] });
  assert.equal(c.state, 'UNTESTED');
});

test('an observation confirms and reports its reaction and points', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'loved', points: 40 })] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.reaction, 'loved');
  assert.equal(c.points, 40);
  assert.equal(c.observationCount, 1);
});

test('a double-points reaction is a favorite', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'favorite' })] });
  assert.equal(c.state, 'FAVORITE');
});

test('disagreeing observations are contested, not silently resolved', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'loved' }), obs({ id: 'o2', reaction: 'none' })] });
  assert.equal(c.state, 'CONTESTED');
  assert.equal(c.observationCount, 2);
});

test('agreeing observations are not contested', () => {
  const c = deriveConfidence({ character: character(), gift: gift(), observations: [obs({ reaction: 'liked' }), obs({ id: 'o2', reaction: 'liked' })] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.observationCount, 2);
});

test('an observation contradicting a positive prediction is flagged as an exception', () => {
  const character_ = character({ categories: { horses: { state: 'guide', source: 'polygon-2026-09-17' } } });
  const c = deriveConfidence({ character: character_, gift: gift({ category: 'horses' }), observations: [obs({ reaction: 'none' })] });
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.reaction, 'none');
  assert.equal(c.isException, true);
});

test('an observation matching its prediction is not an exception', () => {
  const character_ = character({ categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [obs({ reaction: 'liked' })] });
  assert.equal(c.isException, false);
});

test('an off-profile like is an exception against a negative prediction', () => {
  const character_ = character({ categories: { books: { state: 'refuted', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift(), observations: [obs({ reaction: 'loved' })] });
  assert.equal(c.isException, true);
});

test('a rare-only character flags a common gift as a rarity mismatch', () => {
  const character_ = character({ rarityPreference: 'rare', categories: { books: { state: 'profile', source: null } } });
  const c = deriveConfidence({ character: character_, gift: gift({ rarity: 'common' }), observations: [] });
  assert.equal(c.rarityMismatch, true);
  assert.equal(c.predicted, 'positive', 'rarity is a hint, not a hard gate: it must not flip the prediction');
});

test('uncommon-plus accepts uncommon and rare but not common', () => {
  const c_ = (rarity) => deriveConfidence({
    character: character({ rarityPreference: 'uncommon-plus', categories: { books: { state: 'profile', source: null } } }),
    gift: gift({ rarity }), observations: [],
  }).rarityMismatch;
  assert.equal(c_('common'), true);
  assert.equal(c_('uncommon'), false);
  assert.equal(c_('rare'), false);
});

test('unknown rarity never reports a mismatch', () => {
  const character_ = character({ rarityPreference: 'rare' });
  const c = deriveConfidence({ character: character_, gift: gift({ rarity: null }), observations: [] });
  assert.equal(c.rarityMismatch, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/confidence.js'`

- [ ] **Step 3: Write `assets/js/confidence.js`**

```js
export const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2 };
export const POSITIVE_REACTIONS = ['slight', 'liked', 'loved', 'favorite'];

const MIN_RARITY = { 'uncommon-plus': 1, rare: 2 };

function polarityOf(reaction) {
  return POSITIVE_REACTIONS.includes(reaction) ? 'positive' : 'negative';
}

function rarityMismatches(character, gift) {
  const min = MIN_RARITY[character.rarityPreference];
  // No stated preference, or an unrecorded rarity: we cannot claim a mismatch.
  if (min === undefined || gift.rarity === null || gift.rarity === undefined) return false;
  return RARITY_ORDER[gift.rarity] < min;
}

export function deriveConfidence({ character, gift, observations }) {
  const link = gift.category ? character.categories?.[gift.category] ?? null : null;
  const predicted = link ? (link.state === 'refuted' ? 'negative' : 'positive') : null;

  const result = {
    state: 'UNTESTED',
    reaction: null,
    points: null,
    predicted,
    provenance: link?.state ?? null,
    source: link?.source ?? null,
    isException: false,
    rarityMismatch: rarityMismatches(character, gift),
    observationCount: observations.length,
  };

  if (observations.length === 0) {
    // A prediction exists only when a category link does. Absence of a link is
    // never a negative -- see the spec's "Pair confidence" section.
    if (link) result.state = 'PREDICTED';
    return result;
  }

  const reactions = new Set(observations.map((o) => o.reaction));
  if (reactions.size > 1) {
    result.state = 'CONTESTED';
    return result;
  }

  const [reaction] = reactions;
  const withPoints = observations.find((o) => o.points !== null && o.points !== undefined);

  result.reaction = reaction;
  result.points = withPoints?.points ?? null;
  result.state = reaction === 'favorite' ? 'FAVORITE' : 'CONFIRMED';
  result.isException = predicted !== null && polarityOf(reaction) !== predicted;

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 34 tests.

- [ ] **Step 5: Commit**

```bash
git add assets/js/confidence.js test/confidence.test.mjs
git commit -m "Add pair confidence derivation"
```

---

### Task 5: Dataset loading and indexing

**Files:**
- Create: `assets/js/data.js`
- Test: `test/data.test.mjs`

**Interfaces:**
- Consumes: `deriveConfidence` from Task 4.
- Produces:
  - `buildIndex(dataset) -> Index` where `Index` is `{characters, gifts, categories, sources, byCharacterId, byGiftId, byCategoryId, bySourceId, observationsFor(characterId, giftId), confidenceFor(characterId, giftId)}`
  - `fetchDataset(baseUrl = './data') -> Promise<dataset>` for browser use.

Views call `buildIndex` once and then only `confidenceFor`.

- [ ] **Step 1: Write the failing test**

Create `test/data.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { loadDataset } from '../scripts/validate.mjs';

const dataset = {
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [{ id: 'g1', name: 'Book', category: 'books', rarity: 'common', description: '', sources: [] }],
  characters: [{ id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [], categories: { books: { state: 'profile', source: null } }, rarityPreference: null, favorites: [], notes: null }],
  observations: [{ id: 'o1', gift: 'g1', character: 'c1', reaction: 'loved', points: 30, date: '2026-09-20' }],
  sources: [],
};

test('lookups resolve entities by id', () => {
  const idx = buildIndex(dataset);
  assert.equal(idx.byCharacterId.get('c1').name, 'C');
  assert.equal(idx.byGiftId.get('g1').name, 'Book');
  assert.equal(idx.byCategoryId.get('books').label, 'Books');
});

test('observationsFor returns only the matching pair', () => {
  const idx = buildIndex(dataset);
  assert.equal(idx.observationsFor('c1', 'g1').length, 1);
  assert.equal(idx.observationsFor('c1', 'nope').length, 0);
});

test('confidenceFor wires the pair through deriveConfidence', () => {
  const idx = buildIndex(dataset);
  const c = idx.confidenceFor('c1', 'g1');
  assert.equal(c.state, 'CONFIRMED');
  assert.equal(c.reaction, 'loved');
  assert.equal(c.points, 30);
});

test('the real committed dataset builds and derives without throwing', async () => {
  const idx = buildIndex(await loadDataset('data'));
  assert.ok(idx.characters.length > 0, 'expected characters');
  assert.ok(idx.gifts.length > 0, 'expected gifts');
  for (const ch of idx.characters) {
    for (const g of idx.gifts) assert.ok(idx.confidenceFor(ch.id, g.id).state);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/data.js'`

- [ ] **Step 3: Write `assets/js/data.js`**

```js
import { deriveConfidence } from './confidence.js';

const FILES = ['categories', 'gifts', 'characters', 'observations', 'sources'];

export async function fetchDataset(baseUrl = './data') {
  const entries = await Promise.all(
    FILES.map(async (name) => {
      const res = await fetch(`${baseUrl}/${name}.json`);
      if (!res.ok) throw new Error(`failed to load ${name}.json: ${res.status}`);
      return [name, await res.json()];
    }),
  );
  return Object.fromEntries(entries);
}

export function buildIndex(dataset) {
  const { characters, gifts, categories, sources, observations } = dataset;

  const byObsKey = new Map();
  for (const o of observations) {
    const key = `${o.character}\u0000${o.gift}`;
    if (!byObsKey.has(key)) byObsKey.set(key, []);
    byObsKey.get(key).push(o);
  }

  const index = {
    characters, gifts, categories, sources,
    byCharacterId: new Map(characters.map((c) => [c.id, c])),
    byGiftId: new Map(gifts.map((g) => [g.id, g])),
    byCategoryId: new Map(categories.map((c) => [c.id, c])),
    bySourceId: new Map(sources.map((s) => [s.id, s])),
    observationsFor: (characterId, giftId) => byObsKey.get(`${characterId}\u0000${giftId}`) ?? [],
  };

  index.confidenceFor = (characterId, giftId) => deriveConfidence({
    character: index.byCharacterId.get(characterId),
    gift: index.byGiftId.get(giftId),
    observations: index.observationsFor(characterId, giftId),
  });

  return index;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 38 tests. The last test exercises every real pair, so a data or logic regression fails here.

- [ ] **Step 5: Commit**

```bash
git add assets/js/data.js test/data.test.mjs
git commit -m "Add dataset loading and pair indexing"
```

---

### Task 6: Page shell, filters and routing

**Files:**
- Create: `index.html`, `assets/css/style.css`, `assets/js/filters.js`, `assets/js/app.js`
- Test: `test/filters.test.mjs`

**Interfaces:**
- Consumes: `buildIndex`, `fetchDataset`.
- Produces:
  - `DEFAULT_FILTERS = { hideUntested: false, hideUnconfirmed: false, hideSpoilers: true }`
  - `passesFilters(confidence, filters) -> boolean`
  - `parseRoute(hash) -> {view, id}` where `view` is one of `character`, `gift`, `matrix`, `favorites`.
  Views in Tasks 7–10 each export `render(container, index, state)` and are dispatched by `app.js`.

- [ ] **Step 1: Write the failing test**

Create `test/filters.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/filters.js'`

- [ ] **Step 3: Write `assets/js/filters.js`**

```js
export const VIEWS = ['character', 'gift', 'matrix', 'favorites'];

export const DEFAULT_FILTERS = {
  hideUntested: false,
  hideUnconfirmed: false,
  hideSpoilers: true,
};

const OBSERVED = new Set(['CONFIRMED', 'FAVORITE', 'CONTESTED']);

export function passesFilters(confidence, filters) {
  if (filters.hideUntested && confidence.state === 'UNTESTED') return false;
  if (filters.hideUnconfirmed && !OBSERVED.has(confidence.state)) return false;
  return true;
}

export function parseRoute(hash) {
  const [, view, id] = (hash ?? '').split('/');
  if (!VIEWS.includes(view)) return { view: 'character', id: null };
  return { view, id: id ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 43 tests.

- [ ] **Step 5: Write `index.html`**

A single page containing: a header with the site name and a one-line explanation that predictions are guesses and confirmations come from players; a nav with four links (`#/character`, `#/gift`, `#/matrix`, `#/favorites`); a search input; three filter checkboxes bound to `DEFAULT_FILTERS`; an empty `<main id="view">`; and `<script type="module" src="assets/js/app.js"></script>`.

Include a `<noscript>` explaining the site needs JavaScript, and a footer crediting sources.

- [ ] **Step 6: Write `assets/css/style.css`**

Define CSS custom properties on `:root` for the confidence states, redefine them under `@media (prefers-color-scheme: dark)`, and give `body` an explicit background. Required classes, each visually distinct without relying on colour alone (use a text label or icon too, for colour-blind readers):

`.state-favorite`, `.state-confirmed`, `.state-contested`, `.state-predicted`, `.state-untested`, plus `.provenance-guide` (dimmer than `.provenance-profile`), `.is-exception`, `.rarity-mismatch`, and `.trait-flavor` (greyed).

Layout must work at phone width with a 16px side gutter and no horizontal page scroll, except the matrix table which scrolls horizontally inside its own container.

- [ ] **Step 7: Write `assets/js/app.js`**

```js
import { fetchDataset, buildIndex } from './data.js';
import { parseRoute, DEFAULT_FILTERS } from './filters.js';
import * as characterView from './views/character.js';
import * as giftView from './views/gift.js';
import * as matrixView from './views/matrix.js';
import * as favoritesView from './views/favorites.js';

const VIEW_MODULES = {
  character: characterView,
  gift: giftView,
  matrix: matrixView,
  favorites: favoritesView,
};

const state = { filters: { ...DEFAULT_FILTERS }, search: '', index: null };

function render() {
  const container = document.getElementById('view');
  const route = parseRoute(location.hash);
  container.replaceChildren();
  VIEW_MODULES[route.view].render(container, state.index, { ...state, id: route.id });
  for (const a of document.querySelectorAll('nav a')) {
    a.classList.toggle('active', a.getAttribute('href').startsWith(`#/${route.view}`));
  }
}

async function main() {
  const container = document.getElementById('view');
  try {
    state.index = buildIndex(await fetchDataset());
  } catch (err) {
    container.textContent = `Could not load the gift data: ${err.message}`;
    return;
  }

  addEventListener('hashchange', render);
  document.getElementById('search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  });
  for (const box of document.querySelectorAll('[data-filter]')) {
    box.checked = state.filters[box.dataset.filter];
    box.addEventListener('change', () => {
      state.filters[box.dataset.filter] = box.checked;
      render();
    });
  }
  render();
}

main();
```

Tasks 7–10 each create one of the imported view modules. Until they exist the page will fail to load, so run Step 8 only after Task 10. This is expected: the shell is committed first so each view lands as an independently reviewable change.

- [ ] **Step 8: Commit**

```bash
git add index.html assets/css/style.css assets/js/filters.js assets/js/app.js test/filters.test.mjs
git commit -m "Add page shell, filters and routing"
```

---

### Task 7: By Character view

**Files:**
- Create: `assets/js/views/character.js`, `assets/js/views/shared.js`
- Test: `test/views.test.mjs`

**Interfaces:**
- Consumes: `Index` from Task 5, `passesFilters` from Task 6.
- Produces:
  - From `shared.js`: `sortByConfidence(rows) -> rows` and `stateLabel(confidence) -> string`
  - From `character.js`: `render(container, index, state)` and `characterRows(index, characterId, filters) -> [{gift, confidence}]`

`characterRows` holds all the logic and is pure, so it is tested directly. `render` only turns its output into DOM.

- [ ] **Step 1: Write the failing test**

Create `test/views.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { characterRows } from '../assets/js/views/character.js';
import { sortByConfidence, stateLabel } from '../assets/js/views/shared.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';

const dataset = {
  categories: [
    { id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] },
    { id: 'coffee', label: 'Coffee', inGameDescriptor: null, aliases: [] },
  ],
  gifts: [
    { id: 'book', name: 'Book', category: 'books', rarity: 'common', description: '', sources: [] },
    { id: 'brew', name: 'Brew', category: 'coffee', rarity: 'common', description: '', sources: [] },
    { id: 'rock', name: 'Rock', category: null, rarity: null, description: '', sources: [] },
  ],
  characters: [{
    id: 'c1', name: 'C', giftable: true, spoiler: false, traits: [],
    categories: { books: { state: 'profile', source: null } },
    rarityPreference: null, favorites: [], notes: null,
  }],
  observations: [{ id: 'o1', gift: 'brew', character: 'c1', reaction: 'favorite', points: 60, date: '2026-09-20' }],
  sources: [],
};

test('favorites sort above predictions, which sort above untested', () => {
  const idx = buildIndex(dataset);
  const rows = characterRows(idx, 'c1', DEFAULT_FILTERS);
  assert.deepEqual(rows.map((r) => r.gift.id), ['brew', 'book', 'rock']);
});

test('every gift appears when no filter is applied', () => {
  const idx = buildIndex(dataset);
  assert.equal(characterRows(idx, 'c1', DEFAULT_FILTERS).length, 3);
});

test('hideUntested drops the uncategorised gift', () => {
  const idx = buildIndex(dataset);
  const rows = characterRows(idx, 'c1', { ...DEFAULT_FILTERS, hideUntested: true });
  assert.deepEqual(rows.map((r) => r.gift.id), ['brew', 'book']);
});

test('state labels never describe an untested pair as disliked', () => {
  for (const state of ['UNTESTED', 'PREDICTED', 'CONFIRMED', 'FAVORITE', 'CONTESTED']) {
    assert.doesNotMatch(stateLabel({ state, reaction: null }), /dislike|hates|bad gift/i);
  }
});

test('sortByConfidence is stable for equal states', () => {
  const rows = [
    { gift: { id: 'a' }, confidence: { state: 'PREDICTED' } },
    { gift: { id: 'b' }, confidence: { state: 'PREDICTED' } },
  ];
  assert.deepEqual(sortByConfidence(rows).map((r) => r.gift.id), ['a', 'b']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/views/character.js'`

- [ ] **Step 3: Write `assets/js/views/shared.js`**

```js
const STATE_RANK = { FAVORITE: 0, CONFIRMED: 1, CONTESTED: 2, PREDICTED: 3, UNTESTED: 4 };

const REACTION_LABEL = {
  none: 'No support gain',
  slight: 'Small gain',
  liked: 'Moderate gain',
  loved: 'Big gain',
  favorite: 'Double points',
};

export function sortByConfidence(rows) {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (STATE_RANK[a.row.confidence.state] - STATE_RANK[b.row.confidence.state]) || (a.i - b.i))
    .map(({ row }) => row);
}

// Never describe an unobserved pair as disliked: absence of a match is not
// evidence. Only a reported reaction may read as a negative.
export function stateLabel(confidence) {
  switch (confidence.state) {
    case 'FAVORITE': return 'Favourite — double points';
    case 'CONFIRMED': return `Confirmed: ${REACTION_LABEL[confidence.reaction]}`;
    case 'CONTESTED': return 'Reports disagree';
    case 'PREDICTED': return confidence.predicted === 'negative' ? 'Predicted: probably no gain' : 'Predicted — not yet confirmed';
    default: return 'Not tested yet';
  }
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function stateClasses(confidence) {
  const classes = [`state-${confidence.state.toLowerCase()}`];
  if (confidence.provenance) classes.push(`provenance-${confidence.provenance}`);
  if (confidence.isException) classes.push('is-exception');
  if (confidence.rarityMismatch) classes.push('rarity-mismatch');
  return classes.join(' ');
}
```

- [ ] **Step 4: Write `assets/js/views/character.js`**

```js
import { passesFilters } from '../filters.js';
import { sortByConfidence, stateLabel, stateClasses, el } from './shared.js';

export function characterRows(index, characterId, filters) {
  const rows = index.gifts
    .map((gift) => ({ gift, confidence: index.confidenceFor(characterId, gift.id) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

function renderPicker(container, index, state) {
  const list = el('ul', 'picker');
  for (const ch of index.characters) {
    if (!ch.giftable) continue;
    if (state.filters.hideSpoilers && ch.spoiler) continue;
    if (state.search && !ch.name.toLowerCase().includes(state.search)) continue;
    const item = el('li');
    const link = el('a', null, ch.name);
    link.href = `#/character/${ch.id}`;
    item.append(link);
    list.append(item);
  }
  container.append(el('h2', null, 'Pick a character'), list);
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const character = index.byCharacterId.get(state.id);
  if (!character) {
    container.append(el('p', null, `No character called "${state.id}".`));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, character.name));
  if (character.notes) container.append(el('p', 'notes', character.notes));

  if (character.traits.length === 0) {
    container.append(el('p', 'help-wanted', 'Nobody has entered this character’s in-game profile yet.'));
  } else {
    const traits = el('ul', 'traits');
    for (const t of character.traits) {
      const item = el('li', t.category ? 'trait' : 'trait trait-flavor', t.text);
      if (!t.category) item.append(el('span', 'flavor-tag', ' (flavour — not a gift type)'));
      traits.append(item);
    }
    container.append(el('h3', null, 'Profile'), traits);
  }

  if (character.rarityPreference) {
    container.append(el('p', 'rarity-pref', `Prefers ${character.rarityPreference === 'rare' ? 'rare' : 'uncommon or rare'} items.`));
  }

  const table = el('table', 'gift-table');
  const body = el('tbody');
  for (const { gift, confidence } of characterRows(index, character.id, state.filters)) {
    const row = el('tr', stateClasses(confidence));
    const nameCell = el('td');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    nameCell.append(link);
    row.append(nameCell);
    row.append(el('td', null, gift.category ? index.byCategoryId.get(gift.category).label : '—'));
    row.append(el('td', null, gift.rarity ?? '—'));
    row.append(el('td', null, stateLabel(confidence)));
    row.append(el('td', null, confidence.points === null ? '' : `${confidence.points} pts`));
    body.append(row);
  }
  const head = el('thead');
  const headRow = el('tr');
  for (const h of ['Gift', 'Category', 'Rarity', 'Status', 'Points']) headRow.append(el('th', null, h));
  head.append(headRow);
  table.append(head, body);
  container.append(el('h3', null, 'Gifts'), table);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 48 tests.

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/shared.js assets/js/views/character.js test/views.test.mjs
git commit -m "Add By Character view"
```

---

### Task 8: By Gift view

**Files:**
- Create: `assets/js/views/gift.js`
- Modify: `test/views.test.mjs`

**Interfaces:**
- Consumes: `Index`, `passesFilters`, `sortByConfidence`, `stateLabel`, `stateClasses`, `el`.
- Produces: `render(container, index, state)` and `giftRows(index, giftId, filters) -> [{character, confidence}]`.

- [ ] **Step 1: Write the failing test**

Append to `test/views.test.mjs`:

```js
import { giftRows } from '../assets/js/views/gift.js';

test('giftRows lists giftable characters ranked by confidence', () => {
  const idx = buildIndex({
    ...dataset,
    characters: [
      dataset.characters[0],
      { id: 'c2', name: 'D', giftable: true, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
      { id: 'c3', name: 'E', giftable: false, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
    ],
  });
  const rows = giftRows(idx, 'book', DEFAULT_FILTERS);
  assert.deepEqual(rows.map((r) => r.character.id), ['c1', 'c2'], 'non-giftable characters are excluded');
  assert.equal(rows[0].confidence.state, 'PREDICTED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/views/gift.js'`

- [ ] **Step 3: Write `assets/js/views/gift.js`**

```js
import { passesFilters } from '../filters.js';
import { sortByConfidence, stateLabel, stateClasses, el } from './shared.js';

export function giftRows(index, giftId, filters) {
  const rows = index.characters
    .filter((character) => character.giftable)
    .filter((character) => !(filters.hideSpoilers && character.spoiler))
    .map((character) => ({ character, confidence: index.confidenceFor(character.id, giftId) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

function renderPicker(container, index, state) {
  const list = el('ul', 'picker');
  for (const gift of index.gifts) {
    if (state.search && !gift.name.toLowerCase().includes(state.search)) continue;
    const item = el('li');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    item.append(link);
    list.append(item);
  }
  container.append(el('h2', null, 'Pick a gift'), list);
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const gift = index.byGiftId.get(state.id);
  if (!gift) {
    container.append(el('p', null, `No gift called "${state.id}".`));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, gift.name));
  const category = gift.category ? index.byCategoryId.get(gift.category) : null;
  container.append(el('p', 'meta', `Category: ${category ? category.label : 'not recorded yet'} · Rarity: ${gift.rarity ?? 'not recorded yet'}`));
  if (category?.inGameDescriptor) {
    container.append(el('p', 'descriptor', `In-game description mentions: “${category.inGameDescriptor}”`));
  }
  if (!gift.category) {
    container.append(el('p', 'help-wanted', 'Nobody has recorded this item’s category yet, so it has no predictions.'));
  }

  const table = el('table', 'gift-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const h of ['Character', 'Status', 'Points']) headRow.append(el('th', null, h));
  head.append(headRow);
  const body = el('tbody');
  for (const { character, confidence } of giftRows(index, gift.id, state.filters)) {
    const row = el('tr', stateClasses(confidence));
    const nameCell = el('td');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    nameCell.append(link);
    row.append(nameCell, el('td', null, stateLabel(confidence)), el('td', null, confidence.points === null ? '' : `${confidence.points} pts`));
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 49 tests.

- [ ] **Step 5: Commit**

```bash
git add assets/js/views/gift.js test/views.test.mjs
git commit -m "Add By Gift view"
```

---

### Task 9: Full Matrix view

**Files:**
- Create: `assets/js/views/matrix.js`
- Modify: `test/views.test.mjs`, `assets/css/style.css`

**Interfaces:**
- Consumes: `Index`, `passesFilters`, `stateClasses`, `stateLabel`, `el`.
- Produces: `render(container, index, state)` and `matrixModel(index, filters, search) -> {characters, gifts, cellAt(giftId, characterId)}`.

- [ ] **Step 1: Write the failing test**

Append to `test/views.test.mjs`:

```js
import { matrixModel } from '../assets/js/views/matrix.js';

test('the matrix excludes non-giftable characters and keeps every gift by default', () => {
  const idx = buildIndex(dataset);
  const m = matrixModel(idx, DEFAULT_FILTERS, '');
  assert.deepEqual(m.characters.map((c) => c.id), ['c1']);
  assert.equal(m.gifts.length, 3);
  assert.equal(m.cellAt('brew', 'c1').state, 'FAVORITE');
});

test('hideUntested drops gift rows where no character has any signal', () => {
  const idx = buildIndex(dataset);
  const m = matrixModel(idx, { ...DEFAULT_FILTERS, hideUntested: true }, '');
  assert.deepEqual(m.gifts.map((g) => g.id), ['book', 'brew'], 'the uncategorised gift row is dropped');
});

test('search narrows the gift rows', () => {
  const idx = buildIndex(dataset);
  const m = matrixModel(idx, DEFAULT_FILTERS, 'brew');
  assert.deepEqual(m.gifts.map((g) => g.id), ['brew']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/views/matrix.js'`

- [ ] **Step 3: Write `assets/js/views/matrix.js`**

```js
import { passesFilters } from '../filters.js';
import { stateClasses, stateLabel, el } from './shared.js';

export function matrixModel(index, filters, search) {
  const characters = index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler));

  const cells = new Map();
  const key = (giftId, characterId) => `${giftId}\u0000${characterId}`;

  const gifts = index.gifts.filter((gift) => {
    if (search && !gift.name.toLowerCase().includes(search)) return false;
    let anyVisible = false;
    for (const character of characters) {
      const confidence = index.confidenceFor(character.id, gift.id);
      cells.set(key(gift.id, character.id), confidence);
      if (passesFilters(confidence, filters)) anyVisible = true;
    }
    // A row with nothing to say under the current filters is noise, not data.
    return anyVisible;
  });

  return { characters, gifts, cellAt: (giftId, characterId) => cells.get(key(giftId, characterId)) };
}

const SYMBOL = { FAVORITE: '★', CONFIRMED: '✔', CONTESTED: '?', PREDICTED: '~', UNTESTED: '' };

export function render(container, index, state) {
  const model = matrixModel(index, state.filters, state.search);
  container.append(el('h2', null, 'Full matrix'));
  container.append(el('p', 'legend', '★ favourite · ✔ confirmed · ? reports disagree · ~ predicted, unconfirmed · blank not tested'));

  const scroller = el('div', 'matrix-scroll');
  const table = el('table', 'matrix');

  const head = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', 'corner', 'Gift'));
  for (const character of model.characters) headRow.append(el('th', 'col-head', character.name));
  head.append(headRow);

  const body = el('tbody');
  for (const gift of model.gifts) {
    const row = el('tr');
    row.append(el('th', 'row-head', gift.name));
    for (const character of model.characters) {
      const confidence = model.cellAt(gift.id, character.id);
      const cell = el('td', stateClasses(confidence), SYMBOL[confidence.state]);
      cell.title = `${character.name} · ${gift.name}: ${stateLabel(confidence)}`;
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  scroller.append(table);
  container.append(scroller);
}
```

- [ ] **Step 4: Add matrix styles to `assets/css/style.css`**

`.matrix-scroll { overflow-x: auto; }`. Make `.matrix th.row-head` sticky to the left and `.matrix thead th` sticky to the top so headers stay visible while scrolling. Keep cells narrow and centred.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 52 tests.

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/matrix.js assets/css/style.css test/views.test.mjs
git commit -m "Add Full Matrix view"
```

---

### Task 10: Favorites Hunt view

**Files:**
- Create: `assets/js/views/favorites.js`
- Modify: `test/views.test.mjs`

**Interfaces:**
- Consumes: `Index`, `el`.
- Produces: `render(container, index, state)` and `favoritesModel(index, filters) -> {found: [{character, gifts}], unknown: [{character, suggestions}]}`.

`suggestions` are untested gifts in categories the character is predicted to like, ranked rare first — these are the items most likely to be a favourite and least likely to have been tried.

- [ ] **Step 1: Write the failing test**

Append to `test/views.test.mjs`:

```js
import { favoritesModel } from '../assets/js/views/favorites.js';

test('a character with a confirmed favourite is listed as found', () => {
  const idx = buildIndex(dataset);
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.found.map((f) => f.character.id), ['c1']);
  assert.deepEqual(m.found[0].gifts.map((g) => g.id), ['brew']);
  assert.equal(m.unknown.length, 0);
});

test('a character with no favourite is listed as unknown with suggestions from liked categories', () => {
  const idx = buildIndex({ ...dataset, observations: [] });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.unknown.map((u) => u.character.id), ['c1']);
  assert.deepEqual(m.unknown[0].suggestions.map((g) => g.id), ['book'], 'only untested gifts in predicted categories');
});

test('suggestions rank rare items first', () => {
  const idx = buildIndex({
    ...dataset,
    observations: [],
    gifts: [
      { id: 'cheap', name: 'Cheap Book', category: 'books', rarity: 'common', description: '', sources: [] },
      { id: 'posh', name: 'Posh Book', category: 'books', rarity: 'rare', description: '', sources: [] },
    ],
  });
  const m = favoritesModel(idx, DEFAULT_FILTERS);
  assert.deepEqual(m.unknown[0].suggestions.map((g) => g.id), ['posh', 'cheap']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/views/favorites.js'`

- [ ] **Step 3: Write `assets/js/views/favorites.js`**

```js
import { RARITY_ORDER } from '../confidence.js';
import { el } from './shared.js';

function suggestionsFor(index, character) {
  return index.gifts
    .filter((gift) => {
      const confidence = index.confidenceFor(character.id, gift.id);
      // Worth trying: predicted to land, and nobody has tried it yet.
      return confidence.state === 'PREDICTED' && confidence.predicted === 'positive';
    })
    .sort((a, b) => (RARITY_ORDER[b.rarity] ?? -1) - (RARITY_ORDER[a.rarity] ?? -1));
}

export function favoritesModel(index, filters) {
  const found = [];
  const unknown = [];

  for (const character of index.characters) {
    if (!character.giftable) continue;
    if (filters.hideSpoilers && character.spoiler) continue;

    const gifts = index.gifts.filter((gift) => index.confidenceFor(character.id, gift.id).state === 'FAVORITE');
    if (gifts.length) found.push({ character, gifts });
    else unknown.push({ character, suggestions: suggestionsFor(index, character) });
  }

  return { found, unknown };
}

export function render(container, index, state) {
  const { found, unknown } = favoritesModel(index, state.filters);

  container.append(el('h2', null, 'Favourites hunt'));
  container.append(el('p', 'intro', 'Every character has at least one item that gives double support points. Most are still unknown. If you find one, report it — this is the gap no other guide fills.'));
  container.append(el('p', 'progress', `Found ${found.length} of ${found.length + unknown.length}.`));

  container.append(el('h3', null, `Still unknown (${unknown.length})`));
  const list = el('ul', 'favorites-unknown');
  for (const { character, suggestions } of unknown) {
    const item = el('li');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    item.append(link);
    const hint = suggestions.length
      ? ` — worth trying: ${suggestions.slice(0, 5).map((g) => g.name).join(', ')}`
      : ' — no predicted categories yet, so no suggestions';
    item.append(el('span', 'suggestions', hint));
    list.append(item);
  }
  container.append(list);

  if (found.length) {
    container.append(el('h3', null, `Found (${found.length})`));
    const foundList = el('ul', 'favorites-found');
    for (const { character, gifts } of found) {
      const item = el('li');
      const link = el('a', null, character.name);
      link.href = `#/character/${character.id}`;
      item.append(link, el('span', null, ` — ${gifts.map((g) => g.name).join(', ')}`));
      foundList.append(item);
    }
    container.append(foundList);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 55 tests.

- [ ] **Step 5: Verify the site actually loads**

The shell from Task 6 now has all four view modules. Serve and check:

Run: `python3 -m http.server 8000`

Open `http://localhost:8000/` and confirm: the character picker lists giftable characters; clicking one shows its gift table; `#/gift/...`, `#/matrix` and `#/favorites` all render; the three filter checkboxes change what is shown; the browser console has no errors.

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/favorites.js test/views.test.mjs
git commit -m "Add Favourites Hunt view"
```

---

### Task 11: CI and GitHub Pages deployment

**Files:**
- Create: `.github/workflows/validate.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm test` and `npm run validate` from every prior task.
- Produces: a required status check on pull requests, and a live site.

- [ ] **Step 1: Write `.github/workflows/validate.yml`**

```yaml
name: validate

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Validate data files
        run: npm run validate
      - name: Run tests
        run: npm test
```

Node 22 is the floor the Actions runner offers reliably and supports `node:test`. Local development uses whatever is installed, currently 26.

- [ ] **Step 2: Verify the workflow passes locally first**

Run: `npm run validate && npm test`
Expected: `data valid`, then all tests passing. Fix anything failing before pushing — a red first CI run is noise.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/validate.yml README.md
git commit -m "Add CI validation workflow"
git push -u origin main
```

- [ ] **Step 4: Enable GitHub Pages**

In the repository settings, under Pages, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`. Confirm the site appears at `https://mackoz.github.io/fefw-gifts/`.

- [ ] **Step 5: Verify the deployed site**

Open `https://mackoz.github.io/fefw-gifts/` and confirm all four views render and the JSON files load. A 404 on `data/*.json` means `.nojekyll` is missing or Pages has not finished building.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "Fix deployment issues found on GitHub Pages"
git push
```

---

## Deferred to Plan 2

Not in this plan, by design. Plan 1's output must work completely without any of it:

- The Cloudflare Worker, D1 schema and Turnstile verification
- The in-page "Report a result" form
- The pending-submissions overlay on top of committed data
- The sync script and the Action that opens a pull request from approved rows

Task 6's `index.html` should leave a clearly marked placeholder where the report button will go, so Plan 2 has an obvious insertion point.
