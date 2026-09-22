import { passesFilters } from '../filters.js';
import { cellClasses, stateLabel, el, emptyState } from './shared.js';

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

export const SYMBOL = { FAVORITE: '★', CONFIRMED: '✔', CONTESTED: '?', PENDING: '•', PREDICTED: '~', UNTESTED: '' };

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
const LEGEND = [
  ['FAVORITE', 'favourite'],
  ['CONFIRMED', 'confirmed'],
  ['CONTESTED', 'reports disagree'],
  ['PENDING', 'reported, awaiting review'],
  ['PREDICTED', 'predicted, unconfirmed'],
  ['UNTESTED', 'not tested'],
];

function legend() {
  const list = el('ul', 'matrix-legend');
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
      // cellClasses, not stateClasses: a badge's inline-flex and ::before symbol
      // would break the table grid and duplicate the symbol already set here.
      const cell = el('td', cellClasses(confidence), SYMBOL[confidence.state]);
      cell.title = `${character.name} and ${gift.name}: ${stateLabel(confidence)}`;
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  scroller.append(table);
  container.append(scroller);
}
