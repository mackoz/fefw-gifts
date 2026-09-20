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
