import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDataset, validate } from './validate.mjs';

// The observation shape from the spec's data model, and nothing else.
//
// The submitted note is deliberately left behind: observations.json has no
// field for it, and it is free text from an anonymous contributor that would
// otherwise be committed unread. The maintainer sees notes on the review page,
// and this script puts them in the pull request body instead.
export function toObservation(row) {
  return {
    id: row.id,
    gift: row.gift,
    character: row.character,
    reaction: row.reaction,
    points: row.points ?? null,
    date: String(row.created_at ?? '').slice(0, 10),
  };
}

// The report id becomes the observation id, so re-running after a half-finished
// sync cannot duplicate a row.
export function mergeObservations(existing, rows) {
  const seen = new Set(existing.map((observation) => observation.id));
  const added = [];
  for (const row of rows) {
    const observation = toObservation(row);
    if (seen.has(observation.id)) continue;
    seen.add(observation.id);
    added.push(observation);
  }
  return { observations: [...existing, ...added], added };
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
  const { observations, added } = mergeObservations(existing, rows);

  if (added.length === 0) {
    console.log('nothing to ingest');
    await report(0, []);
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
  await report(added.length, rows);
}

// Pure so the delimiter-collision and newline-stripping behaviour is testable:
// this string is written into $GITHUB_OUTPUT, where a stray newline or a line
// matching the heredoc delimiter would let contributor text inject workflow
// outputs.
export function formatNotes(rows) {
  return rows
    .filter((row) => row.note)
    .map((row) => `- ${row.character} / ${row.gift}: ${String(row.note).replace(/\s+/g, ' ')}`)
    .join('\n');
}

// Hands the count and the notes to the workflow. Writing to GITHUB_OUTPUT is a
// no-op locally, so the script behaves the same either way.
async function report(count, rows) {
  const notes = formatNotes(rows);

  if (!process.env.GITHUB_OUTPUT) return;
  // A static delimiter is GitHub's documented output-injection footgun: if any
  // line of `notes` equalled the delimiter, the runner's line-based parser
  // would end the value early and parse the rest as new output assignments,
  // including `added`, which gates the validate/test and PR steps. Generating
  // the delimiter per write closes that off regardless of the notes format.
  const delimiter = `NOTES_${crypto.randomUUID()}`;
  await appendFile(process.env.GITHUB_OUTPUT, `added=${count}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `notes<<${delimiter}\n${notes}\n${delimiter}\n`);
}

// CLI entry point: `npm run ingest`. Importing this file runs nothing.
if (import.meta.filename === process.argv[1]) {
  await main();
}
