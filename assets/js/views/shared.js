const STATE_RANK = { FAVORITE: 0, CONFIRMED: 1, CONTESTED: 2, PREDICTED: 3, UNTESTED: 4 };

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
