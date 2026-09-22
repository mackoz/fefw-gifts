export const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2 };

// The five tiers the game itself displays, in increasing order. One definition,
// shared by the confidence core and the report form.
export const REACTIONS = ['none', 'slight', 'liked', 'loved', 'favorite'];
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

export function deriveConfidence({ character, gift, observations, pending = [] }) {
  const link = gift.category ? character.categories?.[gift.category] ?? null : null;
  const predicted = link ? (link.state === 'refuted' ? 'negative' : 'positive') : null;

  const result = {
    state: 'UNTESTED',
    reaction: null,
    predicted,
    provenance: link?.state ?? null,
    source: link?.source ?? null,
    isException: false,
    rarityMismatch: rarityMismatches(character, gift),
    observationCount: observations.length,
    pendingCount: pending.length,
  };

  if (observations.length === 0) {
    // A pending report is a real player's result, so it outranks a guide's
    // guess -- but it is not a confirmation. `reaction` stays null
    // deliberately: an unreviewed report contributes nothing. Only an approved
    // observation merged into the repository may do that.
    if (pending.length > 0) {
      result.state = 'PENDING';
      return result;
    }
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

  result.reaction = reaction;
  result.state = reaction === 'favorite' ? 'FAVORITE' : 'CONFIRMED';
  result.isException = predicted !== null && polarityOf(reaction) !== predicted;

  return result;
}
