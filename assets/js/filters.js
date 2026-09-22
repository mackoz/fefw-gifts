export const VIEWS = ['character', 'gift', 'matrix', 'favorites'];

export const DEFAULT_FILTERS = {
  hideUntested: false,
  hideUnconfirmed: false,
  hideSpoilers: true,
};

// What survives "hide unconfirmed predictions". PENDING is in the list because
// it is a player's own report rather than a guide's guess -- which does not make
// it a confirmation, only something other than a prediction.
const OBSERVED = new Set(['CONFIRMED', 'FAVORITE', 'CONTESTED', 'PENDING']);

export function passesFilters(confidence, filters) {
  if (filters.hideUntested && confidence.state === 'UNTESTED') return false;
  if (filters.hideUnconfirmed && !OBSERVED.has(confidence.state)) return false;
  return true;
}

export function parseRoute(hash) {
  const [, view, id] = (hash ?? '').split('/');
  if (!VIEWS.includes(view)) return { view: 'character', id: null };
  return { view, id: id ?? null };
}
