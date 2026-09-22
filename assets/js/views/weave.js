// The weave strip: the whole character x gift grid at a few pixels per cell.
// Almost all of it is bare, and that emptiness is the point -- so the bare
// ground is one background rect rather than thousands of empty elements, and
// the DOM grows with what the community knows rather than with the dataset.
import { el } from './shared.js';

const NS = 'http://www.w3.org/2000/svg';

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
    : `${n(model.favouritesFound)} of ${n(model.favouritesTotal)} favourites found.`;
  return `${pairs} ${favourites}`;
}

function rect(attrs) {
  const node = document.createElementNS(NS, 'rect');
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export function render(container, index, state) {
  const model = weaveModel(index, state.filters);
  container.replaceChildren();
  // Every character filtered out. Render nothing rather than an empty box,
  // which would read as breakage.
  if (model.rows === 0 || model.columns === 0) return;

  const summary = weaveSummary(model);

  const link = el('a', 'weave');
  link.href = '#/matrix';
  link.setAttribute('aria-label', `${summary} Open the full matrix.`);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'weave-svg');
  svg.setAttribute('viewBox', `0 0 ${model.columns} ${model.rows}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  // The summary sentence beside it already carries everything the picture
  // says, so the picture itself is decorative to a screen reader.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  svg.append(rect({ class: 'weave-ground', width: model.columns, height: model.rows }));

  const marks = document.createElementNS(NS, 'g');
  marks.setAttribute('class', 'weave-marks');
  for (const mark of model.marks) {
    marks.append(rect({
      class: `weave-mark weave-${mark.state.toLowerCase()}`,
      x: mark.x,
      y: mark.y,
      width: 1,
      height: 1,
    }));
  }
  svg.append(marks);

  link.append(svg);
  container.append(link, el('p', 'weave-summary', summary));
}
