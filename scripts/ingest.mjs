import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDataset, validate } from './validate.mjs';
import { normalizeName, slugify, validateItemApproval } from '../assets/js/item-rules.js';

// The observation shape from the spec's data model, and nothing else.
export function toObservation(row) {
  return {
    id: row.id,
    gift: row.gift,
    character: row.character,
    reaction: row.reaction,
    date: String(row.created_at ?? '').slice(0, 10),
  };
}

// The report id becomes the observation id, so re-running after a half-finished
// sync cannot duplicate a row.
//
// The Worker's schema allows a NULL id (see worker/schema.sql: `id TEXT PRIMARY
// KEY` with no `NOT NULL`, which SQLite permits for a non-INTEGER primary key).
// The Worker marks rows ingested with `UPDATE ... WHERE id IN (...)`, which can
// never match such a row, so it stays `approved` and is handed back on every
// future sync. Rejecting it in validate() would be correct on its own, but by
// the time validation runs, every *other* row in the same batch has already
// been marked ingested by the Worker -- so failing the whole run here would
// throw away every good row along with the bad one, and the bad row would keep
// coming back forever. Setting it aside instead lets the good rows land and
// reports the bad one so it can be fixed by hand in D1. The durable fix is a
// live D1 migration adding `NOT NULL` to `reports.id`; that is deliberately out
// of scope for this script.
export function mergeObservations(existing, rows) {
  const seen = new Set(existing.map((observation) => observation.id));
  const added = [];
  const skipped = [];
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id.length === 0) {
      skipped.push(row);
      continue;
    }
    const observation = toObservation(row);
    if (seen.has(observation.id)) continue;
    seen.add(observation.id);
    added.push(observation);
  }
  return { observations: [...existing, ...added], added, skipped };
}

