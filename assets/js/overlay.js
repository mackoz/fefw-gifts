// Groups the Worker's pending rows by (character, gift) so the confidence core
// can ask about one pair at a time. Pure, and defensive: these rows come off
// the network, and a malformed one must cost its own row and nothing else.
export function buildPendingIndex(rows) {
  const byPair = new Map();
  const all = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.character !== 'string' || typeof row.gift !== 'string') continue;
    if (!row.character || !row.gift) continue;

    const key = `${row.character}\u0000${row.gift}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(row);
    all.push(row);
  }

  return {
    all,
    pendingFor: (characterId, giftId) => byPair.get(`${characterId}\u0000${giftId}`) ?? [],
  };
}
