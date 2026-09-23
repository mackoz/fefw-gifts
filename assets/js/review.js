import { createApi } from './api.js';
import { el } from './views/shared.js';
import {
  cleanText, normalizeName, slugify, suggestName, findListedGift, validateItemApproval,
} from './item-rules.js';

export const TOKEN_KEY = 'fefw-gifts-admin-token';

// The category select's "Create new category…". Not a valid id, so it can
// never be mistaken for one.
export const NEW_CATEGORY = '__new__';

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

function ageOf(createdAt, now) {
  const created = Date.parse(createdAt);
  return Number.isNaN(created) ? 'unknown age' : humanAge(now - created);
}

export function reviewRowModel(row, now = Date.now()) {
  const upvotes = Number(row.upvotes ?? 0);
  const downvotes = Number(row.downvotes ?? 0);
  return {
    id: row.id,
    pair: `${row.character} · ${row.gift}`,
    reaction: row.reaction,
    score: upvotes - downvotes,
    votes: `${upvotes} up / ${downvotes} down`,
    age: ageOf(row.created_at, now),
  };
}

function readStoredToken(storage) {
  try { return storage?.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

// Best effort. A browser that refuses to persist the token must still allow the
// maintainer to use the page for this session -- see the in-memory `token`.
function persistToken(storage, value) {
  try {
    if (value) storage?.setItem(TOKEN_KEY, value);
    else storage?.removeItem(TOKEN_KEY);
  } catch { /* the session continues without persistence */ }
}

function renderRow(model, onDecide) {
  const item = el('li', 'review-row');
  item.append(el('p', 'review-pair', model.pair));
  item.append(el('p', 'review-meta', [
    model.reaction,
    model.votes,
    model.age,
  ].filter(Boolean).join(' · ')));

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

// --- Missing items ---
//
// Everything a player typed is rendered with textContent (via el()) or as an
// input's value, never as markup.

// Ties go to the value seen first, which -- rows being oldest first -- is the
// earliest report's.
function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function groupItemReports(rows) {
  const ordered = [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const groups = new Map();
  for (const row of ordered) {
    const key = normalizeName(row?.name);
    if (!groups.has(key)) groups.set(key, { key, reports: [] });
    groups.get(key).reports.push(row);
  }
  // A Map keeps insertion order, and rows went in oldest first, so the group
  // with the oldest report comes first.
  return [...groups.values()];
}

export function itemCardDefaults(group, categories = []) {
  const { reports } = group;
  const known = new Set(categories.map((category) => category.id));

  const ids = reports.map((row) => row.category ?? null);
  const agreed = ids.every((id) => id !== null && id === ids[0]) && known.has(ids[0]) ? ids[0] : null;

  const lines = reports.map((row) => cleanText(row.category_line));
  const typed = lines.every(Boolean) ? mostFrequent(lines) : null;

  return {
    name: suggestName(mostFrequent(reports.map((row) => cleanText(row.name)))),
    category: agreed,
    newCategory: typed ? { id: slugify(typed), label: suggestName(typed), inGameDescriptor: typed } : null,
    rarity: mostFrequent(reports.map((row) => row.rarity ?? null)),
  };
}

export function categoryIdClash(categories, id) {
  return (Array.isArray(categories) ? categories : []).some((category) => category.id === id);
}

// The body for one POST /item-review/:id, minus the per-report includeResult,
// which the caller sets. An already-listed name wins over every category
// control: approving then adds only the results, and the gift, its category
// and its rarity stay as the repository has them.
export function itemApprovalBody({ name, category, newCategory, rarity } = {}, { gifts = [], categories = [] } = {}) {
  const listed = findListedGift(gifts, name);
  const body = { decision: 'approve', name: cleanText(name) ?? '', rarity: rarity || null, includeResult: false };
  const errors = [];

  if (listed) {
    body.giftId = listed.id;
  } else if (category === NEW_CATEGORY) {
    const id = cleanText(newCategory?.id) ?? '';
    if (categoryIdClash(categories, id)) {
      errors.push(`A category with the id “${id}” already exists — pick it from the list instead.`);
    }
    body.newCategory = {
      id,
      label: cleanText(newCategory?.label) ?? '',
      inGameDescriptor: cleanText(newCategory?.inGameDescriptor) ?? '',
    };
  } else if (category) {
    body.category = category;
  }

  errors.push(...validateItemApproval(body).errors);
  if (errors.length) return { errors, body: null, listed };
  return { errors, body, listed };
}

export function itemReportSummary(row, categories = [], now = Date.now()) {
  const listed = categories.find((category) => category.id === row.category);
  let line = 'no line';
  if (row.category) line = `line: ${listed?.inGameDescriptor ?? listed?.label ?? row.category}`;
  else if (row.category_line) line = `typed line: “${row.category_line}”`;
  const result = row.character && row.reaction ? `gave to ${row.character}: ${row.reaction}` : 'no result';
  return [`“${row.name}”`, line, row.rarity ?? 'rarity not sure', result, ageOf(row.created_at, now)].join(' · ');
}

// The site's own lists, relative to review/index.html. Inside a function, so
// the module keeps no top-level network or DOM access.
async function defaultLoadSiteData() {
  const [gifts, categories] = await Promise.all(['gifts', 'categories'].map(async (name) => {
    const response = await fetch(`../data/${name}.json`);
    if (!response.ok) throw new Error(`failed to load ${name}.json: ${response.status}`);
    return response.json();
  }));
  return { gifts, categories };
}

function textInput(className, value) {
  const node = el('input', className);
  node.type = 'text';
  node.value = value;
  return node;
}

function selectInput(className, options, value) {
  const node = el('select', className);
  for (const [optionValue, text] of options) {
    const option = el('option', null, text);
    option.value = optionValue;
    node.append(option);
  }
  node.value = value;
  return node;
}

function field(text, control) {
  const label = el('label', 'item-field', text);
  label.append(control);
  return label;
}

function actionButton(className, text, onClick) {
  const button = el('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function renderItemCard(group, { gifts, categories, now, decideItems }) {
  const defaults = itemCardDefaults(group, categories);
  const count = group.reports.length;
  const card = el('li', 'review-row item-card');
  card.append(el('p', 'review-pair', `${defaults.name} — reported ${count} time${count === 1 ? '' : 's'}`));

  const status = el('p', 'dialog-status item-status');
  const includes = new Map();
  const reportList = el('ul', 'item-reports');
  reportList.setAttribute('role', 'list');
  for (const row of group.reports) {
    const entry = el('li', 'item-report');
    entry.append(el('p', 'review-meta', itemReportSummary(row, categories, now)));
    const actions = el('div', 'review-actions');
    if (row.character && row.reaction) {
      const box = el('input', 'item-include-box');
      box.type = 'checkbox';
      box.checked = true;
      includes.set(row.id, box);
      const label = el('label', 'item-include');
      label.append(box, ' Include result');
      actions.append(label);
    }
    actions.append(actionButton('review-reject item-reject', 'Reject', () => decideItems([[row.id, { decision: 'reject' }]], status)));
    entry.append(actions);
    reportList.append(entry);
  }
  card.append(reportList);

  const name = textInput('item-name', defaults.name);
  const listedNote = el('p', 'review-meta item-listed');
  const sorted = [...categories].sort((a, b) => a.label.localeCompare(b.label, 'en'));
  const category = selectInput('item-category', [
    ['', 'Category unknown'],
    ...sorted.map((c) => [c.id, c.label]),
    [NEW_CATEGORY, 'Create new category…'],
  ], defaults.newCategory ? NEW_CATEGORY : (defaults.category ?? ''));
  const newLabel = textInput('item-new-label', defaults.newCategory?.label ?? '');
  const newId = textInput('item-new-id', defaults.newCategory?.id ?? '');
  const newLine = textInput('item-new-line', defaults.newCategory?.inGameDescriptor ?? '');
  // A bare div, so nothing overrides its `hidden`.
  const newFields = el('div', 'item-new-category');
  newFields.append(field('New category label', newLabel), field('New category id', newId), field('In-game line', newLine));
  const rarity = selectInput('item-rarity', [
    ['', 'Rarity unknown'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'],
  ], defaults.rarity ?? '');

  // The id follows the label until the maintainer types one of their own.
  let idEdited = false;
  newId.addEventListener('input', () => { idEdited = true; });
  newLabel.addEventListener('input', () => {
    if (!idEdited) newId.value = slugify(newLabel.value);
  });

  function sync() {
    const listed = findListedGift(gifts, name.value);
    listedNote.textContent = listed ? `Already listed as ${listed.name} — approving adds only the results.` : '';
    category.disabled = Boolean(listed);
    rarity.disabled = Boolean(listed);
    newFields.hidden = Boolean(listed) || category.value !== NEW_CATEGORY;
  }
  name.addEventListener('input', sync);
  category.addEventListener('change', sync);
  sync();

  card.append(field('Name', name), listedNote, field('Category', category), newFields, field('Rarity', rarity));

  function approve() {
    const { errors, body } = itemApprovalBody({
      name: name.value,
      category: category.value,
      rarity: rarity.value,
      newCategory: { id: newId.value, label: newLabel.value, inGameDescriptor: newLine.value },
    }, { gifts, categories });
    if (errors.length) {
      status.textContent = errors[0];
      return undefined;
    }
    return decideItems(
      group.reports.map((row) => [row.id, { ...body, includeResult: includes.get(row.id)?.checked === true }]),
      status,
    );
  }

  const actions = el('div', 'review-actions');
  actions.append(
    actionButton('review-approve item-approve', 'Approve', approve),
    actionButton('review-reject item-reject-card', 'Reject card', () => decideItems(
      group.reports.map((row) => [row.id, { decision: 'reject' }]),
      status,
    )),
  );
  card.append(actions, status);
  return card;
}

// `createClient` and `loadSiteData` are injected so the page's wiring can be
// exercised without a network; they default to the real API client and the
// site's own data files.
export function mountReview({
  elements, storage, createClient = createApi, now = () => Date.now(), loadSiteData = defaultLoadSiteData,
}) {
  const { tokenForm, tokenInput, forget, status, list, refresh, itemCount, itemStatus, itemList } = elements;
  let api = null;
  // The session's source of truth. Storage only seeds it and mirrors it, so a
  // private window or blocked site data costs persistence, never access.
  let token = readStoredToken(storage);
  // Fetched once per page load: the site's lists only change on a deploy.
  let siteData = null;
  let deciding = false;

  function setStatus(message) {
    status.textContent = message;
  }

  function clearItems(message = '') {
    itemList.replaceChildren();
    itemCount.textContent = '0';
    itemStatus.textContent = message;
  }

  async function load() {
    if (!token) {
      list.replaceChildren();
      clearItems();
      setStatus('Paste your admin token to see the queue.');
      return;
    }

    api = createClient({ token });
    if (!api.enabled) {
      clearItems();
      setStatus('This site is not pointed at a Worker yet — see worker/README.md.');
      return;
    }

    setStatus('Loading…');
    const result = await api.fetchReview();
    if (!result.ok) {
      clearItems();
      // 401 is by far the likeliest failure, and "wrong token" is more useful
      // than the status code.
      setStatus(result.status === 401 ? 'That token was not accepted.' : result.error);
      return;
    }

    const rows = Array.isArray(result.data?.reports) ? result.data.reports : [];
    list.replaceChildren(...rows.map((row) => renderRow(reviewRowModel(row, now()), decide)));
    setStatus(rows.length === 0 ? 'Nothing waiting.' : `${rows.length} report(s) waiting, best score first.`);

    await loadItems();
  }

  async function loadItems() {
    itemStatus.textContent = 'Loading…';
    if (!siteData) {
      try {
        siteData = await loadSiteData();
      } catch {
        clearItems('Could not load the site’s gift and category lists, which the missing-item cards need. Try Refresh.');
        return;
      }
    }

    const result = await api.fetchItemReview();
    if (!result.ok) {
      // A Worker deployed before this feature answers 404 here.
      clearItems(result.status === 404
        ? 'The Worker has no missing-item queue yet — redeploy it (see worker/README.md).'
        : result.error);
      return;
    }

    const rows = Array.isArray(result.data?.reports) ? result.data.reports : [];
    const groups = groupItemReports(rows);
    const context = { ...siteData, now: now(), decideItems };
    itemList.replaceChildren(...groups.map((group) => renderItemCard(group, context)));
    itemCount.textContent = String(groups.length);
    itemStatus.textContent = groups.length === 0
      ? 'No missing items waiting.'
      : `${rows.length} report(s) about ${groups.length} item(s), oldest first.`;
  }

  // One request per report, in order. A 404 means that report was already
  // decided -- by an earlier, partly failed attempt at this same card, or in
  // another tab -- so it is skipped rather than treated as a failure. Anything
  // else stops the run and stays on the card; there is no reload to hide it.
  async function decideItems(pairs, cardStatus) {
    if (deciding) return;
    deciding = true;
    cardStatus.textContent = 'Saving…';
    try {
      for (const [id, body] of pairs) {
        const result = await api.decideItem(id, body);
        if (!result.ok && result.status !== 404) {
          cardStatus.textContent = result.error;
          return;
        }
      }
    } finally {
      deciding = false;
    }
    await loadItems();
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
    token = tokenInput.value.trim();
    persistToken(storage, token);
    tokenInput.value = '';
    load();
  });

  forget.addEventListener('click', () => {
    token = '';
    persistToken(storage, '');
    api = null;
    load();
  });

  refresh.addEventListener('click', load);

  load();
}
