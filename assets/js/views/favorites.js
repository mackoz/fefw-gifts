import { RARITY_ORDER } from '../confidence.js';
import { el, emptyState, chip } from './shared.js';

function suggestionsFor(index, character) {
  return index.gifts
    .filter((gift) => {
      const confidence = index.confidenceFor(character.id, gift.id);
      // Worth trying: predicted to land, and nobody has tried it yet.
      return confidence.state === 'PREDICTED' && confidence.predicted === 'positive';
    })
    .sort((a, b) => (RARITY_ORDER[b.rarity] ?? -1) - (RARITY_ORDER[a.rarity] ?? -1));
}

export function favoritesModel(index, filters) {
  const found = [];
  const unknown = [];

  for (const character of index.characters) {
    if (!character.giftable) continue;
    if (filters.hideSpoilers && character.spoiler) continue;

    // Two independent ways to know a favourite: a player report that came back
    // FAVORITE, and the character's own `favorites` list. Either one solves the
    // character; the list shown is their union, with no gift listed twice.
    const observed = index.gifts.filter((gift) => index.confidenceFor(character.id, gift.id).state === 'FAVORITE');
    const declared = (character.favorites ?? []).map((id) => index.byGiftId.get(id)).filter(Boolean);
    const gifts = [...new Map([...observed, ...declared].map((gift) => [gift.id, gift])).values()];

    if (gifts.length) found.push({ character, gifts });
    else unknown.push({ character, suggestions: suggestionsFor(index, character) });
  }

  return { found, unknown };
}

// Each suggestion is a report trigger rather than plain text: this tab exists
// to recruit the one result no other guide has, so the suggestion and the way
// to report it are the same control. It carries the `.report-button` class
// app.js listens for, and degrades to a link when submissions are off.
function suggestionChips(character, suggestions, state) {
  const list = el('ul', 'chip-list');
  for (const gift of suggestions.slice(0, 6)) {
    const item = el('li');
    if (state.submissionsEnabled) {
      const button = el('button', 'chip chip-action report-button', gift.name);
      button.type = 'button';
      button.dataset.character = character.id;
      button.dataset.gift = gift.id;
      button.setAttribute('aria-label', `Report a result for ${gift.name} on ${character.name}`);
      item.append(button);
    } else {
      item.append(chip(gift.name, { href: `#/gift/${gift.id}` }));
    }
    list.append(item);
  }
  return list;
}

export function render(container, index, state) {
  const { found, unknown } = favoritesModel(index, state.filters);
  const total = found.length + unknown.length;

  container.append(el('h2', null, 'Favourites hunt'));
  container.append(el('p', 'intro', 'Every character has at least one item that gives double support points. Most are still unknown. If you find one, report it — this is the gap no other guide fills.'));

  if (total === 0) {
    container.append(emptyState('No characters to show. Untick “Hide spoilers” to see every character.'));
    return;
  }

  container.append(el('p', 'progress', `Found ${found.length} of ${total}.`));

  container.append(el('h3', null, `Still unknown (${unknown.length})`));
  if (unknown.length === 0) {
    container.append(emptyState('Nothing left to hunt — every character here has a known favourite.'));
  } else {
    const list = el('ul', 'hunt-list');
    for (const { character, suggestions } of unknown) {
      const item = el('li', 'hunt-row');
      const link = el('a', 'hunt-name', character.name);
      link.href = `#/character/${character.id}`;
      item.append(link);
      if (suggestions.length === 0) {
        item.append(el('p', 'hunt-note', 'Nothing untested left to suggest — try anything not yet reported.'));
      } else {
        item.append(suggestionChips(character, suggestions, state));
      }
      list.append(item);
    }
    container.append(list);
  }

  if (found.length === 0) return;

  container.append(el('h3', null, `Found (${found.length})`));
  const foundList = el('ul', 'hunt-list');
  for (const { character, gifts } of found) {
    const item = el('li', 'hunt-row');
    const link = el('a', 'hunt-name', character.name);
    link.href = `#/character/${character.id}`;
    item.append(link);
    const chips = el('ul', 'chip-list');
    for (const gift of gifts) {
      const li = el('li');
      li.append(chip(gift.name, { href: `#/gift/${gift.id}`, className: 'chip-favourite' }));
      chips.append(li);
    }
    item.append(chips);
    foundList.append(item);
  }
  container.append(foundList);
}
