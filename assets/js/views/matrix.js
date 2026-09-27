import { passesFilters } from '../filters.js';
import { cellClasses, stateLabel, el, emptyState } from './shared.js';
import { BELOW_LOVED_REACTIONS } from '../confidence.js';

export function matrixModel(index, filters, search) {
  const characters = index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler));

  const cells = new Map();
  const key = (giftId, characterId) => `${giftId}\u0000${characterId}`;

  const gifts = index.gifts.filter((gift) => {
    if (search && !gift.name.toLowerCase().includes(search)) return false;
    let anyVisible = false;
    for (const character of characters) {
      const confidence = index.confidenceFor(character.id, gift.id);
      cells.set(key(gift.id, character.id), confidence);
      if (passesFilters(confidence, filters)) anyVisible = true;
    }
    // A row with nothing to say under the current filters is noise, not data.
    return anyVisible;
  });

  return { characters, gifts, cellAt: (giftId, characterId) => cells.get(key(giftId, characterId)) };
}

export const SYMBOL = {
  FAVORITE: '★', CONFIRMED: '✔', CONTESTED: '?', PENDING: '•', PREDICTED: '~', UNTESTED: '',
  LIKED: '+', SLIGHT: '–', NONE: '0',
};

// Players use the guide to minmax bond so they can recruit characters quickly
// (many gate recruitment behind a bond threshold), so what they're hunting
// for is a LOVED (or FAVORITE) result specifically, not every positive
// reaction -- see characterSummary's file comment in character.js, which this
// follows the same loved/below-loved split as. LIKED, SLIGHT and NONE are
// render-only pseudo-states: a CONFIRMED pair whose reaction is liked, slight
// or "none" is a real, approved result, but none of them is the big bond gain
// a minmaxing player is after. Drawing any of them as ✔ under a legend
// reading "loved" claims the pair reached that gain, which only a CONFIRMED
// "loved" reaction (or a FAVORITE) actually does. They are deliberately NOT
// part of the confidence state machine in confidence.js -- nothing derives
// from them but this view's symbol, tint and title. Earlier these three
// collapsed into one TESTED pseudo-state; the maintainer asked for liked,
// slight and no-gain results to look distinct from each other too, not just
// from loved, so each below-loved reaction now gets its own symbol (+ / – /
// 0) and legend row instead.
const CELL_STATE_FOR_REACTION = { liked: 'LIKED', slight: 'SLIGHT', none: 'NONE' };

export function cellState(confidence) {
  if (confidence.state === 'CONFIRMED' && BELOW_LOVED_REACTIONS.includes(confidence.reaction)) {
    return CELL_STATE_FOR_REACTION[confidence.reaction];
  }
  return confidence.state;
}

// stateLabel already gives every below-loved reaction its own "Tested: <gain>"
// text and the loved reaction "Confirmed: Big gain" (see shared.js), so the
// matrix hover no longer needs a pseudo-state label of its own. It used to:
// before shared.js's stateLabel and this file's own CELL_LABEL agreed on
// wording, the matrix said "Tested: small gain" while the character and gift
// tables said "Confirmed: Small gain" for the exact same slight result --
// two names and two casings for one report (PR #20 review, M-4).
export function cellLabel(confidence) {
  return stateLabel(confidence);
}

// The matrix can empty out three ways, and each one needs a different way back.
export function emptyMatrixMessage(state) {
  if (state.search) return `No gift’s name matches “${state.search}”.`;
  if (state.filters.hideUnconfirmed) {
    return 'No confirmed results yet — nobody has reported one. Clear “Hide unconfirmed predictions” to see predictions.';
  }
  if (state.filters.hideUntested) return 'Nothing left once untested pairs are hidden. Clear “Hide untested pairs” to see the rest.';
  return 'Nothing to show. Untick “Hide spoilers” to see every character.';
}

// A real key: swatch, symbol and label per state. The old run-on string joined
// six entries with middle dots, which reads as decoration rather than a key.
export const LEGEND = [
  ['FAVORITE', 'favourite'],
  ['CONFIRMED', 'loved'],
  ['LIKED', 'liked (moderate gain)'],
  ['SLIGHT', 'slight (small gain)'],
  ['NONE', 'no support gain'],
  ['CONTESTED', 'reports disagree'],
  ['PENDING', 'reported, awaiting review'],
  ['PREDICTED', 'predicted, unconfirmed'],
  ['UNTESTED', 'not tested'],
];

function legend() {
  const list = el('ul', 'matrix-legend');
  // Safari/VoiceOver drops role="list" implicit in <ul> once list-style:
  // none meets display: grid/flex, so it has to be set back explicitly.
  list.setAttribute('role', 'list');
  for (const [state, label] of LEGEND) {
    const item = el('li');
    item.append(el('span', `legend-swatch cell-${state.toLowerCase()}`, SYMBOL[state]));
    item.append(el('span', 'legend-label', label));
    list.append(item);
  }
  return list;
}

export function render(container, index, state) {
  const model = matrixModel(index, state.filters, state.search);
  container.append(el('h2', null, 'Full matrix'));
  container.append(legend());

  if (model.gifts.length === 0 || model.characters.length === 0) {
    container.append(emptyState(emptyMatrixMessage(state)));
    return;
  }

  const scroller = el('div', 'matrix-scroll');
  // The table itself has no focusable element, and in Safari a keyboard-only
  // user cannot scroll an overflow container that isn't itself focusable --
  // which would leave 79 of every 80 rows unreachable. tabindex makes the
  // scroller a stop; role+aria-label give it the announced name it otherwise
  // lacks.
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', 'Full character and gift matrix');
  const table = el('table', 'matrix');

  const head = el('thead');
  const headRow = el('tr');
  const corner = el('th', 'corner', 'Gift');
  corner.scope = 'col';
  headRow.append(corner);
  // A narrow, empty, non-sticky column between the row labels and the data.
  // The rotated headers lean about 17px left of their own column and land on
  // the header before them, which paints earlier and so shows them through.
  // The first character column has no header before it -- it has the sticky
  // corner, which paints ABOVE everything (z-index 3) and would swallow the
  // first several letters of the first name. This column gives that lean
  // somewhere harmless to land. It scrolls away normally, so unlike making
  // the corner transparent it lets no header bleed through during scroll.
  headRow.append(el('th', 'lead-in'));
  for (const character of model.characters) {
    const th = el('th', 'col-head');
    th.scope = 'col';
    // The label is wrapped so it can be rotated without rotating the cell,
    // which would take the header out of the table's own layout.
    th.append(el('span', null, character.name));
    headRow.append(th);
  }
  head.append(headRow);

  const body = el('tbody');
  for (const gift of model.gifts) {
    const row = el('tr');
    const rowHead = el('th', 'row-head', gift.name);
    rowHead.scope = 'row';
    row.append(rowHead);
    row.append(el('td', 'lead-in'));
    for (const character of model.characters) {
      const confidence = model.cellAt(gift.id, character.id);
      // Class, symbol and title all go through cellState: leaving any one of
      // them on confidence.state would draw a ✔, a loved tint or a
      // "Confirmed" tooltip over a below-loved result.
      const shown = { ...confidence, state: cellState(confidence) };
      // cellClasses, not stateClasses: a badge's inline-flex and ::before symbol
      // would break the table grid and duplicate the symbol already set here.
      const cell = el('td', cellClasses(shown), SYMBOL[shown.state]);
      cell.title = `${character.name} and ${gift.name}: ${cellLabel(confidence)}`;
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  scroller.append(table);
  container.append(scroller);
}
