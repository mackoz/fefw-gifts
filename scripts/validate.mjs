import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FILES = ['categories', 'gifts', 'characters', 'observations', 'sources'];

// Fields that would identify a contributor. Observations are anonymous by design;
// see the spec's "Anonymity and abuse" section.
const FORBIDDEN_OBSERVATION_FIELDS = ['reporter', 'name', 'email', 'ip', 'user', 'author', 'submitter'];

export async function loadDataset(dir) {
  const entries = await Promise.all(
    FILES.map(async (name) => [name, JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'))]),
  );
  return Object.fromEntries(entries);
}

function checkDuplicates(items, kind, errors) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`duplicate ${kind} id: ${item.id}`);
    seen.add(item.id);
  }
}

export function validate(dataset) {
  const errors = [];
  const { categories, sources, observations } = dataset;

  checkDuplicates(categories, 'category', errors);
  checkDuplicates(sources, 'source', errors);

  for (const c of categories) {
    if (!c.label) errors.push(`category ${c.id}: missing label`);
    if (!Array.isArray(c.aliases)) errors.push(`category ${c.id}: aliases must be an array`);
  }

  for (const o of observations) {
    for (const field of FORBIDDEN_OBSERVATION_FIELDS) {
      if (field in o) errors.push(`observation ${o.id}: forbidden identifying field: ${field}`);
    }
  }

  return { errors };
}

// CLI entry point: `npm run validate`
if (import.meta.filename === process.argv[1]) {
  const dir = process.argv[2] ?? 'data';
  const { errors } = validate(await loadDataset(dir));
  if (errors.length) {
    console.error(`${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('data valid');
}