// Formats one GitHub Actions warning annotation for a skipped row. Workflow
// commands read up to the first unescaped `\r` or `\n` in a value, and `%` must
// be escaped too so an already-escaped sequence in the data can't be
// reinterpreted -- per GitHub's rules: %25, \r -> %0D, \n -> %0A. Without this,
// a field containing a newline (this can be a hand-written D1 row, not just a
// player report) could end the warning command and have the remainder read as
// a new, unintended workflow command.
function escapeWorkflowValue(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function skippedRowWarning(row) {
  const character = escapeWorkflowValue(row.character);
  const gift = escapeWorkflowValue(row.gift);
  const createdAt = escapeWorkflowValue(row.created_at);
  return `::warning title=Report skipped::approved report with no usable id (character=${character}, gift=${gift}, created_at=${createdAt}) was not ingested; it will be returned every night until its id is fixed in D1`;
}

// --- Missing items ---

// Pure. Applies one night's approved missing-item reports to the dataset, in
// the spec's order: new categories, then new gifts (which may name a category
// created a moment ago), then results. Only the maintainer's approved values
// are read -- the player's raw name and typed line are not even in the
// Worker's response -- and every approval is re-checked here, because a row
// edited by hand in D1 must not reach data/ either.
export function applyItemReports(dataset, items) {
  const categories = [...dataset.categories];
  const gifts = [...dataset.gifts];
  const summary = { newGifts: [], newCategories: [], reusedCategories: [], results: 0 };
  const skipped = [];
  const droppedResults = [];

  const structurallyValid = [];
  for (const item of Array.isArray(items) ? items : []) {
    const approved = item?.approved;
    const check = approved !== null && typeof approved === 'object' && !Array.isArray(approved)
      ? validateItemApproval({ ...approved, decision: 'approve' })
      : { errors: ['no approval'], value: null };
    if (typeof item?.id !== 'string' || item.id === '' || check.errors.length) {
      skipped.push({ item, reason: 'no usable approval' });
      continue;
    }
    structurallyValid.push({ item, approved: check.value });
  }

  // A structurally valid approval can still be stale: it may have been made
  // on a phone days before this sync, naming a gift or category that a
  // maintainer has since renamed or removed by hand -- checked against both
  // the dataset on disk and the categories this same batch is about to
  // create. Unlike an invalid approval, staleness here is resolved by a fixed
  // point rather than a single pass: an approval only "creates" a new
  // category if it itself survives, so a category proposed by an approval
  // that is dropped for some other reason (an unknown giftId, say) is not
  // available to excuse a later approval that names it. Re-screening after
  // each removal catches that chain. A stale character is different -- see
  // the results loop below -- and never removes an approval, so it plays no
  // part in this loop.
  const originalCategoryIds = new Set(categories.map((category) => category.id));
  const originalGiftIds = new Set(gifts.map((gift) => gift.id));
  const charactersById = new Map(dataset.characters.map((character) => [character.id, character]));

  let kept = structurallyValid;
  for (;;) {
    const batchNewCategoryIds = new Set(
      kept.map(({ approved }) => approved.newCategory?.id).filter((id) => id != null),
    );
    const survivors = [];
    const removed = [];
    for (const entry of kept) {
      const { approved } = entry;
      const staleGift = approved.giftId !== null && !originalGiftIds.has(approved.giftId);
      const staleCategory = approved.category !== null
        && !originalCategoryIds.has(approved.category)
        && !batchNewCategoryIds.has(approved.category);
      if (staleGift) {
        removed.push({ item: entry.item, reason: `unknown gift ${approved.giftId}` });
      } else if (staleCategory) {
        removed.push({ item: entry.item, reason: `unknown category ${approved.category}` });
      } else {
        survivors.push(entry);
      }
    }
    if (removed.length === 0) { kept = survivors; break; }
    skipped.push(...removed);
    kept = survivors;
  }
  const approvals = kept;

  // 1. Categories. An id that already exists -- in data/ or created a moment
  // ago by an earlier report in this same batch -- is reused rather than
  // duplicated, and the reuse is noted for the maintainer.
  const categoryIds = new Set(categories.map((category) => category.id));
  for (const { approved } of approvals) {
    const proposed = approved.newCategory;
    if (!proposed) continue;
    if (categoryIds.has(proposed.id)) {
      summary.reusedCategories.push(`reused existing category ${proposed.id}`);
      continue;
    }
    categories.push({ id: proposed.id, label: proposed.label, inGameDescriptor: proposed.inGameDescriptor, aliases: [] });
    categoryIds.add(proposed.id);
    summary.newCategories.push(`${proposed.label} (${proposed.id}) — “${proposed.inGameDescriptor}”`);
  }

  // 2. Gifts. An item already listed under any spelling -- "Lanternoil"
  // beside "Lantern Oil" -- is that gift, matched by normalised name rather
  // than by slug, so several reports of one item in a batch (and every
  // spelling variant within it) yield one gift.
  const results = [];
  for (const { item, approved } of approvals) {
    let giftId = approved.giftId;
    if (giftId === null) {
      const slug = slugify(approved.name);
      const key = normalizeName(approved.name);
      const existing = gifts.find((gift) => normalizeName(gift.name) === key);
      if (existing) {
        giftId = existing.id;
      } else {
        const category = approved.newCategory?.id ?? approved.category ?? null;
        gifts.push({ id: slug, name: approved.name, category, rarity: approved.rarity, description: '', sources: [] });
        giftId = slug;
        summary.newGifts.push(`${approved.name} (${slug}) — category: ${category ?? 'not recorded'}, rarity: ${approved.rarity ?? 'not recorded'}`);
      }
    }

    // 3. Results: only when the maintainer kept one and both halves exist. The
    // gift and category above are written regardless -- a result naming a
    // character that has since been renamed, removed or made non-giftable by
    // hand loses only the result, never the item report itself.
    if (approved.includeResult && item.character && item.reaction) {
      const character = charactersById.get(item.character);
      if (!character) {
        droppedResults.push({ item, reason: `unknown character ${item.character}` });
      } else if (!character.giftable) {
        droppedResults.push({ item, reason: `character ${item.character} can't be given gifts` });
      } else {
        results.push({ id: item.id, gift: giftId, character: item.character, reaction: item.reaction, created_at: item.created_at });
      }
    }
  }

  // The report id becomes the observation id, exactly as for result reports,
  // so a re-run cannot duplicate a row.
  const merged = mergeObservations(dataset.observations, results);
  summary.results = merged.added.length;
  return { categories, gifts, observations: merged.observations, summary, skipped, droppedResults };
}

const ITEMS_NOT_SYNCED = '::warning title=Missing items not synced::';

// Never throws and never fails the run. By the time this is called, /ingest
// has already marked the night's result rows ingested, so failing here would
// throw them away -- result syncing must never depend on this feature.
export async function fetchItemBatch(workerUrl, adminToken, fetchImpl = (...args) => globalThis.fetch(...args)) {
  let response;
  try {
    response = await fetchImpl(`${workerUrl}/ingest-items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  } catch (err) {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}could not reach /ingest-items (${escapeWorkflowValue(err?.message)}); result reports are unaffected` };
  }

  if (response.status === 404) {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}the Worker has no /ingest-items route yet -- redeploy it (see worker/README.md); result reports are unaffected` };
  }
  if (!response.ok) {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}/ingest-items returned ${response.status}; result reports are unaffected` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { items: [], warning: `${ITEMS_NOT_SYNCED}/ingest-items answered with a body that is not JSON; any rows it marked ingested must be re-entered by hand` };
  }
  return { items: Array.isArray(body?.items) ? body.items : [], warning: null };
}

