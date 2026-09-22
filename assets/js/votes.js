const KEY = 'fefw-gifts-votes';

// Every access is wrapped. localStorage throws in a private window and when a
// site's data is blocked, and a vote button is not worth breaking a page over.
//
// This is UX hygiene, not security: it stops an accidental double-click and a
// casual repeat, and a private window bypasses it trivially. Turnstile and
// maintainer review are what actually contain abuse -- see the spec's
// "Anonymity and abuse" section.
export function readVotes(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function votedDirection(storage, reportId) {
  return readVotes(storage)[reportId] ?? null;
}

export function recordVote(storage, reportId, direction) {
  const votes = { ...readVotes(storage), [reportId]: direction };
  try {
    storage?.setItem(KEY, JSON.stringify(votes));
  } catch {
    // Nothing to do and nothing to tell the visitor: the vote itself landed on
    // the Worker, and this record is only a convenience.
  }
  return votes;
}
