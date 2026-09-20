import { fetchDataset, buildIndex } from './data.js';
import { parseRoute, DEFAULT_FILTERS } from './filters.js';
import { createApi } from './api.js';
import * as characterView from './views/character.js';
import * as giftView from './views/gift.js';
import * as matrixView from './views/matrix.js';
import * as favoritesView from './views/favorites.js';

const VIEW_MODULES = {
  character: characterView,
  gift: giftView,
  matrix: matrixView,
  favorites: favoritesView,
};

const api = createApi();

const state = {
  filters: { ...DEFAULT_FILTERS },
  search: '',
  index: null,
  dataset: null,
  api,
  submissionsEnabled: api.enabled,
};

function render() {
  const container = document.getElementById('view');
  const route = parseRoute(location.hash);
  container.replaceChildren();
  VIEW_MODULES[route.view].render(container, state.index, { ...state, id: route.id });
  for (const a of document.querySelectorAll('nav a')) {
    a.classList.toggle('active', a.getAttribute('href').startsWith(`#/${route.view}`));
  }
}

// Re-reads the overlay and rebuilds the index. Called after a report lands so
// the contributor sees their own submission appear straight away.
async function refreshPending() {
  state.index = buildIndex(state.dataset, await api.fetchPending());
  render();
}

async function main() {
  const container = document.getElementById('view');
  try {
    state.dataset = await fetchDataset();
  } catch (err) {
    container.textContent = `Could not load the gift data: ${err.message}`;
    return;
  }

  // The overlay is fetched separately and never awaited before the first paint
  // matters: committed data renders whether or not the Worker answers.
  state.index = buildIndex(state.dataset, []);

  addEventListener('hashchange', render);
  document.getElementById('search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  });
  for (const box of document.querySelectorAll('[data-filter]')) {
    box.checked = state.filters[box.dataset.filter];
    box.addEventListener('change', () => {
      state.filters[box.dataset.filter] = box.checked;
      render();
    });
  }
  render();

  if (api.enabled) {
    api.fetchPending().then((pending) => {
      if (pending.length === 0) return;
      state.index = buildIndex(state.dataset, pending);
      render();
    });
  }
}

main();
