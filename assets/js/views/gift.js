import { passesFilters } from '../filters.js';
import { sortByConfidence, badge, el } from './shared.js';

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
  for (const gift of index.gifts) {
    if (state.search && !gift.name.toLowerCase().includes(state.search)) continue;
    const item = el('li');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    item.append(link);
    list.append(item);
  }
  container.append(el('h2', null, 'Pick a gift'), list);
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

  const table = el('table', 'gift-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const h of ['Character', 'Status', 'Points']) headRow.append(el('th', null, h));
  head.append(headRow);
  const body = el('tbody');
  for (const { character, confidence } of giftRows(index, gift.id, state.filters)) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    nameCell.append(link);
    const statusCell = el('td');
    statusCell.append(badge(confidence));
    row.append(nameCell, statusCell, el('td', null, confidence.points === null ? '' : `${confidence.points} pts`));
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}
