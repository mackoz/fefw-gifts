import { passesFilters } from '../filters.js';
import { sortByConfidence, badge, el, emptyState } from './shared.js';

export function giftRows(index, giftId, filters) {
  const rows = index.characters
    .filter((character) => character.giftable)
    .filter((character) => !(filters.hideSpoilers && character.spoiler))
    .map((character) => ({ character, confidence: index.confidenceFor(character.id, giftId) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

function renderPicker(container, index, state) {
  const list = el('ul', 'picker');
  let count = 0;
  for (const gift of index.gifts) {
    if (state.search && !gift.name.toLowerCase().includes(state.search)) continue;
    const item = el('li');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    item.append(link);
    list.append(item);
    count += 1;
  }
  container.append(el('h2', null, 'Pick a gift'));
  if (count === 0) {
    container.append(emptyState(state.search
      ? `No gift’s name matches “${state.search}”.`
      : 'No gifts have been recorded yet.'));
    return;
  }
  container.append(list);
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const gift = index.byGiftId.get(state.id);
  if (!gift) {
    container.append(el('p', null, `No gift called "${state.id}".`));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, gift.name));
  const category = gift.category ? index.byCategoryId.get(gift.category) : null;
  container.append(el('p', 'meta', `Category: ${category ? category.label : 'not recorded yet'} · Rarity: ${gift.rarity ?? 'not recorded yet'}`));
  if (category?.inGameDescriptor) {
    container.append(el('p', 'descriptor', `In-game description mentions: “${category.inGameDescriptor}”`));
  }
  if (!gift.category) {
    container.append(el('p', 'help-wanted', 'Nobody has recorded this item’s category yet, so it has no predictions.'));
  }

  const rows = giftRows(index, gift.id, state.filters);
  if (rows.length === 0) {
    container.append(emptyState(state.filters.hideUnconfirmed
      ? 'No confirmed results yet — nobody has reported giving this item. Clear “Hide unconfirmed predictions” to see predictions.'
      : 'No characters match the current filters. Clear “Hide untested pairs” to see the rest.'));
    return;
  }

  const table = el('table', 'gift-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const h of ['Character', 'Status', 'Points']) {
    const th = el('th', null, h);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);
  const body = el('tbody');
  for (const { character, confidence } of rows) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    nameCell.append(link);
    const statusCell = el('td');
    statusCell.append(badge(confidence, index));
    row.append(nameCell, statusCell, el('td', null, confidence.points === null ? '' : `${confidence.points} pts`));
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}
