import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// CLAUDE.md: "The Worker collects no personal data." The schema comments say an
// identifying column is a design change; this makes adding one fail loudly.
const schema = await readFile(new URL('../worker/schema.sql', import.meta.url), 'utf8');

function columns(sql) {
  const body = sql.replace(/--.*$/gm, '');
  const found = [];
  for (const [, table, cols] of body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
    for (const line of cols.split(',')) {
      const m = line.trim().match(/^"?(\w+)"?/);
      if (m) found.push(`${table}.${m[1]}`);
    }
  }
  return found;
}

const COLUMNS = columns(schema);

// `item_reports.name` is the missing item's name, not a person's.
const IDENTIFYING = /(^|_)(ip|ips|email|user|username|reporter|submitter|voter|session|fingerprint|device|cookie|agent|ua|address|hash|hashed)(_|$)/i;

test('the schema parser finds the columns it should, so the check is not vacuous', () => {
  for (const known of ['reports.id', 'reports.character', 'reports.upvotes', 'item_reports.name', 'item_reports.approved']) {
    assert.ok(COLUMNS.includes(known), `missing ${known} from ${COLUMNS.join(', ')}`);
  }
});

test('no D1 column identifies a person', () => {
  for (const column of COLUMNS) {
    assert.doesNotMatch(column.split('.')[1], IDENTIFYING, column);
  }
});
