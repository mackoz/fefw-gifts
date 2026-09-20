import { createApi } from './api.js';
import { el } from './views/shared.js';

export const TOKEN_KEY = 'fefw-gifts-admin-token';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function humanAge(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < MINUTE) return 'just now';
  if (milliseconds < HOUR) return plural(Math.floor(milliseconds / MINUTE), 'minute');
  if (milliseconds < DAY) return plural(Math.floor(milliseconds / HOUR), 'hour');
  return plural(Math.floor(milliseconds / DAY), 'day');
}

export function reviewRowModel(row, now = Date.now()) {
  const upvotes = Number(row.upvotes ?? 0);
  const downvotes = Number(row.downvotes ?? 0);
  const created = Date.parse(row.created_at);
  return {
    id: row.id,
    pair: `${row.character} · ${row.gift}`,
    reaction: row.reaction,
    points: row.points ?? null,
    note: row.note ?? null,
    score: upvotes - downvotes,
    votes: `${upvotes} up / ${downvotes} down`,
    age: Number.isNaN(created) ? 'unknown age' : humanAge(now - created),
  };
}

function readToken(storage) {
  try { return storage?.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

function writeToken(storage, token) {
  try {
    if (token) storage?.setItem(TOKEN_KEY, token);
    else storage?.removeItem(TOKEN_KEY);
  } catch { /* the page still works for this session without persisting it */ }
}

function renderRow(model, onDecide) {
  const item = el('li', 'review-row');
  item.append(el('p', 'review-pair', model.pair));
  item.append(el('p', 'review-meta', [
    model.reaction,
    model.points === null ? null : `${model.points} pts`,
    model.votes,
    model.age,
  ].filter(Boolean).join(' · ')));
  if (model.note) item.append(el('p', 'review-note', model.note));

  const actions = el('div', 'review-actions');
  for (const [decision, label] of [['approve', 'Approve'], ['reject', 'Reject']]) {
    const button = el('button', `review-${decision}`, label);
    button.type = 'button';
    button.addEventListener('click', () => onDecide(model.id, decision, button));
    actions.append(button);
  }
  item.append(actions);
  return item;
}

// `createClient` is injected so the page's wiring can be exercised without a
// network; it defaults to the real API client.
export function mountReview({ elements, storage, createClient = createApi, now = () => Date.now() }) {
  const { tokenForm, tokenInput, forget, status, list, refresh } = elements;
  let api = null;

  function setStatus(message) {
    status.textContent = message;
  }

  async function load() {
    const token = readToken(storage);
    if (!token) {
      list.replaceChildren();
      setStatus('Paste your admin token to see the queue.');
      return;
    }

    api = createClient({ token });
    if (!api.enabled) {
      setStatus('This site is not pointed at a Worker yet — see worker/README.md.');
      return;
    }

    setStatus('Loading…');
    const result = await api.fetchReview();
    if (!result.ok) {
      // 401 is by far the likeliest failure, and "wrong token" is more useful
      // than the status code.
      setStatus(result.status === 401 ? 'That token was not accepted.' : result.error);
      return;
    }

    const rows = Array.isArray(result.data?.reports) ? result.data.reports : [];
    list.replaceChildren(...rows.map((row) => renderRow(reviewRowModel(row, now()), decide)));
    setStatus(rows.length === 0 ? 'Nothing waiting.' : `${rows.length} report(s) waiting, best score first.`);
  }

  async function decide(id, decision, button) {
    button.disabled = true;
    const result = await api.decide(id, decision);
    if (!result.ok) {
      button.disabled = false;
      setStatus(result.error);
      return;
    }
    await load();
  }

  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    writeToken(storage, tokenInput.value.trim());
    tokenInput.value = '';
    load();
  });

  forget.addEventListener('click', () => {
    writeToken(storage, '');
    api = null;
    load();
  });

  refresh.addEventListener('click', load);

  load();
}
