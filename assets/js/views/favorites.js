import { RARITY_ORDER } from '../confidence.js';
import { el } from './shared.js';

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

    const gifts = index.gifts.filter((gift) => index.confidenceFor(character.id, gift.id).state === 'FAVORITE');
    if (gifts.length) found.push({ character, gifts });
    else unknown.push({ character, suggestions: suggestionsFor(index, character) });
  }

  return { found, unknown };
}

export function render(container, index, state) {
  const { found, unknown } = favoritesModel(index, state.filters);

  container.append(el('h2', null, 'Favourites hunt'));
  container.append(el('p', 'intro', 'Every character has at least one item that gives double support points. Most are still unknown. If you find one, report it — this is the gap no other guide fills.'));
  container.append(el('p', 'progress', `Found ${found.length} of ${found.length + unknown.length}.`));

  container.append(el('h3', null, `Still unknown (${unknown.length})`));
  const list = el('ul', 'favorites-unknown');
  for (const { character, suggestions } of unknown) {
    const item = el('li');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    item.append(link);
    const hint = suggestions.length
      ? ` — worth trying: ${suggestions.slice(0, 5).map((g) => g.name).join(', ')}`
      : ' — no predicted categories yet, so no suggestions';
    item.append(el('span', 'suggestions', hint));
    list.append(item);
  }
  container.append(list);

  if (found.length) {
    container.append(el('h3', null, `Found (${found.length})`));
    const foundList = el('ul', 'favorites-found');
    for (const { character, gifts } of found) {
      const item = el('li');
      const link = el('a', null, character.name);
      link.href = `#/character/${character.id}`;
      item.append(link, el('span', null, ` — ${gifts.map((g) => g.name).join(', ')}`));
      foundList.append(item);
    }
    container.append(foundList);
  }
}
