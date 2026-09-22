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

// `?? []` guards null and undefined only. A wrong-typed value -- an object
// where an array belongs -- is not nullish, so it reached for...of and threw a
// TypeError, killing the validator with a stack trace instead of printing the
// error it had already recorded. Every list field is both type-checked and
// iterated through this, so bad data is always reported and never fatal.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Same idea as asArray(), one level up: `ch.categories` is a map, not a list,
// so the wrong-typed guard here is "is it a plain object" rather than
// Array.isArray. A number, a boolean or an array all fail that test and fall
// back to {}, so Object.entries() sees zero entries and the loop below is
// simply a no-op instead of a crash.
function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
  const RARITIES = new Set(['common', 'uncommon', 'rare']);
  const categoryIds = new Set(categories.map((c) => c.id));
  const sourceIds = new Set(sources.map((s) => s.id));

  checkDuplicates(categories, 'category', errors);
  checkDuplicates(sources, 'source', errors);

  for (const c of categories) {
    if (!c.label) errors.push(`category ${c.id}: missing label`);
    if (!Array.isArray(c.aliases)) errors.push(`category ${c.id}: aliases must be an array`);
  }

  checkDuplicates(dataset.gifts, 'gift', errors);

  for (const g of dataset.gifts) {
    if (!g.name) errors.push(`gift ${g.id}: missing name`);
    if (g.category !== null && !categoryIds.has(g.category)) {
      errors.push(`gift ${g.id}: unknown category: ${g.category}`);
    }
    if (g.rarity !== null && !RARITIES.has(g.rarity)) {
      errors.push(`gift ${g.id}: invalid rarity: ${g.rarity}`);
    }
    if (!Array.isArray(g.sources)) errors.push(`gift ${g.id}: sources must be an array`);
    for (const s of asArray(g.sources)) {
      if (!sourceIds.has(s)) errors.push(`gift ${g.id}: unknown source: ${s}`);
    }
  }

  const STATES = new Set(['guide', 'profile', 'discovered', 'refuted']);
  const RARITY_PREFS = new Set(['any', 'uncommon-plus', 'rare']);
  const REACTIONS = new Set(['none', 'slight', 'liked', 'loved', 'favorite']);
  const giftIds = new Set(dataset.gifts.map((g) => g.id));

  checkDuplicates(dataset.characters, 'character', errors);

  for (const ch of dataset.characters) {
    if (!ch.name) errors.push(`character ${ch.id}: missing name`);
    if (!Array.isArray(ch.traits)) errors.push(`character ${ch.id}: traits must be an array`);
    if (ch.categories === null || typeof ch.categories !== 'object' || Array.isArray(ch.categories)) {
      errors.push(`character ${ch.id}: categories must be an object`);
    }

    for (const [catId, link] of Object.entries(asObject(ch.categories))) {
      // A null or non-object link would otherwise reach link.state below and
      // throw; report it and move on so one bad entry doesn't mask the rest.
      if (link === null || typeof link !== 'object' || Array.isArray(link)) {
        errors.push(`character ${ch.id}: category ${catId} link must be an object`);
        continue;
      }
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

    for (const t of asArray(ch.traits)) {
      // Same reasoning as the category link above: a null or non-object entry
      // would otherwise reach t.category and throw.
      if (t === null || typeof t !== 'object' || Array.isArray(t)) {
        errors.push(`character ${ch.id}: trait entries must be objects`);
        continue;
      }
      if (typeof t.text !== 'string' || t.text.length === 0) {
        errors.push(`character ${ch.id}: trait is missing text`);
      }
      if (t.category !== null && !categoryIds.has(t.category)) {
        errors.push(`character ${ch.id}: trait "${t.text}" names unknown category: ${t.category}`);
      }
    }

    if (!Array.isArray(ch.favorites)) errors.push(`character ${ch.id}: favorites must be an array`);
    for (const f of asArray(ch.favorites)) {
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
