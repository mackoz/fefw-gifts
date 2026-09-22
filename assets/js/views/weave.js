// The masthead's state-of-knowledge line: how much of the character x gift
// grid anyone has actually confirmed.
//
// This used to also draw the whole grid as an SVG strip. It was cut: squeezing
// 80x53 cells into a full-width band stretched each one to roughly 21px by
// 1.3px, and at a 16:1 distortion it stopped reading as a grid and started
// reading as scan lines. The sentence says the same thing and can be read.
// `marks` survives on the model because it costs nothing and describes the
// data honestly, but nothing renders it today.
import { el } from './shared.js';

// Every state that carries a signal. UNTESTED is deliberately absent: it is
// the ground itself, and drawing it would cost thousands of nodes to say
// nothing.
const MARKED = new Set(['FAVORITE', 'CONFIRMED', 'CONTESTED', 'PENDING', 'PREDICTED']);

// Mirrors favoritesModel. A favourite is found when a player observed one OR
// the character declares one; deriveConfidence never returns FAVORITE for a
// declared-but-unobserved gift, so counting states alone would make the
// masthead and the Favourites tab report different totals from one dataset.
function hasFavourite(index, character, gifts) {
  const declared = (character.favorites ?? []).map((id) => index.byGiftId.get(id)).filter(Boolean);
  if (declared.length > 0) return true;
  return gifts.some((gift) => index.confidenceFor(character.id, gift.id).state === 'FAVORITE');
}

export function weaveModel(index, filters) {
  const characters = index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler));
  const gifts = index.gifts;

  const marks = [];
  let confirmed = 0;
  let favouritesFound = 0;

  characters.forEach((character, y) => {
    gifts.forEach((gift, x) => {
      const { state } = index.confidenceFor(character.id, gift.id);
      // A pending report is a real player's result but not a confirmation, so
      // it is drawn and not counted.
      if (state === 'FAVORITE' || state === 'CONFIRMED') confirmed += 1;
      if (MARKED.has(state)) marks.push({ x, y, state });
    });
    if (hasFavourite(index, character, gifts)) favouritesFound += 1;
  });

  return {
    columns: gifts.length,
    rows: characters.length,
    pairs: characters.length * gifts.length,
    confirmed,
    favouritesFound,
    favouritesTotal: characters.length,
    marks,
  };
}

// Two sentences rather than a middle-dot-joined string. It states where the
// project stands, which is also the reason to contribute.
export function weaveSummary(model) {
  const n = (value) => value.toLocaleString('en-GB');
  const pairs = model.confirmed === 0
    ? `No pair confirmed yet, out of ${n(model.pairs)}.`
    : `${n(model.confirmed)} of ${n(model.pairs)} pairs confirmed.`;
  const favourites = model.favouritesFound === 0
    ? `${n(model.favouritesTotal)} favourite${model.favouritesTotal === 1 ? '' : 's'} still unfound.`
    : `${n(model.favouritesFound)} of ${n(model.favouritesTotal)} favourite${model.favouritesTotal === 1 ? '' : 's'} found.`;
  return `${pairs} ${favourites}`;
}

export function render(container, index, state) {
  const model = weaveModel(index, state.filters);
  container.replaceChildren();
  // Every character filtered out. Render nothing rather than a stray line.
  if (model.rows === 0 || model.columns === 0) return;
  container.append(el('p', 'weave-summary', weaveSummary(model)));
}
