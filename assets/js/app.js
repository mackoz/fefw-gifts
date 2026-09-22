import { fetchDataset, buildIndex } from './data.js';
import { parseRoute, DEFAULT_FILTERS } from './filters.js';
import { createApi } from './api.js';
import { TURNSTILE_SITE_KEY } from './config.js';
import { createTurnstile } from './turnstile.js';
import { createReportForm } from './report-form.js';
import { recordVote } from './votes.js';
import * as characterView from './views/character.js';
import * as giftView from './views/gift.js';
import * as matrixView from './views/matrix.js';
import * as favoritesView from './views/favorites.js';
import * as weaveView from './views/weave.js';

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

// Handed to the views rather than read from a global, so the vote control stays
// testable and a blocked localStorage is one try/catch, not a crash.
state.storage = (() => { try { return globalThis.localStorage; } catch { return undefined; } })();

function render() {
  const container = document.getElementById('view');
  const route = parseRoute(location.hash);
  container.replaceChildren();
  // A per-view hook, so the matrix can lift the content-column limit that
  // every other view wants.
  container.className = `view-${route.view}`;
  VIEW_MODULES[route.view].render(container, state.index, { ...state, id: route.id });

  // The strip's counts depend on the filters, so it re-renders with the view.
  // A stale count in the masthead is worse than no count at all.
  const weave = document.getElementById('weave');
  if (weave) weaveView.render(weave, state.index, state);

  for (const a of document.querySelectorAll('nav a')) {
    a.classList.toggle('active', a.getAttribute('href').startsWith(`#/${route.view}`));
  }
}

// Re-reads the overlay and rebuilds the index. Called after a report lands so
// the contributor sees their own submission appear straight away. Also handed
// to createReportForm as onSubmitted and invoked there bare (not `.then`'d),
// so the try/catch lives here rather than at each call site: fetchPending()
// itself never rejects, but render() can throw, and the overlay is optional
// by design -- a failure here must never surface as an unhandled rejection.
async function refreshPending() {
  try {
    state.index = buildIndex(state.dataset, await api.fetchPending());
    render();
  } catch (err) {
    console.error('failed to refresh the pending overlay', err);
  }
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

  const voteDialog = document.getElementById('vote-dialog');
  const voteStatus = document.getElementById('vote-status');
  const voteSubmit = document.getElementById('vote-submit');
  const voteTurnstile = createTurnstile({
    siteKey: TURNSTILE_SITE_KEY,
    container: document.getElementById('vote-turnstile'),
  });
  let pendingVote = null;

  document.getElementById('vote-cancel').addEventListener('click', () => voteDialog.close());

  document.getElementById('vote-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const vote = pendingVote;            // capture before any await
    const token = voteTurnstile.token();
    if (!token) {
      voteStatus.textContent = 'Complete the “I’m human” check first.';
      return;
    }

    voteSubmit.disabled = true;
    const result = await api.sendVote({ ...vote, turnstileToken: token });
    voteSubmit.disabled = false;
    voteTurnstile.reset();

    if (!result.ok) {
      voteStatus.textContent = result.error;
      return;
    }

    // Recorded locally only after the Worker accepted it, so a failed send can
    // be retried.
    recordVote(state.storage, vote.id, vote.direction);
    voteDialog.close();
    render();
  });

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('.vote-button');
    if (!button) return;
    pendingVote = { id: button.dataset.report, direction: button.dataset.direction };
    voteStatus.textContent = '';
    voteDialog.showModal();
    try {
      await voteTurnstile.mount();
    } catch {
      voteStatus.textContent = 'The “I’m human” check could not load. Try again in a moment.';
    }
  });
}

main();
