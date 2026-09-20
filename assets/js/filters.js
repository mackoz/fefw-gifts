export const VIEWS = ['character', 'gift', 'matrix', 'favorites'];

export const DEFAULT_FILTERS = {
  hideUntested: false,
  hideUnconfirmed: false,
  hideSpoilers: true,
};

const OBSERVED = new Set(['CONFIRMED', 'FAVORITE', 'CONTESTED']);

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
