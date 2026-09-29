export const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2 };

// The five tiers the game itself displays, in increasing order. One definition,
// shared by the confidence core and the report form.
export const REACTIONS = ['none', 'slight', 'liked', 'loved', 'favorite'];
export const POSITIVE_REACTIONS = ['slight', 'liked', 'loved', 'favorite'];

// The reactions that land a CONFIRMED pair below the loved result a
// minmaxing player is after -- real, approved results, just not the big bond
// gain (a `favorite` reaction never reaches here: deriveConfidence turns it
// into its own FAVORITE state). Kept as an explicit list rather than an
// `else` catch-all, so a new reaction tier has to be added here on purpose
// rather than silently counting as below-loved. Exported once here rather
// than duplicated per view module -- every view imports this one list rather
// than keeping its own copy -- so none of them can drift apart on which
// reactions count as below loved.
export const BELOW_LOVED_REACTIONS = ['liked', 'slight', 'none'];

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

// States a stored link takes on when a stronger signal should take its
// place: absent entirely, a guide's guess, or a refuted one. A `profile` or
// `discovered` link is a stronger claim already and is kept.
const OVERRIDABLE_LINK_STATES = new Set([undefined, 'guide', 'refuted']);

// Which link a pair's prediction rests on, in order (it matters only for a
// pair with no approved observation and no pending report):
//   1. a stored `profile` or `discovered` category link is kept;
//   2. a loved category found through play -- a "play link" -- gives
//      `discovered`;
//   3. a guide pick (a published guide names this very item for this
//      character) gives `guide`, sourced to the pick's first source;
//   4. otherwise the stored `guide` or `refuted` link, or none.
// Steps 2 and 3 only replace a missing, `guide` or `refuted` link, and a
// guide pick never outranks a play link. `lovedCategories` is a Set and
// `guidePick` an array of source ids, both derived by the caller (buildIndex);
// this function only consults them.
export function deriveConfidence({ character, gift, observations, pending = [], lovedCategories, guidePick }) {
  const storedLink = gift.category ? character.categories?.[gift.category] ?? null : null;

  const isLovedCategory = Boolean(gift.category) && (lovedCategories?.has(gift.category) ?? false);
  const overridable = OVERRIDABLE_LINK_STATES.has(storedLink?.state);
  let link = storedLink;
  if (isLovedCategory && overridable) link = { state: 'discovered', source: null };
  else if (guidePick?.length > 0 && overridable) link = { state: 'guide', source: guidePick[0] };

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
    // A prediction exists only when a link (category or guide pick) does.
    // Absence of a link is never a negative -- see the spec's "Pair
    // confidence" section.
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
