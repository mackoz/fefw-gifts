import { passesFilters } from '../filters.js';
import { sortByConfidence, badge, el, emptyState, reportButton, reportChip, partitionRows, chip } from './shared.js';
import { voteControl, voteControlModel } from '../vote-control.js';

export function giftRows(index, giftId, filters) {
  const rows = index.characters
    .filter((character) => character.giftable)
    .filter((character) => !(filters.hideSpoilers && character.spoiler))
    .map((character) => ({ character, confidence: index.confidenceFor(character.id, giftId) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

// Groups the index so 80 alphabetical bullets become sections a player can
// scan. The uncategorised group sorts last under its own heading: 26 items
// nobody has classified is a to-do, not an error.
export function giftIndexModel(index, search) {
  const term = (search ?? '').trim();
  const matching = index.gifts.filter((gift) => !term || gift.name.toLowerCase().includes(term));

  const groups = new Map();
  for (const gift of matching) {
    const key = gift.category ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(gift);
  }

  const named = [...groups.entries()]
    .filter(([key]) => key !== null)
    .map(([key, gifts]) => ({ id: key, label: index.byCategoryId.get(key)?.label ?? key, gifts }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));

  const uncategorised = groups.get(null);
  if (uncategorised) named.push({ id: null, label: 'Category not recorded yet', gifts: uncategorised });
  return named;
}

// The Gifts tab's way into a missing-item report. Like reportButton, it does
// nothing itself: app.js's delegated listener reads `dataset.name` and opens
// the report dialog in missing-item mode with the name pre-filled.
export function missingItemButton(query) {
  const button = el('button', 'missing-item-button', `Report ‘${query}’ as a missing item`);
  button.type = 'button';
  button.dataset.name = query;
  return button;
}

function renderPicker(container, index, state) {
  const groups = giftIndexModel(index, state.search);
  container.append(el('h2', null, 'Gifts'));

  if (groups.length === 0) {
    container.append(emptyState(state.search
      ? `No gift’s name matches “${state.search}”.`
      : 'No gifts have been recorded yet.'));
    // Only with the Worker configured: with submissions off there is nowhere
    // to send a report, and the page must look as it did before. The typed
    // text is offered, not the lower-cased copy used for matching.
    if (state.search && state.submissionsEnabled) {
      container.append(missingItemButton(state.searchText || state.search));
    }
    return;
  }

  for (const group of groups) {
    container.append(el('h3', null, `${group.label} (${group.gifts.length})`));
    if (group.id === null) {
      container.append(el('p', 'untested-note', 'Nobody has recorded what kind of item these are, so they have no predictions yet.'));
    }
    const list = el('ul', 'chip-list');
    // Safari/VoiceOver drops role="list" implicit in <ul> once list-style:
    // none meets display: grid/flex, so it has to be set back explicitly.
    list.setAttribute('role', 'list');
    for (const gift of group.gifts) {
      const item = el('li');
      // Rarity rides on the chip where it is recorded; most gifts have none yet.
      const label = gift.rarity ? `${gift.name} (${gift.rarity})` : gift.name;
      item.append(chip(label, { href: `#/gift/${gift.id}` }));
      list.append(item);
    }
    container.append(list);
  }
}

function characterTable(index, gift, rows, state) {
  const headers = ['Character', 'Status'];
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
  for (const { character, confidence } of rows) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    nameCell.append(link);

    const statusCell = el('td');
    statusCell.append(badge(confidence, index));
    if (confidence.state === 'PENDING' && state.submissionsEnabled) {
      for (const report of index.pendingFor(character.id, gift.id)) {
        statusCell.append(voteControl(voteControlModel(report, state.storage)));
      }
    }
    row.append(nameCell, statusCell);

    if (state.submissionsEnabled) {
      const actionCell = el('td');
      actionCell.append(reportButton(character.id, gift.id));
      row.append(actionCell);
    }
    body.append(row);
  }

  const table = el('table', 'gift-table');
  table.append(head, body);
  const scroll = el('div', 'table-scroll');
  scroll.append(table);
  return scroll;
}

// The same treatment the character page gives its 75 untested gifts: a dense
// chip grid rather than 48 identical table rows, each chip a report trigger
// carrying the `.report-button` class app.js listens for.
function untestedBlock(gift, rows, state) {
  const details = el('details', 'untested-block');
  details.append(el('summary', null, `Not tested yet (${rows.length})`));
  details.append(el('p', 'untested-note', `Nobody has reported giving ${gift.name} to any of these characters. Any one of them is worth a report.`));

  const grid = el('ul', 'chip-list');
  grid.setAttribute('role', 'list');
  for (const { character } of rows) {
    const item = el('li');
    if (state.submissionsEnabled) {
      item.append(reportChip(character.id, gift.id, character.name, { ariaLabel: `Report a result for ${character.name}` }));
    } else {
      item.append(chip(character.name, { href: `#/character/${character.id}` }));
    }
    grid.append(item);
  }

  details.append(grid);
  return details;
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const gift = index.byGiftId.get(state.id);
  if (!gift) {
    container.append(el('p', null, `No gift called “${state.id}”.`));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, gift.name));

  const category = gift.category ? index.byCategoryId.get(gift.category) : null;
  // One fact per line rather than a middle-dot-joined string, and rarity only
  // when it is recorded.
  if (category) container.append(el('p', 'meta', `Category: ${category.label}`));
  if (gift.rarity) container.append(el('p', 'meta', `Rarity: ${gift.rarity}`));
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

  const { signal, untested } = partitionRows(rows);
  if (signal.length > 0) {
    // Deliberately the neutral noun, not signalHeading(): this page is scoped
    // to one gift, and a heading here would have to characterise a mix of
    // states across characters, which risks overclaiming. Do not change this
    // to signalHeading().
    container.append(el('h3', null, 'Characters'));
    container.append(characterTable(index, gift, signal, state));
  }
  if (untested.length > 0) container.append(untestedBlock(gift, untested, state));
}
