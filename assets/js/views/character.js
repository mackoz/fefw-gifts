import { passesFilters } from '../filters.js';
import {
  sortByConfidence, badge, el, emptyState, sourceName, reportButton, reportChip,
  partitionRows, categoryChips, favouriteGifts, chip,
} from './shared.js';
import { POSITIVE_REACTIONS } from '../confidence.js';
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
  // Same favouriteGifts union shared.js exports, so this and the Favourites
  // tab can never disagree about whether a favourite is known.
  const favouriteCount = favouriteGifts(index, character).length;
  let confirmed = 0;
  let tested = 0;
  let contested = 0;
  let pending = 0;
  let predicted = 0;

  for (const gift of index.gifts) {
    const confidence = index.confidenceFor(character.id, gift.id);
    // A CONFIRMED row is only a "confirmed" gift when the reaction is
    // positive. The report form's first option is "They didn't like it", so
    // a CONFIRMED "none" reaction is common -- and reporting it as one of "N
    // confirmed" would read as N gifts that work, the opposite of what
    // happened. "Tested" is deliberately neutral: it neither claims the gift
    // worked nor implies the character dislikes things (see CLAUDE.md).
    if (confidence.state === 'CONFIRMED' && POSITIVE_REACTIONS.includes(confidence.reaction)) confirmed += 1;
    else if (confidence.state === 'CONFIRMED') tested += 1;
    else if (confidence.state === 'CONTESTED') contested += 1;
    else if (confidence.state === 'PENDING') pending += 1;
    // A refuted-category prediction is a guess that the gift will NOT land --
    // it is not something "worth trying", so only a positive prediction
    // counts here. See suggestionsFor in favorites.js, which this mirrors.
    else if (confidence.state === 'PREDICTED' && confidence.predicted === 'positive') predicted += 1;
  }

  if (favouriteCount > 0) return `${favouriteCount} favourite${favouriteCount === 1 ? '' : 's'} found`;
  if (confirmed > 0) return `${confirmed} confirmed`;
  if (tested > 0) return `${tested} tested`;
  // CONTESTED and PENDING sit between confirmed and predicted, and they are
  // the reason this chain cannot simply fall through to "nothing tested yet":
  // both mean somebody HAS tested this character. Omitting them made the index
  // say nothing had been tested while approved, contradicting observations sat
  // in data/ -- untrue the moment the site gets its first real report.
  // Neither is stated as a confirmation: contested reports disagree, and a
  // pending one is unreviewed.
  if (contested > 0) return `${contested} contested`;
  if (pending > 0) return `${pending} awaiting review`;
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
      favourites: favouriteGifts(index, character),
      summary: characterSummary(index, character),
    }));
}

const OBSERVED = new Set(['FAVORITE', 'CONFIRMED', 'CONTESTED']);

// Four cases, because three was still an overclaim. "What we know" may only
// appear over rows that contain something somebody actually OBSERVED and had
// reviewed; a pending report is a real player's result, but nobody has
// reviewed it yet, so it is not knowledge either -- it gets its own heading
// rather than falling into "What we know" or all the way through to
// "Predictions". "Worth trying" may only appear when every guess is that the
// gift WILL land, since a refuted-category prediction is a guess that it
// will not.
export function signalHeading(rows) {
  if (rows.some((row) => OBSERVED.has(row.confidence.state))) return 'What we know';
  if (rows.some((row) => row.confidence.state === 'PENDING')) return 'Awaiting review';
  return rows.every((row) => row.confidence.predicted === 'positive') ? 'Worth trying' : 'Predictions';
}

// Favourite chips render first, then category chips -- a favourite is
// stronger evidence about that one item than any category link, so it leads.
// `favourites` defaults to none, which is all the "Reported to like" list on
// the page ever passes; the card and the page's own Favourites block are the
// two callers that pass gifts through it.
function chipList(entries, favourites = []) {
  const list = el('ul', 'chip-list character-chips');
  // Safari/VoiceOver drops role="list" implicit in <ul> once list-style: none
  // meets display: grid/flex, so it has to be set back explicitly.
  list.setAttribute('role', 'list');
  for (const gift of favourites) {
    const item = el('li');
    item.append(chip(gift.name, { href: `#/gift/${gift.id}`, className: 'chip-favourite' }));
    list.append(item);
  }
  for (const entry of entries) {
    const item = el('li');
    item.append(chip(entry.label, { className: `provenance-${entry.state}` }));
    list.append(item);
  }
  return list;
}

