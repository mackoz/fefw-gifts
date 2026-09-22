import { passesFilters } from '../filters.js';
import {
  sortByConfidence, badge, el, emptyState, sourceName, reportButton, reportChip,
  partitionRows, categoryChips, chip,
} from './shared.js';
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

// The strongest true statement about a character, in a fixed order. It never
// implies a negative: a character nobody has tested reads as untested, not as
// one whose gifts fail.
export function characterSummary(index, character) {
  // Union by gift id, exactly as favoritesModel does, so this and the
  // Favourites tab can never disagree about whether a favourite is known.
  const favourites = new Set(
    (character.favorites ?? []).map((id) => index.byGiftId.get(id)).filter(Boolean).map((g) => g.id),
  );
  let confirmed = 0;
  let predicted = 0;

  for (const gift of index.gifts) {
    const confidence = index.confidenceFor(character.id, gift.id);
    if (confidence.state === 'FAVORITE') favourites.add(gift.id);
    else if (confidence.state === 'CONFIRMED') confirmed += 1;
    // A refuted-category prediction is a guess that the gift will NOT land --
    // it is not something "worth trying", so only a positive prediction
    // counts here. See suggestionsFor in favorites.js, which this mirrors.
    else if (confidence.state === 'PREDICTED' && confidence.predicted === 'positive') predicted += 1;
  }

  if (favourites.size > 0) return `${favourites.size} favourite${favourites.size === 1 ? '' : 's'} found`;
  if (confirmed > 0) return `${confirmed} confirmed`;
  if (predicted > 0) return `${predicted} worth trying`;
  return 'nothing tested yet';
}

export function characterIndexModel(index, filters, search) {
  return index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler))
    .filter((c) => !search || c.name.toLowerCase().includes(search))
    .map((character) => ({
      character,
      categories: categoryChips(index, character),
      summary: characterSummary(index, character),
    }));
}

// "Worth trying" is only true while every row is still a guess that the gift
// will land. A negative prediction (a refuted-category guess) present in the
// rows means the section is reporting a mix, including at least one item a
// guide says NOT to bother with -- so it is no longer purely suggestions.
export function signalHeading(rows) {
  return rows.every((row) => row.confidence.state === 'PREDICTED' && row.confidence.predicted === 'positive')
    ? 'Worth trying'
    : 'What we know';
}

function chipList(entries, className) {
  const list = el('ul', ['chip-list', className].filter(Boolean).join(' '));
  for (const entry of entries) {
    const item = el('li');
    item.append(chip(entry.label, { className: `provenance-${entry.state}` }));
    list.append(item);
  }
  return list;
}

function renderPicker(container, index, state) {
  const entries = characterIndexModel(index, state.filters, state.search);
  container.append(el('h2', null, 'Characters'));

  if (entries.length === 0) {
    container.append(emptyState(state.search
      ? `No character’s name matches “${state.search}”.`
      : 'No characters to show. Untick “Hide spoilers” to see every character.'));
    return;
  }

  const grid = el('ul', 'tessera-grid');
  for (const entry of entries) {
    const item = el('li', 'tessera');
    const link = el('a', 'tessera-name', entry.character.name);
    link.href = `#/character/${entry.character.id}`;
    item.append(link);
    if (entry.categories.length) item.append(chipList(entry.categories));
    item.append(el('p', 'tessera-summary', entry.summary));
    grid.append(item);
  }
  container.append(grid);
}

// Profile and rarity render only when the data exists. Today no character has
// traits, and a heading followed by "nobody has entered this yet" on all 53
// pages is furniture, not information.
function renderProfile(container, index, character) {
  if (character.traits.length > 0) {
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

  const chips = categoryChips(index, character);
  if (chips.length === 0) return;

  const publishers = [...new Set(chips.map((c) => c.source).filter(Boolean).map((s) => sourceName(index, s)))];
  container.append(el('h3', null, 'Reported to like'), chipList(chips));
  container.append(el('p', 'provenance-note', publishers.length
    ? `Category preferences carried over from ${publishers.join(' and ')}. Nobody has confirmed them item by item yet.`
    : 'Category preferences are unconfirmed until a player reports an actual result.'));
}

function giftTable(index, character, rows, state) {
  // No gift has a recorded rarity today, so the column would be 100% em-dashes.
  const showRarity = rows.some(({ gift }) => gift.rarity);

  const headers = ['Gift', 'Category'];
  if (showRarity) headers.push('Rarity');
  headers.push('Status');
  if (state.submissionsEnabled) headers.push('Report');

  const headRow = el('tr');
  for (const h of headers) {
    const th = el('th', null, h);
    th.scope = 'col';
    headRow.append(th);
  }
  const head = el('thead');
  head.append(headRow);

  const body = el('tbody');
  for (const { gift, confidence } of rows) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    nameCell.append(link);
    row.append(nameCell);
    row.append(el('td', null, gift.category ? (index.byCategoryId.get(gift.category)?.label ?? gift.category) : '—'));
    if (showRarity) row.append(el('td', null, gift.rarity ?? '—'));

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

  const table = el('table', 'gift-table');
  table.append(head, body);
  return table;
}

// 75 of a character's 80 rows are untested. As a table that buries everything
// else; as chips it stays complete and one click from a report. Each chip is a
// report trigger carrying the same `.report-button` class app.js listens for,
// and degrades to a link to the gift when submissions are off.
function untestedBlock(character, rows, state) {
  const details = el('details', 'untested-block');
  details.append(el('summary', null, `Not tested yet (${rows.length})`));
  details.append(el('p', 'untested-note', 'Nobody has given any of these to this character. Any one of them is worth a report.'));

  const grid = el('ul', 'chip-list');
  for (const { gift } of rows) {
    const item = el('li');
    if (state.submissionsEnabled) {
      item.append(reportChip(character.id, gift.id, gift.name, { ariaLabel: `Report a result for ${gift.name}` }));
    } else {
      item.append(chip(gift.name, { href: `#/gift/${gift.id}` }));
    }
    grid.append(item);
  }

  details.append(grid);
  return details;
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const character = index.byCharacterId.get(state.id);
  const status = detailStatus(character, state.filters);

  if (status === 'missing') {
    container.append(el('p', null, `No character called “${state.id}”.`));
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

  renderProfile(container, index, character);

  const rows = characterRows(index, character.id, state.filters);
  if (rows.length === 0) {
    container.append(el('h3', null, 'Gifts'));
    container.append(emptyState(state.filters.hideUnconfirmed
      ? 'No confirmed results yet — nobody has reported one for this character. Clear “Hide unconfirmed predictions” to see predictions.'
      : 'No gifts match the current filters. Clear “Hide untested pairs” to see the rest.'));
    return;
  }

  const { signal, untested } = partitionRows(rows);
  if (signal.length > 0) {
    container.append(el('h3', null, signalHeading(signal)));
    container.append(giftTable(index, character, signal, state));
  }
  if (untested.length > 0) container.append(untestedBlock(character, untested, state));
}
