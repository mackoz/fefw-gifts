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

const SYMBOL = { FAVORITE: '★', CONFIRMED: '✔', CONTESTED: '?', PREDICTED: '~', UNTESTED: '' };

// The matrix can empty out three ways, and each one needs a different way back.
export function emptyMatrixMessage(state) {
  if (state.search) return `No gift’s name matches “${state.search}”.`;
  if (state.filters.hideUnconfirmed) {
    return 'No confirmed results yet — nobody has reported one. Clear “Hide unconfirmed predictions” to see predictions.';
  }
  if (state.filters.hideUntested) return 'Nothing left once untested pairs are hidden. Clear “Hide untested pairs” to see the rest.';
  return 'Nothing to show. Untick “Hide spoilers” to see every character.';
}

export function render(container, index, state) {
  const model = matrixModel(index, state.filters, state.search);
  container.append(el('h2', null, 'Full matrix'));
  container.append(el('p', 'legend', '★ favourite · ✔ confirmed · ? reports disagree · ~ predicted, unconfirmed · blank not tested'));

  if (model.gifts.length === 0 || model.characters.length === 0) {
    container.append(emptyState(emptyMatrixMessage(state)));
    return;
  }

  const scroller = el('div', 'matrix-scroll');
  const table = el('table', 'matrix');

  const head = el('thead');
  const headRow = el('tr');
  const corner = el('th', 'corner', 'Gift');
  corner.scope = 'col';
  headRow.append(corner);
  for (const character of model.characters) {
    const th = el('th', 'col-head', character.name);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);

  const body = el('tbody');
  for (const gift of model.gifts) {
    const row = el('tr');
    const rowHead = el('th', 'row-head', gift.name);
    rowHead.scope = 'row';
    row.append(rowHead);
    for (const character of model.characters) {
      const confidence = model.cellAt(gift.id, character.id);
      // cellClasses, not stateClasses: a badge's inline-flex and ::before symbol
      // would break the table grid and duplicate the symbol already set here.
      const cell = el('td', cellClasses(confidence), SYMBOL[confidence.state]);
      cell.title = `${character.name} · ${gift.name}: ${stateLabel(confidence)}`;
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  scroller.append(table);
  container.append(scroller);
}
