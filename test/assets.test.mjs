import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Every confidence state the site can render. A missing token is a state that
// falls back to inherited colour and silently stops being distinguishable.
const STATES = ['favorite', 'confirmed', 'contested', 'pending', 'predicted', 'untested'];

test('every confidence state has a colour and a tint in both colour modes', () => {
  const css = read('../assets/css/tokens.css');
  const split = css.indexOf('prefers-color-scheme: dark');
  assert.ok(split > 0, 'tokens.css must declare a dark-mode block');
  const light = css.slice(0, split);
  const dark = css.slice(split);
  for (const state of STATES) {
    assert.match(light, new RegExp(`--${state}:\\s*#[0-9a-f]{6}`, 'i'), `light --${state}`);
    assert.match(dark, new RegExp(`--${state}:\\s*#[0-9a-f]{6}`, 'i'), `dark --${state}`);
    assert.match(light, new RegExp(`--${state}-bg:\\s*#[0-9a-f]{6}`, 'i'), `light --${state}-bg`);
    assert.match(dark, new RegExp(`--${state}-bg:\\s*#[0-9a-f]{6}`, 'i'), `dark --${state}-bg`);
  }
});

test('the masthead palette does not depend on the colour mode', () => {
  const css = read('../assets/css/tokens.css');
  const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
  // The masthead is dark in both modes, so redefining it under the dark-mode
  // query would make light mode render an ivory wordmark on a pale band.
  for (const token of ['--masthead-ground', '--masthead-ink', '--weave-ground']) {
    assert.doesNotMatch(dark, new RegExp(`${token}:`), `${token} must not be redefined for dark mode`);
  }
});

test('no stylesheet makes a third-party request', () => {
  for (const file of ['tokens.css', 'style.css']) {
    const css = read(`../assets/css/${file}`);
    assert.doesNotMatch(css, /fonts\.(googleapis|gstatic)\.com/, `${file} links a font CDN`);
    assert.doesNotMatch(css, /url\(\s*['"]?https?:/i, `${file} requests a remote asset`);
  }
});

test('every font file referenced by @font-face exists', () => {
  const css = read('../assets/css/tokens.css');
  const refs = [...css.matchAll(/url\('(\.\.\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4, `expected at least four @font-face sources, found ${refs.length}`);
  for (const ref of refs) {
    assert.ok(existsSync(new URL(`../assets/css/${ref}`, import.meta.url)), `missing font file: ${ref}`);
  }
});

test('the wordmark is committed and small enough to ship in a header', () => {
  const logo = new URL('../assets/img/fefw-logo.png', import.meta.url);
  assert.ok(existsSync(logo), 'assets/img/fefw-logo.png is missing');
  const bytes = statSync(logo).size;
  assert.ok(bytes < 60_000, `wordmark is ${bytes} bytes; keep it under 60 KB`);
});
