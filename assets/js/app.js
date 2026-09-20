import { fetchDataset, buildIndex } from './data.js';
import { parseRoute, DEFAULT_FILTERS } from './filters.js';
import { createApi } from './api.js';
import { TURNSTILE_SITE_KEY } from './config.js';
import { createTurnstile } from './turnstile.js';
import { createReportForm } from './report-form.js';
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
    }).catch((err) => {
      // fetchPending() itself never rejects, but render() above can throw, and
      // the overlay is optional by design: a failure here must never surface
      // as an unhandled rejection or break the page.
      console.error('failed to apply the pending overlay', err);
    });
  }

  // Both controls ship in the markup and exactly one survives, so the page is
  // never briefly wrong while JavaScript boots.
  const openButton = document.getElementById('report-open');
  const fallback = document.getElementById('report-fallback');
  if (!api.enabled) return;
  openButton.hidden = false;
  fallback.hidden = true;

  const reportForm = createReportForm({
    elements: {
      dialog: document.getElementById('report-dialog'),
      form: document.getElementById('report-form'),
      character: document.getElementById('report-character'),
      gift: document.getElementById('report-gift'),
      reactions: document.getElementById('report-reactions'),
      points: document.getElementById('report-points'),
      note: document.getElementById('report-note'),
      status: document.getElementById('report-status'),
      cancel: document.getElementById('report-cancel'),
      submit: document.getElementById('report-submit'),
    },
    index: state.index,
    api,
    turnstile: createTurnstile({
      siteKey: TURNSTILE_SITE_KEY,
      container: document.getElementById('report-turnstile'),
    }),
    onSubmitted: refreshPending,
  });

  openButton.addEventListener('click', () => reportForm.open());

  // One listener for every per-row button, so a re-render costs nothing.
  container.addEventListener('click', (event) => {
    const button = event.target.closest('.report-button');
    if (button) reportForm.open(button.dataset.character, button.dataset.gift);
  });
}

main();
