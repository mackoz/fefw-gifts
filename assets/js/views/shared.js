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
