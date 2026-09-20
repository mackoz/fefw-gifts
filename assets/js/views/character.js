import { passesFilters } from '../filters.js';
import { sortByConfidence, stateLabel, stateClasses, el } from './shared.js';

export function characterRows(index, characterId, filters) {
  const rows = index.gifts
    .map((gift) => ({ gift, confidence: index.confidenceFor(characterId, gift.id) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

function renderPicker(container, index, state) {
  const list = el('ul', 'picker');
  for (const ch of index.characters) {
    if (!ch.giftable) continue;
    if (state.filters.hideSpoilers && ch.spoiler) continue;
    if (state.search && !ch.name.toLowerCase().includes(state.search)) continue;
    const item = el('li');
    const link = el('a', null, ch.name);
    link.href = `#/character/${ch.id}`;
    item.append(link);
    list.append(item);
  }
  container.append(el('h2', null, 'Pick a character'), list);
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const character = index.byCharacterId.get(state.id);
  if (!character) {
    container.append(el('p', null, `No character called "${state.id}".`));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, character.name));
  if (character.notes) container.append(el('p', 'notes', character.notes));

  if (character.traits.length === 0) {
    container.append(el('p', 'help-wanted', 'Nobody has entered this character’s in-game profile yet.'));
  } else {
    const traits = el('ul', 'traits');
    for (const t of character.traits) {
      const item = el('li', t.category ? 'trait' : 'trait trait-flavor', t.text);
      if (!t.category) item.append(el('span', 'flavor-tag', ' (flavour — not a gift type)'));
      traits.append(item);
    }
    container.append(el('h3', null, 'Profile'), traits);
  }

  if (character.rarityPreference) {
    container.append(el('p', 'rarity-pref', `Prefers ${character.rarityPreference === 'rare' ? 'rare' : 'uncommon or rare'} items.`));
  }

  const table = el('table', 'gift-table');
  const body = el('tbody');
  for (const { gift, confidence } of characterRows(index, character.id, state.filters)) {
    const row = el('tr', stateClasses(confidence));
    const nameCell = el('td');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    nameCell.append(link);
    row.append(nameCell);
    row.append(el('td', null, gift.category ? index.byCategoryId.get(gift.category).label : '—'));
    row.append(el('td', null, gift.rarity ?? '—'));
    row.append(el('td', null, stateLabel(confidence)));
    row.append(el('td', null, confidence.points === null ? '' : `${confidence.points} pts`));
    body.append(row);
  }
  const head = el('thead');
  const headRow = el('tr');
  for (const h of ['Gift', 'Category', 'Rarity', 'Status', 'Points']) headRow.append(el('th', null, h));
  head.append(headRow);
  table.append(head, body);
  container.append(el('h3', null, 'Gifts'), table);
}
