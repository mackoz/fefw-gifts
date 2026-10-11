import { deriveConfidence } from './confidence.js';
import { buildPendingIndex } from './overlay.js';

const FILES = ['categories', 'gifts', 'characters', 'observations', 'sources', 'guide-gifts'];

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

// `pending` is the Worker overlay and defaults to empty, so the index builds
// identically when the Worker is unavailable or not yet configured.
export function buildIndex(dataset, pending = []) {
  const { characters, gifts, categories, sources, observations } = dataset;

  const byGiftId = new Map(gifts.map((g) => [g.id, g]));

  const byObsKey = new Map();
  for (const o of observations) {
    const key = `${o.character}\u0000${o.gift}`;
    if (!byObsKey.has(key)) byObsKey.set(key, []);
    byObsKey.get(key).push(o);
  }

  // A character's loved categories: categories of gifts where every approved
  // observation on that (character, gift) pair is 'loved'. Drives a play-link
  // PREDICTED result in confidenceFor, in place of a missing/guide/refuted
  // stored link -- see the spec's "Pair confidence" section. Built from
  // `observations` only, so a pending report never contributes, and nothing
  // here writes back into character.categories.
  const lovedByCharacter = new Map();
  for (const [key, obsForPair] of byObsKey) {
    if (obsForPair.length === 0 || !obsForPair.every((o) => o.reaction === 'loved')) continue;
    const [characterId, giftId] = key.split('\u0000');
    const category = byGiftId.get(giftId)?.category;
    if (!category) continue;
    if (!lovedByCharacter.has(characterId)) lovedByCharacter.set(characterId, new Set());
    lovedByCharacter.get(characterId).add(category);
  }

  // Item-level guide picks: characterId -> giftId -> the sources that name it.
  // Predictions about one item only -- never a category link, never a chip.
  // A dataset without the file has none.
  const guidePicksByCharacter = new Map();
  for (const row of dataset['guide-gifts'] ?? []) {
    if (!guidePicksByCharacter.has(row.character)) guidePicksByCharacter.set(row.character, new Map());
    guidePicksByCharacter.get(row.character).set(row.gift, row.sources);
  }

  const overlay = buildPendingIndex(pending);

  const index = {
    characters, gifts, categories, sources,
    byCharacterId: new Map(characters.map((c) => [c.id, c])),
    byGiftId,
    byCategoryId: new Map(categories.map((c) => [c.id, c])),
    bySourceId: new Map(sources.map((s) => [s.id, s])),
    observationsFor: (characterId, giftId) => byObsKey.get(`${characterId}\u0000${giftId}`) ?? [],
    pendingFor: overlay.pendingFor,
    guidePicksByCharacter,
  };

  index.confidenceFor = (characterId, giftId) => deriveConfidence({
    character: index.byCharacterId.get(characterId),
    gift: index.byGiftId.get(giftId),
    observations: index.observationsFor(characterId, giftId),
    pending: overlay.pendingFor(characterId, giftId),
    lovedCategories: lovedByCharacter.get(characterId),
    guidePick: guidePicksByCharacter.get(characterId)?.get(giftId),
  });

  return index;
}
