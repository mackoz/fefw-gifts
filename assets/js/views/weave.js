// The masthead's state-of-knowledge line: how much of the character x gift
// grid is known to be loved.
//
// This used to also draw the whole grid as an SVG strip. It was cut: squeezing
// 80x53 cells into a full-width band stretched each one to roughly 21px by
// 1.3px, and at a 16:1 distortion it stopped reading as a grid and started
// reading as scan lines. The sentence says the same thing and can be read.
// `marks` survives on the model because it costs nothing and describes the
// data honestly, but nothing renders it today.
import { el, favouriteGifts } from './shared.js';
import { BELOW_LOVED_REACTIONS } from '../confidence.js';

// Every state that carries a signal. UNTESTED is deliberately absent: it is
// the ground itself, and drawing it would cost thousands of nodes to say
// nothing.
const MARKED = new Set(['FAVORITE', 'CONFIRMED', 'CONTESTED', 'PENDING', 'PREDICTED']);

export function weaveModel(index, filters) {
  const characters = index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler));
  const gifts = index.gifts;

  const marks = [];
  let loved = 0;
  let tested = 0;
  let favouritesFound = 0;

  characters.forEach((character, y) => {
    gifts.forEach((gift, x) => {
      const { state, reaction } = index.confidenceFor(character.id, gift.id);
      // A pending report is a real player's result but not a confirmation, so
      // it is drawn and not counted -- see CLAUDE.md's "A pending report is
      // not a confirmation." A contested pair is real signal too, but reports
      // disagree, so it is drawn and not counted either.
      //
      // A FAVORITE counts as loved: it's loved and more (double points on top
      // of the bond gain), so it belongs in the same bucket a minmaxing
      // player is hunting for, not a separate one. A CONFIRMED pair only
      // counts as loved when the reaction actually is 'loved'. Liked, slight
      // and "none" are all real, approved CONFIRMED results -- somebody
      // tested this -- but none of them is the big bond gain a minmaxing
      // player is after, so they are counted separately as "tested below
      // loved" rather than folded into the loved total, which would claim a
      // gain the report never made. This follows the same loved/below-loved
      // split as characterSummary in character.js. Here pairs are counted by
      // confidence state alone; a declared favourite only feeds the
      // favourites sentence, so each pair still counts once.
      if (state === 'FAVORITE') loved += 1;
      else if (state === 'CONFIRMED') {
        if (reaction === 'loved') loved += 1;
        else if (BELOW_LOVED_REACTIONS.includes(reaction)) tested += 1;
      }
      if (MARKED.has(state)) marks.push({ x, y, state });
    });
    // Mirrors favouriteGifts in shared.js, so the masthead and the Favourites
    // tab can never disagree about which characters have a known favourite.
    if (favouriteGifts(index, character).length > 0) favouritesFound += 1;
  });

  return {
    columns: gifts.length,
    rows: characters.length,
    pairs: characters.length * gifts.length,
    loved,
    tested,
    favouritesFound,
    favouritesTotal: characters.length,
    marks,
  };
}

// Two sentences rather than a middle-dot-joined string. It states where the
// project stands, which is also the reason to contribute.
export function weaveSummary(model) {
  const n = (value) => value.toLocaleString('en-GB');
  const pairs = model.loved === 0
    ? `No pair loved yet, out of ${n(model.pairs)}.`
    : `${n(model.loved)} of ${n(model.pairs)} pairs loved.`;
  const favourites = model.favouritesFound === 0
    ? `${n(model.favouritesTotal)} favourite${model.favouritesTotal === 1 ? '' : 's'} still unfound.`
    : `${n(model.favouritesFound)} of ${n(model.favouritesTotal)} favourite${model.favouritesTotal === 1 ? '' : 's'} found.`;
  // A third sentence only when there is something to say. A liked, slight or
  // no-gain result is a real, approved player report and is counted here, but
  // none of them is the loved result a minmaxing player is after -- so it
  // gets its own sentence rather than being folded into the loved total.
  if (model.tested > 0) return `${pairs} ${favourites} ${n(model.tested)} more tested below loved.`;
  return `${pairs} ${favourites}`;
}

export function render(container, index, state) {
  const model = weaveModel(index, state.filters);
  container.replaceChildren();
  // Every character filtered out. Render nothing rather than a stray line.
  if (model.rows === 0 || model.columns === 0) return;
  container.append(el('p', 'weave-summary', weaveSummary(model)));
}
