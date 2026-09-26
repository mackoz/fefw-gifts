// PENDING sits between the observed states and the guesses: a real player
// reported it, but nobody has reviewed it yet.
const STATE_RANK = { FAVORITE: 0, CONFIRMED: 1, CONTESTED: 2, PENDING: 3, PREDICTED: 4, UNTESTED: 5 };

const REACTION_LABEL = {
  none: 'No support gain',
  slight: 'Small gain',
  liked: 'Moderate gain',
  loved: 'Big gain',
  favorite: 'Double points',
};

export function sortByConfidence(rows) {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (STATE_RANK[a.row.confidence.state] - STATE_RANK[b.row.confidence.state]) || (a.i - b.i))
    .map(({ row }) => row);
}

// Never describe an unobserved pair as disliked: absence of a match is not
// evidence. Only a reported reaction may read as a negative.
export function stateLabel(confidence) {
  switch (confidence.state) {
    case 'FAVORITE': return 'Favourite — double points';
    case 'CONFIRMED': return `Confirmed: ${REACTION_LABEL[confidence.reaction] ?? 'reported'}`;
    case 'CONTESTED': return 'Reports disagree';
    case 'PENDING': return 'Reported — awaiting review';
    case 'PREDICTED': return confidence.predicted === 'negative' ? 'Predicted: probably no gain' : 'Predicted — not yet confirmed';
    default: return 'Not tested yet';
  }
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function stateClasses(confidence) {
  const classes = [`state-${confidence.state.toLowerCase()}`];
  if (confidence.provenance) classes.push(`provenance-${confidence.provenance}`);
  if (confidence.isException) classes.push('is-exception');
  if (confidence.rarityMismatch) classes.push('rarity-mismatch');
  return classes.join(' ');
}

// An empty result is a state worth explaining. Rendering a bare heading reads as
// breakage, especially with "hide unconfirmed" on, which is empty by design until
// the first player report lands.
export function emptyState(message) {
  return el('p', 'empty-state', message);
}

// A prediction's provenance is only meaningful if the reader can see whose guide
// it came from. Falls back to the raw id rather than inventing a publisher.
export function sourceName(index, sourceId) {
  return index?.bySourceId?.get(sourceId)?.publisher ?? sourceId;
}

// The state classes are a pill badge: inline-flex, with ::before/::after content.
// They must only ever land on an inline element -- never a <tr> or <td>, which a
// display change removes from the table layout.
export function badge(confidence, index) {
  const node = el('span', stateClasses(confidence), stateLabel(confidence));
  if (confidence.state === 'PREDICTED' && confidence.source) {
    // Title only: the visible text must keep saying "predicted", not who guessed.
    node.title = `Prediction carried over from ${sourceName(index, confidence.source)} — no player has confirmed it.`;
  }
  return node;
}

// Table cells get tint-only classes instead. No display change, and no
// pseudo-elements: the caller already renders its own visible symbol as the
// cell's text, so a ::before would duplicate it.
export function cellClasses(confidence) {
  const classes = [`cell-${confidence.state.toLowerCase()}`];
  if (confidence.isException) classes.push('cell-exception');
  if (confidence.rarityMismatch) classes.push('cell-rarity-mismatch');
  return classes.join(' ');
}

// A per-pair report trigger. It carries its ids in dataset attributes and does
// nothing itself: app.js listens once on the container and opens the dialog.
export function reportButton(characterId, giftId) {
  const button = el('button', 'report-button', 'Report');
  button.type = 'button';
  button.dataset.character = characterId;
  button.dataset.gift = giftId;
  button.setAttribute('aria-label', 'Report a result for this pair');
  return button;
}

// A per-pair report trigger styled as a chip, for the dense untested/suggestion
// grids. Like reportButton, what matters is not the markup but the contract
// with app.js's delegated listener: the class must be exactly `report-button`
// and the ids must land in `dataset.character`/`dataset.gift`. Each call site
// keeps choosing its own label and aria-label -- see character.js, gift.js and
// favorites.js, which deliberately differ on the aria-label's wording.
export function reportChip(characterId, giftId, label, { ariaLabel } = {}) {
  const button = el('button', 'chip chip-action report-button', label);
  button.type = 'button';
  button.dataset.character = characterId;
  button.dataset.gift = giftId;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  return button;
}

// Splits confidence-sorted rows into the half that carries a signal and the
// half nobody has tried. The caller renders them differently: a table for what
// is known, a dense chip grid for what is not. Input order is preserved, so a
// list already sorted by confidence stays sorted.
export function partitionRows(rows) {
  const signal = [];
  const untested = [];
  for (const row of rows) {
    (row.confidence.state === 'UNTESTED' ? untested : signal).push(row);
  }
  return { signal, untested };
}

// A category is "confirmed" for a character when at least one gift in it has
// an approved observation with a LOVED reaction. A favourite reaction only
// happens on an uncommon/rare item, so a FAVORITE result says something about
// that item, not its category -- and a common item in the same category may
// not even be loved. Liked and slight are real, approved, positive results,
// but they don't establish a category either: only loved does. CONTESTED,
// PENDING and PREDICTED are all real signal elsewhere in the app, but none of
// them is an approved loved result, so none of them may promote a category
// here -- see CLAUDE.md's "A pending report is not a confirmation." A
// character with no `id` (not yet resolved) has no confirmed categories
// rather than crashing on confidenceFor.
function confirmedCategoryIds(index, character) {
  const ids = new Set();
  if (character.id === undefined) return ids;
  for (const gift of index.gifts) {
    if (gift.category === null || gift.category === undefined) continue;
    if (ids.has(gift.category)) continue;
    const confidence = index.confidenceFor(character.id, gift.id);
    const confirmed = confidence.state === 'CONFIRMED' && confidence.reaction === 'loved';
    if (confirmed) ids.add(gift.category);
  }
  return ids;
}

// A character's category chips, merging two sources that make very different
// claims: a stored link (a guide's guess, an in-game profile listing, or
// something discovered through play) and a category a loved result has
// actually confirmed. A FAVORITE, and a liked or slight reaction, are real
// approved results, but none of them confirms a category on their own -- see
// confirmedCategoryIds. Testing outranks a stored link -- a loved result is
// stronger evidence than any prediction, including a refuted one -- so a
// confirmed category always renders with state 'confirmed', carrying
// whatever source its stored link has (or null if it has none), and confirmed
// chips sort first, in categories.json order. A refuted link on a category
// nobody has confirmed is still dropped: a refuted link alone is not a like,
// and rendering it as one would invent a preference nobody reported.
export function categoryChips(index, character) {
  const links = character.categories ?? {};
  const confirmedIds = confirmedCategoryIds(index, character);
  const categoryPosition = new Map(index.categories.map((c, i) => [c.id, i]));

  const confirmedChips = [...confirmedIds]
    .sort((a, b) => (categoryPosition.get(a) ?? 0) - (categoryPosition.get(b) ?? 0))
    .map((id) => ({
      id,
      label: index.byCategoryId.get(id)?.label ?? id,
      state: 'confirmed',
      source: links[id]?.source ?? null,
    }));

  const linkChips = Object.entries(links)
    .filter(([id, link]) => link.state !== 'refuted' && !confirmedIds.has(id))
    .map(([id, link]) => ({
      id,
      label: index.byCategoryId.get(id)?.label ?? id,
      state: link.state,
      source: link.source,
    }));

  return [...confirmedChips, ...linkChips];
}

// A character's favourite gifts: the same union favoritesModel builds for the
// Favourites tab, so a card or profile can never disagree with that tab about
// which items are known favourites. Two independent ways to know one -- a
// player report that came back FAVORITE, and the character's own `favorites`
// list -- combined with no gift listed twice, observed ones first in
// index.gifts order, then declared ones not already present. A character with
// no `id` (not yet resolved) can't be looked up by confidenceFor, so only its
// declared favourites count.
export function favouriteGifts(index, character) {
  const declared = (character.favorites ?? []).map((id) => index.byGiftId.get(id)).filter(Boolean);
  if (character.id === undefined) return declared;
  const observed = index.gifts.filter((gift) => index.confidenceFor(character.id, gift.id).state === 'FAVORITE');
  return [...new Map([...observed, ...declared].map((gift) => [gift.id, gift])).values()];
}

// A small inline token: a category, a gift name, a suggestion. It renders as a
// link when it has a destination and as a plain span when it does not, so
// nothing ever looks clickable without being clickable.
export function chip(text, { href, className } = {}) {
  const classes = ['chip', className].filter(Boolean).join(' ');
  const node = el(href ? 'a' : 'span', classes, text);
  if (href) node.href = href;
  return node;
}