export function itemSkippedWarning(item, reason) {
  return `::warning title=Missing item skipped::approved item report ${escapeWorkflowValue(item?.id)} was not synced (${escapeWorkflowValue(reason)}); the logged batch above is the only copy`;
}

export function itemResultDroppedWarning(item, reason) {
  return `::warning title=Missing-item result dropped::the result on approved item report ${escapeWorkflowValue(item?.id)} was not synced (${escapeWorkflowValue(reason)}); the item itself was`;
}

// categories.json is aligned by hand, so it is never re-serialised: new
// entries are appended as one-line objects in the file's own style, and every
// existing byte stays where it was.
export function appendCategoryLines(text, entries) {
  if (entries.length === 0) return text;
  const head = text.slice(0, text.lastIndexOf(']')).replace(/\s+$/, '');
  const separator = head.endsWith('[') ? '' : ',';
  const lines = entries.map((c) => `  { "id": ${JSON.stringify(c.id)}, "label": ${JSON.stringify(c.label)}, "inGameDescriptor": ${JSON.stringify(c.inGameDescriptor)}, "aliases": [] }`);
  return `${head}${separator}\n${lines.join(',\n')}\n]\n`;
}

// The pull request body. Every new item and category is listed, because the
// maintainer approved each one on a phone and is now looking at it in a diff.
export function ingestSummary({ added, summary }) {
  const lines = [`${added} approved result report(s) from the submission Worker.`];
  if (summary.newGifts.length > 0) {
    lines.push('', `**New items (${summary.newGifts.length})** — check each name against the game before merging:`, ...summary.newGifts.map((line) => `- ${line}`));
  }
  if (summary.newCategories.length > 0) {
    lines.push('', `**New categories (${summary.newCategories.length})** — check the label, id and in-game line:`, ...summary.newCategories.map((line) => `- ${line}`));
  }
  const reusedCategories = summary.reusedCategories ?? [];
  if (reusedCategories.length > 0) {
    lines.push('', `**Reused categories (${reusedCategories.length})**`, ...reusedCategories.map((line) => `- ${line}`));
  }
  if (summary.results > 0) lines.push('', `${summary.results} result(s) from missing-item reports.`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const workerUrl = (process.env.WORKER_URL ?? '').replace(/\/+$/, '');
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  const dataDir = process.env.DATA_DIR ?? 'data';

  if (!workerUrl || !adminToken) {
    console.error('WORKER_URL and ADMIN_TOKEN must both be set');
    process.exit(1);
  }

  const response = await fetch(`${workerUrl}/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    console.error(`the Worker returned ${response.status}`);
    process.exit(1);
  }

  const { reports } = await response.json();
  const rows = Array.isArray(reports) ? reports : [];

  // Printed before anything can fail: takeApproved has already marked these rows
  // ingested in D1, so if validation or the pull request fails afterwards this
  // log is the only copy left.
  console.log(JSON.stringify(rows, null, 2));

  // The same for missing items: takeApprovedItems marks them in the same call.
  const { items, warning } = await fetchItemBatch(workerUrl, adminToken);
  console.log(JSON.stringify(items, null, 2));
  if (warning) console.log(warning);

  const dataset = await loadDataset(dataDir);
  const merged = mergeObservations(dataset.observations, rows);

  // Emitted before the early return below, so a night where every row is
  // skipped still surfaces a warning instead of silently logging "nothing to
  // ingest". This does not fail the run: the pull-request step only runs on
  // success, and failing here would throw away every good row in the same
  // batch along with the bad one.
  for (const row of merged.skipped) {
    console.log(skippedRowWarning(row));
  }

  const applied = applyItemReports({ ...dataset, observations: merged.observations }, items);
  for (const { item, reason } of applied.skipped) console.log(itemSkippedWarning(item, reason));
  for (const { item, reason } of applied.droppedResults) console.log(itemResultDroppedWarning(item, reason));

  const { summary } = applied;
  const itemChanges = summary.newGifts.length + summary.newCategories.length + summary.results;
  if (merged.added.length === 0 && itemChanges === 0) {
    console.log('nothing to ingest');
    await report(0, 0);
    return;
  }

  // Validate the merged dataset in memory and write only if it is clean. A bad
  // row must never reach the working tree, let alone a pull request.
  const { errors } = validate({ ...dataset, categories: applied.categories, gifts: applied.gifts, observations: applied.observations });
  if (errors.length) {
    console.error(`${errors.length} validation error(s); nothing written:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  // Only the files that changed are written, so an unchanged file is not
  // rewritten. categories.json is hand-aligned and appended to as text;
  // gifts.json and observations.json round-trip through JSON.stringify.
  if (summary.newCategories.length > 0) {
    const categoriesPath = path.join(dataDir, 'categories.json');
    const text = await readFile(categoriesPath, 'utf8');
    await writeFile(categoriesPath, appendCategoryLines(text, applied.categories.slice(dataset.categories.length)));
  }
  if (summary.newGifts.length > 0) {
    await writeFile(path.join(dataDir, 'gifts.json'), `${JSON.stringify(applied.gifts, null, 2)}\n`);
  }
  if (applied.observations.length !== dataset.observations.length) {
    await writeFile(path.join(dataDir, 'observations.json'), `${JSON.stringify(applied.observations, null, 2)}\n`);
  }

  console.log(`ingested ${merged.added.length} result report(s); ${summary.newGifts.length} new item(s), ${summary.newCategories.length} new categor(y/ies), ${summary.results} item result(s)`);
  if (process.env.INGEST_SUMMARY) {
    await writeFile(process.env.INGEST_SUMMARY, ingestSummary({ added: merged.added.length, summary }));
  }
  await report(merged.added.length, itemChanges);
}

// Hands the counts to the workflow. Writing to GITHUB_OUTPUT is a no-op
// locally, so the script behaves the same either way.
async function report(added, items) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `added=${added}\nitems=${items}\n`);
}

// CLI entry point: `npm run ingest`. Importing this file runs nothing.
if (import.meta.filename === process.argv[1]) {
  await main();
}
