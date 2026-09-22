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
    for (const s of g.sources ?? []) {
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
