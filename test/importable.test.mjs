import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

// CLAUDE.md: browser and Worker modules must be importable directly by
// node:test, with no top-level DOM access and no Cloudflare-only globals at
// module scope. Other test files import most modules for their own reasons;
// this imports every one on purpose, including those nothing else imports.
const ROOTS = ['assets/js', 'worker/src'];

// app.js is the browser entry point: it calls main() at load, which reaches
// the DOM and fetches data. assets.test.mjs checks it by source instead.
const ENTRY_POINTS = new Set(['assets/js/app.js']);

const MODULES = [];
for (const root of ROOTS) {
  for (const entry of await readdir(new URL(`../${root}/`, import.meta.url), { recursive: true })) {
    if (entry.endsWith('.js')) MODULES.push(`${root}/${entry}`);
  }
}
MODULES.sort();

test('the importability check sees every module, so it is not vacuous', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'no DOM stub is installed');
  for (const known of ['assets/js/views/shared.js', 'assets/js/api.js', 'worker/src/index.js', 'worker/src/router.js']) {
    assert.ok(MODULES.includes(known), `missing ${known}`);
  }
});

for (const path of MODULES.filter((p) => !ENTRY_POINTS.has(p))) {
  test(`${path} imports under plain Node`, async () => {
    await import(new URL(`../${path}`, import.meta.url));
  });
}
