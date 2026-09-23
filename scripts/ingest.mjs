import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDataset, validate } from './validate.mjs';

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

  const observationsPath = path.join(dataDir, 'observations.json');
  const existing = JSON.parse(await readFile(observationsPath, 'utf8'));
  const { observations, added, skipped } = mergeObservations(existing, rows);

  // Emitted before the early return below, so a night where every row is
  // skipped still surfaces a warning instead of silently logging "nothing to
  // ingest". This does not fail the run: the pull-request step only runs on
  // success, and failing here would throw away every good row in the same
  // batch along with the bad one.
  for (const row of skipped) {
    console.log(skippedRowWarning(row));
  }

  if (added.length === 0) {
    console.log('nothing to ingest');
    await report(0);
    return;
  }

  // Validate the merged dataset in memory and write only if it is clean. A bad
  // row must never reach the working tree, let alone a pull request.
  const dataset = await loadDataset(dataDir);
  const { errors } = validate({ ...dataset, observations });
  if (errors.length) {
    console.error(`${errors.length} validation error(s); nothing written:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
  console.log(`ingested ${added.length} observation(s)`);
  await report(added.length);
}

// Hands the count to the workflow. Writing to GITHUB_OUTPUT is a no-op
// locally, so the script behaves the same either way.
async function report(count) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `added=${count}\n`);
}

// CLI entry point: `npm run ingest`. Importing this file runs nothing.
if (import.meta.filename === process.argv[1]) {
  await main();
}
