import { passesFilters } from '../filters.js';
import { sortByConfidence, badge, el, emptyState, sourceName, reportButton } from './shared.js';
import { voteControl, voteControlModel } from '../vote-control.js';

export function characterRows(index, characterId, filters) {
  const rows = index.gifts
    .map((gift) => ({ gift, confidence: index.confidenceFor(characterId, gift.id) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

// Pure so the detail route's branching is testable without a DOM. Order matters:
// the missing check runs first, because every later check dereferences character.
export function detailStatus(character, filters) {
  if (!character) return 'missing';
  if (filters.hideSpoilers && character.spoiler) return 'hidden-spoiler';
  if (!character.giftable) return 'not-giftable';
  return 'ok';
}

function renderPicker(container, index, state) {
  const list = el('ul', 'picker');
  let count = 0;
  for (const ch of index.characters) {
    if (!ch.giftable) continue;
    if (state.filters.hideSpoilers && ch.spoiler) continue;
    if (state.search && !ch.name.toLowerCase().includes(state.search)) continue;
    const item = el('li');
    const link = el('a', null, ch.name);
    link.href = `#/character/${ch.id}`;
    item.append(link);
    list.append(item);
    count += 1;
  }
  container.append(el('h2', null, 'Pick a character'));
  if (count === 0) {
    container.append(emptyState(state.search
      ? `No character’s name matches “${state.search}”.`
      : 'No characters to show. Untick “Hide spoilers” to see every character.'));
    return;
  }
  container.append(list);
}

// Liked categories are guide-derived: every one is an unconfirmed guess until a
// player reports an actual result. A refuted link is not a like, so it is left out.
function renderLikedCategories(container, index, character) {
  const links = Object.entries(character.categories ?? {}).filter(([, link]) => link.state !== 'refuted');
  if (links.length === 0) return;

  const list = el('ul', 'liked-categories');
  for (const [categoryId, link] of links) {
    const label = index.byCategoryId.get(categoryId)?.label ?? categoryId;
    const item = el('li', `liked-category provenance-${link.state}`, label);
    if (link.state === 'guide') item.append(el('span', 'unconfirmed-tag', ' — unconfirmed'));
    list.append(item);
  }

  const publishers = [...new Set(links.map(([, link]) => link.source).filter(Boolean).map((s) => sourceName(index, s)))];
  container.append(el('h3', null, 'Reported to like'));
  container.append(list);
  container.append(el('p', 'provenance-note', publishers.length
    ? `Category preferences carried over from ${publishers.join(' and ')}. Nobody has confirmed them item by item yet.`
    : 'Category preferences are unconfirmed until a player reports an actual result.'));
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const character = index.byCharacterId.get(state.id);
  const status = detailStatus(character, state.filters);

  if (status === 'missing') {
    container.append(el('p', null, `No character called "${state.id}".`));
    return renderPicker(container, index, state);
  }

  if (status === 'hidden-spoiler') {
    // Don't print the name: on a spoiler character the name is the spoiler.
    container.append(el('p', 'help-wanted', 'This character is hidden while “Hide spoilers” is on. Untick “Hide spoilers” to see them.'));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, character.name));
  if (character.notes) container.append(el('p', 'notes', character.notes));

  if (status === 'not-giftable') {
    container.append(el('p', 'help-wanted', 'This character can’t be given gifts, so there is nothing to test here.'));
    return;
  }

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
    // Guide-derived and still unresolved in the spec: never stated as fact.
    container.append(el('p', 'rarity-pref', `Reported to prefer ${character.rarityPreference === 'rare' ? 'rare' : 'uncommon or rare'} items — unconfirmed.`));
  }

  renderLikedCategories(container, index, character);

  const rows = characterRows(index, character.id, state.filters);
  container.append(el('h3', null, 'Gifts'));
  if (rows.length === 0) {
    container.append(emptyState(state.filters.hideUnconfirmed
      ? 'No confirmed results yet — nobody has reported one for this character. Clear “Hide unconfirmed predictions” to see predictions.'
      : 'No gifts match the current filters. Clear “Hide untested pairs” to see the rest.'));
    return;
  }

  const table = el('table', 'gift-table');
  const body = el('tbody');
  for (const { gift, confidence } of rows) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    nameCell.append(link);
    row.append(nameCell);
    row.append(el('td', null, gift.category ? index.byCategoryId.get(gift.category).label : '—'));
    row.append(el('td', null, gift.rarity ?? '—'));
    const statusCell = el('td');
    statusCell.append(badge(confidence, index));
    if (confidence.state === 'PENDING' && state.submissionsEnabled) {
      for (const report of index.pendingFor(character.id, gift.id)) {
        statusCell.append(voteControl(voteControlModel(report, state.storage)));
      }
    }
    row.append(statusCell);
    if (state.submissionsEnabled) {
      const actionCell = el('td');
      actionCell.append(reportButton(character.id, gift.id));
      row.append(actionCell);
    }
    body.append(row);
  }
  const head = el('thead');
  const headRow = el('tr');
  const headers = ['Gift', 'Category', 'Rarity', 'Status'];
  if (state.submissionsEnabled) headers.push('Report');
  for (const h of headers) {
    const th = el('th', null, h);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head, body);
  container.append(table);
}
