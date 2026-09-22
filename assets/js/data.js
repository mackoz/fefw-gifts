import { deriveConfidence } from './confidence.js';
import { buildPendingIndex } from './overlay.js';

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

// `pending` is the Worker overlay and defaults to empty, so the index builds
// identically when the Worker is unavailable or not yet configured.
export function buildIndex(dataset, pending = []) {
  const { characters, gifts, categories, sources, observations } = dataset;

  const byObsKey = new Map();
  for (const o of observations) {
    const key = `${o.character}\u0000${o.gift}`;
    if (!byObsKey.has(key)) byObsKey.set(key, []);
    byObsKey.get(key).push(o);
  }

  const overlay = buildPendingIndex(pending);

  const index = {
    characters, gifts, categories, sources,
    byCharacterId: new Map(characters.map((c) => [c.id, c])),
    byGiftId: new Map(gifts.map((g) => [g.id, g])),
    byCategoryId: new Map(categories.map((c) => [c.id, c])),
    bySourceId: new Map(sources.map((s) => [s.id, s])),
    observationsFor: (characterId, giftId) => byObsKey.get(`${characterId}\u0000${giftId}`) ?? [],
    pendingFor: overlay.pendingFor,
  };

  index.confidenceFor = (characterId, giftId) => deriveConfidence({
    character: index.byCharacterId.get(characterId),
    gift: index.byGiftId.get(giftId),
    observations: index.observationsFor(characterId, giftId),
    pending: overlay.pendingFor(characterId, giftId),
  });

  return index;
}