// Builds a list string with no Oxford comma: 1 -> "A", 2 -> "A and B",
// 3+ -> "A, B and C".
function joinList(labels) {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// The chips under "Reported to like" mix four very different claims: a
// category with an approved test result behind it, a guide's guess (carried
// over, unconfirmed), an in-game profile listing, and something a player
// actually found through play. The bug this replaces said "carried over"
// about all three stored-link kinds, which overclaimed for the profile and
// discovered ones -- only the guide sentence is actually a guess. Each group
// gets its own sentence, and a fourth group -- confirmed through testing --
// now leads, since it is the strongest claim a chip can make; the guide
// sentence is demoted to "the rest" once something stronger sits above it.
export function provenanceNote(index, chips) {
  if (chips.length === 0) return '';

  const confirmed = chips.filter((c) => c.state === 'confirmed');
  const discovered = chips.filter((c) => c.state === 'discovered');
  const profile = chips.filter((c) => c.state === 'profile');
  const guide = chips.filter((c) => c.state === 'guide');

  const sentences = [];

  // At exactly one confirmed chip, the sentence names the category and reads
  // the same whether or not other groups are present, so that case is
  // resolved before the "only group" check even runs.
  if (confirmed.length === 1) {
    sentences.push(`${confirmed[0].label} has at least one gift loved in testing.`);
  } else if (confirmed.length > 1) {
    if (discovered.length === 0 && profile.length === 0 && guide.length === 0) {
      sentences.push('Each has at least one gift loved in testing.');
    } else {
      sentences.push(`${joinList(confirmed.map((c) => c.label))} each have at least one gift loved in testing.`);
    }
  }

  if (discovered.length > 0) {
    if (guide.length === 0 && profile.length === 0 && confirmed.length === 0) {
      sentences.push('Found through play.');
    } else {
      const verb = discovered.length === 1 ? 'was' : 'were';
      sentences.push(`${joinList(discovered.map((c) => c.label))} ${verb} found through play.`);
    }
  }

  if (profile.length > 0) {
    const verb = profile.length === 1 ? 'is' : 'are';
    sentences.push(`${joinList(profile.map((c) => c.label))} ${verb} on the in-game profile.`);
  }

  if (guide.length > 0) {
    const publishers = [...new Set(guide.map((c) => sourceName(index, c.source)))];
    sentences.push(discovered.length === 0 && profile.length === 0 && confirmed.length === 0
      ? `Category preferences carried over from ${publishers.join(' and ')}. They’re predictions until a player reports loving an item in that category.`
      : `The rest are carried over from ${publishers.join(' and ')} and are predictions until a player reports loving an item in that category.`);
  }

  return sentences.join(' ');
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
  grid.setAttribute('role', 'list');
  for (const entry of entries) {
    const item = el('li', 'tessera');
    const link = el('a', 'tessera-name', entry.character.name);
    link.href = `#/character/${entry.character.id}`;
    item.append(link);
    if (entry.favourites.length || entry.categories.length) item.append(chipList(entry.categories, entry.favourites));
    item.append(el('p', 'tessera-summary', entry.summary));
    grid.append(item);
  }
  container.append(grid);
}

// Profile and rarity render only when the data exists. Today no character has
// traits, and a heading followed by "nobody has entered this yet" on all 53
// pages is furniture, not information.
function renderProfile(container, index, character) {
  const entries = character.traits ?? [];
  if (entries.length > 0) {
    const list = el('ul', 'traits');
    for (const t of entries) {
      const item = el('li', t.category ? 'trait' : 'trait trait-flavor', t.text);
      if (!t.category) item.append(el('span', 'flavor-tag', ' (flavour — not a gift type)'));
      list.append(item);
    }
    container.append(el('h3', null, 'Profile'), list);
  }

  if (character.rarityPreference) {
    // Guide-derived and still unresolved in the spec: never stated as fact.
    container.append(el('p', 'rarity-pref', `Reported to prefer ${character.rarityPreference === 'rare' ? 'rare' : 'uncommon or rare'} items — unconfirmed.`));
  }

  // Favourites lead the page, ahead of "Reported to like": a favourite is a
  // confirmed double-points item, the strongest claim this page can make about
  // a gift, and it says nothing about that item's category (see shared.js).
  const favourites = favouriteGifts(index, character);
  if (favourites.length > 0) {
    container.append(el('h3', null, 'Favourites'), chipList([], favourites));
  }

  const chips = categoryChips(index, character);
  if (chips.length === 0) return;

  container.append(el('h3', null, 'Reported to like'), chipList(chips));
  container.append(el('p', 'provenance-note', provenanceNote(index, chips)));
}

function giftTable(index, character, rows, state) {
  // Most gifts have no recorded rarity yet; the column only appears when a row has one.
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
  const scroll = el('div', 'table-scroll');
  scroll.append(table);
  return scroll;
}

// 75 of a character's 80 rows are untested. As a table that buries everything
// else; as chips it stays complete and one click from a report. Each chip is a
// report trigger carrying the same `.report-button` class app.js listens for,
// and degrades to a link to the gift when submissions are off.
function untestedBlock(character, rows, state) {
  const details = el('details', 'untested-block');
  details.append(el('summary', null, `Not tested yet (${rows.length})`));
  details.append(el('p', 'untested-note', 'Nobody has reported giving any of these to this character. Any one of them is worth a report.'));

  const grid = el('ul', 'chip-list');
  grid.setAttribute('role', 'list');
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
